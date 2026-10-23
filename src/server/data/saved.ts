import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { SavedOwner } from "../saved/access";
import { SAVED_ELIGIBLE_ROLES } from "../saved/eligibility";
import type { MarkState, SavedKind, WorkStream } from "../saved/validation";
import * as s from "../db/index";

/**
 * Saved-layer queries. Imported only from src/server/saved/* (a structural test holds this).
 * Every query runs under the forced owner_only policy AND filters on the owner's tenant and
 * membership itself, so a forgotten WHERE still sees nothing and a forgotten policy still
 * filters. Nothing here writes an audit row: audit is staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/** Share-locks one live grant that makes this membership eligible, so a concurrent revocation waits for this request. */
export async function savedEligibility<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  const [grant] = await tx.select({ id: s.roleGrant.id }).from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.membershipId, membershipId),
    inArray(s.roleGrant.role, [...SAVED_ELIGIBLE_ROLES]), isNull(s.roleGrant.revokedAt))).orderBy(asc(s.roleGrant.role), asc(s.roleGrant.id)).limit(1).for("share");
  return grant !== undefined;
}

/** One member's writes run one at a time, so the row caps hold exactly even under concurrent requests. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-saved-owner:${owner.tenantId}:${owner.membershipId}`}, 0))`);
}

const readingOwner = (owner: SavedOwner) => and(eq(s.savedReading.tenantId, owner.tenantId), eq(s.savedReading.membershipId, owner.membershipId));
export type SavedReadingRow = typeof s.savedReading.$inferSelect;

export async function countReadings<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  const [row] = await tx.select({ n: count() }).from(s.savedReading).where(readingOwner(owner));
  return row?.n ?? 0;
}
export async function listReadings<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, limit: number) {
  return tx.select().from(s.savedReading).where(readingOwner(owner))
    .orderBy(sql`${s.savedReading.readingDate} desc nulls last`, desc(s.savedReading.createdAt), asc(s.savedReading.id)).limit(limit);
}
export async function reading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string) {
  const [row] = await tx.select().from(s.savedReading).where(and(readingOwner(owner), eq(s.savedReading.id, id))).limit(1);
  return row ?? null;
}
export async function insertReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, value: { name: string; date: string | null; kind: SavedKind; ranges: string; verseCount: number }) {
  const [row] = await tx.insert(s.savedReading).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId,
    name: value.name, readingDate: value.date, kind: value.kind, ranges: value.ranges, verseCount: value.verseCount }).returning();
  return row;
}
export async function updateReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, revision: number, value: { name: string; date: string | null }) {
  const [row] = await tx.update(s.savedReading).set({ name: value.name, readingDate: value.date, revision: revision + 1, updatedAt: sql`now()` })
    .where(and(readingOwner(owner), eq(s.savedReading.id, id), eq(s.savedReading.revision, revision))).returning();
  return row ?? null;
}
/** The member's own hard delete; the child rows go with it through the FK cascade. */
export async function deleteReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, revision: number) {
  const rows = await tx.delete(s.savedReading).where(and(readingOwner(owner), eq(s.savedReading.id, id), eq(s.savedReading.revision, revision))).returning({ id: s.savedReading.id });
  return rows.length === 1;
}

const workOwner = (owner: SavedOwner) => and(eq(s.savedVerseWork.tenantId, owner.tenantId), eq(s.savedVerseWork.membershipId, owner.membershipId));
const markOwner = (owner: SavedOwner) => and(eq(s.savedVerseMark.tenantId, owner.tenantId), eq(s.savedVerseMark.membershipId, owner.membershipId));
export type WorkRow = typeof s.savedVerseWork.$inferSelect;
export type MarkRow = typeof s.savedVerseMark.$inferSelect;

