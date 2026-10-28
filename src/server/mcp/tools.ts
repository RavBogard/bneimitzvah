import type { DelegatedInvitations } from "../invitations/service";
import "server-only";
import { and, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessDatabase } from "../access/types";
import { lockStudent, lockStudentRelationship } from "../data/authority";
import { confirmedReadings } from "../data/portal";
import { lockVisibleStudentCandidates } from "../data/students";
import { readingView } from "../portal/service";
import { lockRabbi } from "../study-guides/authority";
import { readableInApp } from "../study-guides/citations";
import type { createStudyGuideService, RabbiAuthority } from "../study-guides/service";
import type { RelatedSourceCatalog } from "../study/sources/metadata";
import type { createDelegatedSourceAssignments } from "../study/source-assignments-service";
import type { createReadingWork } from "../students/service";
import type { StudyPage, StudyRequest } from "../study/types";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import * as s from "../db/index";
import type { createMcpAuthService, McpActor } from "./service";
import { SCOPES } from "./oauth";
import { createRosterTools } from "./roster-tools";
import { createSetupTools } from "./setup-tools";
import { createPrintTools } from "./print-tools";
import { createStudyTools } from "./study-tools";
import { createSavedTools } from "./saved-tools";
import type { Calendar, Snapshot } from "../../lib/readings/proposals";
import { createAnalyticsTools } from "./analytics-tools";
import { createDiscussionTools } from "./discussion-tools";
import { createPortionSummaryTools } from "./portion-summary-tools";
import type { DiscussionService } from "../discussions/service";

type JsonSchema = Readonly<Record<string, unknown>>;
export type ToolResult = Readonly<{ content: readonly Readonly<{ type: "text"; text: string }>[]; isError?: boolean }>;
export type ToolContext<Q extends PgQueryResultHKT> = Readonly<{
  actor: McpActor; signal: AbortSignal;
  mcp: ReturnType<typeof createMcpAuthService<Q>>; guides: ReturnType<typeof createStudyGuideService<Q>>;
  loadText: (request: StudyRequest) => Promise<StudyPage>; related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>;
  /** The portal's calendar reader (Hebcal), for the print sheet tool's "this coming Shabbat". */
  loadReading: (date: string, calendar: Calendar) => Promise<{ snapshot: Snapshot; fetchedAt: number }>;
  db: AccessDatabase<Q>;
  /** The portal's own reading and verse-source writes, run under a delegated (MCP) authority. */
  readings: ReturnType<typeof createReadingWork<Q>>; sources: ReturnType<typeof createDelegatedSourceAssignments<Q>>;
  /** Curated discussions and Claude translations (1.7 M6): admin, attended only. */
  discussions: DiscussionService<Q>;
  /** The portal's invitation write and email, under the live admin connection (invite_tutor); null when not composed. */
  invitations: DelegatedInvitations<Q> | null;
}>;
export type Tool<Q extends PgQueryResultHKT> = Readonly<{
  name: string; description: string; inputSchema: JsonSchema; annotations: Readonly<Record<string, unknown>>;
  /** Who sees the tool at all: the study tools are the rabbi's (an admin grant) alone. */
  roles: readonly ("admin" | "tutor")[]; scope: string; deadlineMs?: number;
  /** Only on a connection the person approved for themselves: a scheduled routine (unattended) never sees the tool. */
  attendedOnly?: true;
  handler: (input: Record<string, unknown>, ctx: ToolContext<Q>) => Promise<unknown>;
}>;

