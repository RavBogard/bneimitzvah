import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectCell, scoreVerse, unitContext, readingFlags, degreeSemitones, withVariants, SPECIAL_MELODIES } from "../trope/melody.mjs";
import { verseUnits } from "../trope/text.mjs";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const table = load("../trope/cells/torah.json");
const haftarah = load("../trope/cells/haftarah.json");
const corpus = load("./fixtures/trope/calibration-torah.json");
const byId = id => table.cells.find(c => c.id === id);
const degs = notes => notes.map(n => n.deg);
const word = (n, t) => Array.from({ length: n }, (_, k) => ({ he: `s${k}`, ph: [], stress: k === t ? "tonic" : null }));
// A unit with one accent (by codepoint) in a lib.js phrase family.
const u = (cp, family, role = "disjunctive") => ({ text: cp, accents: [{ cp, role }], trope: { family }, syllables: word(2, 1) });
const MERCHA = "05A5", TIPCHA = "0596", SILLUQ = "05BD", ETNACHTA = "0591", MUNACH = "05A3";
const ids = (units, flags) => units.map((x, i) => selectCell(x, unitContext(units, i, flags), table).id);

test("every Torah cell has an id, a known trope, a context, core notes and a report line", () => {
  const seen = new Set();
  for (const c of table.cells) {
    assert.ok(c.id && !seen.has(c.id), `duplicate or missing id ${c.id}`); seen.add(c.id);
    assert.ok(table.tropeIds.includes(c.trope), `${c.id}: unknown trope ${c.trope}`);
    assert.equal(typeof c.context, "object", `${c.id}: no context`);
    assert.ok(Array.isArray(c.upbeats), `${c.id}: no upbeats array`);
    assert.ok(c.core.length >= 1, `${c.id}: empty core`);
    assert.match(c.source, /torah-grammar\.md L\d+/, `${c.id}: no source line`);
    for (const n of [...c.upbeats, ...c.core, ...Object.values(c.variants || {}).flatMap(v => [...v.upbeats, ...v.core])]) {
      assert.ok(Number.isInteger(n.deg) && n.dur > 0, `${c.id}: bad note ${JSON.stringify(n)}`);
      assert.ok(String(n.deg) in table.degrees.semitones, `${c.id}: degree ${n.deg} not in the map`);
    }
  }
  for (const t of table.tropeIds) assert.ok(table.cells.some(c => c.trope === t && Object.keys(c.context).length === 0), `no default cell for ${t}`);
  // 4 end-of-aliyah + the fifth pattern, 4 end-of-book
  assert.equal(table.cells.filter(c => c.context.endOfAliyah).length, 5);
  assert.equal(table.cells.filter(c => c.context.endOfBook).length, 4);
});

test("the Torah mode: major scale in the F = 1 frame; silluq ends on 5_, etnachta on 2, the aliyah cadence on 6_", () => {
  assert.equal(table.mode, "major");
  assert.equal(degreeSemitones(3, table), 4);
  assert.equal(degreeSemitones(-2, table), -5);
  assert.equal(byId("silluq").core.at(-1).deg, -2);
  assert.equal(byId("etnachta").core.at(-1).deg, 2);
  assert.equal(byId("aliyah:silluq").core.at(-1).deg, -1);
  assert.equal(byId("book:silluq").core.at(-1).deg, 1);
  // 4# is the raised fourth (B natural in F): alt +1 on degree 4
  assert.deepEqual(byId("pazer").variants.common.core.find(n => n.alt), { deg: 4, dur: 0.5, alt: 1 });
});

