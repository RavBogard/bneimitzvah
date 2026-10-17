import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { argumentsFor, parseTarget, checkLedger, sourceContract, sha, RELEASE_BASE, RELEASE_FILES, NEW_TABLES } from "../scripts/release-migrate-support.mjs";
import { executeRelease, runRelease, ReleaseClient, assertReleaseTransport } from "../scripts/release-migrate.mjs";
import { verifyCatalog } from "../scripts/release-migrate-catalog.mjs";

const candidate = "a".repeat(40);
function source() {
  const migrations = Array.from({ length: 19 }, (_, index) => ({ index, tag: `migration_${index}`, createdAt: 1000 + index, hash: sha(`LF${index}`), historicalAllowed: index < 11 || index === 13 ? [sha(`LF${index}`), sha(`CRLF${index}`)] : [sha(`LF${index}`)] }));
  return { migrations, recheck() {}, reference: { baseline: { tables: [{ name: "student" }] }, final: { tables: ["student", ...NEW_TABLES].sort().map(name => ({ name })) } } };
}
function manifest(s = source()) {
  return { version: 1, migrationUrl: "postgresql://release_owner:synthetic-password@ep-synthetic.neon.tech/synthetic?sslmode=require",
    expected: { hostname: "ep-synthetic.neon.tech", database: "synthetic", owner: "release_owner", ownerOid: "501", runtimeRole: "release_runtime", serverMajor: 18, tenantId: "crc", canonicalOrigin: "https://beitmitzvah.centralreform.org" },
    historicalPrefix: s.migrations.slice(0, 15).map((migration, index) => ({ id: index + 1, hash: migration.hash, createdAt: migration.createdAt })),
    provenance: { sourceCommit: RELEASE_BASE, method: "owner-readonly", observedAt: "2026-10-16T00:00:00.000Z" } };
}
function harness(options = {}) {
  const s = source(), target = parseTarget(manifest(s), s), log = []; let length = options.already ? 19 : 15, ended = 0, migrations = 0, catalogs = 0;
  const ledger = () => s.migrations.slice(0, length).map((row, index) => ({ id: index + 1, hash: row.hash, created_at: row.createdAt }));
  const client = Object.assign(new EventEmitter(), {
    async connect() { log.push("connect"); }, async end() { ended++; log.push("end"); },
    async query(sql) { log.push(sql); if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: !options.locked }] }; if (sql.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] }; if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: ledger() }; return { rows: [] }; },
  });
  const checks = {
    transport() {}, // Explicit synthetic client; real CLI never bypasses transport.
    async identity(value) { assert.equal(value, client); if (options.identityFailure) throw new Error("private-driver-detail"); },
    async catalog() { catalogs++; return options.postSchemaFailure && length === 19 ? { tables: [] } : length === 15 ? s.reference.baseline : s.reference.final; }, verifyCatalog,
    async roles() { return { roles: ["same-role"], memberships: [] }; },
    async data(_client, names) { return names.sort().map(name => ({ name, count: options.concurrentWrite && length === 19 && name === "student" ? 2 : name === "student" ? 1 : 0, digest: name === "student" ? "same" : "empty" })); },
  };
  return { s, target, client, log, checks, get ended() { return ended; }, get migrations() { return migrations; }, get catalogs() { return catalogs; },
    async migrate(value) { assert.equal(value, client); assert.equal(log.at(-1), "ROLLBACK"); migrations++; log.push("migrate"); if (options.migrateFailure) throw new Error("private-driver-detail"); length = 19; },
  };
}
async function execute(h, apply = true) { return executeRelease(h.s, h.target, { apply, connect: () => h.client, migrate: h.migrate, checks: h.checks }); }

