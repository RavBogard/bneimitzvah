import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

/**
 * Operator import of the service course's pinned PUBLIC text (2.0 SC2). Explicitly invoked, never imported by the app.
 *
 *   DATABASE_MIGRATION_URL=... node scripts/import-course-text.mjs --file <path to shabbat-shacharit-feed.json> --tenant crc
 *
 * The file is the feed from the producer's public-lane artifact named in src/server/service-course/pin.ts (download it with
 * `gh run download 35741258239 -R RavBogard/ShireiShabbat -n shabbat-shacharit-edfef85` into an ignored folder, never the repo).
 * Its bytes must hash to the pin before any connection opens. One transaction: it stores the bytes with the exact pins and makes
 * them the congregation's active build for the volume; run again, it changes nothing; it refuses if a DIFFERENT build is active
 * (replacing a build is its own reviewed operation). It never touches service_catalog, and it prints only fixed messages.
 */
// Kept equal to PUBLIC_COURSE_TEXT in src/server/service-course/pin.ts; tests/app/course-text-import.test.ts checks it.
export const COURSE_TEXT_PIN = Object.freeze({
  volume: "shabbat-shacharit", lane: "public", feedSha256: "aca598e7e6e202b7a64c9ef244f83b17b7f87cfa24265a5b99f5b19a65dc4e6b",
  artifactRepo: "RavBogard/ShireiShabbat", artifactCommit: "edfef85e1e06737d5fea1c33970f23961f599fc5", artifactRunId: "35741258239",
  artifactName: "shabbat-shacharit-edfef85", sourceGitSha: "edfef85",
});
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
/** The same identity src/server/service-course/public-feed.ts computes. */
export const courseTextIdentity = pin => createHash("sha256").update(`course-text-v1\0${pin.volume}\0${pin.feedSha256}`).digest("hex");

export class CourseTextImportRefused extends Error {
  constructor(reason) { super(`Course text import refused: ${reason}`); this.name = "CourseTextImportRefused"; }
}

/** `client` is a direct migration-owner client (pg.Client or PGlite); `pin` defaults to the code pin and is overridden only by tests. */
export async function importCourseText(client, { bytes, tenantId }, pin = COURSE_TEXT_PIN) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 2_097_152) throw new CourseTextImportRefused("feed size");
  if (sha256(bytes) !== pin.feedSha256) throw new CourseTextImportRefused("feed hash is not the pin");
  if (pin.lane !== "public" || /^(?:legacy|crc)-/.test(pin.volume) || pin.artifactName !== `${pin.volume}-${pin.artifactCommit.slice(0, 7)}`) throw new CourseTextImportRefused("pin is not a public build");
  if (typeof tenantId !== "string" || !/^[a-z][a-z0-9-]{1,30}$/.test(tenantId)) throw new CourseTextImportRefused("tenant");
  const identity = courseTextIdentity(pin), pins = JSON.stringify(pin);
  await client.query("begin");
  try {
    const tenant = await client.query("select id from tenant where id = $1", [tenantId]);
    if (tenant.rows.length !== 1) throw new CourseTextImportRefused("no such congregation");
    const active = await client.query("select l.catalog_id, c.identity from course_text_lifecycle l join course_text_catalog c on c.tenant_id = l.tenant_id and c.id = l.catalog_id where l.tenant_id = $1 and l.volume = $2 and l.state = 'active' for update of l",
      [tenantId, pin.volume]);
    if (active.rows.length && active.rows[0].identity !== identity) throw new CourseTextImportRefused("a different build is active");
    if (active.rows.length) { await client.query("commit"); return { changed: false, identity }; }
    let catalog = await client.query("select id from course_text_catalog where tenant_id = $1 and volume = $2 and identity = $3", [tenantId, pin.volume, identity]);
    if (!catalog.rows.length) catalog = await client.query("insert into course_text_catalog(tenant_id,volume,identity,feed_bytes,pins) values($1,$2,$3,$4,$5::jsonb) returning id",
      [tenantId, pin.volume, identity, Buffer.from(bytes), pins]);
    const id = catalog.rows[0].id;
    const life = await client.query("select id from course_text_lifecycle where tenant_id = $1 and catalog_id = $2", [tenantId, id]);
    if (life.rows.length) await client.query("update course_text_lifecycle set state = 'active', revision = revision + 1 where tenant_id = $1 and catalog_id = $2 and state <> 'active'", [tenantId, id]);
    else await client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values($1,$2,$3,'active')", [tenantId, id, pin.volume]);
    await client.query("commit");
    return { changed: true, identity };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    const args = process.argv.slice(2), at = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
    const file = at("--file"), tenantId = at("--tenant");
    if (!file || !tenantId) throw new CourseTextImportRefused("usage");
    const bytes = new Uint8Array(await readFile(file));
    if (sha256(bytes) !== COURSE_TEXT_PIN.feedSha256) throw new CourseTextImportRefused("feed hash is not the pin");
    const value = process.env.DATABASE_MIGRATION_URL;
    if (!value) throw new CourseTextImportRefused("missing migration configuration");
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) throw new CourseTextImportRefused("a direct migration connection is required");
    client = new pg.Client({ connectionString: value });
    await client.connect();
    const result = await importCourseText(client, { bytes, tenantId });
    console.log(result.changed ? "Course text imported and active" : "Course text already active; nothing changed");
  } catch (error) {
    // Driver errors and configuration are never printed; a refusal names its fixed reason only.
    console.error(error instanceof CourseTextImportRefused ? error.message : "Course text import failed; verify private configuration and database permissions");
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