test("selectCell: plain silluq vs end of aliyah vs end of book (book wins over aliyah)", () => {
  const verse = [u(MERCHA, "sof-pasuk", "conjunctive"), u(TIPCHA, "sof-pasuk"), u(MERCHA, "sof-pasuk", "conjunctive"), u(SILLUQ, "sof-pasuk")];
  assert.deepEqual(ids(verse, {}), ["mercha", "tipcha", "mercha>silluq", "silluq"]);
  assert.deepEqual(ids(verse, { endOfAliyah: true }), ["aliyah:mercha>tipcha", "aliyah:tipcha", "aliyah:mercha>silluq", "aliyah:silluq"]);
  assert.deepEqual(ids(verse, { endOfBook: true }), ["book:mercha>tipcha", "book:tipcha", "book:mercha>silluq", "book:silluq"]);
  assert.deepEqual(ids(verse, { endOfAliyah: true, endOfBook: true }), ["book:mercha>tipcha", "book:tipcha", "book:mercha>silluq", "book:silluq"]);
  // final means end of reading (the haftarah cadence): the Torah table has no such cells
  assert.deepEqual(ids(verse, { final: true }), ["mercha", "tipcha", "mercha>silluq", "silluq"]);
});

test("selectCell: the aliyah cadence touches only the sof-pasuk phrase", () => {
  const verse = [u(MERCHA, "etnachta", "conjunctive"), u(TIPCHA, "etnachta"), u(ETNACHTA, "etnachta"), u(TIPCHA, "sof-pasuk"), u(SILLUQ, "sof-pasuk")];
  assert.deepEqual(ids(verse, { endOfAliyah: true }), ["mercha", "tipcha", "etnachta", "aliyah:tipcha", "aliyah:silluq"]);
});

test("selectCell: the fifth pattern (etnachta -> silluq, no tipcha) gets its own cell, only at an aliyah end", () => {
  const verse = [u(MUNACH, "etnachta", "conjunctive"), u(ETNACHTA, "etnachta"), u(SILLUQ, "sof-pasuk")];
  assert.deepEqual(ids(verse, { endOfAliyah: true }), ["munach>etnachta", "etnachta", "aliyah:silluq@no-tipcha"]);
  assert.deepEqual(ids(verse, {}), ["munach>etnachta", "etnachta", "silluq"]);
  assert.equal(byId("aliyah:silluq@no-tipcha").confidence, "low");
});

test("the rare marks each get a real Torah cell, not the fallback (the haftarah table's are derived from these)", () => {
  for (const [trope, before, id] of [["shalshelet", null, "shalshelet"], ["mercha-kefula", "tipcha", "mercha-kefula"],
    ["karnei-farah", null, "karnei-farah"], ["yerach-ben-yomo", "karnei-farah", "yerach-ben-yomo"]]) {
    const cell = selectCell({}, { trope, before }, table);
    assert.equal(cell.id, id);
    assert.ok(!cell.fallback && cell.source.startsWith("torah-grammar.md"), `${trope}: ${cell.id}`);
  }
  assert.equal(byId("shalshelet").core.length + byId("shalshelet").upbeats.length, 24);   // [1] + 23 notes
  const derived = selectCell({}, { trope: "shalshelet" }, haftarah);
  assert.ok(!derived.fallback && derived.confidence === "low" && derived.derivedFrom === "torah.json#shalshelet");
  assert.deepEqual(derived.core, byId("shalshelet").core);   // degree for degree
  assert.equal(selectCell({}, { trope: "munach", before: "yerach-ben-yomo" }, table).id, "munach>yerach-ben-yomo");
});

test("special melodies: creation is computed, journeys and the Song are reported; unknown names throw", () => {
  assert.deepEqual(SPECIAL_MELODIES, ["creation", "journeys", "song-of-the-sea"]);
  assert.throws(() => readingFlags({ special: "decalogue" }), /unknown special/);
  const units = [u(MERCHA, "etnachta", "conjunctive"), u(TIPCHA, "etnachta"), u(ETNACHTA, "etnachta"),
    u(MERCHA, "sof-pasuk", "conjunctive"), u(TIPCHA, "sof-pasuk"), u(SILLUQ, "sof-pasuk")];
  // the creation refrain is the sof-pasuk phrase only; the etnachta half stays regular
  assert.deepEqual(ids(units, { special: "creation" }), ["mercha", "tipcha", "etnachta", "creation:mercha>tipcha", "creation:tipcha", "creation:silluq"]);
  const c = scoreVerse({ units, special: "creation" }, { table });
  assert.equal(c.special, "creation");
  assert.equal(c.specialCells, true);
  for (const name of ["journeys", "song-of-the-sea"]) {
    const s = scoreVerse({ units, special: name }, { table });
    assert.equal(s.special, name);
    assert.equal(s.specialCells, false);   // regular cells: a renderer should skip or use a recording
    assert.equal(s.units.at(-1).cell.id, "silluq");
  }
  const plain = scoreVerse({ units }, { table });
  assert.equal(plain.special, null);
  assert.equal("specialCells" in plain, false);
});

