import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { ServiceCourseOwner } from "../service-course/progress-access";
import { memberEligible } from "../access/eligibility";
import * as s from "../db/index";

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
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-service-course-owner:${owner.tenantId}:${owner.membershipId}`}, 0))`);
}

const mine = (owner: ServiceCourseOwner) => and(eq(s.serviceCourseProgressTable.tenantId, owner.tenantId), eq(s.serviceCourseProgressTable.membershipId, owner.membershipId));
export type ServiceCourseProgressRow = typeof s.serviceCourseProgressTable.$inferSelect;
export async function progressRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner) {
  const [row] = await tx.select().from(s.serviceCourseProgressTable).where(mine(owner)).limit(1);
  return row ?? null;
}
export async function insertProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner, progress: unknown) {
  const [row] = await tx.insert(s.serviceCourseProgressTable).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId, progress, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner, expectedVersion: number, progress: unknown) {
  const [row] = await tx.update(s.serviceCourseProgressTable).set({ progress, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(mine(owner), eq(s.serviceCourseProgressTable.version, expectedVersion))).returning();
  return row ?? null;
}

/**
 * The member's own known date, for the review cap the service course shares with Learn to lein (A4 8.1): the ceremony of the
 * student their live student grant names, if any. Read only for the owner's own scheduling and returned only to them.
 */
export async function ownCeremonyDate<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: ServiceCourseOwner) {
  const [row] = await tx.select({ date: s.student.ceremonyDate }).from(s.roleGrant)
    .innerJoin(s.studentIdentity, and(eq(s.studentIdentity.tenantId, s.roleGrant.tenantId), eq(s.studentIdentity.roleGrantId, s.roleGrant.id), isNull(s.studentIdentity.revokedAt)))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.roleGrant.tenantId, owner.tenantId), eq(s.roleGrant.membershipId, owner.membershipId), eq(s.roleGrant.role, "student"), isNull(s.roleGrant.revokedAt)))
    .orderBy(asc(s.student.ceremonyDate)).limit(1);
  return row?.date ?? null;
}
