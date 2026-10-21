import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/add-congregation.mjs", import.meta.url));
const ARGS = ["--id", "synthetic-shul", "--name", "Synthetic Congregation", "--product-name", "Synthetic Portal", "--host", "portal.synthetic.example",
  "--origin", "https://portal.synthetic.example", "--environment", "production", "--deployment", "production"];

// A real non-superuser owner (BYPASSRLS, as on Neon) and a real restricted runtime login, each in a spawned
// process with an isolated environment: dry run writes nothing, apply writes exactly three rows, the runtime is refused.
test("the onboarding script, spawned against real PostgreSQL, dry-runs, applies exactly tenant + host + settings, and refuses the runtime login", { timeout: 120000 }, async () => {
  const config = disposableConfig(), suffix = randomBytes(8).toString("hex"), database = `onboard_test_${suffix}`, ownerRole = `onboard_owner_${suffix}`, runtimeRole = `onboard_runtime_${suffix}`, password = randomBytes(32).toString("hex");
  const anchor = new pg.Client(config); let owner, createdDb = false, createdOwner = false, createdRuntime = false;
  const home = await isolatedEnv();
  const url = (user) => { const value = new URL("postgresql://localhost"); value.hostname = config.host; value.port = String(config.port); value.username = user; value.password = password; value.pathname = `/${database}`; return value.href; };
  const run = (user, apply) => spawnSync(process.execPath, [SCRIPT, ...ARGS, ...(apply ? ["--apply"] : [])], { env: { ...home.env, OWNER_DATABASE_URL: url(user) }, encoding: "utf8", timeout: 60000 });
  try {
    await anchor.connect();
    if (!(await query(anchor, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_runtime') AS found")).rows[0].found) {
      try { await query(anchor, "CREATE ROLE portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"); }
      catch (error) { if (error.code !== "42710") throw error; }
    }
    await query(anchor, `CREATE ROLE "${ownerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD '${password}'`); createdOwner = true;
    await query(anchor, `CREATE ROLE "${runtimeRole}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`); createdRuntime = true;
    await query(anchor, `GRANT portal_runtime TO "${runtimeRole}"`);
    await query(anchor, `CREATE DATABASE "${database}" OWNER "${ownerRole}"`); createdDb = true;
    owner = new pg.Client({ ...config, database, user: ownerRole, password }); await owner.connect();
    await migrate(drizzle(owner, { logger: false }), { migrationsFolder: fileURLToPath(new URL("../../src/server/db/migrations", import.meta.url)) });
    const counts = async () => (await query(owner, `SELECT (SELECT count(*)::int FROM tenant) AS t, (SELECT count(*)::int FROM tenant_host) AS h,
      (SELECT count(*)::int FROM tenant_settings) AS s, (SELECT count(*)::int FROM membership) AS m, (SELECT count(*)::int FROM invite) AS i, (SELECT count(*)::int FROM audit_event) AS a`)).rows[0];
    const before = await counts();

    const runtime = run(runtimeRole, true);
    assert.equal(runtime.status, 1); assert.deepEqual(JSON.parse(runtime.stdout), { outcome: "refused", code: "owner-required" });
    const dry = run(ownerRole, false);
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout), { outcome: "dry-run", tenant: "synthetic-shul", host: "portal.synthetic.example", environment: "production", rows: { tenant: 1, tenantHost: 1, tenantSettings: 1 }, settingsVersion: 1 });
    assert.deepEqual(await counts(), before);
    const applied = run(ownerRole, true);
    assert.equal(applied.status, 0, applied.stderr); assert.equal(JSON.parse(applied.stdout).outcome, "applied");
    assert.deepEqual(await counts(), { ...before, t: before.t + 1, h: before.h + 1, s: before.s + 1 });
    for (const output of [runtime, dry, applied]) assert.ok(!(output.stdout + output.stderr).includes(password) && !(output.stdout + output.stderr).includes(ownerRole));
    const again = run(ownerRole, true);
    assert.equal(again.status, 1); assert.deepEqual(JSON.parse(again.stdout), { outcome: "refused", code: "tenant-exists" });
    // The new congregation's settings are visible to the runtime only inside that congregation.
    const restricted = new pg.Client({ ...config, database, user: runtimeRole, password }); await restricted.connect();
    try {
      await query(restricted, "BEGIN"); await query(restricted, "SET LOCAL ROLE portal_runtime"); await query(restricted, "SELECT set_config('app.tenant_id','synthetic-shul',true)");
      assert.deepEqual((await query(restricted, "SELECT version, body, channel FROM tenant_settings")).rows, [{ version: 1, body: {}, channel: "operator" }]);
      await query(restricted, "SELECT set_config('app.tenant_id','crc',true)");
      assert.deepEqual((await query(restricted, "SELECT version FROM tenant_settings")).rows, []);
      await query(restricted, "ROLLBACK");
    } finally { await restricted.end(); }
  } finally {
    await owner?.end().catch(() => undefined);
    try { if (createdDb) await query(anchor, `DROP DATABASE "${database}"`); }
    finally { try { if (createdRuntime) await query(anchor, `DROP ROLE "${runtimeRole}"`); } finally { try { if (createdOwner) await query(anchor, `DROP ROLE "${ownerRole}"`); } finally { await anchor.end(); await home.cleanup(); } } }
  }
});
