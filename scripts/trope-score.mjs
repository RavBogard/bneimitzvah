#!/usr/bin/env node
// Score a verse (or a whole reading) with a cell table, print it as a table, and with --midi write a
// Standard MIDI File to audition the melody in any player.
//   node scripts/trope-score.mjs <units.json> [options]            one verse, pre-parsed (hebrew-text-pipeline.md §6.3)
//   node scripts/trope-score.mjs --ref "Isaiah 42:5-43:10" [options]  any reading: fetched from Sefaria (MAM), parsed, scored
//   node scripts/trope-score.mjs --parashah Bereshit [--haftarah]   a week's Torah reading (or its haftarah) via Hebcal
//   node scripts/trope-score.mjs --date 2027-01-23 [--haftarah]     the reading on a date (also --holiday "Simchat Torah")
//   options: [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path | --nusach name] [--quiet]
// --nusach moroccan is short for --table trope/cells/haftarah-moroccan.json (NUSACH below lists the names).
// With --ref the last verse gets the end-of-reading cadence unless --no-final; --quiet prints one line per verse.
// --ref takes several ranges as one reading too: "Isaiah 27:6-28:13; 29:22-23".
// A Torah reading (--parashah/--date/--holiday without --haftarah) uses trope/cells/torah.json in F3 (the
// published pitches) and Hebcal's full-kriyah aliyot for the end-of-aliyah / end-of-book / special flags;
// --haftarah scores that week's haftarah with the haftarah table instead, every range as one reading.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scoreVerse, degreeLabel } from "../trope/melody.mjs";
import { scoreToMidi } from "../trope/midi.mjs";
import { verseUnits } from "../trope/text.mjs";
import { fetchReading } from "../trope/sefaria.mjs";
import { readingFor, verseFlags, flagLabel, parseRefList } from "../trope/hebcal.mjs";

const VERSE_GAP = 1;   // quarters of rest between verses in the MIDI

const args = process.argv.slice(2);
const valued = ["--midi", "--key", "--tempo", "--table", "--nusach", "--ref", "--parashah", "--date", "--holiday"];
const opt = name => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] : undefined; };
const input = args.find((a, k) => !a.startsWith("--") && !valued.includes(args[k - 1]));
const ref = opt("--ref");
const week = { parashah: opt("--parashah"), date: opt("--date"), holiday: opt("--holiday") };
const byWeek = Boolean(week.parashah || week.date || week.holiday);
if (!input && !ref && !byWeek) {
  console.error('usage: node scripts/trope-score.mjs (<units.json> | --ref "Book c:v-c:v" | --parashah Name | --date YYYY-MM-DD | --holiday Name) [--haftarah] [--midi out.mid] [--key D4] [--tempo 96] [--elision] [--final] [--table path | --nusach name] [--quiet]');
  process.exit(2);
}

// What to read: a Hebcal week's Torah (with aliyot) or haftarah, else the --ref ranges.
let reading = null, refs = [], aliyot = null;
if (byWeek) {
  reading = await readingFor(week);
  if (args.includes("--haftarah")) refs = reading.haftarah.refs;
  else ({ ranges: refs, aliyot } = reading.torah);
  if (!refs.length) throw new Error(`${reading.name}: Hebcal lists no ${aliyot ? "Torah reading" : "haftarah"}`);
} else if (ref) refs = parseRefList(ref);
const torah = Boolean(aliyot);

const cells = name => fileURLToPath(new URL(`../trope/cells/${name}.json`, import.meta.url));
// --nusach: a tradition's table by name. Only haftarah tables exist for the non-Ashkenazi traditions so far.
const NUSACH = { ashkenazi: { haftarah: "haftarah", torah: "torah" }, moroccan: { haftarah: "haftarah-moroccan" } };
const nusach = opt("--nusach");
if (nusach && !(NUSACH[nusach] && NUSACH[nusach][torah ? "torah" : "haftarah"])) {
  console.error(`--nusach ${nusach}: no ${torah ? "Torah" : "haftarah"} table (known: ${Object.keys(NUSACH).join(", ")})`);
  process.exit(2);
}
const tablePath = opt("--table") || cells(nusach ? NUSACH[nusach][torah ? "torah" : "haftarah"] : torah ? "torah" : "haftarah");
const table = JSON.parse(readFileSync(tablePath, "utf8"));
const scoreOpts = { table, key: opt("--key") || (torah ? "F3" : "D4"), tempo: Number(opt("--tempo") || 96), elision: args.includes("--elision") };

