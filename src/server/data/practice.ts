import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, LockIntent, VerifiedIdentity } from "../access/types";
import { lockStrength } from "../access/types";
import * as s from "../db/index";

export type StoredPracticeContext = typeof s.practiceContext.$inferSelect;

export async function lockPracticeGuardian<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, parentGrantId: string, intent: LockIntent) {
  const [row] = await tx.select().from(s.guardian).where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId),
    eq(s.guardian.parentGrantId, parentGrantId), isNull(s.guardian.revokedAt))).for(lockStrength(intent));
  return row;
}

export async function lockPracticeContext<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, identity: VerifiedIdentity, hash: string, intent: LockIntent) {
  if (!identity.membership) return undefined;
  const [row] = await tx.select().from(s.practiceContext).where(and(eq(s.practiceContext.tenantId, identity.tenantId),
    eq(s.practiceContext.tokenHash, hash), eq(s.practiceContext.authSessionId, identity.authSessionId), eq(s.practiceContext.actorUserId, identity.userId),
    eq(s.practiceContext.actorMembershipId, identity.membership.id), eq(s.practiceContext.mode, "child-practice"), eq(s.practiceContext.role, "parent"))).for(lockStrength(intent));
  return row;
}

export async function insertPracticeContext<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, input: typeof s.practiceContext.$inferInsert) {
  const [row] = await tx.insert(s.practiceContext).values(input).returning();
  return row;
}

export async function revokePracticeContext<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, context: StoredPracticeContext, now: Date) {
  const [row] = await tx.update(s.practiceContext).set({ revokedAt: now }).where(and(eq(s.practiceContext.tenantId, context.tenantId),
    eq(s.practiceContext.id, context.id), isNull(s.practiceContext.revokedAt))).returning({ id: s.practiceContext.id });
  return row;
}

export async function writePracticeAudit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, context: StoredPracticeContext, action: "context.enter" | "context.exit") {
  await tx.insert(s.auditEvent).values({ tenantId: context.tenantId, actorUserId: context.actorUserId, actorMembershipId: context.actorMembershipId,
    roleGrantId: context.roleGrantId, mode: "child-practice", actingStudentId: context.actingStudentId, guardianId: context.guardianId, action, targetType: "practice_context",
    targetId: context.id, requestId: crypto.randomUUID() });
}
