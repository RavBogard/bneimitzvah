import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import type { ProgressActor } from "./progress";
import type { GuideBody } from "../study-guides/validation";
import * as s from "../db/index";

/**
 * The rabbi, as established by a rabbi authority (portal MCP delegation or the operator bridge),
 * re-locked inside the same transaction that writes. Never built from request input.
 */
export type RabbiWriter = Readonly<{ tenantId: string; userId: string; membershipId: string; roleGrantId: string; channel: "mcp" | "operator"; mayReview: boolean }>;
export type GuideKind = "torah" | "haftarah";
export type VoiceRow = typeof s.studyVoice.$inferSelect;
export type GuideRow = typeof s.studyGuide.$inferSelect;
export type StudentGuideRow = typeof s.studyGuideStudent.$inferSelect;

const actorValues = (writer: RabbiWriter, mutationId: string, requestDigest: string) => ({
  actorUserId: writer.userId, actorMembershipId: writer.membershipId, roleGrantId: writer.roleGrantId, role: "admin" as const, mode: "admin" as const,
  channel: writer.channel, mutationId, requestDigest,
});
async function audit<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, action: "study-voice.set" | "study-guide.set" | "study-guide.publish" | "study-guide-student.set",
  targetType: string, targetId: string, studentId: string | null) {
  await tx.insert(s.auditEvent).values({ tenantId: writer.tenantId, actorUserId: writer.userId, actorMembershipId: writer.membershipId, roleGrantId: writer.roleGrantId,
    mode: "admin", actingStudentId: studentId, action, targetType, targetId, requestId: randomUUID() });
}
const versions = (expected: number) => ({ version: expected + 1, baseVersion: expected, previousVersion: expected === 0 ? null : expected });

// Voice ------------------------------------------------------------------------------------------
export async function voiceHead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string) {
  const t = s.studyVoice;
  const [row] = await tx.select().from(t).where(eq(t.tenantId, tenantId)).orderBy(desc(t.version)).limit(1);
  return row ?? null;
}
export async function voiceReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, mutationId: string) {
  const t = s.studyVoice;
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, writer.tenantId), eq(t.actorUserId, writer.userId), eq(t.mutationId, mutationId))).limit(1);
  return row ?? null;
}
export async function appendVoice<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, expected: number, body: string, mutationId: string, digest: string) {
  const [row] = await tx.insert(s.studyVoice).values({ tenantId: writer.tenantId, ...versions(expected), body, ...actorValues(writer, mutationId, digest) }).onConflictDoNothing().returning();
  if (row) await audit(tx, writer, "study-voice.set", "study_voice", row.id, null);
  return row ?? null;
}

// Base guide -------------------------------------------------------------------------------------
/** All versions of one guide stream are few (one per save); read the head and the latest visible. */
export async function guideHeads<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, kind: GuideKind, readingKey: string) {
  const t = s.studyGuide, where = and(eq(t.tenantId, tenantId), eq(t.kind, kind), eq(t.readingKey, readingKey));
  const [head] = await tx.select().from(t).where(where).orderBy(desc(t.version)).limit(1);
  const [visible] = await tx.select().from(t).where(and(where, eq(t.hold, false))).orderBy(desc(t.version)).limit(1);
  const [reviewed] = await tx.select({ version: t.version }).from(t).where(and(where, eq(t.reviewed, true))).orderBy(desc(t.version)).limit(1);
  return { head: head ?? null, visible: visible ?? null, anyReviewed: !!reviewed };
}
export async function guideReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, mutationId: string) {
  const t = s.studyGuide;
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, writer.tenantId), eq(t.actorUserId, writer.userId), eq(t.mutationId, mutationId))).limit(1);
  return row ?? null;
}
export async function appendGuide<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, write: {
  kind: GuideKind; readingKey: string; expected: number; origin: "claude" | "rabbi"; reviewed: boolean; hold: boolean; body: GuideBody; mutationId: string; digest: string; publish: boolean;
}) {
  const [row] = await tx.insert(s.studyGuide).values({ tenantId: writer.tenantId, kind: write.kind, readingKey: write.readingKey, ...versions(write.expected),
    origin: write.origin, reviewed: write.reviewed, hold: write.hold, body: write.body, ...actorValues(writer, write.mutationId, write.digest) }).onConflictDoNothing().returning();
  if (row) await audit(tx, writer, write.publish ? "study-guide.publish" : "study-guide.set", "study_guide", row.id, null);
  return row ?? null;
}
/** Every (kind, readingKey) stream's head, for the "what needs a guide" list. */
export async function guideStreams<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string) {
  const t = s.studyGuide;
  return tx.selectDistinctOn([t.kind, t.readingKey], { kind: t.kind, readingKey: t.readingKey, version: t.version, reviewed: t.reviewed, hold: t.hold, createdAt: t.createdAt })
    .from(t).where(eq(t.tenantId, tenantId)).orderBy(t.kind, t.readingKey, desc(t.version)).limit(1000);
}

