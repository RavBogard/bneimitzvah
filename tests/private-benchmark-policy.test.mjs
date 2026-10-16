import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { entryProblems, inspectRepository } from "../scripts/repo-policy.mjs";
import {
  PRIVATE_BENCHMARK_BUDGET_REASON as BUDGET, PRIVATE_BENCHMARK_LIMITS as LIMITS,
  PRIVATE_BENCHMARK_REASON as PRIVATE, privateBenchmarkProblem,
} from "../scripts/private-benchmark-policy.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";

const schemas = ["chant-benchmark-input/v1", "chant-benchmark-pack/v1", "chant-benchmark-identity/v1", "chant-benchmark-run/v1",
  "chant-human-alignment/v1", "chant-human-retiming/v2", "chant-human-dataset/v1", "chant-listening-review/v1", "chant-listening-ratings/v2"];
const escaped = '{"sch\\u0065ma":"chant-\\u0068uman-alignment\\/v1","sentinel":"synthetic-only-private-marker"}';
const privateFinding = (path, index = false) => `${path}${index ? " (index)" : ""}: ${PRIVATE}`;

test("all private schema families reject literal, escaped-key and escaped-value data on reviewed paths", () => {
  const paths = ["trope/synthetic.json", "tests/fixtures/trope/synthetic.json", "tests/fixtures/portal/synthetic.json",
    "public/fonts/noto-serif-hebrew/OFL.txt", "public/fonts/bricolage-grotesque/OFL.txt", "package.json", ".impeccable/config.json"];
  for (const schema of schemas) {
    const plain = JSON.stringify({ schema });
    const key = plain.replace('"schema"', '"sch\\u0065ma"');
    const value = plain.replace("chant-", "ch\\u0061nt-").replace("/", "\\/");
    for (const path of paths) for (const payload of [plain, key, value]) {
      assert.ok(entryProblems(path, payload).includes(PRIVATE), "private marker must override data path allowances");
    }
  }
});

test("decoded traversal covers nested records, arrays and all reviewed data extensions", () => {
  for (const extension of ["json", "jsonl", "ndjson", "csv", "tsv", "txt"]) {
    for (const payload of [escaped, `[0,{"nested":[${escaped}]}]`, `{"outer":{"inner":${escaped}}}`,
      `{"public":true}\n${escaped}\n{"public":false}`, `bad synthetic line\r\n${escaped}\r\n`]) {
      assert.ok(entryProblems(`trope/synthetic.${extension}`, payload).includes(PRIVATE));
    }
  }
});

test("whole raw JSON under source extensions is recognized without treating source declarations as data", () => {
  for (const extension of ["js", "mjs", "cjs", "ts", "tsx"]) {
    const path = `trope/synthetic.${extension}`;
    for (const payload of [escaped, `[${escaped}]`, ` \r\n${escaped}\t`]) assert.ok(entryProblems(path, payload).includes(PRIVATE));
    for (const source of [
      'export const SCHEMA = "chant-human-alignment/v1";',
      'const fixture = {"schema":"chant-human-alignment/v1"};',
      `import assert from "node:assert/strict"; assert.equal(JSON.parse(${JSON.stringify(escaped)}).schema, "chant-human-alignment/v1");`,
      `// Synthetic policy regression\nconst data = ${JSON.stringify(escaped)};`,
      '{"schema":"chant-human-alignment/v1"};',
    ]) assert.deepEqual(entryProblems(path, source), []);
  }
});

test("inherited malformed literal detection remains data-only and fixed diagnostics never echo contents", () => {
  const malformed = '{"schema":"chant-human-alignment/v1", synthetic unfinished';
  assert.ok(entryProblems("trope/synthetic.json", malformed).includes(PRIVATE));
  assert.deepEqual(entryProblems("trope/synthetic.mjs", malformed), []);
  assert.equal(privateBenchmarkProblem(escaped, true), PRIVATE);
  assert.ok(!entryProblems("trope/synthetic.json", escaped).join(" ").includes("synthetic-only-private-marker"));
});

