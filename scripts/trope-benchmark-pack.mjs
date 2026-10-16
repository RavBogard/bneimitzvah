#!/usr/bin/env node
// Prepare private targets only; never fetch, load a model, run Python or render.
import { execFile } from "node:child_process";
import { open, lstat, realpath, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, basename, resolve, relative, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BENCHMARK_LIMITS, BENCHMARK_TABLES, BenchmarkPackError, buildBenchmarkPack, canonicalJson, sha256 } from "../trope/benchmark-pack.mjs";

const REPOSITORY = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const rejected = code => { throw new BenchmarkPackError(code); };
const within = (root, path) => { const rest = relative(root, path); return !rest || !isAbsolute(rest) && rest !== ".." && !rest.startsWith(`..${sep}`); };
const PATH_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,47}\/(?:units|score|a-soulx-target|b-speech-plan|identity-map)\.json$/;
const USAGE = "usage: node scripts/trope-benchmark-pack.mjs --input <private-input.json> --input-sha256 <64-hex> --out <new-private-directory>";

async function boundedRead(path, limit) {
  let handle;
  try {
    handle = await open(path, "r"); const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) rejected("input-bounds");
    const buffer = Buffer.alloc(limit + 1); let length = 0;
    while (length < buffer.length) { const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length); if (!bytesRead) break; length += bytesRead; }
    if (length > limit) rejected("input-bounds");
    return buffer.subarray(0, length);
  } catch (error) { if (error instanceof BenchmarkPackError) throw error; rejected("input-read"); }
  finally { await handle?.close(); }
}

