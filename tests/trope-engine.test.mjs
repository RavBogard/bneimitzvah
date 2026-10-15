// The whole engine on the haftarah calibration corpus: raw Sefaria MAM HTML through the text front
// end into the melody engine. The corpus was chosen to cover every ta'am and every frequent context,
// so a word landing on the fallback reciting tone here means a hole in the cell table.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verseUnits } from "../trope/text.mjs";
import { scoreVerse } from "../trope/melody.mjs";
import { scoreToMidi } from "../trope/midi.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/haftarah.json", import.meta.url), "utf8"));
const corpus = JSON.parse(readFileSync(new URL("./fixtures/trope/calibration-haftarah.json", import.meta.url), "utf8"));

// Three marks never occur in a haftarah (trope-grammar.md section 4.4). The haftarah table carries
// low-confidence cells for them, derived from the Torah table, so any verse of the Prophets scores.
const NEVIIM_ONLY_MARKS = ["shalshelet", "karnei-farah", "yerach-ben-yomo"];

test("every haftarah calibration verse scores with one note group per syllable, the core on the tonic, and no fallback cell", () => {
  assert.ok(corpus.verses.length >= 50, "the corpus is present");
  for (const v of corpus.verses.filter(v => v.set !== "rare")) {
    const units = verseUnits(v.he, { final: v.final });
    const score = scoreVerse({ ...units, ref: v.ref }, { table, key: "D4" });
    const syllables = units.units.reduce((n, u) => n + u.syllables.length, 0);
    const groups = score.units.reduce((n, u) => n + u.syllables.length, 0);
    assert.equal(groups, syllables, `${v.ref}: one note group per syllable`);
    const fallbacks = score.units.filter(u => u.cell.fallback).map(u => u.text);
    assert.deepEqual(fallbacks, [], `${v.ref}: words on the fallback reciting tone`);
    for (const u of score.units) {
      const tonic = u.syllables.find(s => s.stress === "tonic");
      if (tonic) assert.ok(tonic.notes.length >= 1, `${v.ref} ${u.text}: the tonic syllable carries notes`);
      for (const s of u.syllables) assert.ok(s.notes.length >= 1, `${v.ref} ${u.text}: every syllable sings`);
    }
    assert.ok(score.events.every(e => e.midi >= 36 && e.midi <= 96 && e.dur > 0), `${v.ref}: notes in range with positive durations`);
  }
});

test("the last verse of a haftarah ends on the end-of-reading cadence, other verses on sof pasuk", () => {
  const byRef = Object.fromEntries(corpus.verses.map(v => [v.ref, v]));
  const last = byRef["Jeremiah 9:23"], plain = byRef["I Samuel 20:18"];
  assert.ok(last && last.final && plain && !plain.final, "the fixtures carry the final flag as expected");
  const cadence = v => scoreVerse(verseUnits(v.he, { final: v.final }), { table, key: "D4" }).units.at(-1).cell.id;
  assert.notEqual(cadence(last), cadence(plain));
  assert.equal(cadence(last), scoreVerse(verseUnits(plain.he, { final: true }), { table, key: "D4" }).units.at(-1).cell.id, "any verse flagged final gets the same cadence");
});

test("the rare verses score with no fallback: mercha kefula on its cell, the three Nevi'im-only marks on derived cells", () => {
  const rare = corpus.verses.filter(v => v.set === "rare");
  assert.ok(rare.length >= 4);
  const seen = new Set();
  for (const v of rare) {
    const score = scoreVerse(verseUnits(v.he, { final: false }), { table, key: "D4" });
    const fallbacks = score.units.filter(u => u.cell.fallback || u.cell.id.startsWith("fallback")).map(u => u.cell.trope);
    assert.deepEqual(fallbacks, [], `${v.ref}: words on the fallback reciting tone`);
    for (const u of score.units.filter(u => NEVIIM_ONLY_MARKS.includes(u.cell.trope))) {
      assert.equal(u.cell.confidence, "low", `${v.ref} ${u.text}: a derived cell is marked low confidence`);
      seen.add(u.cell.trope);
    }
    const kefula = score.units.find(u => u.cell.trope === "mercha-kefula");
    if (kefula) assert.ok(!kefula.cell.fallback, `${v.ref}: mercha kefula has a cell`);
  }
  assert.deepEqual([...seen].sort(), [...NEVIIM_ONLY_MARKS].sort(), "the rare verses reach every Nevi'im-only mark");
});

test("a whole reading concatenates into one MIDI file", () => {
  const scores = corpus.verses.slice(0, 5).map(v => scoreVerse(verseUnits(v.he, { final: false }), { table, key: "D4" }));
  let t = 0; const events = [];
  for (const s of scores) { for (const e of s.events) events.push({ ...e, t: e.t + t }); t += s.seconds; }
  const bytes = scoreToMidi({ ref: "five verses", tempo: 96, events });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "MThd");
  assert.ok(bytes.length > events.length * 6, "a note on, a note off and the deltas per event");
});