test("leading BOM framing is inspected in whole JSON and individual line records without changing content values", () => {
  for (const path of ["trope/synthetic.json", "tests/fixtures/trope/synthetic.json", "tests/fixtures/portal/synthetic.ndjson", "trope/synthetic.mjs",
    "public/fonts/noto-serif-hebrew/OFL.txt", "public/fonts/bricolage-grotesque/OFL.txt"]) {
    assert.ok(entryProblems(path, "\uFEFF" + escaped).includes(PRIVATE));
  }
  for (const payload of ["{}\n\uFEFF" + escaped, "\uFEFF{}\r\n\uFEFF" + escaped]) {
    assert.equal(privateBenchmarkProblem(payload, true), PRIVATE);
  }
  for (const source of ["\uFEFFexport const SCHEMA = 'chant-human-alignment/v1';", "\uFEFFconst fixture = " + JSON.stringify(escaped) + ";"]) {
    assert.deepEqual(entryProblems("trope/synthetic.mjs", source), []);
  }
  for (const value of [{ schema: "\uFEFFchant-human-alignment/v1" }, { text: "\uFEFF", public: true }, { text: "prefix\uFEFFsuffix" }]) {
    const payload = JSON.stringify(value);
    assert.equal(privateBenchmarkProblem(payload, true), null);
    assert.equal(privateBenchmarkProblem("\uFEFF" + payload, true), null);
  }
});

test("public schema mentions, ordinary JSON and strings with JSON-looking contents remain public", () => {
  for (const value of [
    { schema: "chant-benchmark-public/v1" }, { schema: "chant-human/v1" }, { schema: "prefix-chant-human-alignment/v1" },
    { schema: 1 }, { schema: null }, { Schema: schemas[0] }, { documentation: schemas },
    ["public", { value: JSON.stringify({ schema: schemas[0] }) }],
    { brackets: "[[[[", quotes: '\\"[[[[', prototype: { "__proto__": "synthetic" } },
  ]) assert.equal(privateBenchmarkProblem(JSON.stringify(value), true), null);
});

test("byte budget accepts its exact boundary and fails closed one byte over, including UTF-8", () => {
  const prefix = '{"public":"', suffix = '"}';
  const exact = prefix + "a".repeat(LIMITS.maxBytes - Buffer.byteLength(prefix + suffix)) + suffix;
  assert.equal(Buffer.byteLength(exact), LIMITS.maxBytes);
  assert.equal(privateBenchmarkProblem(exact, true), null);
  assert.equal(privateBenchmarkProblem(exact.replace('"}', 'a"}'), true), BUDGET);
  const unicode = prefix + "א".repeat(LIMITS.maxBytes / 2) + suffix;
  assert.equal(privateBenchmarkProblem(unicode, true), BUDGET);
  // Whitespace filler avoids exercising the unrelated inherited email regex's
  // long-unbroken-token performance while checking this boundary end to end.
  const dataLikeOver = '{"public":"' + " ".repeat(LIMITS.maxBytes) + '"}';
  assert.ok(entryProblems("trope/renamed.ts", dataLikeOver).includes(BUDGET));
  assert.equal(privateBenchmarkProblem("export const publicText = " + JSON.stringify(exact) + ";", false), null);
});

test("depth budget accepts exact boundary and fails closed on over-budget escaped markers", () => {
  const wrap = (depth, content = "0") => "[".repeat(depth) + content + "]".repeat(depth);
  assert.equal(privateBenchmarkProblem(wrap(LIMITS.maxDepth), true), null);
  assert.equal(privateBenchmarkProblem(wrap(LIMITS.maxDepth + 1), true), BUDGET);
  assert.equal(privateBenchmarkProblem(wrap(LIMITS.maxDepth, escaped), true), BUDGET);
  assert.equal(privateBenchmarkProblem(JSON.stringify({ text: "[".repeat(LIMITS.maxDepth + 1) }), true), null);
  assert.equal(privateBenchmarkProblem(JSON.stringify({ text: '\\"' + "[".repeat(LIMITS.maxDepth + 1) }), true), null);
});

