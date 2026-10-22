// Synthetic signals only: tone bursts, harmonic "vowels" and a low hum, generated here. No recording,
// index or private path is read. The refined boundaries must be derived from these signals, bounded by
// the window around each CTC onset, ordered, and the same on every run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { synth, burst } from "./helpers/synthetic-audio.mjs";
import { analyzeSignal, acousticEvents, nearestEvent, refineVerse, RULES } from "../scripts/reference-boundaries.mjs";
import { v2Verse, summarize, INDEX_V2_SCHEMA } from "../scripts/reference-boundary-refine.mjs";
import { validateIndex, WORD_MOVE_BOUNDS } from "../scripts/reference-index-contract.mjs";

/** Word facts as wordFacts() builds them from the aligner: consonant-initial, consonant-final by default. */
const word = (ctc, over = {}) => ({ ctc, startsWithVowel: false, firstPhone: "t", endsWithVowel: false, firstSyllableVowel: ctc + 0.05, firstSyllableEnd: ctc + 0.1, lastSyllableVowel: ctc + 0.05, lastSyllableEnd: ctc + 0.15, ...over });
const near = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol * 1000} ms of ${expected}`);

test("tone bursts after pauses: each start moves to the rise out of the floor minus 20 ms, each end to the fade-out", () => {
  const f = analyzeSignal(synth(3, [burst(0.5, 0.9), burst(1.3, 1.7), burst(2.1, 2.6)]));
  const events = acousticEvents(f);
  for (const t of [0.5, 1.3, 2.1]) near(nearestEvent(events.rises, t, 0.05, 0.05), t, 0.006, "rise");
  // CTC onsets 40 ms late inside each burst.
  const words = [word(0.54, { lastSyllableEnd: 0.8 }), word(1.34, { lastSyllableEnd: 1.6 }), word(2.14, { lastSyllableEnd: 2.5 })];
  const r = refineVerse({ clip: { start: 0.42, end: 2.8 }, words }, f);
  assert.equal(r.ok, true, r.reason);
  [0.48, 1.28, 2.08].forEach((t, j) => near(r.starts[j], t, 0.006, `start ${j}`));
  assert.deepEqual(r.log.map(e => e.rule), ["pause-rise", "pause-rise", "pause-rise"]);
  // Each word ends where its burst fades (plus the measured decay), well before the next onset.
  [0.9, 1.7].forEach((t, j) => { assert.ok(r.ends[j] >= t - 0.01 && r.ends[j] <= t + RULES.decayCapS, `end ${j}: ${r.ends[j]}`); assert.equal(r.log[j].endRule, "fade-decay"); });
  near(r.ends[2], 2.6, 0.05, "last end");
  // A CTC onset placed early, in the silence before the rise, moves forward to it.
  const early = refineVerse({ clip: { start: 0.42, end: 2.8 }, words: [word(0.54), word(1.26, { firstSyllableVowel: 1.32 }), word(2.14)] }, f);
  near(early.starts[1], 1.28, 0.006, "forward start");
  assert.equal(early.log[1].rule, "pause-rise");
  assert.ok(early.log[1].moveMs > 0);
});

test("a move the window does not allow is refused and logged, and the start keeps the CTC rule", () => {
  const f = analyzeSignal(synth(3, [burst(0.5, 0.9), burst(1.3, 1.9)]));
  // The CTC onset sits 200 ms into the second burst; its rise is 220 ms earlier than the window allows.
  const r = refineVerse({ clip: { start: 0.42, end: 2.5 }, words: [word(0.52), word(1.5, { firstSyllableVowel: 1.55 })] }, f);
  assert.equal(r.ok, true);
  assert.equal(r.log[1].rule, "onset-20ms");
  near(r.starts[1], 1.48, 0.0011, "kept CTC rule");
  assert.deepEqual(r.log[1].refused.map(x => x.rule), ["pause-rise"]);
  assert.ok(r.log[1].refused[0].wantedMs <= -(WORD_MOVE_BOUNDS.backS * 1000), JSON.stringify(r.log[1].refused));
  // A rise after the word's own first vowel is inside the word, and a later rise is refused when sound is already at the onset.
  const inside = refineVerse({ clip: { start: 0.42, end: 2.5 }, words: [word(0.52), word(1.26, { firstSyllableVowel: 1.27 })] }, f);
  assert.equal(inside.log[1].rule, "onset-20ms");
  assert.equal(inside.log[1].refused[0].why, "inside-word");
});

test("a vowel-to-vowel join with no pause is cut at the largest timbre change", () => {
  // Same loudness, same pitch, different spectral shape from 1.0 s: an "a" into an "u", joined without a gap.
  const a = { f0: 150, harmonics: [0.05, 0.08, 0.12, 0.15, 0.12, 0.08, 0.05, 0.03] }, u = { f0: 150, harmonics: [0.22, 0.12, 0.04, 0.02, 0.01, 0.01, 0.005, 0.005] };
  const f = analyzeSignal(synth(2.6, [{ from: 0.3, to: 1.005, ...a }, { from: 0.995, to: 2.0, ...u }]));
  const words = [word(0.3, { endsWithVowel: true, lastSyllableVowel: 0.5, lastSyllableEnd: 0.95 }), word(1.05, { startsWithVowel: true, firstPhone: "u", firstSyllableVowel: 1.05, firstSyllableEnd: 1.1 })];
  const r = refineVerse({ clip: { start: 0.22, end: 2.2 }, words }, f);
  assert.equal(r.ok, true);
  assert.equal(r.log[1].rule, "vowel-join");
  near(r.starts[1], 1.0, 0.011, "join");
  assert.equal(r.ends[0], r.starts[1], "a join leaves no gap");
});

test("before b, d, g, m or n a voiced closure moves the boundary back to where the hum starts", () => {
  const vowel = { f0: 150, harmonics: Array.from({ length: 16 }, () => 0.03) }, hum = { f0: 150, harmonics: [0.03, 0.02] };
  const f = analyzeSignal(synth(2.2, [{ from: 0.3, to: 1.005, ...vowel }, { from: 0.995, to: 1.085, ...hum }, { from: 1.075, to: 1.6, ...vowel }]));
  // CTC marks the m at its release (1.085 s), so the hum before it is counted as the end of the vowel.
  const words = [word(0.3, { endsWithVowel: true, lastSyllableVowel: 0.35, lastSyllableEnd: 0.6 }), word(1.09, { firstPhone: "m" })];
  const r = refineVerse({ clip: { start: 0.22, end: 1.8 }, words }, f);
  assert.equal(r.ok, true);
  assert.equal(r.log[1].rule, "voiced-closure");
  near(r.starts[1], 1.0, 0.011, "closure start");
  assert.ok(r.starts[1] >= 1.09 - WORD_MOVE_BOUNDS.backS - 1e-9);
});

test("monotonic and bounded on dense, irregular verses; the v2 index built from them passes the contract", () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const recordingVerses = [];
  for (let trial = 0; trial < 40; trial++) {
    const segs = [], ctc = [];
    let t = 0.3;
    for (let k = 0; k < 12; k++) {
      const len = 0.05 + rnd() * 0.4, gap = rnd() < 0.4 ? rnd() * 0.3 : 0;
      segs.push(burst(t, t + len, 0.05 + rnd() * 0.3));
      ctc.push(+(t + (rnd() - 0.5) * 0.2).toFixed(3));
      t += len + gap;
    }
    ctc.sort((a, b) => a - b);
    for (let k = 1; k < ctc.length; k++) if (ctc[k] <= ctc[k - 1] + 0.035) ctc[k] = +(ctc[k - 1] + 0.035).toFixed(3);
    const clip = { start: Math.max(0, +(ctc[0] - 0.08).toFixed(3)), end: +(t + 0.15).toFixed(3) };
    const f = analyzeSignal(synth(t + 0.5, segs, trial + 1));
    const words = ctc.map((c, k) => word(c, { endsWithVowel: rnd() < 0.5, startsWithVowel: rnd() < 0.3, firstPhone: ["b", "m", "t", "a"][k % 4], lastSyllableEnd: c + 0.02, lastSyllableVowel: c }));
    const r = refineVerse({ clip, words }, f);
    assert.equal(r.ok, true, r.reason);
    r.starts.forEach((s, j) => {
      assert.ok(s >= ctc[j] - RULES.backS - 1e-9 && s <= ctc[j] + RULES.forwardS + 1e-9, `window ${trial}/${j}`);
      assert.ok(s >= clip.start && r.ends[j] <= clip.end);
      assert.ok(r.ends[j] > s);
      if (j > 0) assert.ok(s >= r.starts[j - 1] + RULES.minGapS - 1e-9 && r.ends[j - 1] <= s, `order ${trial}/${j}`);
    });
    assert.equal(r.log.every(e => Math.abs(e.moveMs) <= RULES.backS * 1000), true);
    recordingVerses.push({ verse: { ref: `Genesis 1:${trial + 1}`, start: clip.start, end: clip.end, words: ctc.map(c => ({ he: "אב", start: c })) }, r });
  }
  // The refined verses form a v2 recording the index contract accepts (bounds, order, ends).
  let at = 0;
  const verses = recordingVerses.map(({ verse, r }) => {
    const shift = at - verse.start; at = verse.end - verse.start + at + 0.01;
    const moved = { ...verse, start: +(verse.start + shift).toFixed(3), end: +(verse.end + shift).toFixed(3), words: verse.words.map(w => ({ ...w, start: +(w.start + shift).toFixed(3) })) };
    return v2Verse(moved, { ...r, starts: r.starts.map(s => +(s + shift).toFixed(3)), ends: r.ends.map(e => +(e + shift).toFixed(3)) });
  });
  const index = { schema: INDEX_V2_SCHEMA, source: "synthetic", method: "synthetic", recordings: [{ key: "Alpha-1", parsha: "Alpha", part: "1", table: "torah", ref: "Genesis 1:1-1:40",
    archiveFile: "Alpha-1.mp3", seconds: at + 1, wordLabelsMatched: false, verses }] };
  const v = validateIndex(index);
  assert.equal(v.ok, true, JSON.stringify(v.errors.slice(0, 5)));
});

test("refinement is deterministic: the same signal and onsets give byte-identical results", () => {
  const make = () => {
    const f = analyzeSignal(synth(3, [burst(0.5, 0.9), burst(1.0, 1.7), burst(2.1, 2.6)]));
    return refineVerse({ clip: { start: 0.42, end: 2.8 }, words: [word(0.54), word(1.06, { endsWithVowel: true }), word(2.11, { firstPhone: "b" })] }, f);
  };
  assert.equal(JSON.stringify(make()), JSON.stringify(make()));
});

test("unrefinable input is refused whole; a failed verse falls back to its CTC onsets with next-onset ends", () => {
  const f = analyzeSignal(synth(2, [burst(0.5, 0.9)]));
  assert.equal(refineVerse({ clip: { start: 0.4, end: 1.5 }, words: [word(0.6), word(0.6)] }, f).reason, "ctc-order");
  assert.equal(refineVerse({ clip: { start: 0.4, end: 1.5 }, words: [] }, f).reason, "input");
  const verse = { ref: "Genesis 1:1", start: 0.4, end: 1.5, words: [{ he: "אב", start: 0.6, label: 0.4 }, { he: "גד", start: 0.9 }] };
  assert.deepEqual(v2Verse(verse, { ok: false, reason: "no-room" }).words, [{ he: "אב", start: 0.6, end: 0.9, ctcStart: 0.6, label: 0.4 }, { he: "גד", start: 0.9, end: 1.5, ctcStart: 0.9 }]);
  const s = summarize([{ rule: "pause-rise", moveMs: -30, refused: [], endRule: "fade-decay", decayMs: 20 }, { rule: "onset-20ms", moveMs: -20, refused: [{ rule: "pause-rise", wantedMs: -200 }], endRule: "next-onset" }], [{ reason: "no-room" }]);
  assert.deepEqual(s.rules, { "pause-rise": 1, "onset-20ms": 1 });
  assert.deepEqual(s.refused, { "pause-rise": 1 });
  assert.equal(s.versesUnrefined, 1);
  assert.deepEqual(RULES.backS, WORD_MOVE_BOUNDS.backS);
  assert.deepEqual(RULES.forwardS, WORD_MOVE_BOUNDS.forwardS);
});

test("refine CLI refuses an output inside a Git working tree, never overwrites v1, and prints only a code", async () => {
  const script = fileURLToPath(new URL("../scripts/reference-boundary-refine.mjs", import.meta.url));
  const inside = fileURLToPath(new URL("../package.json", import.meta.url));
  const outside = await mkdtemp(join(tmpdir(), "ref-bounds-"));
  const { env, cleanup } = await isolatedEnv();
  try {
    await writeFile(join(outside, "v1.json"), "{}");
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
    const base = ["--align", outside, "--audio", outside, "--log", join(outside, "log")];
    const inGit = run(["--index", join(outside, "v1.json"), "--out", inside, ...base]);
    assert.equal(inGit.status, 1);
    assert.deepEqual(JSON.parse(inGit.stdout), { ok: false, code: "inside-git-working-tree" });
    const same = run(["--index", join(outside, "v1.json"), "--out", join(outside, "v1.json"), ...base]);
    assert.deepEqual(JSON.parse(same.stdout), { ok: false, code: "would-overwrite-v1" });
    await writeFile(join(outside, "v2.json"), "{}");
    assert.deepEqual(JSON.parse(run(["--index", join(outside, "v1.json"), "--out", join(outside, "v2.json"), ...base]).stdout), { ok: false, code: "output-exists" });
    assert.deepEqual(JSON.parse(run(["--index", join(outside, "v1.json")]).stdout), { ok: false, code: "usage" });
    for (const r of [inGit, same]) assert.ok(!r.stdout.includes(outside) && !r.stderr.includes(outside));
  } finally { await cleanup(); await rm(outside, { recursive: true, force: true }); }
});
