import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction, Actor, LockIntent, StudentAuthority } from "../access/types";
import { lockStudent, lockStudentRelationship } from "../data/authority";
import { confirmedReadings } from "../data/portal";
import * as roster from "../data/roster";
import * as sourceData from "../data/source-assignments";
import { currentSettings } from "../data/tenant-settings";
import * as s from "../db/index";
import { readingView } from "../portal/service";
import * as relationships from "../relationships/data";
import { displayName, writeTutorAssignment, writeTutorRevocation } from "../relationships/service";
import { preferredFirst } from "../settings/validation";
import { writeStudentEdit } from "../students/service";
import { rehearsalsFit, studentInput } from "../students/validation";
import { lockRabbi } from "../study-guides/authority";
import { currentVerseCapture } from "../study/current-verse-context";
import type { SourceAssignmentSelection } from "../study/source-assignments-validation";
import { projectRelatedCatalog } from "../study/sources/discovery";
import type { RelatedSourceMetadata } from "../study/sources/metadata";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { parsePick } from "../../lib/readings/leyning.mjs";
import type { Snapshot } from "../../lib/readings/proposals";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { SCOPES } from "./oauth";
import { GOOGLE_CONSENT_WINDOW_MS, type McpActor } from "./service";
import type { Tool, ToolContext } from "./tools";

// Student setup through the portal MCP (Daniel, 2026-10-21: "Add setup + sources"): the rabbi's Claude
// sets a student's reading, tutors, service slot, rehearsals and verse sources. Admin only, under the
// roster consent (portal:roster) a scheduled routine never holds. Every write runs the portal's own
// write path (the reading work, writeStudentEdit, the tutor writes, the verse-source replace) under the
// live connection with the admin grant re-locked, so validation, conflicts, audit events and RLS match
// the portal's. Nothing here sends an invitation or an e-mail. Tutors get nothing new.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSE = /^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DATE = /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/;
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const studentId = { type: "string", description: "A portal student id from list_students.", pattern: UUID.source };
const kind = { type: "string", enum: ["torah", "haftarah"], description: "Which reading." };
const assignmentId = { type: "string", pattern: UUID.source, description: "The reading's assignmentId from get_student_setup." };
const assignmentRevision = { type: "integer", minimum: 1, maximum: 2147483647, description: "The reading's revision from get_student_setup." };
const verseRef = { type: "string", maxLength: 100, pattern: VERSE.source, description: "One verse of that reading, e.g. \"Genesis 1:1\"." };
const mutationId = { type: "string", pattern: UUID.source, description: "A fresh random UUID for this write; resending the same one replays the saved result instead of writing twice." };
const sourceIds = { type: "array", minItems: 1, maxItems: 32, items: { type: "string", pattern: SOURCE_ID.source }, description: "Source ids from find_sources." };
const expectedVersion = { type: "integer", minimum: 0, maximum: 2147483646, description: "That verse's sources version from get_student_setup or find_sources (0 when it has none)." };
const nullableDate = (description: string) => ({ type: ["string", "null"], pattern: DATE.source, description });

/** Every setup tool needs an admin connection with the roster consent, which a scheduled routine never holds. */
const requireRoster = (actor: McpActor) => { if (actor.role !== "admin" || !actor.scopes.has(SCOPES.roster)) throw new AccessDenied(403); };
const routine = { ok: false, code: "channel-not-permitted", hint: "A scheduled routine cannot change a student's setup; the rabbi does this in a conversation." };
/** A name with an "@" would make the transport withhold the whole result; show that one name as withheld instead. */
const shown = (name: string | null) => name === null ? null : name.includes("@") ? "(withheld: it contains an at sign; check this record in the portal)" : name;
/** A refusal decided inside a transaction: it rolls the transaction back and becomes the tool's answer. */
class Refusal extends Error { constructor(readonly result: Record<string, unknown>) { super("refused"); } }
const refusal = async <T>(work: () => Promise<T>) => { try { return await work(); } catch (error) { if (error instanceof Refusal) return error.result; throw error; } };

/**
 * One transaction under the connection's live authority (withLive re-locks the tenant, connection, user,
 * membership and grant). A write also re-locks the rabbi's admin grant bound to the consented revision
 * (lockRabbi, as apply_roster_changes) and refuses an unattended connection.
 */
