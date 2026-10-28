import "server-only";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import * as s from "../db/index";

/**
 * Release 1.9 N14/N15 staff-screen reads. Every query is held to one tenant by its own WHERE (and by RLS). They return ids,
 * counts, states and the names staff already see; never an email address or an invitation token.
 */
type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
const LIMIT = 20_001;

/** Live tutor rows per student: the row, its grant and its membership are all live. */
export async function liveTutorCounts<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ studentId: s.tutorStudent.studentId, count: sql<number>`count(*)::int` }).from(s.tutorStudent)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorStudent.tenantId), eq(s.roleGrant.id, s.tutorStudent.tutorGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), isNull(s.tutorStudent.revokedAt), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt)))
    .groupBy(s.tutorStudent.studentId).limit(LIMIT);
}
/**
 * Students with at least one joined parent: a live guardian row, grant and membership, and a verified address. The same rule as
 * joinedParents below, so Needs you and the tutor's family line never disagree about who has joined.
 */
export async function joinedFamilies<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.selectDistinct({ studentId: s.guardian.studentId }).from(s.guardian)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.guardian.tenantId), eq(s.roleGrant.id, s.guardian.parentGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.guardian.tenantId, tenantId), isNull(s.guardian.revokedAt), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt), eq(s.user.emailVerified, true))).limit(LIMIT);
}
/** Parent invitations not accepted and not revoked: only their student and expiry (no address, no token). */
export async function openParentInvites<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ studentId: s.invite.studentId, expiresAt: s.invite.expiresAt }).from(s.invite)
    .where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.role, "parent"), isNull(s.invite.acceptedAt), isNull(s.invite.revokedAt))).limit(LIMIT);
}
/** Confirmed readings: the student, its kind and the snapshot its review state is read from. */
export async function confirmedAssignments<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ studentId: s.assignment.studentId, kind: s.assignment.kind, snapshot: s.assignment.proposalSnapshot }).from(s.assignment)
    .where(and(eq(s.assignment.tenantId, tenantId), eq(s.assignment.status, "confirmed"))).limit(LIMIT);
}
/** Students with any saved honors form. Only the id: no form content leaves this query. */
export async function honorsStarted<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.selectDistinct({ studentId: s.honorsVersion.studentId }).from(s.honorsVersion).where(eq(s.honorsVersion.tenantId, tenantId)).limit(LIMIT);
}

/** Every live tutor row of an enabled student, with the student's name (G11 "Teaches n students"). */
export async function teaching<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ tutorGrantId: s.tutorStudent.tutorGrantId, studentId: s.student.id, firstName: s.student.firstName, lastName: s.student.lastName, ceremonyDate: s.student.ceremonyDate })
    .from(s.tutorStudent).innerJoin(s.student, and(eq(s.student.tenantId, s.tutorStudent.tenantId), eq(s.student.id, s.tutorStudent.studentId)))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), isNull(s.tutorStudent.revokedAt), isNull(s.student.disabledAt)))
    .orderBy(asc(s.tutorStudent.tutorGrantId), asc(s.student.ceremonyDate), asc(s.student.id)).limit(LIMIT);
}
/** One tutor's live rows of enabled students; lock takes the rows for update (after their students are locked). */
export async function handOverLinks<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, grantId: string, lock: boolean) {
  const query = tx.select({ id: s.tutorStudent.id, studentId: s.tutorStudent.studentId }).from(s.tutorStudent)
    .innerJoin(s.student, and(eq(s.student.tenantId, s.tutorStudent.tenantId), eq(s.student.id, s.tutorStudent.studentId)))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.tutorGrantId, grantId), isNull(s.tutorStudent.revokedAt), isNull(s.student.disabledAt)))
    .orderBy(asc(s.tutorStudent.studentId)).limit(501);
  return lock ? query.for("update", { of: s.tutorStudent }) : query;
}

