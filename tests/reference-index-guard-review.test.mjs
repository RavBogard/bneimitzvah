import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entryProblems, inspectRepository } from "../scripts/repo-policy.mjs";
import { privateBenchmarkProblem, PRIVATE_REFERENCE_INDEX_REASON as PRIVATE, PRIVATE_BENCHMARK_BUDGET_REASON as BUDGET, PRIVATE_BENCHMARK_LIMITS as LIMITS } from "../scripts/private-benchmark-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const schema = "pockettorah-verse-index/v1";
const escape = value => [...value].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
const encoded = `{"${escape("schema")}":"${escape(schema)}"}`;

test("independent reference guard decodes every character and nested/BOM/line framing without interpreting code strings", () => {
  const nested = `{"__proto__":{"payload":[${encoded}]}}`;
  for (const text of [encoded, nested, `\ufeff[null,${nested}]`, `invalid\r\n\ufeff${nested}\r\n`]) {
    assert.equal(privateBenchmarkProblem(text, true), PRIVATE);
    for (const extension of ["json", "jsonl", "ndjson", "csv", "tsv", "txt"]) assert.ok(entryProblems(`tests/fixtures/portal/synthetic.${extension}`, text).includes(PRIVATE));
  }
  for (const extension of ["js", "mjs", "ts", "tsx"]) {
    assert.ok(entryProblems(`src/synthetic.${extension}`, `\ufeff${nested}`).includes(PRIVATE));
    for (const text of [`export const schema = ${JSON.stringify(schema)};`, `const example = ${JSON.stringify(encoded)};`, `// ${nested}\nexport {};`]) assert.deepEqual(entryProblems(`src/synthetic.${extension}`, text), []);
  }
  for (const value of [{ schema: `${schema}-extra` }, { schema: `prefix-${schema}` }, { schema: "pockettorah-verse-index/v10" }, { Schema: schema }, { note: encoded }]) assert.equal(privateBenchmarkProblem(JSON.stringify(value), true), null);
});

test("independent reference guard retains fail-closed shared budgets and private path first classification", () => {
  assert.deepEqual(LIMITS, { maxBytes: 4 * 1024 * 1024, maxDepth: 64, maxNodes: 100_000 });
  assert.equal(privateBenchmarkProblem("[".repeat(65) + encoded + "]".repeat(65), true), BUDGET);
  assert.equal(privateBenchmarkProblem(" ".repeat(LIMITS.maxBytes + 1) + encoded, true), BUDGET);
  assert.deepEqual(entryProblems(".local-data/reference/synthetic.ts", { toString() { throw new Error("Private content must not be inspected"); } }), ["private local data directory"]);
});

test("independent reference guard rejects candidate/index/index-only records but never publishes ignored private inputs", async () => {
  const isolated = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "reference-guard-review-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: isolated.env, stdio: "pipe", windowsHide: true });
  const paths = ["tests/fixtures/portal/synthetic.jsonl", "src/synthetic.ts", "public/fonts/noto-serif-hebrew/OFL.txt"];
  const put = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const check = (result, indexed) => { for (const path of paths) assert.ok(result.findings.includes(`${path}${indexed ? " (index)" : ""}: ${PRIVATE}`)); };
  try {
    git("init", "-b", "main"); await put("README.md", "Synthetic guard review\n"); await put(".gitignore", ".local-data/\n"); git("add", "README.md", ".gitignore");
    await put(".local-data/reference/synthetic.json", encoded);
    assert.deepEqual((await inspectRepository(root, isolated.env)).findings, []);
    for (const path of paths) await put(path, path.endsWith("jsonl") ? `invalid\n\ufeff${encoded}` : `\ufeff[${encoded}]`);
    check(await inspectRepository(root, isolated.env), false); git("add", ...paths);
    for (const path of paths) await put(path, "{}"); check(await inspectRepository(root, isolated.env), true);
    for (const path of paths) await rm(join(root, path)); check(await inspectRepository(root, isolated.env), true);
    git("add", "-f", ".local-data/reference/synthetic.json");
    const forced = await inspectRepository(root, isolated.env);
    assert.ok(forced.findings.includes("private local data directory (index): prohibited publish candidate"));
    assert.ok(!JSON.stringify(forced).includes("reference/synthetic.json"));
  } finally { await rm(root, { recursive: true, force: true }); await isolated.cleanup(); }
});