function asAdmin<Q extends PgQueryResultHKT, T>(ctx: ToolContext<Q>, intent: LockIntent,
  action: (tx: AccessTransaction<Q>, live: McpActor, portal: Actor, alive: () => void) => Promise<T>): Promise<T> {
  requireRoster(ctx.actor);
  return ctx.mcp.withLive(ctx.actor, intent, async (tx, live, alive) => {
    requireRoster(live);
    if (intent !== "read") {
      if (live.unattended) throw new AccessDenied(403);
      await lockRabbi(tx, live.tenantId, live.membershipId, { roleGrantId: live.roleGrantId, roleGrantRevision: live.roleGrantRevision, authorityRevision: live.authorityRevision });
    }
    const check = () => { alive(); if (ctx.signal.aborted) throw new AccessDenied(401); };
    check();
    const result = await action(tx, live, ctx.mcp.portalActor(live), check);
    // A call the transport has already answered as timed out commits nothing.
    check();
    return result;
  });
}
/**
 * The admin path of access.withStudentCapability under the live connection: the student row locked for the
 * intent, then the admin relationship; a missing, disabled or other-tenant student is one 404. `guard` runs
 * in the same transaction before the shared service's own work.
 */
function studentAuthority<Q extends PgQueryResultHKT>(ctx: ToolContext<Q>, intent: LockIntent,
  guard?: (tx: AccessTransaction<Q>, live: McpActor, studentId: string) => Promise<void>, phase?: Phase): StudentAuthority<Q> {
  return (id, action) => { if (phase) phase.called = true; return asAdmin(ctx, intent, async (tx, live, portal) => {
    if (!UUID.test(id)) throw new AccessDenied(404);
    const student = await lockStudent(tx, live.tenantId, id, intent);
    if (!student || student.disabledAt) throw new AccessDenied(404);
    const relationship = await lockStudentRelationship(tx, live.tenantId, student.id, live.roleGrantId, "admin", intent);
    if (!relationship) throw new AccessDenied(404);
    await guard?.(tx, live, student.id);
    if (phase) phase.entered = true;
    return action(tx, Object.freeze({ ...portal, studentId: student.id, relationshipId: relationship.id, relationshipRevision: relationship.revision }),
      Object.freeze({ id: student.id, firstName: student.firstName, lastName: student.lastName, ceremonyDate: student.ceremonyDate, rehearsal1: student.rehearsal1, rehearsal2: student.rehearsal2, serviceSlot: student.serviceSlot, revision: student.revision }));
  }); };
}
/**
 * Where a reading call stopped: a 403 raised before the authority ran (the service's input checks) or inside
 * the service's own work is the service refusing the choice; one raised while the authority itself was being
 * established (the connection, the admin grant, the student) is an authority failure and is never relabelled.
 */
type Phase = { called: boolean; entered: boolean };
const serviceRefusal = (error: unknown, phase: Phase) => error instanceof AccessDenied && error.status === 403 && (!phase.called || phase.entered);

const sourceView = (c: RelatedSourceMetadata) => ({ id: c.id, title: c.labels.en ?? c.indexTitle, hebrewTitle: c.labels.he, work: c.indexTitle, ref: c.ref, category: c.category });
const ids = (value: unknown): string[] | null => Array.isArray(value) && value.length >= 1 && value.length <= 32 && value.every(v => typeof v === "string" && SOURCE_ID.test(v)) && new Set(value).size === value.length ? value as string[] : null;
const uuids = (value: unknown, max = 20): string[] | null => Array.isArray(value) && value.length <= max && value.every(v => typeof v === "string" && UUID.test(v)) && new Set(value).size === value.length ? value as string[] : null;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const SOURCE_HINTS: Record<string, string> = {
  "stale-revision": "The student's reading changed since get_student_setup: read it again and use the current assignmentId and revision.",
  conflict: "Someone changed this verse's sources first, or expectedVersion is stale: call get_student_setup or find_sources again, then resend with the current version.",
  "no-change": "Those sources were already set exactly so; nothing was saved.",
  "source-catalog-changed": "Sefaria's list for this verse changed: call find_sources again and use its new catalogHash.",
  "invalid-request": "A source id is not one find_sources lists for this verse (or catalogHash is missing): call find_sources and use its ids and catalogHash.",
};
const selectionOf = (input: Record<string, unknown>): SourceAssignmentSelection => Object.freeze({ mode: "admin", studentId: input.studentId as string, kind: input.kind as "torah" | "haftarah",
  assignmentId: input.assignmentId as string, assignmentRevision: input.assignmentRevision as number });
