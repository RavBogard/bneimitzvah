import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createRequire } from "node:module";
import { argumentsFor, sourceContract, parseTarget, checkLedger, need, same, NEW_TABLES, selectedReference } from "./release-migrate-support.mjs";
import { captureCatalog, verifyCatalog, captureRoles, captureData } from "./release-migrate-catalog.mjs";

const pgVersion = createRequire(import.meta.url)("pg/package.json").version;
const verifiedPlus = new WeakSet();
/** Pinned pg 8.23.1 hooks: require PLUS before sending a fallback password,
 * then retain only the mechanism whose server-final signature pg validated. */
export class ReleaseClient extends pg.Client {
  #requireChannelBinding;
  constructor(target) { super(target.connection); need(pgVersion === "8.23.1"); this.#requireChannelBinding = target.requireChannelBinding === true; }
  #rejectAuthentication() { this.connection.emit("error", new Error("Release transport rejected")); }
  _handleAuthCleartextPassword(message) {
    if (this.#requireChannelBinding) return this.#rejectAuthentication();
    return super._handleAuthCleartextPassword(message);
  }
  _handleAuthMD5Password(message) {
    if (this.#requireChannelBinding) return this.#rejectAuthentication();
    return super._handleAuthMD5Password(message);
  }
  _handleAuthSASL(message) {
    verifiedPlus.delete(this);
    const stream = this.connection.stream;
    if (this.#requireChannelBinding && (!stream?.encrypted || stream.authorized !== true || !this.enableChannelBinding || !message.mechanisms?.includes("SCRAM-SHA-256-PLUS"))) return this.#rejectAuthentication();
    return super._handleAuthSASL(message);
  }
  _handleAuthSASLFinal(message) {
    const plus = this.saslSession?.mechanism === "SCRAM-SHA-256-PLUS";
    super._handleAuthSASLFinal(message);
    if (plus && this.saslSession === null) verifiedPlus.add(this);
  }
}
/** Call immediately after connect, before any SQL, in every private operator. */
export function assertReleaseTransport(client, target) {
  const stream = client.connection?.stream;
  need(stream?.encrypted === true && stream.authorized === true);
  need(!target.requireChannelBinding || (client instanceof ReleaseClient && verifiedPlus.has(client)));
}
export const RELEASE_LOCK = Object.freeze([214137, 151819]);
export async function verifyIdentity(client, target) {
  const expected = target.expected;
  const row = (await client.query(`SELECT current_database() AS database,current_user AS owner,session_user AS session_owner,
    (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS owner_oid,
    (SELECT datdba::text FROM pg_database WHERE datname=current_database()) AS database_owner_oid,
    current_setting('server_version_num')::int/10000 AS major,
    (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass_rls`)).rows[0];
  need(row && row.database === expected.database && row.owner === expected.owner && row.session_owner === expected.owner && row.owner_oid === expected.ownerOid && row.database_owner_oid === expected.ownerOid && row.major === expected.serverMajor && !row.superuser && row.bypass_rls);
  const schema = (await client.query(`SELECT r.rolname AS owner,n.nspowner::text AS owner_oid,
    has_schema_privilege(current_user,n.oid,'CREATE') AS can_create,
    NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE a.privilege_type='CREATE' AND a.grantee NOT IN(n.nspowner,$1::oid)) AS closed_create
    FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname='public'`, [expected.ownerOid])).rows;
  need(schema.length === 1 && (schema[0].owner_oid === expected.ownerOid || schema[0].owner === "pg_database_owner") && schema[0].can_create && schema[0].closed_create);
  const hosts = (await client.query(`SELECT t.id FROM public.tenant t JOIN public.tenant_host h ON h.tenant_id=t.id
    WHERE t.id=$1 AND t.enabled AND h.host=$2 AND h.origin=$3 AND h.environment='production' AND h.deployment='production'`, [expected.tenantId, new URL(expected.canonicalOrigin).hostname, expected.canonicalOrigin])).rows;
  need(hosts.length === 1);
  const closure = (await client.query(`WITH RECURSIVE closure(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname=$1 UNION SELECT m.roleid FROM pg_auth_members m JOIN closure c ON m.member=c.oid)
    SELECT r.rolname AS name,r.rolsuper AS superuser,r.rolcreatedb AS create_db,r.rolcreaterole AS create_role,
      r.rolreplication AS replication,r.rolbypassrls AS bypass_rls,r.rolcanlogin AS login,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') AND c.relowner=r.oid) AS owned
    FROM closure c JOIN pg_roles r ON r.oid=c.oid ORDER BY r.rolname`, [expected.runtimeRole])).rows;
  need(closure.length === 2 && closure.some(r => r.name === expected.runtimeRole && r.login) && closure.some(r => r.name === "portal_runtime" && !r.login));
  need(closure.every(r => [expected.runtimeRole, "portal_runtime"].includes(r.name) && !r.superuser && !r.create_db && !r.create_role && !r.replication && !r.bypass_rls && r.owned === 0));
}
export async function releaseSnapshot(client, source, target, checks = { identity: verifyIdentity, catalog: captureCatalog, verifyCatalog, roles: captureRoles, data: captureData }) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    // Catalog reads resolve builtins first. ROLLBACK restores the validated
    // public-first startup path needed by the unchanged unqualified DDL.
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await checks.identity(client, target);
    const ledger = checkLedger((await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows, source, target);
    const catalog = await checks.catalog(client, target.expected.owner);
    checks.verifyCatalog(catalog, selectedReference(source, target, ledger.length));
    const roles = await checks.roles(client);
    const data = await checks.data(client, catalog.tables.map(row => row.name));
    await client.query("ROLLBACK");
    return { ledger, catalog, roles, data };
  } catch { await client.query("ROLLBACK").catch(() => undefined); throw new Error("Release snapshot failed"); }
}
/** Trusted operator composition only; no application/runtime import or env switch. */
export async function executeRelease(source, target, options = {}) {
  const apply = options.apply === true;
  const checks = { transport: assertReleaseTransport, identity: verifyIdentity, catalog: captureCatalog, verifyCatalog, roles: captureRoles, data: captureData, ...options.checks };
  let client, connected = false, locked = false, timer, expired = false, connectionFailed = false, phase = "connection", outcome = "not-started", result;
  const onError = () => { connectionFailed = true; };
  const healthy = () => need(!expired && !connectionFailed);
  try {
    source.recheck();
    client = await (options.connect ?? (() => new ReleaseClient(target)))(target.connection);
    // Idle connection failures are EventEmitter events, not query rejections.
    // Keep the listener through end() so no raw driver error escapes the CLI.
    client.on("error", onError);
    timer = setTimeout(() => { expired = true; void client.end().catch(() => undefined); }, 90_000); timer.unref?.();
    await client.connect(); connected = true; healthy(); checks.transport(client, target);
    await client.query("SET statement_timeout='12s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='15s'");
    phase = "lock";
    need((await client.query("SELECT pg_catalog.pg_try_advisory_lock($1,$2) AS locked", RELEASE_LOCK)).rows[0]?.locked === true); locked = true;
    phase = "preflight";
    const before = await releaseSnapshot(client, source, target, checks); healthy(); source.recheck();
    if (before.ledger.length === 19) { outcome = "already-applied"; result = { ok: true, phase: "complete", outcome, apply, ledgerRows: 19 }; }
    else if (!apply) { outcome = "checked"; result = { ok: true, phase: "complete", outcome, apply, ledgerRows: 15 }; }
    else {
      phase = "recheck";
      const current = await releaseSnapshot(client, source, target, checks); healthy(); need(same(current, before)); source.recheck();
      phase = "migration";
      const migrate = options.migrate ?? (await import("./db-migrate.mjs")).migrateDatabase;
      healthy(); outcome = "unknown";
      // This migrator owns its transaction and COMMIT. No outer BEGIN exists.
      await migrate(client); outcome = "committed-verification-conflict";
      phase = "verification"; healthy(); source.recheck();
      const after = await releaseSnapshot(client, source, target, checks);
      need(after.ledger.length === 19 && same(after.ledger.slice(0, 15), before.ledger) && same(after.roles, before.roles));
      need(same(after.data.filter(row => !NEW_TABLES.includes(row.name)), before.data));
      need(after.data.filter(row => NEW_TABLES.includes(row.name)).length === NEW_TABLES.length && after.data.filter(row => NEW_TABLES.includes(row.name)).every(row => row.count === 0));
      healthy(); source.recheck(); outcome = "applied";
      result = { ok: true, phase: "complete", outcome, apply, ledgerRows: 19 };
    }
  } catch { result = { ok: false, phase, outcome, apply }; }
  finally {
    clearTimeout(timer);
    let cleaned = true;
    if (connected && locked) { try { need((await client.query("SELECT pg_catalog.pg_advisory_unlock($1,$2) AS unlocked", RELEASE_LOCK)).rows[0]?.unlocked === true); } catch { cleaned = false; } }
    if (client) { try { await client.end(); } catch { cleaned = false; } client.removeListener("error", onError); }
    if (connectionFailed) cleaned = false;
    if (!cleaned) result = { ok: false, phase: "cleanup", outcome, apply };
  }
  return Object.freeze(result);
}
export async function runRelease(args, dependencies = {}) {
  let phase = "arguments", apply = false;
  try {
    const input = argumentsFor(args); apply = input.apply; phase = "source";
    const source = await (dependencies.source ?? sourceContract)(input.expectedCommit);
    phase = "target";
    const read = dependencies.readTarget ?? (path => { need(statSync(path).isFile() && statSync(path).size <= 16384); return JSON.parse(readFileSync(path, "utf8")); });
    const target = parseTarget(await read(input.targetPath), source);
    return await executeRelease(source, target, { ...dependencies.execution, apply });
  } catch { return Object.freeze({ ok: false, phase, outcome: "not-started", apply }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Fixed closed output only. Never serialize target/source/driver errors.
  const result = await runRelease(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
