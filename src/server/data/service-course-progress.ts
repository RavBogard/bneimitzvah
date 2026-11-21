import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { ServiceCourseOwner } from "../service-course/progress-access";
import { memberEligible } from "../access/eligibility";
import * as s from "../db/index";
import { learningOwnerKey } from "../practice/learning-owner";
import { insertStudentLearning, readStudentLearning, updateStudentLearning } from "./student-learning";

/**
 * Service-course progress queries (2.0 SC4), a fork of data/course-progress.ts. Imported only from
 * src/server/service-course/progress-* (a structural test holds this). Every query runs under the forced owner_only
 * policy AND filters on the owner's tenant and membership itself, so a forgotten WHERE still sees nothing and a forgotten
 * policy still filters. No audit rows: audit is staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/**
 * The same eligibility as Learn to lein's progress (A4 8.1, plan item 35): share-locks one live grant of this membership,
 * any role; without one, the shared member rule decides (src/server/access/eligibility.ts), so an approved Member with no
 * role keeps progress as well. A concurrent revocation or end of membership waits.
 */
export async function serviceCourseEligibility<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  return grant !== undefined || memberEligible(tx, tenantId, membershipId);
}

/** One member's writes run one at a time, so a merge never loses a concurrent write. Its own lock key, apart from Learn's. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-service-course-owner:${owner.tenantId}:${learningOwnerKey(owner)}`}, 0))`);
}

const mine = (owner: ServiceCourseOwner) => and(eq(s.serviceCourseProgressTable.tenantId, owner.tenantId), eq(s.serviceCourseProgressTable.membershipId, (owner.legacy ?? owner).membershipId));
export type ServiceCourseProgressRow = { progress: unknown; version: number };
export async function progressRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner) {
  if (owner.student && !owner.legacy) {
    const row = await readStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "service");
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.select().from(s.serviceCourseProgressTable).where(mine(owner)).limit(1);
  return row ?? null;
}
export async function insertProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner, progress: unknown) {
  if (owner.student && !owner.legacy) {
    const row = await insertStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "service", progress);
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.insert(s.serviceCourseProgressTable).values({ tenantId: owner.tenantId, membershipId: (owner.legacy ?? owner).membershipId, userId: (owner.legacy ?? owner).userId, progress, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner, expectedVersion: number, progress: unknown) {
  if (owner.student && !owner.legacy) {
    const row = await updateStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "service", expectedVersion, progress);
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.update(s.serviceCourseProgressTable).set({ progress, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(mine(owner), eq(s.serviceCourseProgressTable.version, expectedVersion))).returning();
  return row ?? null;
}
