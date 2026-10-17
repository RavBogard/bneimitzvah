// Synthetic tests only: invented letter strings, invented times, no source text, audio or real index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import {
  INDEX_SCHEMA, REVIEW_STATES, validateIndex, crosswalkWords, applyOverride, buildVerseDto,
  parseVerseRef, parseRangeRef, indexWordsDigestInput, portalWordsDigestInput,
} from "../scripts/reference-index-contract.mjs";
import { measure, parseArgs, expectedKeys, verseCountsFrom } from "../scripts/reference-index-check.mjs";

const MAQAF = "\u05BE", SOF = "\u05C3", PASEQ = "\u05C0", CGJ = "\u034F";
const REVIEW = Object.keys(REVIEW_STATES)[0];
const ASSET = { approved: true, assetId: "ra_" + "0123456789abcdef".repeat(2) };
const sha = s => createHash("sha256").update(s, "utf8").digest("hex");
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
const codes = result => result.errors.map(e => e.code);
// Portal reading text for the synthetic verses: the portal splits at maqaf, so words carry none.
const PORTAL = {
  "Genesis 1:1": { words: ["אבג", "דהו", "זחט"], readingText: "אבג דהו זחט" + SOF },
  "Genesis 1:2": { words: ["יכל", "מנס", "עפצ"], readingText: "יכל" + MAQAF + "מנס עפצ" + SOF },
  "Genesis 1:3": { words: ["קרש", "תאב"], readingText: "קרש תאב" + SOF },
};
const ready = ref => ({ status: "ready", ...PORTAL[ref] });

test("a well-formed synthetic index validates with no errors", () => {
  const r = validateIndex(index());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.recordings.size, 1);
});

test("an invalid envelope leaves no usable recordings", () => {
  for (const bad of [{ ...index(), schema: "other/v1" }, { ...index(), extra: 1 }, { ...index(), source: { x: 1 } }, { ...index(), schema: undefined }]) {
    const r = validateIndex(bad);
    assert.equal(r.ok, false);
    assert.equal(r.recordings.size, 0, JSON.stringify(r.errors));
    const m = measure(bad, { verses: PORTAL });
    assert.equal(m.summary.counts.verses, 0);
    assert.equal(m.summary.counts.playbackReady, 0);
    assert.equal(m.summary.counts.wordsReady, 0);
  }
  for (const bad of [null, [], "x", { schema: INDEX_SCHEMA, recordings: [] }, { schema: INDEX_SCHEMA, recordings: {} }]) assert.equal(validateIndex(bad).recordings.size, 0);
});

test("canonical refs: verse and range parsing reject anything ambiguous", () => {
  assert.deepEqual(parseVerseRef("II Kings 4:1"), { book: "II Kings", chapter: 4, verse: 1 });
  for (const bad of ["Gen 1:1", "Genesis 1:1 ", "Genesis 01:1", "Genesis 1:0", "Genesis 1", "Genesis 1:1-1:2", "III Kings 1:1", null]) assert.equal(parseVerseRef(bad), null, String(bad));
  assert.equal(parseRangeRef("Isaiah 6:1-7:6; Isaiah 9:5-9:6").length, 2);
  for (const bad of ["Isaiah 7:6-6:1", "Isaiah 6:1 - 7:6", "Isaiah 1:1-1:5; Isaiah 1:3-1:9", "Isaiah 1:1-1:5; Isaiah 1:1-1:5", "Isaiah 1:1-1:5; Jeremiah 2:1-2:2", "Isaiah 3:1-3:4; Isaiah 1:1-1:2; Isaiah 2:1-3:2"]) assert.equal(parseRangeRef(bad), null, bad);
  // A declared backward part (a real haftarah shape) parses and is marked.
  assert.deepEqual(parseRangeRef("Isaiah 3:1-3:4; Isaiah 1:1-1:2").map(p => p.back), [false, true]);
});

