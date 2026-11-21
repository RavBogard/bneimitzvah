import { sql } from "drizzle-orm";
import { check, foreignKey, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { ACCOUNT_TEXT_CONTROLS } from "./accounts-schema";
import { membership } from "./tenant-schema";

/** The editable name belongs to an account in a congregation. It has its own lock and revision. */
export const accountDisplayName = pgTable("account_display_name", {
  tenantId: text("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  name: text("name").notNull(),
  revision: integer("revision").notNull().default(1),
}, t => [
  primaryKey({ name: "account_display_name_key", columns: [t.tenantId, t.membershipId] }),
  foreignKey({ name: "account_display_name_membership_fk", columns: [t.tenantId, t.membershipId], foreignColumns: [membership.tenantId, membership.id] }),
  check("account_display_name_shape", sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 80
    and ${t.name} !~ '[<>@]' and ${t.name} !~ ${sql.raw(`'${ACCOUNT_TEXT_CONTROLS}'`)} and ${t.revision} > 0`),
]);