export const textResult = (value: unknown): ToolResult => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? null, null, 1) }] });
export const errorResult = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const kind = { type: "string", enum: ["torah", "haftarah"], description: "Which reading." };
const readingKey = str("The guide key from list_guide_work, e.g. \"bamidbar\" or \"i-kings-8-1-8-21\".", { maxLength: 160, pattern: SLUG_PATTERN });
const studentId = str("A portal student id from list_students.", { pattern: UUID_PATTERN });
const mutationId = str("A fresh random UUID for this write; resending the same one replays the saved result instead of writing twice.", { pattern: UUID_PATTERN });
const expectedVersion = { type: "integer", minimum: 0, maximum: 1000000, description: "The current version from your last read (0 when none exists)." };
const guideBody = { type: "object", description: "The guide: { overview, themes: [{ id, title, intro, notes: [{ verseRef, body, sources: [{ id }] }] }] }. Each source id must be one get_reading_for_guide listed for that verse; the server fills in the rest of each source from Sefaria." };
const additionsBody = { type: "object", description: "Per-student additions: { themes: [{ id, title, intro, notes: [...] }] } with no overview; notes only on that student's own verses." };
const origin = { type: "string", enum: ["claude", "rabbi"], description: "\"claude\" for any text Claude wrote or rewrote; \"rabbi\" only for words the rabbi wrote himself." };
const reviewed = { type: "boolean", description: "True only when the rabbi has read this exact text in this conversation and said it is reviewed." };
const closed = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

/** Validates a tool's arguments against its closed schema; returns the problems. */
export function validateInput(schema: JsonSchema, input: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) problems.push(`unknown argument ${key}`);
  for (const key of (schema.required ?? []) as string[]) if (!Object.hasOwn(input, key)) problems.push(`missing ${key}`);
  for (const [key, rule] of Object.entries(properties)) {
    if (!Object.hasOwn(input, key)) continue;
    const value = input[key];
    if (rule.type === "string") {
      if (typeof value !== "string") { problems.push(`${key} must be a string`); continue; }
      if (typeof rule.maxLength === "number" && value.length > rule.maxLength) problems.push(`${key} is too long`);
      if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) problems.push(`${key} is not in the expected form`);
      if (Array.isArray(rule.enum) && !rule.enum.includes(value)) problems.push(`${key} must be one of ${rule.enum.join(", ")}`);
    } else if (rule.type === "integer") {
      if (!Number.isSafeInteger(value) || (value as number) < (rule.minimum as number) || (value as number) > (rule.maximum as number)) problems.push(`${key} must be a whole number from ${rule.minimum} to ${rule.maximum}`);
    } else if (rule.type === "boolean") {
      if (typeof value !== "boolean") problems.push(`${key} must be true or false`);
    } else if (rule.type === "object") {
      if (!value || typeof value !== "object" || Array.isArray(value)) problems.push(`${key} must be an object`);
    }
  }
  return problems;
}

/** The rabbi's authority for one MCP call: the connection and the admin grant are both re-locked in the write transaction. */
function rabbiAuthority<Q extends PgQueryResultHKT>(ctx: ToolContext<Q>): RabbiAuthority<Q> {
  return {
    run: action => ctx.mcp.withLive(ctx.actor, "data-write", async (tx, actor, alive) => {
      if (actor.role !== "admin") throw new AccessDenied(403);
      const rabbi = await lockRabbi(tx, actor.tenantId, actor.membershipId, { roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision, authorityRevision: actor.authorityRevision });
      // An unattended routine's consent can never mark work reviewed (S25); a read-only consent cannot write study work. (Since 1.7 M4 it can
      // write the person's own saved readings, saved-tools.ts: the person's own rows only, never deleted, revision-checked.)
      const writer = Object.freeze({ tenantId: actor.tenantId, ...rabbi, channel: "mcp" as const, mayReview: !actor.unattended && actor.scopes.has(SCOPES.study) });
      const live = () => { alive(); if (ctx.signal.aborted) throw new AccessDenied(401); };
      return action(tx, writer, live);
    }),
  };
}
const requireStudy = (ctx: { actor: McpActor }) => { if (!ctx.actor.scopes.has(SCOPES.study) || ctx.actor.role !== "admin") throw new AccessDenied(403); };
/** An unattended routine writes only as Claude: it can never put words in the rabbi's mouth. */
const routineOrigin = (ctx: { actor: McpActor }, input: Record<string, unknown>) => ctx.actor.unattended && input.origin !== "claude"
  ? { ok: false, code: "channel-not-permitted", hint: "A scheduled routine saves only origin claude." } : null;
