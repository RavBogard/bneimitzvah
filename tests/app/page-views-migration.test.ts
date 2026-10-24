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
import { countPublicPageView } from "../../src/server/data/page-views";

// The public page-view counter (release 1.5, "path and day only"), on the course-progress migration test's model.
const TAG = "0039_public_page_views", TABLE = "public_page_view_day";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

test("0039 adds only the public_page_view_day table, leaves every existing row unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 39, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0038_account_requests").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into \"user\"(id,name,email,email_verified) values('views-existing','Synthetic',$1,true)", [["views-existing", "example.test"].join("@")]);
    await client.query("insert into membership(tenant_id,user_id) values('crc','views-existing')");
    const existing = ["student", "membership", "role_grant", "audit_event", "tenant", "tenant_host", "course_progress", "account_request", "tenant_member"];
    const capture = async () => Object.fromEntries(await Promise.all(existing.map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const policiesBefore = (await client.query("select tablename, policyname, qual, with_check from pg_policies order by 1, 2")).rows;
    const before = await capture();
    // Through 0039 only: a later migration's own tables and policies (0041's, for one) are that migration's test to account for.
    const through = join(isolation.home, "through"), throughEntries = journal.entries.slice(0, own + 1);
    await mkdir(join(through, "meta"), { recursive: true }); await writeFile(join(through, "meta/_journal.json"), JSON.stringify({ ...journal, entries: throughEntries }));
    for (const e of throughEntries) await copyFile(join(folder, e.tag + ".sql"), join(through, e.tag + ".sql"));
    await migrate(db, { migrationsFolder: through }); await migrate(db, { migrationsFolder: through });
    const after = await capture();
    for (const table of Object.keys(before)) expect(priorColumns(after[table], before[table])).toEqual(before[table]);
    expect((await client.query(`select count(*)::int as n from ${TABLE}`)).rows).toEqual([{ n: 0 }]);
    // Every policy that existed is unchanged; the one new policy is this table's.
    const policiesAfter = (await client.query("select tablename, policyname, qual, with_check from pg_policies order by 1, 2")).rows as { tablename: string }[];
    expect(policiesAfter.filter(p => p.tablename !== TABLE)).toEqual(policiesBefore);

    // The generated snapshot adds the one table and changes nothing else.
    const snapshots = (await readdir(join(folder, "meta"))).filter(name => /^\d{4}_snapshot\.json$/.test(name)).sort();
    const at = snapshots.indexOf("0039_snapshot.json");
    expect(at).toBeGreaterThan(0);
    const previous = JSON.parse(await readFile(join(folder, "meta", snapshots[at - 1]), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0039_snapshot.json"), "utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected = structuredClone(previous.tables);
    expected[`public.${TABLE}`] = current.tables[`public.${TABLE}`];
    expect(current.tables).toEqual(expected);
    for (const key of ["enums", "schemas", "sequences", "roles", "policies", "views"]) expect(current[key]).toEqual(previous[key]);
    // Path and day only: exactly four columns, no visitor fact of any kind.
    expect(Object.keys(current.tables[`public.${TABLE}`].columns).sort()).toEqual(["day", "path", "tenant_id", "views"]);

    // Purely additive: one CREATE TABLE, its FK, and its own row security and grants; nothing dropped, altered or widened elsewhere.
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    const statements = text.split("--> statement-breakpoint").map(part => part.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    for (const statement of statements) expect(statement, statement.slice(0, 80)).toMatch(new RegExp(`^(CREATE TABLE "${TABLE}"|ALTER TABLE "?${TABLE}"? |REVOKE ALL ON ${TABLE} |GRANT [A-Z, ()a-z_]+ ON ${TABLE} TO portal_runtime;$|CREATE POLICY tenant_isolation ON ${TABLE} )`));
    expect(statements.join("\n").replace("ON DELETE no action ON UPDATE no action", "")).not.toMatch(/\b(DROP|TRUNCATE|DELETE|RENAME|DISABLE ROW LEVEL SECURITY|NO FORCE|audit_event)\b/i);
    for (const line of [`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;`, `REVOKE ALL ON ${TABLE} FROM PUBLIC;`, `REVOKE ALL ON ${TABLE} FROM portal_runtime;`,
      `GRANT SELECT, INSERT ON ${TABLE} TO portal_runtime;`, `GRANT UPDATE (views) ON ${TABLE} TO portal_runtime;`]) expect(text).toContain(line);
    const rls = await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relkind='r'", [TABLE]);
    expect(rls.rows).toEqual([{ relname: TABLE, relrowsecurity: true, relforcerowsecurity: true }]);
    const bound = "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))";
    const policies = await client.query("select policyname, cmd, permissive, roles::text[] as roles, qual, with_check from pg_policies where tablename = $1", [TABLE]);
    expect(policies.rows).toEqual([{ policyname: "tenant_isolation", cmd: "ALL", permissive: "PERMISSIVE", roles: ["portal_runtime"], qual: bound, with_check: bound }]);
    const tableGrants = await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name = $1 order by privilege_type", [TABLE]);
    expect(tableGrants.rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
    const columnGrants = await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and privilege_type='UPDATE' and table_name = $1 order by column_name", [TABLE]);
    expect(columnGrants.rows).toEqual([{ column_name: "views" }]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = $1", [TABLE])).rows).toEqual([{ n: 0 }]);
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the checks hold the path to a lowercase slash-and-hyphen shape, the count above zero and the key to one row per day and path", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const insert = (path: string, views = 1, day = "2026-10-23", tenant = "crc") => client.query(`insert into ${TABLE}(tenant_id,day,path,views) values($1,$2,$3,$4)`, [tenant, day, path, views]);
    for (const bad of ["", "/", "read", "/Read", "/read?reading=noach", "/read#x", "/read/", "//read", "/read//noach", "/read/no ach", "/read/noach-", "/read/-noach", "/read/n.ach",
      "/read/%6eoach", "/learn/aé", `/${"a".repeat(96)}`]) await expect(insert(bad), JSON.stringify(bad)).rejects.toThrow();
    await expect(insert("/read", 0)).rejects.toThrow();
    await expect(insert("/read", -1)).rejects.toThrow();
    await expect(insert("/read", 1, "infinity")).rejects.toThrow();
    await expect(insert("/read", 1, "2026-10-23", "no-such-congregation")).rejects.toThrow();
    for (const good of ["/read", "/read/noach", "/read/any", "/learn/torah-zakef-gadol", "/trope-chart"]) await insert(good);
    await expect(insert("/read")).rejects.toThrow();
    await insert("/read", 1, "2026-10-24");
    await client.query("insert into tenant(id,name,product_name) values('other','Synthetic other','Synthetic')");
    await insert("/read", 1, "2026-10-23", "other");
  } finally { await client.close(); }
});

async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("as portal_runtime: the upsert counts up atomically, each congregation sees only its own counts, and nothing can be deleted or rewritten", async () => {
  const f = await accessFixture(); opened.push(f);
  type Tx = Parameters<Parameters<typeof withTenantTransaction>[2]>[0];
  const as = <T>(tenant: string, action: (tx: Tx) => Promise<T>) => withTenantTransaction(f.db, { tenantId: tenant }, action);
  const rows = (tenant: string) => as(tenant, async tx => ((await tx.execute(sql`select tenant_id, day::text as day, path, views from public_page_view_day order by day, path`)) as unknown as { rows: unknown[] }).rows);
  await as("crc", tx => countPublicPageView(tx, "crc", "2026-10-23", "/read"));
  await as("crc", tx => countPublicPageView(tx, "crc", "2026-10-23", "/read"));
  // Concurrent views of one page on one day all land.
  await Promise.all(Array.from({ length: 5 }, () => as("crc", tx => countPublicPageView(tx, "crc", "2026-10-23", "/read/noach"))));
  await as("crc", tx => countPublicPageView(tx, "crc", "2026-10-24", "/read"));
  await as("other", tx => countPublicPageView(tx, "other", "2026-10-23", "/read"));
  expect(await rows("crc")).toEqual([
    { tenant_id: "crc", day: "2026-10-23", path: "/read", views: 2 }, { tenant_id: "crc", day: "2026-10-23", path: "/read/noach", views: 5 },
    { tenant_id: "crc", day: "2026-10-24", path: "/read", views: 1 }]);
  expect(await rows("other")).toEqual([{ tenant_id: "other", day: "2026-10-23", path: "/read", views: 1 }]);
  expect(await rows("nobody")).toEqual([]);
  // A transaction bound to one congregation can neither write nor bump another's count.
  expect(await sqlState(as("crc", tx => countPublicPageView(tx, "other", "2026-10-23", "/learn")))).toBe("42501");
  expect(await sqlState(as("crc", tx => countPublicPageView(tx, "other", "2026-10-23", "/read")))).toBe("42501");
  expect(await rows("other")).toEqual([{ tenant_id: "other", day: "2026-10-23", path: "/read", views: 1 }]);
  // Only the count is writable; nothing is deleted or truncated.
  for (const statement of ["update public_page_view_day set path = '/learn'", "update public_page_view_day set day = day + 1", "update public_page_view_day set tenant_id = tenant_id",
    "delete from public_page_view_day", "truncate public_page_view_day"]) expect(await sqlState(as("crc", tx => tx.execute(sql.raw(statement)))), statement).toBe("42501");
  // The data layer itself refuses a path outside the allow-list or a malformed day before any SQL.
  await expect(as("crc", tx => countPublicPageView(tx, "crc", "2026-10-23", "/read/not-a-reading"))).rejects.toThrow("Not a public page");
  await expect(as("crc", tx => countPublicPageView(tx, "crc", "23-10-2026", "/read"))).rejects.toThrow("Not a public page");
  // At the integer ceiling the count stays put instead of failing.
  await f.owner(async () => { await f.client.query("update public_page_view_day set views = 2147483647 where tenant_id = 'crc' and day = '2026-10-24'"); });
  await as("crc", tx => countPublicPageView(tx, "crc", "2026-10-24", "/read"));
  expect((await rows("crc")).at(-1)).toMatchObject({ views: 2147483647 });
});
