// Synthetic tests only: invented letter strings, invented times, no source text, audio or real index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import {
  INDEX_SCHEMA, ATTRIBUTION, REVIEW_STATES, validateIndex, crosswalkWords, applyOverride, buildVerseDto,
  comparisonKey, parseVerseRef, parseRangeRef, indexWordsDigestInput,
} from "../scripts/reference-index-contract.mjs";
import { measure, parseArgs, expectedKeys } from "../scripts/reference-index-check.mjs";

const MAQAF = "\u05BE", SOF = "\u05C3", PASEQ = "\u05C0";
const REVIEW = Object.keys(REVIEW_STATES)[0];
const words = (list, t0 = 1.1, step = 0.5) => list.map((he, k) => ({ he, start: +(t0 + k * step).toFixed(3) }));
function recording(over = {}) {
  return {
    key: "Alpha-1", parsha: "Alpha", part: "1", table: "torah", ref: "Genesis 1:1-1:3", archiveFile: "Alpha-1.mp3",
    seconds: 30, wordLabelsMatched: false,
    verses: [
      { ref: "Genesis 1:1", start: 1.0, end: 4.0, words: words(["אבג", "דהו", "זחט" + SOF]), alignScore: 0.6, startVsSoundOnsetMs: 20, labelGapMedianMs: null },
      { ref: "Genesis 1:2", start: 4.2, end: 8.0, words: words(["יכל" + MAQAF, "מנס", "עפצ" + SOF], 4.4) },
      { ref: "Genesis 1:3", start: 8.1, end: 12.0, words: words(["קרש", "תאב" + SOF], 8.3) },
    ],
    ...over,
  };
}
const index = (...recs) => ({ schema: INDEX_SCHEMA, source: "synthetic", method: "synthetic", recordings: recs.length ? recs : [recording()] });
const clone = x => structuredClone(x);
const codes = result => result.errors.map(e => e.code);

test("a well-formed synthetic index validates with no errors", () => {
  const r = validateIndex(index());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.recordings.size, 1);
});

test("canonical refs: verse and range parsing reject anything ambiguous", () => {
  assert.deepEqual(parseVerseRef("II Kings 4:1"), { book: "II Kings", chapter: 4, verse: 1 });
  for (const bad of ["Gen 1:1", "Genesis 1:1 ", "Genesis 01:1", "Genesis 1:0", "Genesis 1", "Genesis 1:1-1:2", "III Kings 1:1", null]) assert.equal(parseVerseRef(bad), null, String(bad));
  assert.equal(parseRangeRef("Isaiah 6:1-7:6; Isaiah 9:5-9:6").length, 2);
  assert.equal(parseRangeRef("Isaiah 7:6-6:1"), null);
  assert.equal(parseRangeRef("Isaiah 6:1 - 7:6"), null);
});

test("schema, unknown fields and closed shapes are rejected", () => {
  assert.ok(codes(validateIndex({ ...index(), schema: "other/v1" })).includes("schema"));
  assert.ok(codes(validateIndex({ ...index(), extra: 1 })).includes("unknown-field"));
  const r = recording(); r.archiveUrl = "https://example.invalid/a.mp3";
  assert.ok(codes(validateIndex(index(r))).includes("unknown-field"));
  const v = recording(); v.verses[0].path = "x";
  assert.ok(codes(validateIndex(index(v))).includes("unknown-field"));
  const w = recording(); w.verses[0].words[0].end = 2;
  assert.ok(codes(validateIndex(index(w))).includes("unknown-field"));
  assert.equal(validateIndex(null).ok, false);
  assert.equal(validateIndex({ schema: INDEX_SCHEMA, recordings: [] }).ok, false);
});

test("recording identity must be unique and consistent", () => {
  assert.ok(codes(validateIndex(index(recording(), recording({ archiveFile: "Other.mp3" })))).includes("duplicate-recording-key"));
  assert.ok(codes(validateIndex(index(recording(), recording({ key: "Beta-1", parsha: "Beta" })))).includes("duplicate-archive-file"));
  assert.ok(codes(validateIndex(index(recording({ part: "2" })))).includes("key-part-mismatch"));
  assert.ok(codes(validateIndex(index(recording({ table: "haftarah" })))).includes("table"));
  assert.ok(codes(validateIndex(index(recording({ archiveFile: "../x.mp3" })))).includes("archive-file"));
  for (const seconds of [0, -1, Infinity, NaN, "30"]) assert.ok(codes(validateIndex(index(recording({ seconds })))).includes("recording-seconds"), String(seconds));
});

