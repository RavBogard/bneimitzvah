import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { CourseOwner } from "../course-progress/access";
import * as s from "../db/index";

/**
 * Course-progress queries. Imported only from src/server/course-progress/* (a structural test holds this).
 * Every query runs under the forced owner_only policy AND filters on the owner's tenant and membership
 * itself, so a forgotten WHERE still sees nothing and a forgotten policy still filters. No audit rows:
 * audit is staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/**
 * Share-locks one live grant of this membership, any role: a student keeps course progress too (the
 * known-date cap is for them). A concurrent revocation waits for this request.
 */
export async function courseEligibility<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  return grant !== undefined;
}

/** One member's writes run one at a time, so a merge never loses a concurrent write. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-course-owner:${owner.tenantId}:${owner.membershipId}`}, 0))`);
}

const mine = (owner: CourseOwner) => and(eq(s.courseProgressTable.tenantId, owner.tenantId), eq(s.courseProgressTable.membershipId, owner.membershipId));
export type CourseProgressRow = typeof s.courseProgressTable.$inferSelect;
export async function progressRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner) {
  const [row] = await tx.select().from(s.courseProgressTable).where(mine(owner)).limit(1);
  return row ?? null;
}
export async function insertProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner, progress: unknown) {
  const [row] = await tx.insert(s.courseProgressTable).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId, progress, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner, expectedVersion: number, progress: unknown) {
  const [row] = await tx.update(s.courseProgressTable).set({ progress, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(mine(owner), eq(s.courseProgressTable.version, expectedVersion))).returning();
  return row ?? null;
}

/**
 * The member's own known date: the ceremony of the student their live student grant names, if any.
 * Read only for the owner's own scheduling and returned only to them.
 */
export async function ownCeremonyDate<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner) {
  const [row] = await tx.select({ date: s.student.ceremonyDate }).from(s.roleGrant)
    .innerJoin(s.studentIdentity, and(eq(s.studentIdentity.tenantId, s.roleGrant.tenantId), eq(s.studentIdentity.roleGrantId, s.roleGrant.id), isNull(s.studentIdentity.revokedAt)))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.roleGrant.tenantId, owner.tenantId), eq(s.roleGrant.membershipId, owner.membershipId), eq(s.roleGrant.role, "student"), isNull(s.roleGrant.revokedAt)))
    .orderBy(asc(s.student.ceremonyDate)).limit(1);
  return row?.date ?? null;
}
