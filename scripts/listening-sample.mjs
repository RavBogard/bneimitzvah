#!/usr/bin/env node
// Regenerates Daniel's listening-review sample from the private PocketTorah index and the published
// short-clip manifest. Both inputs stay outside Git; only verse citations, the seed and digests of the
// inputs are written. No audio, Hebrew or English text is read into the output.
//
//   node scripts/listening-sample.mjs --catalog <catalog.json> --manifest <manifest.json> [--seed <text>] [--out <file>]
//
// The sample has two parts:
// - a stress set: a fixed list of named verses (familiar, special melodies, written/read words, first and
//   last verses) plus, for the Torah and the haftarot separately, the verses at the extremes of each
//   boundary measure (closest word onsets, longest, fewest words, least and most room after the last word);
// - a random draw of verses from every published candidate, seeded so it is reproducible.
// A candidate is a verse in exactly one recording, ready for playback with word timings, that has a
// published short clip matching its cut exactly. That is precisely what a student would be able to play.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LISTENING_SEED = "crc-listening-review-2026-10-22";
export const DRAW_SIZE = 20;
const BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"];
export const NAMED = Object.freeze([
  ["Genesis 1:1", "First verse of the Torah and of its recording"],
  ["Genesis 8:17", "A word read differently from how it is written (ketiv/qere)"],
  ["Exodus 15:1", "Opening of the Song of the Sea"],
  ["Exodus 20:2", "Ten Commandments"],
  ["Leviticus 16:1", "First verse of a recording"],
  ["Leviticus 19:18", "Familiar verse"],
  ["Numbers 6:24", "Priestly blessing"],
  ["Deuteronomy 6:4", "Sh'ma, slow and emphatic"],
  ["Deuteronomy 28:27", "Words read differently from how they are written (ketiv/qere)"],
  ["Deuteronomy 34:12", "Last verse of the Torah"],
  ["II Samuel 22:1", "Opening of David's song"],
  ["Isaiah 40:1", "First verse of a recording (Nachamu)"],
  ["Hosea 14:2", "Familiar opening, Shuvah"],
  ["Malachi 1:1", "Short opening verse"],
]);
// [measure, how many Torah, how many haftarah, order, label]
const MEASURES = [
  ["gap", 3, 3, "asc", (v, part) => `Closest word onsets among ${part} verses (${v.gap.toFixed(2)} s apart)`],
  ["seconds", 2, 2, "desc", (v, part) => `Among the longest ${part} verses (${Math.round(v.seconds)} s)`],
  ["words", 2, 1, "asc", v => `Only ${v.words} words`],
  ["tail", 2, 2, "asc", v => `Least room after the last word before the cut (${v.tail.toFixed(2)} s)`],
  ["tail", 1, 2, "desc", v => `Longest pause after the last word (${v.tail.toFixed(1)} s)`],
];

