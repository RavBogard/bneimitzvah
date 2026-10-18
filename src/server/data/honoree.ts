import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, StudentActor } from "../access/types";
import * as s from "../db/index";
import { lockStudent, lockStudentRelationship } from "./authority";
export type Link = typeof s.honoreeLink.$inferSelect;
export type Release = typeof s.honoreeMaterialRelease.$inferSelect;
export type Operation = typeof s.honoreeOperation.$inferSelect;
export async function now<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>) {
  const [row] = await tx.select({ value: sql<string>`floor(extract(epoch from clock_timestamp())*1000)::bigint` }).from(sql`(select 1) as clock_source`);
  const value = Number(row.value); if (!Number.isSafeInteger(value) || value < 0) throw new Error("Honoree unavailable"); return value;
}
export async function discover<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, id: string) {
  const [row] = await tx.select().from(s.honoreeLink).where(and(eq(s.honoreeLink.tenantId, tenantId), eq(s.honoreeLink.id, id))).limit(1); return row ?? null;
}
export async function lockIssuer<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: Link, origin: string) {
  const [tenant] = await tx.select().from(s.tenant).where(eq(s.tenant.id, row.tenantId)).for("share");
  const [user] = await tx.select().from(s.user).where(eq(s.user.id, row.actorUserId)).for("share");
  const [membership] = await tx.select().from(s.membership).where(and(eq(s.membership.tenantId, row.tenantId), eq(s.membership.id, row.actorMembershipId), eq(s.membership.userId, row.actorUserId))).for("share");
  const [grant] = await tx.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, row.tenantId), eq(s.roleGrant.id, row.roleGrantId), eq(s.roleGrant.membershipId, row.actorMembershipId), eq(s.roleGrant.role, row.role))).for("share");
  if (!tenant?.enabled || !user?.emailVerified || !membership || membership.disabledAt || !grant || grant.revokedAt) return null;
  const student = await lockStudent(tx, row.tenantId, row.studentId, "read");
  if (!student || student.disabledAt) return null;
  const relationship = await lockStudentRelationship(tx, row.tenantId, row.studentId, row.roleGrantId, row.role, "read");
  if (!relationship || relationship.id !== row.guardianId) return null;
  // Bearer authority is independent of any login session. These placeholder
  // actor fields are internal context-capture inputs, never session authority.
  const actor: StudentActor = { tenantId: row.tenantId, origin, userId: row.actorUserId, membershipId: membership.id, roleGrantId: grant.id, roleGrantRevision: grant.revision,
    mode: row.role, authorityRevision: membership.authorityRevision, studentId: row.studentId, relationshipId: relationship.id, relationshipRevision: relationship.revision,
    authSessionId: "", authSessionExpiresAt: Infinity };
  return { actor, student };
}
export async function release<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, slot: "morning" | "havdalah", id?: string) {
  // Discover only immutable IDs; acquire source lifecycle before release row.
  const [candidate] = await tx.select().from(s.honoreeMaterialRelease).where(and(eq(s.honoreeMaterialRelease.tenantId, tenantId), eq(s.honoreeMaterialRelease.slot, slot), id ? eq(s.honoreeMaterialRelease.id, id) : eq(s.honoreeMaterialRelease.state, "active"))).limit(1);
  if (!candidate) return null;
  const [lifecycle] = await tx.select().from(s.serviceCatalogLifecycle).where(and(eq(s.serviceCatalogLifecycle.tenantId, tenantId), eq(s.serviceCatalogLifecycle.catalogId, candidate.catalogId))).for("share");
  const [current] = await tx.select().from(s.honoreeMaterialRelease).where(and(eq(s.honoreeMaterialRelease.tenantId, tenantId), eq(s.honoreeMaterialRelease.id, candidate.id))).for("share");
  return lifecycle && lifecycle.state !== "withdrawn" && current?.state === "active" ? current : null;
}
export async function epochs<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, startVerse: string) {
  const [reading] = await tx.select().from(s.honoreeReadingEpoch).where(and(eq(s.honoreeReadingEpoch.tenantId, tenantId), eq(s.honoreeReadingEpoch.studentId, studentId))).for("share");
  const [group] = await tx.select().from(s.honoreeGroupEpoch).where(and(eq(s.honoreeGroupEpoch.tenantId, tenantId), eq(s.honoreeGroupEpoch.studentId, studentId), eq(s.honoreeGroupEpoch.startVerse, startVerse))).for("share");
  return reading && group ? { reading: reading.epoch, group: group.epoch } : null;
}
export async function lockLink<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, startVerse: string, id?: string) {
  const [row] = await tx.select().from(s.honoreeLink).where(and(eq(s.honoreeLink.tenantId, tenantId), eq(s.honoreeLink.studentId, studentId), eq(s.honoreeLink.startVerse, startVerse), id ? eq(s.honoreeLink.id, id) : isNull(s.honoreeLink.revokedAt))).for("share"); return row ?? null;
}
export async function operation<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: StudentActor, mutationId: string) {
  const [row] = await tx.select().from(s.honoreeOperation).where(and(eq(s.honoreeOperation.tenantId, actor.tenantId), eq(s.honoreeOperation.studentId, actor.studentId), eq(s.honoreeOperation.mutationId, mutationId))).limit(1); return row ?? null;
}
export async function revoke<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: Link, instant: number) {
  if (!row.revokedAt) await tx.update(s.honoreeLink).set({ revokedAt: new Date(instant) }).where(and(eq(s.honoreeLink.tenantId, row.tenantId), eq(s.honoreeLink.id, row.id), isNull(s.honoreeLink.revokedAt)));
}