/** Existing parent must resolve outside this checkout; destination must not exist. */
export async function privateBenchmarkDestination(destination) {
  try {
    if (typeof destination !== "string" || !destination.trim() || /[\u0000-\u001f]/u.test(destination)) rejected("destination");
    const requested = resolve(destination), repository = await realpath(REPOSITORY);
    if (within(resolve(REPOSITORY), requested) || within(repository, requested)) rejected("destination-repository");
    try { await lstat(requested); rejected("destination-exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    const parent = await realpath(dirname(requested));
    if (within(repository, parent)) rejected("destination-repository");
    const target = join(parent, basename(requested));
    if (within(repository, target)) rejected("destination-repository");
    try { await lstat(target); rejected("destination-exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return target;
  } catch (error) { if (error instanceof BenchmarkPackError) throw error; rejected("destination"); }
}

async function codeRevision() {
  try {
    const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR"]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY, env, encoding: "utf8", timeout: 5000, maxBuffer: 1024, windowsHide: true });
    const revision = stdout.trim(); if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)) rejected("code-revision"); return revision;
  } catch { rejected("code-revision"); }
}
export async function loadBenchmarkAssets(tableName, inputFileSha256) {
  try {
    if (!Object.hasOwn(BENCHMARK_TABLES, tableName)) rejected("performance");
    const files = {}, paths = ["trope/text.mjs", "trope/lib-trope.cjs", "trope/melody.mjs", "trope/soulx.mjs", "trope/speech2sing.mjs", "trope/benchmark-pack.mjs", "scripts/trope-benchmark-pack.mjs"];
    const vendor = async path => {
      for (const entry of (await readdir(join(REPOSITORY, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const child = `${path}/${entry.name}`;
        if (entry.isDirectory()) await vendor(child);
        else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) paths.push(child);
        else if (entry.isSymbolicLink()) rejected("code-files");
      }
    };
    await vendor("trope/vendor/havarotjs");
    let total = 0;
    for (const path of paths) {
      const bytes = await boundedRead(join(REPOSITORY, path), BENCHMARK_LIMITS.assetBytes - total); total += bytes.length;
      files[path] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    return { tableJson: new TextDecoder("utf-8", { fatal: true }).decode(await boundedRead(join(REPOSITORY, "trope", "cells", `${tableName}.json`), BENCHMARK_LIMITS.assetBytes)),
      pronunciationJson: new TextDecoder("utf-8", { fatal: true }).decode(await boundedRead(join(REPOSITORY, "trope/pronunciation.json"), BENCHMARK_LIMITS.assetBytes)),
      code: { revision: await codeRevision(), files }, inputFileSha256 };
  } catch (error) { if (error instanceof BenchmarkPackError) throw error; rejected("assets-read"); }
}

function validatePack(pack) {
  try {
    if (!pack || !pack.artifacts || !pack.manifest || pack.manifest.schema !== "chant-benchmark-pack/v1" || pack.manifest.releaseStatus !== "private-unreleased"
      || pack.manifest.targetReview !== "pending" || pack.artifacts["manifest.json"] !== canonicalJson(pack.manifest)
      || sha256(pack.artifacts["manifest.json"]) !== pack.manifestSha256) rejected("output-pack");
    const entries = Object.entries(pack.artifacts), recorded = pack.manifest.artifacts;
    if (entries.length < 6 || entries.length > 1 + BENCHMARK_LIMITS.passages * 5 || Object.keys(recorded).length !== entries.length - 1) rejected("output-pack");
    let size = 0; const paths = new Set();
    for (const [path, data] of entries) {
      if (typeof data !== "string" || path !== "manifest.json" && (!PATH_PATTERN.test(path) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\//i.test(path))) rejected("output-path");
      const bytes = Buffer.byteLength(data); size += bytes;
      if (paths.has(path.toLowerCase())) rejected("output-path"); paths.add(path.toLowerCase());
      if (size > BENCHMARK_LIMITS.outputBytes || path !== "manifest.json" && (recorded[path]?.sha256 !== sha256(data) || recorded[path]?.bytes !== bytes)) rejected("output-hash");
    }
  } catch (error) { if (error instanceof BenchmarkPackError) throw error; rejected("output-pack"); }
}

/** Fully validate before creation. Failed writes retain partial output for inspection. */
export async function writeBenchmarkPack(pack, destination) {
  validatePack(pack);
  const target = await privateBenchmarkDestination(destination);
  try {
    await mkdir(target, { mode: 0o700 });
    const assertDirectory = async path => {
      if (await realpath(path) !== path || within(await realpath(REPOSITORY), path)) rejected("output-directory");
    };
    await assertDirectory(target);
    const directories = new Set();
    // A manifest is written last so partial output cannot look like a full pack.
    const entries = Object.entries(pack.artifacts).sort(([a], [b]) => a === "manifest.json" ? 1 : b === "manifest.json" ? -1 : a.localeCompare(b));
    for (const [path, data] of entries) {
      await assertDirectory(target);
      const folder = dirname(path), directory = folder === "." ? target : join(target, folder);
      if (folder !== "." && !directories.has(folder)) { await mkdir(directory, { mode: 0o700 }); directories.add(folder); }
      await assertDirectory(directory);
      await writeFile(join(directory, basename(path)), data, { flag: "wx", mode: 0o600 });
    }
    await assertDirectory(target);
    return { manifestSha256: pack.manifestSha256, artifacts: entries.length };
  } catch { rejected("output-write"); }
}

export async function benchmarkPackMain(argv) {
  try {
    if (argv.length === 1 && argv[0] === "--help") { console.log(USAGE); return 0; }
    if (argv.length !== 6) rejected("arguments");
    const options = {};
    for (let i = 0; i < argv.length; i += 2) {
      if (!["--input", "--input-sha256", "--out"].includes(argv[i]) || options[argv[i]] !== undefined || !argv[i + 1] || argv[i + 1].startsWith("--")) rejected("arguments");
      options[argv[i]] = argv[i + 1];
    }
    if (!/^[a-f0-9]{64}$/.test(options["--input-sha256"])) rejected("input-hash");
    await privateBenchmarkDestination(options["--out"]);
    const bytes = await boundedRead(options["--input"], BENCHMARK_LIMITS.inputBytes);
    if (sha256(bytes) !== options["--input-sha256"]) rejected("input-hash");
    let input;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { rejected("input-json"); }
    const assets = await loadBenchmarkAssets(input?.performance?.table, sha256(bytes));
    const pack = buildBenchmarkPack(input, assets);
    await writeBenchmarkPack(pack, options["--out"]);
    console.log("Private unreleased target pack prepared. Target review remains pending; no audio was rendered.");
    console.log(`Manifest SHA-256: ${pack.manifestSha256}`);
    return 0;
  } catch (error) {
    console.error(error instanceof BenchmarkPackError ? error.message : "Benchmark target pack failed; private details withheld");
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await benchmarkPackMain(process.argv.slice(2));
