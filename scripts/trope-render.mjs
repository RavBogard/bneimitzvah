#!/usr/bin/env node
// Render a reading to sung audio with SoulX-Singer (renderer ladder step 2, design spec §6): fetch the
// MAM text, score every verse, write each verse's SoulX metadata, and render all verses in one Python
// process (one model load) through trope/soulx_runner.py.
//   node scripts/trope-render.mjs --ref "I Samuel 20:18-42" [--table trope/cells/haftarah.json] [--key D4]
//     [--tempo 96] [--prompt <wav> --prompt-meta <json>] [--chet en|zh] [--out <dir>] [--limit N]
//     [--gap 0.6] [--full <wav>] [--cpu] [--dry-run]
// Writes <out>/<NN>-<ref-slug>.wav, <out>/json/<NN>-<ref-slug>.json, <out>/<reading-slug>-full.wav (all
// verses with --gap s between them) and <out>/manifest.json. --dry-run writes the JSON and stops.
// The environment lives outside the repo (C:\Users\dsbog\haftarah-audio\soulx-env\README.md); override
// it with HAFTARAH_SOULX_ENV (the folder holding venv\ and SoulX-Singer\) and HAFTARAH_SOULX_MODEL.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { scoreVerse } from "../trope/melody.mjs";
import { verseUnits } from "../trope/text.mjs";
import { fetchReading } from "../trope/sefaria.mjs";
import { scoreToSoulx, soulxSummary, MAX_SEGMENT_SECONDS } from "../trope/soulx.mjs";

const AUDIO_ROOT = "C:\\Users\\dsbog\\haftarah-audio";
const ENV = process.env.HAFTARAH_SOULX_ENV || join(AUDIO_ROOT, "soulx-env");
const MODEL = process.env.HAFTARAH_SOULX_MODEL || join(AUDIO_ROOT, "soulx", "model.pt");
const REPO = join(ENV, "SoulX-Singer");
const PYTHON = join(ENV, "venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");

