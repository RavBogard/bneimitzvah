import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { entryProblems, inspectRepository } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("publish candidates and index contain no prohibited files or known sensitive content", async () => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const result = await inspectRepository(fileURLToPath(new URL("..", import.meta.url)), env);
    assert.ok(result.count > 0, "guard must inspect actual files");
    assert.deepEqual(result.findings, []);
  } finally { await cleanup(); }
});

test("local private data paths are forbidden without inspecting content or exposing filenames", () => {
  const unreadableContent = { toString() { throw new Error("private content must not be inspected"); } };
  for (const path of [".local-data", ".local-data/roster/synthetic.ts", ".local-data/empty", "nested/.LOCAL-DATA/synthetic.md", "nested\\.local-data\\synthetic.svg"]) {
    for (const content of ["", "export {};", "\u0000synthetic", unreadableContent]) {
      assert.deepEqual(entryProblems(path, content), ["private local data directory"]);
    }
  }
  assert.deepEqual(entryProblems("src/local-data.ts", "export {};"), []);
  assert.deepEqual(entryProblems("src/.local-data-example.ts", "export {};"), []);
});

test("ignored local data is excluded while force-staged and index-only local data is rejected for every extension", async () => {
  const { env, home, cleanup } = await isolatedEnv();
  try {
    const root = join(home, "synthetic-repository");
    await mkdir(root);
    const git = (...args) => execFileSync("git", args, { cwd: root, env, windowsHide: true });
    git("init", "-b", "main");
    await writeFile(join(root, "README.md"), "Synthetic repository policy fixture\n");
    git("add", "README.md");
    const paths = [".local-data/roster/synthetic.ts", ".local-data/synthetic.md", ".local-data/synthetic.unknown", ".local-data/empty"];
    await mkdir(join(root, ".local-data", "roster"), { recursive: true });
    for (const path of paths) await writeFile(join(root, path), "");
    const untracked = await inspectRepository(root, env);
    assert.deepEqual(untracked.findings, ["private local data directory: prohibited publish candidate"]);
    assert.equal(untracked.count, paths.length + 1);

    const ignore = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
    assert.ok(ignore.split(/\r?\n/).includes(".local-data/"), "the actual checkout must ignore local private data");
    await writeFile(join(root, ".gitignore"), ".local-data/\n");
    git("add", ".gitignore");
    const ignored = await inspectRepository(root, env);
    assert.deepEqual(ignored.findings, []);
    assert.equal(ignored.count, 2, "ignored local data must not enter the publish candidate set");
    for (const path of paths) {
      git("add", "-f", "--", path);
      const forced = await inspectRepository(root, env);
      assert.deepEqual(forced.findings, [
        "private local data directory: prohibited publish candidate",
        "private local data directory (index): prohibited publish candidate",
      ]);
      await rm(join(root, path));
      const indexOnly = await inspectRepository(root, env);
      assert.deepEqual(indexOnly.findings, forced.findings, "a missing worktree copy cannot hide a prohibited indexed file");
      git("rm", "--cached", "--", path);
    }
  } finally { await cleanup(); }
});
