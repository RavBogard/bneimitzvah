#!/usr/bin/env node
// Boundary metrics for the PocketTorah reference index, measured on the audio itself.
//
//   node scripts/reference-boundary-metrics.mjs --index <verse-index.json> [--compare <verse-index-v2.json>]
//        --audio <dir of recordings> --out <private dir> [--jobs N]
//
// M1 onsets: each word start against the nearest onset-flux peak and the nearest rise out of the floor.
// M2 labels: starts against PocketTorah's own word labels (copied into the index verbatim by verse_index.py
//    for label-matched recordings), after removing each recording's median offset; disagreements > 300 ms.
// M3 drill tails: level of the last 40 ms against the word's peak, trailing silence over 150 ms, and the
//    next word's own onset already inside the drill.
// M4 edges: first or last 30 ms already loud throughout, a lead-in over 250 ms, and a last word cut by the next
//    verse; for word drills and, separately, for the verse clips themselves.
// Everything detailed stays in --out (outside every Git working tree); stdout carries aggregates only.
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { analyzeSignal, acousticEvents, nearestEvent, LEVELS, RULES } from "./reference-boundaries.mjs";
import { decodeMono, readJson, assertPrivate, parseFlags, runPool, Refusal } from "./reference-boundary-io.mjs";

export const METRIC = Object.freeze({
  searchS: 0.150,          // nearest event considered on either side of a start
  leadMaxS: 0.060,         // a clean start precedes its onset event by 0..60 ms
  lateS: 0.005,            // a start more than 5 ms after its onset event clips the attack
  tailS: 0.040, hotTailDb: -15,
  trailingSilenceS: 0.150,
  nextEventBackS: 0.120, nextEventForwardS: 0.060, insideMarginS: 0.010,
  edgeS: 0.030, leadInS: 0.250,
  labelDisagreeS: 0.300,
});
// Daniel's listening-review stress set (listening-sample/v2, branch claude/listening-review at 94ad852,
// src/lib/listening-review/sample-generated.ts): citations only.
export const STRESS_REFS = Object.freeze(["Genesis 1:1", "Genesis 8:17", "Genesis 22:12", "Genesis 25:14", "Genesis 26:6", "Genesis 28:3",
  "Genesis 28:4", "Genesis 36:4", "Exodus 15:1", "Exodus 20:2", "Leviticus 16:1", "Leviticus 19:18", "Numbers 6:24", "Numbers 21:7",
  "Numbers 29:11", "Deuteronomy 4:10", "Deuteronomy 4:34", "Deuteronomy 6:4", "Deuteronomy 28:27", "Deuteronomy 34:12", "Judges 13:11",
  "II Samuel 22:1", "II Samuel 22:4", "I Kings 19:11", "I Kings 19:21", "II Kings 4:23", "II Kings 4:37", "Isaiah 40:1", "Jeremiah 46:20",
  "Jeremiah 46:25", "Ezekiel 43:11", "Hosea 14:2", "Amos 3:1", "Malachi 1:1"]);

const frameAt = (f, t) => Math.min(f.frames - 1, Math.max(0, Math.round(t / f.hopS)));
/** Mean power over [a, b) in dB, from the frame levels. */
function spanDb(f, a, b) {
  const i0 = frameAt(f, a), i1 = Math.max(i0 + 1, frameAt(f, b));
  let p = 0;
  for (let i = i0; i < i1; i++) p += 10 ** (f.db[i] / 10);
  return 10 * Math.log10(p / (i1 - i0));
}
function peakDb(f, a, b) {
  let top = -Infinity;
  for (let i = frameAt(f, a); i < Math.max(frameAt(f, a) + 1, frameAt(f, b)); i++) top = Math.max(top, f.db[i]);
  return top;
}
const isQuiet = (f, i) => f.db[i] < f.floor + LEVELS.quietDb;
const quietRunFrom = (f, a, b) => { let i = frameAt(f, a); const stop = frameAt(f, b); while (i < stop && isQuiet(f, i)) i++; return (i - frameAt(f, a)) * f.hopS; };
const quietRunTo = (f, a, b) => { let i = frameAt(f, b) - 1; const stop = frameAt(f, a); while (i >= stop && isQuiet(f, i)) i--; return (frameAt(f, b) - 1 - i) * f.hopS; };
/** Sounding throughout [a, b): every frame loud, so an edge that only touches an attack or a decay is not flagged. */
const loudSpan = (f, a, b) => { const i0 = frameAt(f, a), i1 = Math.max(i0 + 1, frameAt(f, b)); for (let i = i0; i < i1; i++) if (!(f.db[i] > f.floor + LEVELS.loudDb)) return false; return true; };

