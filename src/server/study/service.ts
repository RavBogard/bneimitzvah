import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction, ActiveMode, StudentActor } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { PracticeActor, PracticeContextView } from "../practice/types";
import type { StudentView } from "../data/students";
import { confirmedReadings } from "../data/portal";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges, parseCeremonyDate } from "../../lib/readings/ranges";
import { identifier, revision } from "../students/validation";
import { planStudyPage } from "./sefaria";
import { StudyUnavailable, type StudyPage, type StudyRequest } from "./types";

export type StudySelection = Readonly<{ mode: ActiveMode | "child-practice"; studentId: string; kind: "torah" | "haftarah";
  assignmentId: string; assignmentRevision: number; translation: "jps2023"; offset: number }>;
type Binding = Readonly<{ tenantId: string; origin: string; userId: string; authSessionId: string; authSessionExpiresAt: number;
  membershipId: string; authorityRevision: number; roleGrantId: string; roleGrantRevision: number; role: ActiveMode;
  mode: StudySelection["mode"]; relationshipId: string | null; relationshipRevision: number | null;
  studentId: string; studentRevision: number; context: PracticeContextView | null;
  assignmentId: string; assignmentRevision: number; kind: StudySelection["kind"]; basis: string;
  ranges: readonly string[]; verses: readonly string[]; confirmationDate: string | null; needsReview: boolean }>;
const stale = Object.freeze({ ok: false as const, code: "stale-revision" as const });
function equal(a: Binding, b: Binding) {
  const fields = ["tenantId", "origin", "userId", "authSessionId", "authSessionExpiresAt", "membershipId", "authorityRevision", "roleGrantId", "roleGrantRevision",
    "role", "mode", "relationshipId", "relationshipRevision", "studentId", "studentRevision", "assignmentId", "assignmentRevision", "kind", "basis", "confirmationDate", "needsReview"] as const;
  if (fields.some(key => a[key] !== b[key])) return false;
  if (a.ranges.length !== b.ranges.length || a.ranges.some((value, i) => value !== b.ranges[i])
    || a.verses.length !== b.verses.length || a.verses.some((value, i) => value !== b.verses[i])) return false;
  return a.context === null ? b.context === null : b.context !== null && a.context.id === b.context.id
    && a.context.authorityRevision === b.context.authorityRevision && a.context.studentId === b.context.studentId
    && a.context.studentRevision === b.context.studentRevision && a.context.expiresAt === b.context.expiresAt;
}
export function createStudyService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  load: (request: StudyRequest) => Promise<StudyPage>;
}) {
  return Object.freeze({ async read(original: AccessRequest & { signal?: AbortSignal }, supplied: StudySelection) {
    // Keep the same request binding across both passes; no mutable caller header
    // or selection is consulted again after the public work starts.
    const request = Object.freeze({ url: original.url, headers: new Headers(original.headers) });
    const signal = original.signal;
    const connected = () => { if (signal?.aborted) throw new StudyUnavailable("upstream"); };
    connected();
    const selection = Object.freeze({ ...supplied });
    try {
      identifier(selection.studentId); identifier(selection.assignmentId); revision(selection.assignmentRevision);
      if (!["student", "parent", "tutor", "admin", "child-practice"].includes(selection.mode)
        || !["torah", "haftarah"].includes(selection.kind) || selection.translation !== "jps2023"
        || !Number.isSafeInteger(selection.offset) || selection.offset < 0 || selection.offset > 999) throw 0;
    } catch { throw new StudyUnavailable("invalid-request"); }
    async function capture(tx: AccessTransaction<Q>, actor: StudentActor | PracticeActor, student: StudentView) {
      const reading = (await confirmedReadings(tx, actor.tenantId, student.id)).find(row => row.kind === selection.kind);
      if (!reading || reading.id !== selection.assignmentId || reading.revision !== selection.assignmentRevision) return stale;
      const ranges = reading.ref.split(/;\s*/);
      const verses = expandReadingRanges(ranges, selection.kind, TANAKH_VERSE_COUNTS);
      if (verses.length !== reading.verses.length || verses.some((ref, i) => ref !== reading.verses[i])) throw new Error("Study assignment unavailable");
      const snapshot = reading.snapshot;
      let confirmationDate: string | null = null;
      try { confirmationDate = parseCeremonyDate(snapshot?.confirmationDate); } catch { /* Legacy metadata needs review. */ }
      const context = "context" in actor ? actor.context : null;
      const binding: Binding = Object.freeze({ tenantId: actor.tenantId, origin: actor.origin, userId: actor.userId,
        authSessionId: actor.authSessionId, authSessionExpiresAt: actor.authSessionExpiresAt, membershipId: actor.membershipId,
        authorityRevision: actor.authorityRevision, roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision,
        role: actor.mode === "child-practice" ? "parent" : actor.mode, mode: actor.mode,
        relationshipId: actor.relationshipId, relationshipRevision: actor.relationshipRevision,
        studentId: student.id, studentRevision: student.revision, context,
        assignmentId: reading.id, assignmentRevision: reading.revision, kind: selection.kind, basis: reading.basis,
        ranges: Object.freeze(ranges), verses: Object.freeze(verses), confirmationDate,
        needsReview: snapshot?.needsReview !== false || confirmationDate !== student.ceremonyDate });
      return { ok: true as const, binding };
    }
    const authorize = <T>(action: (tx: AccessTransaction<Q>, actor: StudentActor | PracticeActor, student: StudentView) => Promise<T>) =>
      selection.mode === "child-practice"
        ? input.practice.withPracticeCapability(request, { mode: "child-practice", studentId: selection.studentId, capability: "read" }, action)
        : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, action);
    const first = await authorize(capture);
    if (!first.ok) return stale;
    const publicRequest: StudyRequest = Object.freeze({ kind: first.binding.kind, ranges: first.binding.ranges, verses: first.binding.verses,
      offset: selection.offset, translation: selection.translation, signal });
    planStudyPage(publicRequest, TANAKH_VERSE_COUNTS);
    // Both capability transactions end before any cache/network work.
    connected();
    const page = await input.load(publicRequest);
    connected();
    return authorize(async (tx, actor, student) => {
      const final = await capture(tx, actor, student);
      if (!final.ok || !equal(first.binding, final.binding)) return stale;
      connected();
      const now = Date.now();
      if (final.binding.authSessionExpiresAt <= now) throw new AccessDenied(401);
      if (final.binding.context && Date.parse(final.binding.context.expiresAt) <= now) throw new AccessDenied(404);
      return Object.freeze({ ok: true as const, studentId: student.id, studentRevision: student.revision, mode: final.binding.mode,
        context: final.binding.context, assignment: Object.freeze({ id: final.binding.assignmentId, revision: final.binding.assignmentRevision,
          kind: final.binding.kind, needsReview: final.binding.needsReview }), page });
    });
  } });
}
