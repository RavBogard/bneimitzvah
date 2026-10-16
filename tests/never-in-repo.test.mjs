import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { inspectRepository } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("publish candidates and index contain no prohibited files or known sensitive content", async () => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const result = await inspectRepository(fileURLToPath(new URL("..", import.meta.url)), env);
    assert.ok(result.count > 0, "guard must inspect actual files");
    assert.deepEqual(result.findings, []);
  } finally { await cleanup(); }
});
