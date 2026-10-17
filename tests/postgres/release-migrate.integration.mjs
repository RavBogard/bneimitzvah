import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";
import { RELEASE_BASE, sha, need, parseTarget, historicalFunctionContract, selectedReference } from "../../scripts/release-migrate-support.mjs";
import { executeRelease } from "../../scripts/release-migrate.mjs";
import { captureCatalog, verifyCatalog } from "../../scripts/release-migrate-catalog.mjs";

async function fixture(options = {}) {
  const config = disposableConfig(), suffix = randomBytes(8).toString("hex"), database = `release_test_${suffix}`, ownerRole = `release_owner_${suffix}`, runtimeRole = `release_runtime_${suffix}`, password = randomBytes(32).toString("hex");
  const anchor = new pg.Client(config); let owner, folder, createdDb = false, createdOwner = false, createdRuntime = false;
  async function close() {
    await owner?.end().catch(() => undefined);
    try { if (createdDb) await query(anchor, `DROP DATABASE "${database}"`); }
    finally { try { if (createdRuntime) await query(anchor, `DROP ROLE "${runtimeRole}"`); } finally { try { if (createdOwner) await query(anchor, `DROP ROLE "${ownerRole}"`); } finally { await anchor.end(); if (folder) await rm(folder, { recursive: true, force: true }); } } }
  }
  try {
    await anchor.connect();
    // Same idempotent NOLOGIN prerequisite as the standard migration fixture.
    // Concurrent creation may win; validate that role, never repair its flags.
    if (!(await query(anchor, "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_runtime') AS found")).rows[0].found) {
      try { await query(anchor, "CREATE ROLE portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"); }
      catch (error) { if (error.code !== "42710") throw error; }
    }
    const group = (await query(anchor, "SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='portal_runtime'")).rows;
    need(group.length === 1 && Object.values(group[0]).every(value => value === false));
    await query(anchor, `CREATE ROLE "${ownerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD '${password}'`); createdOwner = true;
    await query(anchor, `CREATE ROLE "${runtimeRole}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`); createdRuntime = true;
    await query(anchor, `GRANT portal_runtime TO "${runtimeRole}"`);
    await query(anchor, `CREATE DATABASE "${database}" OWNER "${ownerRole}"`); createdDb = true;
    const connection = { ...config, database, user: ownerRole, password };
    owner = new pg.Client(connection); await owner.connect();
    folder = await mkdtemp(join(tmpdir(), "portal-release-upgrade-")); await mkdir(join(folder, "meta"));
    const git = (...args) => execFileSync("git", args, { maxBuffer: 16 * 1024 * 1024 });
    const sourceFolder = "src/server/db/migrations", journal = JSON.parse(git("show", `${RELEASE_BASE}:${sourceFolder}/meta/_journal.json`));
    const migrations = [];
    for (const [index, row] of journal.entries.entries()) {
      const bytes = git("show", `${RELEASE_BASE}:${sourceFolder}/${row.tag}.sql`); await writeFile(join(folder, `${row.tag}.sql`), options.crlfHistory && index === 2 ? Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n")) : bytes);
      migrations.push({ index, tag: row.tag, hash: sha(bytes), createdAt: row.when, historicalAllowed: index < 11 || index === 13 ? [sha(bytes), sha(Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n")))] : [sha(bytes)] });
    }
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, 15) }));
    await migrate(drizzle(owner, { logger: false }), { migrationsFolder: folder });
    const reference = JSON.parse(await readFile(new URL("../fixtures/portal/release-migrate-reference.json", import.meta.url), "utf8"));

    await query(owner, `INSERT INTO public.student(tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES('crc','Synthetic','Release','2027-01-02','fixture@example.test')`);
    const prefix = (await query(owner, "SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows.map(row => ({ id: row.id, hash: row.hash, createdAt: Number(row.created_at) }));
    const identity = (await query(owner, "SELECT oid::text AS oid FROM pg_roles WHERE rolname=current_user")).rows[0];
    const major = Number((await query(owner, "SHOW server_version_num")).rows[0].server_version_num.slice(0, 2));
    const securitySQL = git("show", `${RELEASE_BASE}:${sourceFolder}/${journal.entries[2].tag}.sql`).toString("utf8");
    const source = { migrations, reference, historicalFunctions: historicalFunctionContract(reference, securitySQL, migrations[2]), recheck() {} };
    // Trusted direct composition lets this disposable test attest PG16/18 and
    // loopback. The public CLI still requires the production Neon/PG18 contract.
    const url = new URL("postgresql://ep-synthetic.neon.tech"); url.username = ownerRole; url.password = password; url.pathname = `/${database}`; url.searchParams.set("sslmode", "require");
    const parsed = parseTarget({ version: 1, migrationUrl: url.href,
      expected: { hostname: "ep-synthetic.neon.tech", database, owner: ownerRole, ownerOid: identity.oid, runtimeRole, serverMajor: 18, tenantId: "crc", canonicalOrigin: "https://beitmitzvah.centralreform.org" },
      historicalPrefix: prefix, provenance: { sourceCommit: RELEASE_BASE, method: "owner-readonly", observedAt: "2026-10-16T00:00:00.000Z" } }, source);
    // Preserve the REAL parseTarget startup/query options. Override only the
    // transport/attested major for this explicit disposable loopback test.
    const target = { ...parsed, expected: { ...parsed.expected, serverMajor: major }, connection: { ...parsed.connection, host: config.host, port: config.port, ssl: false } };
    await owner.query("BEGIN READ ONLY"); verifyCatalog(await captureCatalog(owner, ownerRole), selectedReference(source, target, 15)); await owner.query("ROLLBACK");
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
    const run = (apply = false, operation) => executeRelease(source, target, { apply, checks: { transport() {} }, /* Explicit disposable loopback only. */ connect: () => new pg.Client(target.connection), migrate: operation ?? (client => migrate(drizzle(client, { logger: false }), { migrationsFolder: folder })) });
    return { owner, connection, source, target, folder, journal, run, close };
  } catch { await close().catch(() => undefined); throw new Error("Release disposable fixture failed; details withheld"); }
}

test("configured operator startup targets public schema for the non-superuser migration owner", { timeout: 120000 }, async () => {
  const f = await fixture(), client = new pg.Client(f.target.connection);
  try {
    await client.connect(); const schema = (await query(client, "SELECT current_schema() AS schema")).rows[0].schema;
    const result = await f.run(true);
    assert.deepEqual({ schema, result }, { schema: "public", result: { ok: true, phase: "complete", outcome: "applied", apply: true, ledgerRows: 19 } });
    await query(f.owner, "GRANT CREATE ON SCHEMA public TO PUBLIC");
    try { const denied = await f.run(); assert.equal(denied.ok, false); assert.equal(denied.phase, "preflight"); assert.equal(denied.outcome, "not-started"); }
    finally { await query(f.owner, "REVOKE CREATE ON SCHEMA public FROM PUBLIC"); }
    assert.equal((await f.run()).outcome, "already-applied");
  } finally { await client.end(); await f.close(); }
});

test("real release migration wrapper preserves exact history, refuses concurrent operators, rolls back SQL failure and checks applied state without DDL", { timeout: 120000 }, async t => {
  let f;
  try {
    f = await fixture();
    await t.test("check-only leaves ledger/schema unchanged", async () => {
      assert.deepEqual(await f.run(), { ok: true, phase: "complete", outcome: "checked", apply: false, ledgerRows: 15 });
      assert.equal((await query(f.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 15);
    });
    await t.test("another physical owner connection holding the advisory lock refuses apply", async () => {
      const blocker = new pg.Client(f.connection); await blocker.connect();
      try { await query(blocker, "SELECT pg_advisory_lock($1,$2)", [214137, 151819]); const result = await f.run(true); assert.equal(result.ok, false); assert.equal(result.phase, "lock"); assert.equal(result.outcome, "not-started"); }
      finally { await query(blocker, "SELECT pg_advisory_unlock($1,$2)", [214137, 151819]); await blocker.end(); }
    });
    await t.test("late SQL error rolls back all four pending migrations; fresh check reconciles without retry", async () => {
      const path = join(f.folder, `${f.journal.entries[18].tag}.sql`), original = await readFile(path);
      await writeFile(path, Buffer.concat([original, Buffer.from("\n--> statement-breakpoint\nSELECT portal_intentional_missing_function();\n")]));
      try { const result = await f.run(true); assert.equal(result.ok, false); assert.equal(result.outcome, "unknown"); assert.equal(result.phase, "migration"); }
      finally { await writeFile(path, original); }
      assert.equal((await query(f.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 15);
      assert.equal((await query(f.owner, "SELECT to_regclass('public.lesson_log') IS NULL AS absent")).rows[0].absent, true);
      assert.equal((await f.run()).outcome, "checked");
    });
    await t.test("successful upgrade preserves synthetic old rows and exact prefix; repeat apply is check-only", async () => {
      assert.equal((await f.run(true)).outcome, "applied");
      assert.equal((await query(f.owner, "SELECT count(*)::int AS count FROM student WHERE first_name='Synthetic' AND last_name='Release'")).rows[0].count, 1);
      assert.equal((await f.run(true)).outcome, "already-applied");
    });
    await t.test("an unexpected runtime privilege fails exact applied-schema check", async () => {
      await query(f.owner, `GRANT UPDATE ON practice_event TO "${f.target.expected.runtimeRole}"`);
      try { const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.phase, "preflight"); }
      finally { await query(f.owner, `REVOKE UPDATE ON practice_event FROM "${f.target.expected.runtimeRole}"`); }
      assert.equal((await f.run()).outcome, "already-applied");
    });
  } finally { await f?.close(); }
});

test("real committed write conflict and lost COMMIT acknowledgement remain non-destructive reconcile outcomes", { timeout: 120000 }, async t => {
  for (const mode of ["legitimate-write", "lost-ack"]) {
    await t.test(mode, async () => {
      const f = await fixture();
      try {
        const result = await f.run(true, async client => {
          await migrate(drizzle(client, { logger: false }), { migrationsFolder: f.folder });
          if (mode === "lost-ack") throw new Error("Synthetic lost acknowledgement");
          await query(client, "UPDATE student SET first_name='Synthetic changed' WHERE first_name='Synthetic'");
        });
        assert.equal(result.ok, false); assert.equal(result.outcome, mode === "lost-ack" ? "unknown" : "committed-verification-conflict");
        assert.equal((await query(f.owner, "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, 19);
        assert.equal((await f.run()).outcome, "already-applied");
      } finally { await f.close(); }
    });
  }
});

test("attested exact CRLF migration2 functions survive 15-to-19 upgrade and check-only idempotence", { timeout: 120000 }, async () => {
  const f = await fixture({ crlfHistory: true });
  try {
    assert.notEqual(f.target.prefix[2].hash, f.source.migrations[2].hash);
    assert.equal((await f.run()).outcome, "checked");
    assert.deepEqual(await f.run(true), { ok: true, phase: "complete", outcome: "applied", apply: true, ledgerRows: 19 });
    assert.equal((await f.run(true)).outcome, "already-applied");
    const wrong = { ...f.target, prefix: f.target.prefix.map((row, i) => i === 2 ? { ...row, hash: f.source.migrations[2].hash } : row) };
    const refused = await executeRelease(f.source, wrong, { checks: { transport() {} }, connect: () => new pg.Client(wrong.connection) });
    assert.equal(refused.ok, false); assert.equal(refused.outcome, "not-started");
  } finally { await f.close(); }
});
