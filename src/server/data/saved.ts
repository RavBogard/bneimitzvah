import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { SavedOwner, SavedScope } from "../saved/access";
import { memberEligible } from "../access/eligibility";
import type { MarkState, SavedKind, WorkStream } from "../saved/validation";
import * as s from "../db/index";

/**
 * Saved-layer queries. Imported only from src/server/saved/* (a structural test holds this).
 * Every query runs under the forced policies AND filters on the scope's tenant and membership
 * itself, so a forgotten WHERE still sees nothing and a forgotten policy still filters. The reads
 * take a SavedScope (the owner's own, or a learner a bound staff viewer may see: readings for
 * everyone, 0054); the writes take the owner. Nothing here writes an audit row: audit is staff-readable.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;

/** The saved layer's eligibility is the shared member rule (src/server/access/eligibility.ts), share-locked. */
export const savedEligibility = memberEligible;

/** One member's writes run one at a time, so the row caps hold exactly even under concurrent requests. */
export async function lockOwnerWrites<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`portal-saved-owner:${owner.tenantId}:${owner.membershipId}`}, 0))`);
}

const readingOwner = (owner: SavedScope) => and(eq(s.savedReading.tenantId, owner.tenantId), eq(s.savedReading.membershipId, owner.membershipId));
export type SavedReadingRow = typeof s.savedReading.$inferSelect;

export async function countReadings<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedScope) {
  const [row] = await tx.select({ n: count() }).from(s.savedReading).where(readingOwner(owner));
  return row?.n ?? 0;
}
export async function listReadings<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedScope, limit: number) {
  return tx.select().from(s.savedReading).where(readingOwner(owner))
    .orderBy(sql`${s.savedReading.readingDate} desc nulls last`, desc(s.savedReading.createdAt), asc(s.savedReading.id)).limit(limit);
}
export async function reading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedScope, id: string) {
  const [row] = await tx.select().from(s.savedReading).where(and(readingOwner(owner), eq(s.savedReading.id, id))).limit(1);
  return row ?? null;
}
/** `id` is given only by the MCP create, which derives it from the owner and the caller's mutationId (src/server/saved/mcp.ts). */
export async function insertReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, value: { id?: string; name: string; date: string | null; kind: SavedKind; ranges: string; verseCount: number }) {
  const [row] = await tx.insert(s.savedReading).values({ ...(value.id ? { id: value.id } : {}), tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId,
    name: value.name, readingDate: value.date, kind: value.kind, ranges: value.ranges, verseCount: value.verseCount }).returning();
  return row;
}
/** Rename, re-date and, with `verses`, revise the ranges and their server-counted verses (0040). Child rows are never touched. */
export async function updateReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, revision: number,
  value: { name: string; date: string | null; verses?: { ranges: string; verseCount: number } }) {
  const verses = value.verses ? { ranges: value.verses.ranges, verseCount: value.verses.verseCount } : {};
  const [row] = await tx.update(s.savedReading).set({ name: value.name, readingDate: value.date, ...verses, revision: revision + 1, updatedAt: sql`now()` })
    .where(and(readingOwner(owner), eq(s.savedReading.id, id), eq(s.savedReading.revision, revision))).returning();
  return row ?? null;
}
/** The member's own hard delete; the child rows go with it through the FK cascade. */
export async function deleteReading<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, id: string, revision: number) {
  const rows = await tx.delete(s.savedReading).where(and(readingOwner(owner), eq(s.savedReading.id, id), eq(s.savedReading.revision, revision))).returning({ id: s.savedReading.id });
  return rows.length === 1;
}

const workOwner = (owner: SavedScope) => and(eq(s.savedVerseWork.tenantId, owner.tenantId), eq(s.savedVerseWork.membershipId, owner.membershipId));
const markOwner = (owner: SavedScope) => and(eq(s.savedVerseMark.tenantId, owner.tenantId), eq(s.savedVerseMark.membershipId, owner.membershipId));
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
export async function workForVerses<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedScope, readingId: string, verses: readonly string[]) {
  if (!verses.length) return [];
  return tx.select().from(s.savedVerseWork).where(and(workOwner(owner), eq(s.savedVerseWork.savedReadingId, readingId), inArray(s.savedVerseWork.verseRef, [...verses])));
}
export async function marksForVerses<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedScope, readingId: string, verses: readonly string[]) {
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

/**
 * The learner directory's reads (readings for everyone, plan D5), under 0054's directory_read policy alone, which the saved
 * access module turns on for a live admin or tutor: how many readings each membership of the tenant keeps, and the name and date
 * of its nearest dated reading from today. Never a note, mark, star or translation: no other saved table is readable on that
 * path. At most 5000 memberships.
 */
export type DirectoryRow = Readonly<{ membershipId: string; readings: number; nearest: Readonly<{ name: string; date: string }> | null }>;
export async function directoryRows<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string): Promise<DirectoryRow[]> {
  const counts = await tx.select({ membershipId: s.savedReading.membershipId, readings: count() }).from(s.savedReading)
    .where(eq(s.savedReading.tenantId, tenantId)).groupBy(s.savedReading.membershipId).orderBy(asc(s.savedReading.membershipId)).limit(5000);
  const nearest = await tx.selectDistinctOn([s.savedReading.membershipId], { membershipId: s.savedReading.membershipId, name: s.savedReading.name, date: s.savedReading.readingDate }).from(s.savedReading)
    .where(and(eq(s.savedReading.tenantId, tenantId), sql`${s.savedReading.readingDate} >= current_date`))
    .orderBy(asc(s.savedReading.membershipId), asc(s.savedReading.readingDate), desc(s.savedReading.createdAt), asc(s.savedReading.id)).limit(5000);
  const next = new Map(nearest.map(row => [row.membershipId, row.date ? Object.freeze({ name: row.name, date: row.date }) : null]));
  return counts.map(row => Object.freeze({ membershipId: row.membershipId, readings: Number(row.readings), nearest: next.get(row.membershipId) ?? null }));
}

// Release 1.7 M3b: the member's own reading preferences, one document per member, replaced under its revision.
const preferenceOwner = (owner: SavedOwner) => and(eq(s.accountPreference.tenantId, owner.tenantId), eq(s.accountPreference.membershipId, owner.membershipId));
export type PreferenceRow = typeof s.accountPreference.$inferSelect;
export async function preferenceRow<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner) {
  const [row] = await tx.select().from(s.accountPreference).where(preferenceOwner(owner)).limit(1);
  return row ?? null;
}
export async function insertPreferences<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, preferences: unknown) {
  const [row] = await tx.insert(s.accountPreference).values({ tenantId: owner.tenantId, membershipId: owner.membershipId, userId: owner.userId, preferences, revision: 1 })
    .onConflictDoNothing().returning();
  return row ?? null;
}
export async function updatePreferences<Q extends PgQueryResultHKT>(tx: Tx<Q>, owner: SavedOwner, expectedRevision: number, preferences: unknown) {
  const [row] = await tx.update(s.accountPreference).set({ preferences, revision: expectedRevision + 1, updatedAt: sql`now()` })
    .where(and(preferenceOwner(owner), eq(s.accountPreference.revision, expectedRevision))).returning();
  return row ?? null;
}
