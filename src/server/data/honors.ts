import "server-only";
import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import type { AccessTransaction, StudentActor } from "../access/types";
import * as s from "../db/index";
import type { HonorsContextView, HonorsIntent, HonorsVersion } from "../../lib/honors/types";
import { form } from "../honors/validation";
import { storedView } from "../honors/context";
export type HonorsRow = typeof s.honorsVersion.$inferSelect;
export async function latest<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor) {
  const [row] = await tx.select().from(s.honorsVersion).where(and(eq(s.honorsVersion.tenantId, actor.tenantId), eq(s.honorsVersion.studentId, actor.studentId))).orderBy(desc(s.honorsVersion.version)).limit(1); return row ?? null;
}
export async function receipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, mutationId: string) {
  const [row] = await tx.select().from(s.honorsVersion).where(and(eq(s.honorsVersion.tenantId, actor.tenantId), eq(s.honorsVersion.studentId, actor.studentId), eq(s.honorsVersion.mutationId, mutationId))).limit(1); return row ?? null;
}
export function view(row: HonorsRow): HonorsVersion {
  return Object.freeze({ version: row.version, form: form(row.form), reviewedContext: storedView(row.reviewedContext, row.contextHash), createdAt: row.createdAt.toISOString() });
}
export async function append<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, write: HonorsIntent, requestDigest: string, context: HonorsContextView, live: () => void) {
  if (actor.mode !== "parent" && actor.mode !== "admin" && actor.mode !== "student") throw new Error("Honors unavailable");
  const [row] = await tx.insert(s.honorsVersion).values({ tenantId: actor.tenantId, studentId: actor.studentId, assignmentId: context.snapshot.torah?.id ?? null,
    version: write.expectedVersion + 1, baseVersion: write.expectedVersion, previousVersion: write.expectedVersion || null,
    form: write.form, reviewedContext: context.snapshot, contextHash: context.hash, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
    roleGrantId: actor.roleGrantId, guardianId: actor.mode === "parent" ? actor.relationshipId : null, studentIdentityId: actor.mode === "student" ? actor.relationshipId : null, role: actor.mode, mode: actor.mode,
    mutationId: write.mutationId, requestDigest }).onConflictDoNothing().returning();
  live();
  if (row) await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
    roleGrantId: actor.roleGrantId, guardianId: actor.mode === "parent" ? actor.relationshipId : null, mode: actor.mode, actingStudentId: actor.studentId,
    action: "honors.set", targetType: "honors_version", targetId: row.id, requestId: randomUUID() });
  live(); return row ?? null;
}
