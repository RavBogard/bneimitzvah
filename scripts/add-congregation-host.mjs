import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";

// Private operator path only. Nothing imports this script from the application.
// A fork's own address has to be in tenant_host (tenant 'crc', which forks keep as an internal id nobody sees) before the
// portal serves it. This adds exactly one production row for the configured canonical origin (CANONICAL_ORIGIN, the same
// setting the app reads). Navigation aliases need no row: they only redirect. CRC's own hosts come from migrations and are refused here.
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

export async function addCongregationHost(client, input) {
  let started = false;
  try {
    if (input?.confirm !== true) throw new Error();
    const row = hostRow(input.origin);
    const privilege = await client.query(`SELECT current_user = session_user AS direct,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname IN ('tenant','tenant_host')
        AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned`);
    if (!privilege.rows[0]?.direct || privilege.rows[0].owned !== 2) throw new Error();
    await client.query("BEGIN"); started = true;
    const tenant = await client.query("SELECT id FROM tenant WHERE id='crc' AND enabled=true FOR SHARE");
    if (tenant.rows.length !== 1) throw new Error();
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
    const value = process.env.DATABASE_MIGRATION_URL;
    const origin = process.env.CANONICAL_ORIGIN;
    if (!value || !origin || !process.argv.includes("--confirm")) throw new Error();
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) throw new Error();
    client = new pg.Client({ connectionString: value });
    await client.connect();
    const result = await addCongregationHost(client, { origin, confirm: true });
    console.log(`Congregation host ${result.status}; remove private operator configuration`);
  } catch {
    console.error("Congregation host failed; verify private operator configuration");
    process.exitCode = 1;
  } finally { if (client) await client.end().catch(() => {}); }
}
