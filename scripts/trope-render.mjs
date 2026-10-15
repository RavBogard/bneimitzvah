#!/usr/bin/env node
// Render a reading to sung audio with SoulX-Singer (renderer ladder step 2, design spec §6): fetch the
// MAM text, score every verse, write each verse's SoulX metadata, and render all verses either locally in
// one Python process (one model load, trope/soulx_runner.py) or on Modal GPUs (trope/modal_render.py).
//   node scripts/trope-render.mjs --ref "I Samuel 20:18-42" [--table trope/cells/haftarah.json] [--key D4]
//     [--tempo 96] [--prompt <wav> --prompt-meta <json>] [--chet en|zh] [--out <dir>] [--limit N]
//     [--gap 0.6] [--full <wav>] [--cpu] [--dry-run]
//     [--backend local|modal] [--gpu L4] [--max-containers 10] [--per-call 3] [--no-fp16] [--modal <exe>]
// Batch: --refs "A;B;C", --refs-file refs.txt (one ref per line, # comments) or --year 2027 (every Shabbat
// and holiday haftarah Hebcal lists for that Gregorian year, haftarah only). Each reading renders into
// <out>/<ref-slug>/ and, on Modal, all readings share one fan-out.
// Writes <out>/<NN>-<ref-slug>.wav, <out>/json/<NN>-<ref-slug>.json, <out>/<reading-slug>-full.wav (all
// verses with --gap s between them) and <out>/manifest.json. --dry-run writes the JSON and stops (for
// --backend modal it also prints the modal command it would run).
// The local environment lives outside the repo (C:\Users\dsbog\haftarah-audio\soulx-env\README.md);
// override it with HAFTARAH_SOULX_ENV (the folder holding venv\ and SoulX-Singer\) and HAFTARAH_SOULX_MODEL.
// The Modal backend needs only the `modal` CLI (README section "Cloud rendering"); weights live in Modal.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { scoreVerse } from "../trope/melody.mjs";
import { verseUnits } from "../trope/text.mjs";
import { fetchReading } from "../trope/sefaria.mjs";
import { readingFor } from "../trope/hebcal.mjs";
import { scoreToSoulx, soulxSummary, MAX_SEGMENT_SECONDS } from "../trope/soulx.mjs";
import { parseRenderArgs, UsageError, USAGE, findModal, modalInvocation } from "../trope/render-cli.mjs";
import { concatWavs } from "../trope/wav.mjs";
import { checkPromptMeta } from "../trope/prompt.mjs";

const AUDIO_ROOT = "C:\\Users\\dsbog\\haftarah-audio";
const ENV = process.env.HAFTARAH_SOULX_ENV || join(AUDIO_ROOT, "soulx-env");
const MODEL = process.env.HAFTARAH_SOULX_MODEL || join(AUDIO_ROOT, "soulx", "model.pt");
const REPO = join(ENV, "SoulX-Singer");
const PYTHON = join(ENV, "venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");

let o;
try { o = parseRenderArgs(process.argv.slice(2)); } catch (e) {
  if (!(e instanceof UsageError)) throw e;
  console.error(`${e.message}\n${USAGE}`);
  process.exit(2);
}
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const modalScript = fileURLToPath(new URL("../trope/modal_render.py", import.meta.url));
const runner = fileURLToPath(new URL("../trope/soulx_runner.py", import.meta.url));

const tablePath = o.table || fileURLToPath(new URL("../trope/cells/haftarah.json", import.meta.url));
const table = JSON.parse(readFileSync(tablePath, "utf8"));
const scoreOpts = { table, key: o.key, tempo: o.tempo };

// The shipped example prompt is a separated stem of a commercial pop recording (voice-feasibility.md
// §1a): fine to test mechanics, never to publish.
const promptWav = o.prompt || join(REPO, "example", "audio", "en_prompt.mp3");
const promptMeta = o.promptMeta || join(REPO, "example", "audio", "en_prompt.json");
const defaultPrompt = !o.prompt;