const verses = [], labels = [];
if (input) {
  const verse = JSON.parse(readFileSync(input, "utf8"));
  if (args.includes("--final")) verse.final = true;   // audition the end-of-reading cadence on any verse
  verses.push(verse);
} else {
  if (reading) console.log(`${reading.name}${reading.date ? ` (${reading.date})` : ""}: ${torah ? "Torah" : "haftarah"} ${refs.join("; ")}${!torah && reading.haftarah.reason ? ` [${reading.haftarah.reason}]` : ""}`);
  // Each range fetched on its own, the whole treated as one reading (one final verse, one set of flags).
  const fetched = [];
  for (const r of refs) fetched.push(...await fetchReading(r));
  const flags = verseFlags(fetched.map(v => v.ref), aliyot || []);
  fetched.forEach((v, i) => {
    const f = flags[i];
    // The end-of-reading cadence is the haftarah's; the Torah's last verse is an aliyah end instead.
    const final = !torah && (args.includes("--final") || (f.final && !args.includes("--no-final")));
    const units = verseUnits(v.he, { final, ref: v.ref });
    verses.push(torah ? { ...units, ref: v.ref, endOfAliyah: f.endOfAliyah, endOfBook: f.endOfBook, special: f.special } : { ...units, ref: v.ref });
    labels.push(torah ? flagLabel(f) : "");
  });
}

const pad = (s, n) => String(s).padEnd(n);
const combined = { ref: ref || (reading && `${reading.name} ${refs.join("; ")}`) || verses[0].ref, key: scoreOpts.key, tempo: scoreOpts.tempo, events: [] };
let t0 = 0, fallbacks = 0, recited = 0;
verses.forEach((verse, vi) => {
  const score = scoreVerse(verse, scoreOpts);
  for (const e of score.events) combined.events.push({ ...e, t: e.t + t0 });
  t0 += (score.events.at(-1)?.t ?? 0) + (score.events.at(-1)?.dur ?? 0) + VERSE_GAP;
  const fb = score.units.filter(u => u.cell && u.cell.fallback).map(u => u.text);
  fallbacks += fb.length;
  recited += score.units.filter(u => u.cell && u.cell.recite).length;

  if (args.includes("--quiet") || verses.length > 1) {
    const mark = labels[vi] ? `  ${labels[vi]}` : "";
    console.log(`${pad(score.ref, 22)} ${pad(score.units.length + " words", 9)} ${pad(score.events.length + " notes", 10)} ${score.seconds}s${fb.length ? "  fallback: " + fb.join(" ") : ""}${mark}`);
    return;
  }
  console.log(`${score.ref}  key ${score.key}  tempo ${score.tempo}  ${score.seconds}s${labels[vi] ? `  ${labels[vi]}` : ""}`);
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
});
if (verses.length > 1) console.log(`${verses.length} verses, ${combined.events.length} notes, ${Math.round(t0 * 60 / scoreOpts.tempo)}s${fallbacks ? `, ${fallbacks} words on the fallback reciting tone` : byWeek ? ", no fallback" : ""}${recited ? `, ${recited} words recited on the tone by the table's choice` : ""}`);

const midiPath = opt("--midi");
if (midiPath) {
  const bytes = scoreToMidi(combined);
  writeFileSync(midiPath, bytes);
  console.log(`wrote ${midiPath} (${bytes.length} bytes, ${combined.events.length} notes)`);
}
