#!/usr/bin/env node
// Score one verse's units JSON (hebrew-text-pipeline.md §6.3) with the haftarah cell table and
// print it as a table; --midi writes a Standard MIDI File to audition it.
//   node scripts/trope-score.mjs <units.json> [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreVerse, degreeLabel } from "../trope/melody.mjs";
import { scoreToMidi } from "../trope/midi.mjs";

const args = process.argv.slice(2);
const opt = name => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const input = args.find((a, k) => !a.startsWith("--") && !["--midi", "--key", "--tempo", "--table"].includes(args[k - 1]));
if (!input) {
  console.error("usage: node scripts/trope-score.mjs <units.json> [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path]");
  process.exit(2);
}

const tablePath = opt("--table") || fileURLToPath(new URL("../trope/cells/haftarah.json", import.meta.url));
const table = JSON.parse(readFileSync(tablePath, "utf8"));
const verse = JSON.parse(readFileSync(input, "utf8"));
if (args.includes("--final")) verse.final = true;   // audition the end-of-haftarah cadence on any verse
const score = scoreVerse(verse, { table, key: opt("--key") || "D4", tempo: Number(opt("--tempo") || 96), elision: args.includes("--elision") });

const pad = (s, n) => String(s).padEnd(n);
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

const midiPath = opt("--midi");
if (midiPath) {
  const bytes = scoreToMidi(score);
  writeFileSync(midiPath, bytes);
  console.log(`wrote ${midiPath} (${bytes.length} bytes, ${score.events.length} notes)`);
}
