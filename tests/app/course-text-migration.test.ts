import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { accessFixture } from "./access-fixture";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { readCourseText, serviceTextOf, CourseTextUnavailable } from "../../src/server/service-course/text";
import { courseTextIdentity } from "../../src/server/service-course/public-feed";
import { feedBytes, syntheticBuild, syntheticFeedValue, syntheticPins } from "../helpers/course-text";

// The service course's public text (2.0 SC2, A4 6.2 Migration B), on the page-views migration test's model.
const TAG = "0043_course_text_catalog", TABLES = ["course_text_catalog", "course_text_lifecycle"];
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0043 adds only the two course text tables, leaves every existing row and policy unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 43, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0042_curated_discussions").when);
    const copy = async (name: string, entries: { tag: string }[]) => {
      const dir = join(isolation.home, name); await mkdir(join(dir, "meta"), { recursive: true });
      await writeFile(join(dir, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
      for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(dir, e.tag + ".sql"));
      return dir;
    };
    const db = drizzle(client); await migrate(db, { migrationsFolder: await copy("prior", journal.entries.slice(0, own)) });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('text-existing','Synthetic',$1,true)", [["text-existing", "example.test"].join("@")]);
    await client.query("insert into membership(tenant_id,user_id) values('crc','text-existing')");
    const existing = ["student", "membership", "role_grant", "audit_event", "tenant", "tenant_host", "service_catalog", "service_catalog_lifecycle", "course_progress"];
    const capture = async () => Object.fromEntries(await Promise.all(existing.map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const policiesBefore = (await client.query("select tablename, policyname, qual, with_check from pg_policies order by 1, 2")).rows;
    const before = await capture();
    const through = await copy("through", journal.entries.slice(0, own + 1));
    await migrate(db, { migrationsFolder: through }); await migrate(db, { migrationsFolder: through });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    for (const table of TABLES) expect((await client.query(`select count(*)::int as n from ${table}`)).rows).toEqual([{ n: 0 }]);
    const policiesAfter = (await client.query("select tablename, policyname, qual, with_check from pg_policies order by 1, 2")).rows as { tablename: string }[];
    expect(policiesAfter.filter(p => !TABLES.includes(p.tablename))).toEqual(policiesBefore);

    // The snapshot adds the two tables and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0043_snapshot.json"); expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0043_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    for (const table of TABLES) expected[`public.${table}`] = current.tables[`public.${table}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);
    expect(Object.keys(current.tables["public.course_text_catalog"].columns).sort()).toEqual(["created_at", "feed_bytes", "id", "identity", "pins", "tenant_id", "volume"]);

    // Purely additive: its two tables, their keys, row security, SELECT-only grants and immutability; nothing dropped or widened elsewhere.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    const statements = text.split("--> statement-breakpoint").map(part => part.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    const table = "(?:course_text_catalog|course_text_lifecycle)";
    for (const statement of statements) expect(statement, statement.slice(0, 80)).toMatch(new RegExp(`^(CREATE TABLE "${table}"|ALTER TABLE "?${table}"? |REVOKE ALL ON ${table} |GRANT SELECT ON ${table} TO portal_runtime;$|CREATE POLICY tenant_isolation ON ${table} |CREATE UNIQUE INDEX "course_text_lifecycle_one_active"|CREATE FUNCTION portal_immutable_course_text\\(\\)|CREATE TRIGGER (?:immutable_course_text|immutable_course_text_lifecycle_identity|course_text_lifecycle_revision) )`));
    expect(statements.join("\n").replace(/ON DELETE no action ON UPDATE no action/g, "").replace("BEFORE UPDATE OR DELETE", "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE|RENAME|DISABLE ROW LEVEL SECURITY|NO FORCE|audit_event|service_catalog)\b/i);
    expect(text).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL)/i);
    for (const name of TABLES) {
      const rls = await client.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [name]);
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      const grants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [name]);
      expect(grants.rows).toEqual([{ privilege_type: "SELECT" }]);
      expect((await client.query("select count(*)::int as n from information_schema.column_privileges where grantee='portal_runtime' and privilege_type <> 'SELECT' and table_name = $1", [name])).rows).toEqual([{ n: 0 }]);
      expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [name])).rows).toEqual([{ n: 0 }]);
    }
  } finally { await client.close(); await isolation.cleanup(); }
});

type Row = { tenant?: string; volume?: string; identity?: string; bytes?: Uint8Array; pins?: Record<string, unknown> };
const insertCatalog = (client: PGlite, row: Row = {}) => {
  const build = syntheticBuild(), pins = row.pins ?? build.pins, volume = row.volume ?? "shabbat-shacharit";
  return client.query("insert into course_text_catalog(tenant_id,volume,identity,feed_bytes,pins) values($1,$2,$3,$4,$5) returning id",
    [row.tenant ?? "crc", volume, row.identity ?? courseTextIdentity({ volume, feedSha256: String(pins.feedSha256) }), row.bytes ?? build.bytes, JSON.stringify(pins)]);
};

