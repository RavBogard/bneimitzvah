import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

// Explicit opt-in only; .integration.mjs is excluded from the offline npm test.
// Refuse a general DATABASE_URL or a remote database: this suite creates roles
// and synthetic records and must run only against an empty disposable service.
function disposableConfig() {
  const env = process.env;
  if (env.POSTGRES_TEST_DISPOSABLE !== "1" || env.PGDATABASE !== "portal_rls_test"
      || !["127.0.0.1", "localhost", "::1"].includes(env.PGHOST)
      || !env.PGUSER || !env.PGPASSWORD || !/^\d+$/.test(env.PGPORT ?? "")) {
    throw new Error("Postgres gate requires explicit disposable loopback configuration");
  }
  return {
    host: env.PGHOST, port: Number(env.PGPORT), database: env.PGDATABASE,
    user: env.PGUSER, password: env.PGPASSWORD,
    connectionTimeoutMillis: 5000, statement_timeout: 10000,
  };
}

// Driver errors can contain row data, connection details and SQL. Preserve only
// SQLSTATE for assertions; never attach original errors, causes or parameters.
async function query(client, text, values) {
  try { return await client.query(text, values); }
  catch (error) {
    const code = /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : "unknown";
    throw Object.assign(new Error(`Postgres gate query failed (${code})`), { code });
  }
}

async function checkout(pool) {
  let client;
  try { client = await pool.connect(); }
  catch { throw new Error("Postgres gate runtime connection failed"); }
  try {
    await query(client, "SET ROLE portal_runtime");
    return client;
  } catch (error) { client.release(true); throw error; }
}

async function begin(client, tenant) {
  await query(client, "BEGIN");
  if (tenant !== undefined) await query(client, "SELECT set_config('app.tenant_id', $1, true)", [tenant]);
}

async function visibleStudents(client) {
  return (await query(client, "SELECT id, tenant_id FROM student ORDER BY id")).rows;
}

