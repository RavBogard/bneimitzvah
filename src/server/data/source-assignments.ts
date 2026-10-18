import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import type { PracticeActor } from "../practice/types";
import type { SourceAssignmentIntent, SourceAssignmentSelection } from "../study/source-assignments-validation";
import type { RelatedSourceMetadata } from "../study/sources/metadata";
import { projectRelatedCatalog } from "../study/sources/discovery";
import * as s from "../db/index";
export type SourceAssignmentActor = StudentActor | PracticeActor;
export type SourceAssignmentRow = typeof s.verseSourceAssignment.$inferSelect;
const t = s.verseSourceAssignment;
export async function latest<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: SourceAssignmentActor, selection: SourceAssignmentSelection, verse: string) {
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.assignmentId, selection.assignmentId),
    eq(t.assignmentRevision, selection.assignmentRevision), eq(t.verseRef, verse))).orderBy(desc(t.version)).limit(1); return row ?? null;
}
export async function receipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: SourceAssignmentActor, mutationId: string) {
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.actorUserId, actor.userId), eq(t.mutationId, mutationId))).limit(1); return row ?? null;
}
export function citations(row: SourceAssignmentRow): readonly RelatedSourceMetadata[] {
  if (!Array.isArray(row.citations) || row.citations.length > 32) throw new Error("Source assignments unavailable");
  return projectRelatedCatalog({ schema: "study-related-metadata/v1", verse: row.verseRef, entries: row.citations,
    receivedRows: row.citations.length, heldCount: 0, duplicateCount: 0 }, row.verseRef).entries;
}
export function view(row: SourceAssignmentRow) { return Object.freeze({ version: row.version, citations: citations(row), createdAt: row.createdAt.toISOString() }); }
export async function append<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: SourceAssignmentActor, selection: SourceAssignmentSelection,
  write: SourceAssignmentIntent, requestDigest: string, snapshot: readonly RelatedSourceMetadata[], live: () => void) {
  if (actor.mode !== "admin" && actor.mode !== "tutor") throw new Error("Source assignments unavailable");
  const [row] = await tx.insert(t).values({ tenantId: actor.tenantId, studentId: actor.studentId, assignmentId: selection.assignmentId,
    assignmentRevision: selection.assignmentRevision, verseRef: write.verseRef, version: write.expectedVersion + 1, baseVersion: write.expectedVersion,
    previousVersion: write.expectedVersion === 0 ? null : write.expectedVersion, citations: snapshot, actorUserId: actor.userId,
    actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, role: actor.mode, mode: actor.mode, mutationId: write.mutationId, requestDigest }).onConflictDoNothing().returning();
  // A uniqueness wait can outlive the captured session or caller; do not even
  // issue the audit command after that wait unless the transaction is live.
  live();
  if (row) await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, actingStudentId: actor.studentId, action: "source-assignment.set", targetType: "verse_source_assignment", targetId: row.id, requestId: randomUUID() });
  live(); return row ?? null;
}
