// Argument handling and backend plumbing for scripts/trope-render.mjs, kept apart so it tests without
// network, Python or Modal. Dependency-free.
import { existsSync, readFileSync } from "node:fs";
import { join, delimiter } from "node:path";

export const BACKENDS = ["local", "modal"];
export const USAGE = 'usage: node scripts/trope-render.mjs (--ref "Book c:v-c:v" | --refs "ref;ref" | --refs-file file | --year YYYY) [--table path] [--key D4] [--tempo 96] [--prompt wav --prompt-meta json] [--chet en|zh] [--out dir] [--limit N] [--gap 0.6] [--full wav] [--cpu] [--dry-run]\n  cloud: [--backend local|modal] [--gpu L4] [--max-containers 10] [--per-call 3] [--no-fp16] [--modal path-to-modal]';

export class UsageError extends Error {}

const VALUE_FLAGS = ["--ref", "--refs", "--refs-file", "--year", "--table", "--key", "--tempo", "--prompt", "--prompt-meta", "--chet", "--out", "--limit", "--gap", "--full", "--backend", "--gpu", "--max-containers", "--per-call", "--modal"];
const BOOL_FLAGS = ["--cpu", "--dry-run", "--no-fp16"];

// One reference per line (or ';'-separated); blank lines and '#' comments ignored; duplicates dropped.
export function parseRefList(text) {
  const seen = new Set(), out = [];
  for (const raw of String(text).split(/[\n;]/)) {
    const r = raw.replace(/#.*$/, "").trim();
    if (r && !seen.has(r)) { seen.add(r); out.push(r); }
  }
  return out;
}

const posInt = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${name} needs a positive integer, got "${v}"`);
  return n;
};

// argv (without node and script) -> options. Throws UsageError; never touches the network.
export function parseRenderArgs(argv, { readFile = p => readFileSync(p, "utf8") } = {}) {
  const raw = {}, flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (BOOL_FLAGS.includes(a)) flags.add(a);
    else if (VALUE_FLAGS.includes(a)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new UsageError(`${a} needs a value`);
      raw[a] = argv[++i];
    } else throw new UsageError(`unknown argument ${a}`);
  }
  const backend = raw["--backend"] || "local";
  if (!BACKENDS.includes(backend)) throw new UsageError(`--backend must be one of ${BACKENDS.join(", ")}, got "${backend}"`);
  if (backend === "local") for (const f of ["--gpu", "--max-containers", "--per-call", "--modal"]) if (raw[f]) throw new UsageError(`${f} only applies with --backend modal`);
  if (backend === "local" && flags.has("--no-fp16")) throw new UsageError("--no-fp16 only applies with --backend modal (local fp16 follows --cpu)");
  if (backend === "modal" && flags.has("--cpu")) throw new UsageError("--cpu is a local-only option");

  const sources = ["--ref", "--refs", "--refs-file", "--year"].filter(f => raw[f] !== undefined);
  if (sources.length === 0) throw new UsageError("give --ref, --refs, --refs-file or --year");
  if (sources.length > 1) throw new UsageError(`${sources.join(" and ")} are alternatives; give one`);
  let refs = null, year = null;
  if (raw["--ref"]) refs = [raw["--ref"]];
  else if (raw["--refs"]) refs = parseRefList(raw["--refs"]);
  else if (raw["--refs-file"]) {
    let text;
    try { text = readFile(raw["--refs-file"]); } catch (e) { throw new UsageError(`cannot read --refs-file ${raw["--refs-file"]}: ${e.message}`); }
    refs = parseRefList(text);
  } else {
    year = Number(raw["--year"]);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new UsageError(`--year needs a Gregorian year, got "${raw["--year"]}"`);
  }
  if (refs && refs.length === 0) throw new UsageError("no references found");
  if (raw["--prompt"] && !raw["--prompt-meta"]) throw new UsageError("--prompt needs --prompt-meta (SoulX conditions on the prompt's notes and phonemes too)");
  const batch = year !== null || refs.length > 1;
  if (batch && raw["--full"]) throw new UsageError("--full names one file; with several readings each gets <out>/<slug>/<slug>-full.wav");

  return {
    backend, refs, year, batch,
    table: raw["--table"], key: raw["--key"] || "D4", tempo: Number(raw["--tempo"] || 96),
    prompt: raw["--prompt"], promptMeta: raw["--prompt-meta"], chet: raw["--chet"] || "en",
    out: raw["--out"], limit: raw["--limit"] ? Number(raw["--limit"]) : undefined, gap: Number(raw["--gap"] || 0.6), full: raw["--full"],
    cpu: flags.has("--cpu"), dryRun: flags.has("--dry-run"),
    modal: {
      gpu: raw["--gpu"] || "L4",
      maxContainers: raw["--max-containers"] ? posInt(raw["--max-containers"], "--max-containers") : 10,
      perCall: raw["--per-call"] ? posInt(raw["--per-call"], "--per-call") : 3,
      cli: raw["--modal"], fp16: !flags.has("--no-fp16"),
    },
  };
}

// The modal executable: --modal, HAFTARAH_MODAL, a dedicated venv (HAFTARAH_MODAL_ENV, or modal-env beside
// the audio folder's soulx-env), then PATH.
export function findModal({ explicit, env = process.env, audioRoot, platform = process.platform, exists = existsSync } = {}) {
  const exe = platform === "win32" ? ["modal.exe", "modal.cmd", "modal"] : ["modal"];
  const bin = platform === "win32" ? "Scripts" : "bin";
  const tried = [];
  const check = p => { tried.push(p); return exists(p) ? p : null; };
  for (const p of [explicit, env.HAFTARAH_MODAL]) if (p) { const hit = check(p); if (hit) return { path: hit, tried }; }
  const venvs = [env.HAFTARAH_MODAL_ENV, audioRoot && join(audioRoot, "modal-env")].filter(Boolean);
  for (const v of venvs) for (const e of exe) { const hit = check(join(v, bin, e)); if (hit) return { path: hit, tried }; }
  for (const d of String(env.PATH || env.Path || "").split(delimiter).filter(Boolean)) for (const e of exe) { const hit = check(join(d, e)); if (hit) return { path: hit, tried }; }
  return { path: null, tried };
}

// argv and environment for `modal run trope/modal_render.py::render --jobs <jobs.json>`.
export function modalInvocation({ modalPath, script, jobsPath, modal, env = process.env }) {
  const args = ["run", `${script}::render`, "--jobs", jobsPath, "--per-call", String(modal.perCall)];
  if (!modal.fp16) args.push("--no-fp16");
  return {
    command: modalPath, args,
    env: { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", SOULX_MODAL_GPU: modal.gpu, SOULX_MODAL_CONCURRENCY: String(modal.maxContainers), SOULX_MODAL_FP16: modal.fp16 ? "1" : "0" },
  };
}
