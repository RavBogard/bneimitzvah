import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// 1.9 N19, a student's own verse cards (migration 0048): the owner_only policy against real PostgreSQL with a
// real restricted login, on the saved layer's model (saved-rls.integration.mjs). Its own database, opt-in only.
const doc = JSON.stringify({ schema: "learn-verses/v1", cards: {} });

async function begin(client, tenant, owner, setting = "app.verse_review_owner") {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  if (owner !== undefined) await query(client, `SELECT set_config('${setting}', $1, true)`, [owner]);
}
const count = async client => (await query(client, "SELECT count(*)::int AS n FROM verse_review")).rows[0].n;
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: owner_only keeps every student verse-review document to its own member and clears with the transaction", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_verse_${suffix}`, login = `portal_verse_${suffix}`, password = randomBytes(32).toString("hex");
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
      const user = `verse-${key}-${suffix}`, member = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic learner\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      await query(owner, "INSERT INTO verse_review (tenant_id,membership_id,user_id,review) VALUES ($1,$2,$3,$4::jsonb)", [tenant, member, user, doc]);
      members[key] = { user, member, tenant };
    }
    const { a, b, x } = members;

    await t.test("the table is forced, owned by the migration role, with one owner_only policy, column UPDATE only and no DELETE", async () => {
      const [row] = (await query(owner, "SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = 'verse_review'")).rows;
      assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login);
      assert.deepEqual((await query(owner, "SELECT policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE tablename = 'verse_review'")).rows, [{ policyname: "owner_only", cmd: "ALL", roles: ["portal_runtime"] }]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND table_name='verse_review' ORDER BY privilege_type")).rows.map(r => r.privilege_type), ["INSERT", "SELECT"]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='PUBLIC' AND table_name='verse_review'")).rows, []);
      assert.deepEqual((await query(owner, "SELECT column_name FROM information_schema.column_privileges WHERE grantee='portal_runtime' AND privilege_type='UPDATE' AND table_name='verse_review' ORDER BY column_name")).rows.map(r => r.column_name), ["review", "updated_at", "version"]);
    });

    await t.test("a tenant without an owner, or with another layer's owner setting, sees and writes nothing", async () => {
      const client = await checkout();
      try {
        assert.equal(await count(client), 0);
        for (const unset of [undefined, ""]) {
          await begin(client, "crc", unset);
          assert.equal(await count(client), 0);
          await rejects(client, "INSERT INTO verse_review (tenant_id,membership_id,user_id,review) VALUES ('crc',$1,$2,$3::jsonb)", [randomUUID(), a.user, doc], "42501");
          assert.equal((await query(client, "UPDATE verse_review SET version = version + 1")).rowCount, 0);
          await query(client, "ROLLBACK");
        }
        // Learn's progress owner, the service course's and the saved layer's never open a student's verse cards.
        for (const setting of ["app.course_owner", "app.service_course_owner", "app.saved_owner"]) {
          await begin(client, "crc", a.member, setting);
          assert.equal(await count(client), 0, setting);
          await query(client, "ROLLBACK");
        }
        await begin(client, "crc", "not-a-uuid");
        await rejects(client, "SELECT count(*) FROM verse_review", [], "22P02");
        await query(client, "ROLLBACK");
        await begin(client, "crc", a.member);
        await query(client, "SAVEPOINT rls_off");
        await query(client, "SET LOCAL row_security = off");
        await assert.rejects(query(client, "SELECT count(*) FROM verse_review"), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT rls_off");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("one owner never reaches another member's or another congregation's document", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc", a.member);
        assert.equal(await count(client), 1);
        assert.deepEqual((await query(client, "SELECT membership_id FROM verse_review")).rows, [{ membership_id: a.member }]);
        assert.equal((await query(client, "UPDATE verse_review SET version = version + 1 WHERE membership_id = $1", [b.member])).rowCount, 0);
        await rejects(client, "INSERT INTO verse_review (tenant_id,membership_id,user_id,review) VALUES ('crc',$1,$2,$3::jsonb)", [b.member, b.user, doc], "42501");
        for (const statement of ["UPDATE verse_review SET membership_id = membership_id", "UPDATE verse_review SET tenant_id = tenant_id", "UPDATE verse_review SET user_id = user_id",
          "DELETE FROM verse_review", "TRUNCATE verse_review"]) await rejects(client, statement, [], "42501");
        assert.equal((await query(client, "UPDATE verse_review SET version = version + 1, updated_at = now()")).rowCount, 1);
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
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.verse_review_owner', true), '') AS v")).rows[0].v, "");
        await begin(client, "crc");
        assert.equal(await count(client), 0);
        await query(client, "COMMIT");
        await begin(client, "crc", a.member);
        assert.equal((await query(client, "UPDATE verse_review SET version = version + 1 WHERE membership_id = $1", [a.member])).rowCount, 1);
        await query(client, "COMMIT");
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.verse_review_owner', true), '') AS v")).rows[0].v, "");
      } finally { client.release(); }
      assert.equal((await query(owner, "SELECT version FROM verse_review WHERE membership_id = $1", [a.member])).rows[0].version, 2);
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
