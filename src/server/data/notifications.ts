import "server-only";
import { and, asc, count, desc, eq, exists, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction, ActiveMode, Actor } from "../access/types";
import { lockRoleGrant } from "./authority";
import { mailbox } from "../runtime/config";
import type { NotificationKind } from "../notifications/schedule";
import * as s from "../db/index";

type Tx<Q extends PgQueryResultHKT> = AccessTransaction<Q>;
const p = s.notificationPreference, d = s.notificationDelivery;
export type PreferenceRow = typeof p.$inferSelect;
export type DeliveryRow = typeof d.$inferSelect;
export type DeliveryStatus = DeliveryRow["status"];

export async function preferences<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string) {
  return tx.select().from(p).where(and(eq(p.tenantId, tenantId), eq(p.membershipId, membershipId)));
}
export async function preference<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, kind: NotificationKind) {
  const [row] = await tx.select().from(p).where(and(eq(p.tenantId, tenantId), eq(p.membershipId, membershipId), eq(p.kind, kind))).limit(1);
  return row ?? null;
}
export async function setPreference<Q extends PgQueryResultHKT>(tx: Tx<Q>, write: { tenantId: string; membershipId: string; userId: string; kind: NotificationKind; enabled: boolean; weekday: number | null; via: "web" | "unsubscribe" }) {
  const [row] = await tx.insert(p).values({ tenantId: write.tenantId, membershipId: write.membershipId, userId: write.userId, kind: write.kind, enabled: write.enabled, weekday: write.weekday, updatedVia: write.via })
    .onConflictDoUpdate({ target: [p.tenantId, p.membershipId, p.kind], set: { enabled: write.enabled, weekday: write.weekday, updatedVia: write.via, revision: sql`${p.revision} + 1`, updatedAt: sql`now()` } })
    .returning();
  return row;
}

/** A recipient's live authority for one role: congregation on, member current, address verified, grant unrevoked. */
export async function liveRecipient<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, role: ActiveMode) {
  const [tenant] = await tx.select({ enabled: s.tenant.enabled, productName: s.tenant.productName }).from(s.tenant).where(eq(s.tenant.id, tenantId)).for("share");
  if (!tenant?.enabled) return null;
  const [member] = await tx.select().from(s.membership).where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, membershipId))).for("share");
  if (!member || member.disabledAt) return null;
  const [user] = await tx.select({ id: s.user.id, email: s.user.email, name: s.user.name, verified: s.user.emailVerified }).from(s.user).where(eq(s.user.id, member.userId)).for("share");
  if (!user?.verified || !mailbox(user.email)) return null;
  const grant = await lockRoleGrant(tx, tenantId, member.id, role, "read");
  if (!grant || grant.revokedAt) return null;
  return Object.freeze({ tenantId, productName: tenant.productName, membershipId: member.id, userId: user.id, email: user.email, name: user.name, grant,
    authorityRevision: member.authorityRevision });
}
export type LiveRecipient = NonNullable<Awaited<ReturnType<typeof liveRecipient>>>;
/** The Actor shape the existing relationship helpers take, for a recipient with no browser session. */
export function recipientActor(recipient: LiveRecipient, origin: string, mode: ActiveMode): Actor {
  return Object.freeze({ tenantId: recipient.tenantId, origin, userId: recipient.userId, authSessionId: "", membershipId: recipient.membershipId,
    authSessionExpiresAt: Number.MAX_SAFE_INTEGER, roleGrantId: recipient.grant.id, roleGrantRevision: recipient.grant.revision, mode, authorityRevision: recipient.authorityRevision });
}

/** The student's live tutors: assignment unrevoked, tutor grant unrevoked, member current. */
export async function assignedTutors<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  return tx.select({ grantId: s.roleGrant.id, membershipId: s.membership.id, userId: s.membership.userId }).from(s.tutorStudent)
    .innerJoin(s.roleGrant, and(eq(s.roleGrant.tenantId, s.tutorStudent.tenantId), eq(s.roleGrant.id, s.tutorStudent.tutorGrantId), eq(s.roleGrant.role, "tutor"), isNull(s.roleGrant.revokedAt)))
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId), isNull(s.membership.disabledAt)))
    .where(and(eq(s.tutorStudent.tenantId, tenantId), eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt)))
    .orderBy(asc(s.membership.id)).limit(20);
}

