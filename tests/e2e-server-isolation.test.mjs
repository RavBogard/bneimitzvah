import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBuiltE2eServer } from "./helpers/builtE2eServer.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const exec = promisify(execFile);
const rootUrl = new URL("../", import.meta.url);

test("production browser startup rejects every dotenv entry before executing project code", async () => {
  const root = await mkdtemp(join(tmpdir(), "bneimitzvah-e2e-block-"));
  try {
    for (const filename of [".env.production.local", ".env.local", ".env.production", ".env"]) {
      const path = join(root, filename);
      await writeFile(path, "E2E_POISON=harmless-synthetic-value\n");
      await assert.rejects(startBuiltE2eServer(root, 3100), { message: "Production browser gate requires a clean checkout without dotenv files" });
      await rm(path);
    }
    await mkdir(join(root, ".env.local"));
    await assert.rejects(startBuiltE2eServer(root, 3100), { message: "Production browser gate requires a clean checkout without dotenv files" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("production browser child discards synthetic inherited provider and operator configuration and cleans its home", async () => {
  const root = await mkdtemp(join(tmpdir(), "bneimitzvah-e2e-spawn-"));
  const isolation = await isolatedEnv({
    E2E_POISON: "synthetic-only", E2E_ORIGINAL_HOME: "synthetic-only",
    BETTER_AUTH_SECRET: "test", BETTER_AUTH_URL: "https://synthetic.invalid",
    DATABASE_URL: "test", DATABASE_MIGRATION_URL: "test", BOOTSTRAP_OWNER_EMAIL: "synthetic-only",
    GOOGLE_CLIENT_ID: "synthetic-only", GOOGLE_CLIENT_SECRET: "test", RESEND_API_KEY: "test",
    PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production",
  });
  try {
    const bin = join(root, "node_modules", "next", "dist", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await copyFile(new URL("tests/fixtures/e2e-server-probe.mjs", rootUrl), join(bin, "next"));
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        probe.close(() => resolve(address.port));
      });
    });
    const { stdout, stderr } = await exec(process.execPath, [
      fileURLToPath(new URL("tests/fixtures/e2e-server-runner.mjs", rootUrl)),
      new URL("tests/helpers/builtE2eServer.mjs", rootUrl).href, root, String(port),
    ], { env: isolation.env, timeout: 40_000, windowsHide: true });
    assert.equal(stdout.trim(), "isolated child and cleanup verified");
    assert.equal(stderr, "");
  } finally {
    await isolation.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});

test("production browser startup refuses an occupied port instead of reusing another server", async () => {
  const root = await mkdtemp(join(tmpdir(), "bneimitzvah-e2e-port-"));
  const occupied = createServer();
  try {
    await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    await assert.rejects(startBuiltE2eServer(root, address.port), { message: "Production browser gate port unavailable" });
  } finally {
    await new Promise(resolve => occupied.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