test("verse identity: canonical, unique, inside the recording range and in reading order", () => {
  const dup = recording(); dup.verses[1].ref = "Genesis 1:1";
  assert.ok(codes(validateIndex(index(dup))).includes("duplicate-verse-ref"));
  const outside = recording({ ref: "Genesis 1:1-1:2" });
  assert.ok(codes(validateIndex(index(outside))).includes("verse-outside-recording-ref"));
  const skip = recording(); skip.verses[2].ref = "Genesis 1:5"; skip.ref = "Genesis 1:1-1:5";
  assert.ok(codes(validateIndex(index(skip))).includes("verse-order"));
  const late = recording({ ref: "Genesis 1:1-1:3" }); late.verses.shift();
  assert.ok(codes(validateIndex(index(late))).includes("first-verse-not-range-start"));
  const bad = recording(); bad.verses[0].ref = "Gen 1:1";
  assert.ok(codes(validateIndex(index(bad))).includes("verse-ref"));
  // A split haftarah range may jump to its second part, and only there.
  const split = recording({ key: "Beta-h", parsha: "Beta", part: "h", table: "haftarah", archiveFile: "Beta-h.mp3", ref: "Isaiah 1:1-1:2; Isaiah 3:4-3:4" });
  split.verses = [{ ...split.verses[0], ref: "Isaiah 1:1" }, { ...split.verses[1], ref: "Isaiah 1:2" }, { ...split.verses[2], ref: "Isaiah 3:4" }];
  assert.equal(validateIndex(index(split)).ok, true, JSON.stringify(validateIndex(index(split)).errors));
  split.verses[2].ref = "Isaiah 3:5"; split.ref = "Isaiah 1:1-1:2; Isaiah 3:4-3:5";
  assert.ok(codes(validateIndex(index(split))).includes("verse-order"));
});

test("malformed, out-of-range and overlapping verse cuts are rejected, never clamped", () => {
  const cases = [
    [r => { r.verses[0].start = -0.5; }, "verse-cut-out-of-range"],
    [r => { r.verses[2].end = 31; }, "verse-cut-out-of-range"],
    [r => { r.verses[0].end = NaN; }, "verse-cut-out-of-range"],
    [r => { r.verses[0].end = "4"; }, "verse-cut-out-of-range"],
    [r => { r.verses[1].start = 3.5; }, "verse-overlap"],
    [r => { r.verses[2].end = 8.3; r.verses[2].words = words(["קרש"], 8.2); }, "verse-duration"],
  ];
  for (const [mutate, code] of cases) { const r = recording(); mutate(r); assert.ok(codes(validateIndex(index(r))).includes(code), code); }
});

test("word timings: finite, inside the verse, in order; labels never drive highlighting", () => {
  const cases = [
    [r => { r.verses[0].words[1].start = Infinity; }, "word-start"],
    [r => { r.verses[0].words[2].start = 4.5; }, "word-outside-verse"],
    [r => { r.verses[0].words[0].start = 0.5; }, "word-outside-verse"],
    [r => { r.verses[0].words[2].start = 1.2; }, "word-order"],
    [r => { r.verses[0].words[0].label = 1.0; }, "label-without-match"],
    [r => { r.wordLabelsMatched = true; r.verses[0].words[0].label = 99; }, "word-label"],
    [r => { r.verses[0].words = []; }, "words"],
  ];
  for (const [mutate, code] of cases) { const r = recording(); mutate(r); assert.ok(codes(validateIndex(index(r))).includes(code), code); }
  const labelled = recording({ wordLabelsMatched: true });
  for (const v of labelled.verses) for (const w of v.words) w.label = Math.max(0, w.start - 0.4);
  assert.equal(validateIndex(index(labelled)).ok, true);
  const dto = buildVerseDto({ recording: labelled, verse: labelled.verses[0], asset: { approved: true, assetId: "ra_0123456789abcdef" }, portal: { status: "ready", words: ["אבג", "דהו", "זחט"] } });
  assert.deepEqual(dto.words.starts, labelled.verses[0].words.map(w => w.start));
});

test("word text must be clean NFC Hebrew", () => {
  for (const he of ["", "abc", "אב ג", "אב\u202Eג", "\u05D1\u05BC\u05B8", 5]) {
    const r = recording(); r.verses[0].words[0].he = he;
    assert.ok(codes(validateIndex(index(r))).includes("word-text"), JSON.stringify(he));
  }
});

test("review states: only declared ones are accepted, and they mark playback needs-review", () => {
  const r = recording(); r.verses[0].review = "looks odd";
  assert.ok(codes(validateIndex(index(r))).includes("review-state"));
  const ok = recording(); ok.verses[0].review = REVIEW;
  assert.equal(validateIndex(index(ok)).ok, true);
  const dto = buildVerseDto({ recording: ok, verse: ok.verses[0], asset: { approved: true, assetId: "ra_0123456789abcdef" }, portal: { status: "ready", words: ["אבג", "דהו", "זחט"] } });
  assert.equal(dto.playback.status, "needs-review");
  assert.equal(dto.playback.review, "start-moved");
});