const fail = message => { throw new Error(`Listening sample refused: ${message}`); };
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function order(ref) {
  const match = /^(.+) (\d+):(\d+)$/.exec(ref); if (!match) fail("noncanonical reference");
  const book = BOOKS.indexOf(match[1]); if (book < 0) fail("unknown book");
  return [book, Number(match[2]), Number(match[3])];
}
const compareRefs = (a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
function generator(seed) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Pure: the published candidates with their boundary measures. */
export function listeningCandidates(catalog, manifest) {
  if (catalog?.schema !== "reference-catalog/v1" || !Array.isArray(catalog.assets) || manifest?.schema !== "reference-short-manifest/v1" || !Array.isArray(manifest.entries)) fail("input shape");
  const count = new Map();
  for (const asset of catalog.assets) for (const verse of asset.verses) count.set(verse.ref, (count.get(verse.ref) ?? 0) + 1);
  const clips = new Set(manifest.entries.map(e => `${e.parent.asset}:${e.origin.firstFrame}:${e.presentationFrames}:${e.sampleRate}`));
  const rates = new Map(); for (const e of manifest.entries) { const set = rates.get(e.parent.asset) ?? new Set(); set.add(e.sampleRate); rates.set(e.parent.asset, set); }
  const result = [];
  for (const asset of catalog.assets) for (const verse of asset.verses) {
    if (count.get(verse.ref) !== 1 || verse.playback?.status !== "ready" || verse.words?.status !== "ready" || (verse.table !== "torah" && verse.table !== "haftarah")) continue;
    const { start, end } = verse.playback.clip, starts = verse.words.starts;
    const published = [...(rates.get(asset.id) ?? [])].some(rate => { const first = Math.floor(start * rate); return clips.has(`${asset.id}:${first}:${Math.ceil(end * rate) - first}:${rate}`); });
    if (!published) continue;
    let gap = Infinity; for (let i = 1; i < starts.length; i++) gap = Math.min(gap, starts[i] - starts[i - 1]);
    order(verse.ref);
    result.push(Object.freeze({ ref: verse.ref, kind: verse.table, words: starts.length, seconds: end - start, gap: starts.length > 1 ? gap : Infinity, tail: end - starts[starts.length - 1] }));
  }
  return result.sort((a, b) => compareRefs(a.ref, b.ref));
}

/** Pure and deterministic: the stress set and the seeded random draw. */
export function selectListeningSample(catalog, manifest, { seed = LISTENING_SEED, drawSize = DRAW_SIZE } = {}) {
  const candidates = listeningCandidates(catalog, manifest), byRef = new Map(candidates.map(c => [c.ref, c]));
  const stress = [], chosen = new Set();
  for (const [ref, why] of NAMED) { const c = byRef.get(ref); if (!c) fail(`named verse ${ref} is not a published candidate`); stress.push({ kind: c.kind, ref, why }); chosen.add(ref); }
  for (const [measure, torah, haftarah, direction, label] of MEASURES) for (const [kind, take] of [["torah", torah], ["haftarah", haftarah]]) {
    const pool = candidates.filter(c => c.kind === kind && !chosen.has(c.ref) && Number.isFinite(c[measure]))
      .sort((a, b) => (direction === "asc" ? a[measure] - b[measure] : b[measure] - a[measure]) || compareRefs(a.ref, b.ref));
    for (const c of pool.slice(0, take)) { stress.push({ kind, ref: c.ref, why: label(c, kind === "torah" ? "Torah" : "haftarah") }); chosen.add(c.ref); }
  }
  stress.sort((a, b) => compareRefs(a.ref, b.ref));
  const pool = candidates.filter(c => !chosen.has(c.ref)), next = generator(seed);
  if (pool.length < drawSize) fail("too few candidates for the draw");
  for (let i = 0; i < drawSize; i++) { const j = i + Math.floor(next() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const draw = pool.slice(0, drawSize).map(c => ({ kind: c.kind, ref: c.ref })).sort((a, b) => compareRefs(a.ref, b.ref));
  return { candidates: candidates.length, stress, draw, seed };
}

export function renderSampleModule(selection, provenance) {
  const line = row => `  { kind: ${JSON.stringify(row.kind)}, ref: ${JSON.stringify(row.ref)}${row.why ? `, why: ${JSON.stringify(row.why)}` : ""} },`;
  return `// Generated by scripts/listening-sample.mjs from the private PocketTorah index and published clip manifest. Do not edit by hand.
// Verse citations only: no audio, Hebrew or English text.
export const LISTENING_SAMPLE_PROVENANCE = Object.freeze(${JSON.stringify({ catalogSha256: provenance.catalogSha256, manifestSha256: provenance.manifestSha256, candidates: selection.candidates, seed: selection.seed, drawSize: selection.draw.length })});
export const LISTENING_STRESS_SET: readonly Readonly<{ kind: "torah" | "haftarah"; ref: string; why: string }>[] = Object.freeze([
${selection.stress.map(line).join("\n")}
]);
export const LISTENING_RANDOM_DRAW: readonly Readonly<{ kind: "torah" | "haftarah"; ref: string }>[] = Object.freeze([
${selection.draw.map(line).join("\n")}
]);
`;
}

async function main(argv) {
  const args = new Map(); for (let i = 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined) fail("usage"); args.set(argv[i].slice(2), argv[i + 1]); }
  const catalogPath = args.get("catalog"), manifestPath = args.get("manifest"); if (!catalogPath || !manifestPath) fail("usage: --catalog <path> --manifest <path>");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(args.get("out") ?? resolve(root, "src/lib/listening-review/sample-generated.ts"));
  const [catalogBytes, manifestBytes] = await Promise.all([readFile(catalogPath), readFile(manifestPath)]);
  const catalog = JSON.parse(catalogBytes.toString("utf8")), manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.parentCatalogSHA256 !== sha(catalogBytes)) fail("manifest does not belong to this catalog");
  const selection = selectListeningSample(catalog, manifest, { seed: args.get("seed") ?? LISTENING_SEED });
  await writeFile(out, renderSampleModule(selection, { catalogSha256: sha(catalogBytes), manifestSha256: sha(manifestBytes) }));
  console.log(`Wrote ${selection.stress.length} stress and ${selection.draw.length} random verses from ${selection.candidates} candidates.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : "Listening sample refused"); process.exitCode = 1; });