test("unknown fields and closed shapes are rejected", () => {
  const r = recording(); r.archiveUrl = "https://example.invalid/a.mp3";
  assert.ok(codes(validateIndex(index(r))).includes("unknown-field"));
  const v = recording(); v.verses[0].path = "x";
  assert.ok(codes(validateIndex(index(v))).includes("unknown-field"));
  const w = recording(); w.verses[0].words[0].end = 2;
  assert.ok(codes(validateIndex(index(w))).includes("unknown-field"));
  for (const part of [1, ["1"], "8"]) assert.ok(codes(validateIndex(index(recording({ part })))).includes("part"), JSON.stringify(part));
  assert.ok(codes(validateIndex(index(recording({ parsha: "Beta" })))).includes("parsha"));
});

test("hostile JSON never throws", () => {
  const evil = [recording({ part: { toString: 1 } }), recording({ part: [{ toString: 1 }] }), recording({ verses: [null, 5, "x"] }),
    recording({ verses: [{ ref: "Genesis 1:1", start: 1, end: 4, words: [{ he: { toString: 1 }, start: 1.1 }] }] }), recording({ ref: { toString: 1 } })];
  for (const r of evil) assert.doesNotThrow(() => validateIndex(index(r)));
  assert.doesNotThrow(() => crosswalkWords([{ toString: 1 }], "x", ["א"]));
  assert.doesNotThrow(() => measure(index(), { verses: { "Genesis 1:1": { status: "ready", words: ["אבג"] }, "Genesis 1:2": 5, ["__proto__"]: { status: "ready" } } }));
});

test("a duplicated identity excludes every copy", () => {
  const keys = validateIndex(index(recording(), recording({ archiveFile: "Other.mp3" })));
  assert.equal(keys.recordings.size, 0);
  assert.equal(codes(keys).filter(c => c === "duplicate-recording-key").length, 2);
  const files = validateIndex(index(recording(), recording({ key: "Beta-1", parsha: "Beta", archiveFile: "ALPHA-1.mp3" })));
  assert.equal(files.recordings.size, 0);
  assert.equal(codes(files).filter(c => c === "duplicate-archive-file").length, 2);
});

test("recording fields must be consistent", () => {
  assert.ok(codes(validateIndex(index(recording({ part: "2" })))).includes("key-part-mismatch"));
  assert.ok(codes(validateIndex(index(recording({ table: "haftarah" })))).includes("table"));
  assert.ok(codes(validateIndex(index(recording({ archiveFile: "../x.mp3" })))).includes("archive-file"));
  for (const seconds of [0, -1, Infinity, NaN, "30"]) assert.ok(codes(validateIndex(index(recording({ seconds })))).includes("recording-seconds"), String(seconds));
});

test("verses follow the declared range exactly: no gaps, no reordering, complete", () => {
  const dup = recording(); dup.verses[1].ref = "Genesis 1:1";
  assert.ok(codes(validateIndex(index(dup))).includes("duplicate-verse-ref"));
  const late = recording(); late.verses.shift();
  assert.ok(codes(validateIndex(index(late))).includes("first-verse-not-range-start"));
  const short = recording(); short.verses.pop();
  assert.ok(codes(validateIndex(index(short))).includes("recording-incomplete"));
  const skip = recording({ ref: "Genesis 1:1-1:5" }); skip.verses[2].ref = "Genesis 1:5";
  assert.ok(codes(validateIndex(index(skip))).includes("verse-order"));
  const beyond = recording({ ref: "Genesis 1:1-1:2" });
  assert.ok(codes(validateIndex(index(beyond))).includes("verse-outside-recording-ref"));
  const book = recording(); book.verses[2].ref = "Exodus 1:3";
  assert.ok(codes(validateIndex(index(book))).includes("verse-outside-recording-ref"));
  const bad = recording(); bad.verses[0].ref = "Gen 1:1";
  assert.ok(codes(validateIndex(index(bad))).includes("verse-ref"));
});

