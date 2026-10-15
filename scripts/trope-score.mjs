#!/usr/bin/env node
// Score a verse (or a whole reading) with a cell table, print it as a table, and with --midi write a
// Standard MIDI File to audition the melody in any player.
//   node scripts/trope-score.mjs <units.json> [options]            one verse, pre-parsed (hebrew-text-pipeline.md §6.3)
//   node scripts/trope-score.mjs --ref "Isaiah 42:5-43:10" [options]  any reading: fetched from Sefaria (MAM), parsed, scored
//   options: [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path] [--quiet]
// With --ref the last verse gets the end-of-reading cadence unless --no-final; --quiet prints one line per verse.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreVerse, degreeLabel } from "../trope/melody.mjs";
import { scoreToMidi } from "../trope/midi.mjs";
import { verseUnits } from "../trope/text.mjs";

const HEBREW_VERSION = "Miqra according to the Masorah";
const VERSE_GAP = 1;   // quarters of rest between verses in the MIDI

const args = process.argv.slice(2);
const valued = ["--midi", "--key", "--tempo", "--table", "--ref"];
const opt = name => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const input = args.find((a, k) => !a.startsWith("--") && !valued.includes(args[k - 1]));
const ref = opt("--ref");
if (!input && !ref) {
  console.error('usage: node scripts/trope-score.mjs (<units.json> | --ref "Book c:v-c:v") [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path] [--quiet]');
  process.exit(2);
}

const tablePath = opt("--table") || fileURLToPath(new URL("../trope/cells/haftarah.json", import.meta.url));
const table = JSON.parse(readFileSync(tablePath, "utf8"));
const scoreOpts = { table, key: opt("--key") || "D4", tempo: Number(opt("--tempo") || 96), elision: args.includes("--elision") };

// Sefaria returns a string for one verse, an array for a range in one chapter, and nested arrays
// across chapters; refs come back the same way, so flatten both in step.
const flat = x => Array.isArray(x) ? x.flatMap(flat) : [x];
async function fetchReading(r) {
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(r.replace(/\s+/g, " "))}?version=hebrew|${encodeURIComponent(HEBREW_VERSION)}&return_format=default`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "crc-haftarah-sheet/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error);
  const v = (j.versions || []).find(x => x.languageFamilyName === "hebrew");
  if (!v || v.versionTitle !== HEBREW_VERSION) throw new Error(`no MAM text for ${r}`);
  // Verse refs are rebuilt from the range's start: a nested array is one chapter per element, the
  // first starting at the range's first verse and the rest at verse 1.
  const book = (j.book || j.indexTitle || r.replace(/\s+\d.*$/, "")).trim();
  const [startChapter, startVerse] = (j.sections || [1, 1]).map(Number);
  const chapters = Array.isArray(v.text) && Array.isArray(v.text[0]) ? v.text : [Array.isArray(v.text) ? v.text : [v.text]];
  const out = [];
  chapters.forEach((ch, c) => flat(ch).forEach((he, i) => {
    const verse = (c === 0 ? startVerse : 1) + i;
    if (he) out.push({ ref: `${book} ${startChapter + c}:${verse}`, he });
  }));
  return out;
}

const verses = [];
if (input) {
  const verse = JSON.parse(readFileSync(input, "utf8"));
  if (args.includes("--final")) verse.final = true;   // audition the end-of-reading cadence on any verse
  verses.push(verse);
} else {
  const fetched = await fetchReading(ref);
  fetched.forEach((v, i) => {
    const final = args.includes("--final") || (i === fetched.length - 1 && !args.includes("--no-final"));
    verses.push({ ...verseUnits(v.he, { final }), ref: v.ref });
  });
}

const pad = (s, n) => String(s).padEnd(n);
const combined = { ref: ref || verses[0].ref, key: scoreOpts.key, tempo: scoreOpts.tempo, events: [] };
let t0 = 0, fallbacks = 0;
for (const verse of verses) {
  const score = scoreVerse(verse, scoreOpts);
  for (const e of score.events) combined.events.push({ ...e, t: e.t + t0 });
  t0 += (score.events.at(-1)?.t ?? 0) + (score.events.at(-1)?.dur ?? 0) + VERSE_GAP;
  const fb = score.units.filter(u => u.cell && u.cell.fallback).map(u => u.text);
  fallbacks += fb.length;

  if (args.includes("--quiet") || verses.length > 1) {
    console.log(`${pad(score.ref, 22)} ${pad(score.units.length + " words", 9)} ${pad(score.events.length + " notes", 10)} ${score.seconds}s${fb.length ? "  fallback: " + fb.join(" ") : ""}`);
    continue;
  }
  console.log(`${score.ref}  key ${score.key}  tempo ${score.tempo}  ${score.seconds}s`);
  console.log(pad("word", 16) + pad("cell", 26) + pad("syll", 6) + pad("ph", 6) + pad("deg", 5) + pad("midi", 6) + "dur");
  for (const u of score.units) {
    let first = true;
    for (const s of u.syllables) {
      s.notes.forEach((n, k) => {
        const word = first ? u.text : "";
        const cell = first ? u.cell.id + (u.cell.confidence ? ` (${u.cell.confidence})` : "") : "";
        const syl = k === 0 ? (s.stress === "tonic" ? `*${s.he}` : s.he) : "";
        const ph = k === 0 ? s.ph.join("") : "";
        console.log(pad(word, 16) + pad(cell, 26) + pad(syl, 6) + pad(ph, 6) + pad((n.slur ? "~" : "") + degreeLabel(n.deg), 5) + pad(n.midi, 6) + n.dur);
        first = false;
      });
    }
  }
}
if (verses.length > 1) console.log(`${verses.length} verses, ${combined.events.length} notes, ${Math.round(t0 * 60 / scoreOpts.tempo)}s${fallbacks ? `, ${fallbacks} words on the fallback reciting tone` : ""}`);

const midiPath = opt("--midi");
if (midiPath) {
  const bytes = scoreToMidi(combined);
  writeFileSync(midiPath, bytes);
  console.log(`wrote ${midiPath} (${bytes.length} bytes, ${combined.events.length} notes)`);
}
