// Minimal congregation onboarding (MISSION ruling 52). Creates one tenant row, its tenant_host row and an
// empty first congregation-settings version. Nothing else: no member, no invitation, no mail.
//
//   OWNER_DATABASE_URL=... node scripts/add-congregation.mjs --id <slug> --name <text> --product-name <text> \
//     --host <host> --origin <origin> --environment production|preview|local|test --deployment <name> [--calendar diaspora|israel] [--apply]
//
// Dry run unless --apply: the same checks run inside a transaction that is rolled back.
// Needs the table owner's connection (OWNER_DATABASE_URL): the app's runtime role can only read tenant and
// tenant_host, and the script refuses any connection that does not own those tables.
// Prints counts and ids only: never a connection string, a token, a name of a person or an email.
//
// Provisioning a real second congregation is Daniel's gate (MISSION ruling 21/52), not a routine step.
// The runtime also serves exactly one configured origin today, so a new host needs a deployment of its
// own before anyone can sign in there. After that, the first admin is invited through the existing
// invitation flow by an admin of that congregation (or the owner bootstrap); this script never does it.
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ENVIRONMENTS = ["production", "preview", "local", "test"];
export class CongregationError extends Error {
  constructor(code = "refused") { super("Congregation onboarding refused"); this.name = "CongregationError"; this.code = code; }
}
const fail = (code = "refused") => { throw new CongregationError(code); };
const plainName = value => typeof value === "string" && value.length > 0 && [...value].length <= 120 && value.trim() === value && value.normalize("NFC") === value
  && !/[\x00-\x1f\x7f-\x9f<>]/.test(value) && !/[\p{Cf}]/u.test(value);

export function parseArgs(argv) {
  const out = { calendar: "diaspora", apply: false };
  const values = new Map([["--id", "id"], ["--name", "name"], ["--product-name", "productName"], ["--host", "host"], ["--origin", "origin"],
    ["--environment", "environment"], ["--deployment", "deployment"], ["--calendar", "calendar"]]);
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") { if (out.apply) throw new Error("usage"); out.apply = true; continue; }
    const key = values.get(arg);
    if (!key || i + 1 >= argv.length || seen.has(key)) throw new Error("usage");
    seen.add(key); out[key] = argv[++i];
  }
  try { return { ...congregation(out), apply: out.apply }; } catch { throw new Error("usage"); }
}

/** The closed, checked input: a tenant slug, two plain names, one exact host directory row and the calendar. */
export function congregation(input) {
  const { id, name, productName, host, origin, environment, deployment, calendar } = input ?? {};
  if (typeof id !== "string" || !SLUG.test(id) || !plainName(name) || !plainName(productName) || !ENVIRONMENTS.includes(environment)
    || typeof deployment !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(deployment) || !["diaspora", "israel"].includes(calendar)) fail("invalid");
  if (typeof host !== "string" || host.length > 253 || host !== host.toLowerCase()) fail("invalid");
  const [hostname, port, extra] = host.split(":");
  if (extra !== undefined || !hostname.split(".").every(label => LABEL.test(label)) || (port !== undefined && !/^[1-9][0-9]{0,4}$/.test(port))) fail("invalid");
  const loopback = hostname === "localhost" || hostname === "127.0.0.1";
  // Production and preview are https on a real name with no port; loopback hosts are for local and test only.
  if (["production", "preview"].includes(environment) ? loopback || port !== undefined || origin !== `https://${host}` : !(origin === `https://${host}` || (loopback && origin === `http://${host}`))) fail("invalid");
  return Object.freeze({ id, name, productName, host, origin, environment, deployment, calendar });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}

/**
 * Runs on an owner connection (`client.query(text, values)` returning `{ rows }`, as pg and PGlite do).
 * Dry run unless `apply`; either way the result is counts and ids only.
 */
export async function addCongregation(client, input, { apply = false } = {}) {
  const chosen = congregation(input);
  let started = false;
  try {
    const owner = await client.query(`SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN ('tenant','tenant_host','tenant_settings')
       AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`);
    if (owner.rows[0]?.direct !== true || owner.rows[0].owned !== 3) fail("owner-required");
    await client.query("BEGIN"); started = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Serialise with any other onboarding run; the tenant directory is small.
    await client.query("LOCK TABLE tenant, tenant_host IN SHARE ROW EXCLUSIVE MODE");
    const tenant = await client.query("SELECT 1 FROM tenant WHERE id=$1", [chosen.id]);
    if (tenant.rows.length) fail("tenant-exists");
    const host = await client.query("SELECT 1 FROM tenant_host WHERE host=$1", [chosen.host]);
    if (host.rows.length) fail("host-exists");
    const customs = { calendar: { diaspora: chosen.calendar === "diaspora" } };
    await client.query("INSERT INTO tenant (id, name, product_name, customs) VALUES ($1, $2, $3, $4::jsonb)", [chosen.id, chosen.name, chosen.productName, JSON.stringify(customs)]);
    await client.query("INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin) VALUES ($1, $2, $3, $4, $5)",
      [chosen.host, chosen.id, chosen.environment, chosen.deployment, chosen.origin]);
    const digest = createHash("sha256").update(canonical(["tenant-settings/v1", 0, {}])).digest("hex");
    const settings = await client.query(`INSERT INTO tenant_settings (tenant_id, version, base_version, previous_version, body, channel, mutation_id, request_digest)
      VALUES ($1, 1, 0, NULL, '{}'::jsonb, 'operator', $2, $3) RETURNING version`, [chosen.id, randomUUID(), digest]);
    const report = { outcome: apply ? "applied" : "dry-run", tenant: chosen.id, host: chosen.host, environment: chosen.environment,
      rows: { tenant: 1, tenantHost: 1, tenantSettings: settings.rows.length }, settingsVersion: settings.rows[0]?.version ?? null };
    await client.query(apply ? "COMMIT" : "ROLLBACK"); started = false;
    return report;
  } catch (error) {
    if (started) await client.query("ROLLBACK").catch(() => {});
    let code = "refused";
    try { if (error instanceof CongregationError) code = error.code; } catch {}
    throw new CongregationError(code);
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch {
    console.error("Usage: OWNER_DATABASE_URL=... node scripts/add-congregation.mjs --id <slug> --name <text> --product-name <text> --host <host> --origin <origin> --environment production|preview|local|test --deployment <name> [--calendar diaspora|israel] [--apply]");
    return 2;
  }
  const connectionString = process.env.OWNER_DATABASE_URL;
  if (!connectionString) { console.error("Missing owner database configuration (OWNER_DATABASE_URL)"); return 2; }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  client.on("error", () => {});
  try {
    await client.connect();
    const report = await addCongregation(client, args, { apply: args.apply });
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    // Driver errors can carry connection details; report a fixed code instead.
    let code = "unavailable";
    try { if (error instanceof CongregationError) code = error.code; } catch {}
    console.log(JSON.stringify({ outcome: "refused", code }, null, 2));
    return 1;
  } finally { await client.end().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
