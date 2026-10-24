import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// The 1.4 saved layer's owner_only policy against real PostgreSQL with a real restricted login
// (accounts plan §7; threats 1-3). It runs in its own database so the shared rls suite's
// "fresh database" check is unaffected. Opt-in only, like every .integration.mjs file.
const TABLES = ["saved_reading", "saved_verse_mark", "saved_verse_work", "starred_comment"];

async function begin(client, tenant, owner) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  if (owner !== undefined) await query(client, "SELECT set_config('app.saved_owner', $1, true)", [owner]);
}
async function counts(client) {
  const out = [];
  for (const table of TABLES) out.push((await query(client, `SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  return out;
}
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: owner_only keeps every saved row to its own member, cascades as the owner and clears with the transaction", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_saved_${suffix}`, login = `portal_saved_${suffix}`, password = randomBytes(32).toString("hex");
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
      const user = `saved-${key}-${suffix}`, member = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic member\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      const reading = (await query(owner, "INSERT INTO saved_reading (tenant_id,membership_id,user_id,name,kind,ranges,verse_count) VALUES ($1,$2,$3,'Synthetic','torah','Genesis 1:1-3',3) RETURNING id", [tenant, member, user])).rows[0].id;
      await query(owner, "INSERT INTO saved_verse_work (tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) VALUES ($1,$2,$3,'Genesis 1:1','note','private',1)", [tenant, member, reading]);
      await query(owner, "INSERT INTO saved_verse_mark (tenant_id,membership_id,saved_reading_id,verse_ref,state,version) VALUES ($1,$2,$3,'Genesis 1:1','working',1)", [tenant, member, reading]);
      await query(owner, "INSERT INTO starred_comment (tenant_id,membership_id,user_id,work,verse_ref,comment_index) VALUES ($1,$2,$3,'rashi','Genesis 1:1',1)", [tenant, member, user]);
      members[key] = { user, member, reading, tenant };
    }
    const { a, b, x } = members;

    await t.test("the tables are forced, owned by the migration role, with one owner_only policy and column-level UPDATE only", async () => {
      const rows = (await query(owner, "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = ANY($1) ORDER BY c.relname", [TABLES])).rows;
      assert.equal(rows.length, 4);
      for (const row of rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login); }
      const policies = (await query(owner, "SELECT tablename, policyname, cmd, roles::text[] AS roles FROM pg_policies WHERE tablename = ANY($1) ORDER BY tablename", [TABLES])).rows;
      assert.deepEqual(policies, TABLES.map(tablename => ({ tablename, policyname: "owner_only", cmd: "ALL", roles: ["portal_runtime"] })));
      const updates = (await query(owner, "SELECT table_name FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND privilege_type IN ('UPDATE','TRUNCATE','REFERENCES','TRIGGER') AND table_name = ANY($1)", [TABLES])).rows;
      assert.deepEqual(updates, []);
      const deletes = (await query(owner, "SELECT table_name FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND privilege_type='DELETE' AND table_name = ANY($1)", [TABLES])).rows;
      assert.deepEqual(deletes.map(row => row.table_name).sort(), ["saved_reading", "starred_comment"]);
    });

    await t.test("the control-character CHECKs read \\x2028 as one code point on a real server, whatever its locale", async () => {
      // Were "\x2028" parsed as "\x20" then "28", the class would refuse a space and the digits instead.
      const work = (text, verse) => query(owner, "INSERT INTO saved_verse_work (tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) VALUES ('crc',$1,$2,$3,'translation',$4,1)", [a.member, a.reading, verse, text]);
      const reading = name => query(owner, "INSERT INTO saved_reading (tenant_id,membership_id,user_id,name,kind,ranges,verse_count) VALUES ('crc',$1,$2,$3,'torah','Genesis 1:1',1) RETURNING id", [a.member, a.user, name]);
      for (const bad of ["a\u2028b", "a\u2029b", "a\u0085b", "a\u0007b"]) {
        await assert.rejects(work(bad, "Genesis 1:2"), { code: "23514" }, JSON.stringify(bad));
        await assert.rejects(reading(bad), { code: "23514" }, JSON.stringify(bad));
      }
      await work("a 28b", "Genesis 1:2");
      await work("a 29b\ttab\nline \u05e9\u05dc\u05d5\u05dd", "Genesis 1:3");
      const kept = (await reading("a 28b")).rows[0].id;
      await query(owner, "DELETE FROM saved_verse_work WHERE saved_reading_id=$1 AND verse_ref IN ('Genesis 1:2','Genesis 1:3')", [a.reading]);
      await query(owner, "DELETE FROM saved_reading WHERE id=$1", [kept]);
    });

    await t.test("a tenant without an owner (every staff, MCP, cron and Sheet path) sees and writes nothing", async () => {
      const client = await checkout();
      try {
        assert.deepEqual(await counts(client), [0, 0, 0, 0]);
        for (const unset of [undefined, ""]) {
          await begin(client, "crc", unset);
          assert.deepEqual(await counts(client), [0, 0, 0, 0]);
          await rejects(client, "INSERT INTO saved_reading (tenant_id,membership_id,user_id,name,kind,ranges,verse_count) VALUES ('crc',$1,$2,'X','torah','Genesis 1:1',1)", [a.member, a.user], "42501");
          assert.equal((await query(client, "DELETE FROM saved_reading")).rowCount, 0);
          assert.equal((await query(client, "UPDATE saved_verse_work SET text='x'")).rowCount, 0);
          await query(client, "ROLLBACK");
        }
        await begin(client, "crc", "not-a-uuid");
        await rejects(client, "SELECT count(*) FROM saved_reading", [], "22P02");
        await query(client, "ROLLBACK");
        await begin(client, "crc", a.member);
        await query(client, "SAVEPOINT rls_off");
        await query(client, "SET LOCAL row_security = off");
        await assert.rejects(query(client, "SELECT count(*) FROM saved_verse_work"), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT rls_off");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("one owner never reaches another member's or another congregation's rows", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc", a.member);
        assert.deepEqual(await counts(client), [1, 1, 1, 1]);
        assert.deepEqual((await query(client, "SELECT id FROM saved_reading")).rows, [{ id: a.reading }]);
        assert.equal((await query(client, "SELECT count(*)::int AS n FROM saved_reading WHERE id = $1", [b.reading])).rows[0].n, 0);
        assert.equal((await query(client, "UPDATE saved_reading SET name='Taken' WHERE id=$1", [b.reading])).rowCount, 0);
        assert.equal((await query(client, "DELETE FROM saved_reading WHERE id=$1", [b.reading])).rowCount, 0);
        assert.equal((await query(client, "UPDATE saved_verse_work SET text='Taken' WHERE saved_reading_id=$1", [b.reading])).rowCount, 0);
        assert.equal((await query(client, "DELETE FROM starred_comment WHERE membership_id=$1", [b.member])).rowCount, 0);
        await rejects(client, "INSERT INTO saved_reading (tenant_id,membership_id,user_id,name,kind,ranges,verse_count) VALUES ('crc',$1,$2,'X','torah','Genesis 1:1',1)", [b.member, b.user], "42501");
        await rejects(client, "INSERT INTO saved_verse_work (tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) VALUES ('crc',$1,$2,'Genesis 1:2','note','x',1)", [b.member, b.reading], "42501");
        // Pointing your own child row at another member's reading fails the (tenant, reading, member) FK.
        await rejects(client, "INSERT INTO saved_verse_work (tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) VALUES ('crc',$1,$2,'Genesis 1:2','note','x',1)", [a.member, b.reading], "23503");
        // Ownership and identity never change; child rows are never deleted directly.
        // Since 0040 the owner may revise their own reading's ranges and verse count; another member's reading is out of reach.
        assert.equal((await query(client, "UPDATE saved_reading SET ranges='Genesis 1:1', verse_count=1 WHERE id=$1", [b.reading])).rowCount, 0);
        for (const statement of ["UPDATE saved_reading SET membership_id = membership_id", "UPDATE saved_reading SET tenant_id = tenant_id", "UPDATE saved_reading SET kind = kind",
          "UPDATE saved_verse_work SET membership_id = membership_id", "UPDATE saved_verse_mark SET membership_id = membership_id", "UPDATE starred_comment SET membership_id = membership_id",
          "UPDATE saved_verse_work SET saved_reading_id = saved_reading_id", "UPDATE starred_comment SET comment_index = 2", "DELETE FROM saved_verse_work", "DELETE FROM saved_verse_mark", "TRUNCATE saved_reading CASCADE", "TRUNCATE starred_comment"])
          await rejects(client, statement, [], "42501");
        await query(client, "ROLLBACK");
        // The same member id named under another congregation's tenant matches nothing, and that member's own rows stay there.
        await begin(client, "test-other", a.member);
        assert.deepEqual(await counts(client), [0, 0, 0, 0]);
        await query(client, "ROLLBACK");
        await begin(client, "crc", x.member);
        assert.deepEqual(await counts(client), [0, 0, 0, 0]);
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("the owner's delete cascades to the child rows though the runtime has no DELETE on them", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc", b.member);
        assert.equal((await query(client, "DELETE FROM saved_reading WHERE id=$1", [b.reading])).rowCount, 1);
        assert.deepEqual(await counts(client), [0, 0, 0, 1]);
        await query(client, "COMMIT");
        const left = (await query(owner, "SELECT (SELECT count(*)::int FROM saved_verse_work WHERE saved_reading_id=$1) AS work, (SELECT count(*)::int FROM saved_verse_mark WHERE saved_reading_id=$1) AS marks", [b.reading])).rows[0];
        assert.deepEqual(left, { work: 0, marks: 0 });
        assert.equal((await query(owner, "SELECT count(*)::int AS n FROM saved_verse_work WHERE saved_reading_id=$1", [a.reading])).rows[0].n, 1);
      } finally { client.release(); }
    });

    await t.test("commit and rollback both clear the owner before the same pooled backend is reused", async () => {
      let client = await checkout();
      const pid = (await query(client, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
      try {
        await begin(client, "crc", a.member);
        assert.deepEqual(await counts(client), [1, 1, 1, 1]);
        await assert.rejects(query(client, "SELECT 1/0"), { code: "22012" });
        await query(client, "ROLLBACK");
      } finally { client.release(); }
      client = await checkout();
      try {
        assert.equal((await query(client, "SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.saved_owner', true), '') AS v")).rows[0].v, "");
        await begin(client, "crc");
        assert.deepEqual(await counts(client), [0, 0, 0, 0]);
        await query(client, "COMMIT");
        await begin(client, "crc", a.member);
        assert.equal((await query(client, "UPDATE saved_reading SET name='Committed', revision=revision+1 WHERE id=$1", [a.reading])).rowCount, 1);
        await query(client, "COMMIT");
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.saved_owner', true), '') AS v")).rows[0].v, "");
        await begin(client, "crc");
        assert.deepEqual(await counts(client), [0, 0, 0, 0]);
        await query(client, "COMMIT");
      } finally { client.release(); }
      assert.equal((await query(owner, "SELECT name FROM saved_reading WHERE id=$1", [a.reading])).rows[0].name, "Committed");
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
