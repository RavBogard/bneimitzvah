import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// Release 1.7 M6, curated discussions (migration 0042), against real PostgreSQL with a real restricted login: tenant isolation,
// the security-invoker public view (published rows only), selected_by never readable, no DELETE or TRUNCATE, insert-only
// sources and translations. Its own database, opt-in only. Synthetic refs and text only.
const DIGEST = "c".repeat(64);
async function begin(client, tenant) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
}
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: curated discussions are tenant-isolated, publicly readable only when published, and never reveal a curator", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_discussions_${suffix}`, login = `portal_discussions_${suffix}`, password = randomBytes(32).toString("hex");
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
    for (const [key, tenant] of [["a", "crc"], ["x", "test-other"]]) {
      const user = `discussions-${key}-${suffix}`, member = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic curator\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      members[key] = { member, tenant };
    }
    const ids = {};
    for (const [slug, tenant, member, withdrawn] of [["kept", "crc", members.a.member, false], ["gone", "crc", members.a.member, true], ["elsewhere", "test-other", members.x.member, false]]) {
      const id = randomUUID(); ids[slug] = id;
      // A discussion and its first set in one transaction, as the service writes them.
      await query(owner, "BEGIN");
      await query(owner, "INSERT INTO curated_discussion (id,tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) VALUES ($1,$2,$3,'Synthetic question','torah','published',$4,$5,$6)", [id, tenant, slug, member, randomUUID(), DIGEST]);
      await query(owner, "INSERT INTO curated_discussion_source (tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by,selected_by_name) VALUES ($1,$2,1,1,'Synthetic Commentator on Genesis 12:1:1','Genesis 12:1','Synthetic English Edition',$3,'Synthetic Curator')", [tenant, id, member]);
      await query(owner, "COMMIT");
      if (withdrawn) await query(owner, "UPDATE curated_discussion SET status='withdrawn', revision=2 WHERE id=$1", [id]);
    }

    await t.test("forced, owned by the migration role, one tenant_isolation policy each, and a security-invoker view", async () => {
      const rows = (await query(owner, "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname IN ('curated_discussion','curated_discussion_source','source_translation') ORDER BY 1")).rows;
      assert.equal(rows.length, 3);
      for (const row of rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login); }
      const options = (await query(owner, "SELECT reloptions FROM pg_class WHERE relname = 'curated_discussion_public'")).rows[0].reloptions;
      assert.ok(options.includes("security_invoker=true"));
    });

    await t.test("the runtime sees its own tenant only, the view only published rows, and never selected_by", async () => {
      const client = await checkout();
      try {
        assert.deepEqual((await query(client, "SELECT slug FROM curated_discussion_public")).rows, []);
        await begin(client, "crc");
        assert.deepEqual((await query(client, "SELECT slug FROM curated_discussion ORDER BY slug")).rows, [{ slug: "gone" }, { slug: "kept" }]);
        assert.deepEqual((await query(client, "SELECT slug, position, anchor_ref FROM curated_discussion_public")).rows, [{ slug: "kept", position: 1, anchor_ref: "Genesis 12:1" }]);
        for (const statement of ["SELECT selected_by FROM curated_discussion", "SELECT selected_by FROM curated_discussion_source", "SELECT selected_by FROM source_translation", "SELECT * FROM curated_discussion"])
          await rejects(client, statement, [], "42501");
        for (const statement of ["DELETE FROM curated_discussion", "DELETE FROM curated_discussion_source", "TRUNCATE curated_discussion", "UPDATE curated_discussion SET slug = 'x'",
          "UPDATE curated_discussion_source SET ref = 'x'", "UPDATE source_translation SET body = 'x'"]) await rejects(client, statement, [], "42501");
        await rejects(client, "INSERT INTO curated_discussion (tenant_id,slug,title,kind,status,selected_by,mutation_id,request_digest) VALUES ('test-other','x','X','torah','published',$1,$2,$3)", [members.x.member, randomUUID(), DIGEST], "42501");
        await rejects(client, "UPDATE curated_discussion SET status = 'published', revision = 3 WHERE id = $1", [ids.gone], "23514");
        // A later transaction never adds to a published set, even at its current revision.
        await rejects(client, "INSERT INTO curated_discussion_source (tenant_id,discussion_id,revision,position,ref,anchor_ref,edition,selected_by,selected_by_name) VALUES ('crc',$1,1,2,'Synthetic Commentator on Genesis 12:2:1','Genesis 12:2','Synthetic English Edition',$2,'Synthetic Curator')", [ids.kept, members.a.member], "23514");
        assert.deepEqual((await query(client, "SELECT selected_by_name FROM curated_discussion_public")).rows, [{ selected_by_name: "Synthetic Curator" }]);
        assert.equal((await query(client, "UPDATE curated_discussion SET title = 'Revised', revision = 2, updated_at = now() WHERE id = $1", [ids.kept])).rowCount, 1);
        assert.equal((await query(client, "UPDATE curated_discussion SET title = 'Elsewhere', revision = 2 WHERE id = $1", [ids.elsewhere])).rowCount, 0);
        await query(client, "ROLLBACK");
        await begin(client, "test-other");
        assert.deepEqual((await query(client, "SELECT slug FROM curated_discussion_public")).rows, [{ slug: "elsewhere" }]);
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });
  } finally {
    await pool?.end();
    await owner?.end();
    if (createdDatabase) await query(anchor, `DROP DATABASE "${database}"`);
    if (createdRole) await query(anchor, `DROP ROLE "${login}"`);
    await anchor.end();
  }
});