test("an invalid recording is excluded whole while valid ones remain", () => {
  const bad = recording({ key: "Beta-1", parsha: "Beta", archiveFile: "Beta-1.mp3" }); bad.verses[1].start = 2;
  const r = validateIndex(index(recording(), bad));
  assert.equal(r.ok, false);
  assert.deepEqual([...r.recordings.keys()], ["Alpha-1"]);
  assert.ok(r.errors.every(e => e.at.startsWith("Beta-1")));
});

test("crosswalk: exact one-to-one after removing only sof pasuq, paseq, maqaf and CGJ", () => {
  assert.equal(comparisonKey("אב" + MAQAF), "אב");
  assert.equal(comparisonKey("אב" + PASEQ), "אב");
  const x = crosswalkWords(["אבג", "דהו", "זחט"], ["אבג", "דהו", "זחט" + SOF]);
  assert.deepEqual(x, { status: "exact", groups: [[0], [1], [2]] });
});

test("crosswalk: a maqaf compound the aligner split maps to its first part's start", () => {
  const x = crosswalkWords(["יכל" + MAQAF + "מנס", "עפצ"], ["יכל" + MAQAF, "מנס", "עפצ" + SOF]);
  assert.deepEqual(x, { status: "exact", groups: [[0, 1], [2]] });
});

test("crosswalk: qere/ketiv and any letter, vowel or accent difference is unavailable, never shifted", () => {
  // The portal reads the qere; an index that aligned the ketiv cannot be mapped.
  assert.equal(crosswalkWords(["אבג", "דוה"], ["אבג", "דהו"]).status, "unavailable");
  assert.equal(crosswalkWords(["אבג", "דהו"], ["אבג", "ד\u05B8הו"]).status, "unavailable");
  assert.equal(crosswalkWords(["אבג", "דהו", "זחט"], ["אבג", "זחט"]).reason, "text-mismatch");
  assert.equal(crosswalkWords(["אבג", "דהו"], ["אבג"]).reason, "index-words-exhausted");
  // Two index words separated by a space never merge into one portal word.
  assert.equal(crosswalkWords(["אבגדהו"], ["אבג", "דהו"]).status, "unavailable");
  assert.equal(crosswalkWords(["אבג"], ["אבג", "דהו"]).reason, "index-words-left-over");
  // One index word spanning two portal words would leave a portal word without its own start.
  assert.equal(crosswalkWords(["אבג", "דהו"], ["אבגדהו"]).status, "unavailable");
  assert.equal(crosswalkWords([], ["א"]).reason, "no-words");
  assert.equal(crosswalkWords([SOF], ["א"]).reason, "empty-word");
});

test("overrides bind to exact texts and must be reviewed and complete", () => {
  const bind = { readingTextSha256: "a".repeat(64), indexWordsSha256: "b".repeat(64), portalCount: 2, indexCount: 3 };
  const good = { readingTextSha256: "a".repeat(64), indexWordsSha256: "b".repeat(64), groups: [[0], [1, 2]], reviewedBy: "reviewer", reviewedAt: "2026-10-17" };
  assert.deepEqual(applyOverride(good, bind), { status: "exact", groups: [[0], [1, 2]] });
  assert.equal(applyOverride({ ...good, readingTextSha256: "c".repeat(64) }, bind).reason, "override-stale");
  assert.equal(applyOverride({ ...good, reviewedBy: "" }, bind).reason, "override-unreviewed");
  assert.equal(applyOverride({ ...good, groups: [[0], [2, 1]] }, bind).reason, "override-shape");
  assert.equal(applyOverride({ ...good, groups: [[0], [1]] }, bind).reason, "override-shape");
  assert.equal(applyOverride({ ...good, groups: [[0, 1, 2]] }, bind).reason, "override-shape");
  // An override is only consulted with both hashes present.
  const r = recording();
  const dto = buildVerseDto({ recording: r, verse: r.verses[2], asset: { approved: true, assetId: "ra_0123456789abcdef" }, portal: { status: "ready", words: ["קרשתאב"] }, override: good });
  assert.equal(dto.words.reason, "override-unbound");
});