test("a chapter change is allowed only where verse counts show the chapter ended", () => {
  const cross = recording({ ref: "Genesis 1:2-2:1" });
  cross.verses = [{ ...cross.verses[0], ref: "Genesis 1:2" }, { ...cross.verses[1], ref: "Genesis 1:3" }, { ...cross.verses[2], ref: "Genesis 2:1" }];
  assert.ok(codes(validateIndex(index(cross))).includes("chapter-end-unverified"));
  assert.equal(validateIndex(index(cross), { verseCounts: { Genesis: [3, 9] } }).ok, true);
  assert.ok(codes(validateIndex(index(cross), { verseCounts: { Genesis: [5, 9] } })).includes("verse-skipped"));
  assert.deepEqual(verseCountsFrom({ verses: { "Genesis 1:1": {}, "Genesis 1:3": {}, "Genesis 2:2": {}, "junk": {} } }), { Genesis: [3, 2] });
});

test("split ranges: parts in their declared order, each complete, no jump from mid-part", () => {
  const split = recording({ key: "Beta-h", parsha: "Beta", part: "h", table: "haftarah", archiveFile: "Beta-h.mp3", ref: "Isaiah 1:1-1:2; Isaiah 3:4-3:4" });
  const at = refs => { const r = structuredClone(split); r.verses = r.verses.map((v, k) => ({ ...v, ref: refs[k] })); return r; };
  assert.equal(validateIndex(index(at(["Isaiah 1:1", "Isaiah 1:2", "Isaiah 3:4"]))).ok, true);
  // Jumping to the next part before finishing this one.
  assert.equal(validateIndex(index(at(["Isaiah 1:1", "Isaiah 3:4", "Isaiah 1:2"]))).ok, false);
  // A declared backward part is read in its declared order, and only that order.
  const back = at(["Isaiah 3:4", "Isaiah 1:1", "Isaiah 1:2"]); back.ref = "Isaiah 3:4-3:4; Isaiah 1:1-1:2";
  const ok = validateIndex(index(back));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.warnings, [{ code: "declared-backward-range-part", count: 1 }]);
  const undeclared = at(["Isaiah 1:1", "Isaiah 1:2", "Isaiah 3:4"]); undeclared.ref = "Isaiah 3:4-3:4; Isaiah 1:1-1:2";
  assert.ok(codes(validateIndex(index(undeclared))).includes("first-verse-not-range-start"));
  const overlapping = at(["Isaiah 1:1", "Isaiah 1:2", "Isaiah 3:4"]); overlapping.ref = "Isaiah 1:1-1:2; Isaiah 1:2-1:2";
  assert.ok(codes(validateIndex(index(overlapping))).includes("recording-ref"));
});

test("malformed, out-of-range and overlapping verse cuts are rejected, never clamped", () => {
  const cases = [
    [r => { r.verses[0].start = -0.001; }, "verse-cut-out-of-range"],
    [r => { r.verses[2].end = 31; }, "verse-cut-out-of-range"],
    [r => { r.verses[0].end = NaN; }, "verse-cut-out-of-range"],
    [r => { r.verses[0].end = "4"; }, "verse-cut-out-of-range"],
    [r => { r.verses[1].start = 3.5; }, "verse-overlap"],
    [r => { r.verses[2].end = 8.4; r.verses[2].words = words(["קרש"], 8.2); }, "verse-duration"],
  ];
  for (const [mutate, code] of cases) { const r = recording(); mutate(r); assert.ok(codes(validateIndex(index(r))).includes(code), code); }
});