test("real PostgreSQL migrations enforce restricted-role tenant isolation and pool cleanup", { timeout: 60000 }, async t => {
  const config = disposableConfig();
  const owner = new pg.Client(config);
  const runtimePassword = randomBytes(32).toString("hex");
  let concurrentPool;
  let reusedPool;
  try {
    try { await owner.connect(); }
    catch { throw new Error("Postgres gate migration connection failed"); }
    const existing = await query(owner, "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'");
    assert.equal(existing.rows[0].count, 0, "use a fresh disposable database, not an existing application database");
    const migrationDir = fileURLToPath(new URL("../../src/server/db/migrations", import.meta.url));
    try {
      await migrate(drizzle(owner), { migrationsFolder: migrationDir });
      await migrate(drizzle(owner), { migrationsFolder: migrationDir });
    } catch { throw new Error("Postgres gate actual SQL migration/replay failed; raw details withheld"); }

    // A real login cannot RESET ROLE into the migration owner. Merely testing
    // SET ROLE on the superuser connection would miss this escalation risk.
    await query(owner, `CREATE ROLE portal_test_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`);
    await query(owner, "GRANT portal_runtime TO portal_test_login");
    const runtimeConfig = { ...config, user: "portal_test_login", password: runtimePassword };
    concurrentPool = new pg.Pool({ ...runtimeConfig, max: 2 });
    reusedPool = new pg.Pool({ ...runtimeConfig, max: 1 });

    const tenantA = "test-tenant-a";
    const tenantB = "test-tenant-b";
    const studentA = randomUUID();
    const studentB = randomUUID();
    const memberA = randomUUID();
    const memberB = randomUUID();
    const grantA = randomUUID();
    const grantB = randomUUID();
    for (const tenant of [tenantA, tenantB]) {
      await query(owner, "INSERT INTO tenant (id,name,product_name) VALUES ($1,'Synthetic congregation','Synthetic portal')", [tenant]);
    }
    for (const [tenant, student, member, grant, suffix] of [[tenantA,studentA,memberA,grantA,"a"],[tenantB,studentB,memberB,grantB,"b"]]) {
      await query(owner, 'INSERT INTO "user" (id,name,email,email_verified) VALUES ($1,\'Synthetic tutor\',$2,true)', [`fixture-${suffix}`, `fixture-${suffix}@example.test`]);
      await query(owner, "INSERT INTO membership (id,tenant_id,user_id) VALUES ($1,$2,$3)", [member,tenant,`fixture-${suffix}`]);
      await query(owner, "INSERT INTO role_grant (id,tenant_id,membership_id,role) VALUES ($1,$2,$3,'tutor')", [grant,tenant,member]);
      await query(owner, "INSERT INTO student (id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ($1,$2,'Synthetic','Learner','2027-01-02',$3)", [student,tenant,`guardian-${suffix}@example.test`]);
    }

    await t.test("all tenant tables FORCE RLS and runtime has no owner or bypass authority", async () => {
      const tables = (await query(owner, `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
        pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND (c.relname='tenant' OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped))
        AND c.relname <> 'tenant_host' ORDER BY c.relname`)).rows;
      assert.ok(tables.length >= 12, "actual domain migrations must contain the expected scoped tables");
      for (const row of tables) {
        assert.equal(row.relrowsecurity, true, `${row.relname} must enable RLS`);
        assert.equal(row.relforcerowsecurity, true, `${row.relname} must force RLS`);
        assert.notEqual(row.owner, "portal_runtime");
        assert.notEqual(row.owner, "portal_test_login");
      }
      const client = await checkout(reusedPool);
      try {
        const roles = (await query(client, "SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname IN (current_user,session_user)")).rows;
        assert.equal(roles.length, 2);
        for (const role of roles) for (const flag of ["rolsuper","rolbypassrls","rolcreatedb","rolcreaterole","rolreplication"]) assert.equal(role[flag], false);
        assert.equal((await query(client, "SELECT session_user::text AS login,current_user::text AS runtime")).rows[0].login, "portal_test_login");
        const ownerName = (await query(owner, "SELECT current_user::text AS name")).rows[0].name;
        assert.match(ownerName, /^[a-z_][a-z0-9_]*$/);
        await assert.rejects(query(client, `SET ROLE "${ownerName}"`), { code: "42501" });
        await assert.rejects(query(client, "ALTER ROLE portal_runtime BYPASSRLS"), { code: "42501" });
        await assert.rejects(query(client, "ALTER ROLE portal_test_login SUPERUSER"), { code: "42501" });
        await query(client, "RESET ROLE");
        await assert.rejects(query(client, `SET ROLE "${ownerName}"`), { code: "42501" });
        await assert.rejects(query(client, "SELECT * FROM drizzle.__drizzle_migrations"), { code: "42501" });
      } finally { client.release(); }
    });

    await t.test("missing and empty contexts deny reads and inserts, including directory tenant rows", async () => {
      const client = await checkout(reusedPool);
      try {
        assert.deepEqual(await visibleStudents(client), []);
        assert.deepEqual((await query(client, "SELECT id FROM tenant")).rows, []);
        await begin(client);
        await assert.rejects(query(client, "INSERT INTO student (tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ($1,'Synthetic','Blocked','2027-01-02','fixture@example.test')", [tenantA]), { code: "42501" });
        await query(client, "ROLLBACK");
        await begin(client, "");
        assert.deepEqual(await visibleStudents(client), []);
        await query(client, "COMMIT");
      } finally { client.release(); }
    });

    await t.test("tenant context limits unscoped reads/writes and composite FKs reject foreign relationships", async () => {
      const client = await checkout(reusedPool);
      try {
        await begin(client, tenantA);
        assert.deepEqual(await visibleStudents(client), [{ id: studentA, tenant_id: tenantA }]);
        assert.deepEqual((await query(client, "SELECT id FROM tenant")).rows, [{ id: tenantA }]);
        assert.equal((await query(client, "UPDATE student SET first_name='Blocked' WHERE id=$1", [studentB])).rowCount, 0);
        assert.equal((await query(client, "DELETE FROM student WHERE id=$1", [studentB])).rowCount, 0);
        await query(client, "INSERT INTO tutor_student (tenant_id,student_id,tutor_grant_id) VALUES ($1,$2,$3)", [tenantA,studentA,grantA]);
        await query(client, "SAVEPOINT foreign_relationship");
        await assert.rejects(query(client, "INSERT INTO tutor_student (tenant_id,student_id,tutor_grant_id) VALUES ($1,$2,$3)", [tenantA,studentA,grantB]), { code: "23503" });
        await query(client, "ROLLBACK TO SAVEPOINT foreign_relationship");
        await query(client, "SAVEPOINT foreign_insert");
        await assert.rejects(query(client, "INSERT INTO student (tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ($1,'Synthetic','Blocked','2027-01-02','fixture@example.test')", [tenantB]), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT foreign_insert");
        await query(client, "SAVEPOINT tenant_rewrite");
        await assert.rejects(query(client, "UPDATE student SET tenant_id=$1 WHERE id=$2", [tenantB,studentA]), { code: "23514" });
        await query(client, "ROLLBACK TO SAVEPOINT tenant_rewrite");
        await query(client, "SAVEPOINT rls_disable");
        await query(client, "SET LOCAL row_security=off");
        await assert.rejects(visibleStudents(client), { code: "42501" });
        await query(client, "ROLLBACK TO SAVEPOINT rls_disable");
        await query(client, "ROLLBACK");
      } finally { client.release(); }
    });

    await t.test("interleaved physical connections keep their tenant settings independent", async () => {
      const a = await checkout(concurrentPool);
      const b = await checkout(concurrentPool);
      try {
        const pidA = (await query(a, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
        const pidB = (await query(b, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
        assert.notEqual(pidA,pidB, "interleaving must use two real database connections");
        await begin(a, tenantA);
        await begin(b, tenantB);
        for (let round=0; round<3; round++) {
          const [rowsA,rowsB] = await Promise.all([visibleStudents(a),visibleStudents(b)]);
          assert.deepEqual(rowsA,[{id:studentA,tenant_id:tenantA}]);
          assert.deepEqual(rowsB,[{id:studentB,tenant_id:tenantB}]);
        }
        await query(a, "ROLLBACK");
        assert.deepEqual(await visibleStudents(a),[]);
        assert.deepEqual(await visibleStudents(b),[{id:studentB,tenant_id:tenantB}]);
        await query(b, "COMMIT");
        assert.deepEqual(await visibleStudents(b),[]);
      } finally { a.release(); b.release(); }
    });

    await t.test("exception rollback and commit clear tenant state before the same pooled backend is reused", async () => {
      let client = await checkout(reusedPool);
      const pid = (await query(client, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
      try {
        await begin(client,tenantA);
        await query(client, "UPDATE student SET first_name='RolledBack' WHERE id=$1", [studentA]);
        await assert.rejects(query(client, "SELECT 1/0"), {code:"22012"});
        await query(client,"ROLLBACK");
      } finally { client.release(); }
      client = await checkout(reusedPool);
      try {
        assert.equal((await query(client,"SELECT pg_backend_pid() AS pid")).rows[0].pid,pid);
        assert.deepEqual(await visibleStudents(client),[]);
        await begin(client,tenantB);
        assert.deepEqual(await visibleStudents(client),[{id:studentB,tenant_id:tenantB}]);
        await query(client,"COMMIT");
        assert.deepEqual(await visibleStudents(client),[]);
        await begin(client,tenantA);
        assert.equal((await query(client,"SELECT first_name FROM student WHERE id=$1",[studentA])).rows[0].first_name,"Synthetic");
        await query(client,"COMMIT");
      } finally { client.release(); }
    });
  } finally {
    await Promise.all([concurrentPool?.end(),reusedPool?.end()]);
    await owner.end();
  }
});
