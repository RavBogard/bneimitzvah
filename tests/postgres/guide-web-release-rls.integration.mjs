import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

// Release and hold on the web Guides page (migration 0058), against real PostgreSQL with a real restricted login: study_guide stays forced
// and tenant-isolated, rows stay immutable, and a web-channel row is either an import or an exact copy of the version just before it that
// releases or holds it. The copy check is a trigger the runtime cannot skip or call. Its own database, opt-in only. Synthetic text only.
const DIGEST = "d".repeat(64);
const BODY = JSON.stringify({ overview: "A synthetic overview.", themes: [] });
const OTHER = JSON.stringify({ overview: "A different synthetic overview.", themes: [] });
async function begin(client, tenant) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
}
async function rejects(client, text, values, code) {
  await query(client, "SAVEPOINT probe");
  await assert.rejects(query(client, text, values), { code }, text);
  await query(client, "ROLLBACK TO SAVEPOINT probe");
}

test("real PostgreSQL: a web guide row copies the version before it exactly, under forced row security, and writes no text", { timeout: 90000 }, async t => {
  const config = disposableConfig();
  const suffix = randomBytes(6).toString("hex"), database = `portal_guide_web_${suffix}`, login = `portal_guide_web_${suffix}`, password = randomBytes(32).toString("hex");
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
    const people = {};
    for (const [key, tenant] of [["rabbi", "crc"], ["x", "test-other"]]) {
      const user = `guide-web-${key}-${suffix}`, member = randomUUID(), grant = randomUUID();
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic person\',$2,true)', [user, `${user}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member, tenant, user]);
      await query(owner, "INSERT INTO role_grant (id,tenant_id,membership_id,role) VALUES ($1,$2,$3,'admin')", [grant, tenant, member]);
      people[key] = { user, member, grant, tenant };
    }
    const columns = "tenant_id,kind,reading_key,version,base_version,previous_version,origin,reviewed,hold,body,actor_user_id,actor_membership_id,role_grant_id,role,mode,channel,mutation_id,request_digest,copy_of_version";
    const row = (person, key, version, { channel = "mcp", hold = false, reviewed = false, origin = "claude", body = BODY, copyOf = null } = {}) =>
      [`INSERT INTO study_guide (${columns}) VALUES ($1,'torah',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin','admin',$13,$14,$15,$16)`,
        [person.tenant, key, version, version - 1, version === 1 ? null : version - 1, origin, reviewed, hold, body, person.user, person.member, person.grant, channel, randomUUID(), DIGEST, copyOf]];

    await t.test("study_guide is still forced, owned by the migration role, with one tenant_isolation policy, and the copy trigger is nobody else's to call", async () => {
      const [table] = (await query(owner, "SELECT relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname = 'study_guide'")).rows;
      assert.equal(table.relrowsecurity, true); assert.equal(table.relforcerowsecurity, true); assert.notEqual(table.owner, "portal_runtime"); assert.notEqual(table.owner, login);
      assert.deepEqual((await query(owner, "SELECT policyname FROM pg_policies WHERE tablename = 'study_guide'")).rows, [{ policyname: "tenant_isolation" }]);
      const grants = (await query(owner, "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'study_guide' ORDER BY grantee, privilege_type")).rows
        .filter(g => g.grantee !== table.owner);
      assert.deepEqual(grants, [{ grantee: "portal_runtime", privilege_type: "INSERT" }, { grantee: "portal_runtime", privilege_type: "SELECT" }]);
      const [fn] = (await query(owner, "SELECT has_function_privilege('public', 'portal_study_guide_copy()', 'EXECUTE') AS public, has_function_privilege('portal_runtime', 'portal_study_guide_copy()', 'EXECUTE') AS runtime")).rows;
      assert.deepEqual(fn, { public: false, runtime: false });
      const [trigger] = (await query(owner, "SELECT tgenabled FROM pg_trigger WHERE tgname = 'study_guide_copy' AND tgrelid = 'study_guide'::regclass")).rows;
      assert.equal(trigger.tgenabled, "O");
    });

    await t.test("the copy check alone refuses a version-one copy, with no version before it to name", async () => {
      await begin(owner);
      try {
        await query(owner, "ALTER TABLE study_guide DISABLE TRIGGER study_guide_copy");
        await rejects(owner, ...row(people.rabbi, "bo", 1, { channel: "web", hold: true, copyOf: 1 }), "23514");
      } finally { await query(owner, "ROLLBACK"); }
    });

    await t.test("the runtime releases and holds by exact copy only; new text, labels and other congregations are refused", async () => {
      const client = await checkout();
      try {
        await begin(client, "crc");
        const r = people.rabbi;
        await query(client, ...row(r, "pekudei", 1));
        await query(client, ...row(r, "pekudei", 2, { hold: true, body: OTHER }));
        // The web may not save text: no copy, or a copy with anything changed, is refused.
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: OTHER }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: BODY, copyOf: 2 }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: OTHER, reviewed: true, copyOf: 2 }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: OTHER, origin: "rabbi", copyOf: 2 }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: OTHER, hold: true, copyOf: 2 }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "web", body: BODY, copyOf: 1 }), "23514");
        await rejects(client, ...row(r, "pekudei", 3, { channel: "mcp", body: OTHER, copyOf: 2 }), "23514");
        // The function is not callable directly, and the trigger is not the runtime's to disable.
        await rejects(client, "SELECT portal_study_guide_copy()", [], "42501");
        await rejects(client, "ALTER TABLE study_guide DISABLE TRIGGER study_guide_copy", [], "42501");
        // Release version 2, then hold the release: exact copies.
        await query(client, ...row(r, "pekudei", 3, { channel: "web", body: OTHER, copyOf: 2 }));
        await query(client, ...row(r, "pekudei", 4, { channel: "web", body: OTHER, hold: true, copyOf: 3 }));
        assert.deepEqual((await query(client, "SELECT version, channel, hold, copy_of_version FROM study_guide WHERE reading_key = 'pekudei' ORDER BY version")).rows.map(x => [x.version, x.channel, x.hold, x.copy_of_version]),
          [[1, "mcp", false, null], [2, "mcp", true, null], [3, "web", false, 2], [4, "web", true, 3]]);
        // A temporary table called study_guide (the runtime may create temporary tables) cannot stand in for the real one.
        await query(client, "SAVEPOINT shadow");
        await query(client, "CREATE TEMP TABLE study_guide AS SELECT * FROM public.study_guide WHERE false");
        await query(client, `INSERT INTO pg_temp.study_guide (tenant_id,kind,reading_key,version,body,origin,reviewed,hold) VALUES ('crc','torah','pekudei',4,$1,'rabbi',true,true)`, [BODY]);
        await rejects(client, `INSERT INTO public.study_guide (${columns}) VALUES ($1,'torah',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin','admin',$13,$14,$15,$16)`,
          row(r, "pekudei", 5, { channel: "web", body: BODY, origin: "rabbi", reviewed: true, copyOf: 4 })[1], "23514");
        await query(client, "ROLLBACK TO SAVEPOINT shadow");
        // A version-one web row naming a copy is refused.
        await rejects(client, ...row(r, "bo", 1, { channel: "web", hold: true, copyOf: 1 }), "23514");
        // Rows stay immutable.
        await rejects(client, "UPDATE study_guide SET hold = false WHERE version = 4", [], "42501");
        await rejects(client, "DELETE FROM study_guide", [], "42501");
        // A row for another congregation is refused by row security; a web copy into it first finds no version there to copy.
        await rejects(client, ...row(people.x, "pekudei", 1), "42501");
        await rejects(client, ...row(people.x, "pekudei", 5, { channel: "web", body: OTHER, copyOf: 4 }), "23514");
        await query(client, "COMMIT");
        // Under the other congregation's setting, CRC's versions are invisible, so a copy of one finds nothing to copy.
        await begin(client, "test-other");
        assert.deepEqual((await query(client, "SELECT version FROM study_guide")).rows, []);
        await rejects(client, ...row(people.x, "pekudei", 2, { channel: "web", body: OTHER, copyOf: 1 }), "23514");
        await query(client, ...row(people.x, "noach", 1));
        await rejects(client, ...row(people.x, "noach", 2, { channel: "web", body: OTHER, hold: true, copyOf: 1 }), "23514");
        await query(client, ...row(people.x, "noach", 2, { channel: "web", hold: true, copyOf: 1 }));
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
