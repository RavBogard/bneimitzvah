import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("review: index path tabs cannot make attachment protection attempt to read the private blob", async () => {
  const { env, cleanup } = await isolatedEnv();
  const root = await mkdtemp(join(tmpdir(), "portal-policy-review-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  try {
    git("init", "-b", "main");
    await writeFile(join(root, "README.md"), "Synthetic reviewer repository\n");
    git("add", "README.md");
    // An index-only path needs no corresponding filesystem name, so this also
    // exercises Git's raw TAB path representation on Windows. The deliberately
    // absent blob makes any forbidden cat-file attempt fail deterministically.
    const path = "synthetic\t/.codex-remote-attachments/private-review-name.ts";
    git("-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${"a".repeat(40)},${path}`);
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes("private remote attachment directory (index): prohibited publish candidate"));
    assert.ok(!JSON.stringify(result).includes("private-review-name"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanup();
  }
});
