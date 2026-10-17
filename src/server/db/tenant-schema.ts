import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { session, user } from "./auth-schema";

export const role = pgEnum("portal_role", ["student", "parent", "tutor", "admin"]);
export const contextMode = pgEnum("context_mode", ["student", "parent", "tutor", "admin", "child-practice"]);
export const readingKind = pgEnum("reading_kind", ["torah", "haftarah", "blessing-before", "blessing-after"]);
export const readingBasis = pgEnum("reading_basis", ["triennial", "selection", "full", "custom"]);
const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const revokedAt = () => timestamp("revoked_at", { withTimezone: true });
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);

export const tenant = pgTable("tenant", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  productName: text("product_name").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  customs: jsonb("customs").$type<Record<string, unknown>>().default({}).notNull(),
});

// Exact host directory is readable before a tenant transaction; no family data.
export const tenantHost = pgTable("tenant_host", {
  host: text("host").primaryKey(), tenantId: tenantId(),
  environment: text("environment").notNull(), deployment: text("deployment").notNull(),
  origin: text("origin").notNull(),
}, (t) => [
  unique("tenant_host_tenant_key").on(t.tenantId, t.host),
  check("tenant_host_environment", sql`${t.environment} in ('production', 'preview', 'local', 'test')`),
  check("tenant_host_normalized", sql`${t.host} = lower(${t.host}) and length(${t.host}) > 0`),
]);

export const membership = pgTable("membership", {
  id: id(), tenantId: tenantId(), userId: text("user_id").notNull().references(() => user.id),
  disabledAt: timestamp("disabled_at", { withTimezone: true }), authorityRevision: integer("authority_revision").default(1).notNull(), createdAt: createdAt(),
}, (t) => [
  unique("membership_tenant_id_key").on(t.tenantId, t.id),
  unique("membership_tenant_user_key").on(t.tenantId, t.userId),
  unique("membership_actor_key").on(t.tenantId, t.id, t.userId),
  check("membership_revision_positive", sql`${t.authorityRevision} > 0`),
]);

export const roleGrant = pgTable("role_grant", {
  id: id(), tenantId: tenantId(), membershipId: uuid("membership_id").notNull(), role: role("role").notNull(),
  isCantor: boolean("is_cantor").default(false).notNull(), revision: integer("revision").default(1).notNull(), createdAt: createdAt(), revokedAt: revokedAt(),
}, (t) => [
  unique("role_grant_tenant_id_key").on(t.tenantId, t.id),
  unique("role_grant_typed_key").on(t.tenantId, t.id, t.role),
  unique("role_grant_actor_key").on(t.tenantId, t.id, t.membershipId),
  foreignKey({ name: "role_grant_membership_fk", columns: [t.tenantId, t.membershipId], foreignColumns: [membership.tenantId, membership.id] }),
  uniqueIndex("role_grant_active_key").on(t.tenantId, t.membershipId, t.role).where(sql`${t.revokedAt} is null`),
  check("role_grant_revision_positive", sql`${t.revision} > 0`),
  check("role_grant_cantor_tutor", sql`not ${t.isCantor} or ${t.role} = 'tutor'`),
]);

export type StudentImportMetadata={version:1;parent1Name:string|null;householdPhone:string|null;parent2Name:string|null;parashahLabel:string|null;tutorName:string|null;
  tutorMatch:{status:"matched";grantId:string}|{status:"unmatched"|"ambiguous"}|null;adminNotes:string|null};
