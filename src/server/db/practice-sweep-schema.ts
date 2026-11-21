import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";

/** One durable cursor for the scheduled retention sweep. */
export const practiceSweep = pgTable("practice_sweep", {
  id: text("id").primaryKey(),
  afterTenant: text("after_tenant"),
  afterStudent: uuid("after_student"),
}, t => [
  check("practice_sweep_singleton", sql`${t.id} = 'retention'`),
  check("practice_sweep_cursor", sql`${t.afterStudent} is null or ${t.afterTenant} is not null`),
]);