test("word timings: strictly increasing, inside the verse, before its end; labels never drive highlighting", () => {
  const cases = [
    [r => { r.verses[0].words[1].start = Infinity; }, "word-start"],
    [r => { r.verses[0].words[2].start = 4.0; }, "word-outside-verse"],
    [r => { r.verses[0].words[0].start = 0.999; }, "word-outside-verse"],
    [r => { r.verses[0].words[1].start = r.verses[0].words[0].start; }, "word-order"],
    [r => { r.verses[0].words[2].start = 1.2; }, "word-order"],
    [r => { r.verses[0].words[0].label = 1.0; }, "label-without-match"],
    [r => { r.wordLabelsMatched = true; r.verses[0].words[0].label = 99; }, "word-label"],
    [r => { r.verses[0].words = []; }, "words"],
  ];
  for (const [mutate, code] of cases) { const r = recording(); mutate(r); assert.ok(codes(validateIndex(index(r))).includes(code), code); }
  const labelled = recording({ wordLabelsMatched: true });
  for (const v of labelled.verses) for (const w of v.words) w.label = Math.max(0, w.start - 0.4);
  assert.equal(validateIndex(index(labelled)).ok, true);
  const dto = buildVerseDto({ recording: labelled, verse: labelled.verses[0], asset: ASSET, portal: ready("Genesis 1:1") });
  assert.deepEqual(dto.words.starts, labelled.verses[0].words.map(w => w.start));
});

test("word text must be clean NFC Hebrew", () => {
  for (const he of ["", "abc", "\u05D0abc", "\u05D0\u05D1 \u05D2", "\u05D0\u05D1\u202E\u05D2", "\u05D0\u05D1\u200F\u05D2", "\u05D1\u05BC\u05B8", MAQAF, 5]) {
    const r = recording(); r.verses[0].words[0].he = he;
    assert.ok(codes(validateIndex(index(r))).includes("word-text"), JSON.stringify(he));
  }
});

test("review states: only declared ones are accepted, and they mark playback needs-review", () => {
  for (const review of ["looks odd", null, 5, "__proto__"]) { const r = recording(); r.verses[0].review = review; assert.ok(codes(validateIndex(index(r))).includes("review-state")); }
  const ok = recording(); ok.verses[0].review = REVIEW;
  assert.equal(validateIndex(index(ok)).ok, true);
  const dto = buildVerseDto({ recording: ok, verse: ok.verses[0], asset: ASSET, portal: ready("Genesis 1:1") });
  assert.deepEqual([dto.playback.status, dto.playback.review], ["needs-review", "start-moved"]);
});

test("an invalid recording is excluded whole while valid ones remain under a valid envelope", () => {
  const bad = recording({ key: "Beta-1", parsha: "Beta", archiveFile: "Beta-1.mp3" }); bad.verses[1].start = 2;
  const r = validateIndex(index(recording(), bad));
  assert.equal(r.ok, false);
  assert.deepEqual([...r.recordings.keys()], ["Alpha-1"]);
  assert.ok(r.errors.every(e => e.at.startsWith("Beta-1")));
});

test("crosswalk: one-to-one; an index word may add only one trailing maqaf, paseq or sof pasuq", () => {
  assert.deepEqual(crosswalkWords(PORTAL["Genesis 1:1"].words, PORTAL["Genesis 1:1"].readingText, ["אבג", "דהו", "זחט" + SOF]), { status: "exact" });
  assert.deepEqual(crosswalkWords(["אבג", "דהו"], "אבג " + PASEQ + " דהו", ["אבג" + PASEQ, "דהו"]), { status: "exact" });
  assert.deepEqual(crosswalkWords(["א" + CGJ + "בג"], "א" + CGJ + "בג", ["אבג"]), { status: "exact" });
  assert.equal(crosswalkWords(["אבג"], "אבג", ["א" + SOF + "בג"]).reason, "text-mismatch");
  assert.equal(crosswalkWords(["אבג"], "אבג", ["אבג" + SOF + SOF]).reason, "text-mismatch");
});