export const student = pgTable("student", {
  id: id(), tenantId: tenantId(), firstName: text("first_name").notNull(), lastName: text("last_name").notNull(),
  studentKind: text("student_kind").$type<"child" | "adult">().default("child").notNull(),
  serviceSlot: text("service_slot").$type<"morning" | "havdalah" | "unknown">().default("unknown").notNull(),
  ceremonyDate: date("ceremony_date").notNull(), parentEmail: text("parent_email"), ownEmail: text("own_email"),
  hebrewName: text("hebrew_name"), secondParentEmail: text("second_parent_email"), importMetadata: jsonb("import_metadata").$type<StudentImportMetadata>(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }), revision: integer("revision").default(1).notNull(), createdAt: createdAt(),
}, (t) => [
  unique("student_tenant_id_key").on(t.tenantId, t.id),
  check("student_service_slot_known", sql`${t.serviceSlot} in ('morning', 'havdalah', 'unknown')`),
  check("student_kind_known", sql`${t.studentKind} in ('child', 'adult')`),
  check("student_contacts_required", sql`(${t.parentEmail} is null or length(trim(${t.parentEmail})) > 0) and (${t.ownEmail} is null or length(trim(${t.ownEmail})) > 0) and ((${t.studentKind} = 'child' and ${t.parentEmail} is not null) or (${t.studentKind} = 'adult' and ${t.ownEmail} is not null))`),
  check("student_names_required", sql`length(trim(${t.firstName})) > 0 and length(trim(${t.lastName})) > 0`),
  check("student_revision_positive", sql`${t.revision} > 0`),
  check("student_hebrew_name_bounded", sql`${t.hebrewName} is null or (length(trim(${t.hebrewName})) > 0 and octet_length(${t.hebrewName}) <= 400)`),
  check("student_second_parent_bounded", sql`${t.secondParentEmail} is null or (length(trim(${t.secondParentEmail})) > 0 and octet_length(${t.secondParentEmail}) <= 254)`),
  check("student_import_metadata_closed", sql`${t.importMetadata} is null or coalesce(
    jsonb_typeof(${t.importMetadata}) = 'object' and ${t.importMetadata}->'version' = '1'::jsonb
    and ${t.importMetadata} ?& array['version','parent1Name','householdPhone','parent2Name','parashahLabel','tutorName','tutorMatch','adminNotes']
    and ${t.importMetadata} - array['version','parent1Name','householdPhone','parent2Name','parashahLabel','tutorName','tutorMatch','adminNotes']::text[] = '{}'::jsonb
    and (${t.importMetadata}->'parent1Name' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'parent1Name') = 'string' and octet_length(${t.importMetadata}->>'parent1Name') <= 400))
    and (${t.importMetadata}->'householdPhone' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'householdPhone') = 'string' and octet_length(${t.importMetadata}->>'householdPhone') <= 100))
    and (${t.importMetadata}->'parent2Name' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'parent2Name') = 'string' and octet_length(${t.importMetadata}->>'parent2Name') <= 400))
    and (${t.importMetadata}->'parashahLabel' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'parashahLabel') = 'string' and octet_length(${t.importMetadata}->>'parashahLabel') <= 400))
    and (${t.importMetadata}->'tutorName' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'tutorName') = 'string' and octet_length(${t.importMetadata}->>'tutorName') <= 400))
    and (${t.importMetadata}->'adminNotes' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'adminNotes') = 'string' and octet_length(${t.importMetadata}->>'adminNotes') <= 4096))
    and (${t.importMetadata}->'tutorMatch' = 'null'::jsonb or (jsonb_typeof(${t.importMetadata}->'tutorMatch') = 'object' and (
      (${t.importMetadata}->'tutorMatch'->>'status' = 'matched' and ${t.importMetadata}->'tutorMatch' ? 'grantId'
        and (${t.importMetadata}->'tutorMatch') - array['status','grantId']::text[] = '{}'::jsonb
        and ${t.importMetadata}->'tutorMatch'->>'grantId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or (${t.importMetadata}->'tutorMatch'->>'status' in ('unmatched','ambiguous') and (${t.importMetadata}->'tutorMatch') - 'status' = '{}'::jsonb)
    ))), false)`),
]);

