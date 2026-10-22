#!/usr/bin/env node
// Refine the private PocketTorah verse index's word boundaries from the audio (reference-boundaries.mjs)
// and write a new v2 index beside v1, keeping each word's original CTC onset as ctcStart. v1 is never
// overwritten: the output is created exclusively. Verse clips are copied unchanged.
//
//   node scripts/reference-boundary-refine.mjs --index <verse-index.json> --align <align dir>
//        --audio <dir of recordings> --out <verse-index-v2.json> --log <private dir> [--jobs N]
//
// --log receives refine-moves.jsonl (every word: rule, move, clamp, refusals, end rule) and
// refine-summary.json. stdout carries the same aggregate summary only.
import { open, writeFile, mkdir, lstat } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { analyzeSignal, acousticEvents, refineVerse, RULES } from "./reference-boundaries.mjs";
import { decodeMono, readJson, assertPrivate, parseFlags, runPool, wordFacts, Refusal } from "./reference-boundary-io.mjs";
import { validateIndex, checkV2AgainstV1 } from "./reference-index-contract.mjs";

export const INDEX_V2_SCHEMA = "pockettorah-verse-index/v2";
export const V2_METHOD = "; v2 word boundaries (scripts/reference-boundary-refine.mjs): each start moves only within -120/+60 ms of its CTC onset "
  + "(kept as ctcStart), never past a neighbour or the existing clip edges: CTC onset - 20 ms; after a pause, the rise out of the floor - 20 ms; "
  + "a vowel-to-vowel join at the largest timbre change; before b/d/g/m/n, the start of a voiced closure. A word ends at the next start, or, "
  + "where the sound has faded into the floor for 120 ms before it, at the fade-out plus its measured decay. Verse clips unchanged.";

async function refineRecording({ audioPath, verses }) {
  const f = analyzeSignal(await decodeMono(audioPath)), events = acousticEvents(f);
  return verses.map(v => refineVerse(v, f, events));
}
if (!isMainThread && workerData?.boundaryWorker && import.meta.url.endsWith("reference-boundary-refine.mjs")) {
  parentPort.on("message", async job => { try { parentPort.postMessage(await refineRecording(job)); } catch (e) { parentPort.postMessage({ error: e?.code ?? "refine" }); } });
}

/** The v2 verse for one v1 verse and its refinement result (or the unrefined fallback, logged). */
export function v2Verse(verse, result) {
  const n = verse.words.length;
  const starts = result.ok ? result.starts : verse.words.map(w => w.start);
  const ends = result.ok ? result.ends : verse.words.map((w, k) => k + 1 < n ? verse.words[k + 1].start : verse.end);
  return { ...verse, words: verse.words.map((w, k) => ({ he: w.he, start: starts[k], end: ends[k], ctcStart: w.start, ...(w.label !== undefined ? { label: w.label } : {}) })) };
}

export function summarize(entries, failures) {
  const count = (xs, f) => xs.reduce((m, x) => { const k = f(x); if (k !== undefined) m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const moves = entries.map(e => Math.abs(e.moveMs)).sort((a, b) => a - b), decays = entries.filter(e => e.decayMs !== undefined).map(e => e.decayMs).sort((a, b) => a - b);
  const mid = xs => xs.length ? xs[xs.length >> 1] : null;
  return {
    words: entries.length, rules: count(entries, e => e.rule), ends: count(entries, e => e.endRule),
    refused: count(entries.flatMap(e => e.refused), r => r.rule + (r.why ? `:${r.why}` : "")), clamped: entries.filter(e => e.clampedMs !== undefined).length,
    medianAbsMoveMs: mid(moves), maxAbsMoveMs: moves.at(-1) ?? null, medianDecayMs: mid(decays),
    versesUnrefined: failures.length, unrefinedReasons: count(failures, x => x.reason), bounds: { backMs: RULES.backS * 1000, forwardMs: RULES.forwardS * 1000 },
  };
}

export async function refineIndexFiles(argv) {
  const a = parseFlags(argv, ["--index", "--align", "--audio", "--out", "--log", "--jobs"], ["index", "align", "audio", "out", "log"]);
  const p = Object.fromEntries(Object.entries(a).filter(([k]) => k !== "jobs").map(([k, v]) => [k, resolve(v)]));
  await assertPrivate([...Object.values(p), dirname(p.out)]);
  if (p.out === p.index) throw new Refusal("would-overwrite-v1");
  try { await lstat(p.out); throw new Refusal("output-exists"); } catch (e) { if (e instanceof Refusal) throw e; if (e?.code !== "ENOENT") throw new Refusal("output"); }
  const jobsN = a.jobs ? Number(a.jobs) : undefined;
  if (jobsN !== undefined && !(Number.isInteger(jobsN) && jobsN >= 1 && jobsN <= 32)) throw new Refusal("usage");
  const index = await readJson(p.index);
  if (index.schema !== "pockettorah-verse-index/v1" || !Array.isArray(index.recordings)) throw new Refusal("index-schema");
  const cache = new Map(), jobs = [];
  for (const r of index.recordings) {
    if (typeof r?.key !== "string" || !/^[A-Za-z]{2,40}-(?:[1-7]|h)$/.test(r.key) || typeof r.archiveFile !== "string" || !/^[A-Za-z0-9_-]{1,80}\.mp3$/.test(r.archiveFile)) throw new Refusal("index-record");
    const align = await readJson(join(p.align, `${r.key}.json`), "align");
    if (!Array.isArray(align.verses) || align.verses.length !== r.verses.length) throw new Refusal("align-join");
    const verses = [];
    for (let i = 0; i < r.verses.length; i++) verses.push({ clip: { start: r.verses[i].start, end: r.verses[i].end }, words: await wordFacts(align.verses[i], r.verses[i], cache) });
    jobs.push({ audioPath: join(p.audio, r.archiveFile), verses });
  }
  const results = await runPool(new URL(import.meta.url), jobs, jobsN);
  const entries = [], failures = [], lines = [];
  const recordings = index.recordings.map((r, n) => ({ ...r, verses: r.verses.map((v, i) => {
    const result = results[n][i];
    if (result.ok) for (const e of result.log) { entries.push(e); lines.push(JSON.stringify({ key: r.key, ref: v.ref, ...e })); }
    else { failures.push({ reason: result.reason }); lines.push(JSON.stringify({ key: r.key, ref: v.ref, unrefined: result.reason })); }
    return v2Verse(v, result);
  }) }));
  const out = { schema: INDEX_V2_SCHEMA, source: index.source, method: `${index.method}${V2_METHOD}`, recordings };
  // The output must be v1 with refined times only, and the contract must find nothing in it that v1 lacks
  // (without chapter verse counts both report the same unverifiable chapter crossings).
  const codes = ix => validateIndex(ix).errors.map(e => `${e.code}@${e.at}`).sort();
  if (checkV2AgainstV1(index, out).length || JSON.stringify(codes(out)) !== JSON.stringify(codes(index))) throw new Refusal("v2-contract");
  const summary = summarize(entries, failures);
  await mkdir(p.log, { recursive: true });
  await writeFile(join(p.log, "refine-moves.jsonl"), lines.join("\n") + "\n");
  await writeFile(join(p.log, "refine-summary.json"), JSON.stringify(summary, null, 1));
  const file = await open(p.out, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(out), "utf8"); } finally { await file.close(); }
  return summary;
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await refineIndexFiles(process.argv.slice(2)), null, 1)); }
  catch (e) { console.log(JSON.stringify({ ok: false, code: e instanceof Refusal ? e.code : "boundary-refine-unavailable" })); process.exitCode = 1; }
}
