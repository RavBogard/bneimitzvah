import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
 * for that verse, every verse is inside the reading. Runs outside any transaction. Returns the
 * body with server-resolved source metadata, never the caller's.
 */
export type GuideChecker = (input: { kind: GuideKind; readingKey: string | null; studentId: string | null; body: GuideBody }) =>
  Promise<{ ok: true; body: GuideBody } | { ok: false; problems: string[] }>;

export type GuideVersion = Readonly<{ version: number; origin: "claude" | "rabbi"; reviewed: boolean; hold: boolean; body: GuideBody; createdAt: string }>;
export type GuideLabel = Readonly<{ origin: "claude" | "rabbi"; reviewed: boolean; rabbiName: string }>;
export type StudentTheme = Readonly<{ id: string; title: string; intro: string; notes: readonly GuideNote[]; read: boolean; readVersion: number }>;
export type StudentGuideView = Readonly<{
  kind: GuideKind; readingKey: string | null; tickable: boolean;
  base: Readonly<{ version: number; label: GuideLabel; overview: string; themes: readonly StudentTheme[]; updatedAt: string }> | null;
  additions: Readonly<{ version: number; label: GuideLabel; themes: readonly StudentTheme[]; updatedAt: string }> | null;
}>;
type Failure = Readonly<{ ok: false; code: "conflict" | "no-change" | "invalid" | "review-not-permitted" | "stale-assignment" | "not-held"; problems?: readonly string[] }>;
type Committed<T> = Readonly<{ ok: true; replayed: boolean; held?: boolean } & T>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fail = (code: Failure["code"], problems?: readonly string[]): Failure => Object.freeze({ ok: false, code, ...(problems ? { problems: Object.freeze([...problems]) } : {}) });
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
export function rabbiName(customs: unknown): string {
  const credits = customs && typeof customs === "object" ? (customs as Record<string, unknown>).credits : undefined;
  const name = credits && typeof credits === "object" ? (credits as Record<string, unknown>).rabbiDisplayName : undefined;
  return plain(name, 320) && [...name].length <= 80 ? name : "the rabbi";
}
/** Notes outside the student's verses are hidden; a theme whose every note is hidden disappears. */
export function themesFor(themes: readonly GuideTheme[], verses: ReadonlySet<string>, reads: ReadonlyMap<string, { state: string; version: number }>): StudentTheme[] {
  return themes.flatMap(theme => {
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

  // Voice ----------------------------------------------------------------------------------------
  async function getVoice(authority: RabbiAuthority<Q>) {
    return authority.run(async (tx, writer) => {
      const head = await data.voiceHead(tx, writer.tenantId);
      return Object.freeze(head ? { version: head.version, body: head.body, template: false } : { version: 0, body: STARTER_VOICE, template: true });
    });
  }
  async function setVoice(authority: RabbiAuthority<Q>, supplied: { expectedVersion: unknown; body: unknown; mutationId: unknown }) {
    const expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId), checked = validateVoice(supplied.body);
    if (!checked.ok) return invalid(checked.problems);
    const body = checked.value, requestDigest = digest(["study-voice/v1", expected, body]);
    return authority.run(async (tx, writer, live) => {
      const prior = await data.voiceReceipt(tx, writer, mutationId);
      if (prior) return prior.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: prior.version }) : fail("conflict");
      const head = await data.voiceHead(tx, writer.tenantId);
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      if (head && head.body === body) return fail("no-change");
      live(); const row = await data.appendVoice(tx, writer, expected, body, mutationId, requestDigest); live();
      return row ? Object.freeze({ ok: true as const, replayed: false, version: row.version }) : fail("conflict");
    });
  }

  // Base guide -----------------------------------------------------------------------------------
  async function getBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey);
    return authority.run(async (tx, writer) => {
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      const visible = heads.visible ? guideVersion(heads.visible) : null, head = heads.head ? guideVersion(heads.head) : null;
      return Object.freeze({ kind, readingKey, currentVersion: head?.version ?? 0, visible, held: head?.hold ? head : null });
    });
  }
  async function setBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown; expectedVersion: unknown; body: unknown; origin: unknown; reviewed: unknown; hold: unknown; mutationId: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey), expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId);
    const origin = originOf(supplied.origin), reviewed = bool(supplied.reviewed), hold = bool(supplied.hold);
    const shape = validateGuideBody(supplied.body, { allowOverview: true });
    if (!shape.ok) return invalid(shape.problems);
    const requestDigest = digest(["study-guide/v1", kind, readingKey, expected, origin, reviewed, hold, shape.value]);
    const replay = (row: data.GuideRow) => row.requestDigest === requestDigest && row.kind === kind && row.readingKey === readingKey
      ? Object.freeze({ ok: true as const, replayed: true, version: row.version, held: row.hold }) : fail("conflict");
    // Phase 1: authority, receipt and version, before any network work.
    const first = await authority.run(async (tx, writer) => {
      if (reviewed && !writer.mayReview) return fail("review-not-permitted");
      const prior = await data.guideReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      if ((heads.head?.version ?? 0) !== expected) return fail("conflict");
      return null;
    });
    if (first) return first;
    // Phase 2: citations and verses are resolved by the server, outside the transaction.
    const resolved = await input.check({ kind, readingKey, studentId: null, body: shape.value });
    if (!resolved.ok) return invalid(resolved.problems);
    const body = resolved.body, recheck = validateGuideBody(body, { allowOverview: true });
    if (!recheck.ok) return invalid(recheck.problems);
    // Phase 3: re-establish authority and recheck everything before appending.
    return authority.run(async (tx, writer, live) => {
      if (reviewed && !writer.mayReview) return fail("review-not-permitted");
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
  async function publishBaseGuide(authority: RabbiAuthority<Q>, supplied: { kind: unknown; readingKey: unknown; version: unknown; mutationId: unknown }) {
    const kind = kindOf(supplied.kind), readingKey = keyOf(supplied.readingKey), version = versionOf(supplied.version), mutationId = mutationOf(supplied.mutationId);
    const requestDigest = digest(["study-guide-publish/v1", kind, readingKey, version]);
    return authority.run(async (tx, writer, live) => {
      // Publishing is a review act: it can put a draft in front of reviewed work.
      if (!writer.mayReview) return fail("review-not-permitted");
      const prior = await data.guideReceipt(tx, writer, mutationId);
      if (prior) return prior.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: prior.version, held: false }) : fail("conflict");
      const heads = await data.guideHeads(tx, writer.tenantId, kind, readingKey);
      if (!heads.head || heads.head.version !== version) return fail("conflict");
      if (!heads.head.hold) return fail("not-held");
      const held = guideVersion(heads.head);
      live();
      const row = await data.appendGuide(tx, writer, { kind, readingKey, expected: version, origin: held.origin, reviewed: held.reviewed, hold: false, body: held.body, mutationId, digest: requestDigest, publish: true });
      live();
      return row ? Object.freeze({ ok: true as const, replayed: false, version: row.version, held: false }) : fail("conflict");
    });
  }

  // Per-student additions ------------------------------------------------------------------------
  async function setStudentGuide(authority: RabbiAuthority<Q>, supplied: { studentId: unknown; kind: unknown; assignmentId: unknown; assignmentRevision: unknown; expectedVersion: unknown; body: unknown; origin: unknown; reviewed: unknown; mutationId: unknown }) {
    if (typeof supplied.studentId !== "string" || !UUID.test(supplied.studentId) || typeof supplied.assignmentId !== "string" || !UUID.test(supplied.assignmentId)) throw new AccessDenied(404);
    const studentId = supplied.studentId.toLowerCase(), assignmentId = supplied.assignmentId.toLowerCase(), kind = kindOf(supplied.kind);
    const assignmentRevision = versionOf(supplied.assignmentRevision), expected = versionOf(supplied.expectedVersion), mutationId = mutationOf(supplied.mutationId);
    const origin = originOf(supplied.origin), reviewed = bool(supplied.reviewed);
    if (assignmentRevision < 1) throw new AccessDenied(403);
    const shape = validateGuideBody(supplied.body, { allowOverview: false });
    if (!shape.ok) return invalid(shape.problems);
    const requestDigest = digest(["study-guide-student/v1", studentId, kind, assignmentId, assignmentRevision, expected, origin, reviewed, shape.value]);
    const replay = (row: data.StudentGuideRow) => row.requestDigest === requestDigest ? Object.freeze({ ok: true as const, replayed: true, version: row.version }) : fail("conflict");
    const current = async (tx: AccessTransaction<Q>, writer: RabbiWriter) => {
      const [student] = await tx.select({ id: s.student.id, disabledAt: s.student.disabledAt }).from(s.student)
        .where(and(eq(s.student.tenantId, writer.tenantId), eq(s.student.id, studentId))).for("share");
      if (!student || student.disabledAt) throw new AccessDenied(404);
      const [reading] = await tx.select({ id: s.assignment.id, revision: s.assignment.revision, status: s.assignment.status }).from(s.assignment)
        .where(and(eq(s.assignment.tenantId, writer.tenantId), eq(s.assignment.studentId, studentId), eq(s.assignment.kind, kind))).for("share");
      return !!reading && reading.status === "confirmed" && reading.id === assignmentId && reading.revision === assignmentRevision;
    };
    const first = await authority.run(async (tx, writer) => {
      if (reviewed && !writer.mayReview) return fail("review-not-permitted");
      const prior = await data.studentGuideReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      if (!await current(tx, writer)) return fail("stale-assignment");
      const head = await data.studentGuideHead(tx, writer.tenantId, studentId, assignmentId, assignmentRevision, kind);
      return (head?.version ?? 0) !== expected ? fail("conflict") : null;
    });
    if (first) return first;
    const resolved = await input.check({ kind, readingKey: null, studentId, body: shape.value });
    if (!resolved.ok) return invalid(resolved.problems);
    const recheck = validateGuideBody(resolved.body, { allowOverview: false });
    if (!recheck.ok) return invalid(recheck.problems);
    return authority.run(async (tx, writer, live) => {
      if (reviewed && !writer.mayReview) return fail("review-not-permitted");
      const prior = await data.studentGuideReceipt(tx, writer, mutationId); if (prior) return replay(prior);
      if (!await current(tx, writer)) return fail("stale-assignment");
      const head = await data.studentGuideHead(tx, writer.tenantId, studentId, assignmentId, assignmentRevision, kind);
      if ((head?.version ?? 0) !== expected) return fail("conflict");
      if (head && canonical(head.body) === canonical(recheck.value) && head.origin === origin && head.reviewed === reviewed) return fail("no-change");
      live();
      const row = await data.appendStudentGuide(tx, writer, { studentId, assignmentId, assignmentRevision, kind, expected, origin, reviewed, body: recheck.value, mutationId, digest: requestDigest });
      live();
      return row ? Object.freeze({ ok: true as const, replayed: false, version: row.version }) : fail("conflict");
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
    const visible = reading.readingKey ? (await data.guideHeads(tx, actor.tenantId, kind, reading.readingKey)).visible : null;
    const extra = await data.studentGuideHead(tx, actor.tenantId, actor.studentId, reading.id, reading.revision, kind);
    if (!visible && !extra) return null;
    const reads = new Map((reading.readingKey ? await data.themeReads(tx, actor.tenantId, actor.studentId, kind, reading.readingKey) : []).map(r => [r.themeId, r]));
    const base = visible ? guideVersion(visible) : null, additions = extra ? guideVersion(extra) : null;
    return Object.freeze({
      kind, readingKey: reading.readingKey, tickable: tickable && !!reading.readingKey,
      base: base ? Object.freeze({ version: base.version, label: Object.freeze({ origin: base.origin, reviewed: base.reviewed, rabbiName: name }), overview: base.body.overview ?? "",
        themes: Object.freeze(themesFor(base.body.themes, verses, reads)), updatedAt: base.createdAt }) : null,
      additions: additions ? Object.freeze({ version: additions.version, label: Object.freeze({ origin: additions.origin, reviewed: additions.reviewed, rabbiName: name }),
        themes: Object.freeze(themesFor(additions.body.themes, verses, reads)), updatedAt: additions.createdAt }) : null,
    });
  }
  async function studentGuide(request: AccessRequest, selection: { mode: Mode; studentId: string; kind: unknown }) {
    const kind = kindOf(selection.kind);
    return readAs(request, selection, (tx, actor) => viewFor(tx, actor, kind));
  }
  async function setThemeRead(request: AccessRequest, selection: { mode: Mode; studentId: string; kind: unknown; readingKey: unknown; themeId: unknown; read: unknown; expectedVersion: unknown }) {
    const kind = kindOf(selection.kind), readingKey = keyOf(selection.readingKey), read = bool(selection.read), expected = versionOf(selection.expectedVersion);
    if (typeof selection.themeId !== "string" || selection.themeId.length > 64 || !SLUG.test(selection.themeId)) throw new AccessDenied(403);
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
  return Object.freeze({ getVoice, setVoice, getBaseGuide, setBaseGuide, publishBaseGuide, setStudentGuide, studentGuide, setThemeRead });
}