// --year: the haftarah refs Hebcal lists for each Shabbat and holiday of the year (readingFor by date).
async function refsForYear(year) {
  const refs = [], seen = new Set();
  const day = new Date(Date.UTC(year, 0, 1, 12));
  while (day.getUTCDay() !== 6) day.setUTCDate(day.getUTCDate() + 1);   // first Saturday
  for (; day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 7)) {
    const date = day.toISOString().slice(0, 10);
    try {
      for (const r of (await readingFor({ date })).haftarah.refs) if (!seen.has(r)) { seen.add(r); refs.push(r); }
    } catch (e) { console.warn(`${date}: ${e.message}`); }
  }
  return refs;
}

const refs = o.refs || await refsForYear(o.year);
if (!refs.length) { console.error("no readings to render"); process.exit(1); }
const outRoot = resolve(o.out || join(AUDIO_ROOT, "renders", o.batch ? `batch-${new Date().toISOString().slice(0, 10)}` : slug(refs[0])));

// Score every verse of every reading and write its SoulX metadata.
const readings = [];
for (const ref of refs) {
  const fetched = await fetchReading(ref);
  const limit = o.limit ?? fetched.length;
  const outDir = o.batch ? join(outRoot, slug(ref)) : outRoot;
  mkdirSync(join(outDir, "json"), { recursive: true });
  const verses = fetched.slice(0, limit).map((v, i) => {
    // The end-of-reading cadence belongs to the reading's real last verse, also under --limit.
    const units = { ...verseUnits(v.he, { final: i === fetched.length - 1 }), ref: v.ref };
    const score = scoreVerse(units, scoreOpts);
    const segments = scoreToSoulx(score, { chet: o.chet });
    const name = `${String(i + 1).padStart(2, "0")}-${slug(v.ref)}`;
    const json = join(outDir, "json", `${name}.json`);
    writeFileSync(json, JSON.stringify(segments, null, 2));
    const sum = soulxSummary(segments);
    const fallback = score.units.filter(u => u.cell.fallback).length;
    console.log(`${name.padEnd(26)} ${String(sum.notes).padStart(3)} notes ${sum.seconds.toFixed(2).padStart(6)}s${sum.segments > 1 ? `  split into ${sum.segments} segments at phrase breaks (> ${MAX_SEGMENT_SECONDS}s)` : ""}${fallback ? `  ${fallback} words on the fallback reciting tone` : ""}`);
    return { ref: v.ref, json, wav: join(outDir, `${name}.wav`), scoreSeconds: score.seconds, ...sum };
  });
  const totalSeconds = verses.reduce((s, v) => s + v.seconds, 0);
  console.log(`${ref}: ${verses.length} verses, ${Math.round(totalSeconds)}s of chant; metadata in ${join(outDir, "json")}`);
  readings.push({ ref, outDir, verses, fullWav: resolve(o.full || join(outDir, `${slug(ref)}-full.wav`)) });
}
const allVerses = readings.flatMap(r => r.verses);
const planned = Math.round(allVerses.reduce((s, v) => s + v.seconds, 0));
if (o.batch) console.log(`${readings.length} readings, ${allVerses.length} verses, ${planned}s of chant in all`);

// ---- backend ---------------------------------------------------------------------------------------

let modalPath = null;
if (o.backend === "modal") {
  const found = findModal({ explicit: o.modal.cli, audioRoot: AUDIO_ROOT });
  modalPath = found.path;
  if (!modalPath && !o.dryRun) {
    console.error(`cannot find the modal CLI. Install it (docs/superpowers/plans/2026-10-15-trope-cloud-render.md): py -3.12 -m venv ${join(AUDIO_ROOT, "modal-env")}; ${join(AUDIO_ROOT, "modal-env", "Scripts", "pip")} install modal; then modal token new. Or point at it with --modal <exe> or HAFTARAH_MODAL.\ntried: ${found.tried.join(", ")}`);
    process.exit(1);
  }
}
const jobsPath = join(outRoot, "jobs.json");
const jobsSpec = () => ({
  backend: o.backend,
  repo: REPO, model: MODEL,
  config: join(REPO, "soulxsinger", "config", "soulxsinger.yaml"),
  phoneset: join(REPO, "soulxsinger", "utils", "phoneme", "phone_set.json"),
  prompt_wav: resolve(promptWav), prompt_meta: resolve(promptMeta),
  device: o.cpu ? "cpu" : "cuda", fp16: o.backend === "modal" ? o.modal.fp16 : !o.cpu,
  jobs: allVerses.map(v => ({ meta: v.json, wav: v.wav })),
  // The local runner concatenates one reading itself; Modal readings are joined here in Node (trope/wav.mjs).
  concat: o.backend === "local" && !o.batch ? { out: readings[0].fullWav, gap: o.gap } : null,
});

