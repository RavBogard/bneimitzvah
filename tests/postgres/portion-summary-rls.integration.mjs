import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// Release 1.9 N6, portion summaries (migration 0044), against real PostgreSQL with a real restricted login: tenant isolation,
// the security-invoker public view (approved rows only), membership and grant ids never readable, approval only under a live
// admin grant, words never rewritten, nothing deleted. Its own database, opt-in only. Synthetic text only.
const DIGEST = "d".repeat(64);
const OUTLINE = "ARRAY['One','Two','Three','Four','Five','Six','Seven']::text[]";
async function begin(client, tenant) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
}
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: portion summaries are tenant-isolated, public only when approved by a live admin grant, and never reveal a person", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_summary_${suffix}`, login = `portal_summary_${suffix}`, password = randomBytes(32).toString("hex");
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
    // Migration 0056 backfills nothing: the operator sets CRC's credit (the other tenant has none, so it can never approve).
    await query(owner, "UPDATE tenant SET summary_credit='Rabbi Daniel Bogard' WHERE id='crc'");
    const people = {};
    for (const [key, tenant, role] of [["rabbi", "crc", "admin"], ["tutor", "crc", "tutor"], ["x", "test-other", "admin"]]) {
      const user = `summary-${key}-${suffix}`, member = randomUUID(), grant = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic person\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      await query(owner, "INSERT INTO role_grant (id,tenant_id,membership_id,role) VALUES ($1,$2,$3,$4)", [grant, tenant, member, role]);
      people[key] = { member, grant, tenant };
    }
    const draft = (tenant, reading, revision, member) => [`INSERT INTO portion_summary (tenant_id,reading_key,revision,status,summary,outline,drafted_by,mutation_id,request_digest) VALUES ($1,$2,$3,'draft','A synthetic summary.',${OUTLINE},$4,$5,$6)`,
      [tenant, reading, revision, member, randomUUID(), DIGEST]];
    const approve = (person, reading, revision, role = "admin", credit = "Rabbi Daniel Bogard") => ["UPDATE portion_summary SET status='approved', approved_by=$1, approved_grant_id=$2, approved_role=$3, approved_at=now(), credit=$6 WHERE reading_key=$4 AND revision=$5",
      [person.member, person.grant, role, reading, revision, credit]];

    await t.test("forced, owned by the migration role, one tenant_isolation policy, and a security-invoker view", async () => {
      const [row] = (await query(owner, "SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'portion_summary'")).rows;
      assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login);
      const options = (await query(owner, "SELECT reloptions FROM pg_class WHERE relname = 'portion_summary_public'")).rows[0].reloptions;
      assert.ok(options.includes("security_invoker=true"));
    });

    await t.test("the runtime drafts privately, approves only under a live admin grant, and the view shows approved rows only", async () => {
      const client = await checkout();
      try {
        assert.deepEqual((await query(client, "SELECT reading_key FROM portion_summary_public")).rows, []);
        await begin(client, "crc");
        await query(client, ...draft("crc", "vayera", 1, people.rabbi.member));
        assert.deepEqual((await query(client, "SELECT reading_key, status FROM portion_summary")).rows, [{ reading_key: "vayera", status: "draft" }]);
        assert.deepEqual((await query(client, "SELECT reading_key FROM portion_summary_public")).rows, []);
        for (const statement of ["SELECT drafted_by FROM portion_summary", "SELECT approved_by FROM portion_summary", "SELECT approved_grant_id FROM portion_summary", "SELECT * FROM portion_summary",
          "DELETE FROM portion_summary", "TRUNCATE portion_summary", "UPDATE portion_summary SET summary = 'Changed.'"]) await rejects(client, statement, [], "42501");
        // Another congregation's row: the trigger finds no live admin grant there under this setting before row security is asked.
        await rejects(client, ...draft("test-other", "vayera", 1, people.x.member), "23514");
        await rejects(client, ...approve(people.tutor, "vayera", 1, "tutor"), "23514");
        await rejects(client, ...approve(people.tutor, "vayera", 1), "23514");
        await rejects(client, ...draft("crc", "noach", 1, people.tutor.member), "23514");
        await rejects(client, ...approve(people.rabbi, "vayera", 1, "admin", "Someone Else"), "23514");
        await query(client, ...approve(people.rabbi, "vayera", 1));
        assert.deepEqual((await query(client, "SELECT reading_key, revision, credit FROM portion_summary_public")).rows, [{ reading_key: "vayera", revision: 1, credit: "Rabbi Daniel Bogard" }]);
        await rejects(client, "UPDATE portion_summary SET status = 'draft', approved_by = NULL, approved_grant_id = NULL, approved_role = NULL, approved_at = NULL, credit = NULL", [], "23514");
        await query(client, "UPDATE portion_summary SET status = 'withdrawn', withdrawn_at = now() WHERE revision = 1");
        assert.deepEqual((await query(client, "SELECT reading_key FROM portion_summary_public")).rows, []);
        await rejects(client, ...approve(people.rabbi, "vayera", 1), "23514");
        await query(client, "COMMIT");
        await begin(client, "test-other");
        assert.deepEqual((await query(client, "SELECT reading_key FROM portion_summary")).rows, []);
        // The other congregation's admin cannot reach a CRC revision, even as a raw UPDATE.
        assert.equal((await query(client, "UPDATE portion_summary SET status = 'withdrawn', withdrawn_at = now() WHERE reading_key = 'vayera'")).rowCount, 0);
        assert.equal((await query(client, ...approve(people.x, "vayera", 1))).rowCount, 0);
        await query(client, "ROLLBACK");
      } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    });

    await t.test("a revoked admin grant approves nothing", async () => {
      await query(owner, ...draft("crc", "noach", 1, people.rabbi.member));
      await query(owner, "UPDATE role_grant SET revoked_at = now() WHERE id = $1", [people.rabbi.grant]);
      const client = await checkout();
      try {
        await begin(client, "crc");
        await rejects(client, ...approve(people.rabbi, "noach", 1), "23514");
        await rejects(client, ...draft("crc", "noach", 2, people.rabbi.member), "23514");
        await query(client, "ROLLBACK");
      } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