const READING_HINTS: Record<string, string> = {
  conflict: "The student's reading changed since you read it (expectedReadingRevision is stale, or someone saved first): call get_student_setup again, show the rabbi, and resend with the current revision.",
  "needs-selection": "The calendar does not settle this reading on its own: show the rabbi the calendar aliyot and haftarah below and resend with a pick (\"aliyah:N\", \"aliyah:N-M\", \"aliyah:M\", \"triennial\" or \"full\"; \"calendar-haftarah\" for a haftarah) or explicit ranges.",
  "invalid-reading": "That choice does not fit the reading: check the pick, the ranges, and that aliyahStarts are verses of the reading in order (never its first verse).",
};
function calendarView(snapshot: Snapshot) {
  const rows = (list: readonly { n: unknown; ref: string; reason?: string }[]) => list.map(row => ({ n: row.n, ref: row.ref, ...(row.reason ? { reason: row.reason } : {}) }));
  const r = snapshot.reading;
  return { date: snapshot.date, calendar: snapshot.calendar, haftarah: snapshot.haftarah,
    reading: r ? { parashah: r.parashah, aliyot: rows(r.aliyot), triennial: r.triennial ? { year: r.triennial.year, aliyot: rows(r.triennial.aliyot) } : null } : null };
}

/** The checked reading choice: exactly one of pick, ranges or keepVerses; a problem string otherwise. */
function readingChoice(input: Record<string, unknown>) {
  const k = input.kind as "torah" | "haftarah", chosen = ["pick", "ranges", "keepVerses"].filter(key => input[key] !== undefined);
  if (chosen.length !== 1) return "Give exactly one of pick, ranges or keepVerses.";
  if (input.aliyahStarts !== undefined && (k !== "torah" || !Array.isArray(input.aliyahStarts) || input.aliyahStarts.length > 999 || input.aliyahStarts.some(v => typeof v !== "string" || !VERSE.test(v))))
    return "aliyahStarts is a list of verse references, for a Torah reading only.";
  const aliyahStarts = input.aliyahStarts as string[] | undefined, base = { studentId: input.studentId as string, kind: k, ...(aliyahStarts ? { aliyahStarts } : {}) };
  if (input.keepVerses !== undefined) {
    if (input.keepVerses !== true || k !== "torah") return "keepVerses:true keeps a confirmed Torah reading's verses and changes only aliyahStarts.";
    return { ...base, preparationMode: "current-assignment" as const, expectedAssignmentRevision: input.expectedReadingRevision as number };
  }
  if (input.pick !== undefined) {
    const pick = input.pick;
    if (typeof pick !== "string" || pick.length > 40) return "pick is a short text.";
    if (k === "haftarah" ? pick !== "calendar-haftarah" : (() => { try { parsePick(pick); return false; } catch { return true; } })())
      return k === "haftarah" ? "For a haftarah, pick is \"calendar-haftarah\"; otherwise give ranges." : "For Torah, pick is \"aliyah:N\", \"aliyah:N-M\", \"aliyah:M\", \"triennial\" or \"full\".";
    return { ...base, pick };
  }
  const ranges = input.ranges;
  if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > 32 || ranges.some(r => typeof r !== "string" || r.length > 100)) return "ranges is a list of 1 to 32 references such as \"Genesis 1:1-2:3\".";
  try { expandReadingRanges(ranges as string[], k, TANAKH_VERSE_COUNTS); } catch { return "Those ranges are not verses of the Tanakh in reading order (each range runs forward in one book, no verse twice, and Torah ranges follow one another in one book; use references such as \"Genesis 1:1-2:3\")."; }
  return { ...base, ranges: ranges as string[] };
}

/** The reading tools' shared start: the choice, then the portal's reading preparation under the live admin, guarded by the expected revision. */
async function prepared<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>) {
  const choice = readingChoice(input);
  if (typeof choice === "string") return { result: { ok: false, code: "invalid-input", hint: choice } };
  const k = input.kind as "torah" | "haftarah", expected = input.expectedReadingRevision as number;
  const conflict = { ok: false, code: "conflict", hint: READING_HINTS.conflict };
  // The caller's view of the reading is checked in the same transaction the preparation reads it in.
  const phase: Phase = { called: false, entered: false };
  const guarded = studentAuthority(ctx, "data-write", async (tx, live, id) => {
    if (((await roster.currentAssignment(tx, live.tenantId, id, k, false))?.revision ?? 0) !== expected) throw new Refusal(conflict);
  }, phase);
  let value;
  try { value = await ctx.readings.prepareReadingAs(guarded, choice); }
  catch (error) {
    if (error instanceof Refusal) return { result: error.result };
    if (serviceRefusal(error, phase)) return { result: { ok: false, code: "invalid-reading", hint: READING_HINTS["invalid-reading"] } };
    throw error;
  }
  if (value.status === "stale") return { result: conflict };
  if (value.status === "needs-selection") return { result: { ok: false, code: "needs-selection", hint: READING_HINTS["needs-selection"], ceremonyDate: value.ceremonyDate, serviceSlot: value.serviceSlot,
    readingDate: value.readingDate, warning: value.warning, calendar: calendarView(value.snapshot) } };
  if (value.status !== "prepared") throw new Error("Reading preparation unavailable");
  const maftir = value.maftir as { ref?: unknown; reason?: unknown } | null;
  return { value, summary: { kind: value.kind, basis: value.basis, ranges: value.ranges, verseCount: value.verseCount, aliyahStarts: value.aliyahStarts,
    maftir: maftir && typeof maftir.ref === "string" ? { ref: maftir.ref, ...(typeof maftir.reason === "string" ? { reason: maftir.reason } : {}) } : null,
    ceremonyDate: value.ceremonyDate, serviceSlot: value.serviceSlot, readingDate: value.readingDate, warning: value.warning } };
}

