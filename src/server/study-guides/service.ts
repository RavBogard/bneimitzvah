import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { confirmedReadings } from "../data/portal";
import { readingView } from "../portal/service";
import * as data from "../data/study-guides";
import type { ProgressActor } from "../data/progress";
import * as s from "../db/index";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { haftarahRefForKey } from "../../lib/readings/reading-key";
import { plain, validateGuideBody, validateVoice, type GuideBody, type GuideNote, type GuideTheme } from "./validation";
import { STARTER_VOICE } from "./starter-voice";

export type GuideKind = data.GuideKind;
export type RabbiWriter = data.RabbiWriter;
/**
 * Establishes the rabbi inside one tenant transaction and re-locks their live admin grant there.
 * `live` throws once the carrying authority (an MCP token, a session) has expired.
 */
export type RabbiAuthority<Q extends PgQueryResultHKT> = {
  run<T>(action: (tx: AccessTransaction<Q>, writer: RabbiWriter, live: () => void) => Promise<T>): Promise<T>;
};
/**
 * Checks what only the outside world can: every source id is a Sefaria link the server resolves
 * for that verse, and every note's verse is one of `verses` (the reading's passage for a base
 * guide, the student's assigned verses for additions). Runs outside any transaction. Returns the
 * body with server-resolved source metadata, never the caller's.
 */
export type GuideChecker = (input: { kind: GuideKind; readingKey: string | null; studentId: string | null; verses: ReadonlySet<string>; body: GuideBody }) =>
  Promise<{ ok: true; body: GuideBody } | { ok: false; problems: string[] }>;

