// The Moroccan haftarah table (Idelsohn vol. 5 no. 271) and the engine features it needs: cell aliases,
// the table's own reciting tone (recite vs fallback), upbeat folding, and the --nusach alias. Joshua 1:14
// scored with the table is checked against Idelsohn's chanted example, no. 272.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verseUnits } from "../trope/text.mjs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { scoreVerse, selectCell, unitContext, fitSyllables, recitingTone, withVariants, keyToMidi } from "../trope/melody.mjs";

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const table = read("../trope/cells/haftarah-moroccan.json");
const ashkenazi = read("../trope/cells/haftarah.json");
const corpus = read("./fixtures/trope/calibration-haftarah.json");
const j272 = read("./fixtures/trope/idelsohn-272-joshua-1-14.json");
const word = (n, t) => ({ syllables: Array.from({ length: n }, (_, k) => ({ he: `s${k}`, ph: [], stress: k === t ? "tonic" : null })) });
const unitWith = (cp, role = "disjunctive") => ({ text: "x", accents: [{ cp, role }], syllables: word(2, 1).syllables });
const CONFIDENCE = ["high", "medium", "low", "none"];

test("the Moroccan table: a name, a source block citing Idelsohn no. 271 and its page, D dorian, and a confidence and source on every cell", () => {
  assert.match(table.name, /Moroccan/);
  assert.match(table.source.work, /Idelsohn/);
  assert.match(table.source.table, /No\. 271.*p\. 103/);
  assert.match(table.source.example, /No\. 272/);
  assert.equal(table.tonic, "D4");
  const map = table.degrees.semitones;
  assert.deepEqual([map[1], map[2], map[3], map[4], map[5], map[6], map[7], map[0], map[-1]], [0, 2, 3, 5, 7, 9, 10, -2, -3], "dorian: major 6th (B natural), minor 7th (C natural)");
  const ids = new Set();
  for (const c of table.cells) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id ${c.id}`); ids.add(c.id);
    for (const t of [c.trope, ...(c.aliases || [])]) assert.ok(table.tropeIds.includes(t), `${c.id}: unknown trope ${t}`);
    assert.ok(CONFIDENCE.includes(c.confidence), `${c.id}: confidence ${c.confidence}`);
    assert.match(c.source, /Idelsohn no\. 27[12]/, `${c.id}: no Idelsohn source`);
    for (const n of [...c.upbeats, ...c.core, ...Object.values(c.variants || {}).flatMap(v => [...v.upbeats, ...v.core])]) {
      assert.ok(Number.isInteger(n.deg) && n.dur > 0 && String(n.deg) in map, `${c.id}: bad note ${JSON.stringify(n)}`);
    }
  }
  for (const [t, r] of Object.entries(table.recite.tropes)) {
    assert.ok(["source", "editor"].includes(r.basis) && CONFIDENCE.includes(r.confidence) && r.source, `recite ${t}: basis, confidence and source`);
    assert.ok(!table.cells.some(c => c.trope === t || (c.aliases || []).includes(t)), `recite ${t} also has a cell`);
  }
  // every ta'am lands somewhere on purpose: a default cell, an alias, or a declared recitation
  for (const t of table.tropeIds) {
    const covered = table.cells.some(c => (c.trope === t || (c.aliases || []).includes(t)) && Object.keys(c.context).length === 0) || t in table.recite.tropes;
    assert.ok(covered, `${t}: neither a default cell, an alias nor a declared recitation`);
  }
});

test("aliases: one cell serves revia, zakef gadol and gershayim, and the score says which ta'am it sang", () => {
  for (const [cp, trope] of [["0597", "revia"], ["0595", "zakef-gadol"], ["059E", "gershayim"]]) {
    const u = unitWith(cp);
    const cell = selectCell(u, unitContext([u], 0), table);
    assert.equal(cell.id, "rebia", trope);
    assert.equal(cell.as, trope === "revia" ? undefined : trope);
  }
  const s = scoreVerse({ units: [unitWith("0595")] }, { table });
  assert.equal(s.units[0].cell.id, "rebia");
  assert.equal(s.units[0].cell.as, "zakef-gadol");
});

test("recite vs fallback: a declared ta'am recites on the table's tone and is not a fallback; an undeclared hole still is", () => {
  assert.deepEqual(recitingTone(table), { deg: 2, dur: 0.5 });
  assert.deepEqual(recitingTone(ashkenazi), { deg: 1, dur: 0.5 }, "tables without a recite block keep degree 1");
  const darga = unitWith("05A7", "conjunctive");
  const r = selectCell(darga, unitContext([darga], 0), table);
  assert.equal(r.recite, true);
  assert.ok(!r.fallback);
  assert.deepEqual(r.core.map(n => n.deg), [2]);
  const fit = fitSyllables(r, word(3, 1));
  assert.deepEqual(fit.syllables.map(s => s.notes.map(n => n.deg)), [[2], [2], [2]], "every syllable on the reciting tone");
  const score = scoreVerse({ units: [darga] }, { table });
  assert.equal(score.units[0].cell.recite, true);
  assert.equal(score.units[0].cell.fallback, undefined);
  // the same ta'am with the declaration removed is a hole: flagged, on the table's tone
  const holed = { ...table, recite: { ...table.recite, tropes: {} } };
  const h = selectCell(darga, unitContext([darga], 0), holed);
  assert.equal(h.fallback, true);
  assert.deepEqual(h.core.map(n => n.deg), [2]);
});

test("foldUpbeats: a cell whose lead-in is a melisma keeps it on a short word instead of dropping it", () => {
  const zk = table.cells.find(c => c.id === "zakef-katan");
  const fold = fitSyllables(zk, word(3, 1)).syllables.map(s => s.notes.map(n => n.deg));
  assert.deepEqual(fold, [[1, 0], [1], [0]], "ha- D~C, ḥa D, jil C (Idelsohn 272 haḥajil)");
  const plain = fitSyllables({ ...zk, foldUpbeats: false }, word(3, 1)).syllables.map(s => s.notes.map(n => n.deg));
  assert.deepEqual(plain, [[0], [1], [0]], "without the flag the first upbeat is dropped, as before");
  assert.deepEqual(fitSyllables(zk, word(4, 2)).syllables.map(s => s.notes.map(n => n.deg)), [[1], [0], [1], [0]], "enough syllables: one upbeat each");
});

test("every haftarah calibration verse scores with the Moroccan table: one note group per syllable, no unintentional hole", () => {
  assert.ok(corpus.verses.length >= 50);
  let recited = 0;
  for (const v of corpus.verses) {
    const units = verseUnits(v.he, { final: v.final });
    const score = scoreVerse({ ...units, ref: v.ref }, { table, key: "D4" });
    const syllables = units.units.reduce((n, u) => n + u.syllables.length, 0);
    assert.equal(score.units.reduce((n, u) => n + u.syllables.length, 0), syllables, `${v.ref}: one note group per syllable`);
    assert.deepEqual(score.units.filter(u => u.cell.fallback).map(u => `${u.text} ${u.cell.trope}`), [], `${v.ref}: holes in the table`);
    for (const u of score.units) for (const s of u.syllables) assert.ok(s.notes.length >= 1, `${v.ref} ${u.text}: every syllable sings`);
    assert.ok(score.events.every(e => e.midi >= 55 && e.midi <= 72), `${v.ref}: within Idelsohn's range B3-A4 plus a step`);
    recited += score.units.filter(u => u.cell.recite).length;
  }
  assert.ok(recited > 0, "the corpus reaches the declared recitations");
});

