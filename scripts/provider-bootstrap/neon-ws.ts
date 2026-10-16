// Operator-only live acceptance; invoked only by the separately gated launcher.
import { randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as schema from "../../src/server/db/index";
import { composeRuntime } from "../../src/server/runtime/composition";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { restrictedProbeInput, PROBE_PHASES } from "./probe-neon-ws.mjs";

type Phase = typeof PROBE_PHASES[number];
export class ProbeFailure extends Error {
  constructor(readonly phase: Phase) { super(`Provider probe failed (${phase}); private details withheld`); }
}
const protectedTables = ["tenant", "membership", "role_grant", "student", "student_identity", "guardian", "tutor_student", "invite", "practice_context", "assignment", "assignment_verse", "audit_event", "invitation_throttle", "translation_draft", "tutor_note"];
const rollback = new Error("Synthetic probe transaction rollback");
const wrong = "provider_probe_unmapped";
const origin = "https://bneimitzvah.vercel.app";
type Database = ReturnType<typeof drizzle<typeof schema, PoolClient>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const requireTrue = (value: unknown, phase: Phase) => { if (value !== true) throw new ProbeFailure(phase); };
const count = async (tx: Transaction, id?: string) => Number((await tx.execute(id
  ? sql`select count(*)::int as n from student where id = ${id}::uuid`
  : sql`select count(*)::int as n from student`)).rows[0]?.n);
async function rolledBack(action: () => Promise<unknown>) {
  try { await action(); } catch (error) { if (error === rollback) return; throw error; }
  throw new ProbeFailure("rollback-cleanup");
}
export async function deniedInsert(tx: Transaction, phase: Phase) {
  await tx.execute(sql`savepoint provider_probe_denial`);
  let denied = false;
  try { await tx.execute(sql`insert into student (id, tenant_id, first_name, last_name, ceremony_date, parent_email)
    values (${randomUUID()}::uuid, 'crc', 'Synthetic', 'ProviderProbe', '2027-01-02', 'probe@example.test')`); }
  catch (error) { const safe = error as { code?: unknown; cause?: { code?: unknown } }; denied = (safe.cause?.code ?? safe.code) === "42501"; }
  finally { await tx.execute(sql`rollback to savepoint provider_probe_denial`); await tx.execute(sql`release savepoint provider_probe_denial`); }
  requireTrue(denied, phase);
}
async function identity(client: PoolClient) {
  const result = await client.query("select pg_backend_pid()::int as pid, nullif(current_setting('app.tenant_id', true), '') is null as clear");
  return { pid: Number(result.rows[0]?.pid), clear: result.rows[0]?.clear === true };
}
export function requirePhysicalCleanup(before: { pid: number; clear: boolean }, inside: number,
  after: { pid: number; clear: boolean }, phase: "commit-cleanup" | "rollback-cleanup") {
  requireTrue(before.clear && after.clear && Number.isInteger(before.pid) && before.pid > 0
    && Number.isInteger(inside) && inside > 0 && before.pid === inside && inside === after.pid, phase);
}
function latch() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

export async function neonRuntimeProbe(databaseUrl: unknown) {
  let phase: Phase = "configuration", pool: Pool | undefined, a: PoolClient | undefined, b: PoolClient | undefined;
  try {
    const value = restrictedProbeInput(`PROVIDER_RUNTIME_DATABASE_URL=${JSON.stringify(databaseUrl)}\n`);
    const config = loadRuntimeConfig({ DATABASE_URL: value, PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: origin,
      "BETTER_AUTH_SECRET": randomBytes(32).toString("base64url"), "RESEND_API_KEY": ["re", randomBytes(24).toString("hex")].join("_"), RESEND_FROM: "probe@example.test" });
    phase = "connection";
    if (typeof globalThis.WebSocket !== "function") throw new ProbeFailure(phase);
    pool = new Pool({ connectionString: value, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 1000,
      query_timeout: 7000, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
    pool.on("error", () => {}); a = await pool.connect(); a.on("error", () => {});
    const db = drizzle(a, { schema, logger: false }), initial = await identity(a);
    requireTrue(initial.clear && Number.isInteger(initial.pid), phase);
    phase = "catalog";
    const tables = await a.query(`select count(*)::int as n, bool_and(c.relrowsecurity and c.relforcerowsecurity) as forced
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and c.relname=any($1::text[])`, [protectedTables]);
    requireTrue(tables.rows[0]?.n === protectedTables.length && tables.rows[0]?.forced === true, phase);
    phase = "role";
    const beforeCommit = await identity(a); let commitBackend = 0;
    // Existing production closure check, using the real restricted session.
    await withTenantTransaction(db, { tenantId: "crc" }, async tx => {
      const physical = await tx.execute(sql`select pg_backend_pid()::int as pid`);
      commitBackend = Number(physical.rows[0]?.pid);
      const rows = await tx.execute(sql`select count(*)::int as n from tenant where id='crc' and enabled=true`);
      requireTrue(rows.rows[0]?.n === 1, "role");
    }); // SELECT-only commit: no persistent fixture.
    phase = "commit-cleanup";
    const committed = await identity(a);
    requirePhysicalCleanup(beforeCommit, commitBackend, committed, phase);
    for (const empty of [false, true]) {
      phase = empty ? "empty-context" : "no-context";
      await rolledBack(() => db.transaction(async tx => {
        if (empty) await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
        requireTrue(await count(tx) === 0, empty ? "empty-context" : "no-context");
        await deniedInsert(tx, empty ? "empty-context" : "no-context");
        throw rollback;
      }));
    }
    phase = "crc-write";
    const fixture = randomUUID(), beforeRollback = await identity(a); let rollbackBackend = 0;
    await rolledBack(() => withTenantTransaction(db, { tenantId: "crc" }, async tx => {
      const physical = await tx.execute(sql`select pg_backend_pid()::int as pid`);
      rollbackBackend = Number(physical.rows[0]?.pid);
      await tx.execute(sql`insert into student (id, tenant_id, first_name, last_name, ceremony_date, parent_email)
        values (${fixture}::uuid, 'crc', 'Synthetic', 'ProviderProbe', '2027-01-02', 'probe@example.test')`);
      requireTrue(await count(tx, fixture) === 1, "crc-write");
      const changed = await tx.execute(sql`update student set last_name='ProviderProbeChanged' where id=${fixture}::uuid returning id`);
      requireTrue(changed.rows.length === 1, "crc-write");
      phase = "wrong-context";
      await tx.execute(sql`select set_config('app.tenant_id', ${wrong}, true)`);
      requireTrue(await count(tx, fixture) === 0, "wrong-context");
      const seed = await tx.execute(sql`select count(*)::int as n from tenant where id='crc'`);
      requireTrue(seed.rows[0]?.n === 0, "wrong-context");
      const blockedUpdate = await tx.execute(sql`update student set last_name='SyntheticBlocked' where id=${fixture}::uuid returning id`);
      requireTrue(blockedUpdate.rows.length === 0, "wrong-context");
      await deniedInsert(tx, "wrong-context");
      await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
      requireTrue(await count(tx, fixture) === 0, "empty-context");
      await deniedInsert(tx, "empty-context");
      throw rollback;
    }));
    phase = "rollback-cleanup";
    const afterRollback = await identity(a);
    requirePhysicalCleanup(beforeRollback, rollbackBackend, afterRollback, phase);
    await rolledBack(() => withTenantTransaction(db, { tenantId: "crc" }, async tx => { requireTrue(await count(tx, fixture) === 0, "rollback-cleanup"); throw rollback; }));
    phase = "parallel-context";
    b = await pool.connect(); b.on("error", () => {});
    const other = drizzle(b, { schema, logger: false }), enteredA = latch(), enteredB = latch();
    let pidA = 0, pidB = 0;
    const parallel = (database: Database, tenantId: string, own: ReturnType<typeof latch>, peer: ReturnType<typeof latch>, first: boolean) =>
      rolledBack(() => withTenantTransaction(database, { tenantId }, async tx => {
        const entry = await tx.execute(sql`select pg_backend_pid()::int as pid, current_setting('app.tenant_id') as context`);
        if (first) pidA = Number(entry.rows[0]?.pid); else pidB = Number(entry.rows[0]?.pid);
        own.resolve(); await peer.promise;
        const checked = await tx.execute(sql`select current_setting('app.tenant_id')=${tenantId} as isolated`);
        requireTrue(checked.rows[0]?.isolated === true, "parallel-context");
        throw rollback;
      })).finally(own.resolve);
    const outcomes = await Promise.allSettled([parallel(db, "crc", enteredA, enteredB, true), parallel(other, wrong, enteredB, enteredA, false)]);
    requireTrue(outcomes.every(result => result.status === "fulfilled") && pidA !== pidB && pidA > 0 && pidB > 0, phase);
    requireTrue((await identity(a)).clear && (await identity(b)).clear, phase);
    phase = "host";
    const neverFetch: typeof fetch = async () => { throw new ProbeFailure("host"); };
    const runtime = composeRuntime(config, db, neverFetch);
    requireTrue((await runtime.resolveHost({ url: origin, headers: new Headers() })).tenantId === "crc", phase);
    requireTrue((await runtime.resolveHost({ url: origin, headers: new Headers({ forwarded: `host=${new URL(origin).host}` }) })).tenantId === "crc", phase);
    const requests = [
      { url: "https://bneimitzvah.centralreform.org", headers: new Headers() },
      { url: "https://synthetic-preview.vercel.app", headers: new Headers() },
      { url: origin, headers: new Headers({ "x-forwarded-host": "synthetic-preview.vercel.app" }) },
      { url: "https://synthetic-preview.vercel.app", headers: new Headers({ "x-forwarded-host": "bneimitzvah.vercel.app" }) },
      { url: origin, headers: new Headers({ forwarded: "host=synthetic-preview.vercel.app" }) },
    ];
    for (const request of requests) { let denied = false; try { await runtime.resolveHost(request); } catch { denied = true; } requireTrue(denied, "host"); }
    phase = "close";
  } catch (error) { throw new ProbeFailure(error instanceof ProbeFailure ? error.phase : phase); }
  finally {
    let failed = false;
    for (const client of [a, b]) if (client) { await client.query("ROLLBACK").catch(() => {}); try { client.release(true); } catch { failed = true; } }
    if (pool) await pool.end().catch(() => { failed = true; });
    if (failed) throw new ProbeFailure("close");
  }
}