const outcome = (result: { ok: boolean; code?: string; problems?: readonly string[] } & Record<string, unknown>) => result.ok ? result
  : { ...result, hint: ({ conflict: "Someone saved first or expectedVersion is stale: read again, then resend with the current version.", "no-change": "Nothing changed; nothing was saved.",
    "review-not-permitted": "This connection cannot mark work reviewed (a scheduled routine, or a read-only connection). Save with reviewed:false.",
    "stale-assignment": "The student's reading changed: call get_student_guide again for the current assignment.", "not-held": "That version is not a held draft.",
    "no-reading": "That student has no confirmed reading of this kind.", invalid: "Fix the listed problems and resend." } as Record<string, string>)[result.code ?? ""] };

export function createTools<Q extends PgQueryResultHKT>(): readonly Tool<Q>[] {
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  return Object.freeze([
    {
      name: "list_students", roles: ["admin", "tutor"], scope: SCOPES.read, annotations: readOnly,
      description: "List the students you may see: every current student for the rabbi or an administrator, your own students for a tutor. Ordered by id; pass `cursor` from the previous page to continue.",
      inputSchema: closed({ cursor: str("The `next` value from the previous page.", { pattern: UUID_PATTERN }), limit: { type: "integer", minimum: 1, maximum: 100, description: "Page size, default 50." } }),
      handler: async (input, ctx) => ctx.mcp.withLive(ctx.actor, "read", async (tx, actor) => {
        const limit = (input.limit as number | undefined) ?? 50, portal = ctx.mcp.portalActor(actor);
        const candidates = await lockVisibleStudentCandidates(tx, portal, { afterId: input.cursor as string | undefined, limit: limit + 1 });
        const visible = [];
        for (const student of candidates.slice(0, limit)) {
          if (await lockStudentRelationship(tx, actor.tenantId, student.id, actor.roleGrantId, actor.role, "read"))
            visible.push({ id: student.id, name: `${student.firstName} ${student.lastName}`, ceremonyDate: student.ceremonyDate, studentKind: student.studentKind });
        }
        return { students: visible, next: candidates.length > limit ? candidates[limit - 1].id : null };
      }),
    },
    {
      name: "get_student", roles: ["admin", "tutor"], scope: SCOPES.read, annotations: readOnly,
      description: "One student's preparation summary: names, Hebrew name, ceremony date and service slot, and their confirmed Torah and haftarah readings with each reading's guide key.",
      inputSchema: closed({ studentId }, ["studentId"]),
      handler: async (input, ctx) => ctx.mcp.withLive(ctx.actor, "read", async (tx, actor) => {
        const student = await lockStudent(tx, actor.tenantId, input.studentId as string, "read");
        if (!student || student.disabledAt || !(await lockStudentRelationship(tx, actor.tenantId, student.id, actor.roleGrantId, actor.role, "read"))) throw new AccessDenied(404);
        const [extra] = await tx.select({ hebrewName: s.student.hebrewName, serviceSlot: s.student.serviceSlot }).from(s.student)
          .where(and(eq(s.student.tenantId, actor.tenantId), eq(s.student.id, student.id))).limit(1);
        const readings = (await confirmedReadings(tx, actor.tenantId, student.id)).map(row => {
          const r = readingView(row, student.ceremonyDate);
          return { kind: r.kind, ranges: r.ranges, verseCount: r.verses.length, readingKey: r.readingKey, readingDate: r.source.date };
        });
        return { id: student.id, firstName: student.firstName, lastName: student.lastName, hebrewName: extra?.hebrewName ?? null,
          ceremonyDate: student.ceremonyDate, serviceSlot: extra?.serviceSlot ?? "unknown", studentKind: student.studentKind, readings };
      }),
    },
    {
      name: "get_study_voice", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "The congregation's study voice: how every guide is written. Read it before drafting. `template:true` means none is saved yet and the body is a starter to write with the rabbi.",
      inputSchema: closed({}),
      handler: async (_input, ctx) => ctx.guides.getVoice(rabbiAuthority(ctx)),
    },
    {
      name: "save_study_voice", roles: ["admin"], scope: SCOPES.study, annotations: write,
      description: "Save a new version of the study voice (markdown, up to 32 KB). Only when the rabbi asks for it.",
      inputSchema: closed({ expectedVersion, body: str("The whole voice document in markdown.", { maxLength: 40000 }), mutationId }, ["expectedVersion", "body", "mutationId"]),
      handler: async (input, ctx) => {
        requireStudy(ctx);
        // The voice shapes every future guide: only the rabbi, never an unattended routine.
        if (ctx.actor.unattended) return { ok: false, code: "channel-not-permitted", hint: "A scheduled routine cannot change the study voice." };
        return outcome(await ctx.guides.setVoice(rabbiAuthority(ctx), input as never));
      },
    },
    {
      name: "list_guide_work", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "What needs a guide: every current student's confirmed reading grouped by guide key, with student count, whether a base guide exists, whether students see a reviewed version, any held draft, and which students have their own additions. Readings with no calendar key (custom ranges) are listed separately; they can only get per-student additions.",
      inputSchema: closed({}),
      handler: async (_input, ctx) => ctx.guides.guideWork(rabbiAuthority(ctx)),
    },
    {
      name: "list_guide_catalog", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "Every guide key CRC's rite can read, in calendar order, whether or not a student has it: the parashot and doubled weeks (Torah keys), each regular haftarah, the special-Shabbat haftarot, and holiday and fast-day readings. Each entry has kind, readingKey, name, group (a Torah book, special or holiday), verseCount, `draftable` (whether get_reading_for_guide and save_guide return verses for the key: an assigned student's reading, or the catalog's own passage) and base: none, held-draft, published-unreviewed or reviewed, with versions. `unresolved` lists catalog readings that produce no key. No student data.",
      inputSchema: closed({}),
      handler: async (_input, ctx) => ctx.guides.guideCatalog(rabbiAuthority(ctx)),
    },
    {
      name: "get_reading_for_guide", roles: ["admin"], scope: SCOPES.read, annotations: readOnly, deadlineMs: 55_000,
      description: "The text to draft a base guide from, 25 verses per page: Hebrew (Miqra According to the Masorah) and the JPS 2023 English for your drafting only (never paste English verse text into a guide), and for each verse the Sefaria sources a note may cite. `readable:true` sources open in the portal's reader; the rest link out to Sefaria. Pass `offset` from `nextOffset` for the next page.",
      inputSchema: closed({ kind, readingKey, offset: { type: "integer", minimum: 0, maximum: 1000, description: "Verse offset, from the previous page's nextOffset." } }, ["kind", "readingKey"]),
      handler: async (input, ctx) => {
        const { verses } = await ctx.guides.guidePassage(rabbiAuthority(ctx), input as never);
        if (!verses.length) return { kind: input.kind, readingKey: input.readingKey, totalVerses: 0, verses: [], nextOffset: null, note: "No reading is known for this key." };
        const offset = (input.offset as number | undefined) ?? 0, page = verses.slice(offset, offset + 25);
        if (!page.length) return { kind: input.kind, readingKey: input.readingKey, totalVerses: verses.length, verses: [], nextOffset: null };
        const text = await ctx.loadText({ kind: input.kind as "torah" | "haftarah", ranges: rangesOf(page), verses: page, offset: 0, translation: "jps2023", signal: ctx.signal });
        const byRef = new Map(text.verses.map(v => [v.ref, v]));
        const out = [];
        for (const ref of page) {
          const catalog = await ctx.related(ref, ctx.signal);
          const verse = byRef.get(ref);
          out.push({ ref, hebrew: verse?.hebrew.text ?? null, english: verse?.english ?? null,
            sources: catalog.entries.map(e => ({ id: e.id, ref: e.ref, title: e.labels.en ?? e.indexTitle, category: e.category, readable: readableInApp(e) })) });
        }
        const next = offset + page.length;
        return { kind: input.kind, readingKey: input.readingKey, totalVerses: verses.length, offset, nextOffset: next < verses.length ? next : null, verses: out };
      },
    },
    {
      name: "get_guide", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "The base guide for one reading: the version students see now and any newer held draft, with currentVersion to pass as expectedVersion.",
      inputSchema: closed({ kind, readingKey }, ["kind", "readingKey"]),
      handler: async (input, ctx) => ctx.guides.getBaseGuide(rabbiAuthority(ctx), input as never),
    },
    {
      name: "save_guide", roles: ["admin"], scope: SCOPES.study, annotations: write, deadlineMs: 55_000,
      description: "Save a new version of a reading's base guide. reviewed:false goes live at once only when no reviewed version exists; otherwise it is held for the rabbi (S25). hold:true keeps it from students until publish_guide. Refused whole if any source is not one Sefaria lists for that verse, a verse is outside the reading, or a limit is exceeded.",
      inputSchema: closed({ kind, readingKey, expectedVersion, body: guideBody, origin, reviewed, hold: { type: "boolean", description: "Keep this version from students until publish_guide." }, mutationId },
        ["kind", "readingKey", "expectedVersion", "body", "origin", "reviewed", "hold", "mutationId"]),
      handler: async (input, ctx) => { requireStudy(ctx); return routineOrigin(ctx, input) ?? outcome(await ctx.guides.setBaseGuide(rabbiAuthority(ctx), input as never)); },
    },
    {
      name: "publish_guide", roles: ["admin"], scope: SCOPES.study, annotations: write,
      description: "Release a held draft to students, as the rabbi's decision.",
      inputSchema: closed({ kind, readingKey, version: { type: "integer", minimum: 1, maximum: 1000000, description: "The held version to publish." }, mutationId }, ["kind", "readingKey", "version", "mutationId"]),
      handler: async (input, ctx) => { requireStudy(ctx); return outcome(await ctx.guides.publishBaseGuide(rabbiAuthority(ctx), input as never)); },
    },
    {
      name: "get_student_guide", roles: ["admin"], scope: SCOPES.read, annotations: readOnly,
      description: "One student's guide exactly as they see it (the base guide filtered to their verses, their own additions, their theme ticks), plus the assignment id and revision save_student_guide binds to.",
      inputSchema: closed({ studentId, kind }, ["studentId", "kind"]),
      handler: async (input, ctx) => ctx.guides.rabbiStudentGuide(rabbiAuthority(ctx), input as never),
    },
    {
      name: "save_student_guide", roles: ["admin"], scope: SCOPES.study, annotations: write, deadlineMs: 55_000,
      description: "Save a new version of one student's own additions, bound to their current assignment (from get_student_guide). Notes only on that student's verses.",
      inputSchema: closed({ studentId, kind, assignmentId: str("From get_student_guide.", { pattern: UUID_PATTERN }), assignmentRevision: { type: "integer", minimum: 1, maximum: 1000000, description: "From get_student_guide." },
        expectedVersion, body: additionsBody, origin, reviewed, mutationId }, ["studentId", "kind", "assignmentId", "assignmentRevision", "expectedVersion", "body", "origin", "reviewed", "mutationId"]),
      handler: async (input, ctx) => { requireStudy(ctx); return routineOrigin(ctx, input) ?? outcome(await ctx.guides.setStudentGuide(rabbiAuthority(ctx), input as never)); },
    },
    ...createRosterTools<Q>(),
    ...createSetupTools<Q>(),
    ...createPrintTools<Q>(),
    ...createStudyTools<Q>(),
    ...createSavedTools<Q>(),
    ...createAnalyticsTools<Q>(),
    ...createDiscussionTools<Q>(),
    ...createPortionSummaryTools<Q>(),
  ] satisfies Tool<Q>[]);
}

/** Contiguous runs of a page's verses as canonical ranges ("Numbers 1:1-1:25"). */
function rangesOf(verses: readonly string[]): string[] {
  const parse = (ref: string) => { const m = /^(.+) (\d+):(\d+)$/.exec(ref); if (!m) throw new AccessDenied(404); return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) }; };
  const follows = (a: ReturnType<typeof parse>, b: ReturnType<typeof parse>) => a.book === b.book && ((b.chapter === a.chapter && b.verse === a.verse + 1)
    || (b.chapter === a.chapter + 1 && b.verse === 1 && a.verse === TANAKH_VERSE_COUNTS[a.book]?.[a.chapter - 1]));
  const ranges: string[] = [];
  let start = parse(verses[0]), end = start;
  const flush = () => ranges.push(`${start.book} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`);
  for (const ref of verses.slice(1)) { const next = parse(ref); if (follows(end, next)) end = next; else { flush(); start = end = next; } }
  flush();
  return ranges;
}
