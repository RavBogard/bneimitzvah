import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

export const MAVEN_NAMESPACE = "maven";

/** Every source identity of one namespace in the tenant (insert-only rows, so no lock is needed). */
export async function sourceIdentities<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, namespace: string) {
  return tx.select({ sourceRecordId: s.studentSourceIdentity.sourceRecordId, studentId: s.studentSourceIdentity.studentId, linkKind: s.studentSourceIdentity.linkKind }).from(s.studentSourceIdentity)
    .where(and(eq(s.studentSourceIdentity.tenantId, tenantId), eq(s.studentSourceIdentity.sourceNamespace, namespace)))
    .orderBy(asc(s.studentSourceIdentity.sourceRecordId)).limit(5001);
}
export async function insertSourceIdentity<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, row: typeof s.studentSourceIdentity.$inferInsert) {
  const [created] = await tx.insert(s.studentSourceIdentity).values(row).returning({ id: s.studentSourceIdentity.id });
  return created;
}
/** One roster intake at a time per tenant: two applies of the same plan serialize instead of racing. */
export async function lockRosterIntake<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, namespace: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-roster-intake:${tenantId}:${namespace}`}, 0))`);
}
