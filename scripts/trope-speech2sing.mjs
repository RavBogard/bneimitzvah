#!/usr/bin/env node
// Speech-to-singing renders (voice-quality.md path 1): a Hebrew TTS speaks each phrase from our own phonemes and
// stress, is re-timed to the score inside the TTS, and SoulX-Singer-SVC re-sings it with the score's f0 and a
// sung prompt. One folder per verse, every stage kept so each can be heard:
//   node scripts/trope-speech2sing.mjs --ref "I Samuel 20:18" [--key D3] [--tempo 96] [--style v2]
//     [--voice michael] [--prompt <wav> --prompt-meta <json>] [--out <dir>] [--stage all|tts|svc]
//     [--source timed|world] [--steps 32] [--cfg 3] [--cpu] [--max-cons 0.6]
// Writes <out>/<NN>-<verse-slug>/{plan.json, 01-raw-tts.wav, 02-timed-speech.wav, 02-world-stretch.wav,
// target_f0.npy, align.json, 03-sung-svc.wav, pitch.json} and <out>/manifest.json (one wav per verse: the
// sung one, for trope/asr_cer.py).
// Environments live outside the repo: the TTS venv and voice in <audio>/tts-env (Phonikud-TTS, ONNX, CPU),
// SVC in <audio>/soulx-env with the checkpoint <audio>/soulx-svc/model-svc.pt. Setup:
// docs/superpowers/plans/2026-10-15-trope-home-setup.md, "Speech-to-singing".
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { scoreVerse } from "../trope/melody.mjs";
import { verseUnits } from "../trope/text.mjs";
import { fetchReading } from "../trope/sefaria.mjs";
import { scoreToSoulx, SOULX_STYLES } from "../trope/soulx.mjs";
import { buildPlan, scoreF0, parseS2sArgs, S2S_USAGE } from "../trope/speech2sing.mjs";

const AUDIO = process.env.HAFTARAH_AUDIO || join(homedir(), "haftarah-audio");
const exe = (venv) => join(venv, "venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
const TTS_ENV = process.env.HAFTARAH_TTS_ENV || join(AUDIO, "tts-env");
const SOULX_ENV = process.env.HAFTARAH_SOULX_ENV || join(AUDIO, "soulx-env");
const SVC_MODEL = process.env.HAFTARAH_SOULX_SVC_MODEL || join(AUDIO, "soulx-svc", "model-svc.pt");
const here = p => fileURLToPath(new URL(p, import.meta.url));

let o;
try { o = parseS2sArgs(process.argv.slice(2)); } catch (e) { console.error(`${e.message}\n${S2S_USAGE}`); process.exit(2); }
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const outRoot = resolve(o.out || join(AUDIO, "renders", "s2s"));
const promptWav = o.prompt || join(AUDIO, "prompts", "vocalset-m6-dona.wav");
const promptMeta = o.promptMeta || join(AUDIO, "prompts", "vocalset-m6-dona.json");
const table = JSON.parse(readFileSync(o.table || here("../trope/cells/haftarah.json"), "utf8"));
const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };

function py(python, args, opts = {}) {
  console.log(`> ${[python, ...args].join(" ")}`);
  const r = spawnSync(python, args, { stdio: "inherit", env, ...opts });
  if (r.status !== 0) { console.error(`failed (${r.status ?? r.error})`); process.exit(1); }
}

const fetched = await fetchReading(o.ref);
mkdirSync(outRoot, { recursive: true });
const verses = [];
for (const [i, v] of fetched.entries()) {
  const dir = join(outRoot, `${String(i + 1).padStart(2, "0")}-${slug(v.ref)}`);
  mkdirSync(dir, { recursive: true });
  const units = { ...verseUnits(v.he, { final: false }), ref: v.ref };
  const score = scoreVerse(units, { table, key: o.key, tempo: o.tempo });
  const segments = scoreToSoulx(score, { ...SOULX_STYLES[o.style] });
  const plan = buildPlan(score, segments, { units });
  plan.f0 = scoreF0(plan.notes, { seconds: plan.seconds });
  plan.style = o.style;
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 1));
  console.log(`${v.ref}: ${plan.phrases.length} phrases, ${plan.seconds}s`);
  plan.phrases.forEach(p => console.log(`  ${p.start.toFixed(2)}-${p.end.toFixed(2)}  ${p.text}`));
  verses.push({ ref: v.ref, dir, plan });
}

const voiceModel = join(TTS_ENV, "models", `${o.voice}.onnx`);
if (o.stage !== "svc") {
  for (const p of [exe(TTS_ENV), voiceModel]) if (!existsSync(p)) { console.error(`missing ${p} (see the setup plan, "Speech-to-singing")`); process.exit(1); }
  for (const v of verses) {
    py(exe(TTS_ENV), [here("../trope/speech2sing.py"), join(v.dir, "plan.json"), v.dir, "--model", voiceModel,
      "--config", join(TTS_ENV, "models", "model.config.json"), "--prompt-meta", promptMeta, "--max-cons", String(o.maxCons)]);
  }
}
if (o.stage !== "tts") {
  for (const p of [exe(SOULX_ENV), SVC_MODEL, promptWav]) if (!existsSync(p)) { console.error(`missing ${p}`); process.exit(1); }
  const src = o.source === "world" ? "02-world-stretch-24k.wav" : "02-timed-speech-24k.wav";
  const jobs = {
    repo: join(SOULX_ENV, "SoulX-Singer"), model: SVC_MODEL, prompt_wav: promptWav,
    device: o.cpu ? "cpu" : "cuda", fp16: !o.cpu, n_steps: o.steps, cfg: o.cfg,
    jobs: verses.map(v => ({ wav: join(v.dir, src), f0: join(v.dir, "target_f0.npy"), prompt_f0: join(v.dir, "prompt_f0.npy"),
      out: join(v.dir, o.source === "world" ? "03-sung-svc-world.wav" : "03-sung-svc.wav") })),
  };
  const jobsPath = join(outRoot, "svc-jobs.json");
  writeFileSync(jobsPath, JSON.stringify(jobs, null, 1));
  py(exe(SOULX_ENV), [here("../trope/soulx_svc_runner.py"), jobsPath], { cwd: jobs.repo, env: { ...env, PYTHONPATH: jobs.repo } });
  for (const v of verses) {
    const wav = jobs.jobs.find(j => j.f0.startsWith(v.dir)).out;
    py(exe(TTS_ENV), [here("../trope/s2s_pitch.py"), join(v.dir, "plan.json"), wav, "--json", join(v.dir, `pitch-${o.source}.json`)]);
  }
}
const manifest = { ref: o.ref, created: new Date().toISOString(), engine: "s2s", voice: o.voice, style: o.style, key: o.key, tempo: o.tempo,
  prompt: promptWav, source: o.source,
  verses: verses.map(v => ({ ref: v.ref, dir: v.dir, wav: join(v.dir, o.source === "world" ? "03-sung-svc-world.wav" : "03-sung-svc.wav"), seconds: v.plan.seconds })) };
writeFileSync(join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 1));
await new Promise(r => setTimeout(r, 100));   // let fetch's sockets close (libuv assert on Windows)