test("the database refuses a licensed lane, a licensed or legacy volume, a -LICENSED source, dist-app and any pin it does not know", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const pins = syntheticBuild().pins as unknown as Record<string, unknown>;
    for (const bad of [{ pins: { ...pins, lane: "licensed" } }, { volume: "legacy-beit-mitzvah", pins: { ...pins, volume: "legacy-beit-mitzvah", artifactName: "legacy-beit-mitzvah-aaaaaaa" } },
      { volume: "crc-rh-morning", pins: { ...pins, volume: "crc-rh-morning", artifactName: "crc-rh-morning-aaaaaaa" } }, { pins: { ...pins, sourceGitSha: "aaaaaaa-LICENSED" } },
      { pins: { ...pins, artifactName: "dist-app" } }, { pins: { ...pins, volume: "shabbat-maariv" } }, { pins: { ...pins, extra: "x" } }, { pins: (({ lane: _l, ...rest }) => rest)(pins) },
      { identity: "not-a-hash" }, { bytes: new Uint8Array(0) }, { tenant: "no-such-congregation" }, { volume: "Shabbat Shacharit" }]) {
      await expect(insertCatalog(client, bad as Row), JSON.stringify(bad).slice(0, 120)).rejects.toThrow();
    }
    const [{ id }] = (await insertCatalog(client)).rows as { id: string }[];
    await expect(insertCatalog(client)).rejects.toThrow(); // one row per build per volume
    // The lifecycle must name the catalog's own volume; one active per congregation and volume; the catalog never changes.
    await expect(client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values('crc',$1,'shabbat-maariv','active')", [id])).rejects.toThrow();
    await expect(client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values('crc',$1,'legacy-beit-mitzvah','active')", [id])).rejects.toThrow();
    await client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values('crc',$1,'shabbat-shacharit','active')", [id]);
    await expect(client.query("update course_text_catalog set volume = 'legacy-beit-mitzvah'")).rejects.toThrow();
    await expect(client.query("update course_text_catalog set feed_bytes = '\\x00'")).rejects.toThrow();
    await expect(client.query("delete from course_text_catalog")).rejects.toThrow();
    await expect(client.query("update course_text_lifecycle set catalog_id = gen_random_uuid()")).rejects.toThrow();
    await expect(client.query("update course_text_lifecycle set state = 'withdrawn'")).rejects.toThrow(); // revision must advance
    await client.query("update course_text_lifecycle set state = 'withdrawn', revision = revision + 1");
  } finally { await client.close(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("as portal_runtime: the congregation reads its own active pinned build, nothing else, and can change nothing", async () => {
  const f = await accessFixture(); opened.push(f);
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  const as = <T>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
  const build = syntheticBuild();
  await f.owner(async () => {
    const [{ id }] = (await insertCatalog(f.client)).rows as { id: string }[];
    await f.client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values('crc',$1,'shabbat-shacharit','active')", [id]);
  });
  const feed = await as("crc", tx => readCourseText(tx, "crc", build.pins));
  expect(serviceTextOf(feed, "shma.the-shma@shabbat-shacharit").lines).toHaveLength(2);
  expect(() => serviceTextOf(feed, "torah.mi-shebeirach-healing@shabbat-shacharit")).toThrow(CourseTextUnavailable);
  // Another congregation, or a transaction for one congregation asking for another, sees no build.
  await expect(as("other", tx => readCourseText(tx, "other", build.pins))).rejects.toMatchObject({ code: "unavailable" });
  await expect(as("other", tx => readCourseText(tx, "crc", build.pins))).rejects.toMatchObject({ code: "unavailable" });
  // The code pin is the authority: the real pin does not match a synthetic row, so nothing is shown.
  await expect(as("crc", tx => readCourseText(tx, "crc"))).rejects.toMatchObject({ code: "unavailable" });
  await expect(as("crc", tx => readCourseText(tx, "crc", { ...build.pins, artifactRunId: "2" }))).rejects.toMatchObject({ code: "unavailable" });
  // The runtime may only read.
  for (const statement of ["insert into course_text_catalog(tenant_id,volume,identity,feed_bytes,pins) select tenant_id,volume,identity,feed_bytes,pins from course_text_catalog",
    "update course_text_catalog set identity = identity", "delete from course_text_catalog", "update course_text_lifecycle set state = 'withdrawn', revision = revision + 1",
    "delete from course_text_lifecycle", "truncate course_text_catalog"]) {
    expect(await sqlState(as("crc", tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  }
  // A row whose bytes are not its pinned hash is never shown, even with matching pins.
  const other = feedBytes({ ...syntheticFeedValue(), title: "Synthetic changed" }), changed = syntheticPins(other);
  await f.owner(async () => {
    await f.client.query("update course_text_lifecycle set state = 'superseded', revision = revision + 1 where tenant_id = 'crc'");
    const [{ id }] = (await insertCatalog(f.client, { bytes: build.bytes, pins: changed as unknown as Record<string, unknown> })).rows as { id: string }[];
    await f.client.query("insert into course_text_lifecycle(tenant_id,catalog_id,volume,state) values('crc',$1,'shabbat-shacharit','active')", [id]);
  });
  await expect(as("crc", tx => readCourseText(tx, "crc", changed))).rejects.toMatchObject({ code: "unavailable" });
  await expect(as("crc", tx => readCourseText(tx, "crc", build.pins))).rejects.toMatchObject({ code: "unavailable" });
});
