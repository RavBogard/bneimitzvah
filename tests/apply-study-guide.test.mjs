import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { loadRuntime, parseArgs } from "../scripts/apply-study-guide.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/apply-study-guide.mjs", import.meta.url));
const member = "10000000-0000-4000-8000-000000000001";

test("arguments are closed: kind, slug, file and a membership uuid are required; flags are exact", () => {
  assert.deepEqual(parseArgs(["--kind", "torah", "--reading-key", "pekudei", "--file", "g.json", "--admin-membership", member]),
    { tenant: "crc", hold: false, apply: false, kind: "torah", readingKey: "pekudei", file: "g.json", membershipId: member });
  assert.equal(parseArgs(["--kind", "haftarah", "--reading-key", "i-kings-8-1-8-21", "--file", "g.json", "--admin-membership", member, "--apply", "--hold"]).apply, true);
  for (const bad of [[], ["--kind", "blessing-before", "--reading-key", "x", "--file", "g", "--admin-membership", member], ["--kind", "torah", "--reading-key", "Pekudei", "--file", "g", "--admin-membership", member],
    ["--kind", "torah", "--reading-key", "x", "--file", "g", "--admin-membership", "admin"], ["--kind", "torah", "--kind", "torah", "--reading-key", "x", "--file", "g", "--admin-membership", member],
    ["--kind", "torah", "--reading-key", "x", "--file", "g", "--admin-membership", member, "--force"]]) assert.throws(() => parseArgs(bad), /usage/, JSON.stringify(bad));
});

test("the CLI refuses without arguments or runtime configuration and prints no configuration", async () => {
  const home = await isolatedEnv();
  try {
    const usage = spawnSync(process.execPath, [SCRIPT], { env: home.env, encoding: "utf8" });
    assert.equal(usage.status, 2); assert.match(usage.stderr, /Usage/);
    // Assembled at runtime so no credential-shaped text sits in the repository.
    const canary = randomUUID(), secret = ["postgres", "://", "operator", ":", canary, "@", "db.invalid", "/app"].join("");
    const missing = spawnSync(process.execPath, [SCRIPT, "--kind", "torah", "--reading-key", "pekudei", "--file", "missing.json", "--admin-membership", member], { env: { ...home.env, DATABASE_URL: secret }, encoding: "utf8" });
    assert.equal(missing.status, 2); assert.match(missing.stderr, /JSON file/);
    assert.ok(!(missing.stdout + missing.stderr).includes(canary));
  } finally { await home.cleanup(); }
});

test("the TypeScript bridge loads through the pinned module runner without the Next server", async () => {
  const runtime = await loadRuntime();
  try { assert.equal(typeof runtime.runBridge, "function"); } finally { await runtime.close(); }
});
