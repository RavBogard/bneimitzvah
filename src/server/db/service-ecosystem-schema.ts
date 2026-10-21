import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { student, tenant } from "./tenant-schema";
import { serviceCatalog } from "./service-learning-schema";
import type { MusicProjection } from "../service-ecosystem/contract";

const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
export const serviceCeremony = pgTable("service_ceremony", {
  id: id(), tenantId: tenantId(), localDate: date("local_date").notNull(),
  scheduleKey:text("schedule_key").notNull(),
  ceremonyType: text("ceremony_type").$type<"morning" | "havdalah">().notNull(),
  state: text("state").$type<"pending" | "linked" | "ambiguous" | "unavailable" | "review_required">().default("pending").notNull(),
  setlistId: text("setlist_id"), revision: integer("revision").default(1).notNull(),
  projection: jsonb("projection").$type<MusicProjection>(),
  candidates: text("candidates").array().default(sql`'{}'::text[]`).notNull(),
  attempts: integer("attempts").default(0).notNull(), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  leaseToken: uuid("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }),
  requestedDate:date("requested_date").notNull(),requestedType:text("requested_type").$type<"morning"|"havdalah">().notNull(),
  scheduleRevision:integer("schedule_revision").default(1).notNull(),scheduleConflict:boolean("schedule_conflict").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [unique("service_ceremony_tenant_key").on(t.tenantId, t.id),
  unique("service_ceremony_schedule_key").on(t.tenantId,t.scheduleKey),
  check("service_ceremony_type", sql`${t.ceremonyType} in ('morning','havdalah')`),
  check("service_ceremony_state", sql`${t.state} in ('pending','linked','ambiguous','unavailable','review_required')`),
  check("service_ceremony_revision", sql`${t.revision} > 0`),
  check("service_ceremony_projection_bound", sql`${t.projection} is null or octet_length(${t.projection}::text) <= 131072`),
  check("service_ceremony_candidate_bound", sql`cardinality(${t.candidates}) <= 100`),
  check("service_ceremony_job_shape", sql`${t.attempts} >= 0 and ((${t.leaseToken} is null) = (${t.leaseUntil} is null))`),
  check("service_ceremony_schedule_shape",sql`${t.scheduleRevision}>0 and ${t.requestedType} in ('morning','havdalah')`),
]);
export const studentCeremony = pgTable("student_ceremony", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), ceremonyId: uuid("ceremony_id").notNull(),
  needsReconciliation: boolean("needs_reconciliation").default(false).notNull(),
}, t => [unique("student_ceremony_current_key").on(t.tenantId, t.studentId),
  foreignKey({ name: "student_ceremony_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "student_ceremony_source_fk", columns: [t.tenantId, t.ceremonyId], foreignColumns: [serviceCeremony.tenantId, serviceCeremony.id] }),
]);
export const studentServicePart = pgTable("student_service_part", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), ceremonyId: uuid("ceremony_id").notNull(), rowId: text("row_id").notNull(),
  leads: boolean("leads").default(true).notNull(), directions: text("directions").default("").notNull(), privateFeedback: text("private_feedback").default("").notNull(),
  progress: text("progress").$type<"not-started" | "practicing" | "ready">().default("not-started").notNull(),
  resourceIdentity: text("resource_identity").notNull(), revision: integer("revision").default(1).notNull(),
  catalogId: uuid("catalog_id"), catalogIdentity: text("catalog_identity"), catalogUnitId: text("catalog_unit_id"),
}, t => [unique("student_service_part_key").on(t.tenantId, t.studentId, t.ceremonyId, t.rowId),
  foreignKey({ name: "service_part_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "service_part_ceremony_fk", columns: [t.tenantId, t.ceremonyId], foreignColumns: [serviceCeremony.tenantId, serviceCeremony.id] }),
  foreignKey({name:"service_part_catalog_fk",columns:[t.tenantId,t.catalogId,t.catalogIdentity],foreignColumns:[serviceCatalog.tenantId,serviceCatalog.id,serviceCatalog.identity]}),
  check("service_part_material_shape",sql`(${t.catalogId} is null and ${t.catalogIdentity} is null and ${t.catalogUnitId} is null) or (${t.catalogId} is not null and ${t.catalogIdentity} is not null and ${t.catalogUnitId} is not null and length(${t.catalogUnitId}) between 1 and 128)`),
  check("service_part_bound", sql`length(${t.rowId}) between 1 and 128 and length(${t.directions}) <= 4000 and length(${t.privateFeedback}) <= 4000 and ${t.revision} > 0`),
  check("service_part_progress", sql`${t.progress} in ('not-started','practicing','ready')`),
]);
export const servicePartRequest = pgTable("service_part_request", {
  id: id(), tenantId: tenantId(), studentId: uuid("student_id").notNull(), ceremonyId: uuid("ceremony_id").notNull(), rowId: text("row_id").notNull(),
  message: text("message").notNull(), response: text("response").default("").notNull(),
  state: text("state").$type<"pending" | "accepted" | "declined">().default("pending").notNull(),
  sourceRevision: text("source_revision").notNull(), requestedResourceIdentity: text("requested_resource_identity"),
  revision: integer("revision").default(1).notNull(), createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [foreignKey({ name: "service_request_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "service_request_ceremony_fk", columns: [t.tenantId, t.ceremonyId], foreignColumns: [serviceCeremony.tenantId, serviceCeremony.id] }),
  check("service_request_bound", sql`length(${t.rowId}) between 1 and 128 and length(${t.message}) between 1 and 2000 and length(${t.response}) <= 2000 and ${t.revision} > 0`),
  check("service_request_state", sql`${t.state} in ('pending','accepted','declined')`),
]);
