import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entryProblems, inspectRepository } from "../scripts/repo-policy.mjs";
import {
  privateBenchmarkProblem, PRIVATE_BENCHMARK_REASON as PRIVATE,
  PRIVATE_BENCHMARK_BUDGET_REASON as BUDGET, PRIVATE_BENCHMARK_LIMITS as LIMITS,
} from "../scripts/private-benchmark-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const encode = text => Array.from(text, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
const payload = `{"${encode("schema")}":"${encode("chant-human-alignment/v1")}"}`;

test("independent: every character may be escaped, including nested prototype-shaped JSON keys", () => {
  for (const text of [payload, `[null,{"__proto__":${payload}}]`, `{"constructor":{"prototype":[${payload}]}}`,
    `{"safe":"${"[".repeat(128)}\\\"${"]".repeat(128)}","nested":${payload}}`]) {
    assert.equal(privateBenchmarkProblem(text, true), PRIVATE);
    assert.equal(privateBenchmarkProblem(text, false), PRIVATE);
  }
  assert.equal(Object.prototype.schema, undefined);
});

test("independent: malformed neighboring JSON lines do not hide valid escaped records", () => {
  for (const invalid of ['"unfinished synthetic string', "]".repeat(128), "invalid", "{not JSON}"]) {
    for (const text of [`${invalid}\n${payload}\nfalse`, `0\r\n${payload}\r\n${invalid}`]) {
      assert.ok([PRIVATE, BUDGET].includes(privateBenchmarkProblem(text, true)));
    }
  }
  assert.equal(privateBenchmarkProblem(`0\n${payload}`, false), null, "only whole raw JSON is treated as source-extension data");
});

test("independent: byte budgets cover a marker at the final boundary and cannot skip it", () => {
  const exact = " ".repeat(LIMITS.maxBytes - Buffer.byteLength(payload)) + payload;
  assert.equal(Buffer.byteLength(exact), LIMITS.maxBytes);
  assert.equal(privateBenchmarkProblem(exact, false), PRIVATE);
  assert.equal(privateBenchmarkProblem(exact + " ", false), BUDGET);
  assert.equal(privateBenchmarkProblem(" ".repeat(LIMITS.maxBytes + 1), true), BUDGET);
  assert.equal(privateBenchmarkProblem('export const sample = "' + " ".repeat(LIMITS.maxBytes) + '";', false), null);
  assert.equal(Object.isFrozen(LIMITS), true);
});

test("independent: source code strings and blocks stay permitted while pure JSON objects reject", () => {
  for (const text of [`export default ${payload};`, `const synthetic = ${JSON.stringify(payload)};`, `{ const x = ${payload}; }`,
    `/* synthetic fixture */\n${payload}`, `JSON.parse(${JSON.stringify(payload)});`]) {
    assert.equal(privateBenchmarkProblem(text, false), null);
  }
  for (const extension of ["mjs", "ts", "tsx", "md", "svg"]) assert.ok(entryProblems(`trope/raw.${extension}`, payload).includes(PRIVATE));
  const malformed = '{"schema":"chant-human-alignment/v1",';
  assert.equal(privateBenchmarkProblem(malformed, true), PRIVATE);
  assert.equal(privateBenchmarkProblem(malformed, false), null);
});

test("independent: traversal limits remain fixed findings after malformed lexical prefixes", () => {
  const overDepth = "[".repeat(LIMITS.maxDepth + 2) + "0" + "]".repeat(LIMITS.maxDepth + 2);
  assert.equal(privateBenchmarkProblem("]".repeat(100) + "\n" + overDepth, true), BUDGET);
  assert.equal(privateBenchmarkProblem('"unfinished\n' + overDepth, true), BUDGET);
  assert.equal(privateBenchmarkProblem('"unfinished\n' + "0\n".repeat(LIMITS.maxNodes + 1), true), BUDGET);
  for (const result of [privateBenchmarkProblem(payload, true), privateBenchmarkProblem(overDepth, true)]) assert.ok([PRIVATE, BUDGET].includes(result));
});

test("independent: BOM-framed escaped private records are rejected as common UTF-8 data exports", () => {
  // A leading BOM is transport framing, not public source content. JSON.parse
  // alone refuses it; the privacy boundary should inspect the framed record.
  for (const text of ["\ufeff" + payload, "\ufeff{}\n" + payload, "{}\n\ufeff" + payload]) {
    assert.equal(privateBenchmarkProblem(text, true), PRIVATE);
  }
  assert.equal(privateBenchmarkProblem("\ufeff" + payload, false), PRIVATE);
  assert.equal(privateBenchmarkProblem('\ufeffexport const SCHEMA = "chant-human-alignment/v1";', false), null);
});

test("independent: candidate/index/index-only decoded records reject without changing font integrity policy", async () => {
  const isolated = await isolatedEnv(), root = await mkdtemp(join(tmpdir(), "private-schema-independent-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env: isolated.env, stdio: "pipe", windowsHide: true });
  const paths = ["trope/independent.json", "tests/fixtures/trope/independent.ndjson", "tests/fixtures/portal/independent.jsonl", "trope/independent.mjs",
    "public/fonts/noto-serif-hebrew/OFL.txt", "public/fonts/bricolage-grotesque/OFL.txt"];
  const put = async (path, text) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); };
  const reject = (findings, index) => { for (const path of paths) assert.ok(findings.includes(`${path}${index ? " (index)" : ""}: ${PRIVATE}`), path); };
  try {
    git("init", "-b", "main"); await put("README.md", "Synthetic independent guard fixture\n"); git("add", "README.md");
    for (const path of paths) await put(path, payload);
    reject((await inspectRepository(root, isolated.env)).findings, false);
    git("add", ".");
    for (const path of paths) await put(path, "{}");
    reject((await inspectRepository(root, isolated.env)).findings, true);
    for (const path of paths) await rm(join(root, path));
    reject((await inspectRepository(root, isolated.env)).findings, true);
  } finally { await rm(root, { recursive: true, force: true }); await isolated.cleanup(); }
});