// Joshua 1:14 against Idelsohn no. 272: per word, the MIDI pitches the table sings vs the printed ones.
const midiOf = name => keyToMidi(name);
const merge = xs => xs.filter((x, k) => k === 0 || x !== xs[k - 1]);
const scoreJ = t => scoreVerse({ ...verseUnits(j272.he, { final: false }), ref: j272.ref }, { table: t, key: "D4" });

test("Joshua 1:14 with the Moroccan table matches Idelsohn's no. 272 word by word, except where 271 prints the ta'am differently", () => {
  const score = scoreJ(table);
  assert.equal(score.units.length, j272.words.length, "one fixture entry per word");
  const tally = { exact: 0, contour: 0, divergent: 0 };
  score.units.forEach((u, i) => {
    const w = j272.words[i];
    assert.equal(u.text, w.he, `word ${i}`);
    const sung = u.syllables.map(s => s.notes.map(n => n.midi));
    const printed = w.pitches.map(s => s.map(midiOf));
    tally[w.match]++;
    if (w.match === "exact") assert.deepEqual(sung, printed, `${w.idelsohn} (${w.taam}): exact`);
    else if (w.match === "contour") assert.deepEqual(merge(sung.flat()), merge(printed.flat()), `${w.idelsohn} (${w.taam}): contour`);
    else assert.notDeepEqual(merge(sung.flat()), merge(printed.flat()), `${w.idelsohn}: marked divergent but matches; update the fixture`);
  });
  assert.ok(tally.exact >= 15, `exact words: ${JSON.stringify(tally)}`);
  assert.ok(tally.divergent <= 4, `divergent words: ${JSON.stringify(tally)}`);
});

test("the jos272 variants reproduce no. 272 on the words where the table follows no. 271", () => {
  for (const [he, { cell, variant }] of Object.entries(j272.variants)) {
    const i = j272.words.findIndex(w => w.he === he);
    assert.ok(i >= 0, he);
    const u = scoreJ(withVariants(table, { [cell]: variant })).units[i];
    assert.deepEqual(u.syllables.map(s => s.notes.map(n => n.midi)), j272.words[i].pitches.map(s => s.map(midiOf)), `${j272.words[i].idelsohn} with ${cell}:${variant}`);
  }
});

test("trope-score --nusach moroccan scores with the Moroccan table; an unknown nusach is a usage error", async () => {
  const iso = await isolatedEnv();
  const run = (...a) => spawnSync(process.execPath, a, { encoding: "utf8", env: iso.env });
  const script = fileURLToPath(new URL("../scripts/trope-score.mjs", import.meta.url));
  const units = fileURLToPath(new URL("./fixtures/trope/i-samuel-20-18.units.json", import.meta.url));
  const ok = run(script, units, "--nusach", "moroccan");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /atnah/);
  assert.match(ok.stdout, /sof-pasuq/);
  const same = run(script, units, "--table", fileURLToPath(new URL("../trope/cells/haftarah-moroccan.json", import.meta.url)));
  assert.equal(same.stdout, ok.stdout, "--nusach moroccan = --table trope/cells/haftarah-moroccan.json");
  const bad = run(script, units, "--nusach", "klingon");
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--nusach klingon/);
  await iso.cleanup();
});
