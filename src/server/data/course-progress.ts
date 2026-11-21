import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { CourseOwner } from "../course-progress/access";
import { memberEligible } from "../access/eligibility";
import * as s from "../db/index";
import { learningOwnerKey } from "../practice/learning-owner";
import { insertStudentLearning, readStudentLearning, updateStudentLearning } from "./student-learning";

/**
 * Course-progress queries. Imported only from src/server/course-progress/* (a structural test holds this).
 * Every query runs under the forced owner_only policy AND filters on the owner's tenant and membership
 * itself, so a forgotten WHERE still sees nothing and a forgotten policy still filters. No audit rows:
 * audit is staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/**
 * Share-locks one live grant of this membership, any role: a student keeps course progress too (the
 * known-date cap is for them). Without one, the shared member rule decides (src/server/access/eligibility.ts),
 * so an approved Member with no role keeps it as well. A concurrent revocation or end of membership waits.
 */
export async function courseEligibility<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  return grant !== undefined || memberEligible(tx, tenantId, membershipId);
}

/** One member's writes run one at a time, so a merge never loses a concurrent write. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-course-owner:${owner.tenantId}:${learningOwnerKey(owner)}`}, 0))`);
}

const mine = (owner: CourseOwner) => and(eq(s.courseProgressTable.tenantId, owner.tenantId), eq(s.courseProgressTable.membershipId, (owner.legacy ?? owner).membershipId));
export type CourseProgressRow = { progress: unknown; version: number };
export async function progressRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner) {
  if (owner.student && !owner.legacy) {
    const row = await readStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "learn");
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.select().from(s.courseProgressTable).where(mine(owner)).limit(1);
  return row ?? null;
}
export async function insertProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner, progress: unknown) {
  if (owner.student && !owner.legacy) {
    const row = await insertStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "learn", progress);
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.insert(s.courseProgressTable).values({ tenantId: owner.tenantId, membershipId: (owner.legacy ?? owner).membershipId, userId: (owner.legacy ?? owner).userId, progress, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateProgress<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: CourseOwner, expectedVersion: number, progress: unknown) {
  if (owner.student && !owner.legacy) {
    const row = await updateStudentLearning(tx, { tenantId: owner.tenantId, student: owner.student }, "learn", expectedVersion, progress);
    return row ? { progress: row.document, version: row.version } : null;
  }
  const [row] = await tx.update(s.courseProgressTable).set({ progress, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(mine(owner), eq(s.courseProgressTable.version, expectedVersion))).returning();
  return row ?? null;
}