test("BOM byte budget includes the original three UTF-8 bytes at and over the boundary", () => {
  const framing = '\uFEFF{"public":"', suffix = '"}';
  const exact = framing + " ".repeat(LIMITS.maxBytes - Buffer.byteLength(framing + suffix)) + suffix;
  assert.equal(Buffer.byteLength(exact), LIMITS.maxBytes);
  assert.equal(privateBenchmarkProblem(exact, true), null);
  assert.equal(privateBenchmarkProblem(exact, false), null);
  const over = exact.replace('"}', ' "}');
  assert.equal(Buffer.byteLength(over), LIMITS.maxBytes + 1);
  assert.equal(privateBenchmarkProblem(over, true), BUDGET);
  assert.equal(privateBenchmarkProblem(over, false), BUDGET);
});

test("node budget accepts exact boundary and is cumulative across line records", () => {
  const exact = JSON.stringify(Array(LIMITS.maxNodes - 1).fill(0));
  assert.equal(privateBenchmarkProblem(exact, true), null);
  assert.equal(privateBenchmarkProblem(JSON.stringify(Array(LIMITS.maxNodes).fill(0)), true), BUDGET);
  assert.equal(privateBenchmarkProblem("0\n".repeat(LIMITS.maxNodes), true), null);
  assert.equal(privateBenchmarkProblem("0\n".repeat(LIMITS.maxNodes + 1), true), BUDGET);
  assert.equal(privateBenchmarkProblem(exact + "\n" + escaped, true), BUDGET);
});

test("actual public configuration and JSON fixtures remain compatible with private schema protection", async () => {
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", ".impeccable/config.json"]) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.equal(privateBenchmarkProblem(text, true), null, "public configuration must remain admitted");
    assert.deepEqual(entryProblems(path, text), []);
  }
  let count = 0;
  async function fixtures(directory) {
    for (const entry of await readdir(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await fixtures(path);
      else if (/\.(?:json|jsonl|ndjson)$/.test(entry.name)) {
        const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
        assert.equal(privateBenchmarkProblem(text, true), null, "existing public fixture must remain admitted");
        count++;
      }
    }
  }
  await fixtures("tests/fixtures");
  assert.ok(count > 0);
});

test("candidate and index content reject private records independently in both staged directions and after removal", async () => {
  const { env, cleanup } = await isolatedEnv();
  const root = await mkdtemp(join(tmpdir(), "portal-private-benchmark-policy-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, env, stdio: "pipe", windowsHide: true });
  const paths = ["trope/synthetic.json", "tests/fixtures/trope/synthetic.jsonl", "tests/fixtures/portal/synthetic.ndjson", "trope/synthetic.ts",
    "public/fonts/noto-serif-hebrew/OFL.txt", "public/fonts/bricolage-grotesque/OFL.txt"];
  async function put(path, text) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), text); }
  try {
    git("init", "-b", "main");
    for (const path of paths) await put(path, "{}\n");
    git("add", ".");
    for (const path of paths) await put(path, path.endsWith(".jsonl") ? "{}\n\uFEFF" + escaped : "\uFEFF" + escaped);
    const candidate = await inspectRepository(root, env);
    for (const path of paths) {
      assert.ok(candidate.findings.includes(privateFinding(path)));
      assert.ok(!candidate.findings.includes(privateFinding(path, true)));
    }
    git("add", ".");
    for (const path of paths) await put(path, "{}\n");
    const indexed = await inspectRepository(root, env);
    for (const path of paths) {
      assert.ok(indexed.findings.includes(privateFinding(path, true)));
      assert.ok(!indexed.findings.includes(privateFinding(path)));
      await rm(join(root, path));
    }
    const indexOnly = await inspectRepository(root, env);
    for (const path of paths) assert.ok(indexOnly.findings.includes(privateFinding(path, true)));
    for (const result of [candidate, indexed, indexOnly]) assert.ok(!JSON.stringify(result).includes("synthetic-only-private-marker"));
  } finally { await rm(root, { recursive: true, force: true }); await cleanup(); }
});
