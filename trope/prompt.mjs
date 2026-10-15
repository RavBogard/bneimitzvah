// SoulX-Singer prompt helpers (renderer ladder step 2, design spec §6): build the argument list for
// trope/soulx_prompt.py, and check a prompt metadata file before a render spends GPU time on it.
// Pure, dependency-free ESM; the CLI is scripts/trope-prompt.mjs.
//
// What SoulX reads from a prompt (soulxsinger/utils/data_processor.py): the WAV from sample 0 and ONLY
// the first segment of the JSON (its `time` field is ignored), as parallel space-separated strings, one
// entry per note: `duration` (s), `phoneme` (`<SP>` or a phone-set token), `note_pitch` (MIDI, 0 for a
// rest), `note_type` (1 rest, 2 starts a word, 3 slur), plus `f0` at 50 frames per second.

export const F0_FPS = 50;              // 24 kHz / hop 480
export const PROMPT_SECONDS = [5, 30]; // what the model was trained on and what fits the 6 GB card

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = m => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

// The phones one token stands for: en_W-IH1-SH -> en_W en_IH1 en_SH (data_processor splits en_ tokens
// on "-"); any other token (zh_ / yue_ syllables, specials) is one phone.
export function tokenPhones(token) {
  if (token === "<SP>" || token === "<AP>") return [];
  if (token.startsWith("en_")) return token.slice(3).split("-").map(p => `en_${p}`);
  return [token];
}

// Check a parsed prompt metadata file. Returns { errors, warnings, summary }; errors mean SoulX would
// fail or misread the prompt, warnings mean it would run but probably sound worse.
export function checkPromptMeta(meta, { phoneSet = null } = {}) {
  const errors = [], warnings = [];
  if (!Array.isArray(meta) || !meta.length) return { errors: ["prompt metadata must be a non-empty list of segments"], warnings, summary: null };
  if (meta.length > 1) warnings.push(`${meta.length} segments: SoulX uses only the first as the prompt`);
  const seg = meta[0];
  for (const k of ["duration", "phoneme", "note_pitch", "note_type"]) {
    if (typeof seg[k] !== "string" || !seg[k].trim()) errors.push(`segment 0 has no "${k}" string`);
  }
  if (errors.length) return { errors, warnings, summary: null };
  const split = k => seg[k].trim().split(/\s+/);
  const dur = split("duration").map(Number), ph = split("phoneme"), pitch = split("note_pitch").map(Number), type = split("note_type").map(Number);
  const n = ph.length;
  for (const [k, a] of [["duration", dur], ["note_pitch", pitch], ["note_type", type]]) {
    if (a.length !== n) errors.push(`"${k}" has ${a.length} entries, "phoneme" has ${n}`);
  }
  if (errors.length) return { errors, warnings, summary: null };
  const bad = new Set();
  for (let i = 0; i < n; i++) {
    const rest = ph[i] === "<SP>" || ph[i] === "<AP>";
    if (!(dur[i] > 0)) errors.push(`note ${i}: duration ${dur[i]} is not positive`);
    if (![1, 2, 3].includes(type[i])) errors.push(`note ${i}: note_type ${type[i]} is not 1, 2 or 3`);
    if (!Number.isInteger(pitch[i]) || pitch[i] < 0 || pitch[i] > 127) errors.push(`note ${i}: note_pitch ${pitch[i]} is not a MIDI number`);
    if (rest && pitch[i] !== 0) warnings.push(`note ${i}: a rest with pitch ${pitch[i]}`);
    if (!rest && pitch[i] === 0) errors.push(`note ${i}: sung token ${ph[i]} with pitch 0`);
    if (!rest && type[i] === 1) errors.push(`note ${i}: sung token ${ph[i]} with note_type 1 (rest)`);
    if (type[i] === 3 && (i === 0 || ph[i - 1] !== ph[i])) warnings.push(`note ${i}: slur (type 3) that does not continue the previous note's token`);
    if (phoneSet) for (const p of tokenPhones(ph[i])) if (!phoneSet.has(p)) bad.add(p);
  }
  if (bad.size) errors.push(`not in SoulX's phone set: ${[...bad].join(" ")}`);

  const seconds = Math.round(dur.reduce((s, d) => s + d, 0) * 1000) / 1000;
  const f0 = typeof seg.f0 === "string" && seg.f0.trim() ? seg.f0.trim().split(/\s+/).map(Number) : [];
  const expected = Math.round(seconds * F0_FPS);
  if (!f0.length) warnings.push("no f0: SoulX then conditions the prompt on notes only");
  else if (Math.abs(f0.length - expected) > 2) warnings.push(`f0 has ${f0.length} frames, durations add up to ${expected} (${seconds} s)`);
  if (seconds < PROMPT_SECONDS[0]) warnings.push(`${seconds} s is short for a prompt (aim for ${PROMPT_SECONDS[0]}-${PROMPT_SECONDS[1]} s)`);
  if (seconds > PROMPT_SECONDS[1]) warnings.push(`${seconds} s is long for a prompt: attention memory grows with the square of prompt + verse length`);

  const sung = pitch.filter((p, i) => ph[i] !== "<SP>" && ph[i] !== "<AP>");
  const lo = sung.length ? Math.min(...sung) : null, hi = sung.length ? Math.max(...sung) : null;
  const summary = {
    seconds, notes: sung.length, rests: n - sung.length, words: type.filter(t => t === 2).length,
    pitchRange: sung.length ? [lo, hi] : null, pitchNames: sung.length ? [noteName(lo), noteName(hi)] : null,
    f0Frames: f0.length, voicedFraction: f0.length ? Math.round(1000 * f0.filter(x => x > 0).length / f0.length) / 1000 : null,
  };
  return { errors, warnings, summary };
}

// trope-prompt.mjs options -> soulx_prompt.py argv. `paths` = { script, repo, models }.
const VALUE_FLAGS = ["lyric", "tokens", "vowel", "language", "start", "end", "max-seconds", "lufs", "word-threshold", "note-threshold", "compare", "compare-offset"];
const BOOL_FLAGS = ["no-trim", "no-normalize"];

export function promptArgv(opts, paths) {
  if (!opts.in) throw new Error("--in <wav> is required");
  if (!opts.name) throw new Error("--name is required");
  if (opts.lyric && opts.tokens) throw new Error("--lyric and --tokens are alternatives");
  const argv = [paths.script, "--in", opts.in, "--out-dir", opts.outDir, "--name", opts.name,
    "--repo", paths.repo, "--models", paths.models, "--device", opts.gpu ? "cuda" : "cpu"];
  for (const k of VALUE_FLAGS) if (opts[k] !== undefined) argv.push(`--${k}`, String(opts[k]));
  for (const k of BOOL_FLAGS) if (opts[k]) argv.push(`--${k}`);
  return argv;
}

// Command line -> options. Unknown flags are an error, so a typo never silently changes a prompt.
export function parsePromptCli(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (BOOL_FLAGS.includes(k) || k === "gpu") { opts[k] = true; continue; }
    if (![...VALUE_FLAGS, "in", "name", "out-dir"].includes(k)) throw new Error(`unknown option ${a}`);
    if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
    opts[k === "out-dir" ? "outDir" : k] = args[++i];
  }
  return opts;
}

// A file name for the prompt from the input path: "m6_dona_straight.wav" -> "m6-dona-straight".
export const promptName = path => String(path).split(/[\\/]/).pop().replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