export function createSetupTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const replaces = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  const roles = ["admin"] as const, scope = SCOPES.roster;
  return Object.freeze([
    {
      name: "list_tutors", roles, scope, annotations: readOnly,
      description: "The congregation's tutors who can be assigned to a student: id and name only. Ordered by id; pass `cursor` from the previous page to continue.",
      inputSchema: closed({ cursor: { type: "string", pattern: UUID.source, description: "The `next` value from the previous page." }, limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size, default 100." } }),
      handler: async (input, ctx) => asAdmin(ctx, "read", async (tx, live) => {
        const limit = (input.limit as number | undefined) ?? 100, rows = await relationships.eligibleTutors(tx, live.tenantId, input.cursor as string | undefined, limit + 1);
        return { tutors: rows.slice(0, limit).map(row => ({ tutorId: row.grant.id, name: displayName(row.displayName) })), next: rows.length > limit ? rows[limit - 1].grant.id : null };
      }),
    },
    {
      name: "get_student_setup", roles, scope, annotations: readOnly,
      description: "One student's setup, to read before changing it: ceremony date, service slot, rehearsals and revision; each reading with its assignmentId, revision (readingRevision, 0 when none), ranges and aliyah cut points; tutors; and each verse's assigned sources with its version. Contacts only as whether an address is on file.",
      inputSchema: closed({ studentId }, ["studentId"]),
      handler: async (input, ctx) => asAdmin(ctx, "read", async (tx, live) => {
        const student = await lockStudent(tx, live.tenantId, input.studentId as string, "read");
        if (!student || student.disabledAt) throw new AccessDenied(404);
        const [row] = await tx.select({ hebrewName: s.student.hebrewName, serviceSlot: s.student.serviceSlot, studentKind: s.student.studentKind, parentEmail: s.student.parentEmail,
          ownEmail: s.student.ownEmail, secondParentEmail: s.student.secondParentEmail }).from(s.student).where(and(eq(s.student.tenantId, live.tenantId), eq(s.student.id, student.id))).limit(1);
        if (!row) throw new AccessDenied(404);
        const confirmed = new Map((await confirmedReadings(tx, live.tenantId, student.id)).map(r => [r.kind, r]));
        const readings: Record<string, unknown> = {};
        for (const k of ["torah", "haftarah"] as const) {
          const current = await roster.currentAssignment(tx, live.tenantId, student.id, k), held = confirmed.get(k);
          if (!held) { readings[k] = { readingRevision: current?.revision ?? 0, confirmed: false }; continue; }
          const view = readingView(held, student.ceremonyDate), order = new Map(view.verses.map((ref, i) => [ref, i]));
          const sources = (await sourceData.latestForAssignment(tx, live.tenantId, student.id, view.id, view.revision))
            .sort((a, b) => (order.get(a.verseRef) ?? 0) - (order.get(b.verseRef) ?? 0))
            .map(r => ({ verseRef: r.verseRef, version: r.version, sources: sourceData.citations(r).map(c => ({ id: c.id, title: c.labels.en ?? c.indexTitle })) }));
          readings[k] = { readingRevision: view.revision, confirmed: true, assignmentId: view.id, basis: view.basis, ranges: view.ranges, verseCount: view.verses.length,
            aliyahStarts: view.aliyahStarts, needsReview: view.needsReview, readingKey: view.readingKey, readingDate: view.source.date, sources };
        }
        const tutors = (await relationships.inspectLinks(tx, live.tenantId, student.id)).tutors.map(t => ({ tutorId: t.link.tutorGrantId, name: displayName(t.displayName) }));
        return { id: student.id, name: shown(`${student.firstName} ${student.lastName}`), hebrewName: shown(row.hebrewName), studentKind: row.studentKind, ceremonyDate: student.ceremonyDate,
          serviceSlot: row.serviceSlot, rehearsal1: student.rehearsal1, rehearsal2: student.rehearsal2, revision: student.revision, readings, tutors,
          contacts: { parentEmailOnFile: row.parentEmail !== null, ownEmailOnFile: row.ownEmail !== null, secondParentEmailOnFile: row.secondParentEmail !== null } };
      }),
    },
    {
      name: "find_sources", roles, scope, annotations: readOnly, deadlineMs: 55_000,
      description: "Search the sources the portal's source panel offers for one verse of a student's confirmed reading (Sefaria's linked commentary, the congregation's preferred works first). Optional `query` filters by title, work, reference or category. Returns each source's id, the catalogHash assign_sources needs, and the verse's current sources and version.",
      inputSchema: closed({ studentId, kind, assignmentId, assignmentRevision, verseRef, query: { type: "string", maxLength: 100, description: "Optional words to match in the title, work, reference or category." },
        offset: { type: "integer", minimum: 0, maximum: 4096, description: "From nextOffset." }, limit: { type: "integer", minimum: 1, maximum: 50, description: "Page size, default 25." } },
      ["studentId", "kind", "assignmentId", "assignmentRevision", "verseRef"]),
      handler: async (input, ctx) => {
        const selection = selectionOf(input), verse = input.verseRef as string;
        // The same verse context the portal's source panel reads under: the confirmed reading at this revision, and the verse in it.
        const head = await studentAuthority(ctx, "read")(selection.studentId, currentVerseCapture({ signal: ctx.signal }, selection, verse, async (tx, actor) =>
          ({ preferred: (await currentSettings(tx, actor.tenantId))?.preferredSources ?? [], latest: await sourceData.latest(tx, actor, selection, verse) })));
        if ("ok" in head) return { ok: false, code: head.code, hint: SOURCE_HINTS[head.code] };
        let catalog;
        try { catalog = projectRelatedCatalog(await ctx.related(verse, ctx.signal), verse); }
        catch { return { ok: false, code: "sources-unavailable", hint: "Sefaria's source list for this verse could not be read just now; try again." }; }
        const words = typeof input.query === "string" ? input.query.toLowerCase().split(/\s+/).filter(Boolean) : [];
        const all = preferredFirst(catalog.entries, head.preferred), matched = all.filter(e => words.every(w => [e.labels.en, e.labels.he, e.indexTitle, e.ref, e.category].some(x => x?.toLowerCase().includes(w))));
        const offset = (input.offset as number | undefined) ?? 0, limit = (input.limit as number | undefined) ?? 25, page = matched.slice(offset, offset + limit);
        const assigned = head.latest ? sourceData.citations(head.latest) : [], held = new Set(assigned.map(c => c.id));
        return { ok: true, verseRef: verse, catalogHash: catalog.catalogHash, totalSources: all.length, matched: matched.length, offset, nextOffset: offset + page.length < matched.length ? offset + page.length : null,
          sources: page.map(e => ({ ...sourceView(e), assigned: held.has(e.id) })), current: { version: head.latest?.version ?? 0, sources: assigned.map(sourceView) } };
      },
    },
    {
      name: "assign_sources", roles, scope, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, deadlineMs: 55_000,
      description: "Add sources to one verse of a student's reading, keeping those already there; the student sees them under that verse. Only on the rabbi's instruction in this conversation. Ids and catalogHash from find_sources; expectedVersion is the verse's current version. Sends nothing to anyone.",
      inputSchema: closed({ studentId, kind, assignmentId, assignmentRevision, verseRef, expectedVersion, sourceIds, catalogHash: { type: "string", pattern: "^[a-f0-9]{64}$", description: "catalogHash from find_sources." }, mutationId },
        ["studentId", "kind", "assignmentId", "assignmentRevision", "verseRef", "expectedVersion", "sourceIds", "catalogHash", "mutationId"]),
      handler: async (input, ctx) => replaceSources(input, ctx, "add"),
    },
    {
      name: "remove_source_assignment", roles, scope, annotations: replaces, deadlineMs: 55_000,
      description: "Remove sources from one verse of a student's reading; the student no longer sees them there. Only on the rabbi's instruction in this conversation. expectedVersion is the verse's current version from get_student_setup.",
      inputSchema: closed({ studentId, kind, assignmentId, assignmentRevision, verseRef, expectedVersion, sourceIds, mutationId },
        ["studentId", "kind", "assignmentId", "assignmentRevision", "verseRef", "expectedVersion", "sourceIds", "mutationId"]),
      handler: async (input, ctx) => replaceSources(input, ctx, "remove"),
    },
    {
      name: "preview_student_reading", roles, scope, annotations: readOnly, deadlineMs: 55_000,
      description: "What set_student_reading would set, without saving: the ranges, verse count, aliyah cut points and maftir, or the calendar's aliyot and haftarah when a pick is needed. Same inputs as set_student_reading. Show the rabbi before setting.",
      inputSchema: readingSchema(),
      handler: async (input, ctx) => {
        if (ctx.actor.unattended) return routine;
        const ready = await prepared(input, ctx);
        return "result" in ready ? ready.result : { ok: true, wouldSet: ready.summary, next: "Show the rabbi this reading. Call set_student_reading with the same arguments only when the rabbi says to set it." };
      },
    },
    {
      name: "set_student_reading", roles, scope, annotations: replaces, deadlineMs: 55_000,
      description: "Set a student's Torah or haftarah reading exactly as the portal's reading editor does: a calendar pick, custom verse ranges, or (keepVerses) new aliyah cut points on the confirmed Torah verses. Replaces the student's current reading of that kind. Only on the rabbi's instruction in this conversation; preview_student_reading first. expectedReadingRevision is the reading's revision from get_student_setup (0 when none).",
      inputSchema: readingSchema(),
      handler: async (input, ctx) => {
        if (ctx.actor.unattended) return routine;
        const ready = await prepared(input, ctx);
        if ("result" in ready) return ready.result;
        let saved;
        const phase: Phase = { called: false, entered: false };
        // The preparation is checked again at confirm; a refusal there means it expired or no longer matches.
        try { saved = await ctx.readings.confirmReadingAs(studentAuthority(ctx, "data-write", undefined, phase), { studentId: input.studentId as string, binding: ready.value.binding }); }
        catch (error) { if (serviceRefusal(error, phase)) return { ok: false, code: "conflict", hint: READING_HINTS.conflict }; throw error; }
        if (!saved.ok) return { ok: false, code: "conflict", hint: READING_HINTS.conflict };
        return { ok: true, assignmentId: saved.assignmentId, readingRevision: saved.revision, set: ready.summary,
          next: "Nothing was sent to anyone. Sources chosen for the old reading stay with it; choose this reading's sources with find_sources and assign_sources." };
      },
    },
    {
      name: "set_student_tutor", roles, scope, annotations: replaces,
      description: "Set which tutors a student has: tutorIds is the whole new list (from list_tutors; [] for none) and expectedTutorIds the list get_student_setup showed. A tutor added can see that student in the portal; one removed no longer can. Adding a tutor needs a fresh sign-in, as in the portal: only within 15 minutes of connecting Claude (otherwise tell the rabbi to reconnect Claude to the portal and add the tutor within 15 minutes); removing needs none. Only on the rabbi's instruction in this conversation. Sends no invitation or e-mail.",
      inputSchema: closed({ studentId,
        expectedTutorIds: { type: "array", maxItems: 20, items: { type: "string", pattern: UUID.source }, description: "The tutorIds get_student_setup listed for this student, unchanged." },
        tutorIds: { type: "array", maxItems: 20, items: { type: "string", pattern: UUID.source }, description: "The student's whole new tutor list, by tutorId from list_tutors." } },
      ["studentId", "expectedTutorIds", "tutorIds"]),
      handler: async (input, ctx) => setTutors(input, ctx),
    },
    {
      name: "set_student_service", roles, scope, annotations: replaces,
      description: "Set a student's service slot and rehearsal dates, as the portal's student editor does. Give only what changes: serviceSlot, rehearsal1, rehearsal2 (YYYY-MM-DD, on or before the ceremony and in order; null clears). A changed slot sends the student's readings and service plan back to review. Only on the rabbi's instruction in this conversation. expectedRevision is the student's revision from get_student_setup.",
      inputSchema: closed({ studentId, expectedRevision: { type: "integer", minimum: 1, maximum: 2147483647, description: "The student's revision from get_student_setup." },
        serviceSlot: { type: "string", enum: ["morning", "havdalah", "unknown"], description: "The service the ceremony is in." },
        rehearsal1: nullableDate("First rehearsal date, YYYY-MM-DD, or null to clear."), rehearsal2: nullableDate("Second rehearsal date, YYYY-MM-DD, or null to clear.") },
      ["studentId", "expectedRevision"]),
      handler: async (input, ctx) => setService(input, ctx),
    },
  ] satisfies Tool<Q>[]);
}

function readingSchema() {
  return closed({ studentId, kind, expectedReadingRevision: { type: "integer", minimum: 0, maximum: 2147483647, description: "The reading's readingRevision from get_student_setup (0 when none)." },
    pick: { type: "string", maxLength: 40, description: "A calendar pick: Torah \"aliyah:N\", \"aliyah:N-M\", \"aliyah:M\", \"triennial\" or \"full\"; haftarah \"calendar-haftarah\"." },
    ranges: { type: "array", minItems: 1, maxItems: 32, items: { type: "string", maxLength: 100 }, description: "Custom verse ranges in order, e.g. [\"Genesis 1:1-2:3\"]." },
    keepVerses: { type: "boolean", description: "true: keep the confirmed Torah verses and change only aliyahStarts." },
    aliyahStarts: { type: "array", maxItems: 999, items: { type: "string", maxLength: 100 }, description: "Torah only: the verse where each aliyah after the first begins, in order; [] for none. Omitted keeps the current cut points." } },
  ["studentId", "kind", "expectedReadingRevision"]);
}

async function replaceSources<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>, mode: "add" | "remove") {
  requireRoster(ctx.actor);
  if (ctx.actor.unattended) return routine;
  const chosen = ids(input.sourceIds);
  if (!chosen) return { ok: false, code: "invalid-input", hint: "sourceIds is a list of 1 to 32 distinct source ids from find_sources." };
  const selection = selectionOf(input), verse = input.verseRef as string;
  // The verse's current sources, read in the portal's verse context; the replace below re-checks the version.
  const head = await studentAuthority(ctx, "read")(selection.studentId, currentVerseCapture({ signal: ctx.signal }, selection, verse, async (tx, actor) => sourceData.latest(tx, actor, selection, verse)));
  if (head && "ok" in head) return { ok: false, code: head.code, hint: SOURCE_HINTS[head.code] };
  // A version the verse has not reached is stale (a newer one may be a replay, which the replace recognises).
  if ((head?.version ?? 0) < (input.expectedVersion as number)) return { ok: false, code: "conflict", hint: SOURCE_HINTS.conflict };
  const current = head ? sourceData.citations(head).map(c => c.id) : [];
  const full = mode === "add" ? [...new Set([...current, ...chosen])] : current.filter(id => !chosen.includes(id));
  if (full.length > 32) return { ok: false, code: "too-many-sources", hint: "A verse holds at most 32 sources; remove some first." };
  const result = await ctx.sources.replaceAs(studentAuthority(ctx, "data-write"), ctx.signal, selection, { verseRef: verse, expectedVersion: input.expectedVersion as number,
    mutationId: (input.mutationId as string).toLowerCase(), sourceIds: full, ...(mode === "add" ? { catalogHash: input.catalogHash as string } : {}) });
  if (!result.ok) return { ok: false, code: result.code, hint: SOURCE_HINTS[result.code] ?? "Nothing was saved." };
  return { ok: true, replayed: result.replayed, verseRef: verse, version: result.committedVersion, latestVersion: result.currentLatestVersion, sources: result.committed.citations.map(sourceView) };
}