test("crosswalk: maqaf must stand exactly where the portal text has it", () => {
  const text = "יכל" + MAQAF + "מנס עפצ";
  assert.deepEqual(crosswalkWords(["יכל", "מנס", "עפצ"], text, ["יכל" + MAQAF, "מנס", "עפצ"]), { status: "exact" });
  assert.equal(crosswalkWords(["יכל", "מנס", "עפצ"], text, ["יכל", "מנס", "עפצ"]).reason, "maqaf-mismatch");
  assert.equal(crosswalkWords(["יכל", "מנס", "עפצ"], text, ["יכל" + MAQAF, "מנס" + MAQAF, "עפצ"]).reason, "maqaf-mismatch");
  assert.equal(crosswalkWords(["יכל"], "יכל", ["יכל" + MAQAF]).reason, "maqaf-mismatch");
  // A portal word containing a maqaf (a tokenizer change) is never grouped.
  assert.equal(crosswalkWords(["יכל" + MAQAF + "מנס"], "יכל" + MAQAF + "מנס", ["יכל" + MAQAF, "מנס"]).reason, "word-count-mismatch");
  assert.equal(crosswalkWords(["יכל" + MAQAF + "מנס"], "יכל" + MAQAF + "מנס", ["יכלמנס"]).reason, "portal-word-punctuation");
});

test("crosswalk: qere/ketiv, letter, vowel, count and text-binding differences are unavailable, never shifted", () => {
  assert.equal(crosswalkWords(["אבג", "דוה"], "אבג דוה", ["אבג", "דהו"]).reason, "text-mismatch");
  assert.equal(crosswalkWords(["אבג", "דהו"], "אבג דהו", ["אבג", "ד\u05B8הו"]).reason, "text-mismatch");
  assert.equal(crosswalkWords(["אבג", "דהו"], "אבג דהו", ["אבג"]).reason, "word-count-mismatch");
  assert.equal(crosswalkWords(["אבגדהו"], "אבגדהו", ["אבג", "דהו"]).reason, "word-count-mismatch");
  assert.equal(crosswalkWords(["אבג", "דהו"], "אבג זחט דהו", ["אבג", "דהו"]).reason, "text-binding-mismatch");
  assert.equal(crosswalkWords(["אבג", "דהו"], "דהו אבג", ["אבג", "דהו"]).reason, "text-binding-mismatch");
  assert.equal(crosswalkWords(["אבג"], undefined, ["אבג"]).reason, "text-binding-missing");
  assert.equal(crosswalkWords([], "", ["א"]).reason, "no-words");
  assert.equal(crosswalkWords([""], "", ["א"]).reason, "empty-word");
});

test("overrides bind to exact texts, a real review date, and complete ordered groups", () => {
  const bind = { readingTextSha256: "a".repeat(64), portalWordsSha256: "e".repeat(64), indexWordsSha256: "b".repeat(64), portalCount: 2, indexCount: 3 };
  const good = { readingTextSha256: "a".repeat(64), portalWordsSha256: "e".repeat(64), indexWordsSha256: "b".repeat(64), groups: [[0], [1, 2]], reviewedBy: "reviewer", reviewedAt: "2026-10-17" };
  assert.deepEqual(applyOverride(good, bind), { status: "exact", groups: [[0], [1, 2]] });
  for (const k of ["readingTextSha256", "portalWordsSha256", "indexWordsSha256"]) assert.equal(applyOverride({ ...good, [k]: "c".repeat(64) }, bind).reason, "override-stale", k);
  for (const reviewedAt of ["2026-99-99", "2026-10-17junk", "2026-02-30", 20261017]) assert.equal(applyOverride({ ...good, reviewedAt }, bind).reason, "override-unreviewed", String(reviewedAt));
  assert.equal(applyOverride({ ...good, reviewedBy: " " }, bind).reason, "override-unreviewed");
  for (const groups of [[[0], [2, 1]], [[0], [1]], [[0, 1, 2]], [[0], []]]) assert.equal(applyOverride({ ...good, groups }, bind).reason, "override-shape");
  // Through the DTO the hashes are computed from the texts, so an override must match them exactly.
  const r = recording({ ref: "Genesis 1:1-1:1" }); r.verses = [r.verses[0]];
  const portal = { status: "ready", words: ["אבג", "דהוזחט"], readingText: "אבג דהוזחט" + SOF };
  const bound = { ...good, readingTextSha256: sha(portal.readingText), portalWordsSha256: sha(portalWordsDigestInput(portal.words)), indexWordsSha256: sha(indexWordsDigestInput(r.verses[0])) };
  const dto = buildVerseDto({ recording: r, verse: r.verses[0], asset: ASSET, portal, override: bound });
  assert.deepEqual(dto.words.starts, [1.1, 1.6]);
  const stale = buildVerseDto({ recording: r, verse: r.verses[0], asset: ASSET, portal: { ...portal, readingText: portal.readingText + " " }, override: bound });
  assert.equal(stale.words.status, "unavailable");
});

