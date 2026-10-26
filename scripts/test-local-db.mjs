// Local runner for the database-backed suites (tests/postgres and tests/http-browser).
//
//   npm run test:local-db -- [--http] <test files...>
//
// Starts a throwaway Postgres from the `embedded-postgres` npm package, which lives in a per-user
// cache directory outside the repo (never in package.json, so CI and `npm ci` do not pay for it),
// runs the named files the way CI does, then always stops the cluster and deletes its data.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Postgres 18 build, published 2026-06-05; CI uses the postgres:18.6 image.
const EMBEDDED_POSTGRES_VERSION = "18.4.0-beta.17";
const DATABASE = "portal_rls_test";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: npm run test:local-db -- [--http] <test files...>

  tests/postgres/*.integration.mjs   node --test --test-concurrency=1
  other tests/postgres/ files        vitest --config vitest.postgres.config.mts
  tests/http-browser/ files          vitest --config vitest.http-browser.config.mts
                                     (runs "npm run build" first when --http is given
                                     or .next/BUILD_ID is missing)
`;

function cacheDir() {
  const home = os.homedir();
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    : process.platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : process.env.XDG_CACHE_HOME ?? path.join(home, ".cache");
  return path.join(base, "crc-torah", "embedded-postgres");
}

function installedVersion(prefix) {
  try {
    const pkg = path.join(prefix, "node_modules", "embedded-postgres", "package.json");
    return JSON.parse(readFileSync(pkg, "utf8")).version;
  } catch {
    return null;
  }
}

// One command string with a shell: npm is a .cmd shim on Windows, and an args array with shell:true is deprecated.
function npmRun(command) {
  return spawnSync(command, { stdio: "inherit", shell: true });
}

async function loadEmbeddedPostgres() {
  const prefix = cacheDir();
  if (installedVersion(prefix) !== EMBEDDED_POSTGRES_VERSION) {
    console.log(`Installing embedded-postgres@${EMBEDDED_POSTGRES_VERSION} into the user cache (first run only).`);
    mkdirSync(prefix, { recursive: true });
    const result = npmRun(
      `npm install embedded-postgres@${EMBEDDED_POSTGRES_VERSION} --prefix "${prefix}" --no-audit --no-fund --loglevel=error`,
    );
    if (result.status !== 0) throw new Error("Could not install embedded-postgres into the user cache");
  }
  const entry = createRequire(path.join(prefix, "noop.js")).resolve("embedded-postgres");
  const loaded = await import(pathToFileURL(entry).href);
  return loaded.default ?? loaded.EmbeddedPostgres;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Route each file to the command CI would use. Returns the commands to run, in order.
function plan(files, env) {
  const norm = (f) => f.replaceAll("\\", "/").replace(/^\.\//, "");
  const nodeFiles = [];
  const pgVitest = [];
  const httpVitest = [];
  for (const raw of files) {
    const file = norm(raw);
    if (!existsSync(path.join(repoRoot, file))) throw new Error(`No such test file: ${file}`);
    if (file.startsWith("tests/http-browser/")) httpVitest.push(file);
    else if (file.startsWith("tests/postgres/") && /\.mjs$/.test(file)) nodeFiles.push(file);
    else if (file.startsWith("tests/postgres/")) pgVitest.push(file);
    else throw new Error(`Not a tests/postgres or tests/http-browser file: ${file}`);
  }
  const vitest = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const commands = [];
  if (nodeFiles.length) {
    commands.push({ cmd: process.execPath, args: ["--test", "--test-concurrency=1", ...nodeFiles], env });
  }
  if (pgVitest.length) {
    commands.push({ cmd: process.execPath, args: [vitest, "run", "--config", "vitest.postgres.config.mts", ...pgVitest], env });
  }
  if (httpVitest.length) {
    commands.push({ cmd: process.execPath, args: [vitest, "run", "--config", "vitest.http-browser.config.mts", ...httpVitest], env });
  }
  return { commands, needsBuild: httpVitest.length > 0 };
}

let activeChild = null;

function run({ cmd, args, env }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: repoRoot, env, stdio: "inherit" });
    activeChild = child;
    child.once("error", () => resolve(1));
    child.once("exit", (code, signal) => { activeChild = null; resolve(code ?? (signal ? 1 : 0)); });
  });
}

function runBuild(env) {
  return new Promise((resolve) => {
    const child = spawn("npm run build", { cwd: repoRoot, env, stdio: "inherit", shell: true });
    activeChild = child;
    child.once("error", () => resolve(1));
    child.once("exit", (code) => { activeChild = null; resolve(code ?? 1); });
  });
}

function killChildTree() {
  const child = activeChild;
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}

async function main() {
  const argv = process.argv.slice(2);
  const forceBuild = argv.includes("--http");
  const files = argv.filter((a) => !a.startsWith("--"));
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--http");
  if (!files.length || unknown.length || argv.includes("--help")) {
    process.stderr.write(USAGE);
    return 2;
  }

  // Validate and route before starting a database, so a typo costs nothing.
  const probeEnv = { ...process.env };
  const { commands, needsBuild } = plan(files, probeEnv);

  const EmbeddedPostgres = await loadEmbeddedPostgres();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "crc-local-db-"));
  const password = randomBytes(18).toString("base64url");
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, user: "postgres", password, port, persistent: false,
    initdbFlags: ["-E", "UTF8", "--locale=C"],
    // The library logs connection details and passwords never; drop server chatter anyway.
    onLog: () => {}, onError: () => {},
  });

  let started = false;
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    killChildTree();
    if (started) { try { await pg.stop(); } catch { /* cluster may already be down */ } }
    try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
    process.on(signal, () => { cleanup().finally(() => process.exit(130)); });
  }

  try {
    console.log(`Starting a throwaway UTF-8 Postgres on 127.0.0.1:${port}.`);
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase(DATABASE);

    const env = {
      ...process.env,
      POSTGRES_TEST_DISPOSABLE: "1",
      PGHOST: "127.0.0.1",
      PGPORT: String(port),
      PGDATABASE: DATABASE,
      PGUSER: "postgres",
      PGPASSWORD: password,
    };
    // A DATABASE_URL from the developer's shell must never reach these suites.
    delete env.DATABASE_URL;

    if (needsBuild && (forceBuild || !existsSync(path.join(repoRoot, ".next", "BUILD_ID")))) {
      console.log("Running npm run build first.");
      const code = await runBuild(env);
      if (code !== 0) return code;
    }
    let failure = 0;
    for (const command of commands) {
      const code = await run({ ...command, env });
      if (code !== 0 && failure === 0) failure = code;
    }
    return failure;
  } finally {
    await cleanup();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => { console.error(`test:local-db failed: ${error?.message ?? "unknown error"}`); process.exit(1); },
);
