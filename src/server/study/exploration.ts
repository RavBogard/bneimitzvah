import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessTransaction, StudentActor } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createPracticeService } from "../practice/service";
import type { PracticeActor } from "../practice/types";
import type { StudentView } from "../data/students";
import { confirmedReadings } from "../data/portal";
import { customs, studentReadingContext } from "../data/roster";
import { calendarCustoms } from "../students/service";
import { createBindings, digest } from "../students/bindings";
import { identifier } from "../students/validation";
import { validatedSnapshot } from "../students/preparation";
import { previewPages } from "../students/preview";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { readingDate } from "../../lib/readings/reading-date";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { proposeReading, ReadingUnavailable, type Calendar, type Snapshot } from "../../lib/readings/proposals";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "./types";

export type ExplorationMode = "student" | "child-practice" | "tutor" | "admin";
type Selection = { mode: ExplorationMode; studentId: string };
type Request = CookieMutationRequest & { signal?: AbortSignal };
const purpose = "reading-exploration";
const counts = TANAKH_VERSE_COUNTS;
const stale = () => ({ ok: false as const, code: "stale-revision" as const });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A proposal is a read scope, never a confirmed assignment or write capability. */
export function createReadingExplorationService<Q extends PgQueryResultHKT, Page extends StudyPage = StudyPage>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  signingSecret: string; now?: () => number;
  loadReading(date: string, calendar: Calendar): Promise<{ snapshot: Snapshot; fetchedAt: number }>;
  loadText(request: StudyRequest): Promise<Page>;
}) {
  const now = input.now ?? Date.now, bindings = createBindings(input.signingSecret, now);
  function time() { const t = now(); if (!Number.isSafeInteger(t) || t < 0) throw new AccessDenied(403); return t; }
  const connected = (request: Request) => { if (request.signal?.aborted) throw new StudyUnavailable("upstream"); };
  const fixed = (request: Request): Request => Object.freeze({ url: request.url, method: request.method, headers: new Headers(request.headers), signal: request.signal });
  function selection(value: Selection) {
    identifier(value.studentId);
    if (!["student", "child-practice", "tutor", "admin"].includes(value.mode)) throw new AccessDenied(403);
    return Object.freeze({ mode: value.mode, studentId: value.studentId });
  }
  async function capture(request: Request, args: Selection) {
    async function action(tx: AccessTransaction<Q>, actor: StudentActor | PracticeActor, student: StudentView) {
      connected(request); requireCookieMutation(request, actor.origin);
      const row = await studentReadingContext(tx, actor.tenantId, student.id);
      if (!row) throw new AccessDenied(404);
      const calendar = calendarCustoms(await customs(tx, actor.tenantId)).calendar;
      const assignment = (await confirmedReadings(tx, actor.tenantId, student.id)).find(reading => reading.kind === "torah");
      const context = "context" in actor ? actor.context : null;
      return { actor: { origin: actor.origin, tenantId: actor.tenantId, userId: actor.userId, authSessionId: actor.authSessionId,
        membershipId: actor.membershipId, authorityRevision: actor.authorityRevision, roleGrantId: actor.roleGrantId,
        roleGrantRevision: actor.roleGrantRevision, mode: actor.mode, relationshipId: actor.relationshipId, relationshipRevision: actor.relationshipRevision },
        sessionExpiresAt: actor.authSessionExpiresAt, context,
        studentId: student.id, studentRevision: student.revision, ceremonyDate: student.ceremonyDate,
        serviceSlot: row.serviceSlot, calendar, ...readingDate(student.ceremonyDate, row.serviceSlot),
        assignment: assignment ? { id: assignment.id, revision: assignment.revision } : null };
    }
    const result = args.mode === "child-practice"
      ? await input.practice.withPracticeCapability(request, { ...args, mode: "child-practice", capability: "read" }, action)
      : await input.access.withStudentCapability(request, { ...args, mode: args.mode, capability: "read" }, action);
    fence(request, result);
    return result;
  }
  type Context = Awaited<ReturnType<typeof capture>>;
  function fence(request: Request, context: Context, expiresAt?: number) {
    connected(request); const current = time();
    if (context.sessionExpiresAt <= current) throw new AccessDenied(401);
    if (context.context && Date.parse(context.context.expiresAt) <= current) throw new AccessDenied(404);
    if (expiresAt !== undefined && expiresAt <= current) throw new AccessDenied(403);
  }
  function freshSource(fetchedAt: number) {
    const current = time();
    if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0 || fetchedAt > current || current - fetchedAt >= 86400000) throw new AccessDenied(403);
  }
  const view = (context: Context, mode: ExplorationMode) => ({ studentId: context.studentId, studentRevision: context.studentRevision, mode,
    kind: "torah" as const, ceremonyDate: context.ceremonyDate, serviceSlot: context.serviceSlot,
    readingDate: context.readingDate, calendar: context.calendar });
  async function prepare(original: Request, supplied: Selection) {
    const request = fixed(original), args = selection(supplied), before = await capture(request, args);
    if (before.assignment) return { ok: true as const, status: "assigned" as const, ...view(before, args.mode), assignment: before.assignment };
    let reason: string | null = before.manualFallback, snapshot: Snapshot | null = null, fetchedAt: number | null = null;
    if (before.readingDate !== null) {
      try {
        const loaded = await input.loadReading(before.readingDate, before.calendar);
        freshSource(loaded.fetchedAt);
        snapshot = validatedSnapshot(loaded.snapshot, before.readingDate, before.calendar, counts); fetchedAt = loaded.fetchedAt;
        reason = snapshot.classification === "regular" ? null : snapshot.classification ?? "nonregular";
      } catch (error) {
        if (error instanceof ReadingUnavailable) reason = "calendar-source-unavailable";
        else throw error;
      }
    }
    connected(request);
    let ranges: string[] = [];
    if (reason === null && snapshot) {
      try { const proposal = proposeReading(snapshot, counts, { pick: "full" });
        if (proposal.selection) ranges = [proposal.selection.ref]; else reason = "missing";
      } catch { reason = "nonregular"; }
    }
    const planned = ranges.length ? previewPages(ranges, "torah") : null;
    const after = await capture(request, args);
    if (digest(before) !== digest(after)) return stale();
    if (fetchedAt !== null) freshSource(fetchedAt);
    if (!planned || fetchedAt === null) return { ok: true as const, status: "unresolved" as const, ...view(after, args.mode), reason: reason ?? "missing" };
    const binding = bindings.sign({ purpose, version: 1, context: after, ranges, fetchedAt, portion: snapshot!.reading!.parashah });
    const expiresAt = Number(bindings.verify(binding, purpose).expiresAt);
    fence(request, after, expiresAt);
    return { ok: true as const, status: "prepared" as const, ...view(after, args.mode), binding, expiresAt,
      sourceFetchedAt: fetchedAt, portion: snapshot!.reading!.parashah, ranges, verseCount: planned.verses.length, pages: planned.pages };
  }
  async function page(original: Request, supplied: Selection & { binding: string; offset: number }) {
    const request = fixed(original), args = selection(supplied), binding = supplied.binding, offset = supplied.offset;
    const claim = bindings.verify(binding, purpose);
    if (claim.version !== 1 || !object(claim.context) || !object(claim.context.actor) || !Array.isArray(claim.ranges)
      || claim.ranges.length !== 1 || typeof claim.ranges[0] !== "string" || claim.context.assignment !== null
      || claim.context.studentId !== args.studentId || claim.context.actor.mode !== args.mode) throw new AccessDenied(403);
    freshSource(Number(claim.fetchedAt));
    const ranges = claim.ranges as string[], plan = previewPages(ranges, "torah");
    if (!Number.isSafeInteger(offset) || !plan.pages.some(row => row.offset === offset)) throw new StudyUnavailable("invalid-request");
    const before = await capture(request, args);
    if (digest(before) !== digest(claim.context)) return stale();
    const text = await input.loadText({ kind: "torah", ranges, verses: plan.verses, offset, translation: "jps2023", signal: request.signal });
    connected(request);
    const after = await capture(request, args);
    bindings.verify(binding, purpose); freshSource(Number(claim.fetchedAt));
    if (digest(after) !== digest(before)) return stale();
    fence(request, after, Number(claim.expiresAt));
    return { ok: true as const, ...view(after, args.mode), expiresAt: Number(claim.expiresAt), page: text };
  }
  return Object.freeze({ prepare, page });
}
