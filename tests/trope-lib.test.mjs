import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lib = require("../trope/lib-trope.cjs");
const readFixture = name => JSON.parse(readFileSync(new URL(`./fixtures/trope/${name}`, import.meta.url), "utf8"));
const golden = readFixture("lib-trope-golden.json");

test("the standalone trope helpers match haftarah lib.js across every calibration and edge verse", () => {
  assert.deepEqual({ source: lib.TETRA.source, flags: lib.TETRA.flags }, golden.tetra);
  assert.deepEqual(lib.TROPE_FAMILIES, golden.families);
  const corpora = new Map();
  let expectedCases = 0;
  for (const { fixture, count, familiesUsed } of golden.corpora) {
    const { verses } = readFixture(fixture);
    assert.equal(verses.length, count, fixture);
    assert.deepEqual([...lib.tropeFamiliesUsed(verses)].sort(), familiesUsed, fixture);
    corpora.set(fixture, verses);
    expectedCases += verses.reduce((sum, v) => sum + (v.raw === undefined ? 2 : 4), 0);
  }
  assert.equal(golden.cases.length, expectedCases, "all raw/cleaned and final/non-final variants are present");
  const seen = new Set();
  for (const { fixture, index, ref, field, final, families, htmlSha256 } of golden.cases) {
    const key = `${fixture}:${index}:${field}:${final}`;
    assert.ok(!seen.has(key), `duplicate golden case ${key}`);
    seen.add(key);
    const verse = corpora.get(fixture)[index];
    assert.equal(verse.ref, ref, key);
    assert.deepEqual(lib.tropePhrases(verse[field], { final }).map(p => p.family), families, key);
    assert.equal(createHash("sha256").update(lib.tropeHtml(verse[field], { final })).digest("hex"), htmlSha256, key);
  }
});
