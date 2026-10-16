import { sql } from "drizzle-orm";
import { boolean, check, customType, date, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membership, student, tenant } from "./tenant-schema";
import type { ServiceFeedPins } from "../service-learning/feed";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea", fromDriver: value => Buffer.from(value) });
const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
// Exact authenticated artifact bytes only; never migration seed data or a public asset.
export const serviceCatalog = pgTable("service_catalog", {
  id: id(), tenantId: tenantId(), identity: text("identity").notNull(),
  feedBytes: bytes("feed_bytes").notNull(), provenanceBytes: bytes("provenance_bytes").notNull(),
  pins: jsonb("pins").$type<ServiceFeedPins>().notNull(), createdAt: createdAt(),
}, t => [
  unique("service_catalog_tenant_key").on(t.tenantId, t.id),
  unique("service_catalog_identity_key").on(t.tenantId, t.id, t.identity),
  unique("service_catalog_generation_key").on(t.tenantId, t.identity),
  check("service_catalog_identity_hash", sql`${t.identity} ~ '^[a-f0-9]{64}$'`),
  check("service_catalog_bytes_bound", sql`octet_length(${t.feedBytes}) between 1 and 2097152 and octet_length(${t.provenanceBytes}) between 1 and 32768`),
  check("service_catalog_pins_bound", sql`jsonb_typeof(${t.pins}) = 'object' and octet_length(${t.pins}::text) <= 2048
    and ${t.pins} ?& array['feedSha256','provenanceSha256','artifactRepo','artifactCommit','artifactRunId','sourceGitSha']
    and (${t.pins} - 'feedSha256' - 'provenanceSha256' - 'artifactRepo' - 'artifactCommit' - 'artifactRunId' - 'sourceGitSha') = '{}'::jsonb`),
]);
export const serviceCatalogLifecycle = pgTable("service_catalog_lifecycle", {
  id: id(), tenantId: tenantId(), catalogId: uuid("catalog_id").notNull(),
  state: text("state").$type<"active" | "superseded" | "withdrawn">().notNull(),
  revision: integer("revision").default(1).notNull(), createdAt: createdAt(),
}, t => [
  unique("service_lifecycle_catalog_key").on(t.tenantId, t.catalogId),
  foreignKey({ name: "service_lifecycle_catalog_fk", columns: [t.tenantId, t.catalogId], foreignColumns: [serviceCatalog.tenantId, serviceCatalog.id] }),
  uniqueIndex("service_lifecycle_one_active").on(t.tenantId).where(sql`${t.state} = 'active'`),
  check("service_lifecycle_state", sql`${t.state} in ('active','superseded','withdrawn')`),
  check("service_lifecycle_revision", sql`${t.revision} > 0`),
]);
export const studentServicePlan = pgTable("student_service_plan", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(),
  catalogId: uuid("catalog_id").notNull(), catalogIdentity: text("catalog_identity").notNull(),
  selectedIds: text("selected_ids").array().notNull(), revision: integer("revision").default(1).notNull(),
  needsReview: boolean("needs_review").default(false).notNull(),
  reviewedDate: date("reviewed_date").notNull(), reviewedSlot: text("reviewed_slot").$type<"morning" | "havdalah">().notNull(),
  setByMembershipId: uuid("set_by_membership_id").notNull(), createdAt: createdAt(),
}, t => [
  unique("student_service_plan_current_key").on(t.tenantId, t.studentId),
  foreignKey({ name: "student_service_plan_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_service_plan_catalog_fk", columns: [t.tenantId, t.catalogId, t.catalogIdentity], foreignColumns: [serviceCatalog.tenantId, serviceCatalog.id, serviceCatalog.identity] }),
  foreignKey({ name: "student_service_plan_author_fk", columns: [t.tenantId, t.setByMembershipId], foreignColumns: [membership.tenantId, membership.id] }),
  check("student_service_plan_revision", sql`${t.revision} > 0`),
  check("student_service_plan_slot", sql`${t.reviewedSlot} in ('morning','havdalah')`),
  check("student_service_plan_selection", sql`cardinality(${t.selectedIds}) <= 256 and
    (cardinality(${t.selectedIds}) = 0 or (array_ndims(${t.selectedIds}) = 1 and array_lower(${t.selectedIds},1) = 1))
    and array_position(${t.selectedIds}, null) is null and octet_length(array_to_string(${t.selectedIds}, '|')) <= 16384`),
]);
