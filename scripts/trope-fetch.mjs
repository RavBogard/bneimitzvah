#!/usr/bin/env node
/**
 * trope-fetch.mjs — fetch single verses of the MAM Hebrew text (raw Sefaria HTML, uncleaned)
 * for the trope engine's calibration corpus.
 *
 *   node scripts/trope-fetch.mjs --out tests/fixtures/trope/calibration-haftarah.json "I Samuel 20:18" "Zechariah 3:2"
 *   node scripts/trope-fetch.mjs --out file.json --refs refs.txt
 *   node scripts/trope-fetch.mjs --corpus --out tests/fixtures/trope/calibration-haftarah.json   # the 4.4 corpus
 *
 * --refs file: one ref per line; optional "|set|final|note" suffix (set core|full|rare, final true|false).
 * Same request shape as scripts/fetch.mjs (v3 API, version=hebrew|<MAM>). `he` is verbatim.
 * Dependency-free: Node 18+ with global fetch.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const HEBREW_VERSION = "Miqra according to the Masorah";
const DELAY_MS = 700;

// Calibration corpus from docs/superpowers/research/2026-10-15-trope-engine/trope-grammar.md section 4.4.
const CORE = [
  ["I Samuel 20:18", "seed: the brief's example verse"],
  ["Zechariah 3:2", "seed: the corpus's only mercha kefula"],
  ["Jeremiah 9:23", "last verse of a haftarah; segol>yetiv", true],
  ["Isaiah 66:20", "pazer>pazer, munach+pazer on one word"],
  ["Zechariah 14:2", "mercha+zarka on one word"],
  ["I Kings 6:6"], ["I Kings 7:48"], ["I Samuel 20:25"], ["Isaiah 7:3"], ["Obadiah 1:1"],
  ["Judges 5:11", "etnachta+tevir and zakef+mahpach on one word"],
  ["II Samuel 7:6", "zakef>telisha gedola"],
  ["Isaiah 6:2"], ["I Kings 18:4"], ["Jeremiah 1:18"],
  ["Judges 5:4", "zakef+munach on one word"],
  ["Joshua 2:19", "darga+tevir on one word"],
  ["II Samuel 22:26", "4 words; short verse for the no-conjunctive case"],
  ["Judges 13:6"], ["I Kings 18:36"],
];
const FULL = [
  ["Judges 5:17"], ["II Kings 23:3", "revia>geresh"], ["Judges 5:16"], ["I Kings 19:8", "etnachta>geresh"],
  ["II Kings 4:23"], ["Isaiah 58:6"], ["Malachi 3:15"], ["Judges 11:27"],
  ["Jeremiah 46:28", "last verse of a haftarah", true], ["I Kings 5:32"], ["Judges 5:19"], ["I Samuel 12:7"],
  ["Ezekiel 37:11", "segol>zakef gadol"], ["Jeremiah 46:27"], ["I Kings 18:26"], ["I Kings 1:25", "segol>telisha ketana"],
  ["II Samuel 22:47"], ["Jeremiah 8:18"], ["II Samuel 6:12"], ["Hosea 12:14"],
  ["Ezekiel 1:25", "zakef gadol>zakef gadol"], ["II Samuel 22:7"], ["Ezekiel 1:9"], ["Jonah 1:2"],
  ["I Kings 19:7"], ["Ezekiel 1:10"], ["I Kings 18:6"], ["Amos 9:14"], ["I Samuel 15:16"],
];
const RARE = [
  ["Isaiah 13:8", "rare mark: shalshelet"],
  ["Amos 1:2", "rare mark: shalshelet"],
  ["Joshua 19:51", "rare marks: karnei farah + yerach ben yomo"],
  ["I Kings 10:3", "rare mark: mercha kefula"],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function corpus() {
  const out = [];
  const seen = new Set();
  for (const [set, list] of [["core", CORE], ["full", FULL], ["rare", RARE]]) {
    for (const [ref, note, final] of list) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ ref, set, final: !!final, note: note || (set === "core" ? "core calibration set (20 verses covering all 23 ta'am types)" : set === "full" ? "full calibration set (covers features occurring 3+ times)" : "rare mark") });
    }
  }
  return out;
}

function parseRef(ref) {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (!m) throw new Error(`not a single-verse ref: "${ref}"`);
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}

async function fetchVerse(ref) {
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref.replace(/\s+/g, " "))}?version=hebrew|${encodeURIComponent(HEBREW_VERSION)}&return_format=default`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "crc-haftarah-sheet/1.0" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      const v = (j.versions || []).find(x => x.languageFamilyName === "hebrew");
      if (!v) throw new Error("no Hebrew version returned");
      if (v.versionTitle !== HEBREW_VERSION) throw new Error(`got version "${v.versionTitle}", not MAM`);
      if (typeof v.text !== "string" || !v.text) throw new Error("empty or non-single-verse text");
      return v.text;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(1500);
    }
  }
  throw new Error(`${ref}: ${lastErr.message} (${url})`);
}

async function main() {
  const args = process.argv.slice(2);
  let out = null, refsFile = null, useCorpus = false;
  const refs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--refs") refsFile = args[++i];
    else if (args[i] === "--corpus") useCorpus = true;
    else refs.push(args[i]);
  }
  if (!out) { console.error("usage: node scripts/trope-fetch.mjs --out <file.json> [--corpus] [--refs <file>] <ref> [<ref> ...]"); process.exit(2); }

  const items = [];
  if (useCorpus) items.push(...corpus());
  if (refsFile) {
    for (const line of (await readFile(refsFile, "utf8")).split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [ref, set, fin, ...note] = t.split("|").map(s => s.trim());
      items.push({ ref, set: set || "full", final: fin === "true", note: note.join("|") });
    }
  }
  for (const ref of refs) items.push({ ref, set: "full", final: false, note: "" });
  if (!items.length) { console.error("no refs given"); process.exit(2); }

  const verses = [], failed = [];
  for (const it of items) {
    try {
      const { book, chapter, verse } = parseRef(it.ref);
      const he = await fetchVerse(it.ref);
      verses.push({ ref: it.ref, book, chapter, verse, he, set: it.set, final: it.final, note: it.note });
      console.log(`ok   ${it.ref}`);
    } catch (e) {
      failed.push(it.ref);
      console.error(`FAIL ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ version: HEBREW_VERSION, fetched: new Date().toISOString().slice(0, 10), verses }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${out} (${verses.length} verses${failed.length ? `, ${failed.length} failed: ${failed.join(", ")}` : ""})`);
  if (failed.length) process.exit(1);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