export async function insertDelivery<Q extends PgQueryResultHKT>(tx: Tx<Q>, row: { tenantId: string; membershipId: string; userId: string; roleGrantId: string; role: "parent" | "student" | "tutor";
  kind: NotificationKind; periodKey: string; studentId: string | null; status: "pending" | "sending" }, at: Date) {
  const [inserted] = await tx.insert(d).values({ ...row, attempts: row.status === "sending" ? 1 : 0, createdAt: at, attemptedAt: row.status === "sending" ? at : null })
    .onConflictDoNothing().returning();
  return inserted ?? null;
}
/** Move one row from `from` to sending, counting the attempt; null when another runner took it or it is spent. */
export async function claimDelivery<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string, from: "pending" | "failed", maxAttempts: number, at: Date) {
  const [row] = await tx.update(d).set({ status: "sending", attempts: sql`${d.attempts} + 1`, attemptedAt: at })
    .where(and(eq(d.tenantId, tenantId), eq(d.id, id), eq(d.status, from), lt(d.attempts, maxAttempts))).returning();
  return row ?? null;
}
export async function finishDelivery<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string, from: DeliveryStatus, status: "sent" | "failed" | "unknown" | "skipped", at: Date) {
  const [row] = await tx.update(d).set({ status, finishedAt: at }).where(and(eq(d.tenantId, tenantId), eq(d.id, id), eq(d.status, from))).returning({ id: d.id });
  return !!row;
}
export async function deliveryIds<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, status: "pending" | "failed", after: Date, limit: number) {
  return (await tx.select({ id: d.id }).from(d).where(and(eq(d.tenantId, tenantId), eq(d.status, status), gt(d.createdAt, after)))
    .orderBy(asc(d.createdAt), asc(d.id)).limit(limit)).map(row => row.id);
}
export async function delivery<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, id: string) {
  const [row] = await tx.select().from(d).where(and(eq(d.tenantId, tenantId), eq(d.id, id))).limit(1);
  return row ?? null;
}
/** True when this member already has this kind sent, being sent or possibly sent for a period on or after `fromDate`. */
export async function recentlyDelivered<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, kind: NotificationKind, fromDate: string) {
  const [row] = await tx.select({ id: d.id }).from(d).where(and(eq(d.tenantId, tenantId), eq(d.membershipId, membershipId), eq(d.kind, kind),
    gte(d.periodKey, fromDate), inArray(d.status, ["sending", "sent", "unknown"]))).limit(1);
  return !!row;
}
/** When this member's last weekly update was handed to the provider, if ever. */
export async function lastDigestAt<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, membershipId: string, excluding: string) {
  const [row] = await tx.select({ at: d.attemptedAt }).from(d).where(and(eq(d.tenantId, tenantId), eq(d.membershipId, membershipId), eq(d.kind, "weekly-digest"),
    inArray(d.status, ["sent", "unknown"]), sql`${d.id} <> ${excluding}`)).orderBy(desc(d.attemptedAt)).limit(1);
  return row?.at ?? null;
}

const liveParent = (tenantId: string) => and(eq(s.roleGrant.tenantId, tenantId), eq(s.roleGrant.role, "parent"), isNull(s.roleGrant.revokedAt));
/** Members who may get a weekly update: a parent of a current student, or an adult student who turned it on. */
export async function digestCandidates<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, limit: number) {
  const parents = await tx.selectDistinct({ membershipId: s.roleGrant.membershipId }).from(s.roleGrant)
    .innerJoin(s.membership, and(eq(s.membership.tenantId, s.roleGrant.tenantId), eq(s.membership.id, s.roleGrant.membershipId), isNull(s.membership.disabledAt)))
    .where(and(liveParent(tenantId), exists(tx.select({ id: s.guardian.id }).from(s.guardian)
      .innerJoin(s.student, and(eq(s.student.tenantId, s.guardian.tenantId), eq(s.student.id, s.guardian.studentId), isNull(s.student.disabledAt)))
      .where(and(eq(s.guardian.tenantId, tenantId), eq(s.guardian.parentGrantId, s.roleGrant.id), isNull(s.guardian.revokedAt))))))
    .orderBy(asc(s.roleGrant.membershipId)).limit(limit);
  const adults = await tx.selectDistinct({ membershipId: p.membershipId }).from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.kind, "weekly-digest"), eq(p.enabled, true))).orderBy(asc(p.membershipId)).limit(limit);
  return [...new Set([...parents, ...adults].map(row => row.membershipId))].sort().slice(0, limit);
}
/** Members who turned the practice reminder on, with their day. */
export async function reminderCandidates<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, limit: number) {
  return tx.select({ membershipId: p.membershipId, weekday: p.weekday }).from(p)
    .where(and(eq(p.tenantId, tenantId), eq(p.kind, "practice-reminder"), eq(p.enabled, true))).orderBy(asc(p.membershipId)).limit(limit);
}

/** The student this student grant signs in as, while that link is live and the student current. */
export async function ownStudent<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, grantId: string) {
  const [row] = await tx.select({ id: s.student.id }).from(s.studentIdentity)
    .innerJoin(s.student, and(eq(s.student.tenantId, s.studentIdentity.tenantId), eq(s.student.id, s.studentIdentity.studentId)))
    .where(and(eq(s.studentIdentity.tenantId, tenantId), eq(s.studentIdentity.roleGrantId, grantId), isNull(s.studentIdentity.revokedAt), isNull(s.student.disabledAt))).limit(1);
  return row?.id ?? null;
}
export async function serviceSlot<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string) {
  const [row] = await tx.select({ slot: s.student.serviceSlot }).from(s.student).where(and(eq(s.student.tenantId, tenantId), eq(s.student.id, studentId))).limit(1);
  return row?.slot ?? "unknown";
}
/** Current lesson-log entries dated in [fromDate, throughDate], newest first, as a parent's lesson page shows them. */
export async function lessonsBetween<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, fromDate: string, throughDate: string, limit: number) {
  const t = s.lessonLog;
  return tx.select({ lessonDate: t.lessonDate, summary: t.summary, name: s.user.name }).from(t).innerJoin(s.user, eq(s.user.id, t.creatorUserId))
    .where(and(eq(t.tenantId, tenantId), eq(t.studentId, studentId), eq(t.deleted, false), gte(t.lessonDate, fromDate), lte(t.lessonDate, throughDate)))
    .orderBy(desc(t.lessonDate), desc(t.entryId)).limit(limit);
}
/** How many verse notes tutors or staff saved for this student after `since`. */
export async function verseNotesSince<Q extends PgQueryResultHKT>(tx: Tx<Q>, tenantId: string, studentId: string, since: Date) {
  const t = s.tutorNote;
  const [row] = await tx.select({ n: count() }).from(t).where(and(eq(t.tenantId, tenantId), eq(t.studentId, studentId), gt(t.createdAt, since)));
  return row?.n ?? 0;
}
