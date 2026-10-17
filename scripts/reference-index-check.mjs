#!/usr/bin/env node
// Validate a private reference-audio verse index against the contract and measure what a player could
// serve: whole-verse playback and exact word highlighting against the portal's own reading words.
//
//   node scripts/reference-index-check.mjs --index <verse-index.json> --portal-words <portal-words.json>
//        --out <private dir> [--aliyah <aliyah.json>]
//
// Every input and the output directory must lie outside every Git working tree. The detailed report
// (refs, per-verse states) goes only to --out; stdout carries aggregate counts and error codes, never
// Hebrew, references, paths or source records. portal-words.json is {verses: {ref: {status, words,
// readingText}}} produced by the portal's normalizeHebrew + projectStudyVerse on MAM chapter text.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { insideGitWorkingTree } from "./private-paths.mjs";
import { validateIndex, buildVerseDto, indexWordsDigestInput, KNOWN_GAPS } from "./reference-index-contract.mjs";

const sha256 = s => createHash("sha256").update(s, "utf8").digest("hex");
class Refusal extends Error { constructor(code) { super(code); this.code = code; } }

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (!["--index", "--portal-words", "--out", "--aliyah"].includes(k) || typeof v !== "string" || !v) throw new Refusal("usage");
    out[k.slice(2)] = v;
  }
  if (!out.index || !out["portal-words"] || !out.out) throw new Refusal("usage");
  return out;
}

async function readJson(path, code) {
  try { return JSON.parse((await readFile(path, "utf8")).replace(/^﻿/, "")); } catch { throw new Refusal(code); }
}

/** Expected recording keys from PocketTorah's aliyah.json (the app's own reading table). */
export function expectedKeys(aliyah) {
  const keys = [];
  for (const p of aliyah?.parshiot?.parsha ?? []) {
    const id = String(p._id ?? "").replace(/[^A-Za-z]/g, "");
    if (!id) continue;
    for (const a of p.fullkriyah?.aliyah ?? []) if (/^[1-7]$/.test(a._num)) keys.push(`${id}-${a._num}`);
    if (p._haftara) keys.push(`${id}-h`);
  }
  return keys;
}

/** Pure measurement over parsed inputs; returns {summary (aggregate only), detail (private)}. */
export function measure(index, portalWords, aliyah = null) {
  const v = validateIndex(index);
  const errorCodes = {};
  for (const e of v.errors) errorCodes[e.code] = (errorCodes[e.code] ?? 0) + 1;
  const counts = { recordings: Array.isArray(index?.recordings) ? index.recordings.length : 0, recordingsValid: v.recordings.size,
    verses: 0, playbackReady: 0, playbackNeedsReview: 0, wordsReady: 0, wordsReadyViaMaqafGroup: 0, wordsUnavailable: {} };
  const detail = [];
  const asset = { approved: true, assetId: "ra_measurementonly000" };   // measurement stand-in; real ids come from the approved registry
  for (const r of v.recordings.values()) for (const verse of r.verses) {
    counts.verses++;
    const pw = portalWords?.verses?.[verse.ref];
    const portal = pw?.status === "ready" ? { status: "ready", words: pw.words, readingTextSha256: sha256(pw.readingText) } : { status: "unavailable" };
    const dto = buildVerseDto({ recording: r, verse, asset, portal, indexWordsSha256: sha256(indexWordsDigestInput(verse)) });
    if (dto.playback.status === "ready") counts.playbackReady++; else if (dto.playback.status === "needs-review") counts.playbackNeedsReview++;
    if (dto.words.status === "ready") { counts.wordsReady++; if (pw.words.length !== verse.words.length) counts.wordsReadyViaMaqafGroup++; }
    else counts.wordsUnavailable[dto.words.reason] = (counts.wordsUnavailable[dto.words.reason] ?? 0) + 1;
    detail.push({ recording: r.key, ref: verse.ref, playback: dto.playback.status, words: dto.words.status === "ready" ? "ready" : dto.words.reason,
      readingTextSha256: portal.readingTextSha256 ?? null, indexWordsSha256: sha256(indexWordsDigestInput(verse)) });
  }
  const refs = new Map();
  for (const r of v.recordings.values()) for (const verse of r.verses) refs.set(verse.ref, (refs.get(verse.ref) ?? 0) + 1);
  counts.distinctVerseRefs = refs.size;
  counts.verseRefsInSeveralRecordings = [...refs.values()].filter(n => n > 1).length;
  let coverage = null;
  if (aliyah) {
    const expected = expectedKeys(aliyah), have = new Set(v.recordings.keys());
    const missing = expected.filter(k => !have.has(k));
    coverage = { expected: expected.length, present: expected.length - missing.length, missing: missing.length,
      missingDeclared: missing.filter(k => Object.hasOwn(KNOWN_GAPS, k)).length };
    detail.push({ missingRecordings: missing });
  }
  return { summary: { ok: v.ok, errorCodes, warnings: v.warnings, counts, coverage }, detail };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const p of [args.index, args["portal-words"], args.out, ...(args.aliyah ? [args.aliyah] : [])]) {
    if (await insideGitWorkingTree(p)) throw new Refusal("path-inside-git-working-tree");
  }
  const index = await readJson(args.index, "index-unreadable");
  const portal = await readJson(args["portal-words"], "portal-words-unreadable");
  const aliyah = args.aliyah ? await readJson(args.aliyah, "aliyah-unreadable") : null;
  const { summary, detail } = measure(index, portal, aliyah);
  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, "reference-index-check.json"), JSON.stringify({ summary, detail }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`reference-index-check: ${e instanceof Refusal ? e.code : "failed"}`); process.exitCode = 2; });
}