async function setTutors<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>) {
  requireRoster(ctx.actor);
  if (ctx.actor.unattended) return routine;
  const expected = uuids(input.expectedTutorIds), wanted = uuids(input.tutorIds);
  if (!expected || !wanted) return { ok: false, code: "invalid-input", hint: "expectedTutorIds and tutorIds are lists of at most 20 distinct tutorIds." };
  const id = input.studentId as string;
  const conflict = { ok: false, code: "conflict", hint: "The student's tutors changed since get_student_setup: read it again, show the rabbi, and resend with the current list." };
  const stale = { ok: false, code: "fresh-sign-in-required", hint: "Adding a tutor needs a fresh sign-in. Reconnect Claude to the portal, then add the tutor within 15 minutes." };
  return refusal(() => asAdmin(ctx, "authority-write", async (tx, live, portal, alive) => {
    // Unlocked here (the portal locks tutor grants before the student); the locked read below decides.
    const [probe] = await tx.select({ disabledAt: s.student.disabledAt }).from(s.student).where(and(eq(s.student.tenantId, live.tenantId), eq(s.student.id, id))).limit(1);
    if (!probe || probe.disabledAt) throw new AccessDenied(404);
    // The portal's fresh sign-in rule for tutor changes (manage-relationships: a session under 15 minutes old). The
    // connection's approval needed a Google sign-in within 15 minutes, and its stored approval time stands in for the
    // session's, so an addition is at most about 30 minutes after that sign-in. Only adding a tutor gives anyone new
    // access; removing one stays allowed on an older connection (the portal asks for a fresh sign-in for both).
    if (wanted.some(g => !expected.includes(g)) && ctx.mcp.now() - live.approvedAt >= GOOGLE_CONSENT_WINDOW_MS) throw new Refusal(stale);
    const links = async () => (await relationships.inspectLinks(tx, live.tenantId, id)).tutors.map(t => ({ grantId: t.link.tutorGrantId, linkId: t.link.id }));
    if (!sameSet((await links()).map(l => l.grantId), expected)) throw new Refusal(conflict);
    // The portal's lock order for tutor changes: each tutor's grant, then the student; then recheck under those locks.
    for (const grantId of [...new Set([...expected, ...wanted])].sort()) await relationships.subjectGrant(tx, live.tenantId, grantId, "authority-write");
    const student = await relationships.student(tx, live.tenantId, id, "authority-write");
    if (student.disabledAt) throw new AccessDenied(404);
    const current = await links();
    if (!sameSet(current.map(l => l.grantId), expected)) throw new Refusal(conflict);
    const removed: string[] = [], added: string[] = [];
    for (const link of current.filter(l => !wanted.includes(l.grantId))) {
      alive();
      if (!(await writeTutorRevocation(tx, portal, id, link.linkId)).ok) throw new Refusal(conflict);
      removed.push(link.grantId);
    }
    for (const grantId of wanted.filter(g => !expected.includes(g))) {
      alive();
      if (!(await writeTutorAssignment(tx, portal, id, grantId)).ok) throw new Refusal(conflict);
      added.push(grantId);
    }
    alive();
    const tutors = (await relationships.inspectLinks(tx, live.tenantId, id)).tutors.map(t => ({ tutorId: t.link.tutorGrantId, name: displayName(t.displayName) }));
    return { ok: true, unchanged: !added.length && !removed.length, added, removed, tutors, invitationsSent: 0 };
  }));
}