test("DTO: ready highlighting always carries a canonical hash of the reading text it was mapped against", () => {
  const r = recording();
  const dto = buildVerseDto({ recording: r, verse: r.verses[1], asset: ASSET, portal: ready("Genesis 1:2") });
  assert.deepEqual(Object.keys(dto).sort(), ["attribution", "playback", "ref", "schema", "table", "words"]);
  assert.deepEqual(dto.playback, { status: "ready", asset: ASSET.assetId, clip: { start: 4.2, end: 8 } });
  assert.deepEqual(dto.words, { status: "ready", readingTextSha256: sha(PORTAL["Genesis 1:2"].readingText), starts: [4.4, 4.9, 5.4] });
  assert.match(dto.words.readingTextSha256, /^[0-9a-f]{64}$/);
  // Missing or caller-supplied bindings disable highlighting but keep playback; nothing supplied is reflected.
  for (const portal of [{ status: "ready", words: PORTAL["Genesis 1:2"].words }, { status: "ready", words: PORTAL["Genesis 1:2"].words, readingText: "" },
    { status: "ready", words: PORTAL["Genesis 1:2"].words, readingTextSha256: "C:/private/x" }]) {
    const d = buildVerseDto({ recording: r, verse: r.verses[1], asset: ASSET, portal });
    assert.deepEqual(d.words, { status: "unavailable", reason: "text-binding-missing" });
    assert.equal(d.playback.status, "ready");
    assert.ok(!JSON.stringify(d).includes("private"));
  }
});

test("DTO: nothing private reaches the client; a text mismatch holds playback for review", () => {
  const r = recording();
  const asset = { ...ASSET, archiveFile: r.archiveFile, path: "C:/private/x.mp3" };
  const text = JSON.stringify(buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: ready("Genesis 1:2") }));
  for (const leak of ["mp3", "private", "archive", "http://", "Alpha", "alignScore", "label", "Onset", "אבג", "יכל"]) assert.ok(!text.includes(leak), leak);
  const noText = buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: { status: "unavailable" } });
  assert.deepEqual([noText.playback.status, noText.words.reason], ["ready", "portal-text-unavailable"]);
  const mismatch = buildVerseDto({ recording: r, verse: r.verses[1], asset, portal: { status: "ready", words: ["יכל", "מנס", "עפק"], readingText: "יכל" + MAQAF + "מנס עפק" } });
  assert.deepEqual([mismatch.playback.status, mismatch.playback.review, mismatch.words.reason], ["needs-review", "text-mismatch", "text-mismatch"]);
});