test("CLI defaults to check-only and requires exact candidate/target without credential arguments", () => {
  assert.equal(argumentsFor(["--expected-commit", candidate, "--target", "private.json"]).apply, false);
  assert.equal(argumentsFor(["--expected-commit", candidate, "--target", "private.json", "--apply"]).apply, true);
  for (const args of [[], ["--apply"], ["--expected-commit", "main", "--target", "private.json"], ["--expected-commit", candidate, "--target", "private.json", "--check-only"], ["--expected-commit", candidate, "--target", "private.json", "--apply", "unexpected"]]) assert.throws(() => argumentsFor(args));
});
test("source failure precedes private input access and client construction", async () => {
  let reads = 0, clients = 0;
  const result = await runRelease(["--expected-commit", candidate, "--target", "private.json", "--apply"], { source() { throw new Error("secret source detail"); }, readTarget() { reads++; }, execution: { connect() { clients++; } } });
  assert.deepEqual(result, { ok: false, phase: "source", outcome: "not-started", apply: true }); assert.equal(reads, 0); assert.equal(clients, 0); assert.ok(!JSON.stringify(result).includes("secret"));
});
test("private target rejects poolers, endpoint/identity mismatches, missing provenance and extra credential options", () => {
  const s = source();
  for (const mutate of [m => m.migrationUrl = m.migrationUrl.replace("ep-synthetic", "ep-synthetic-pooler"), m => m.expected.database = "other", m => m.expected.owner = "other", m => m.migrationUrl += "&options=-crole=owner", m => m.expected.serverMajor = 16, m => delete m.provenance, m => m.extra = "ignored", m => m.expected.ownerOid = 501]) { const m = manifest(s); mutate(m); assert.throws(() => parseTarget(m, s)); }
});

test("optional channel binding accepts only one require value and preserves the policy", () => {
  const s = source(), m = manifest(s);
  assert.equal(parseTarget(m, s).requireChannelBinding, false);
  m.migrationUrl += "&channel_binding=require";
  assert.equal(parseTarget(m, s).requireChannelBinding, true);
  for (const suffix of ["&channel_binding=prefer", "&channel_binding=disable", "&channel_binding=", "&channel_binding=require&channel_binding=require", "&sslmode=require", "&unexpected=require"]) {
    const bad = manifest(s); bad.migrationUrl += suffix; assert.throws(() => parseTarget(bad, s));
  }
});
test("required channel binding rejects fallback auth before password retrieval", () => {
  const s = source(), m = manifest(s); m.migrationUrl += "&channel_binding=require";
  const target = parseTarget(m, s);
  for (const method of ["_handleAuthCleartextPassword", "_handleAuthMD5Password", "_handleAuthSASL"]) {
    const client = new ReleaseClient(target); let rejected = 0, passwords = 0;
    client.connection.stream = { encrypted: true, authorized: true };
    client.connection.on("error", () => rejected++); client._getPassword = () => passwords++;
    client[method]({ mechanisms: ["SCRAM-SHA-256"] });
    assert.equal(rejected, 1); assert.equal(passwords, 0); assert.throws(() => assertReleaseTransport(client, target));
  }
});
test("transport requires verified TLS and completed signed PLUS rather than offered or failed PLUS", () => {
  const s = source(), m = manifest(s); m.migrationUrl += "&channel_binding=require";
  const target = parseTarget(m, s), client = new ReleaseClient(target); let rejected = 0;
  client.connection.stream = { encrypted: true, authorized: true };
  client.connection.on("error", () => rejected++);
  assert.throws(() => assertReleaseTransport(client, target));
  client.saslSession = { mechanism: "SCRAM-SHA-256-PLUS", message: "SASLResponse", serverSignature: "c2ln" };
  client._handleAuthSASLFinal({ data: "v=YmFk" });
  assert.equal(rejected, 1); assert.throws(() => assertReleaseTransport(client, target));
  client._handleAuthSASLFinal({ data: "v=c2ln" }); assert.doesNotThrow(() => assertReleaseTransport(client, target));
  for (const stream of [{ encrypted: false, authorized: true }, { encrypted: true, authorized: false }, {}]) {
    client.connection.stream = stream; assert.throws(() => assertReleaseTransport(client, target));
  }
});
test("pinned pg actually chooses PLUS when offered and the verified TLS stream supports it", () => {
  const s = source(), m = manifest(s); m.migrationUrl += "&channel_binding=require";
  const target = parseTarget(m, s), client = new ReleaseClient(target); let mechanism;
  client.connection.stream = { encrypted: true, authorized: true, getPeerCertificate() {} };
  client.connection.sendSASLInitialResponseMessage = selected => { mechanism = selected; };
  client._handleAuthSASL({ mechanisms: ["SCRAM-SHA-256", "SCRAM-SHA-256-PLUS"] });
  assert.equal(mechanism, "SCRAM-SHA-256-PLUS"); assert.throws(() => assertReleaseTransport(client, target));
});
test("transport rejection is sanitized and occurs before even timeout or lock SQL", async () => {
  const h = harness(); let sql = 0; h.client.query = async () => { sql++; throw new Error("must not query"); };
  const { transport: _fixtureOnly, ...checks } = h.checks;
  const result = await executeRelease(h.s, h.target, { apply: true, connect: () => h.client, checks, migrate: h.migrate });
  assert.deepEqual(result, { ok: false, phase: "connection", outcome: "not-started", apply: true });
  assert.equal(sql, 0); assert.equal(h.migrations, 0); assert.equal(h.ended, 1);
});