async function setService<Q extends PgQueryResultHKT>(input: Record<string, unknown>, ctx: ToolContext<Q>) {
  requireRoster(ctx.actor);
  if (ctx.actor.unattended) return routine;
  const date = (key: "rehearsal1" | "rehearsal2") => input[key] === undefined || input[key] === null || (typeof input[key] === "string" && DATE.test(input[key] as string));
  if (!date("rehearsal1") || !date("rehearsal2")) return { ok: false, code: "invalid-input", hint: "rehearsal1 and rehearsal2 are YYYY-MM-DD dates, or null to clear." };
  if (input.serviceSlot === undefined && input.rehearsal1 === undefined && input.rehearsal2 === undefined) return { ok: false, code: "invalid-input", hint: "Give serviceSlot, rehearsal1 or rehearsal2." };
  const id = input.studentId as string, expected = input.expectedRevision as number;
  return asAdmin(ctx, "authority-write", async (tx, live, portal, alive) => {
    const current = await roster.editableStudent(tx, live.tenantId, id);
    if (!current || current.disabledAt) throw new AccessDenied(404);
    const conflict = { ok: false, code: "conflict", currentRevision: current.revision, hint: "The student changed since get_student_setup: read it again, show the rabbi, and resend with the current revision." };
    if (current.revision !== expected) return conflict;
    const slot = (input.serviceSlot as string | undefined) ?? current.serviceSlot;
    const rehearsal1 = input.rehearsal1 === undefined ? current.rehearsal1 : input.rehearsal1 as string | null, rehearsal2 = input.rehearsal2 === undefined ? current.rehearsal2 : input.rehearsal2 as string | null;
    if (slot === current.serviceSlot && rehearsal1 === current.rehearsal1 && rehearsal2 === current.rehearsal2) return { ok: false, code: "no-change", hint: "Nothing changed; nothing was saved." };
    if (!rehearsalsFit(current.ceremonyDate, rehearsal1, rehearsal2)) return { ok: false, code: "rehearsals-do-not-fit", hint: `Rehearsals fall on or before the ceremony (${current.ceremonyDate}), the first on or before the second.` };
    let values;
    // The student's own fields stay as they are; only the slot and the rehearsals given change (the portal editor's StudentInput).
    try { values = studentInput({ firstName: current.firstName, lastName: current.lastName, ceremonyDate: current.ceremonyDate, studentKind: current.studentKind, parentEmail: current.parentEmail,
      ownEmail: current.ownEmail, serviceSlot: slot, ...(input.rehearsal1 === undefined ? {} : { rehearsal1 }), ...(input.rehearsal2 === undefined ? {} : { rehearsal2 }) }); }
    catch { return { ok: false, code: "invalid-input", hint: "Those dates are not valid, or this student's record needs fixing in the portal's roster first." }; }
    alive();
    const updated = await writeStudentEdit(tx, portal, id, expected, values, ctx.mcp.now());
    if (!updated) return conflict;
    alive();
    return { ok: true, studentId: id, revision: updated.revision, serviceSlot: slot, rehearsal1, rehearsal2, readingsSentToReview: updated.readingNeedsReview,
      next: updated.readingNeedsReview ? "The slot changed, so the student's readings and service plan are marked for review: check the readings with get_student_setup." : "Nothing was sent to anyone." };
  });
}
