import { sql } from "drizzle-orm";
import { check, date, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { student, tenant } from "./tenant-schema";
import type { PracticeTarget } from "../../lib/practice-calendar/types";

export const practiceDay = pgTable("practice_day", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(), practiceDay: date("practice_day").notNull(),
}, t => [
  primaryKey({ name: "practice_day_key", columns: [t.tenantId, t.studentId, t.practiceDay] }),
  foreignKey({ name: "practice_day_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
]);
export const practiceEvent = pgTable("practice_event", {
  tenantId: text("tenant_id").notNull().references(() => tenant.id), studentId: uuid("student_id").notNull(), practiceDay: date("practice_day").notNull(), eventId: uuid("event_id").notNull(),
  // The stored typmod, default and service clock all preserve exact cursor milliseconds.
  receivedAt: timestamp("received_at", { withTimezone: true, precision: 3 }).default(sql`date_trunc('milliseconds', clock_timestamp())`).notNull(),
  action: text("action").$type<"visit" | "play" | "record">().notNull(), sourceMode: text("source_mode").$type<"student" | "child-practice">().notNull(), target: jsonb("target").$type<PracticeTarget>().notNull(),
}, t => [
  primaryKey({ name: "practice_event_key", columns: [t.tenantId, t.studentId, t.practiceDay, t.eventId] }),
  foreignKey({ name: "practice_event_student_fk", columns: [t.tenantId, t.studentId], foreignColumns: [student.tenantId, student.id] }),
  foreignKey({ name: "practice_event_day_fk", columns: [t.tenantId, t.studentId, t.practiceDay], foreignColumns: [practiceDay.tenantId, practiceDay.studentId, practiceDay.practiceDay] }),
  check("practice_event_received_day", sql`${t.practiceDay} = (${t.receivedAt} at time zone 'America/Chicago')::date`),
  check("practice_event_action", sql`${t.action} in ('visit','play','record')`),
  check("practice_event_source_mode", sql`${t.sourceMode} in ('student','child-practice')`),
  check("practice_event_target", sql`coalesce(jsonb_typeof(${t.target}) = 'object' and (
    (${t.target}->>'type' = 'verse'
      and ${t.target} ?& array['type','kind','assignmentId','assignmentRevision','verseRef']
      and ${t.target} - array['type','kind','assignmentId','assignmentRevision','verseRef']::text[] = '{}'::jsonb
      and ${t.target}->>'kind' in ('torah','haftarah')
      and ${t.target}->>'assignmentId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof(${t.target}->'assignmentRevision') = 'number' and ${t.target}->>'assignmentRevision' ~ '^[1-9][0-9]{0,9}$' and ${t.target}->'assignmentRevision' <= '2147483647'::jsonb
      and length(${t.target}->>'verseRef') <= 100 and ${t.target}->>'verseRef' ~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$')
    or (${t.target}->>'type' = 'service-unit'
      and ${t.target} ?& array['type','catalogId','catalogIdentity','planId','planRevision','unitId']
      and ${t.target} - array['type','catalogId','catalogIdentity','planId','planRevision','unitId']::text[] = '{}'::jsonb
      and ${t.target}->>'catalogId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and ${t.target}->>'planId' ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      and jsonb_typeof(${t.target}->'catalogIdentity') = 'string' and ${t.target}->>'catalogIdentity' ~ '^[a-f0-9]{64}$'
      and jsonb_typeof(${t.target}->'planRevision') = 'number' and ${t.target}->>'planRevision' ~ '^[1-9][0-9]{0,9}$' and ${t.target}->'planRevision' <= '2147483646'::jsonb
      and jsonb_typeof(${t.target}->'unitId') = 'string' and length(${t.target}->>'unitId') between 1 and 128)
  ), false)`),
]);
