import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { VerseReviewOwner } from "../verse-review/access";
import * as s from "../db/index";

/**
 * Verse review queries (1.9 N19), a fork of data/course-progress.ts. Imported only from src/server/verse-review/* (a
 * structural test holds this). Every query runs under the forced owner_only policy AND filters on the owner's tenant and
 * membership itself, so a forgotten WHERE still sees nothing and a forgotten policy still filters. No audit rows: audit is
 * staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/**
 * Only a student keeps verse cards: the cards are their own assigned verses. Share-locks one live student grant of this
 * membership, so a concurrent revocation waits. A tutor, parent, admin or Member with no student grant is refused.
 */
export async function verseReviewEligibility<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    eq(s.roleGrant.role, "student"), isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.id)).limit(1).for("share");
  return grant !== undefined;
}

/** One member's writes run one at a time. Its own lock key, apart from Learn's progress. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: VerseReviewOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-verse-review-owner:${owner.tenantId}:${owner.membershipId}`}, 0))`);
}

const mine = (owner: VerseReviewOwner) => and(eq(s.verseReviewTable.tenantId, owner.tenantId), eq(s.verseReviewTable.membershipId, owner.membershipId));
export type VerseReviewRow = typeof s.verseReviewTable.$inferSelect;
export async function reviewRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: VerseReviewOwner) {
  const [row] = await tx.select().from(s.verseReviewTable).where(mine(owner)).limit(1);
  return row ?? null;
}
export async function insertReview<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: VerseReviewOwner, review: unknown) {
  const [row] = await tx.insert(s.verseReviewTable).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId, review, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateReview<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: VerseReviewOwner, expectedVersion: number, review: unknown) {
  const [row] = await tx.update(s.verseReviewTable).set({ review, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(mine(owner), eq(s.verseReviewTable.version, expectedVersion))).returning();
  return row ?? null;
}

/**
 * The student's own ceremony date, for the same known-date cap Learn's phrase cards use: the ceremony of the student their
 * live student grant names, if any. Read only for the owner's own scheduling and returned only to them.
 */
export async function ownCeremonyDate<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: VerseReviewOwner) {
  const [row] = await tx.select({ date: s.student.ceremonyDate }).from(s.roleGrant)
    .innerJoin(s.studentIdentity, and(eq(s.studentIdentity.tenantId, s.roleGrant.tenantId), eq(s.studentIdentity.roleGrantId, s.roleGrant.id), isNull(s.studentIdentity.revokedAt)))
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId), isNull(s.student.disabledAt)))
    .where(and(eq(s.roleGrant.tenantId, owner.tenantId), eq(s.roleGrant.membershipId, owner.membershipId), eq(s.roleGrant.role, "student"), isNull(s.roleGrant.revokedAt)))
    .orderBy(asc(s.student.ceremonyDate)).limit(1);
  return row?.date ?? null;
}
