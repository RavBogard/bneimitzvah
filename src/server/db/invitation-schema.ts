import { sql } from "drizzle-orm";
import { bigint, check, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenant-schema";

// Separate from Better Auth rate_limit: its cleanup uses the auth window, which
// must not erase the longer invitation delivery budgets.
export const invitationThrottle = pgTable("invitation_throttle", {
  id: uuid("id").defaultRandom().primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenant.id),
  scope: text("scope").notNull(), key: text("key").notNull(), bucketStart: bigint("bucket_start", { mode: "number" }).notNull(), count: integer("count").notNull(),
}, (t) => [
  unique("invitation_throttle_tenant_id_key").on(t.tenantId, t.id),
  unique("invitation_throttle_bucket_key").on(t.tenantId, t.scope, t.key, t.bucketStart),
  check("invitation_throttle_scope", sql`${t.scope} in ('actor','recipient')`),
  check("invitation_throttle_hash", sql`${t.key} ~ '^[a-f0-9]{64}$'`),
  check("invitation_throttle_positive", sql`${t.count} > 0 and ${t.bucketStart} >= 0`),
]);
