import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

// Private operator path only. Nothing imports this script from the application.
// A fork's own address has to be in tenant_host (tenant 'crc', which forks keep as an internal id nobody sees) before the
// portal serves it. This adds exactly one production row for the configured canonical origin (CANONICAL_ORIGIN, the same
// setting the app reads) and sets the credit approved portion summaries carry (--summary-credit, required). Navigation aliases need no row: they only redirect. CRC's own hosts come from migrations and are refused here.
const CRC_HOSTS = ["beitmitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app", "torah.centralreform.org"];
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** The row for one origin: an https origin exactly, a real DNS name, no port, credentials, path or address. */
export function hostRow(origin) {
  if (typeof origin !== "string") throw new Error();
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== "https:" || url.port || url.username || url.password) throw new Error();
  const host = url.hostname;
  if (!HOST.test(host) || /^\d+(?:\.\d+){3}$/.test(host) || host.length > 253 || CRC_HOSTS.includes(host)) throw new Error();
  return { host, origin };
}

/** The portion-summary credit: a plain name (as the database's check holds it), at most 240 characters, never an address. */
export function summaryCredit(value) {
  if (typeof value !== "string" || value.length === 0 || [...value].length > 240 || value.trim() !== value || value.normalize("NFC") !== value
    || /[\x00-\x1f\x7f-\x9f<>@]/.test(value) || /[\p{Cf}]/u.test(value)) throw new Error();
  return value;
}
const PRIVILEGE = `SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tenant','tenant_host')
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`;

/** Sets only the credit approved portion summaries carry (tenant crc), for an existing deployment such as CRC's own. Owner connection only. */
export async function setSummaryCredit(client, input) {
  let started = false;
  try {
    if (input?.confirm !== true) throw new Error();
    const credit = summaryCredit(input.summaryCredit);
    const privilege = await client.query(PRIVILEGE);
    if (!privilege.rows[0]?.direct || privilege.rows[0].owned !== 2) throw new Error();
    await client.query("BEGIN"); started = true;
    const updated = await client.query("UPDATE tenant SET summary_credit=$1 WHERE id='crc' AND enabled=true RETURNING id", [credit]);
    if (updated.rows.length !== 1) throw new Error();
    await client.query("COMMIT"); started = false;
    return { status: "configured" };
  } catch {
    if (started) await client.query("ROLLBACK").catch(() => {});
    throw new Error("Congregation host failed");
  }
}

export async function addCongregationHost(client, input) {
  let started = false;
  try {
    if (input?.confirm !== true) throw new Error();
    const row = hostRow(input.origin);
    const credit = summaryCredit(input.summaryCredit);
    const privilege = await client.query(`SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tenant','tenant_host')
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`);
    if (!privilege.rows[0]?.direct || privilege.rows[0].owned !== 2) throw new Error();
    await client.query("BEGIN"); started = true;
    const tenant = await client.query("SELECT id FROM tenant WHERE id='crc' AND enabled=true FOR SHARE");
    if (tenant.rows.length !== 1) throw new Error();
    await client.query("UPDATE tenant SET summary_credit=$1 WHERE id='crc'", [credit]);
    const existing = await client.query("SELECT tenant_id,environment,deployment,origin FROM tenant_host WHERE host=$1 FOR UPDATE", [row.host]);
    if (existing.rows.length) {
      const e = existing.rows[0];
      if (e.tenant_id !== "crc" || e.environment !== "production" || e.deployment !== "production" || e.origin !== row.origin) throw new Error();
      await client.query("COMMIT"); started = false;
      return { status: "already-configured" };
    }
    await client.query("INSERT INTO tenant_host (host, tenant_id, environment, deployment, origin) VALUES ($1, 'crc', 'production', 'production', $2)", [row.host, row.origin]);
    await client.query("COMMIT"); started = false;
    return { status: "configured" };
  } catch {
    if (started) await client.query("ROLLBACK").catch(() => {});
    // Never retain a driver error/cause, query, connection string or origin.
    throw new Error("Congregation host failed");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    // node scripts/add-congregation-host.mjs --summary-credit "<name>" --confirm               (adds CANONICAL_ORIGIN's host row and sets the credit)
    // node scripts/add-congregation-host.mjs --summary-credit "<name>" --credit-only --confirm  (sets only the credit)
    const value = process.env.DATABASE_MIGRATION_URL;
    const argv = process.argv.slice(2), at = argv.indexOf("--summary-credit");
    const credit = at >= 0 ? argv[at + 1] : undefined;
    const only = argv.includes("--credit-only"), origin = process.env.CANONICAL_ORIGIN;
    if (!value || credit === undefined || (!only && !origin) || !argv.includes("--confirm")) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) throw new Error();
    client = new pg.Client({ connectionString: value });
    await client.connect();
    const result = only ? await setSummaryCredit(client, { summaryCredit: credit, confirm: true }) : await addCongregationHost(client, { origin, summaryCredit: credit, confirm: true });
    console.log(`Congregation host ${result.status}; remove private operator configuration`);
  } catch {
    console.error("Congregation host failed; verify private operator configuration");
    process.exitCode = 1;
  } finally { if (client) await client.end().catch(() => {}); }
}
