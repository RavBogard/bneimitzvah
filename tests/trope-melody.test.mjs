import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectCell, fitSyllables, scoreVerse, unitContext, unitTrope, keyToMidi, degreeSemitones, withVariants } from "../trope/melody.mjs";
import { scoreToMidi } from "../trope/midi.mjs";

const table = JSON.parse(readFileSync(new URL("../trope/cells/haftarah.json", import.meta.url), "utf8"));
const verse = JSON.parse(readFileSync(new URL("./fixtures/trope/i-samuel-20-18.units.json", import.meta.url), "utf8"));
const degs = notes => notes.map(n => n.deg);
const cellFor = (v, i) => selectCell(v.units[i], unitContext(v.units, i, { final: v.final }), table);
// A word of n syllables with the tonic at index t, for fitting tests.
const word = (n, t) => ({ syllables: Array.from({ length: n }, (_, k) => ({ he: `s${k}`, ph: [], stress: k === t ? "tonic" : null })) });
const byId = id => table.cells.find(c => c.id === id);

test("every cell has an id, a trope, a context, at least one core note and a source", () => {
  const ids = new Set();
  for (const c of table.cells) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id ${c.id}`); ids.add(c.id);
    assert.ok(table.tropeIds.includes(c.trope), `${c.id}: unknown trope ${c.trope}`);
    assert.equal(typeof c.context, "object", `${c.id}: no context`);
    assert.ok(Array.isArray(c.upbeats), `${c.id}: no upbeats array`);
    assert.ok(c.core.length >= 1, `${c.id}: empty core`);
    assert.match(c.source, /trope-grammar\.md L\d+/, `${c.id}: no source line`);
    for (const n of [...c.upbeats, ...c.core]) {
      assert.ok(Number.isInteger(n.deg) && n.dur > 0, `${c.id}: bad note ${JSON.stringify(n)}`);
      assert.ok(String(n.deg) in table.degrees.semitones, `${c.id}: degree ${n.deg} not in the map`);
    }
    for (const v of Object.values(c.variants || {})) assert.ok(v.core.length >= 1, `${c.id}: empty variant`);
  }
  // one default per trope, so every trope the table names has somewhere to land
  for (const t of table.tropeIds) assert.ok(table.cells.some(c => c.trope === t && Object.keys(c.context).length === 0), `no default cell for ${t}`);
});

test("the four end-of-haftarah components and both phrase endings are in the table", () => {
  for (const id of ["end:tipcha", "end:mercha>tipcha", "end:mercha>silluq", "end:silluq", "etnachta", "silluq"]) assert.ok(byId(id), id);
  assert.equal(byId("silluq").core.at(-1).deg, 1);      // sof pasuk is the only disjunctive ending on 1
  assert.equal(byId("etnachta").core.at(-1).deg, 4);    // etnachta ends on 4
});

test("unitTrope reads codepoints, not spellings", () => {
  assert.deepEqual(verse.units.map(unitTrope), ["mercha", "tipcha", "munach", "etnachta", "zakef-gadol", "mercha", "tipcha", "silluq"]);
  assert.equal(unitTrope({ accents: [{ name: "munach", cp: "05A3", role: "conjunctive" }, { name: "zaqef", cp: "0594", role: "disjunctive" }] }), "zakef-katan");
});

test("selectCell picks the right context for each word of I Samuel 20:18", () => {
  const got = verse.units.map((_, i) => cellFor(verse, i).id);
  assert.deepEqual(got, [
    "mercha",                    // mercha before tipcha, etnachta group: the default mercha
    "tipcha",                    // tipcha before etnachta (via munach): default
    "munach>etnachta",           // munach immediately before etnachta
    "etnachta",
    "zakef-gadol",
    "mercha>tipcha@sof-pasuk",   // mercha before tipcha in the sof-pasuk group differs from the default
    "tipcha@sof-pasuk",          // tipcha before silluq differs from tipcha before etnachta
    "silluq",
  ]);
});

test("the final-verse flag switches the sof-pasuk phrase to the end-of-haftarah cadence", () => {
  const last = { ...verse, final: true };
  const got = last.units.map((_, i) => cellFor(last, i).id);
  assert.deepEqual(got.slice(0, 5), ["mercha", "tipcha", "munach>etnachta", "etnachta", "zakef-gadol"]);
  assert.deepEqual(got.slice(5), ["end:mercha>tipcha", "end:tipcha", "end:silluq"]);
  // the text front end may instead name the family sof-haftarah (lib.js); same result
  const fam = { ...verse, units: verse.units.map(u => u.trope.family === "sof-pasuk" ? { ...u, trope: { ...u.trope, family: "sof-haftarah" } } : u) };
  assert.deepEqual(fam.units.map((_, i) => cellFor(fam, i).id).slice(5), ["end:mercha>tipcha", "end:tipcha", "end:silluq"]);
});

test("selectCell: end pattern 3 (tipcha-mercha-silluq) gives the mercha the silluq's niggun", () => {
  const u = (cp, role, family) => ({ accents: [{ cp, role }], trope: { family }, syllables: word(2, 1).syllables });
  const units = [u("0596", "disjunctive", "sof-pasuk"), u("05A5", "conjunctive", "sof-pasuk"), u("05BD", "disjunctive", "sof-pasuk")];
  const ids = units.map((x, i) => selectCell(x, unitContext(units, i, { final: true }), table).id);
  assert.deepEqual(ids, ["end:tipcha", "end:mercha>silluq", "end:silluq"]);
});

test("selectCell: group and onOneWord contexts, and the fallback for a trope with no cell", () => {
  const ctx = { trope: "munach", before: "mahpach", group: "zakef" };
  assert.equal(selectCell({}, ctx, table).id, "munach@zakef");
  assert.equal(selectCell({}, { trope: "munach", before: "zakef-katan", group: "zakef" }, table).id, "munach>zakef-katan");
  assert.equal(selectCell({}, { trope: "munach", before: "munach", group: "segol" }, table).id, "munach>munach@segol");
  assert.equal(selectCell({}, { trope: "zakef-katan", onOneWord: ["kadma"] }, table).id, "zakef-katan+kadma");
  assert.equal(selectCell({}, { trope: "geresh", after: "kadma" }, table).id, "azla");
  // shalshelet now has a derived cell; a trope no table knows still gets the reciting tone
  assert.equal(selectCell({}, { trope: "shalshelet" }, table).id, "shalshelet");
  const fb = selectCell({}, { trope: "no-such-trope" }, table);
  assert.equal(fb.fallback, true);
  assert.deepEqual(degs(fb.core), [1]);
});

test("fitSyllables: one pre-tonic syllable takes the upbeat; stress on syllable 1 drops it", () => {
  const tipcha = byId("tipcha");   // [3] 4
  let f = fitSyllables(tipcha, word(2, 1));
  assert.deepEqual(f.syllables.map(s => degs(s.notes)), [[3], [4]]);
  assert.equal(f.dropped, null);
  f = fitSyllables(tipcha, word(1, 0));
  assert.deepEqual(f.syllables.map(s => degs(s.notes)), [[4]]);
  assert.deepEqual(f.dropped.deg, 3);   // available to the previous word under elision
});

test("fitSyllables: extra pre-tonic syllables repeat the first upbeat", () => {
  const silluq = byId("silluq");   // [7_, 1] 3, 1
  assert.deepEqual(fitSyllables(silluq, word(2, 1)).syllables.map(s => degs(s.notes)), [[1], [3, 1]]);
  assert.deepEqual(fitSyllables(silluq, word(3, 2)).syllables.map(s => degs(s.notes)), [[0], [1], [3, 1]]);
  assert.deepEqual(fitSyllables(silluq, word(4, 3)).syllables.map(s => degs(s.notes)), [[0], [0], [1], [3, 1]]);
  assert.deepEqual(fitSyllables(byId("tipcha"), word(4, 3)).syllables.map(s => degs(s.notes)), [[3], [3], [3], [4]]);
});

test("fitSyllables: a mil'el word gives the last core note to its post-tonic syllable", () => {
  const etnachta = byId("etnachta");   // [1] 3, 1, 3, 5, 4
  const f = fitSyllables(etnachta, word(2, 0));   // חֹ֑דֶשׁ
  assert.deepEqual(f.syllables.map(s => degs(s.notes)), [[3, 1, 3, 5], [4]]);
  assert.deepEqual(f.syllables[0].notes.map(n => n.slur), [false, true, true, true]);
  assert.equal(f.syllables[1].notes[0].slur, false);
  // double pashta: "first mark [1] 5; second mark 4" falls out of the same rule
  assert.deepEqual(fitSyllables(byId("pashta"), word(3, 1)).syllables.map(s => degs(s.notes)), [[1], [5], [4]]);
  // q = 2 repeats the last note; a one-note core is repeated rather than emptied
  assert.deepEqual(fitSyllables(byId("pashta"), word(3, 0)).syllables.map(s => degs(s.notes)), [[5], [4], [4]]);
  assert.deepEqual(fitSyllables(byId("tipcha"), word(2, 0)).syllables.map(s => degs(s.notes)), [[4], [4]]);
});

test("scoreVerse: one note group per syllable, the core on the tonic syllable", () => {
  const score = scoreVerse(verse, { table, key: "D4", tempo: 96 });
  assert.equal(score.ref, "I Samuel 20:18");
  assert.equal(score.units.length, 8);
  let notes = 0;
  score.units.forEach((u, i) => {
    const src = verse.units[i];
    assert.equal(u.syllables.length, src.syllables.length);
    const cell = table.cells.find(c => c.id === u.cell.id);
    const t = src.syllables.findIndex(s => s.stress === "tonic");
    u.syllables.forEach((s, k) => {
      assert.ok(s.notes.length >= 1, `${u.text} syllable ${k} has no notes`);
      assert.equal(s.notes[0].slur, false);
      s.notes.slice(1).forEach(n => assert.equal(n.slur, true));
      notes += s.notes.length;
    });
    assert.equal(u.syllables[t].notes[0].deg, cell.core[0].deg, `${u.text}: tonic does not start the core`);
    const sung = u.syllables.slice(t).flatMap(s => degs(s.notes));
    assert.deepEqual(sung, degs(cell.core), `${u.text}: core not sung from the tonic on`);
  });
  assert.equal(score.events.length, notes);
  // events are in time order and contiguous within the verse
  for (let k = 1; k < score.events.length; k++) assert.ok(score.events[k].t >= score.events[k - 1].t + score.events[k - 1].dur - 1e-9);
  // D4 tonic: the etnachta's held 4 on דֶשׁ is G4, the silluq lands on D4
  assert.equal(score.units[3].syllables[1].notes[0].midi, 67);
  assert.equal(score.units[7].syllables.at(-1).notes.at(-1).midi, 62);
  assert.equal(scoreVerse(verse, { table, key: "A3" }).units[7].syllables.at(-1).notes.at(-1).midi, 57);
});

test("scoreVerse elision adds a dropped upbeat to the previous conjunctive", () => {
  // The fixture has no disjunctive stressed on syllable 1 after a conjunctive, so build one: mercha + monosyllabic tipcha (LBC's Gen 3:9 case)
  const units = [
    { text: "a", accents: [{ cp: "05A5", role: "conjunctive" }], trope: { family: "etnachta" }, syllables: word(2, 1).syllables },
    { text: "b", accents: [{ cp: "0596", role: "disjunctive" }], trope: { family: "etnachta" }, syllables: word(1, 0).syllables },
  ];
  const off = scoreVerse({ units }, { table });
  const on = scoreVerse({ units }, { table, elision: true });
  assert.equal(on.events.length, off.events.length + 1);
  const lastA = on.units[0].syllables.at(-1).notes.at(-1);
  assert.equal(lastA.deg, 3);
  assert.equal(lastA.elided, true);
});

test("keyToMidi, degreeSemitones and withVariants", () => {
  assert.equal(keyToMidi("D4"), 62);
  assert.equal(keyToMidi("C4"), 60);
  assert.equal(keyToMidi("Bb3"), 58);
  assert.equal(degreeSemitones(0, table), -2);
  assert.equal(degreeSemitones(8, table), 12);
  assert.equal(degreeSemitones(10, table), 15);
  const ros = withVariants(table, { silluq: "rosowsky" });
  assert.deepEqual(degs(ros.cells.find(c => c.id === "silluq").upbeats), [5]);
  assert.deepEqual(degs(byId("silluq").upbeats), [0, 1]);   // the original table is untouched
});

// A tiny SMF reader: enough to prove the bytes parse and to count notes.
function readMidi(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  assert.equal(str(0, 4), "MThd");
  assert.equal(dv.getUint32(4), 6);
  const format = dv.getUint16(8), ntrks = dv.getUint16(10), division = dv.getUint16(12);
  assert.equal(str(14, 4), "MTrk");
  const len = dv.getUint32(18);
  assert.equal(22 + len, bytes.length, "track length must cover the rest of the file");
  let p = 22, end = 22 + len, ons = 0, offs = 0, lyrics = [], eot = false, running = 0;
  const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  while (p < end) {
    vlq();
    let status = bytes[p];
    if (status & 0x80) p++; else status = running;
    if (status === 0xff) {
      const type = bytes[p++], n = vlq();
      if (type === 0x05) lyrics.push(new TextDecoder().decode(bytes.slice(p, p + n)));
      if (type === 0x2f) { eot = true; assert.equal(p + n, end, "end-of-track must be last"); }
      p += n;
    } else {
      running = status;
      const hi = status & 0xf0;
      if (hi === 0x90 && bytes[p + 1] > 0) ons++; else if (hi === 0x80 || hi === 0x90) offs++;
      p += 2;
    }
  }
  return { format, ntrks, division, ons, offs, lyrics, eot };
}

test("scoreToMidi writes a parseable format-0 file with one note per score note", () => {
  const score = scoreVerse(verse, { table });
  const m = readMidi(scoreToMidi(score));
  assert.equal(m.format, 0);
  assert.equal(m.ntrks, 1);
  assert.equal(m.division, 480);
  assert.equal(m.eot, true);
  assert.equal(m.ons, score.events.length);
  assert.equal(m.offs, score.events.length);
  const syllables = score.units.reduce((n, u) => n + u.syllables.length, 0);
  assert.equal(m.lyrics.length, syllables);
  assert.deepEqual(m.lyrics.slice(0, 4), ["vaj", "jo", "mer", "lo"]);
});
