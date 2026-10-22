// Synthetic signals only (tests/helpers/synthetic-audio.mjs): each metric is checked against a signal
// whose answer is known by construction. No recording, index, label file or private path is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { synth, burst } from "./helpers/synthetic-audio.mjs";
import { analyzeSignal, acousticEvents } from "../scripts/reference-boundaries.mjs";
import { verseMetrics, aggregate, labelAgreement, verseInputs, METRIC, STRESS_REFS } from "../scripts/reference-boundary-metrics.mjs";

// Three bursts with pauses: sound at [0.5, 0.9), [1.3, 1.7), [2.1, 2.6).
const f = analyzeSignal(synth(3, [burst(0.5, 0.9), burst(1.3, 1.7), burst(2.1, 2.6)]));
const events = acousticEvents(f);
const clip = { start: 0.42, end: 2.75 };
const near = (actual, expected, tol, what) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} not within ${tol * 1000} ms of ${expected}`);

test("M1: a start just before its burst is a clean lead; a start inside the burst is late", () => {
  const clean = verseMetrics(f, events, { clip, starts: [0.48, 1.28, 2.08], ctc: [0.5, 1.3, 2.1] });
  for (const w of clean.words) { near(w.riseDelta, 0.02, 0.006, "rise delta"); assert.ok(w.fluxDelta !== null && w.fluxDelta >= 0 && w.fluxDelta <= METRIC.leadMaxS, String(w.fluxDelta)); }
  const late = verseMetrics(f, events, { clip, starts: [0.54, 1.34, 2.14], ctc: [0.5, 1.3, 2.1] });
  for (const w of late.words) near(w.riseDelta, -0.04, 0.006, "late delta");
  const a = aggregate([clean]), b = aggregate([late]);
  assert.equal(a.M1.rise.cleanLeadRate, 1);
  assert.equal(b.M1.rise.lateRate, 1);
  assert.equal(b.M1.rise.cleanLeadRate, 0);
});

test("M3: onset-to-onset drills carry the pause and the next attack; measured ends do not", () => {
  // v1-style drills run to the next start: 400 ms of trailing silence; and when the onsets are late, the
  // next attack (at 1.3) falls inside a drill that ends at 1.34.
  const v1 = verseMetrics(f, events, { clip, starts: [0.5, 1.3, 2.1], ctc: [0.5, 1.3, 2.1] });
  assert.ok(v1.words[0].trailingQuiet > METRIC.trailingSilenceS, String(v1.words[0].trailingQuiet));
  assert.equal(v1.words[0].hasNext, true);
  const late = verseMetrics(f, events, { clip, starts: [0.54, 1.34, 2.14], ctc: [0.54, 1.34, 2.14] });
  assert.equal(late.words[0].nextInside, true);
  assert.equal(late.words[0].lastLoud, true);
  const v2 = verseMetrics(f, events, { clip, starts: [0.48, 1.28, 2.08], ends: [0.96, 1.76, 2.66], ctc: [0.5, 1.3, 2.1] });
  for (const w of v2.words) { assert.ok(w.trailingQuiet <= METRIC.trailingSilenceS, String(w.trailingQuiet)); assert.equal(w.nextInside, false); assert.ok(w.tailDb < METRIC.hotTailDb, String(w.tailDb)); }
  // A drill cut in the middle of its burst ends hot.
  const cut = verseMetrics(f, events, { clip, starts: [0.48, 1.28, 2.08], ends: [0.7, 1.76, 2.66], ctc: [0.5, 1.3, 2.1] });
  assert.ok(cut.words[0].tailDb > METRIC.hotTailDb, String(cut.words[0].tailDb));
  const a = aggregate([v1]).M3, b = aggregate([v2]).M3;
  assert.ok(a.defectRate > b.defectRate);
  assert.equal(b.trailingSilenceRate, 0);
  assert.equal(b.nextInsideRate, 0);
});

test("M4: loud edges, a long lead-in and a last word cut by the next verse are each found", () => {
  const m = verseMetrics(f, events, { clip: { start: 0.1, end: 2.4 }, starts: [0.1, 1.4, 2.15], ends: [0.95, 1.6, 2.4], ctc: [0.5, 1.4, 2.15], endsAtNextVerse: true });
  assert.ok(m.words[0].leadIn > METRIC.leadInS, "a drill opening on 400 ms of quiet");
  assert.equal(m.words[1].firstLoud, true, "a drill opening inside its burst");
  assert.equal(m.words[1].lastLoud, true, "a drill ending inside its burst");
  assert.equal(m.words[2].truncated, true, "the last word cut while sounding by the next verse");
  assert.equal(m.clip.leadIn > METRIC.leadInS, true);
  assert.equal(m.clip.truncated, true);
  assert.equal(m.clip.firstLoud, false);
  const quietEdges = verseMetrics(f, events, { clip, starts: [0.48, 1.28, 2.08], ends: [0.96, 1.76, 2.66], ctc: [0.5, 1.3, 2.1] });
  for (const w of quietEdges.words) assert.deepEqual([w.firstLoud, w.lastLoud, w.leadIn > METRIC.leadInS, w.truncated], [false, false, false, false]);
  assert.equal(aggregate([quietEdges]).M4.drills.defectRate, 0);
  assert.equal(aggregate([m]).M4.drills.truncatedLastWords, 1);
});

test("M2: each recording's median offset is removed before counting disagreements over 300 ms", () => {
  // Labels lead the voice by a constant 400 ms in one recording, 100 ms in another; one word is 700 ms off.
  const r1 = [[1.4, 1.0], [2.4, 2.0], [3.4, 3.0], [4.8, 4.1]], r2 = [[1.1, 1.0], [2.1, 2.0], [3.1, 3.0]];
  const m = labelAgreement([r1, r2, []]);
  assert.deepEqual(m, { recordings: 2, words: 7, disagreements: 0, disagreementRate: 0, medianOffsetMs: 250 });
  const off = labelAgreement([[[1.4, 1.0], [2.4, 2.0], [3.4, 3.0], [5.2, 4.1]]]);
  assert.equal(off.disagreements, 1);
});

test("metric inputs: v1 words run to the next start; v2 words carry their ends and CTC onsets", () => {
  const recording = { verses: [
    { ref: "Genesis 1:1", start: 1, end: 3, words: [{ he: "א", start: 1.1 }, { he: "ב", start: 2 }] },
    { ref: "Genesis 1:2", start: 3, end: 5, words: [{ he: "ג", start: 3.08, end: 3.9, ctcStart: 3.1 }, { he: "ד", start: 4, end: 4.8, ctcStart: 4.02 }] },
  ] };
  const [a, b] = verseInputs(recording);
  assert.equal(a.ends, null);
  assert.deepEqual(a.ctc, [1.1, 2]);
  assert.equal(a.endsAtNextVerse, true);
  assert.deepEqual(b.ends, [3.9, 4.8]);
  assert.deepEqual(b.ctc, [3.1, 4.02]);
  assert.equal(b.endsAtNextVerse, false);
  assert.equal(STRESS_REFS.length, 34);
  assert.equal(new Set(STRESS_REFS).size, 34);
});

test("metrics CLI refuses an output inside a Git working tree and prints only a code", async () => {
  const script = fileURLToPath(new URL("../scripts/reference-boundary-metrics.mjs", import.meta.url));
  const inside = fileURLToPath(new URL("..", import.meta.url));
  const outside = await mkdtemp(join(tmpdir(), "ref-metrics-"));
  const { env, cleanup } = await isolatedEnv();
  try {
    await writeFile(join(outside, "v1.json"), "{}");
    const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
    const refused = run(["--index", join(outside, "v1.json"), "--audio", outside, "--out", join(inside, "metrics-out")]);
    assert.equal(refused.status, 1);
    assert.deepEqual(JSON.parse(refused.stdout), { ok: false, code: "inside-git-working-tree" });
    assert.ok(!refused.stdout.includes(outside) && !refused.stderr.includes(outside));
    assert.deepEqual(JSON.parse(run(["--audio", outside]).stdout), { ok: false, code: "usage" });
  } finally { await cleanup(); await rm(outside, { recursive: true, force: true }); }
});
