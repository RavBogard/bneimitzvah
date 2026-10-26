import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, notInArray } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { ProgressStream, ProgressWrite } from "../../lib/progress/types";
import * as s from "../db/index";

export type ProgressActor = StudentActor | PracticeActor;
const table = (stream: ProgressStream) => stream === "self-check" ? s.verseSelfCheck : s.verseAssessment;
const key = (t: typeof s.verseSelfCheck | typeof s.verseAssessment, actor: ProgressActor, assignmentId: string, verseRef: string) => and(
  eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.assignmentId, assignmentId), eq(t.verseRef, verseRef));

// One statement gives both streams from one snapshot; page and counts are
// derived from this same bounded current-verse result, never separate queries.
export async function snapshot<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, assignmentId: string) {
  const v = s.assignmentVerse, self = s.verseSelfCheck, assessment = s.verseAssessment;
  return tx.select({ verseRef: v.verseRef, selfState: self.state, selfVersion: self.version, assessmentState: assessment.state, assessmentVersion: assessment.version })
    .from(v)
    .leftJoin(self, and(eq(self.tenantId, v.tenantId), eq(self.studentId, v.studentId), eq(self.assignmentId, v.assignmentId), eq(self.verseRef, v.verseRef)))
    .leftJoin(assessment, and(eq(assessment.tenantId, v.tenantId), eq(assessment.studentId, v.studentId), eq(assessment.assignmentId, v.assignmentId), eq(assessment.verseRef, v.verseRef)))
    .where(and(eq(v.tenantId, actor.tenantId), eq(v.studentId, actor.studentId), eq(v.assignmentId, assignmentId)))
    .orderBy(asc(v.ordinal)).limit(1001);
}
export async function lockHead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, stream: ProgressStream, assignmentId: string, verseRef: string) {
  const t = table(stream);
  const [row] = await tx.select({ id: t.id, state: t.state, version: t.version }).from(t).where(key(t, actor, assignmentId, verseRef)).for("update");
  return row ?? null;
}
export async function change<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, stream: ProgressStream, assignmentId: string, write: ProgressWrite, exists: boolean) {
  if (stream === "self-check") {
    // 1.9 N23 (0052): a student's mark records whether it was made with a parent (child practice), as practice events do.
    // The instant of the change is the server's, stamped by 0052's trigger.
    if (actor.mode !== "student" && actor.mode !== "child-practice") throw new Error("Progress mode unavailable");
    const t = s.verseSelfCheck, values = { state: write.state, version: write.expectedVersion + 1, sourceMode: actor.mode };
    const [row] = exists
      ? await tx.update(t).set(values).where(and(key(t, actor, assignmentId, write.verseRef), eq(t.version, write.expectedVersion))).returning({ id: t.id, state: t.state, version: t.version })
      : await tx.insert(t).values({ tenantId: actor.tenantId, studentId: actor.studentId, assignmentId, verseRef: write.verseRef, ...values }).onConflictDoNothing().returning({ id: t.id, state: t.state, version: t.version });
    return row ?? null;
  }
  const t = s.verseAssessment, values = { state: write.state, version: write.expectedVersion + 1 };
  const [row] = exists
    ? await tx.update(t).set(values).where(and(key(t, actor, assignmentId, write.verseRef), eq(t.version, write.expectedVersion))).returning({ id: t.id, state: t.state, version: t.version })
    : await tx.insert(t).values({ tenantId: actor.tenantId, studentId: actor.studentId, assignmentId, verseRef: write.verseRef, ...values }).onConflictDoNothing().returning({ id: t.id, state: t.state, version: t.version });
  return row ?? null;
}
export async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, stream: ProgressStream, targetId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, actingStudentId: actor.studentId, guardianId: actor.mode === "child-practice" ? actor.relationshipId : null,
    action: stream === "self-check" ? "progress.self-check.set" : "progress.assessment.set", targetType: stream === "self-check" ? "verse_self_check" : "verse_assessment", targetId, requestId: randomUUID() });
}
// Called only by confirmed assignment replacement after its UPDATE succeeded.
// The held assignment lock orders all progress reads/writes against this prune.
export async function pruneRemoved<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, assignmentId: string, verses: readonly string[]) {
  if (!verses.length) throw new Error("Progress assignment unavailable");
  for (const t of [s.verseSelfCheck, s.verseAssessment]) {
    await tx.delete(t).where(and(eq(t.tenantId, tenantId), eq(t.studentId, studentId), eq(t.assignmentId, assignmentId), notInArray(t.verseRef, [...verses])));
  }
}
