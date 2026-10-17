#!/usr/bin/env node
// Retime one reviewed private spoken recording onto one private benchmark target (lane B-human).
// Never fetches, loads a model, runs Python or renders a neural voice. Inputs and output must lie
// outside this checkout; the original recording is read, hashed and left untouched.
import { open, realpath, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { dirname, basename, resolve, relative, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { privateBenchmarkDestination } from "./trope-benchmark-pack.mjs";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { sha256 } from "../trope/benchmark-pack.mjs";
import { parseWav, WAV_LIMITS } from "../trope/audio-dsp.mjs";
import { ALIGNMENT_LIMITS } from "../trope/human-alignment.mjs";
import { buildHumanRetime, OUTPUT_RATES, VOICELESS } from "../trope/human-retime.mjs";
import { buildRunRecord } from "../trope/benchmark-run.mjs";

const REPOSITORY = fileURLToPath(new URL("../", import.meta.url));
// Every module the retime path loads, directly or through the target-pack and text code it imports.
const CODE_FILES = ["trope/audio-dsp.mjs", "trope/human-alignment.mjs", "trope/human-retime.mjs", "trope/benchmark-run.mjs", "trope/benchmark-pack.mjs",
  "trope/speech2sing.mjs", "trope/text.mjs", "trope/melody.mjs", "trope/soulx.mjs", "trope/lib-trope.cjs", "trope/pronunciation.json",
  "scripts/trope-human-retime.mjs", "scripts/trope-benchmark-pack.mjs", "scripts/private-paths.mjs"];
const USAGE = "usage: node scripts/trope-human-retime.mjs --pack <private-pack-dir> --pack-manifest-sha256 <64-hex> --alignment <private.json> --alignment-sha256 <64-hex> --audio <private.wav> --out <new-private-directory> [--output-rate 24000] [--min-consonant-ratio 0.5] [--voiced-phones h]";
const OUTPUT_PATH = /^(?:retimed-speech\.wav|target-f0\.npy|f0-voicing\.json|retime-map\.json|manifest\.json|slices\/s(?:[0-9]|[1-9][0-9])(?:\.wav|-f0\.npy))$/;
const run = promisify(execFile);

export class RetimeCliError extends Error {
  constructor(code) { super(`Human retiming failed (${code}); private details withheld`); this.name = "RetimeCliError"; this.code = code; }
}
const rejected = code => { throw new RetimeCliError(code); };
const within = (root, path) => { const rest = relative(root, path); return !rest || !isAbsolute(rest) && rest !== ".." && !rest.startsWith(`..${sep}`); };

/** An existing private input file whose lexical and resolved locations lie outside every Git working tree. */
async function privateInput(path, limit) {
  let handle;
  try {
    if (typeof path !== "string" || !path.trim() || /[\u0000-\u001f]/u.test(path)) rejected("input-path");
    const lexical = resolve(path), repository = await realpath(REPOSITORY), real = await realpath(lexical);
    if (within(resolve(REPOSITORY), lexical) || within(repository, real) || await insideGitWorkingTree(lexical) || await insideGitWorkingTree(real)) rejected("input-repository");
    // Open the resolved path that was checked; a hard link could alias a file inside a checkout.
    handle = await open(real, "r"); const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) rejected("input-repository");
    if (stat.size > limit) rejected("input-bounds");
    const buffer = Buffer.alloc(stat.size); let length = 0;
    while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
    if (length !== stat.size) rejected("input-read");
    return buffer;
  } catch (error) { if (error instanceof RetimeCliError) throw error; rejected("input-read"); }
  finally { await handle?.close(); }
}

async function codeAssets() {
  try {
    const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR"]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY, env, encoding: "utf8", timeout: 5000, maxBuffer: 1024, windowsHide: true });
    const revision = stdout.trim(); if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) rejected("code-revision");
    const fileHashes = {}, paths = [...CODE_FILES];
    const vendor = async path => {
      for (const entry of (await readdir(join(REPOSITORY, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) await vendor(`${path}/${entry.name}`); else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) paths.push(`${path}/${entry.name}`);
      }
    };
    await vendor("trope/vendor/havarotjs");
    for (const path of paths) fileHashes[path] = sha256(await readFile(join(REPOSITORY, path)));
    return { revision, revisionMeaning: "repository HEAD only; fileHashes identify the working sources actually used", fileHashes };
  } catch (error) { if (error instanceof RetimeCliError) throw error; rejected("code-revision"); }
}

/** Exclusive writes, deterministic artifacts first, manifest last, then the run record. */
export async function writeRetime(result, runRecord, destination) {
  const entries = Object.entries(result.artifacts);
  if (!entries.length || entries.some(([path, bytes]) => !OUTPUT_PATH.test(path) || !(bytes instanceof Uint8Array))
    || sha256(result.artifacts["manifest.json"] ?? "") !== result.manifestSha256) rejected("output-pack");
  for (const [path, bytes] of entries) if (path !== "manifest.json" && result.manifest.artifacts[path]?.sha256 !== sha256(bytes)) rejected("output-hash");
  const target = await privateBenchmarkDestination(destination);
  try {
    const repository = await realpath(REPOSITORY);
    const assertDirectory = async path => { if (await realpath(path) !== path || within(repository, path)) rejected("output-directory"); };
    await mkdir(target, { mode: 0o700 }); await assertDirectory(target);
    const ordered = entries.sort(([a], [b]) => a === "manifest.json" ? 1 : b === "manifest.json" ? -1 : a.localeCompare(b));
    const made = new Set();
    for (const [path, bytes] of ordered) {
      const folder = dirname(path), directory = folder === "." ? target : join(target, folder);
      if (folder !== "." && !made.has(folder)) { await mkdir(directory, { mode: 0o700 }); made.add(folder); }
      await assertDirectory(directory);
      await writeFile(join(directory, basename(path)), bytes, { flag: "wx", mode: 0o600 });
    }
    await writeFile(join(target, "run-record.json"), runRecord.bytes, { flag: "wx", mode: 0o600 });
    return target;
  } catch (error) { if (error instanceof RetimeCliError) throw error; rejected("output-write"); }
}

export async function humanRetimeMain(argv) {
  const startedAt = new Date(), clock = performance.now();
  try {
    if (argv.length === 1 && argv[0] === "--help") { console.log(USAGE); return 0; }
    const names = ["--pack", "--pack-manifest-sha256", "--alignment", "--alignment-sha256", "--audio", "--out", "--output-rate", "--min-consonant-ratio", "--voiced-phones"], o = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!names.includes(argv[i]) || o[argv[i]] !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--")) rejected("arguments");
      o[argv[i]] = argv[i + 1];
    }
    if (names.slice(0, 6).some(name => o[name] === undefined)) rejected("arguments");
    for (const name of ["--pack-manifest-sha256", "--alignment-sha256"]) if (!/^[a-f0-9]{64}$/.test(o[name])) rejected("input-hash");
    const outputRate = o["--output-rate"] === undefined ? 24000 : Number(o["--output-rate"]);
    if (!OUTPUT_RATES.includes(outputRate)) rejected("arguments");
    // A slow, deliberate reading holds word-final consonants (a long l, a stop's silent closure) far longer
    // than a short chant note allows; such a take may shorten them further. Recorded in the run options.
    const minConsonantRatio = o["--min-consonant-ratio"] === undefined ? undefined : Number(o["--min-consonant-ratio"]);
    if (minConsonantRatio !== undefined && !(minConsonantRatio >= 0.2 && minConsonantRatio <= 1)) rejected("arguments");
    // Phones that are voiceless by default but carry the score F0 in this run, such as h (comma-separated).
    const voicedPhones = o["--voiced-phones"] === undefined ? undefined : o["--voiced-phones"].split(",");
    if (voicedPhones !== undefined && (!voicedPhones.every(ph => VOICELESS.includes(ph)) || new Set(voicedPhones).size !== voicedPhones.length)) rejected("arguments");
    await privateBenchmarkDestination(o["--out"]);
    const manifestBytes = await privateInput(join(o["--pack"], "manifest.json"), 16 * 1024 * 1024);
    if (sha256(manifestBytes) !== o["--pack-manifest-sha256"]) rejected("input-hash");
    const alignmentBytes = await privateInput(o["--alignment"], ALIGNMENT_LIMITS.bytes);
    if (sha256(alignmentBytes) !== o["--alignment-sha256"]) rejected("input-hash");
    let manifest, record;
    try { manifest = JSON.parse(manifestBytes.toString("utf8")); record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(alignmentBytes)); } catch { rejected("input-json"); }
    const passage = Array.isArray(manifest?.passages) && manifest.passages.find(p => p?.id === record?.target?.passageId);
    if (!passage || typeof passage.directory !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(passage.directory)) rejected("stale-target");
    const identityMapBytes = await privateInput(join(o["--pack"], passage.directory, "identity-map.json"), 16 * 1024 * 1024);
    const speechPlanBytes = await privateInput(join(o["--pack"], passage.directory, "b-speech-plan.json"), 16 * 1024 * 1024);
    const audioBytes = await privateInput(o["--audio"], WAV_LIMITS.bytes);
    const wav = parseWav(new Uint8Array(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength));
    const code = await codeAssets();
    const result = buildHumanRetime(record, { manifestBytes, identityMapBytes, speechPlanBytes }, { bytes: audioBytes, wav },
      { code, alignmentFileSha256: o["--alignment-sha256"], options: { outputRate, ...(minConsonantRatio === undefined ? {} : { minConsonantRatio }), ...(voicedPhones === undefined ? {} : { voicedPhones }) } });
    const file = (role, bytes) => ({ role, sha256: sha256(bytes), bytes: bytes.length });
    const runRecord = buildRunRecord({ runId: `retime-${result.manifestSha256.slice(0, 16)}`, lane: "B-human", stage: "retime", condition: "human-retime-v1",
      benchmarkId: record.target.benchmarkId, packManifestSha256: o["--pack-manifest-sha256"], passageId: record.target.passageId,
      inputs: [file("target-pack-manifest", manifestBytes), file("identity-map", identityMapBytes), file("speech-plan", speechPlanBytes), file("alignment", alignmentBytes), file("original-speech", audioBytes)],
      outputs: [...Object.entries(result.manifest.artifacts).map(([, a]) => ({ role: a.role, sha256: a.sha256, bytes: a.bytes })), file("stage-manifest", result.artifacts["manifest.json"])],
      config: result.manifest.method, model: null, seed: { supported: false, value: null },
      host: { platform: process.platform, arch: process.arch, runtime: `node ${process.versions.node}`, gpu: null, gpuMemoryMiB: null },
      attempts: [{ attempt: 1, status: "succeeded", startedAt: startedAt.toISOString(), wallMs: Math.round(performance.now() - clock),
        peakMemory: { hostRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), gpuAllocatedMiB: null, gpuReservedMiB: null, source: "node-maxrss" }, errorCode: null }] });
    // The original take is read-only here; prove it is unchanged before recording outputs.
    if (sha256(await privateInput(o["--audio"], WAV_LIMITS.bytes)) !== sha256(audioBytes)) rejected("input-changed");
    await writeRetime(result, runRecord, o["--out"]);
    console.log("Private unreleased retimed speech prepared. No neural voice was rendered; target and alignment review remain external.");
    console.log(`Stage manifest SHA-256: ${result.manifestSha256}`);
    return 0;
  } catch (error) {
    const known = ["RetimeCliError", "RetimeError", "AlignmentError", "AudioDspError", "BenchmarkPackError", "RunRecordError"].includes(error?.name);
    console.error(known ? error.message : "Human retiming failed; private details withheld");
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await humanRetimeMain(process.argv.slice(2));