export async function countWork<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  const [row] = await tx.select({ n: count() }).from(s.savedVerseWork).where(workOwner(owner));
  return row?.n ?? 0;
}
export async function countMarks<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  const [row] = await tx.select({ n: count() }).from(s.savedVerseMark).where(markOwner(owner));
  return row?.n ?? 0;
}
export async function workForVerses<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verses: readonly string[]) {
  if (!verses.length) return [];
  return tx.select().from(s.savedVerseWork).where(and(workOwner(owner), eq(s.savedVerseWork.savedReadingId, readingId), inArray(s.savedVerseWork.verseRef, [...verses])));
}
export async function marksForVerses<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verses: readonly string[]) {
  if (!verses.length) return [];
  return tx.select().from(s.savedVerseMark).where(and(markOwner(owner), eq(s.savedVerseMark.savedReadingId, readingId), inArray(s.savedVerseMark.verseRef, [...verses])));
}
export async function workRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verseRef: string, stream: WorkStream) {
  const [row] = await tx.select().from(s.savedVerseWork).where(and(workOwner(owner), eq(s.savedVerseWork.savedReadingId, readingId),
    eq(s.savedVerseWork.verseRef, verseRef), eq(s.savedVerseWork.stream, stream))).limit(1);
  return row ?? null;
}
export async function insertWork<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verseRef: string, stream: WorkStream, text: string) {
  const [row] = await tx.insert(s.savedVerseWork).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, savedReadingId: readingId, verseRef, stream, text, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateWork<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, expectedVersion: number, text: string) {
  const [row] = await tx.update(s.savedVerseWork).set({ text, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(workOwner(owner), eq(s.savedVerseWork.id, id), eq(s.savedVerseWork.version, expectedVersion))).returning();
  return row ?? null;
}
export async function markRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verseRef: string) {
  const [row] = await tx.select().from(s.savedVerseMark).where(and(markOwner(owner), eq(s.savedVerseMark.savedReadingId, readingId), eq(s.savedVerseMark.verseRef, verseRef))).limit(1);
  return row ?? null;
}
export async function insertMark<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, readingId: string, verseRef: string, state: MarkState) {
  const [row] = await tx.insert(s.savedVerseMark).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, savedReadingId: readingId, verseRef, state, version: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updateMark<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, expectedVersion: number, state: MarkState) {
  const [row] = await tx.update(s.savedVerseMark).set({ state, version: expectedVersion + 1, updatedAt: sql`now()` })
    .where(and(markOwner(owner), eq(s.savedVerseMark.id, id), eq(s.savedVerseMark.version, expectedVersion))).returning();
  return row ?? null;
}

const starOwner = (owner: SavedOwner) => and(eq(s.starredComment.tenantId, owner.tenantId), eq(s.starredComment.membershipId, owner.membershipId));
export type StarRow = typeof s.starredComment.$inferSelect;
export async function countStars<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  const [row] = await tx.select({ n: count() }).from(s.starredComment).where(starOwner(owner));
  return row?.n ?? 0;
}
export async function listStars<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, limit: number) {
  return tx.select().from(s.starredComment).where(starOwner(owner))
    .orderBy(asc(s.starredComment.work), asc(s.starredComment.verseRef), asc(s.starredComment.commentIndex)).limit(limit);
}
const oneStar = (owner: SavedOwner, work: string, verseRef: string, comment: number) =>
  and(starOwner(owner), eq(s.starredComment.work, work), eq(s.starredComment.verseRef, verseRef), eq(s.starredComment.commentIndex, comment));
export async function starRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, work: string, verseRef: string, comment: number) {
  const [row] = await tx.select().from(s.starredComment).where(oneStar(owner, work, verseRef, comment)).limit(1);
  return row ?? null;
}
export async function insertStar<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, work: string, verseRef: string, comment: number) {
  const [row] = await tx.insert(s.starredComment).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId, work, verseRef, commentIndex: comment })
    .onConflictDoNothing().returning();
  return row ?? null;
}
/** Unstarring is the member's own delete of the row, so the cap counts only live stars. */
export async function deleteStar<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, work: string, verseRef: string, comment: number) {
  await tx.delete(s.starredComment).where(oneStar(owner, work, verseRef, comment));
}
