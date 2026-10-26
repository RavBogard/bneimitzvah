import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// Learn to lein's signed-in progress (plan, slice 3): the owner_only policy against real PostgreSQL with a
// real restricted login, on the saved layer's model (saved-rls.integration.mjs). Its own database, opt-in only.
const doc = JSON.stringify({ schema: "learn-progress/v1", lessons: {}, cards: {} });

async function begin(client, tenant, owner, setting = "app.course_owner") {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  if (owner !== undefined) await query(client, `SELECT set_config('${setting}', $1, true)`, [owner]);
}
const count = async client => (await query(client, "SELECT count(*)::int AS n FROM course_progress")).rows[0].n;
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: owner_only keeps every course-progress document to its own member and clears with the transaction", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_course_${suffix}`, login = `portal_course_${suffix}`, password = randomBytes(32).toString("hex");
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
    pool = new pg.Pool({ ...config, database, user: login, password, max: 1 });
    const checkout = async () => { const client = await pool.connect(); await query(client, "SET ROLE portal_runtime"); return client; };

    await query(owner, "INSERT INTO tenant (id,name,product_name) VALUES ('test-other','Synthetic other','Synthetic')");
    const members = {};
    for (const [key, tenant] of [["a", "crc"], ["b", "crc"], ["x", "test-other"]]) {
      const user = `course-${key}-${suffix}`, member = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic learner\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      await query(owner, "INSERT INTO course_progress (tenant_id,membership_id,user_id,progress) VALUES ($1,$2,$3,$4::jsonb)", [tenant, member, user, doc]);
      members[key] = { user, member, tenant };
    }
    const { a, b, x } = members;

    await t.test("the table is forced, owned by the migration role, with one owner_only policy, column UPDATE only and no DELETE", async () => {
      const [row] = (await query(owner, "SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = 'course_progress'")).rows;
      assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login);
      assert.deepEqual((await query(owner, "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE tablename = 'course_progress' ORDER BY policyname")).rows, [{ policyname: "assigned_tutor_reader", cmd: "SELECT", roles: ["portal_runtime"] }, { policyname: "owner_only", cmd: "ALL", roles: ["portal_runtime"] }]); // 1.9 N23 (0052) adds the assigned tutor reader.
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND table_name='course_progress' ORDER BY privilege_type")).rows.map(r => r.privilege_type), ["INSERT", "SELECT"]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='PUBLIC' AND table_name='course_progress'")).rows, []);
      assert.deepEqual((await query(owner, "SELECT column_name FROM information_schema.column_privileges WHERE grantee='portal_runtime' AND privilege_type='UPDATE' AND table_name='course_progress' ORDER BY column_name")).rows.map(r => r.column_name), ["progress", "updated_at", "version"]);
    });

    await t.test("a tenant without an owner, or with the saved layer's owner setting, sees and writes nothing", async () => {
      const client = await checkout();
      try {
        assert.equal(await count(client), 0);
        for (const unset of [undefined, ""]) {
          await begin(client, "crc", unset);
          assert.equal(await count(client), 0);
          await rejects(client, "INSERT INTO course_progress (tenant_id,membership_id,user_id,progress) VALUES ('crc',$1,$2,$3::jsonb)", [randomUUID(), a.user, doc], "42501");
          assert.equal((await query(client, "UPDATE course_progress SET version = version + 1")).rowCount, 0);
          await query(client, "ROLLBACK");
        }
        await begin(client, "crc", a.member, "app.saved_owner");
        assert.equal(await count(client), 0);
        await query(client, "ROLLBACK");
        await begin(client, "crc", "not-a-uuid");
        await rejects(client, "SELECT count(*) FROM course_progress", [], "22P02");
        await query(client, "ROLLBACK");
        await begin(client, "crc", a.member);
        await query(client, "SAVEPOINT rls_off");
        await query(client, "SET LOCAL row_security = off");
        await assert.rejects(query(client, "SELECT count(*) FROM course_progress"), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT rls_off");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("one owner never reaches another member's or another congregation's document", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc", a.member);
        assert.equal(await count(client), 1);
        assert.deepEqual((await query(client, "SELECT membership_id FROM course_progress")).rows, [{ membership_id: a.member }]);
        assert.equal((await query(client, "UPDATE course_progress SET version = version + 1 WHERE membership_id = $1", [b.member])).rowCount, 0);
        await rejects(client, "INSERT INTO course_progress (tenant_id,membership_id,user_id,progress) VALUES ('crc',$1,$2,$3::jsonb)", [b.member, b.user, doc], "42501");
        for (const statement of ["UPDATE course_progress SET membership_id = membership_id", "UPDATE course_progress SET tenant_id = tenant_id", "UPDATE course_progress SET user_id = user_id",
          "DELETE FROM course_progress", "TRUNCATE course_progress"]) await rejects(client, statement, [], "42501");
        assert.equal((await query(client, "UPDATE course_progress SET version = version + 1, updated_at = now()")).rowCount, 1);
        await query(client, "ROLLBACK");
        await begin(client, "test-other", a.member);
        assert.equal(await count(client), 0);
        await query(client, "ROLLBACK");
        await begin(client, "crc", x.member);
        assert.equal(await count(client), 0);
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("commit and rollback both clear the owner before the same pooled backend is reused", async () => {
      let client = await checkout();
      const pid = (await query(client, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
      try {
        await begin(client, "crc", a.member);
        assert.equal(await count(client), 1);
        await assert.rejects(query(client, "SELECT 1/0"), { code: "22012" });
        await query(client, "ROLLBACK");
      } finally { client.release(); }
      client = await checkout();
      try {
        assert.equal((await query(client, "SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.course_owner', true), '') AS v")).rows[0].v, "");
        await begin(client, "crc");
        assert.equal(await count(client), 0);
        await query(client, "COMMIT");
        await begin(client, "crc", a.member);
        assert.equal((await query(client, "UPDATE course_progress SET version = version + 1 WHERE membership_id = $1", [a.member])).rowCount, 1);
        await query(client, "COMMIT");
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.course_owner', true), '') AS v")).rows[0].v, "");
      } finally { client.release(); }
      assert.equal((await query(owner, "SELECT version FROM course_progress WHERE membership_id = $1", [a.member])).rows[0].version, 2);
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
