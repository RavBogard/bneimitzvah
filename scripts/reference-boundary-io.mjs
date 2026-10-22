// Private-input plumbing shared by reference-boundary-metrics.mjs and reference-boundary-refine.mjs:
// ffmpeg decoding, a worker-thread pool, private-path checks and the join of the verse index with the
// aligner's syllables and phones. Nothing here prints records, Hebrew, references or paths.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { ANALYSIS } from "./reference-boundaries.mjs";

export class Refusal extends Error { constructor(code) { super(code); this.code = code; } }

/** Decode a recording exactly as align_all.py and verse_index.py did: ffmpeg, mono, 16 kHz, float32. */
export function decodeMono(path, { ffmpeg = "ffmpeg", maxSeconds = 4 * 3600 } = {}) {
  return new Promise((resolveDecode, reject) => {
    const child = spawn(ffmpeg, ["-v", "error", "-nostdin", "-i", path, "-ac", "1", "-ar", String(ANALYSIS.rate), "-f", "f32le", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const chunks = []; let bytes = 0;
    child.stdout.on("data", b => { bytes += b.length; if (bytes > maxSeconds * ANALYSIS.rate * 4) child.kill(); else chunks.push(b); });
    child.once("error", () => reject(new Refusal("decode")));
    child.once("close", code => {
      if (code !== 0 || bytes % 4 || bytes > maxSeconds * ANALYSIS.rate * 4) return reject(new Refusal("decode"));
      const all = Buffer.concat(chunks), out = new Float32Array(all.length / 4);
      for (let i = 0; i < out.length; i++) out[i] = all.readFloatLE(i * 4);
      resolveDecode(out);
    });
  });
}

export async function readJson(path, code = "input") {
  try { return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, "")); } catch { throw new Refusal(code); }
}

/** Every private input and output must lie outside every Git working tree. */
export async function assertPrivate(paths) {
  for (const p of paths) if (await insideGitWorkingTree(p)) throw new Refusal("inside-git-working-tree");
}

export function parseFlags(argv, allowed, required) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (!allowed.includes(k) || typeof v !== "string" || !v || v.startsWith("--") || Object.hasOwn(out, k.slice(2))) throw new Refusal("usage");
    out[k.slice(2)] = v;
  }
  for (const k of required) if (!Object.hasOwn(out, k)) throw new Refusal("usage");
  return out;
}

/** Run jobs on worker threads of `moduleURL` (which answers each message with one result), in job order. */
export async function runPool(moduleURL, jobs, size = Math.max(1, Math.min(12, availableParallelism() - 2))) {
  const results = new Array(jobs.length); let next = 0, failed = null;
  const lane = async () => {
    const worker = new Worker(moduleURL, { workerData: { boundaryWorker: true } });
    try {
      while (next < jobs.length && !failed) {
        const k = next++;
        results[k] = await new Promise((ok, no) => {
          const done = m => { worker.off("error", bad); m?.error ? no(new Refusal(m.error)) : ok(m); };
          const bad = () => { worker.off("message", done); no(new Refusal("worker")); };
          worker.once("message", done); worker.once("error", bad); worker.postMessage(jobs[k]);
        });
      }
    } catch (e) { failed = e; } finally { await worker.terminate(); }
  };
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, lane));
  if (failed) throw failed;
  return results;
}

/**
 * Per-word phone facts for one aligned verse: the aligner's syllable times (align/<key>.json) joined with
 * the identity map's phones (the exact sequence CTC aligned). Throws when the two disagree with the index.
 */
export async function wordFacts(alignVerse, indexVerse, cache = new Map()) {
  const load = async path => { if (!cache.has(path)) cache.set(path, readJson(path, "pack")); return cache.get(path); };
  // Paths come from private aligner output; accept only its own pack and passage naming.
  if (typeof alignVerse.pack !== "string" || !/^(?:[A-Za-z]:)?\/(?:[A-Za-z0-9_ .-]+\/)*packs\/[A-Za-z0-9_-]{1,80}-pack$/.test(alignVerse.pack) || alignVerse.pack.split("/").some(s => s === ".." || s === ".")) throw new Refusal("align-join");
  const manifest = await load(`${alignVerse.pack}/manifest.json`);
  const passage = manifest.passages.find(p => p.id === alignVerse.id);
  if (!passage || typeof passage.directory !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(passage.directory) || alignVerse.ref !== indexVerse.ref) throw new Refusal("align-join");
  const identity = await load(`${alignVerse.pack}/${passage.directory}/identity-map.json`);
  const syllables = identity.syllables;
  if (syllables.length !== alignVerse.syllables.length) throw new Refusal("align-join");
  const groups = [];
  syllables.forEach((s, k) => { if (!groups.length || groups.at(-1).id !== s.wordId) groups.push({ id: s.wordId, first: k, last: k }); else groups.at(-1).last = k; });
  if (groups.length !== indexVerse.words.length || groups.length !== alignVerse.wordStarts.length) throw new Refusal("align-join");
  return groups.map((g, j) => {
    const first = syllables[g.first].bPhones, last = syllables[g.last].bPhones, a0 = alignVerse.syllables[g.first], a1 = alignVerse.syllables[g.last];
    const ctc = indexVerse.words[j].start;
    if (Math.abs(ctc - alignVerse.wordStarts[j]) > 0.0015 || Math.abs(ctc - (a0.onset ?? a0.vowel)) > 0.0015) throw new Refusal("align-join");
    return {
      ctc, startsWithVowel: first.onset.length === 0, firstPhone: first.onset[0] ?? first.vowel[0] ?? "",
      endsWithVowel: last.coda.length === 0, firstSyllableVowel: a0.vowel ?? ctc, firstSyllableEnd: a0.end, lastSyllableVowel: a1.vowel ?? a1.onset, lastSyllableEnd: a1.end,
    };
  });
}
