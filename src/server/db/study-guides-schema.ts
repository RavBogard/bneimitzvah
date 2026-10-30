import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assignment, contextMode, membership, readingKind, role, roleGrant, student, tenant } from "./tenant-schema";
import type { GuideBody } from "../study-guides/validation";

// Shared actor/receipt columns for the three append-only study tables. Every
// write names the rabbi's own membership and admin grant, whichever channel
// carried it (the portal MCP, or the reviewed operator bridge script).
const actor = () => ({
  actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").notNull(), mode: contextMode("mode").notNull(), channel: text("channel").notNull(),
  mutationId: uuid("mutation_id").notNull(), requestDigest: text("request_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function actorConstraints(name: string, t: any, channels = "'mcp','operator'") {
  return [
    foreignKey({ name: `${name}_actor_fk`, columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
    foreignKey({ name: `${name}_grant_fk`, columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
    foreignKey({ name: `${name}_role_fk`, columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
    // Rabbi only (S21): the admin role in admin mode, never a tutor, parent or student.
    check(`${name}_rabbi`, sql`${t.role}='admin' and ${t.mode}='admin'`),
    check(`${name}_channel`, sql.raw(`"${name}"."channel" in (${channels})`)),
    check(`${name}_digest`, sql`${t.requestDigest} ~ '^[a-f0-9]{64}$'`),
    check(`${name}_instant`, sql`isfinite(${t.createdAt})`),
  ];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const versions = (t: any) => sql`${t.version} > 0 and ${t.baseVersion} >= 0 and ${t.version}::bigint = ${t.baseVersion}::bigint + 1 and ((${t.baseVersion}=0 and ${t.previousVersion} is null) or (${t.baseVersion}>0 and ${t.previousVersion} is not null and ${t.previousVersion}=${t.baseVersion}))`;
const readingKeyCheck = (column: unknown) => sql`octet_length(${column}) <= 160 and ${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`;

/** The congregation's study voice, append-only; head = max version. */
export const studyVoice = pgTable("study_voice", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  body: text("body").notNull(), ...actor(),
}, t => [
  unique("study_voice_stream_key").on(t.tenantId, t.version),
  unique("study_voice_receipt_key").on(t.tenantId, t.actorUserId, t.mutationId),
  foreignKey({ name: "study_voice_previous_fk", columns: [t.tenantId, t.previousVersion], foreignColumns: [t.tenantId, t.version] }),
  check("study_voice_versions", versions(t)),
  check("study_voice_body", sql`public.portal_study_markdown(${t.body}, 32768)`),
  // The operator bridge writes Claude-drafted base guides only (spec §3a).
  check("study_voice_mcp_only", sql`${t.channel} = 'mcp'`),
  ...actorConstraints("study_voice", t),
]);

/** The per-reading base guide, append-only. Students see the latest version with hold=false. */
export const studyGuide = pgTable("study_guide", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  kind: readingKind("kind").notNull(), readingKey: text("reading_key").notNull(),
  version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  origin: text("origin").notNull(), reviewed: boolean("reviewed").notNull(), hold: boolean("hold").notNull(),
  body: jsonb("body").$type<GuideBody>().notNull(), ...actor(),
  // Migration 0055 (guide sharing): the original author's display name and the content key of a guide that arrived by import.
  importCredit: text("import_credit"), importKey: text("import_key"),
}, t => [
  unique("study_guide_stream_key").on(t.tenantId, t.kind, t.readingKey, t.version),
  unique("study_guide_receipt_key").on(t.tenantId, t.actorUserId, t.mutationId),
  foreignKey({ name: "study_guide_previous_fk", columns: [t.tenantId, t.kind, t.readingKey, t.previousVersion], foreignColumns: [t.tenantId, t.kind, t.readingKey, t.version] }),
  check("study_guide_versions", versions(t)),
  check("study_guide_kind", sql`${t.kind} in ('torah','haftarah')`),
  check("study_guide_reading_key", readingKeyCheck(t.readingKey)),
  check("study_guide_origin", sql`${t.origin} in ('claude','rabbi')`),
  check("study_guide_body", sql`public.portal_study_guide_body_valid(${t.body}, true)`),
  check("study_guide_operator_draft", sql`${t.channel} in ('mcp','web') or (${t.origin} = 'claude' and not ${t.reviewed})`),
  // An import arrives from the web as a held, unreviewed version-one draft with its credit; only that channel may carry import provenance in.
  check("study_guide_web_import", sql`${t.channel} <> 'web' or (${t.version} = 1 and ${t.hold} and not ${t.reviewed} and ${t.importCredit} is not null and ${t.importKey} is not null)`),
  check("study_guide_import_whole", sql`(${t.importCredit} is null) = (${t.importKey} is null)`),
  check("study_guide_import_credit", sql`${t.importCredit} is null or (public.portal_source_plain(${t.importCredit}, 240) and strpos(${t.importCredit}, '@') = 0)`),
  check("study_guide_import_key", sql`${t.importKey} is null or ${t.importKey} ~ '^[a-f0-9]{64}$'`),
  // The same content is imported into a reading once: a second import of the same file finds this row and adds nothing.
  uniqueIndex("study_guide_import_once").on(t.tenantId, t.kind, t.readingKey, t.importKey).where(sql`${t.channel} = 'web'`),
  ...actorConstraints("study_guide", t, "'mcp','operator','web'"),
]);

/** Rabbi-only per-student additions, bound to one assignment revision and inert after it bumps. */
export const studyGuideStudent = pgTable("study_guide_student", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  assignmentId: uuid("assignment_id").notNull(), assignmentRevision: integer("assignment_revision").notNull(), kind: readingKind("kind").notNull(),
  version: integer("version").notNull(), baseVersion: integer("base_version").notNull(), previousVersion: integer("previous_version"),
  origin: text("origin").notNull(), reviewed: boolean("reviewed").notNull(),
  body: jsonb("body").$type<GuideBody>().notNull(), ...actor(),
}, t => [
  unique("study_guide_student_stream_key").on(t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.kind, t.version),
  unique("study_guide_student_receipt_key").on(t.tenantId, t.actorUserId, t.mutationId),
  foreignKey({ name: "study_guide_student_previous_fk", columns: [t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.kind, t.previousVersion], foreignColumns: [t.tenantId, t.studentId, t.assignmentId, t.assignmentRevision, t.kind, t.version] }),
  foreignKey({ name: "study_guide_student_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "study_guide_student_reading_fk", columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  check("study_guide_student_versions", sql`${versions(t)} and ${t.assignmentRevision} > 0`),
  check("study_guide_student_kind", sql`${t.kind} in ('torah','haftarah')`),
  check("study_guide_student_origin", sql`${t.origin} in ('claude','rabbi')`),
  check("study_guide_student_body", sql`public.portal_study_guide_body_valid(${t.body}, false)`),
  check("study_guide_student_mcp_only", sql`${t.channel} = 'mcp'`),
  ...actorConstraints("study_guide_student", t),
]);

/** "I read this" per theme: a mutable head keyed by reading key so ticks survive guide versions. */
export const studyThemeRead = pgTable("study_theme_read", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(),
  kind: readingKind("kind").notNull(), readingKey: text("reading_key").notNull(), themeId: text("theme_id").notNull(),
  state: text("state").notNull(), version: integer("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  unique("study_theme_read_head_key").on(t.tenantId, t.studentId, t.kind, t.readingKey, t.themeId),
  foreignKey({ name: "study_theme_read_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  check("study_theme_read_version_positive", sql`${t.version} > 0`),
  check("study_theme_read_kind", sql`${t.kind} in ('torah','haftarah')`),
  check("study_theme_read_reading_key", readingKeyCheck(t.readingKey)),
  // Base theme ids are plain slugs; a per-student addition's theme is stored as student--<slug>, which no slug can spell.
  check("study_theme_read_theme", sql`octet_length(${t.themeId}) <= 73 and ${t.themeId} ~ '^(student--)?[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("study_theme_read_state", sql`${t.state} in ('read','unread')`),
  check("study_theme_read_instant", sql`isfinite(${t.updatedAt})`),
]);