/** A student's joined parents for the tutor's family line: display names only, never an address. */
export async function joinedParents<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  return tx.select({ id: s.guardian.id, name: s.user.name }).from(s.guardian)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.guardian.tenantId), eq(s.roleGrant.id, s.guardian.parentGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.studentId, studentId), isNull(s.guardian.revokedAt), isNull(s.roleGrant.revokedAt),
      isNull(s.membership.disabledAt), eq(s.user.emailVerified, true))).orderBy(asc(s.guardian.id)).limit(9);
}
/** Whether a parent invitation for the student is still open now (sent, not yet accepted). */
export async function parentInvitePending<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, now: Date) {
  const [row] = await tx.select({ id: s.invite.id }).from(s.invite).where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.studentId, studentId), eq(s.invite.role, "parent"),
    isNull(s.invite.acceptedAt), isNull(s.invite.revokedAt), gt(s.invite.expiresAt, now))).limit(1);
  return row !== undefined;
}
/** Whether any parent invitation was ever issued for the student (open, expired, revoked or accepted). */
export async function parentEverInvited<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const [row] = await tx.select({ id: s.invite.id }).from(s.invite).where(and(eq(s.invite.tenantId, tenantId), eq(s.invite.studentId, studentId), eq(s.invite.role, "parent"))).limit(1);
  return row !== undefined;
}
export async function studentKind<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const [row] = await tx.select({ kind: s.student.studentKind }).from(s.student).where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, studentId)));
  return row?.kind;
}

/** Marks a confirmed reading as reviewed for the current date and service, keeping its verses, basis and divisions. */
export async function reconfirm<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, kind: "torah" | "haftarah", expected: number, facts: { confirmationDate: string; serviceSlot: string; readingDate: string | null }) {
  const patch = JSON.stringify({ slotProvenance: 1, serviceSlot: facts.serviceSlot, confirmationDate: facts.confirmationDate, readingDate: facts.readingDate, needsReview: false });
  const [row] = await tx.update(s.assignment).set({ revision: expected + 1, proposalSnapshot: sql`coalesce(${s.assignment.proposalSnapshot}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(and(eq(s.assignment.tenantId, tenantId), eq(s.assignment.studentId, studentId), eq(s.assignment.kind, kind), eq(s.assignment.status, "confirmed"), eq(s.assignment.revision, expected)))
    .returning({ id: s.assignment.id, revision: s.assignment.revision });
  return row ?? null;
}
export async function lockedAssignment<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, kind: "torah" | "haftarah") {
  const [row] = await tx.select({ id: s.assignment.id, revision: s.assignment.revision, status: s.assignment.status, snapshot: s.assignment.proposalSnapshot }).from(s.assignment)
    .where(and(eq(s.assignment.tenantId, tenantId), eq(s.assignment.studentId, studentId), eq(s.assignment.kind, kind))).for("update");
  return row;
}

/** The live tutors' display names per student (the name staff already see on the People page; the service cleans it). */
export async function tutorNames<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  return tx.select({ studentId: s.tutorStudent.studentId, name: s.user.name }).from(s.tutorStudent)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorStudent.tenantId), eq(s.roleGrant.id, s.tutorStudent.tutorGrantId)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId)))
    .innerJoin(s.user, eq(s.user.id, s.membership.userId))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), isNull(s.tutorStudent.revokedAt), isNull(s.roleGrant.revokedAt), isNull(s.membership.disabledAt)))
    .orderBy(asc(s.user.name), asc(s.tutorStudent.tutorGrantId)).limit(LIMIT);
}
/** Verses in each student's confirmed readings (total), and how many the student has marked Got it. Counts only. */
export async function verseCounts<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string) {
  const v = s.assignmentVerse, a = s.assignment, mark = s.verseSelfCheck;
  const confirmed = and(eq(v.tenantId, tenantId), eq(a.status, "confirmed"));
  const total = await tx.select({ studentId: v.studentId, count: sql<number>`count(*)::int` }).from(v)
    .innerJoin(a, and(eq(a.tenantId, v.tenantId), eq(a.id, v.assignmentId))).where(confirmed).groupBy(v.studentId).limit(LIMIT);
  const got = await tx.select({ studentId: v.studentId, count: sql<number>`count(*)::int` }).from(v)
    .innerJoin(a, and(eq(a.tenantId, v.tenantId), eq(a.id, v.assignmentId)))
    .innerJoin(mark, and(eq(mark.tenantId, v.tenantId), eq(mark.studentId, v.studentId), eq(mark.assignmentId, v.assignmentId), eq(mark.verseRef, v.verseRef), eq(mark.state, "got-it")))
    .where(confirmed).groupBy(v.studentId).limit(LIMIT);
  return { total, got };
}
