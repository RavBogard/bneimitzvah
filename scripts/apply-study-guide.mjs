// Operator bridge for Claude-drafted study guides (spec 2026-10-21 §3a), until the portal MCP is live.
//
//   node scripts/apply-study-guide.mjs --kind torah --reading-key pekudei --file guide.json --admin-membership <uuid> [--tenant crc] [--hold] [--apply]
//
// Dry run unless --apply. Reads the app's restricted runtime connection from DATABASE_URL (never the
// migration owner; the write runs under the same role and row-level security as the deployed app).
// Prints counts and refusal codes only: never the guide text, a connection string, a name or an email.
// The guide is stored as origin "claude", reviewed false; only the rabbi in Cowork can review it.
//
// Remove this script and src/server/study-guides/bridge*.ts in the commit that enables the MCP endpoint.
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAX_FILE = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const out = { tenant: "crc", hold: false, apply: false };
  const flags = new Set(["--hold", "--apply"]), values = new Map([["--kind", "kind"], ["--reading-key", "readingKey"], ["--file", "file"], ["--admin-membership", "membershipId"], ["--tenant", "tenant"]]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (flags.has(arg)) { out[arg.slice(2)] = true; continue; }
    const key = values.get(arg);
    if (!key || i + 1 >= argv.length || Object.hasOwn(out, key) && key !== "tenant") throw new Error("usage");
    out[key] = argv[++i];
  }
  if (!["torah", "haftarah"].includes(out.kind) || typeof out.readingKey !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.readingKey) || out.readingKey.length > 160
    || typeof out.file !== "string" || !UUID.test(out.membershipId ?? "") || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(out.tenant)) throw new Error("usage");
  return out;
}

export async function loadRuntime() {
  // Vite (already pinned through Vitest) loads the TypeScript entry with the app's own resolution.
  const { createServer, createServerModuleRunner } = await import("vite");
  // The marker package exports only "."; its react-server variant is this empty file.
  const emptyServerOnly = resolve(ROOT, "node_modules/server-only/empty.js");
  const server = await createServer({ configFile: false, root: ROOT, logLevel: "silent", appType: "custom", clearScreen: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: [{ find: /^server-only$/, replacement: emptyServerOnly }, { find: /^@\//, replacement: resolve(ROOT, "src") + "/" }] } });
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
  const module = await runner.import("/src/server/study-guides/bridge-runtime.ts");
  return { runBridge: module.runBridge, close: async () => { await runner.close(); await server.close(); } };
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch { console.error("Usage: node scripts/apply-study-guide.mjs --kind torah|haftarah --reading-key <slug> --file <guide.json> --admin-membership <uuid> [--tenant crc] [--hold] [--apply]"); return 2; }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("Missing runtime database configuration"); return 2; }
  let body;
  try {
    const path = resolve(args.file), info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE) throw 0;
    body = JSON.parse(await readFile(path, "utf8"));
  } catch { console.error("Guide file must be a JSON file of at most 256 KiB"); return 2; }
  let runtime;
  try {
    runtime = await loadRuntime();
    const report = await runtime.runBridge({ connectionString, tenantId: args.tenant, membershipId: args.membershipId, kind: args.kind, readingKey: args.readingKey, body, hold: args.hold, apply: args.apply });
    console.log(JSON.stringify(report, null, 2));
    return report.outcome === "refused" ? 1 : 0;
  } catch {
    // Driver and provider errors can carry connection details; report a fixed line instead.
    console.error("Study guide bridge failed; check the runtime connection, the admin membership and Sefaria availability");
    return 1;
  } finally { await runtime?.close().catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
