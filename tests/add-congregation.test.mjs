import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/add-congregation.mjs", import.meta.url));
const ARGS = ["--id", "synthetic-shul", "--name", "Synthetic Congregation", "--product-name", "Synthetic Portal", "--host", "portal.synthetic.example",
  "--origin", "https://portal.synthetic.example", "--environment", "production", "--deployment", "production"];

test("the onboarding CLI refuses bad arguments, a missing owner connection and the runtime DATABASE_URL, and prints no configuration", async () => {
  const home = await isolatedEnv();
  try {
    const usage = spawnSync(process.execPath, [SCRIPT, "--id", "Bad Id"], { env: home.env, encoding: "utf8" });
    assert.equal(usage.status, 2); assert.match(usage.stderr, /Usage/); assert.equal(usage.stdout, "");
    // Assembled at runtime so no credential-shaped text sits in the repository.
    const canary = randomUUID(), secret = ["postgres", "://", "runtime", ":", canary, "@", "127.0.0.1:9", "/app"].join("");
    // The app's runtime connection is never used: only OWNER_DATABASE_URL is read.
    const runtimeOnly = spawnSync(process.execPath, [SCRIPT, ...ARGS, "--apply"], { env: { ...home.env, DATABASE_URL: secret }, encoding: "utf8" });
    assert.equal(runtimeOnly.status, 2); assert.match(runtimeOnly.stderr, /OWNER_DATABASE_URL/);
    assert.ok(!(runtimeOnly.stdout + runtimeOnly.stderr).includes(canary));
    // An unreachable owner database is a fixed refusal line with no driver detail.
    const unreachable = spawnSync(process.execPath, [SCRIPT, ...ARGS], { env: { ...home.env, OWNER_DATABASE_URL: secret }, encoding: "utf8", timeout: 30_000 });
    assert.equal(unreachable.status, 1); assert.deepEqual(JSON.parse(unreachable.stdout), { outcome: "refused", code: "unavailable" });
    assert.ok(!(unreachable.stdout + unreachable.stderr).includes(canary)); assert.ok(!/127\.0\.0\.1|runtime/.test(unreachable.stdout + unreachable.stderr));
  } finally { await home.cleanup(); }
});