export const studentIdentity = pgTable("student_identity", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), roleGrantId: uuid("role_grant_id").notNull(),
  role: role("role").default("student").notNull(), createdAt: createdAt(), revokedAt: revokedAt(),
}, (t) => [
  unique("student_identity_tenant_id_key").on(t.tenantId, t.id),
  unique("student_identity_context_key").on(t.tenantId, t.id, t.studentId, t.roleGrantId),
  foreignKey({ name: "student_identity_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_identity_grant_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("student_identity_role", sql`${t.role} = 'student'`),
  uniqueIndex("student_identity_active_student_key").on(t.tenantId, t.studentId).where(sql`${t.revokedAt} is null`),
  uniqueIndex("student_identity_active_grant_key").on(t.tenantId, t.roleGrantId).where(sql`${t.revokedAt} is null`),
]);

export const guardian = pgTable("guardian", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), parentGrantId: uuid("parent_grant_id").notNull(),
  role: role("role").default("parent").notNull(), practiceEnabled: boolean("practice_enabled").default(true).notNull(), revision: integer("revision").default(1).notNull(),
  linkProvenance: text("link_provenance").notNull(), createdAt: createdAt(), revokedAt: revokedAt(),
}, (t) => [
  unique("guardian_tenant_id_key").on(t.tenantId, t.id),
  unique("guardian_context_key").on(t.tenantId, t.id, t.studentId, t.parentGrantId),
  foreignKey({ name: "guardian_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "guardian_grant_fk", columns: [t.tenantId, t.parentGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("guardian_revision_positive", sql`${t.revision} > 0`),
  check("guardian_parent_role", sql`${t.role} = 'parent'`),
  uniqueIndex("guardian_active_key").on(t.tenantId, t.studentId, t.parentGrantId).where(sql`${t.revokedAt} is null`),
]);

export const tutorStudent = pgTable("tutor_student", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), tutorGrantId: uuid("tutor_grant_id").notNull(),
  role: role("role").default("tutor").notNull(), createdAt: createdAt(), revokedAt: revokedAt(),
}, (t) => [
  unique("tutor_student_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "tutor_student_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "tutor_student_grant_fk", columns: [t.tenantId, t.tutorGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  check("tutor_student_role", sql`${t.role} = 'tutor'`),
  uniqueIndex("tutor_student_active_key").on(t.tenantId, t.studentId, t.tutorGrantId).where(sql`${t.revokedAt} is null`),
]);

export const invite = pgTable("invite", {
  id: id(), tenantId: tenantId(), tokenHash: text("token_hash").notNull().unique(), email: text("email").notNull(),
  role: role("role").notNull(), studentId: uuid("student_id"), inviterMembershipId: uuid("inviter_membership_id").notNull(),
  acceptedMembershipId: uuid("accepted_membership_id"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  deliveryStatus: text("delivery_status").$type<"pending" | "sent" | "failed">().default("pending").notNull(),
  deliveryAttemptedAt: timestamp("delivery_attempted_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }), revokedAt: revokedAt(), createdAt: createdAt(),
}, (t) => [
  unique("invite_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "invite_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "invite_inviter_fk", columns: [t.tenantId, t.inviterMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  foreignKey({ name: "invite_acceptor_fk", columns: [t.tenantId, t.acceptedMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  check("invite_role_target", sql`(${t.role} in ('parent', 'student') and ${t.studentId} is not null) or (${t.role} = 'tutor' and ${t.studentId} is null)`),
  check("invite_acceptance_pair", sql`(${t.acceptedAt} is null) = (${t.acceptedMembershipId} is null)`),
  check("invite_not_accepted_revoked", sql`not (${t.acceptedAt} is not null and ${t.revokedAt} is not null)`),
  check("invite_delivery_shape", sql`(${t.deliveryStatus} = 'pending' and ${t.deliveryAttemptedAt} is null) or (${t.deliveryStatus} in ('sent','failed') and ${t.deliveryAttemptedAt} is not null)`),
  check("invite_email_normalized", sql`${t.email} = lower(trim(${t.email})) and length(${t.email}) > 0`),
  check("invite_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  check("invite_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);

export const practiceContext = pgTable("practice_context", {
  id: id(), tenantId: tenantId(), tokenHash: text("token_hash").notNull().unique(),
  authSessionId: text("auth_session_id").notNull(), actorUserId: text("actor_user_id").notNull(), actorMembershipId: uuid("actor_membership_id").notNull(),
  roleGrantId: uuid("role_grant_id").notNull(), role: role("role").notNull(), mode: contextMode("mode").notNull(),
  actingStudentId: uuid("acting_student_id"), guardianId: uuid("guardian_id"), studentIdentityId: uuid("student_identity_id"),
  authorityRevision: integer("authority_revision").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: revokedAt(), createdAt: createdAt(),
}, (t) => [
  unique("practice_context_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "context_session_actor_fk", columns: [t.authSessionId, t.actorUserId], foreignColumns: [session.id, session.userId] }).onDelete("cascade"),
  foreignKey({ name: "context_membership_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "context_grant_actor_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "context_grant_role_fk", columns: [t.tenantId, t.roleGrantId, t.role], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.role] }),
  foreignKey({ name: "context_student_fk", columns: [t.tenantId, t.actingStudentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "context_guardian_pair_fk", columns: [t.tenantId, t.guardianId, t.actingStudentId, t.roleGrantId], foreignColumns: [guardian.tenantId, guardian.id, guardian.studentId, guardian.parentGrantId] }),
  foreignKey({ name: "context_student_identity_fk", columns: [t.tenantId, t.studentIdentityId, t.actingStudentId, t.roleGrantId], foreignColumns: [studentIdentity.tenantId, studentIdentity.id, studentIdentity.studentId, studentIdentity.roleGrantId] }),
  check("context_mode_shape", sql`(
    (${t.mode} = 'child-practice' and ${t.role} = 'parent' and ${t.actingStudentId} is not null and ${t.guardianId} is not null and ${t.studentIdentityId} is null)
    or (${t.mode} = 'student' and ${t.role} = 'student' and ${t.actingStudentId} is not null and ${t.guardianId} is null and ${t.studentIdentityId} is not null)
    or (${t.mode}::text = ${t.role}::text and ${t.mode} in ('admin', 'tutor', 'parent') and ${t.actingStudentId} is null and ${t.guardianId} is null and ${t.studentIdentityId} is null)
  )`),
  check("context_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
  check("context_revision_positive", sql`${t.authorityRevision} > 0`),
  check("context_hash", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
]);

export const hebcalCache = pgTable("hebcal_cache", {
  id: id(), requestKey: text("request_key").notNull().unique(), requestDate: date("request_date").notNull(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const assignment = pgTable("assignment", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), kind: readingKind("kind").notNull(), basis: readingBasis("basis").notNull(),
  ref: text("ref").notNull(), status: text("status").default("proposed").notNull(), revision: integer("revision").default(1).notNull(),
  setByMembershipId: uuid("set_by_membership_id").notNull(), proposalCacheId: uuid("proposal_cache_id").references(() => hebcalCache.id),
  proposalSnapshot: jsonb("proposal_snapshot").$type<Record<string, unknown>>(), createdAt: createdAt(),
  aliyahStarts: text("aliyah_starts").array(),
}, (t) => [
  unique("assignment_tenant_id_key").on(t.tenantId, t.id),
  unique("assignment_student_key").on(t.tenantId, t.id, t.studentId),
  unique("assignment_current_kind_key").on(t.tenantId, t.studentId, t.kind),
  foreignKey({ name: "assignment_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "assignment_author_fk", columns: [t.tenantId, t.setByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  check("assignment_status", sql`${t.status} in ('proposed', 'confirmed')`),
  check("assignment_revision_positive", sql`${t.revision} > 0`),
  check("assignment_ref_required", sql`length(trim(${t.ref})) > 0`),
  check("assignment_aliyah_starts_shape", sql`${t.aliyahStarts} is null or (${t.kind} = 'torah' and cardinality(${t.aliyahStarts}) <= 999 and (cardinality(${t.aliyahStarts}) = 0 or (array_ndims(${t.aliyahStarts}) = 1 and array_lower(${t.aliyahStarts}, 1) = 1)) and array_position(${t.aliyahStarts}, null) is null)`),
]);

export const assignmentVerse = pgTable("assignment_verse", {
  id: id(), tenantId: tenantId(), assignmentId: uuid("assignment_id").notNull(), studentId: uuid("student_id").notNull(),
  ordinal: integer("ordinal").notNull(), verseRef: text("verse_ref").notNull(),
}, (t) => [
  unique("assignment_verse_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "assignment_verse_parent_fk", columns: [t.tenantId, t.assignmentId, t.studentId], foreignColumns: [assignment.tenantId, assignment.id, assignment.studentId] }),
  foreignKey({ name: "assignment_verse_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  unique("assignment_verse_ordinal_key").on(t.tenantId, t.assignmentId, t.ordinal),
  unique("assignment_verse_ref_key").on(t.tenantId, t.assignmentId, t.verseRef),
  check("assignment_verse_positive_ordinal", sql`${t.ordinal} > 0`),
  check("assignment_verse_full_ref", sql`${t.verseRef} ~ '^[[:alpha:] 0-9]+ [1-9][0-9]*:[1-9][0-9]*$'`),
]);

export const auditEvent = pgTable("audit_event", {
  id: id(), tenantId: tenantId(), actorUserId: text("actor_user_id").notNull().references(() => user.id),
  actorMembershipId: uuid("actor_membership_id").notNull(), mode: contextMode("mode").notNull(), actingStudentId: uuid("acting_student_id"),
  roleGrantId: uuid("role_grant_id").notNull(), guardianId: uuid("guardian_id"), action: text("action").notNull(),
  targetType: text("target_type").notNull(), targetId: text("target_id").notNull(), requestId: uuid("request_id").notNull(), createdAt: createdAt(),
}, (t) => [
  unique("audit_event_tenant_id_key").on(t.tenantId, t.id),
  foreignKey({ name: "audit_actor_fk", columns: [t.tenantId, t.actorMembershipId, t.actorUserId], foreignColumns: [membership.tenantId, membership.id, membership.userId] }),
  foreignKey({ name: "audit_grant_fk", columns: [t.tenantId, t.roleGrantId, t.actorMembershipId], foreignColumns: [roleGrant.tenantId, roleGrant.id, roleGrant.membershipId] }),
  foreignKey({ name: "audit_student_fk", columns: [t.tenantId, t.actingStudentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "audit_guardian_fk", columns: [t.tenantId, t.guardianId], foreignColumns: [guardian.tenantId, guardian.id] }),
  check("audit_action_known", sql`${t.action} in ('student.create','student.update','student.import','grant.issue','grant.revoke','guardian.link','guardian.revoke','guardian.practice-set','tutor.cantor-set','tutor.assign','tutor.revoke','invite.issue','invite.accept','invite.revoke','invite.delivery-sent','invite.delivery-failed','context.enter','context.exit','reading.set','identity.link','identity.revoke','draft.append','note.append','service-plan.set','progress.self-check.set','progress.assessment.set','lesson-log.create','lesson-log.edit','lesson-log.delete')`),
]);
