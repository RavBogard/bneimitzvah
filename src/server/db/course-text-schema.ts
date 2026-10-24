import { sql } from "drizzle-orm";
import { check, customType, foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenant-schema";
import type { CourseTextPins } from "../service-course/pin";

const bytes = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea", fromDriver: value => Buffer.from(value) });
const id = () => uuid("id").defaultRandom().primaryKey();
const tenantId = () => text("tenant_id").notNull().references(() => tenant.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
/** A volume a course may read: lowercase slug, never a licensed legacy or CRC-only book. The database's own copy of the rule. */
const publicVolume = (column: unknown) => sql`${column} ~ '^[a-z0-9][a-z0-9-]{0,63}$' and ${column} !~ '^(legacy|crc)-'`;

/**
 * The service course's public text (2.0 SC2, A4 6.2 Migration B): the exact bytes of one PUBLIC build of a public volume,
 * per congregation, with its pins. A copy of service_catalog's shape with a `volume` column and the database's own check
 * that the lane is public, the volume is not a licensed one, and the artifact is the volume's own (never `dist-app`, never
 * a "-LICENSED" source). The licensed Beit Mitzvah catalog stays in service_catalog, which this table never references.
 * Immutable; the runtime may only SELECT. Rows come from the house operator path, never from a migration or a request.
 */
export const courseTextCatalog = pgTable("course_text_catalog", {
  id: id(), tenantId: tenantId(), volume: text("volume").notNull(), identity: text("identity").notNull(),
  feedBytes: bytes("feed_bytes").notNull(), pins: jsonb("pins").$type<CourseTextPins>().notNull(), createdAt: createdAt(),
}, t => [
  unique("course_text_catalog_tenant_key").on(t.tenantId, t.id),
  unique("course_text_catalog_volume_key").on(t.tenantId, t.id, t.volume),
  unique("course_text_catalog_generation_key").on(t.tenantId, t.volume, t.identity),
  check("course_text_catalog_identity_hash", sql`${t.identity} ~ '^[a-f0-9]{64}$'`),
  check("course_text_catalog_volume", publicVolume(t.volume)),
  check("course_text_catalog_bytes_bound", sql`octet_length(${t.feedBytes}) between 1 and 2097152`),
  check("course_text_catalog_pins", sql`jsonb_typeof(${t.pins}) = 'object' and octet_length(${t.pins}::text) <= 2048
    and ${t.pins} ?& array['volume','lane','feedSha256','artifactRepo','artifactCommit','artifactRunId','artifactName','sourceGitSha']
    and (${t.pins} - 'volume' - 'lane' - 'feedSha256' - 'artifactRepo' - 'artifactCommit' - 'artifactRunId' - 'artifactName' - 'sourceGitSha') = '{}'::jsonb
    and ${t.pins}->>'lane' = 'public' and ${t.pins}->>'volume' = ${t.volume}
    and ${t.pins}->>'feedSha256' ~ '^[a-f0-9]{64}$' and ${t.pins}->>'sourceGitSha' ~ '^[a-f0-9]{7,40}$'
    and ${t.pins}->>'artifactCommit' ~ '^[a-f0-9]{40}$' and ${t.pins}->>'artifactName' = ${t.volume} || '-' || left(${t.pins}->>'artifactCommit', 7)`),
]);
/** Which stored build each congregation shows for a volume: at most one active per volume. */
export const courseTextLifecycle = pgTable("course_text_lifecycle", {
  id: id(), tenantId: tenantId(), catalogId: uuid("catalog_id").notNull(), volume: text("volume").notNull(),
  state: text("state").$type<"active" | "superseded" | "withdrawn">().notNull(),
  revision: integer("revision").default(1).notNull(), createdAt: createdAt(),
}, t => [
  unique("course_text_lifecycle_catalog_key").on(t.tenantId, t.catalogId),
  foreignKey({ name: "course_text_lifecycle_catalog_fk", columns: [t.tenantId, t.catalogId, t.volume], foreignColumns: [courseTextCatalog.tenantId, courseTextCatalog.id, courseTextCatalog.volume] }),
  uniqueIndex("course_text_lifecycle_one_active").on(t.tenantId, t.volume).where(sql`${t.state} = 'active'`),
  check("course_text_lifecycle_state", sql`${t.state} in ('active','superseded','withdrawn')`),
  check("course_text_lifecycle_revision", sql`${t.revision} > 0`),
  check("course_text_lifecycle_volume", publicVolume(t.volume)),
]);