if (o.dryRun) {
  if (o.backend === "modal") {
    const inv = modalInvocation({ modalPath: modalPath || "modal", script: modalScript, jobsPath, modal: o.modal, env: {} });
    console.log(`would run: ${[inv.command, ...inv.args].join(" ")}   [SOULX_MODAL_GPU=${o.modal.gpu} SOULX_MODAL_CONCURRENCY=${o.modal.maxContainers}]`);
  }
  await new Promise(r => setTimeout(r, 100));   // let fetch's sockets close; exiting under them trips a libuv assert on Windows
  process.exit(0);
}

if (defaultPrompt) console.warn("WARNING: default prompt = SoulX's example en_prompt, a separated stem of a commercial pop recording. Internal tests only: do not publish these renders.");
const needs = [["prompt wav", promptWav], ["prompt metadata", promptMeta]];
if (o.backend === "local") needs.unshift(["python (HAFTARAH_SOULX_ENV)", PYTHON], ["SoulX-Singer clone", REPO], ["checkpoint (HAFTARAH_SOULX_MODEL)", MODEL]);
for (const [what, p] of needs) {
  if (!existsSync(p)) { console.error(`missing ${what}: ${p}${what.startsWith("prompt") && defaultPrompt && o.backend === "modal" ? " (pass --prompt and --prompt-meta; the default prompt lives in the local SoulX clone)" : ""}`); process.exit(1); }
}
// Check the prompt metadata before any model load (scripts/trope-prompt.mjs makes it from a sung WAV).
{
  const phoneSetPath = join(REPO, "soulxsinger", "utils", "phoneme", "phone_set.json");
  const phoneSet = existsSync(phoneSetPath) ? new Set(JSON.parse(readFileSync(phoneSetPath, "utf8"))) : null;
  const { errors, warnings, summary } = checkPromptMeta(JSON.parse(readFileSync(promptMeta, "utf8")), { phoneSet });
  for (const w of warnings) console.warn(`prompt: ${w}`);
  if (errors.length) { for (const e of errors) console.error(`prompt: ${e}`); process.exit(1); }
  console.log(`prompt: ${summary.seconds}s, ${summary.notes} notes${summary.pitchNames ? ` ${summary.pitchNames.join("-")}` : ""}`);
}
writeFileSync(jobsPath, JSON.stringify(jobsSpec(), null, 2));

// Run a command, echo its log, and collect its "@@ {json}" result lines (same protocol from both backends).
async function runCollect(command, args, env, onEvent) {
  const results = [];
  await new Promise((ok, fail) => {
    const p = spawn(command, args, { env, stdio: ["ignore", "pipe", "inherit"], shell: false });
    let buf = "";
    p.stdout.on("data", d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
        if (!line.startsWith("@@ ")) { console.log(line); continue; }
        const r = JSON.parse(line.slice(3));
        results.push(r);
        onEvent(r);
      }
    });
    p.on("error", fail);
    p.on("close", code => code === 0 ? ok() : fail(new Error(`${command} exited with ${code}`)));
  });
  return results;
}