const args = process.argv.slice(2);
const opt = name => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const ref = opt("--ref");
if (!ref) {
  console.error('usage: node scripts/trope-render.mjs --ref "Book c:v-c:v" [--table path] [--key D4] [--tempo 96] [--prompt wav --prompt-meta json] [--chet en|zh] [--out dir] [--limit N] [--gap 0.6] [--full wav] [--cpu] [--dry-run]');
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const chet = opt("--chet") || "en";
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const tablePath = opt("--table") || fileURLToPath(new URL("../trope/cells/haftarah.json", import.meta.url));
const table = JSON.parse(readFileSync(tablePath, "utf8"));
const scoreOpts = { table, key: opt("--key") || "D4", tempo: Number(opt("--tempo") || 96) };
const outDir = resolve(opt("--out") || join(AUDIO_ROOT, "renders", slug(ref)));

// The shipped example prompt is a separated stem of a commercial pop recording (voice-feasibility.md
// §1a): fine to test mechanics, never to publish.
const promptWav = opt("--prompt") || join(REPO, "example", "audio", "en_prompt.mp3");
const promptMeta = opt("--prompt-meta") || join(REPO, "example", "audio", "en_prompt.json");
const defaultPrompt = !opt("--prompt");
if (opt("--prompt") && !opt("--prompt-meta")) { console.error("--prompt needs --prompt-meta (SoulX conditions on the prompt's notes and phonemes too)"); process.exit(2); }

const fetched = await fetchReading(ref);
const limit = opt("--limit") ? Number(opt("--limit")) : fetched.length;
mkdirSync(join(outDir, "json"), { recursive: true });

const verses = fetched.slice(0, limit).map((v, i) => {
  // The end-of-reading cadence belongs to the reading's real last verse, also under --limit.
  const units = { ...verseUnits(v.he, { final: i === fetched.length - 1 }), ref: v.ref };
  const score = scoreVerse(units, scoreOpts);
  const segments = scoreToSoulx(score, { chet });
  const name = `${String(i + 1).padStart(2, "0")}-${slug(v.ref)}`;
  const json = join(outDir, "json", `${name}.json`);
  writeFileSync(json, JSON.stringify(segments, null, 2));
  const sum = soulxSummary(segments);
  const fallback = score.units.filter(u => u.cell.fallback).length;
  console.log(`${name.padEnd(26)} ${String(sum.notes).padStart(3)} notes ${sum.seconds.toFixed(2).padStart(6)}s${sum.segments > 1 ? `  split into ${sum.segments} segments at phrase breaks (> ${MAX_SEGMENT_SECONDS}s)` : ""}${fallback ? `  ${fallback} words on the fallback reciting tone` : ""}`);
  return { ref: v.ref, json, wav: join(outDir, `${name}.wav`), scoreSeconds: score.seconds, ...sum };
});
const totalSeconds = verses.reduce((s, v) => s + v.seconds, 0);
console.log(`${verses.length} verses, ${Math.round(totalSeconds)}s of chant; metadata in ${join(outDir, "json")}`);
if (dryRun) process.exit(0);

if (defaultPrompt) console.warn("WARNING: default prompt = SoulX's example en_prompt, a separated stem of a commercial pop recording. Internal tests only: do not publish these renders.");
for (const [what, p] of [["python (HAFTARAH_SOULX_ENV)", PYTHON], ["SoulX-Singer clone", REPO], ["checkpoint (HAFTARAH_SOULX_MODEL)", MODEL], ["prompt wav", promptWav], ["prompt metadata", promptMeta]]) {
  if (!existsSync(p)) { console.error(`missing ${what}: ${p}`); process.exit(1); }
}

const fullWav = resolve(opt("--full") || join(outDir, `${slug(ref)}-full.wav`));
const jobsPath = join(outDir, "jobs.json");
writeFileSync(jobsPath, JSON.stringify({
  repo: REPO, model: MODEL,
  config: join(REPO, "soulxsinger", "config", "soulxsinger.yaml"),
  phoneset: join(REPO, "soulxsinger", "utils", "phoneme", "phone_set.json"),
  prompt_wav: resolve(promptWav), prompt_meta: resolve(promptMeta),
  device: args.includes("--cpu") ? "cpu" : "cuda", fp16: !args.includes("--cpu"),
  jobs: verses.map(v => ({ meta: v.json, wav: v.wav })),
  concat: { out: fullWav, gap: Number(opt("--gap") || 0.6) },
}, null, 2));

// Run the runner, echo its log, and collect its "@@ {json}" result lines.
const runner = fileURLToPath(new URL("../trope/soulx_runner.py", import.meta.url));
const started = Date.now();
const results = [];
await new Promise((ok, fail) => {
  const py = spawn(PYTHON, [runner, jobsPath], { env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, stdio: ["ignore", "pipe", "inherit"] });
  let buf = "";
  py.stdout.on("data", d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
      if (!line.startsWith("@@ ")) { console.log(line); continue; }
      const r = JSON.parse(line.slice(3));
      results.push(r);
      if (r.event === "verse") {
        const v = verses[r.i];
        console.log(r.wav ? `[${r.i + 1}/${verses.length}] ${v.ref}: ${r.seconds}s rendered in ${r.render_s}s` : `[${r.i + 1}/${verses.length}] ${v.ref}: FAILED ${r.error}`);
      } else console.log(`${r.event}: ${JSON.stringify(r)}`);
    }
  });
  py.on("error", fail);
  py.on("close", code => code === 0 ? ok() : fail(new Error(`soulx_runner exited with ${code}`)));
}).catch(e => { console.error(e.message); process.exitCode = 1; });

const byIndex = new Map(results.filter(r => r.event === "verse").map(r => [r.i, r]));
const loaded = results.find(r => r.event === "loaded");
const memory = results.find(r => r.event === "memory");
const concat = results.find(r => r.event === "concat");
const manifest = {
  ref, created: new Date().toISOString(), table: table.name || tablePath, key: scoreOpts.key, tempo: scoreOpts.tempo, chet,
  prompt: { wav: resolve(promptWav), meta: resolve(promptMeta), publishable: !defaultPrompt },
  model: MODEL, env: ENV, loadSeconds: loaded?.load_s ?? null, memory: memory ?? null,
  wallSeconds: Math.round((Date.now() - started) / 1000),
  full: concat ? { wav: concat.wav, seconds: concat.seconds, verses: concat.verses } : null,
  verses: verses.map((v, i) => {
    const r = byIndex.get(i) || {};
    return { ref: v.ref, wav: r.wav ?? null, json: v.json, seconds: r.seconds ?? null, scoreSeconds: v.seconds, notes: v.notes, segments: v.segments, renderSeconds: r.render_s ?? null, ...(r.error ? { error: r.error } : {}) };
  }),
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const failed = manifest.verses.filter(v => !v.wav).length;
console.log(`manifest: ${join(outDir, "manifest.json")} (${verses.length - failed}/${verses.length} rendered in ${manifest.wallSeconds}s${concat ? `; full reading ${concat.seconds}s at ${concat.wav}` : ""})`);
if (failed) process.exitCode = 1;
