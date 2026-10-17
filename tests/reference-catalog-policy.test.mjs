import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entryProblems, inspectRepository } from "../scripts/repo-policy.mjs";
import { privateBenchmarkProblem, PRIVATE_REFERENCE_INDEX_REASON as PRIVATE, PRIVATE_BENCHMARK_BUDGET_REASON as BUDGET, PRIVATE_BENCHMARK_LIMITS as LIMITS } from "../scripts/private-benchmark-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const schema = "reference-catalog/v1";
const escape = value => [...value].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
const encoded = `{"${escape("schema")}":"${escape(schema)}"}`;
// Structurally real catalog envelope, invented syllables, identity and times only.
const catalog = JSON.stringify({ schema, source: "PockettorahAudioFiles", assets: [{ id: "ra_" + "a".repeat(32), archiveFile: "Synthetic.mp3", sha256: "b".repeat(64), bytes: 4,
  verses: [{ schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah", playback: { status: "ready", asset: "ra_" + "a".repeat(32), clip: { start: 1, end: 3 } },
    words: { status: "unavailable", reason: "portal-text-unavailable" }, attribution: { title: "PocketTorah Audio Files", creator: "not-a-box media lab", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "Cut into single verses with computed word timings." } }] }] });

test("catalog payloads reuse the one bounded reference guard under data and disguised source extensions", () => {
  const nested = `{"payload":[{"__proto__":${encoded}}]}`;
  for (const value of [catalog, encoded, nested, `\ufeff${nested}`]) {
    assert.equal(privateBenchmarkProblem(value, true), PRIVATE);
    assert.equal(privateBenchmarkProblem(value, false), PRIVATE);
    for (const ext of ["json", "csv", "tsv", "txt", "jsonl", "ndjson", "ts", "tsx", "mjs"]) assert.ok(entryProblems(`tests/fixtures/portal/synthetic.${ext}`, value).includes(PRIVATE));
  }
  for (const value of [`broken\n\ufeff${encoded}\n`, `{"public":true}\r\n${encoded}`, '{"schema":"reference-catalog/v1",']) assert.equal(privateBenchmarkProblem(value, true), PRIVATE);
});

test("public source strings, docs and JSON-encoded strings are not schema-bearing catalog data", () => {
  for (const source of [`export const schema = ${JSON.stringify(schema)};`, `const fixture = ${JSON.stringify(catalog)};`, `// ${catalog}\nexport {};`, `export const data = {schema:${JSON.stringify(schema)}};`]) assert.deepEqual(entryProblems("src/synthetic.ts", source), []);
  for (const value of [{ documentation: schema }, { text: catalog }, { schema: "reference-catalog/v10" }, { schema: schema + "-extra" }, { schema: "prefix-" + schema }, { Schema: schema }, { schema: [schema] }, { schema: 1 }]) assert.equal(privateBenchmarkProblem(JSON.stringify(value), true), null);
  assert.equal(privateBenchmarkProblem(JSON.stringify(catalog), true), null);
  // The separate original index rule is preserved; no filename/index dependency.
  assert.equal(privateBenchmarkProblem('{"schema":"pockettorah-verse-index/v1"}', false), PRIVATE);
});

test("byte/depth/node limits and malformed-line behavior remain shared and unchanged", () => {
  assert.deepEqual(LIMITS, { maxBytes: 4 * 1024 * 1024, maxDepth: 64, maxNodes: 100_000 });
  assert.equal(privateBenchmarkProblem(" ".repeat(LIMITS.maxBytes + 1) + encoded, true), BUDGET);
  assert.equal(privateBenchmarkProblem("[".repeat(65) + encoded + "]".repeat(65), true), BUDGET);
  assert.equal(privateBenchmarkProblem("0\n".repeat(LIMITS.maxNodes) + encoded, true), BUDGET);
  assert.equal(privateBenchmarkProblem(`bad\n${encoded}\n`, false), null);
  assert.deepEqual(entryProblems(".local-data/catalog/private.ts", { toString() { throw new Error("Must not read private inputs"); } }), ["private local data directory"]);
});

test("ignored/outside catalog inputs stay outside publish; force-staging is refused without revealing contents", async () => {
  const isolated = await isolatedEnv(), parent = await mkdtemp(join(tmpdir(), "reference-catalog-guard-")), root = join(parent, "repo");
  const git = (...args) => execFileSync("git", args, { cwd: root, env: isolated.env, stdio: "pipe", windowsHide: true });
  const put = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  try {
    await mkdir(root); git("init", "-b", "main");
    await put(".gitignore", ".local-data/\n"); await put("README.md", "Synthetic policy test\n"); git("add", ".gitignore", "README.md");
    await writeFile(join(parent, "outside-catalog.json"), catalog); await put(".local-data/reference/catalog.json", catalog);
    assert.deepEqual((await inspectRepository(root, isolated.env)).findings, []);
    git("add", "-f", ".local-data/reference/catalog.json");
    const forced = await inspectRepository(root, isolated.env);
    assert.ok(forced.findings.includes("private local data directory (index): prohibited publish candidate"));
    assert.ok(!JSON.stringify(forced).includes("Synthetic.mp3"));
  } finally { await rm(parent, { recursive: true, force: true }); await isolated.cleanup(); }
});

test("actual catalog is refused in worktree, safe-worktree/forbidden-index and index-only forms", async () => {
  const isolated = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "reference-catalog-index-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: isolated.env, stdio: "pipe", windowsHide: true });
  const paths = ["tests/fixtures/portal/catalog.json", "src/catalog.ts", "public/fonts/noto-serif-hebrew/OFL.txt"];
  const put = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const check = (result, indexed) => { for (const path of paths) assert.ok(result.findings.includes(`${path}${indexed ? " (index)" : ""}: ${PRIVATE}`)); assert.ok(!JSON.stringify(result).includes("Synthetic.mp3")); };
  try {
    git("init", "-b", "main"); await put("README.md", "Synthetic catalog test\n"); git("add", "README.md");
    for (const path of paths) await put(path, catalog);
    check(await inspectRepository(root, isolated.env), false);
    git("add", ...paths);
    for (const path of paths) await put(path, "{}");
    check(await inspectRepository(root, isolated.env), true);
    for (const path of paths) await rm(join(root, path));
    check(await inspectRepository(root, isolated.env), true);
  } finally { await rm(root, { recursive: true, force: true }); await isolated.cleanup(); }
});
