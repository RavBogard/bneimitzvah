import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// The public page-view counter (release 1.5, "path and day only"): its tenant_isolation policy and its upsert against real
// PostgreSQL, with a real restricted login and several connections at once. Its own database, opt-in only.
const UPSERT = "INSERT INTO public_page_view_day (tenant_id, day, path, views) VALUES ($1, $2, $3, 1) ON CONFLICT (tenant_id, day, path) DO UPDATE SET views = public_page_view_day.views + 1 WHERE public_page_view_day.views < 2147483647";

async function inTenant(pool, tenant, work) {
  const client = await pool.connect();
  try {
    await query(client, "SET ROLE portal_runtime");
    await query(client, "BEGIN");
    await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    const result = await work(client);
    await query(client, "COMMIT");
    return result;
  } catch (error) { await query(client, "ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

test("real PostgreSQL: concurrent upserts all count, each congregation sees and bumps only its own rows, and nothing else is writable", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_views_${suffix}`, login = `portal_views_${suffix}`, password = randomBytes(32).toString("hex");
  const anchor = new pg.Client(config);
  let owner, pool, createdDatabase = false, createdRole = false;
  try {
    try { await anchor.connect(); } catch { throw new Error("Postgres gate connection failed"); }
    await query(anchor, `CREATE DATABASE "${database}"`); createdDatabase = true;
    owner = new pg.Client({ ...config, database });
    await owner.connect();
    try { await migrate(drizzle(owner), { migrationsFolder: fileURLToPath(new URL("../../src/server/db/migrations", import.meta.url)) }); }
    catch { throw new Error("Postgres gate migration failed; raw details withheld"); }
    await query(owner, `CREATE ROLE "${login}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`); createdRole = true;
    await query(owner, `GRANT portal_runtime TO "${login}"`);
    await query(owner, "INSERT INTO tenant (id,name,product_name) VALUES ('test-other','Synthetic other','Synthetic')");
    pool = new pg.Pool({ ...config, database, user: login, password, max: 8 });

    await t.test("the table is forced, owned by the migration role, with one tenant_isolation policy, UPDATE (views) only and no DELETE", async () => {
      const [row] = (await query(owner, "SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = 'public_page_view_day'")).rows;
      assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login);
      assert.deepEqual((await query(owner, "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE tablename = 'public_page_view_day'")).rows, [{ policyname: "tenant_isolation", cmd: "ALL", roles: ["portal_runtime"] }]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND table_name='public_page_view_day' ORDER BY privilege_type")).rows.map(r => r.privilege_type), ["INSERT", "SELECT"]);
      assert.deepEqual((await query(owner, "SELECT column_name FROM information_schema.column_privileges WHERE grantee='portal_runtime' AND privilege_type='UPDATE' AND table_name='public_page_view_day'")).rows.map(r => r.column_name), ["views"]);
    });

    await t.test("forty concurrent upserts of one page on one day, over eight connections, count forty with no conflict error", async () => {
      await Promise.all(Array.from({ length: 40 }, () => inTenant(pool, "crc", client => query(client, UPSERT, ["crc", "2026-10-23", "/read"]))));
      await inTenant(pool, "test-other", client => query(client, UPSERT, ["test-other", "2026-10-23", "/read"]));
      assert.deepEqual((await query(owner, "SELECT tenant_id, views FROM public_page_view_day ORDER BY tenant_id")).rows, [{ tenant_id: "crc", views: 40 }, { tenant_id: "test-other", views: 1 }]);
    });

    await t.test("a transaction bound to one congregation cannot read, insert into or bump another's counts, and cannot rewrite or delete", async () => {
      assert.deepEqual(await inTenant(pool, "crc", async client => (await query(client, "SELECT tenant_id, views FROM public_page_view_day")).rows), [{ tenant_id: "crc", views: 40 }]);
      assert.deepEqual(await inTenant(pool, "nobody", async client => (await query(client, "SELECT count(*)::int AS n FROM public_page_view_day")).rows), [{ n: 0 }]);
      for (const [text, values] of [[UPSERT, ["test-other", "2026-10-23", "/read"]], [UPSERT, ["test-other", "2026-10-23", "/learn"]],
        ["UPDATE public_page_view_day SET path = '/learn'", []], ["UPDATE public_page_view_day SET tenant_id = 'test-other'", []], ["DELETE FROM public_page_view_day", []], ["TRUNCATE public_page_view_day", []]])
        await assert.rejects(inTenant(pool, "crc", client => query(client, text, values)), { code: "42501" }, text);
      assert.deepEqual((await query(owner, "SELECT tenant_id, path, views FROM public_page_view_day ORDER BY tenant_id")).rows,
        [{ tenant_id: "crc", path: "/read", views: 40 }, { tenant_id: "test-other", path: "/read", views: 1 }]);
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