/**
 * Per-word and per-clip measurements for one verse. verse: {clip, starts, ends|null, ctc, endsAtNextVerse}.
 * ends null means the v1 drill: each word to the next start, the last to the clip end. ctc is the
 * unrefined onsets, used only to find each next word's own onset event the same way for every version.
 */
export function verseMetrics(f, events, { clip, starts, ends = null, ctc, endsAtNextVerse = false }) {
  const all = Float64Array.from([...events.peaks, ...events.rises]).sort();
  const words = starts.map((s, j) => {
    const e = ends ? ends[j] : j + 1 < starts.length ? starts[j + 1] : clip.end;
    const flux = nearestEvent(events.peaks, s, METRIC.searchS, METRIC.searchS), rise = nearestEvent(events.rises, s, METRIC.searchS, METRIC.searchS);
    const nextEvent = j + 1 < starts.length ? nearestEvent(all, ctc[j + 1], METRIC.nextEventBackS, METRIC.nextEventForwardS) : null;
    const peak = peakDb(f, s, e);
    return {
      fluxDelta: flux === null ? null : flux - s, riseDelta: rise === null ? null : rise - s,
      tailDb: spanDb(f, Math.max(s, e - METRIC.tailS), e) - peak,
      trailingQuiet: quietRunTo(f, s, e),
      nextInside: nextEvent !== null && nextEvent > s + RULES.minGapS && nextEvent < e - METRIC.insideMarginS,
      hasNext: j + 1 < starts.length,
      firstLoud: loudSpan(f, s, Math.min(e, s + METRIC.edgeS)), lastLoud: loudSpan(f, Math.max(s, e - METRIC.edgeS), e),
      leadIn: quietRunFrom(f, s, e),
      truncated: j + 1 === starts.length && endsAtNextVerse && Math.abs(e - clip.end) < 0.0015 && loudSpan(f, Math.max(s, e - METRIC.edgeS), e),
    };
  });
  const clipEdges = {
    firstLoud: loudSpan(f, clip.start, clip.start + METRIC.edgeS), lastLoud: loudSpan(f, clip.end - METRIC.edgeS, clip.end),
    leadIn: quietRunFrom(f, clip.start, clip.end), truncated: endsAtNextVerse && loudSpan(f, clip.end - METRIC.edgeS, clip.end),
  };
  return { words, clip: clipEdges };
}

const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rate = (n, d) => d ? Math.round(n / d * 10000) / 10000 : null;
const ms = x => x === null ? null : Math.round(x * 1000);

/** Aggregate verseMetrics results ({words, clip} per verse) into the M1/M3/M4 numbers. */
export function aggregate(verses) {
  const w = verses.flatMap(v => v.words), c = verses.map(v => v.clip);
  const onset = key => {
    const found = w.map(x => x[key]).filter(x => x !== null);
    return { found: found.length, medianAbsMs: ms(median(found.map(Math.abs))), cleanLeadRate: rate(found.filter(d => d >= -1e-9 && d <= METRIC.leadMaxS + 1e-9).length, found.length), lateRate: rate(found.filter(d => d < -METRIC.lateS).length, found.length) };
  };
  const withNext = w.filter(x => x.hasNext);
  const hot = x => x.tailDb > METRIC.hotTailDb, silent = x => x.trailingQuiet > METRIC.trailingSilenceS + 1e-9;
  const drillDefect = x => x.firstLoud || x.lastLoud || x.leadIn > METRIC.leadInS + 1e-9 || x.truncated;
  const clipDefect = x => x.firstLoud || x.lastLoud || x.leadIn > METRIC.leadInS + 1e-9 || x.truncated;
  return {
    verses: verses.length, words: w.length,
    M1: { flux: onset("fluxDelta"), rise: onset("riseDelta") },
    M3: { drills: w.length, hotTailRate: rate(w.filter(hot).length, w.length), medianTailDb: Math.round((median(w.map(x => x.tailDb)) ?? 0) * 10) / 10,
      trailingSilenceRate: rate(w.filter(silent).length, w.length), nextInsideRate: rate(withNext.filter(x => x.nextInside).length, withNext.length),
      defectRate: rate(w.filter(x => hot(x) || silent(x) || x.nextInside).length, w.length) },
    M4: {
      drills: { firstLoudRate: rate(w.filter(x => x.firstLoud).length, w.length), lastLoudRate: rate(w.filter(x => x.lastLoud).length, w.length),
        leadInRate: rate(w.filter(x => x.leadIn > METRIC.leadInS + 1e-9).length, w.length), truncatedLastWords: w.filter(x => x.truncated).length, defectRate: rate(w.filter(drillDefect).length, w.length) },
      clips: { firstLoudRate: rate(c.filter(x => x.firstLoud).length, c.length), lastLoudRate: rate(c.filter(x => x.lastLoud).length, c.length),
        leadInRate: rate(c.filter(x => x.leadIn > METRIC.leadInS + 1e-9).length, c.length), truncated: c.filter(x => x.truncated).length, defectRate: rate(c.filter(clipDefect).length, c.length) },
    },
  };
}