export type GuideVersion = Readonly<{ version: number; origin: "claude" | "rabbi"; reviewed: boolean; hold: boolean; body: GuideBody; createdAt: string }>;
export type GuideLabel = Readonly<{ origin: "claude" | "rabbi"; reviewed: boolean; rabbiName: string }>;
export type StudentTheme = Readonly<{ id: string; title: string; intro: string; notes: readonly GuideNote[]; read: boolean; readVersion: number }>;
export type StudentGuideView = Readonly<{
  kind: GuideKind; readingKey: string | null; tickable: boolean;
  base: Readonly<{ version: number; label: GuideLabel; overview: string; themes: readonly StudentTheme[]; updatedAt: string }> | null;
  additions: Readonly<{ version: number; label: GuideLabel; themes: readonly StudentTheme[]; updatedAt: string }> | null;
}>;
type FailureCode = "conflict" | "no-change" | "invalid" | "review-not-permitted" | "channel-not-permitted" | "stale-assignment" | "not-held" | "no-reading";
type Failure = Readonly<{ ok: false; code: FailureCode; problems?: readonly string[] }>;
export type GuideSaveResult = Failure | Readonly<{ ok: true; replayed: boolean; version: number; held: boolean; heldBecauseReviewed?: boolean }>;
export type VersionSaveResult = Failure | Readonly<{ ok: true; replayed: boolean; version: number }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A per-student addition's theme is shown and ticked as student--<id>; a base theme id can never contain "--". */
export const ADDITION_PREFIX = "student--";
const THEME_TICK = /^(?:student--)?[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fail = (code: FailureCode, problems?: readonly string[]): Failure => Object.freeze({ ok: false, code, ...(problems ? { problems: Object.freeze([...problems]) } : {}) });
const invalid = (problems: readonly string[]) => fail("invalid", problems);
/** Key-sorted JSON so a body compares equal after jsonb has reordered its keys. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (parts: unknown) => createHash("sha256").update(canonical(parts)).digest("hex");
const kindOf = (value: unknown): GuideKind => { if (value !== "torah" && value !== "haftarah") throw new AccessDenied(403); return value; };
const keyOf = (value: unknown): string => { if (typeof value !== "string" || value.length > 160 || !SLUG.test(value)) throw new AccessDenied(403); return value; };
const versionOf = (value: unknown): number => { if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 2147483646) throw new AccessDenied(403); return value as number; };
const mutationOf = (value: unknown): string => { if (typeof value !== "string" || !UUID.test(value)) throw new AccessDenied(403); return value.toLowerCase(); };
const originOf = (value: unknown): "claude" | "rabbi" => { if (value !== "claude" && value !== "rabbi") throw new AccessDenied(403); return value; };
const bool = (value: unknown): boolean => { if (typeof value !== "boolean") throw new AccessDenied(403); return value; };

export function guideVersion(row: data.GuideRow | data.StudentGuideRow): GuideVersion {
  const allowOverview = "readingKey" in row, checked = validateGuideBody(row.body, { allowOverview });
  if (!checked.ok || (row.origin !== "claude" && row.origin !== "rabbi")) throw new Error("Study guide unavailable");
  return Object.freeze({ version: row.version, origin: row.origin, reviewed: row.reviewed, hold: "hold" in row ? row.hold : false, body: checked.value, createdAt: row.createdAt.toISOString() });
}
/** The service's own backstop: whatever a checker returns, no note may sit outside the allowed verses. */
const versesOutside = (body: GuideBody, verses: ReadonlySet<string>) =>
  body.themes.flatMap(t => t.notes.filter(n => !verses.has(n.verseRef)).map(n => `${n.verseRef} is not in this reading`));
/** A stored version that no longer passes today's rules is withheld, not served and not an error. */
const servable = (row: data.GuideRow | data.StudentGuideRow | null) => { if (!row) return null; try { return guideVersion(row); } catch { return null; } };
export function rabbiName(customs: unknown): string {
  const credits = customs && typeof customs === "object" ? (customs as Record<string, unknown>).credits : undefined;
  const name = credits && typeof credits === "object" ? (credits as Record<string, unknown>).rabbiDisplayName : undefined;
  return plain(name, 320) && [...name].length <= 80 ? name : "the rabbi";
}
/** Notes outside the student's verses are hidden; a theme whose every note is hidden disappears. */
export function themesFor(themes: readonly GuideTheme[], verses: ReadonlySet<string>, reads: ReadonlyMap<string, { state: string; version: number }>, prefix = ""): StudentTheme[] {
  return themes.flatMap(source => {
    const theme = { ...source, id: prefix + source.id };
    const notes = theme.notes.filter(note => verses.has(note.verseRef));
    if (theme.notes.length > 0 && notes.length === 0) return [];
    const tick = reads.get(theme.id);
    return [Object.freeze({ id: theme.id, title: theme.title, intro: theme.intro, notes: Object.freeze(notes), read: tick?.state === "read", readVersion: tick?.version ?? 0 })];
  });
}

export function createStudyGuideService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; check: GuideChecker;
}) {
  async function customsOf(tx: AccessTransaction<Q>, tenantId: string) {
    const [row] = await tx.select({ customs: s.tenant.customs }).from(s.tenant).where(eq(s.tenant.id, tenantId)).limit(1);
    return row?.customs;
  }
  /** The verses a base guide for this reading may annotate. */
  async function passage(tx: AccessTransaction<Q>, tenantId: string, kind: GuideKind, readingKey: string): Promise<Set<string>> {
    if (kind === "haftarah") {
      const ref = haftarahRefForKey(readingKey, TANAKH_VERSE_COUNTS);
      return new Set(ref ? expandReadingRanges([ref], "haftarah", TANAKH_VERSE_COUNTS) : []);
    }
    return data.torahPassageVerses(tx, tenantId, readingKey, TANAKH_VERSE_COUNTS);
  }

  // Voice ----------------------------------------------------------------------------------------
  async function getVoice(authority: RabbiAuthority<Q>) {
    return authority.run(async (tx, writer) => {
      const head = await data.voiceHead(tx, writer.tenantId);
      return Object.freeze(head ? { version: head.version, body: head.body, template: false } : { version: 0, body: STARTER_VOICE, template: true });
    });
  }
  async function setVoice(authority: RabbiAuthority<Q>, supplied: { expectedVersion: unknown; body: unknown; mutationId: unknown }): Promise<VersionSaveResult> {
    const expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId), checked = validateVoice(supplied.body);
    if (!checked.ok) return invalid(checked.problems);
    const body = checked.value, requestDigest = digest(["study-voice/v1", expected, body]);
    const replay = (row: data.VoiceRow) => row.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: row.version }) : fail("conflict");
    return authority.run(async (tx, writer, live) => {
      // Only the rabbi in Cowork shapes the voice; the operator bridge writes Claude drafts only.
      if (writer.channel !== "mcp") return fail("channel-not-permitted");
      const prior = await data.voiceReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      const head = await data.voiceHead(tx, writer.tenantId);
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      if (head && head.body === body) return fail("no-change");
      live(); const row = await data.appendVoice(tx, writer, expected, body, mutationId, requestDigest); live();
      if (row) return Object.freeze({ ok: true as const, replayed: false, version: row.version });
      const raced = await data.voiceReceipt(tx, writer, mutationId); return raced ? replay(raced) : fail("conflict");
    });
  }

  // Base guide -----------------------------------------------------------------------------------
  async function getBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey);
    return authority.run(async (tx, writer) => {
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      const visible = servable(heads.visible), head = servable(heads.head);
      return Object.freeze({ kind, readingKey, currentVersion: heads.head?.version ?? 0, visible, held: head?.hold ? head : null });
    });
  }
  async function setBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown; expectedVersion: unknown; body: unknown; origin: unknown; reviewed: unknown; hold: unknown; mutationId: unknown }): Promise<GuideSaveResult> {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey), expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId);
    const origin = originOf(supplied.origin), reviewed = bool(supplied.reviewed), hold = bool(supplied.hold);
    const shape = validateGuideBody(supplied.body, { allowOverview: true });
    if (!shape.ok) return invalid(shape.problems);
    const requestDigest = digest(["study-guide/v1", kind, readingKey, expected, origin, reviewed, hold, shape.value]);
    const replay = (row: data.GuideRow) => row.requestDigest === requestDigest && row.kind === kind && row.readingKey === readingKey
      ? Object.freeze({ ok: true as const, replayed: true, version: row.version, held: row.hold }) : fail("conflict");
    const permitted = (writer: RabbiWriter) => reviewed && !writer.mayReview ? fail("review-not-permitted")
      : writer.channel === "operator" && origin !== "claude" ? fail("channel-not-permitted") : null;
    // Phase 1: authority, receipt and version, before any network work.
    const first = await authority.run(async (tx, writer) => {
      const refused = permitted(writer); if (refused) return refused;
      const prior = await data.guideReceipt(tx, writer, mutationId); if (prior) return { step: "done" as const, result: replay(prior) };
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      if ((heads.head?.version ?? 0) !== expected) return fail("conflict");
      const verses = await passage(tx, writer.tenantId, kind, readingKey);
      return verses.size ? { step: "check" as const, verses } : fail("no-reading");
    });
    if ("ok" in first) return first;
    if (first.step === "done") return first.result;
    // Phase 2: citations and verses are resolved by the server, outside the transaction.
    const resolved = await input.check({ kind, readingKey, studentId: null, verses: first.verses, body: shape.value });
    if (!resolved.ok) return invalid(resolved.problems);
    const recheck = validateGuideBody(resolved.body, { allowOverview: true });
    if (!recheck.ok) return invalid(recheck.problems);
    const body = recheck.value, outside = versesOutside(body, first.verses);
    if (outside.length) return invalid(outside);
    // Phase 3: re-establish authority and recheck everything before appending.
    return authority.run(async (tx, writer, live) => {
      const refused = permitted(writer); if (refused) return refused;
      const prior = await data.guideReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      if ((heads.head?.version ?? 0) !== expected) return fail("conflict");
      // S25: a draft never replaces reviewed work on its own; it waits for publish_guide.
      const effectiveHold = hold || (!reviewed && heads.anyReviewed);
      if (heads.head && canonical(heads.head.body) === canonical(body) && heads.head.origin === origin && heads.head.reviewed === reviewed && heads.head.hold === effectiveHold) return fail("no-change");
      live();
      const row = await data.appendGuide(tx, writer, { kind, readingKey, expected, origin, reviewed, hold: effectiveHold, body, mutationId, digest: requestDigest, publish: false });
      live();
      if (!row) { const raced = await data.guideReceipt(tx, writer, mutationId); return raced ? replay(raced) : fail("conflict"); }
      return Object.freeze({ ok: true as const, replayed: false, version: row.version, held: row.hold, heldBecauseReviewed: effectiveHold && !hold });
    });
  }
  async function publishBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown; version: unknown; mutationId: unknown }): Promise<GuideSaveResult> {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey), version = versionOf(supplied.version), mutationId = mutationOf(supplied.mutationId);
    const requestDigest = digest(["study-guide-publish/v1", kind, readingKey, version]);
    const replay = (row: data.GuideRow) => row.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: row.version, held: false }) : fail("conflict");
    return authority.run(async (tx, writer, live) => {
      // Publishing is a review act: it can put a draft in front of reviewed work.
      if (!writer.mayReview || writer.channel !== "mcp") return fail("review-not-permitted");
      const prior = await data.guideReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      if (!heads.head || heads.head.version !== version) return fail("conflict");
      if (!heads.head.hold) return fail("not-held");
      const held = servable(heads.head);
      if (!held) return invalid(["The held version no longer meets the guide rules; save a corrected version instead."]);
      live();
      const row = await data.appendGuide(tx, writer, { kind, readingKey, expected: version, origin: held.origin, reviewed: held.reviewed, hold: false, body: held.body, mutationId, digest: requestDigest, publish: true });
      live();
      if (row) return Object.freeze({ ok: true as const, replayed: false, version: row.version, held: false });
      const raced = await data.guideReceipt(tx, writer, mutationId); return raced ? replay(raced) : fail("conflict");
    });
  }

  // Per-student additions ------------------------------------------------------------------------
  async function setStudentGuide(authority: RabbiAuthority<Q>, supplied: { studentId: unknown; kind: unknown; assignmentId: unknown; assignmentRevision: unknown; expectedVersion: unknown; body: unknown; origin: unknown; reviewed: unknown; mutationId: unknown }): Promise<VersionSaveResult> {
    if (typeof supplied.studentId !== "string" || !UUID.test(supplied.studentId) || typeof supplied.assignmentId !== "string" || !UUID.test(supplied.assignmentId)) throw new AccessDenied(404);
    const studentId = supplied.studentId.toLowerCase(), assignmentId = supplied.assignmentId.toLowerCase(), kind = kindOf(supplied.kind);
    const assignmentRevision = versionOf(supplied.assignmentRevision), expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId);
    const origin = originOf(supplied.origin), reviewed = bool(supplied.reviewed);
    if (assignmentRevision < 1) throw new AccessDenied(403);
    const shape = validateGuideBody(supplied.body, { allowOverview: false });
    if (!shape.ok) return invalid(shape.problems);
    const requestDigest = digest(["study-guide-student/v1", studentId, kind, assignmentId, assignmentRevision, expected, origin, reviewed, shape.value]);
    const replay = (row: data.StudentGuideRow) => row.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: row.version }) : fail("conflict");
    /** The student's current confirmed reading of this kind, if it is still the bound revision. */
    const current = async (tx: AccessTransaction<Q>, writer: RabbiWriter) => {
      const [student] = await tx.select({ id: s.student.id, disabledAt: s.student.disabledAt, ceremonyDate: s.student.ceremonyDate }).from(s.student)
        .where(and(eq(s.student.tenantId, writer.tenantId), eq(s.student.id, studentId))).for("share");
      if (!student || student.disabledAt) throw new AccessDenied(404);
      const row = (await confirmedReadings(tx, writer.tenantId, studentId)).find(r => r.kind === kind);
      if (!row || row.id !== assignmentId || row.revision !== assignmentRevision) return null;
      return readingView(row, student.ceremonyDate);
    };
    const guard = async (tx: AccessTransaction<Q>, writer: RabbiWriter) => {
      if (writer.channel !== "mcp") return fail("channel-not-permitted");
      if (reviewed && !writer.mayReview) return fail("review-not-permitted");
      const prior = await data.studentGuideReceipt(tx, writer, mutationId); if (prior) return { step: "done" as const, result: replay(prior) };
      const reading = await current(tx, writer); if (!reading) return fail("stale-assignment");
      const head = await data.studentGuideHead(tx, writer.tenantId, studentId, assignmentId, assignmentRevision, kind);
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      // S25 for additions: there is no held state here, so a routine cannot write over reviewed additions at all.
      if (!reviewed && !writer.mayReview && await data.studentGuideAnyReviewed(tx, writer.tenantId, studentId, assignmentId, assignmentRevision, kind)) return fail("review-not-permitted");
      return { step: "check" as const, head, verses: new Set(reading.verses) };
    };
    const first = await authority.run(guard);
    if ("ok" in first) return first;
    if (first.step === "done") return first.result;
    const resolved = await input.check({ kind, readingKey: null, studentId, verses: first.verses, body: shape.value });
    if (!resolved.ok) return invalid(resolved.problems);
    const recheck = validateGuideBody(resolved.body, { allowOverview: false });
    if (!recheck.ok) return invalid(recheck.problems);
    const outside = versesOutside(recheck.value, first.verses);
    if (outside.length) return invalid(outside);
    return authority.run(async (tx, writer, live) => {
      const checked = await guard(tx, writer);
      if ("ok" in checked) return checked;
      if (checked.step === "done") return checked.result;
      const head = checked.head;
      if (head && canonical(head.body) === canonical(recheck.value) && head.origin === origin && head.reviewed === reviewed) return fail("no-change");
      live();
      const row = await data.appendStudentGuide(tx, writer, { studentId, assignmentId, assignmentRevision, kind, expected, origin, reviewed, body: recheck.value, mutationId, digest: requestDigest });
      live();
      if (row) return Object.freeze({ ok: true as const, replayed: false, version: row.version });
      const raced = await data.studentGuideReceipt(tx, writer, mutationId); return raced ? replay(raced) : fail("conflict");
    });
  }

  // Student, parent and staff reading ------------------------------------------------------------
  type Mode = "student" | "parent" | "tutor" | "admin" | "child-practice";
  async function readAs<T>(request: AccessRequest, selection: { mode: Mode; studentId: string }, action: (tx: AccessTransaction<Q>, actor: ProgressActor) => Promise<T>) {
    if (!["student", "parent", "tutor", "admin", "child-practice"].includes(selection.mode)) throw new AccessDenied(403);
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: "child-practice", studentId: selection.studentId, capability: "read" }, action)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, action);
  }
  async function viewFor(tx: AccessTransaction<Q>, actor: ProgressActor, kind: GuideKind): Promise<StudentGuideView | null> {
    const [student] = await tx.select({ ceremonyDate: s.student.ceremonyDate }).from(s.student).where(and(eq(s.student.tenantId, actor.tenantId), eq(s.student.id, actor.studentId))).limit(1);
    if (!student) throw new AccessDenied(404);
    const row = (await confirmedReadings(tx, actor.tenantId, actor.studentId)).find(r => r.kind === kind);
    if (!row) return null;
    const reading = readingView(row, student.ceremonyDate), verses = new Set(reading.verses), name = rabbiName(await customsOf(tx, actor.tenantId));
    const tickable = actor.mode === "student" || actor.mode === "child-practice";
    const base = reading.readingKey ? servable((await data.guideHeads(tx, actor.tenantId, kind, reading.readingKey)).visible) : null;
    const additions = servable(await data.studentGuideHead(tx, actor.tenantId, actor.studentId, reading.id, reading.revision, kind));
    if (!base && !additions) return null;
    const reads = new Map((reading.readingKey ? await data.themeReads(tx, actor.tenantId, actor.studentId, kind, reading.readingKey) : []).map(r => [r.themeId, r]));
    return Object.freeze({
      kind, readingKey: reading.readingKey, tickable: tickable && !!reading.readingKey,
      base: base ? Object.freeze({ version: base.version, label: Object.freeze({ origin: base.origin, reviewed: base.reviewed, rabbiName: name }), overview: base.body.overview ?? "",
        themes: Object.freeze(themesFor(base.body.themes, verses, reads)), updatedAt: base.createdAt }) : null,
      additions: additions ? Object.freeze({ version: additions.version, label: Object.freeze({ origin: additions.origin, reviewed: additions.reviewed, rabbiName: name }),
        themes: Object.freeze(themesFor(additions.body.themes, verses, reads, ADDITION_PREFIX)), updatedAt: additions.createdAt }) : null,
    });
  }
  async function studentGuide(request: AccessRequest, selection: { mode: Mode; studentId: string; kind: unknown }) {
    const kind = kindOf(selection.kind);
    return readAs(request, selection, (tx, actor) => viewFor(tx, actor, kind));
  }
  /** The Shabbat this reading is for, as the signed calendar snapshot recorded it; for the haftarah sheet link. */
  async function readingDate(request: AccessRequest, selection: { mode: Mode; studentId: string; kind: unknown }) {
    const kind = kindOf(selection.kind);
    return readAs(request, selection, async (tx, actor) => {
      const [student] = await tx.select({ ceremonyDate: s.student.ceremonyDate }).from(s.student).where(and(eq(s.student.tenantId, actor.tenantId), eq(s.student.id, actor.studentId))).limit(1);
      const row = student ? (await confirmedReadings(tx, actor.tenantId, actor.studentId)).find(r => r.kind === kind) : undefined;
      return row ? readingView(row, student!.ceremonyDate).source.date : null;
    });
  }
  async function setThemeRead(request: AccessRequest, selection: { mode: Mode; studentId: string; kind: unknown; readingKey: unknown; themeId: unknown; read: unknown; expectedVersion: unknown }) {
    const kind = kindOf(selection.kind), readingKey = keyOf(selection.readingKey), read = bool(selection.read), expected = versionOf(selection.expectedVersion);
    if (typeof selection.themeId !== "string" || selection.themeId.length > 73 || !THEME_TICK.test(selection.themeId)) throw new AccessDenied(403);
    const themeId = selection.themeId;
    // Only the learner ticks, alone or in a parent's child-practice session (never parent overview or staff).
    if (selection.mode !== "student" && selection.mode !== "child-practice") throw new AccessDenied(403);
    return input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "practice-write" }, async (tx, actor) => {
      const view = await viewFor(tx, actor, kind);
      if (!view || view.readingKey !== readingKey) return fail("stale-assignment");
      const known = [...(view.base?.themes ?? []), ...(view.additions?.themes ?? [])].some(t => t.id === themeId);
      if (!known) throw new AccessDenied(404);
      const head = await data.lockThemeRead(tx, actor, kind, readingKey, themeId), state = read ? "read" as const : "unread" as const;
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      if ((head?.state ?? "unread") === state) return Object.freeze({ ok: true as const, themeId, read, version: head?.version ?? 0 });
      if (expected >= 2147483646) return fail("conflict");
      const changed = await data.changeThemeRead(tx, actor, { kind, readingKey, themeId, state, expected }, !!head);
      return changed ? Object.freeze({ ok: true as const, themeId, read, version: changed.version }) : fail("conflict");
    });
  }

  // Rabbi's web status and preview (cookie, admin mode, read only; S10) --------------------------
  async function staffGuide(request: AccessRequest, supplied: { kind: unknown; readingKey: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey);
    return input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, async (tx, actor) => {
      const heads = await data.guideHeads(tx, actor.tenantId, kind, readingKey);
      const summary = (row: data.GuideRow | null) => { const v = servable(row);
        return v && row ? Object.freeze({ version: v.version, origin: v.origin, reviewed: v.reviewed, hold: v.hold, themes: v.body.themes.length, updatedAt: v.createdAt }) : null; };
      return Object.freeze({ kind, readingKey, rabbiName: rabbiName(await customsOf(tx, actor.tenantId)), visible: summary(heads.visible), held: heads.head?.hold ? summary(heads.head) : null });
    });
  }
  async function staffVoice(request: AccessRequest) {
    return input.access.withAdminCapability(request, { mode: "admin", capability: "read-guides" }, async (tx, actor) => {
      const head = await data.voiceHead(tx, actor.tenantId);
      return Object.freeze(head ? { version: head.version, template: false, updatedAt: head.createdAt.toISOString() } : { version: 0, template: true, updatedAt: null });
    });
  }
  // Rabbi reads for the MCP --------------------------------------------------------------------
  /** Every current student's confirmed readings grouped by guide key: the "what needs a guide" list. */
  async function guideWork(authority: RabbiAuthority<Q>) {
    return authority.run(async (tx, writer) => {
      const students = await tx.select({ id: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, ceremonyDate: s.student.ceremonyDate })
        .from(s.student).where(and(eq(s.student.tenantId, writer.tenantId), isNull(s.student.disabledAt))).orderBy(asc(s.student.ceremonyDate), asc(s.student.id)).limit(500);
      const groups = new Map<string, { kind: GuideKind; readingKey: string; students: { id: string; name: string; ceremonyDate: string; hasAdditions: boolean }[] }>();
      const unkeyed: { studentId: string; name: string; kind: GuideKind; ceremonyDate: string; hasAdditions: boolean }[] = [];
      for (const student of students) {
        for (const row of await confirmedReadings(tx, writer.tenantId, student.id)) {
          let reading; try { reading = readingView(row, student.ceremonyDate); } catch { continue; }
          const hasAdditions = !!(await data.studentGuideHead(tx, writer.tenantId, student.id, reading.id, reading.revision, reading.kind));
          const name = `${student.firstName} ${student.lastName}`;
          if (!reading.readingKey) { unkeyed.push({ studentId: student.id, name, kind: reading.kind, ceremonyDate: student.ceremonyDate, hasAdditions }); continue; }
          const id = `${reading.kind}:${reading.readingKey}`;
          const group = groups.get(id) ?? { kind: reading.kind, readingKey: reading.readingKey, students: [] };
          group.students.push({ id: student.id, name, ceremonyDate: student.ceremonyDate, hasAdditions }); groups.set(id, group);
        }
      }
      const work = [];
      for (const group of groups.values()) {
        const heads = await data.guideHeads(tx, writer.tenantId, group.kind, group.readingKey);
        work.push(Object.freeze({ kind: group.kind, readingKey: group.readingKey, studentCount: group.students.length,
          base: heads.head ? Object.freeze({ currentVersion: heads.head.version, visibleVersion: heads.visible?.version ?? null, reviewed: heads.visible?.reviewed ?? false, heldDraft: heads.head.hold }) : null,
          students: Object.freeze(group.students.map(x => Object.freeze(x))) }));
      }
      return Object.freeze({ work: Object.freeze(work), customReadings: Object.freeze(unkeyed.map(x => Object.freeze(x))) });
    });
  }
  /** The verses a base guide for this reading may annotate, in reading order. */
  async function guidePassage(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey);
    return authority.run(async (tx, writer) => Object.freeze({ kind, readingKey, verses: Object.freeze([...(await passage(tx, writer.tenantId, kind, readingKey))]) }));
  }
  /** One student's guide exactly as that student sees it (ticks included), plus the assignment it binds to. */
  async function rabbiStudentGuide(authority: RabbiAuthority<Q>, supplied: { studentId: unknown; kind: unknown }) {
    const kind = kindOf(supplied.kind);
    if (typeof supplied.studentId !== "string" || !UUID.test(supplied.studentId)) throw new AccessDenied(404);
    const studentId = supplied.studentId;
    return authority.run(async (tx, writer) => {
      const [student] = await tx.select({ ceremonyDate: s.student.ceremonyDate }).from(s.student).where(and(eq(s.student.tenantId, writer.tenantId), eq(s.student.id, studentId), isNull(s.student.disabledAt))).limit(1);
      if (!student) throw new AccessDenied(404);
      const row = (await confirmedReadings(tx, writer.tenantId, studentId)).find(r => r.kind === kind);
      const reading = row ? readingView(row, student.ceremonyDate) : null;
      const view = reading ? await viewFor(tx, { tenantId: writer.tenantId, studentId, mode: "admin" } as unknown as ProgressActor, kind) : null;
      return Object.freeze({ studentId, kind, assignment: reading ? Object.freeze({ assignmentId: reading.id, assignmentRevision: reading.revision, readingKey: reading.readingKey, verses: reading.verses }) : null, view });
    });
  }
  return Object.freeze({ getVoice, setVoice, getBaseGuide, setBaseGuide, publishBaseGuide, setStudentGuide, studentGuide, readingDate, setThemeRead, staffGuide, staffVoice, guideWork, guidePassage, rabbiStudentGuide });
}

/** The only part the web HTTP runtime receives: reads, theme ticks and staff status. No guide or voice writes (S10). */
export function studyGuideWebSurface<Q extends PgQueryResultHKT>(service: ReturnType<typeof createStudyGuideService<Q>>) {
  return Object.freeze({ studentGuide: service.studentGuide, readingDate: service.readingDate, setThemeRead: service.setThemeRead, staffGuide: service.staffGuide, staffVoice: service.staffVoice });
}
