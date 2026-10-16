import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import * as s from "../db/index";

export async function currentPlan<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, lock?: "share" | "update"): Promise<typeof s.studentServicePlan.$inferSelect | null> {
  const query = tx.select().from(s.studentServicePlan).where(and(eq(s.studentServicePlan.tenantId, tenantId), eq(s.studentServicePlan.studentId, studentId)));
  const [row] = await (lock ? query.for(lock) : query); return row ?? null;
}
export async function lifecycle<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, catalogId?: string): Promise<typeof s.serviceCatalogLifecycle.$inferSelect | null> {
  const [row] = await tx.select().from(s.serviceCatalogLifecycle).where(and(eq(s.serviceCatalogLifecycle.tenantId, tenantId),
    catalogId ? eq(s.serviceCatalogLifecycle.catalogId, catalogId) : eq(s.serviceCatalogLifecycle.state, "active"))).for("share");
  return row ?? null;
}
export async function catalog<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string): Promise<typeof s.serviceCatalog.$inferSelect | null> {
  const [row] = await tx.select().from(s.serviceCatalog).where(and(eq(s.serviceCatalog.tenantId, tenantId), eq(s.serviceCatalog.id, id)));
  return row ?? null;
}
export async function context<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string): Promise<{ serviceSlot: typeof s.student.$inferSelect.serviceSlot } | undefined> {
  const [row] = await tx.select({ serviceSlot: s.student.serviceSlot }).from(s.student).where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, id)));
  return row;
}
export async function persist<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, studentId: string, expected: number,
  values: { catalogId: string; catalogIdentity: string; selectedIds: string[]; reviewedDate: string; reviewedSlot: "morning" | "havdalah" }): Promise<typeof s.studentServicePlan.$inferSelect | null> {
  const data = { ...values, needsReview: false, setByMembershipId: actor.membershipId };
  const [row] = expected === 0
    ? await tx.insert(s.studentServicePlan).values({ ...data, tenantId: actor.tenantId, studentId }).onConflictDoNothing({ target: [s.studentServicePlan.tenantId, s.studentServicePlan.studentId] }).returning()
    : await tx.update(s.studentServicePlan).set({ ...data, revision: expected + 1 }).where(and(eq(s.studentServicePlan.tenantId, actor.tenantId), eq(s.studentServicePlan.studentId, studentId), eq(s.studentServicePlan.revision, expected))).returning();
  return row ?? null;
}
export async function markForReview<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string) {
  await tx.update(s.studentServicePlan).set({ needsReview: true, revision: sql`${s.studentServicePlan.revision} + 1` })
    .where(and(eq(s.studentServicePlan.tenantId, tenantId), eq(s.studentServicePlan.studentId, studentId)));
}
export async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, studentId: string, planId: string) {
  await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId,
    roleGrantId: actor.roleGrantId, mode: actor.mode, actingStudentId: studentId, action: "service-plan.set", targetType: "service-plan", targetId: planId, requestId: randomUUID() });
}