test("the key pins degree 1: F3 reproduces the published pitches (silluq ends on C3); D4 works as with the haftarah", () => {
  const units = [u(TIPCHA, "sof-pasuk"), u(SILLUQ, "sof-pasuk")];
  assert.equal(scoreVerse({ units }, { table, key: "F3" }).events.at(-1).midi, 48);   // C3
  assert.equal(scoreVerse({ units }, { table, key: "D4" }).events.at(-1).midi, 57);   // A3 = 5_ below D4
  const high = withVariants(table, { silluq: "high" });
  assert.equal(scoreVerse({ units }, { table: high, key: "F3" }).events.at(-1).midi, 53);   // F3
});

test("the corpus fixture: 83 MAM verses, flags from the report's hebcal list", () => {
  const v = corpus.verses;
  assert.equal(v.length, 83);
  const set = s => v.filter(x => x.set === s).length;
  assert.deepEqual([set("core"), set("full"), set("rare"), set("extra")], [31, 43, 6, 3]);
  const book = v.filter(x => x.endOfBook).map(x => x.ref).sort();
  assert.deepEqual(book, ["Deuteronomy 34:12", "Exodus 40:38", "Genesis 50:26", "Leviticus 27:34", "Numbers 36:13"]);
  for (const x of v.filter(x => x.endOfBook)) assert.equal(x.endOfAliyah, true, x.ref);
  for (const ref of ["Exodus 36:7", "Exodus 14:4", "Deuteronomy 1:21", "Deuteronomy 14:29", "Leviticus 6:11"]) assert.equal(v.find(x => x.ref === ref).endOfAliyah, true, ref);
  assert.equal(v.find(x => x.ref === "Genesis 1:5").special, "creation");
});

// Known gaps: none. Every verse of the 83 scores with zero fallback cells. (The Decalogue's 27
// dual-cantillation verses are deliberately not in the corpus: torah-grammar.md §3.2.)
const KNOWN_GAPS = {};

test("end to end: every corpus verse through verseUnits + scoreVerse, one note group per syllable, no fallback", () => {
  const cadences = {}, used = new Set();
  for (const v of corpus.verses) {
    const units = verseUnits(v.he, { final: v.final, ref: v.ref });
    const score = scoreVerse({ ...units, endOfAliyah: v.endOfAliyah, endOfBook: v.endOfBook, special: v.special }, { table });
    assert.equal(score.units.length, units.units.length, v.ref);
    score.units.forEach((w, i) => {
      assert.equal(w.syllables.length, Math.max(1, units.units[i].syllables.length), `${v.ref} ${w.text}`);
      w.syllables.forEach((s, k) => assert.ok(s.notes.length >= 1, `${v.ref} ${w.text} syllable ${k} has no notes`));
      if (!KNOWN_GAPS[v.ref]) assert.ok(!w.cell.id.startsWith("fallback"), `${v.ref} ${w.text}: ${w.cell.id}`);
    });
    cadences[v.ref] = score.units.at(-1).cell.id;
    score.units.forEach(w => used.add(w.cell.id));
  }
  assert.equal(cadences["Exodus 36:7"], "aliyah:silluq@no-tipcha");
  assert.equal(cadences["Exodus 14:4"], "aliyah:silluq@no-tipcha");
  assert.equal(cadences["Deuteronomy 1:21"], "aliyah:silluq");
  assert.equal(cadences["Genesis 50:26"], "book:silluq");
  assert.equal(cadences["Genesis 1:5"], "creation:silluq");
  assert.equal(cadences["Genesis 1:1"], "silluq");
  for (const id of ["shalshelet", "mercha-kefula", "karnei-farah", "yerach-ben-yomo", "munach>yerach-ben-yomo"]) assert.ok(used.has(id), `corpus never reaches ${id}`);
});