// Per-student additions --------------------------------------------------------------------------
export async function studentGuideHead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, assignmentId: string, assignmentRevision: number, kind: GuideKind) {
  const t = s.studyGuideStudent;
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, tenantId), eq(t.studentId, studentId), eq(t.assignmentId, assignmentId),
    eq(t.assignmentRevision, assignmentRevision), eq(t.kind, kind))).orderBy(desc(t.version)).limit(1);
  return row ?? null;
}
export async function studentGuideReceipt<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, mutationId: string) {
  const t = s.studyGuideStudent;
  const [row] = await tx.select().from(t).where(and(eq(t.tenantId, writer.tenantId), eq(t.actorUserId, writer.userId), eq(t.mutationId, mutationId))).limit(1);
  return row ?? null;
}
export async function appendStudentGuide<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, writer: RabbiWriter, write: {
  studentId: string; assignmentId: string; assignmentRevision: number; kind: GuideKind; expected: number; origin: "claude" | "rabbi"; reviewed: boolean; body: GuideBody; mutationId: string; digest: string;
}) {
  const [row] = await tx.insert(s.studyGuideStudent).values({ tenantId: writer.tenantId, studentId: write.studentId, assignmentId: write.assignmentId,
    assignmentRevision: write.assignmentRevision, kind: write.kind, ...versions(write.expected), origin: write.origin, reviewed: write.reviewed, body: write.body,
    ...actorValues(writer, write.mutationId, write.digest) }).onConflictDoNothing().returning();
  if (row) await audit(tx, writer, "study-guide-student.set", "study_guide_student", row.id, write.studentId);
  return row ?? null;
}

// Theme ticks ------------------------------------------------------------------------------------
export async function themeReads<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, tenantId: string, studentId: string, kind: GuideKind, readingKey: string) {
  const t = s.studyThemeRead;
  return tx.select({ themeId: t.themeId, state: t.state, version: t.version }).from(t)
    .where(and(eq(t.tenantId, tenantId), eq(t.studentId, studentId), eq(t.kind, kind), eq(t.readingKey, readingKey))).limit(200);
}
export async function lockThemeRead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, kind: GuideKind, readingKey: string, themeId: string) {
  const t = s.studyThemeRead;
  const [row] = await tx.select({ id: t.id, state: t.state, version: t.version }).from(t).where(and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId),
    eq(t.kind, kind), eq(t.readingKey, readingKey), eq(t.themeId, themeId))).for("update");
  return row ?? null;
}
export async function changeThemeRead<Q extends PgQueryResultHKT>(tx: AccessTransaction<Q>, actor: ProgressActor, write: { kind: GuideKind; readingKey: string; themeId: string; state: "read" | "unread"; expected: number }, exists: boolean) {
  const t = s.studyThemeRead, values = { state: write.state, version: write.expected + 1, updatedAt: new Date() };
  const key = and(eq(t.tenantId, actor.tenantId), eq(t.studentId, actor.studentId), eq(t.kind, write.kind), eq(t.readingKey, write.readingKey), eq(t.themeId, write.themeId));
  const [row] = exists
    ? await tx.update(t).set(values).where(and(key, eq(t.version, write.expected))).returning({ id: t.id, state: t.state, version: t.version })
    : await tx.insert(t).values({ tenantId: actor.tenantId, studentId: actor.studentId, kind: write.kind, readingKey: write.readingKey, themeId: write.themeId, ...values })
      .onConflictDoNothing().returning({ id: t.id, state: t.state, version: t.version });
  if (row) await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId,
    mode: actor.mode, actingStudentId: actor.studentId, guardianId: actor.mode === "child-practice" ? actor.relationshipId : null,
    action: "study-theme.read", targetType: "study_theme_read", targetId: row.id, requestId: randomUUID() });
  return row ?? null;
}
