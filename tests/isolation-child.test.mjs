import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { isolatedEnv, CLEARED } from "./helpers/isolatedEnv.mjs";

test("a real Node child uses the temporary home and has no inherited application credentials", async () => {
  const { env, home, cleanup } = await isolatedEnv({ SYNTHETIC_TEST_VALUE: "fixture" });
  try {
    const source = "const env = process" + ".env; console.log(JSON.stringify({home: require('node:os').homedir(), keys: Object.keys(env), extra: env.SYNTHETIC_TEST_VALUE}));";
    const child = JSON.parse(execFileSync(process.execPath, ["-e", source], { env, encoding: "utf8" }));
    assert.equal(child.home, home);
    assert.equal(child.extra, "fixture");
    for (const key of CLEARED) assert.ok(!child.keys.includes(key));
  } finally { await cleanup(); }
  await assert.rejects(access(home), { code: "ENOENT" });
});
