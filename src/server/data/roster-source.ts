import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

export const MAVEN_NAMESPACE = "maven";
const t = s.studentSourceIdentity;

/**
 * Every current source identity of one namespace in the tenant. A revoked (unlinked) row is history only:
 * it never counts as a link again. Rows only ever gain a revocation, so a reader holding the roster lock
 * (lockRosterIntake) sees a stable set; without it a concurrent unlink may still be in flight.
 */
export async function sourceIdentities<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, namespace: string) {
  return tx.select({ sourceRecordId: t.sourceRecordId, studentId: t.studentId, linkKind: t.linkKind }).from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.sourceNamespace, namespace), isNull(t.revokedAt)))
    .orderBy(asc(t.sourceRecordId)).limit(5001);
}
export async function insertSourceIdentity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: typeof s.studentSourceIdentity.$inferInsert) {
  const [created] = await tx.insert(t).values(row).returning({ id: t.id });
  return created;
}
/** One roster intake at a time per tenant: two applies of the same plan serialize instead of racing, and an unlink waits for both. */
export async function lockRosterIntake<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, namespace: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-roster-intake:${tenantId}:${namespace}`}, 0))`);
}
/** A student's current link in one namespace (what the roster shows), or null. */
export async function currentLinkForStudent<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, namespace: string, studentId: string, lock = false) {
  const query = tx.select({ id: t.id, sourceRecordId: t.sourceRecordId, studentId: t.studentId, linkKind: t.linkKind, createdAt: t.createdAt }).from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.sourceNamespace, namespace), eq(t.studentId, studentId), isNull(t.revokedAt))).orderBy(desc(t.createdAt)).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  return row ?? null;
}

export type SourceRevoker = Readonly<{ tenantId: string; userId: string; membershipId: string; roleGrantId: string; channel: "web" | "mcp"; mcpConnectionId: string | null }>;
export type UnlinkOutcome = Readonly<{ ok: true; studentId: string; sourceRecordId: string; linkKind: "created" | "linked"; linkedAt: string; unlinkedAt: string }>
  | Readonly<{ ok: false; code: "not-linked"; currentRecordId: string | null }>;

/**
 * Undo one current link (release 1.1). The caller has already established a live admin authority in this
 * transaction. Serialized with roster applies by the intake lock; the row is locked and stamped revoked once
 * (the database refuses any other change), then audited. The exact pair must still be current: a stale request
 * never unlinks a newer link, and the old row is never made current again.
 */
export async function unlinkSourceIdentity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, revoker: SourceRevoker, target: { namespace: string; studentId: string; sourceRecordId: string }, at: Date): Promise<UnlinkOutcome> {
  if ((revoker.channel === "mcp") !== (revoker.mcpConnectionId !== null)) throw new Error("Unlink channel mismatch");
  await lockRosterIntake(tx, revoker.tenantId, target.namespace);
  const current = await currentLinkForStudent(tx, revoker.tenantId, target.namespace, target.studentId, true);
  if (!current || current.sourceRecordId !== target.sourceRecordId) return Object.freeze({ ok: false, code: "not-linked", currentRecordId: current?.sourceRecordId ?? null });
  // Never before the link itself (the database requires it), even if this server's clock trails the one that linked.
  const when = new Date(Math.max(at.getTime(), current.createdAt.getTime()));
  const [row] = await tx.update(t).set({ revokedAt: when, revokedByUserId: revoker.userId, revokedByMembershipId: revoker.membershipId, revokedRoleGrantId: revoker.roleGrantId,
    revokedRole: "admin", revokedChannel: revoker.channel, revokedMcpConnectionId: revoker.mcpConnectionId })
    .where(and(eq(t.tenantId, revoker.tenantId), eq(t.id, current.id), isNull(t.revokedAt))).returning({ id: t.id });
  if (!row) return Object.freeze({ ok: false, code: "not-linked", currentRecordId: null });
  await tx.insert(s.auditEvent).values({ tenantId: revoker.tenantId, actorUserId: revoker.userId, actorMembershipId: revoker.membershipId, roleGrantId: revoker.roleGrantId,
    mode: "admin", actingStudentId: target.studentId, action: "source-identity.revoke", targetType: "student_source_identity", targetId: row.id, requestId: randomUUID() });
  return Object.freeze({ ok: true, studentId: current.studentId, sourceRecordId: current.sourceRecordId, linkKind: current.linkKind, linkedAt: current.createdAt.toISOString(), unlinkedAt: when.toISOString() });
}
