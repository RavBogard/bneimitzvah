import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const RELEASE_BASE = "4ad7e0c110cb30819b948429a7b65a1fcc5e35f9";
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASE_FILES = ["scripts/release-migrate.mjs", "scripts/release-migrate-support.mjs", "scripts/release-migrate-catalog.mjs", "scripts/release-migrate-reference.json", "scripts/db-migrate.mjs"];
export const NEW_TABLES = ["service_catalog", "service_catalog_lifecycle", "student_service_plan", "verse_assessment", "verse_self_check", "lesson_log", "practice_day", "practice_event"].sort();
export const NEW_FUNCTIONS = ["portal_immutable_service_catalog", "portal_service_lifecycle_revision", "portal_progress_version", "portal_lesson_log_version", "portal_practice_anniversary_due", "portal_practice_ceremony_change"].sort();
export const sha = value => createHash("sha256").update(value).digest("hex");
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function need(value) { if (!value) throw new Error("Release precondition failed"); }
export function closed(value, keys) {
  need(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  need(same(Object.keys(value).sort(), [...keys].sort())); return value;
}
export function argumentsFor(args) {
  need(args.length === 4 || args.length === 5);
  need(args[0] === "--expected-commit" && /^[a-f0-9]{40}$/.test(args[1]) && args[2] === "--target" && typeof args[3] === "string" && args[3].length > 0 && args[3].length <= 4096);
  need(args.length === 4 || args[4] === "--apply");
  return { expectedCommit: args[1], targetPath: args[3], apply: args.length === 5 };
}
export function sourceContract(expectedCommit, options = {}) {
  need(/^[a-f0-9]{40}$/.test(expectedCommit));
  const root = options.root ?? ROOT;
  const read = options.read ?? (path => readFileSync(resolve(root, path)));
  const git = options.git ?? ((...args) => execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"].filter(key => process.env[key]).map(key => [key, process.env[key]])) }));
  const text = (...args) => git(...args).toString("utf8").trim();
  const check = () => {
    need(text("rev-parse", "HEAD") === expectedCommit);
    if (!options.git) need(realpathSync(text("rev-parse", "--show-toplevel")).toLowerCase() === realpathSync(root).toLowerCase());
    git("merge-base", "--is-ancestor", RELEASE_BASE, expectedCommit);
    need(text("status", "--porcelain=v1", "--untracked-files=all", "--", "src/server/db/migrations", ...RELEASE_FILES) === "");
  };
  check();
  const folder = "src/server/db/migrations", names = text("ls-tree", "-r", "--name-only", RELEASE_BASE, "--", folder).split("\n").filter(Boolean);
  need(names.length > 20 && same(text("ls-tree", "-r", "--name-only", expectedCommit, "--", folder).split("\n").filter(Boolean), names));
  const blobs = new Map();
  for (const path of names) {
    const bytes = git("show", `${RELEASE_BASE}:${path}`);
    need(bytes.equals(git("show", `${expectedCommit}:${path}`)) && bytes.equals(read(path)));
    blobs.set(path, bytes);
  }
  for (const path of RELEASE_FILES) need(git("show", `${expectedCommit}:${path}`).equals(read(path)));
  need(git("show", `${RELEASE_BASE}:scripts/db-migrate.mjs`).equals(read("scripts/db-migrate.mjs")));
  const journal = JSON.parse(blobs.get(`${folder}/meta/_journal.json`).toString("utf8"));
  need(journal.entries?.length === 19 && journal.entries.every((row, i) => row.idx === i && row.version === "7" && row.breakpoints === true && Number.isSafeInteger(row.when) && (i === 0 || row.when > journal.entries[i - 1].when)));
  const migrations = journal.entries.map((entry, index) => {
    const bytes = blobs.get(`${folder}/${entry.tag}.sql`); need(bytes && !bytes.includes(13));
    const lf = sha(bytes), crlf = sha(Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n")));
    return { index, tag: entry.tag, createdAt: entry.when, hash: lf, historicalAllowed: index < 11 || index === 13 ? [...new Set([lf, crlf])] : [lf] };
  });
  const provenance = sha(Buffer.from(JSON.stringify([...blobs].map(([path, bytes]) => [path, sha(bytes)]))));
  const reference = JSON.parse(read("scripts/release-migrate-reference.json").toString("utf8"));
  need(reference.version === 1 && reference.sourceCommit === RELEASE_BASE && reference.migrationsSHA256 === provenance && reference.baseline && reference.final);
  const recheck = () => { check(); for (const [path, bytes] of blobs) need(bytes.equals(read(path))); for (const path of RELEASE_FILES) need(git("show", `${expectedCommit}:${path}`).equals(read(path))); };
  return { expectedCommit, migrations, provenance, reference, recheck };
}
export function parseTarget(value, source) {
  const row = closed(value, ["version", "migrationUrl", "expected", "historicalPrefix", "provenance"]);
  need(row.version === 1 && typeof row.migrationUrl === "string" && row.migrationUrl.length <= 8192);
  const expected = closed(row.expected, ["hostname", "database", "owner", "ownerOid", "runtimeRole", "serverMajor", "tenantId", "canonicalOrigin"]);
  for (const key of ["database", "owner", "runtimeRole"]) need(typeof expected[key] === "string" && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(expected[key]));
  need(expected.owner !== expected.runtimeRole && expected.runtimeRole !== "portal_runtime" && expected.owner !== "portal_runtime");
  need(typeof expected.ownerOid === "string" && /^[1-9][0-9]{0,9}$/.test(expected.ownerOid));
  need(expected.serverMajor === 18 && expected.tenantId === "crc" && expected.canonicalOrigin === "https://beitmitzvah.centralreform.org");
  const url = new URL(row.migrationUrl);
  need(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === expected.hostname && /^[a-z0-9.-]+\.neon\.tech$/.test(url.hostname) && !url.hostname.includes("-pooler") && (!url.port || url.port === "5432"));
  need(decodeURIComponent(url.username) === expected.owner && decodeURIComponent(url.pathname.slice(1)) === expected.database && url.password && !url.hash);
  need(same([...url.searchParams.keys()], ["sslmode"]) && url.searchParams.get("sslmode") === "require");
  const provenance = closed(row.provenance, ["sourceCommit", "method", "observedAt"]);
  need(provenance.sourceCommit === RELEASE_BASE && provenance.method === "owner-readonly" && typeof provenance.observedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(provenance.observedAt) && Number.isFinite(Date.parse(provenance.observedAt)));
  need(Array.isArray(row.historicalPrefix) && row.historicalPrefix.length === 15);
  const prefix = row.historicalPrefix.map((entry, index) => {
    closed(entry, ["id", "hash", "createdAt"]); const migration = source.migrations[index];
    need(Number.isSafeInteger(entry.id) && entry.id > 0 && (index === 0 || entry.id > row.historicalPrefix[index - 1].id));
    need(migration.historicalAllowed.includes(entry.hash) && entry.createdAt === migration.createdAt); return { ...entry };
  });
  return { expected, prefix, connection: { host: url.hostname, port: 5432, database: expected.database, user: expected.owner, password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true, servername: url.hostname }, enableChannelBinding: true, options: "-c search_path=pg_catalog,public", client_encoding: "UTF8", connectionTimeoutMillis: 5000, query_timeout: 15000, statement_timeout: 12000, application_name: "portal-release-migrate" } };
}
export function checkLedger(rows, source, target) {
  need(Array.isArray(rows) && [15, 19].includes(rows.length));
  const values = rows.map(row => ({ id: Number(row.id), hash: row.hash, createdAt: Number(row.created_at) }));
  need(same(values.slice(0, 15), target.prefix));
  for (let index = 15; index < values.length; index++) {
    const row = values[index], migration = source.migrations[index];
    need(Number.isSafeInteger(row.id) && row.id > values[index - 1].id && row.hash === migration.hash && row.createdAt === migration.createdAt);
  }
  return values;
}
