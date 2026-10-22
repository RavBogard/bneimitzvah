import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import type { StudentView } from "../data/students";
import { confirmedReadings } from "../data/portal";
import * as data from "../data/source-assignments";
import * as validate from "./source-assignments-validation";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { assignmentNeedsReview } from "../../lib/readings/review";
export type CurrentVerseRequest = AccessRequest & { method?: string; signal?: AbortSignal };
type Request = CurrentVerseRequest;
const stale = Object.freeze({ ok: false as const, code: "stale-revision" as const });
const unavailable = (): never => { throw new Error("Current verse unavailable"); };
export function snapshotCurrentVerseRequest(original: Request) { return Object.freeze({ url: original.url, headers: new Headers(original.headers), method: original.method, signal: original.signal }); }
export type CurrentVerseCapture = Readonly<{ binding: string; envelope: Readonly<{
  studentId: string; studentRevision: number; mode: data.SourceAssignmentActor["mode"]; context: import("../practice/types").PracticeContextView | null;
  assignment: Readonly<{ id: string; revision: number; kind: "torah"|"haftarah"; needsReview: boolean }>; verseRef: string }>; live: () => void }>;
/** Builds the internal transaction callback only; does not select or grant a capability. */
export function currentVerseCapture<Q extends PgQueryResultHKT,T>(request: Readonly<{ signal?: AbortSignal }>, selection: validate.SourceAssignmentSelection, verse: string,
  action:(tx:AccessTransaction<Q>,actor:data.SourceAssignmentActor,capture:CurrentVerseCapture)=>Promise<T>) {
  return async (tx: AccessTransaction<Q>, actor: data.SourceAssignmentActor, student: StudentView) => {
      const live = () => { if (actor.authSessionExpiresAt <= Date.now()) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= Date.now()) throw new AccessDenied(404);
        if (request.signal?.aborted) unavailable(); };
      const readings = await confirmedReadings(tx, actor.tenantId, student.id); live();
      const reading = readings.find(row => row.kind === selection.kind);
      if (!reading || reading.id !== selection.assignmentId || reading.revision !== selection.assignmentRevision) return stale;
      const verses = expandReadingRanges(reading.ref.split(/;\s*/), selection.kind, TANAKH_VERSE_COUNTS);
      if (verses.length !== reading.verses.length || verses.some((ref, i) => ref !== reading.verses[i])) return unavailable();
      if (!verses.includes(verse)) throw new AccessDenied(404);
      const originalContext = "context" in actor ? actor.context : null;
      const context = originalContext ? Object.freeze({ ...originalContext }) : null;
      const binding = JSON.stringify([actor.tenantId, actor.origin, actor.userId, actor.authSessionId, actor.authSessionExpiresAt, actor.membershipId, actor.authorityRevision,
        actor.roleGrantId, actor.roleGrantRevision, actor.mode, actor.studentId, student.revision, actor.relationshipId, actor.relationshipRevision,
        reading.id, reading.revision, reading.kind, reading.basis, reading.ref, reading.snapshot, verses, verse, context]);
      const result = await action(tx, actor, { binding, live, envelope: Object.freeze({ studentId: student.id, studentRevision: student.revision, mode: actor.mode, context,
        assignment: Object.freeze({ id: reading.id, revision: reading.revision, kind: selection.kind, needsReview: assignmentNeedsReview(reading.snapshot, student.ceremonyDate) }), verseRef: verse }) });
      live(); return result;
    };
}
/** Fixed ordinary read dispatch; source-write dispatch remains private to its original service. */
export function createCurrentVerseContext<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>> }) {
  return async function read<T>(request:Request,selection:validate.SourceAssignmentSelection,verse:string,
    action:(tx:AccessTransaction<Q>,actor:data.SourceAssignmentActor,capture:CurrentVerseCapture)=>Promise<T>) {
    const run=currentVerseCapture(request,selection,verse,action);
    return selection.mode === "child-practice" ? input.practice.withPracticeCapability(request,{mode:"child-practice",studentId:selection.studentId,capability:"read"},run)
      : input.access.withStudentCapability(request,{mode:selection.mode,studentId:selection.studentId,capability:"read"},run);
  };
}
