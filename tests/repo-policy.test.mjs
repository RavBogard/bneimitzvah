import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryProblems, inspectRepository, repositoryGit } from "../scripts/repo-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

test("policy rejects prohibited filenames regardless of location and case", () => {
  for (const file of ["recording.MP3", "trope/cells/model.safetensors", ".env.local", "nested/.env.example", "auth.local.json", "server.pem", "id_ed25519", "family.csv"]) {
    assert.ok(entryProblems(file).length > 0, file);
  }
  assert.deepEqual(entryProblems(".env.example", "# names only\nDATABASE_URL=\n"), []);
  assert.ok(entryProblems(".env.example", "BETTER_AUTH_SECRET=" + "filled-value").length > 0);
});

test("reviewed config and synthetic fixture paths do not bypass content checks", () => {
  assert.deepEqual(entryProblems(".impeccable/config.json", '{"version":1}'), []);
  assert.deepEqual(entryProblems("tests/fixtures/portal/student.json", '{"email":"fixture@example.test"}'), []);
  const samples = [
    "vercel_blob_" + "rw_" + "syntheticToken",
    "GOC" + "SPX-" + "syntheticToken",
    "re_" + "x".repeat(24),
    "sk-" + "ant-" + "syntheticToken",
    "-----BEGIN " + "PRIVATE KEY-----",
    "postgresql://" + "fixture:synthetic-password" + "@" + "db.invalid/db",
    "BETTER_AUTH_SECRET=" + "synthetic-long-value",
    "person@" + "private.invalid",
    "THE " + "JPS TANAKH",
  ];
  for (const content of samples) {
    assert.ok(entryProblems("tests/fixtures/portal/data.json", content).length > 0, "sensitive synthetic fixture rejected");
  }
  assert.ok(entryProblems("src/leak.ts", samples[0]).includes("credential pattern"));
});

test("git integration detects untracked, force-staged ignored, and index-only sensitive files without echoing contents", async () => {
  const { env, cleanup } = await isolatedEnv();
  const root = await mkdtemp(join(tmpdir(), "portal-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe" });
  try {
    git("init", "-b", "main");
    await writeFile(join(root, ".gitignore"), ".env.local\n");
    await writeFile(join(root, "README.md"), "Synthetic fixture repository\n");
    git("add", "README.md", ".gitignore");
    assert.deepEqual((await inspectRepository(root, env)).findings, []);
    await writeFile(join(root, "untracked.csv"), "synthetic\n");
    assert.ok((await inspectRepository(root, env)).findings.some(x => x.startsWith("untracked.csv:")));
    await rm(join(root, "untracked.csv"));
    await writeFile(join(root, ".env.local"), "LOCAL_VALUE=synthetic\n");
    assert.deepEqual((await inspectRepository(root, env)).findings, [], "ignored local files aren't publish candidates");
    git("add", "-f", ".env.local");
    assert.ok((await inspectRepository(root, env)).findings.some(x => x.startsWith(".env.local")));
    git("rm", "--cached", ".env.local");
    const sentinel = "vercel_blob_" + "rw_" + "uniqueSyntheticSentinel";
    await writeFile(join(root, "staged.ts"), sentinel);
    git("add", "staged.ts");
    await writeFile(join(root, "staged.ts"), "export {};\n");
    const result = await inspectRepository(root, env);
    assert.ok(result.findings.includes("staged.ts (index): credential pattern"));
    assert.ok(!JSON.stringify(result).includes(sentinel), "diagnostics must not expose matching content");
  } finally {
    await rm(root, { recursive: true, force: true });
    await cleanup();
  }
});

test("git failure errors with sensitive arguments discard command output and original error details", async () => {
  const { env, cleanup } = await isolatedEnv();
  try {
    const sentinel = "synthetic-sensitive-invalid-object";
    await assert.rejects(
      repositoryGit(["cat-file", "blob", sentinel], { env, encoding: "utf8" }),
      error => {
        assert.equal(error.message, "Repository policy: git cat-file failed; output withheld");
        assert.equal(error.cause, undefined);
        assert.equal(error.stdout, undefined);
        assert.equal(error.stderr, undefined);
        assert.ok(!String(error.stack).includes(sentinel));
        return true;
      },
    );
  } finally { await cleanup(); }
});