const started = Date.now();
const where = o.backend === "modal" ? `modal ${o.modal.gpu}` : "local";
const onEvent = r => {
  if (r.event === "verse") {
    const v = allVerses[r.i];
    console.log(r.wav ? `[${r.i + 1}/${allVerses.length}] ${v.ref}: ${r.seconds}s rendered in ${r.render_s}s (${where})` : `[${r.i + 1}/${allVerses.length}] ${v.ref}: FAILED ${r.error}`);
  } else console.log(`${r.event}: ${JSON.stringify(r)}`);
};
const results = [];   // events whose verse index i is global across readings
let runError = null;
try {
  if (o.backend === "modal") {
    const inv = modalInvocation({ modalPath, script: modalScript, jobsPath, modal: o.modal });
    results.push(...await runCollect(inv.command, inv.args, inv.env, onEvent));
  } else {
    // One local Python process per reading: one model load each, and the runner's own full-reading concat.
    let offset = 0;
    for (const rd of readings) {
      const jp = o.batch ? join(rd.outDir, "jobs.json") : jobsPath;
      if (o.batch) writeFileSync(jp, JSON.stringify({ ...jobsSpec(), jobs: rd.verses.map(v => ({ meta: v.json, wav: v.wav })), concat: { out: rd.fullWav, gap: o.gap } }, null, 2));
      const base = offset;
      const rs = await runCollect(PYTHON, [runner, jp], { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, r => onEvent(r.event === "verse" ? { ...r, i: r.i + base } : r));
      results.push(...rs.map(r => r.event === "verse" ? { ...r, i: r.i + base } : { ...r, reading: rd.ref }));
      offset += rd.verses.length;
    }
  }
} catch (e) { runError = e; console.error(e.message); process.exitCode = 1; }

// ---- manifests -------------------------------------------------------------------------------------

const byIndex = new Map(results.filter(r => r.event === "verse").map(r => [r.i, r]));
const loaded = results.find(r => r.event === "loaded");
const memory = results.find(r => r.event === "memory");
const wallSeconds = Math.round((Date.now() - started) / 1000);
let failed = 0, base = 0, summary = [];
for (const rd of readings) {
  let full = null;
  if (o.backend === "modal") {
    // Join this reading's verse WAVs in order, as the local runner does (verses that failed are skipped).
    const wavs = rd.verses.map((v, i) => byIndex.get(base + i)?.wav).filter(Boolean);
    if (wavs.length) {
      try {
        const { wav, seconds } = concatWavs(wavs.map(w => readFileSync(w)), o.gap);
        writeFileSync(rd.fullWav, wav);
        full = { wav: rd.fullWav, seconds: Math.round(seconds * 1000) / 1000, verses: wavs.length };
      } catch (e) { console.error(`${rd.ref}: full-reading concat failed: ${e.message}`); }
    }
  } else {
    const c = results.find(r => r.event === "concat" && (!o.batch || r.reading === rd.ref));
    if (c) full = { wav: c.wav, seconds: c.seconds, verses: c.verses };
  }
  const manifest = {
    ref: rd.ref, created: new Date().toISOString(), backend: o.backend, table: table.name || tablePath, key: scoreOpts.key, tempo: scoreOpts.tempo, chet: o.chet,
    prompt: { wav: resolve(promptWav), meta: resolve(promptMeta), publishable: !defaultPrompt },
    ...(o.backend === "modal" ? { modal: { gpu: o.modal.gpu, maxContainers: o.modal.maxContainers, perCall: o.modal.perCall, fp16: o.modal.fp16, app: "haftarah-soulx" } } : { model: MODEL, env: ENV }),
    loadSeconds: loaded?.load_s ?? null, memory: memory ?? null, wallSeconds, full,
    verses: rd.verses.map((v, i) => {
      const r = byIndex.get(base + i) || {};
      return { ref: v.ref, wav: r.wav ?? null, json: v.json, seconds: r.seconds ?? null, scoreSeconds: v.seconds, notes: v.notes, segments: v.segments, renderSeconds: r.render_s ?? null, ...(r.error ? { error: r.error } : {}) };
    }),
  };
  base += rd.verses.length;
  writeFileSync(join(rd.outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  const bad = manifest.verses.filter(v => !v.wav).length;
  failed += bad;
  summary.push({ ref: rd.ref, dir: rd.outDir, rendered: rd.verses.length - bad, verses: rd.verses.length });
  console.log(`manifest: ${join(rd.outDir, "manifest.json")} (${rd.verses.length - bad}/${rd.verses.length} rendered${full ? `; full reading ${full.seconds}s at ${full.wav}` : ""})`);
}
if (o.batch) {
  writeFileSync(join(outRoot, "batch.json"), JSON.stringify({ created: new Date().toISOString(), backend: o.backend, wallSeconds, readings: summary }, null, 2));
  console.log(`batch: ${summary.length} readings in ${wallSeconds}s -> ${join(outRoot, "batch.json")}`);
}
if (failed || runError) process.exitCode = 1;