test("DTO: without an approved opaque asset id there is no playback", () => {
  const r = recording();
  for (const asset of [null, { ...ASSET, approved: false }, { approved: true, assetId: "Alpha-1.mp3" }, { approved: true, assetId: "ra_alpha1mp3genesis1" },
    { approved: true, assetId: "ra_" + "A".repeat(32) }, { approved: true, assetId: "https://example.invalid/a" }]) {
    const dto = buildVerseDto({ recording: r, verse: r.verses[0], asset, portal: ready("Genesis 1:1") });
    assert.deepEqual(dto.playback, { status: "unavailable", reason: "asset-not-approved" });
    assert.equal(dto.words.status, "unavailable");
  }
});

test("measurement reports aggregates and coverage gaps against the reading table", () => {
  const portal = { verses: { "Genesis 1:1": ready("Genesis 1:1"), "Genesis 1:2": ready("Genesis 1:2"), "Genesis 1:3": { status: "unavailable:normalize" } } };
  const aliyah = { parshiot: { parsha: [{ _id: "Alpha", fullkriyah: { aliyah: [{ _num: "1" }, { _num: "2" }, { _num: "M" }] }, _haftara: "Isaiah 1:1 - 1:2" }] } };
  assert.deepEqual(expectedKeys(aliyah), ["Alpha-1", "Alpha-2", "Alpha-h"]);
  const { summary, detail } = measure(index(), portal, aliyah);
  assert.equal(summary.ok, true);
  assert.equal(summary.counts.verses, 3);
  assert.equal(summary.counts.wordsReady, 2);
  assert.deepEqual(summary.counts.wordsUnavailable, { "portal-text-unavailable": 1 });
  assert.deepEqual(summary.coverage, { expected: 3, present: 1, missing: 2, missingDeclared: 0 });
  assert.ok(!JSON.stringify(summary).includes("Genesis"));
  assert.ok(detail.some(d => d.ref === "Genesis 1:1" && d.indexWordsSha256.length === 64));
});

test("CLI refuses inputs or output inside a Git working tree and prints only a code", async () => {
  assert.throws(() => parseArgs(["--index"]), /usage/);
  assert.throws(() => parseArgs(["--index", "a", "--portal-words", "b"]), /usage/);
  assert.throws(() => parseArgs(["--index", "a", "--index", "b", "--portal-words", "c", "--out", "d"]), /usage/);
  const script = fileURLToPath(new URL("../scripts/reference-index-check.mjs", import.meta.url));
  const inside = fileURLToPath(new URL("../package.json", import.meta.url));
  const outside = await mkdtemp(join(tmpdir(), "ref-index-"));
  const { env, cleanup } = await isolatedEnv();
  try {
    await writeFile(join(outside, "i.json"), JSON.stringify(index()));
    await writeFile(join(outside, "p.json"), JSON.stringify({ verses: Object.fromEntries(Object.entries(PORTAL).map(([k, v]) => [k, { status: "ready", ...v }])) }));
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
    const refused = run(["--index", inside, "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(refused.status, 2);
    assert.equal(refused.stderr.trim(), "reference-index-check: path-inside-git-working-tree");
    assert.ok(!refused.stdout.includes(outside) && !refused.stderr.includes(outside));
    const ok = run(["--index", join(outside, "i.json"), "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(ok.status, 0, ok.stderr);
    const summary = JSON.parse(ok.stdout);
    assert.equal(summary.counts.verses, 3);
    assert.equal(summary.counts.wordsReady, 3);
    assert.ok(!ok.stdout.includes("Genesis") && !ok.stdout.includes(outside) && !/[\u05D0-\u05EA]/u.test(ok.stdout));
    const unreadable = run(["--index", join(outside, "missing.json"), "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(unreadable.stderr.trim(), "reference-index-check: index-unreadable");
    await writeFile(join(outside, "bad.json"), JSON.stringify({ ...index(), schema: "x" }));
    const invalid = run(["--index", join(outside, "bad.json"), "--portal-words", join(outside, "p.json"), "--out", join(outside, "out")]);
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stdout).counts.verses, 0);
  } finally { await cleanup(); await rm(outside, { recursive: true, force: true }); }
});