test("DTO: playback and highlighting are separate; nothing private reaches the client", () => {
  const r = recording();
  const asset = { approved: true, assetId: "ra_0123456789abcdef", archiveFile: r.archiveFile, path: "C:/private/x.mp3" };
  const ready = buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: { status: "ready", words: ["יכל" + MAQAF + "מנס", "עפצ"], readingTextSha256: "d".repeat(64) } });
  assert.deepEqual(ready.playback, { status: "ready", asset: "ra_0123456789abcdef", clip: { start: 4.2, end: 8 } });
  assert.deepEqual(ready.words, { status: "ready", readingTextSha256: "d".repeat(64), starts: [4.4, 5.4] });
  assert.deepEqual(ready.attribution, ATTRIBUTION);
  const text = JSON.stringify(ready);
  for (const leak of ["mp3", "private", "archive", "http://", "Alpha", "alignScore", "label", "אבג", "יכל"]) assert.ok(!text.includes(leak), leak);
  const noText = buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: { status: "unavailable" } });
  assert.equal(noText.playback.status, "ready");
  assert.deepEqual(noText.words, { status: "unavailable", reason: "portal-text-unavailable" });
  const mismatch = buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: { status: "ready", words: ["יכל", "מנסעפצ"] } });
  assert.equal(mismatch.playback.status, "ready");
  assert.equal(mismatch.words.status, "unavailable");
});

test("DTO: without an approved opaque asset id there is no playback", () => {
  const r = recording();
  for (const asset of [null, { approved: false, assetId: "ra_0123456789abcdef" }, { approved: true, assetId: "Alpha-1.mp3" }, { approved: true, assetId: "https://example.invalid/a" }]) {
    const dto = buildVerseDto({ recording: r, verse: r.verses[0], asset, portal: { status: "ready", words: ["אבג", "דהו", "זחט"] } });
    assert.deepEqual(dto.playback, { status: "unavailable", reason: "asset-not-approved" });
    assert.equal(dto.words.status, "unavailable");
    assert.ok(!("clip" in dto.playback));
  }
});

test("measurement reports aggregates and coverage gaps against the reading table", () => {
  const portal = { verses: {
    "Genesis 1:1": { status: "ready", words: ["אבג", "דהו", "זחט"], readingText: "x" },
    "Genesis 1:2": { status: "ready", words: ["יכל" + MAQAF + "מנס", "עפצ"], readingText: "y" },
    "Genesis 1:3": { status: "unavailable:normalize" },
  } };
  const aliyah = { parshiot: { parsha: [{ _id: "Alpha", fullkriyah: { aliyah: [{ _num: "1" }, { _num: "2" }, { _num: "M" }] }, _haftara: "Isaiah 1:1 - 1:2" }] } };
  assert.deepEqual(expectedKeys(aliyah), ["Alpha-1", "Alpha-2", "Alpha-h"]);
  const { summary, detail } = measure(index(), portal, aliyah);
  assert.equal(summary.ok, true);
  assert.equal(summary.counts.verses, 3);
  assert.equal(summary.counts.wordsReady, 2);
  assert.equal(summary.counts.wordsReadyViaMaqafGroup, 1);
  assert.deepEqual(summary.counts.wordsUnavailable, { "portal-text-unavailable": 1 });
  assert.deepEqual(summary.coverage, { expected: 3, present: 1, missing: 2, missingDeclared: 0 });
  // Refs and hashes live only in the private detail, never the summary.
  assert.ok(!JSON.stringify(summary).includes("Genesis"));
  assert.ok(detail.some(d => d.ref === "Genesis 1:1" && d.indexWordsSha256.length === 64));
  assert.equal(indexWordsDigestInput(index().recordings[0].verses[0]), "אבג דהו זחט" + SOF);
});

test("CLI refuses inputs or output inside a Git working tree and prints only a code", async () => {
  assert.throws(() => parseArgs(["--index"]), /usage/);
  assert.throws(() => parseArgs(["--index", "a", "--portal-words", "b"]), /usage/);
  const script = fileURLToPath(new URL("../scripts/reference-index-check.mjs", import.meta.url));
  const inside = fileURLToPath(new URL("../package.json", import.meta.url));
  const outside = await mkdtemp(join(tmpdir(), "ref-index-"));
  const { env, cleanup } = await isolatedEnv();
  try {
    await writeFile(join(outside, "i.json"), JSON.stringify(index()));
    await writeFile(join(outside, "p.json"), JSON.stringify({ verses: {} }));
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
    const refused = run(["--index", inside, "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(refused.status, 2);
    assert.equal(refused.stderr.trim(), "reference-index-check: path-inside-git-working-tree");
    assert.ok(!refused.stdout.includes(outside) && !refused.stderr.includes(outside));
    const ok = run(["--index", join(outside, "i.json"), "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(ok.status, 0, ok.stderr);
    const summary = JSON.parse(ok.stdout);
    assert.equal(summary.counts.verses, 3);
    assert.ok(!ok.stdout.includes("Genesis") && !ok.stdout.includes(outside) && !/[\u05D0-\u05EA]/u.test(ok.stdout));
    const unreadable = run(["--index", join(outside, "missing.json"), "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(unreadable.stderr.trim(), "reference-index-check: index-unreadable");
  } finally { await cleanup(); await rm(outside, { recursive: true, force: true }); }
});