/** M2: per label-matched recording, starts minus labels, centred on the recording's median offset. */
export function labelAgreement(recordings) {
  let words = 0, disagree = 0, used = 0;
  const offsets = [];
  for (const pairs of recordings) {
    if (!pairs.length) continue;
    used++;
    const d = pairs.map(([s, l]) => s - l), m = median(d);
    offsets.push(m);
    for (const x of d) { words++; if (Math.abs(x - m) > METRIC.labelDisagreeS + 1e-9) disagree++; }
  }
  return { recordings: used, words, disagreements: disagree, disagreementRate: rate(disagree, words), medianOffsetMs: ms(median(offsets)) };
}

// ---- worker and CLI ------------------------------------------------------------------------------
async function measureRecording({ audioPath, versions }) {
  const f = analyzeSignal(await decodeMono(audioPath)), events = acousticEvents(f);
  return versions.map(verses => verses.map(v => ({ ref: v.ref, ...verseMetrics(f, events, v) })));
}
if (!isMainThread && workerData?.boundaryWorker && import.meta.url.endsWith("reference-boundary-metrics.mjs")) {
  parentPort.on("message", async job => { try { parentPort.postMessage(await measureRecording(job)); } catch (e) { parentPort.postMessage({ error: e?.code ?? "measure" }); } });
}

/** One recording's verses as metric inputs. ends come from v2 word ends when present. */
export function verseInputs(recording) {
  return recording.verses.map((v, i) => {
    const next = recording.verses[i + 1];
    return { ref: v.ref, clip: { start: v.start, end: v.end }, starts: v.words.map(w => w.start), ends: v.words.every(w => typeof w.end === "number") ? v.words.map(w => w.end) : null,
      ctc: v.words.map(w => typeof w.ctcStart === "number" ? w.ctcStart : w.start), endsAtNextVerse: !!next && Math.abs(next.start - v.end) < 0.0015 };
  });
}

export async function boundaryMetricsFiles(argv) {
  const a = parseFlags(argv, ["--index", "--compare", "--audio", "--out", "--jobs"], ["index", "audio", "out"]);
  const paths = [a.index, a.audio, a.out, ...(a.compare ? [a.compare] : [])].map(p => resolve(p));
  await assertPrivate(paths);
  const indexes = [await readJson(a.index)];
  if (a.compare) indexes.push(await readJson(a.compare));
  const byKey = indexes.map(ix => new Map(ix.recordings.map(r => [r.key, r])));
  const keys = [...byKey[0].keys()].sort();
  for (const m of byKey.slice(1)) if (m.size !== keys.length || keys.some(k => !m.has(k) || m.get(k).verses.length !== byKey[0].get(k).verses.length)) throw new Refusal("compare-shape");
  const jobs = keys.map(k => ({ audioPath: join(resolve(a.audio), byKey[0].get(k).archiveFile), versions: byKey.map(m => verseInputs(m.get(k))) }));
  const jobsN = a.jobs ? Number(a.jobs) : undefined;
  if (jobsN !== undefined && !(Number.isInteger(jobsN) && jobsN >= 1 && jobsN <= 32)) throw new Refusal("usage");
  const measured = await runPool(new URL(import.meta.url), jobs, jobsN);
  const stress = new Set(STRESS_REFS);
  const report = { schema: "reference-boundary-metrics/v1", metric: METRIC, levels: LEVELS, versions: [] };
  indexes.forEach((ix, n) => {
    const verses = measured.flatMap(r => r[n]);
    const label = keys.map(k => byKey[n].get(k)).filter(r => r.wordLabelsMatched).map(r => r.verses.flatMap(v => v.words.filter(w => typeof w.label === "number").map(w => [w.start, w.label])));
    report.versions.push({ schema: ix.schema, all: aggregate(verses), stress: { refs: stress.size, ...aggregate(verses.filter(v => stress.has(v.ref))) }, M2: labelAgreement(label) });
  });
  await mkdir(resolve(a.out), { recursive: true });
  await writeFile(join(resolve(a.out), `metrics-${a.compare ? "compare" : "baseline"}.json`), JSON.stringify(report, null, 1));
  await writeFile(join(resolve(a.out), `metrics-${a.compare ? "compare" : "baseline"}-verses.json`), JSON.stringify(keys.map((k, i) => ({ key: k, versions: measured[i] }))));
  return report;
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await boundaryMetricsFiles(process.argv.slice(2)), null, 1)); }
  catch (e) { console.log(JSON.stringify({ ok: false, code: e instanceof Refusal ? e.code : "boundary-metrics-unavailable" })); process.exitCode = 1; }
}