test("attestation accepts only the exact selected historical representation and known timestamp", () => {
  const s = source(), m = manifest(s); m.historicalPrefix[0].hash = s.migrations[0].historicalAllowed[1];
  const target = parseTarget(m, s), rows = target.prefix.map(row => ({ id: row.id, hash: row.hash, created_at: row.createdAt }));
  assert.equal(checkLedger(rows, s, target).length, 15);
  const changed = structuredClone(rows); changed[0].hash = s.migrations[0].hash; assert.throws(() => checkLedger(changed, s, target));
  for (const index of [11, 12, 14]) { const altered = manifest(s); altered.historicalPrefix[index].hash = sha(`CRLF${index}`); assert.throws(() => parseTarget(altered, s)); }
  const altered = manifest(s); altered.historicalPrefix[1].createdAt++; assert.throws(() => parseTarget(altered, s));
});
test("intermediate, duplicated and extra ledger rows are not a migration starting point", () => {
  const s = source(), target = parseTarget(manifest(s), s), rows = s.migrations.map((row, i) => ({ id: i + 1, hash: row.hash, created_at: row.createdAt }));
  for (const length of [0, 14, 16, 17, 18, 20]) assert.throws(() => checkLedger(rows.slice(0, length).concat(length === 20 ? [rows[18]] : []), s, target));
  const bad = structuredClone(rows); bad[18].id = 17; assert.throws(() => checkLedger(bad, s, target));
});
test("default check holds the same-client advisory lock but never invokes migration", async () => {
  const h = harness(), result = await execute(h, false); assert.deepEqual(result, { ok: true, phase: "complete", outcome: "checked", apply: false, ledgerRows: 15 });
  assert.equal(h.migrations, 0); assert.equal(h.ended, 1); assert.ok(h.log.findIndex(value => value.includes("pg_try_advisory_lock")) < h.log.findIndex(value => value.includes("BEGIN")));
  assert.ok(h.log.at(-2).includes("pg_advisory_unlock"));
});
test("apply fresh-rechecks and uses the same client without an outer migration transaction", async () => {
  const h = harness(), result = await execute(h); assert.equal(result.outcome, "applied"); assert.equal(result.ok, true); assert.equal(h.migrations, 1); assert.equal(h.catalogs, 3); assert.equal(h.ended, 1);
  assert.equal(h.log.filter(value => value.startsWith("BEGIN")).length, 3);
});
test("already-applied exact state is an idempotent check even with --apply", async () => {
  const h = harness({ already: true }), result = await execute(h); assert.equal(result.outcome, "already-applied"); assert.equal(h.migrations, 0); assert.equal(h.catalogs, 1);
});
test("advisory contention and failed authority never enter migration and close their connection", async () => {
  for (const options of [{ locked: true }, { identityFailure: true }]) { const h = harness(options), result = await execute(h); assert.equal(result.ok, false); assert.equal(result.outcome, "not-started"); assert.equal(h.migrations, 0); assert.equal(h.ended, 1); }
});
test("migration exceptions remain unknown, with no automatic retry or false rollback claim", async () => {
  const h = harness({ migrateFailure: true }), result = await execute(h); assert.deepEqual(result, { ok: false, phase: "migration", outcome: "unknown", apply: true }); assert.equal(h.migrations, 1); assert.equal(h.ended, 1); assert.ok(!JSON.stringify(result).includes("private"));
});
test("an asynchronous idle client error is captured without raw detail or migration", async () => {
  const h = harness(); h.checks.identity = async () => { await new Promise(resolve => setImmediate(() => { h.client.emit("error", new Error("SYNTHETIC_PRIVATE_DRIVER_DETAIL")); resolve(); })); };
  const result = await execute(h); assert.equal(result.ok, false); assert.equal(result.outcome, "not-started"); assert.equal(h.migrations, 0); assert.equal(h.ended, 1); assert.equal(h.client.listenerCount("error"), 0); assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
test("post-COMMIT schema failure and concurrent legitimate writes require reconcile, not rollback", async () => {
  for (const options of [{ postSchemaFailure: true }, { concurrentWrite: true }]) { const h = harness(options), result = await execute(h); assert.equal(result.ok, false); assert.equal(result.outcome, "committed-verification-conflict"); assert.equal(h.migrations, 1); assert.equal(h.log.filter(value => value.startsWith("ROLLBACK")).length, 3); }
});
test("source drift during final precheck prevents migration", async () => {
  const h = harness(); let checks = 0; h.s.recheck = () => { if (++checks === 3) throw new Error("source drift"); };
  const result = await execute(h); assert.equal(result.ok, false); assert.equal(result.outcome, "not-started"); assert.equal(h.migrations, 0);
});
test("catalog equality rejects extra objects, privileges, filtered triggers and changed SQL literals", () => {
  const reference = { tables: [{ name: "head", columns: [{ name: "state", not_null: true }], grants: [{ role: "portal_runtime", privilege: "SELECT" }], triggers: [{ columns: "", condition: null }], check: "state = 'working'" }], functions: [] };
  verifyCatalog(structuredClone(reference), reference);
  for (const mutate of [x => x.tables.push({ name: "unknown" }), x => x.tables[0].columns.push({ name: "actor_id" }), x => x.tables[0].grants.push({ role: "PUBLIC", privilege: "UPDATE" }), x => x.tables[0].triggers[0].columns = "1", x => x.tables[0].check = "state = 'working::text'"]) { const actual = structuredClone(reference); mutate(actual); assert.throws(() => verifyCatalog(actual, reference)); }
});

function sourceFixture() {
  const names = [], blobs = new Map(), journal = { entries: [] };
  for (let i = 0; i < 19; i++) { const tag = `m${String(i).padStart(4, "0")}`; journal.entries.push({ idx: i, version: "7", when: 1000 + i, tag, breakpoints: true }); names.push(`src/server/db/migrations/${tag}.sql`); blobs.set(names.at(-1), Buffer.from(`SELECT ${i};\n`)); }
  for (let i = 0; i < 18; i++) { names.push(`src/server/db/migrations/meta/${i}_snapshot.json`); blobs.set(names.at(-1), Buffer.from(`{"id":${i}}\n`)); }
  names.push("src/server/db/migrations/meta/_journal.json"); blobs.set(names.at(-1), Buffer.from(JSON.stringify(journal))); names.sort();
  const provenance = sha(Buffer.from(JSON.stringify(names.map(path => [path, sha(blobs.get(path))]))));
  const files = new Map(blobs);
  for (const path of RELEASE_FILES) files.set(path, Buffer.from(path === "scripts/release-migrate-reference.json" ? JSON.stringify({ version: 1, sourceCommit: RELEASE_BASE, migrationsSHA256: provenance, baseline: { tables: [] }, final: { tables: [] } }) : "// pinned\n"));
  const committed = new Map(files);
  let dirty = false;
  const git = (...args) => {
    if (args[0] === "rev-parse") return Buffer.from(candidate);
    if (args[0] === "merge-base") return Buffer.alloc(0);
    if (args[0] === "status") return Buffer.from(dirty ? "?? src/server/db/migrations/unknown.sql" : "");
    if (args[0] === "ls-tree") return Buffer.from(names.join("\n"));
    if (args[0] === "show") { const path = args[1].slice(args[1].indexOf(":") + 1); const value = committed.get(path); assert.ok(value); return value; }
    throw new Error("Unexpected Git fixture operation");
  };
  return { files, git, read: path => files.get(path), dirty() { dirty = true; } };
}
test("source contract checks exact Git bytes and rejects CRLF, dirty/untracked migrations and wrapper drift before input", () => {
  const f = sourceFixture(); assert.equal(sourceContract(candidate, f).migrations.length, 19);
  for (const path of ["src/server/db/migrations/m0015.sql", "scripts/release-migrate.mjs"]) { const g = sourceFixture(); g.files.set(path, Buffer.from("changed\r\n")); assert.throws(() => sourceContract(candidate, g)); }
  const dirty = sourceFixture(); dirty.dirty(); assert.throws(() => sourceContract(candidate, dirty));
});
