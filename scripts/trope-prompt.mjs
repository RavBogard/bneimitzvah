#!/usr/bin/env node
// Make a SoulX-Singer prompt from any sung recording (renderer ladder step 2, design spec §6): mono,
// trim, loudness-normalize, 24 kHz WAV, plus prompt metadata (notes, phonemes, durations, f0) from
// SoulX's own RMVPE + ROSVOT models, through trope/soulx_prompt.py. Runs on the CPU unless --gpu.
//   node scripts/trope-prompt.mjs --in <wav> [--name NAME] [--out-dir DIR]
//     [--lyric "english words sung" | --tokens "en_D-OW1 en_N-AA0 ..." | --vowel AA]
//     [--start S] [--end S] [--max-seconds 30] [--lufs -18] [--no-trim] [--no-normalize]
//     [--word-threshold 0.5] [--note-threshold 0.85] [--compare ref.json [--compare-offset S]] [--gpu]
// Writes <out-dir>/<name>.wav and <out-dir>/<name>.json (default out-dir C:\Users\dsbog\haftarah-audio\prompts),
// prints a sanity report, and checks the JSON the way trope-render.mjs will. Then:
//   node scripts/trope-render.mjs --ref "..." --prompt <name>.wav --prompt-meta <name>.json
// Environment: HAFTARAH_SOULX_ENV (venv\ + SoulX-Singer\) and HAFTARAH_SOULX_PREPROCESS (rmvpe\ + rosvot\
// from huggingface.co/Soul-AILab/SoulX-Singer-Preprocess); both live outside the repo.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { parsePromptCli, promptArgv, promptName, checkPromptMeta } from "../trope/prompt.mjs";

// Everything heavy lives outside the repo; HAFTARAH_AUDIO moves it (e.g. to another machine).
const AUDIO_ROOT = process.env.HAFTARAH_AUDIO || join(homedir(), "haftarah-audio");
const ENV = process.env.HAFTARAH_SOULX_ENV || join(AUDIO_ROOT, "soulx-env");
const MODELS = process.env.HAFTARAH_SOULX_PREPROCESS || join(AUDIO_ROOT, "soulx-preprocess");
const REPO = join(ENV, "SoulX-Singer");
const PYTHON = join(ENV, "venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");

let opts;
try {
  opts = parsePromptCli(process.argv.slice(2));
  if (!opts.in) throw new Error("--in <wav> is required");
} catch (e) {
  console.error(`${e.message}\nusage: node scripts/trope-prompt.mjs --in <wav> [--name NAME] [--out-dir DIR] [--lyric "..." | --tokens "..." | --vowel AA] [--start S] [--end S] [--max-seconds 30] [--lufs -18] [--no-trim] [--no-normalize] [--compare ref.json] [--gpu]`);
  process.exit(2);
}
opts.in = resolve(opts.in);
opts.name ||= promptName(opts.in);
opts.outDir = resolve(opts.outDir || join(AUDIO_ROOT, "prompts"));
if (opts.compare) opts.compare = resolve(opts.compare);

const need = [["input", opts.in], ["python (HAFTARAH_SOULX_ENV)", PYTHON], ["SoulX-Singer clone", REPO],
  ["RMVPE (HAFTARAH_SOULX_PREPROCESS)", join(MODELS, "rmvpe", "rmvpe.pt")],
  ["ROSVOT", join(MODELS, "rosvot", "rosvot", "model.pt")], ["ROSVOT RWBD", join(MODELS, "rosvot", "rwbd", "model.pt")],
  ["ROSVOT's RMVPE", join(MODELS, "rosvot", "rmvpe", "model.pt")]];
for (const [what, p] of need) if (!existsSync(p)) { console.error(`missing ${what}: ${p}`); process.exit(1); }

const script = fileURLToPath(new URL("../trope/soulx_prompt.py", import.meta.url));
const argv = promptArgv(opts, { script, repo: REPO, models: MODELS });
// CPU by default: prompt prep must never compete with a render for the 6 GB card.
const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", PYTHONWARNINGS: "ignore", ...(opts.gpu ? {} : { CUDA_VISIBLE_DEVICES: "" }) };
let report = null;
const code = await new Promise((ok, fail) => {
  const py = spawn(PYTHON, argv, { env, stdio: ["ignore", "pipe", "inherit"] });
  let buf = "";
  py.stdout.on("data", d => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
      if (line.startsWith("@@ ")) report = JSON.parse(line.slice(3)); else console.log(line);
    }
  });
  py.on("error", fail);
  py.on("close", ok);
});
if (code !== 0 || !report) { console.error(`soulx_prompt.py exited with ${code}`); process.exit(1); }

const phoneSetPath = join(REPO, "soulxsinger", "utils", "phoneme", "phone_set.json");
const phoneSet = existsSync(phoneSetPath) ? new Set(JSON.parse(readFileSync(phoneSetPath, "utf8"))) : null;
const check = checkPromptMeta(JSON.parse(readFileSync(report.json, "utf8")), { phoneSet });
for (const e of check.errors) console.error(`ERROR      : ${e}`);
if (check.errors.length) process.exit(1);
console.log(`render with: node scripts/trope-render.mjs --ref "<ref>" --prompt "${report.wav}" --prompt-meta "${report.json}"`);
