import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// Release 2.0 SC5 (A4 9): the per-part finished mark's policies against real PostgreSQL with a real restricted login
// (NOBYPASSRLS, through portal_runtime). Every refusal has a positive control beside it. Its own database, opt-in only.
async function begin(client, tenant, reader, context) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
  if (reader !== undefined) await query(client, "SELECT set_config('app.service_part_reader', $1, true)", [reader]);
  if (context !== undefined) await query(client, "SELECT set_config('app.service_part_context', $1, true)", [context]);
}
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: the finished mark is read only by the ruled readers and written only by the student", { timeout: 120000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_finished_${suffix}`, login = `portal_finished_${suffix}`, password = randomBytes(32).toString("hex");
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
    const person = async (key, tenant, role) => {
      const user = `finished-${key}-${suffix}`, member = randomUUID(), grant = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic person\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      await query(owner, "INSERT INTO role_grant (id,tenant_id,membership_id,role) VALUES ($1,$2,$3,$4)", [grant, tenant, member, role]);
      return { user, member, grant };
    };
    const student = async (tenant, last) => (await query(owner, "INSERT INTO student (tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ($1,'Synthetic',$2,'2027-01-02','family@example.test') RETURNING id", [tenant, last])).rows[0].id;
    const own = await student("crc", "Own"), sibling = await student("crc", "Sibling"), foreign = await student("test-other", "Foreign");
    const admin = await person("admin", "crc", "admin"), tutor = await person("tutor", "crc", "tutor"), stranger = await person("stranger", "crc", "tutor");
    const parent = await person("parent", "crc", "parent"), learner = await person("learner", "crc", "student"), foreignAdmin = await person("foreign-admin", "test-other", "admin");
    const link = (await query(owner, "INSERT INTO tutor_student (tenant_id,student_id,tutor_grant_id) VALUES ('crc',$1,$2) RETURNING id", [own, tutor.grant])).rows[0].id;
    const identity = (await query(owner, "INSERT INTO student_identity (tenant_id,student_id,role_grant_id) VALUES ('crc',$1,$2) RETURNING id", [own, learner.grant])).rows[0].id;
    const guardians = [];
    for (const child of [own, sibling]) guardians.push((await query(owner, "INSERT INTO guardian (tenant_id,student_id,parent_grant_id,link_provenance) VALUES ('crc',$1,$2,'synthetic') RETURNING id", [child, parent.grant])).rows[0].id);
    const sessionId = `finished-session-${suffix}`;
    await query(owner, "INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES ($1,now() + interval '1 day',$2,now(),now(),$3)", [sessionId, randomBytes(16).toString("hex"), parent.user]);
    const context = async (child, guardian, created, expires) => (await query(owner, `INSERT INTO practice_context (tenant_id,token_hash,auth_session_id,actor_user_id,actor_membership_id,role_grant_id,role,mode,acting_student_id,guardian_id,authority_revision,created_at,expires_at)
      VALUES ('crc',$1,$2,$3,$4,$5,'parent','child-practice',$6,$7,1,now() - $8::interval,now() + $9::interval) RETURNING id`, [createHash("sha256").update(randomUUID()).digest("hex"), sessionId, parent.user, parent.member, parent.grant, child, guardian, created, expires])).rows[0].id;
    const ownContext = await context(own, guardians[0], "0 seconds", "1 hour"), siblingContext = await context(sibling, guardians[1], "0 seconds", "1 hour"), expired = await context(own, guardians[0], "2 hours", "-1 hour");
    for (const [tenant, child, lesson] of [["crc", own, "shma"], ["crc", own, "vahavta"], ["crc", sibling, "shma"], ["test-other", foreign, "shma"]])
      await query(owner, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ($1,$2,$3)", [tenant, child, lesson]);

    const label = id => id === own ? "own" : id === sibling ? "sibling" : "foreign";
    const seen = async (client, tenant, reader, ctx) => {
      await begin(client, tenant, reader, ctx);
      const rows = (await query(client, "SELECT student_id, lesson_id FROM service_part_finished")).rows.map(r => `${label(r.student_id)}:${r.lesson_id}`).sort();
      await query(client, "ROLLBACK");
      return rows;
    };

    await t.test("the table is forced, owned by the migration role, with the restrictive tenant policy, one reader policy and one writer policy", async () => {
      const [row] = (await query(owner, "SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relname = 'service_part_finished'")).rows;
      assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true); assert.notEqual(row.owner, "portal_runtime"); assert.notEqual(row.owner, login);
      assert.deepEqual((await query(owner, "SELECT policyname, cmd, permissive, roles::text[] AS roles FROM pg_policies WHERE tablename = 'service_part_finished' ORDER BY policyname")).rows, [
        { policyname: "ruled_readers", cmd: "SELECT", permissive: "PERMISSIVE", roles: ["portal_runtime"] },
        { policyname: "student_writer", cmd: "INSERT", permissive: "PERMISSIVE", roles: ["portal_runtime"] },
        { policyname: "tenant_isolation", cmd: "ALL", permissive: "RESTRICTIVE", roles: ["portal_runtime"] }]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='portal_runtime' AND table_name='service_part_finished' ORDER BY privilege_type")).rows.map(r => r.privilege_type), ["SELECT"]);
      assert.deepEqual((await query(owner, "SELECT column_name FROM information_schema.column_privileges WHERE grantee='portal_runtime' AND privilege_type='INSERT' AND table_name='service_part_finished' ORDER BY column_name")).rows.map(r => r.column_name), ["lesson_id", "student_id", "tenant_id"]);
      assert.deepEqual((await query(owner, "SELECT privilege_type FROM information_schema.table_privileges WHERE grantee='PUBLIC' AND table_name='service_part_finished'")).rows, []);
      const [role] = (await query(owner, "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1", [login])).rows;
      assert.deepEqual(role, { rolbypassrls: false, rolsuper: false });
    });

    await t.test("each ruled reader sees exactly their own: admin the congregation, the linked tutor and the student one student, a parent only in child practice", async () => {
      const client = await checkout();
      try {
        for (const reader of [undefined, ""]) assert.deepEqual(await seen(client, "crc", reader), []);
        await begin(client, "crc", "not-a-uuid");
        await rejects(client, "SELECT count(*) FROM service_part_finished", [], "22P02");
        await query(client, "ROLLBACK");
        assert.deepEqual(await seen(client, "crc", admin.grant), ["own:shma", "own:vahavta", "sibling:shma"]);
        assert.deepEqual(await seen(client, "test-other", admin.grant), []);
        assert.deepEqual(await seen(client, "test-other", foreignAdmin.grant), ["foreign:shma"]);
        assert.deepEqual(await seen(client, "crc", foreignAdmin.grant), []);
        assert.deepEqual(await seen(client, "crc", tutor.grant), ["own:shma", "own:vahavta"]);
        assert.deepEqual(await seen(client, "crc", stranger.grant), []);
        assert.deepEqual(await seen(client, "crc", learner.grant), ["own:shma", "own:vahavta"]);
        // A parent in parent view reads nothing; in child practice, only the child the live context names.
        assert.deepEqual(await seen(client, "crc", parent.grant), []);
        assert.deepEqual(await seen(client, "crc", parent.grant, ownContext), ["own:shma", "own:vahavta"]);
        assert.deepEqual(await seen(client, "crc", parent.grant, siblingContext), ["sibling:shma"]);
        assert.deepEqual(await seen(client, "crc", parent.grant, expired), []);
        // A context never reads on its own or under another grant.
        assert.deepEqual(await seen(client, "crc", undefined, ownContext), []);
        assert.deepEqual(await seen(client, "crc", stranger.grant, ownContext), []);
        // row_security off is refused rather than bypassing the policies.
        await begin(client, "crc", admin.grant);
        await query(client, "SAVEPOINT rls_off");
        await query(client, "SET LOCAL row_security = off");
        await assert.rejects(query(client, "SELECT count(*) FROM service_part_finished"), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT rls_off");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("only the student inserts, only for their own student and only the three columns; nobody updates, deletes or truncates", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc", learner.grant);
        assert.equal((await query(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ('crc',$1,'torah-before') ON CONFLICT DO NOTHING RETURNING lesson_id", [own])).rows.length, 1);
        assert.equal((await query(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ('crc',$1,'shma') ON CONFLICT DO NOTHING RETURNING lesson_id", [own])).rows.length, 0);
        await rejects(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ('crc',$1,'torah-after')", [sibling], "42501");
        await rejects(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id,finished_at) VALUES ('crc',$1,'torah-after',now())", [own], "42501");
        for (const statement of ["UPDATE service_part_finished SET finished_at = now()", "UPDATE service_part_finished SET lesson_id = lesson_id", "DELETE FROM service_part_finished", "TRUNCATE service_part_finished"])
          await rejects(client, statement, [], "42501");
        await query(client, "COMMIT");
        for (const reader of [admin.grant, tutor.grant, parent.grant, stranger.grant]) {
          await begin(client, "crc", reader, reader === parent.grant ? ownContext : undefined);
          await rejects(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ('crc',$1,'haftarah-before')", [own], "42501");
          await query(client, "ROLLBACK");
        }
        await begin(client, "test-other", learner.grant);
        await rejects(client, "INSERT INTO service_part_finished (tenant_id,student_id,lesson_id) VALUES ('crc',$1,'haftarah-after')", [own], "42501");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
      // The owner can neither change nor remove a mark: the trigger refuses even the table owner.
      await assert.rejects(query(owner, "UPDATE service_part_finished SET finished_at = now()"), { code: "23514" });
      await assert.rejects(query(owner, "DELETE FROM service_part_finished"), { code: "23514" });
    });

    await t.test("revoking the tutor link, the student link, the grant or the context, or disabling the student, takes effect at once", async () => {
      const client = await checkout();
      try {
        await query(owner, "UPDATE tutor_student SET revoked_at = now() WHERE id = $1", [link]);
        assert.deepEqual(await seen(client, "crc", tutor.grant), []);
        await query(owner, "UPDATE practice_context SET revoked_at = now() WHERE id = $1", [ownContext]);
        assert.deepEqual(await seen(client, "crc", parent.grant, ownContext), []);
        await query(owner, "UPDATE guardian SET practice_enabled = false WHERE id = $1", [guardians[1]]);
        assert.deepEqual(await seen(client, "crc", parent.grant, siblingContext), []);
        assert.deepEqual(await seen(client, "crc", learner.grant), ["own:shma", "own:torah-before", "own:vahavta"]);
        await query(owner, "UPDATE student SET disabled_at = now() WHERE id = $1", [own]);
        assert.deepEqual(await seen(client, "crc", learner.grant), []);
        assert.deepEqual(await seen(client, "crc", admin.grant), ["sibling:shma"]);
        await query(owner, "UPDATE student SET disabled_at = NULL WHERE id = $1", [own]);
        await query(owner, "UPDATE student_identity SET revoked_at = now() WHERE id = $1", [identity]);
        assert.deepEqual(await seen(client, "crc", learner.grant), []);
        await query(owner, "UPDATE membership SET disabled_at = now() WHERE id = $1", [admin.member]);
        assert.deepEqual(await seen(client, "crc", admin.grant), []);
        assert.equal((await query(client, "SELECT coalesce(current_setting('app.service_part_reader', true), '') AS v")).rows[0].v, "");
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
