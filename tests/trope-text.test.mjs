import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolveMarkup, verseUnits, verseToSyllableString, pronunciationProfile } from "../trope/text.mjs";

const require = createRequire(import.meta.url);
const lib = require("../template/lib.js");
const json = p => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const weekMin = json("./fixtures/week-min/sheet.json");
const weekNotes = json("./fixtures/week-notes/sheet.json");
const edge = json("./fixtures/trope/edge-cases.json");
const PROFILE = pronunciationProfile();

const verse = (sheet, ref) => sheet.verses.find(v => v.ref === ref);
const units = (ref, opts = {}) => {
  const v = verse(weekNotes, ref) || edge.verses.find(e => e.ref === ref);
  assert.ok(v, `fixture verse ${ref}`);
  return verseUnits(v.he, { ref, final: ref === "I Samuel 20:42", ...opts });
};
const letters = s => s.replace(/[^א-ת]/g, "");
// The k-th unit (default first) whose consonants are these.
const unit = (obj, cons, k = 0) => {
  const u = obj.units.filter(x => letters(x.text) === cons)[k];
  assert.ok(u, `unit ${cons} in ${obj.ref}`);
  return u;
};
const sy = (u, opts) => verseToSyllableString({ units: [u], pronunciation: "israeli-v1" }, opts);
const tonics = u => u.syllables.filter(s => s.stress === "tonic");

// ---- §6.3: the contract sample, field by field ---------------------------------------
test("§6.3 I Samuel 20:18: the full contract object", () => {
  const o = units("I Samuel 20:18");
  assert.equal(o.ref, "I Samuel 20:18");
  assert.equal(o.version, "Miqra according to the Masorah");
  assert.equal(o.pronunciation, "israeli-v1");
  assert.equal(o.final, false);
  const S = (he, ph, stress = null, accent = null, closed = false, sheva = null) => ({ he, ph, stress, accent, closed, sheva });
  const expected = [
    { text: "וַיֹּאמֶר־ל֥וֹ", words: ["וַיֹּאמֶר־", "ל֥וֹ"], range: [0, 14], accents: [["merkha", "05A5", "conjunctive"]], trope: ["etnachta", 0, 0, 4],
      syllables: [S("וַ", ["v", "a", "j"], null, null, true), S("יֹּא", ["j", "o"]), S("מֶר", ["m", "e", "r"], null, null, true), S("ל֥וֹ", ["l", "o"], "tonic", "merkha")] },
    { text: "יְהוֹנָתָ֖ן", words: ["יְהוֹנָתָ֖ן"], range: [15, 26], accents: [["tipcha", "0596", "disjunctive"]], trope: ["etnachta", 0, 1, 4],
      syllables: [S("יְ", ["j", "e"], null, null, false, "na"), S("הוֹ", ["h", "o"]), S("נָ", ["n", "a"]), S("תָ֖ן", ["t", "a", "n"], "tonic", "tipcha", true)] },
    { text: "מָחָ֣ר", words: ["מָחָ֣ר"], range: [27, 33], accents: [["munach", "05A3", "conjunctive"]], trope: ["etnachta", 0, 2, 4],
      syllables: [S("מָ", ["m", "a"]), S("חָ֣ר", ["x", "a", "r"], "tonic", "munach", true)] },
    { text: "חֹ֑דֶשׁ", words: ["חֹ֑דֶשׁ"], range: [34, 41], accents: [["etnachta", "0591", "disjunctive"]], trope: ["etnachta", 0, 3, 4],
      syllables: [S("חֹ֑", ["x", "o"], "tonic", "etnachta"), S("דֶשׁ", ["d", "e", "sh"], null, null, true)] },
    { text: "וְנִפְקַ֕דְתָּ", words: ["וְנִפְקַ֕דְתָּ"], range: [42, 56], accents: [["zakef-gadol", "0595", "disjunctive"]], trope: ["zakef-gadol", 1, 0, 1],
      syllables: [S("וְ", ["v", "e"], null, null, false, "na"), S("נִפְ", ["n", "i", "f"], null, null, true, "nach"), S("קַ֕דְ", ["k", "a", "d"], "tonic", "zakef-gadol", true, "nach"), S("תָּ", ["t", "a"])] },
    { text: "כִּ֥י", words: ["כִּ֥י"], range: [57, 62], accents: [["merkha", "05A5", "conjunctive"]], trope: ["sof-pasuk", 2, 0, 3],
      syllables: [S("כִּ֥י", ["k", "i"], "tonic", "merkha")] },
    { text: "יִפָּקֵ֖ד", words: ["יִפָּקֵ֖ד"], range: [63, 72], accents: [["tipcha", "0596", "disjunctive"]], trope: ["sof-pasuk", 2, 1, 3],
      syllables: [S("יִ", ["j", "i", "p"], null, null, true), S("פָּ", ["p", "a"]), S("קֵ֖ד", ["k", "e", "d"], "tonic", "tipcha", true)] },
    { text: "מוֹשָׁבֶֽךָ׃", words: ["מוֹשָׁבֶֽךָ׃"], range: [73, 85], accents: [["silluq", "05BD", "disjunctive"]], trope: ["sof-pasuk", 2, 2, 3],
      syllables: [S("מוֹ", ["m", "o"]), S("שָׁ", ["sh", "a"]), S("בֶֽ", ["v", "e"], "tonic", "silluq"), S("ךָ", ["x", "a"])] },
  ];
  assert.equal(o.units.length, expected.length);
  o.units.forEach((u, i) => {
    const e = expected[i];
    assert.equal(u.text, e.text.normalize("NFD"));
    assert.deepEqual(u.words, e.words.map(w => w.normalize("NFD")));
    assert.deepEqual(u.range, e.range);
    assert.equal(o.he.slice(...u.range), u.text);
    assert.deepEqual(u.accents, e.accents.map(([name, cp, role]) => ({ name, cp, role })));
    const [family, phrase, pos, of] = e.trope;
    assert.deepEqual({ family: u.trope.family, phrase: u.trope.phrase, pos: u.trope.pos, of: u.trope.of }, { family, phrase, pos, of });
    assert.deepEqual(u.syllables.map(s => ({ he: s.he, ph: s.ph, stress: s.stress, accent: s.accent, closed: s.closed, sheva: s.sheva })),
      e.syllables.map(s => ({ ...s, he: s.he.normalize("NFD") })), `unit ${i}`);
  });
  const all = o.units.flatMap(u => u.syllables);
  assert.equal(all.length, 24);
  assert.deepEqual(all.map((s, i) => s.stress === "tonic" ? i : -1).filter(i => i >= 0), [3, 7, 9, 10, 14, 16, 19, 22]);
  assert.deepEqual([...new Set(o.units.map(u => u.trope.family))], ["etnachta", "zakef-gadol", "sof-pasuk"]);
  // §6.3's sample writes "va.jo.meʁ" but "jip.pa.ˈked": the forte is written in one and not the other.
  // Here the IPA is always the phonemes, and those double the forte (ph of וַ is v a j in §6.3 too).
  assert.equal(o.ipa, "vaj.jo.meʁ-ˈlo je.ho.na.ˈtan ma.ˈχaʁ ˈχo.deʃ ve.nif.ˈkad.ta ˈki jip.pa.ˈked mo.ʃa.ˈve.χa");
});

test("verseToSyllableString writes the gold-set notation", () => {
  assert.equal(verseToSyllableString(units("I Samuel 20:18")),
    "va-YO-mer LO ye-ho-na-TAN ma-CHAR CHO-desh ve-nif-KAD-ta KI yi-pa-KED mo-sha-VE-cha");
  // Without the lexical heuristic only the real tonic is capitalized.
  assert.match(verseToSyllableString(units("I Samuel 20:18"), { lexical: false }), /^va-yo-mer LO /);
});

// ---- §6.5: invariants over every verse of both fixture weeks (and the edge-case verses) ----
const VOWEL_POINTS = /[ֱ-ׇֻ]/g;
// Vowels written in a reading text: every full vowel point, plus shureq (vav + dagesh with no vowel).
function writtenVowels(read) {
  const s = read.normalize("NFD");
  let n = (s.match(VOWEL_POINTS) || []).length;
  const groups = s.match(/[א-ת][^א-ת]*/g) || [];
  for (const g of groups) if (g[0] === "ו" && g.includes("ּ") && !/[ְ-ׇֻ]/.test(g)) n++;
  return n;
}
// The verse text minus markup, computed independently of the resolver.
function plainText(html) {
  return html
    .replace(/<span class="mam-kq-k">[^<]*<\/span>/g, "")
    .replace(/<span class="pisqa"><\/span>/g, "")
    .replace(/<span class="mam-spi-(samekh|pe)">[^<]*<\/span>/g, "").replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "").replace(/&thinsp;|&nbsp;/g, " ").replace(/[[\]]/g, "")
    .replace(/\s+/g, " ").trim().normalize("NFD");
}

const corpora = [
  ["week-min", weekMin.verses],
  ["week-notes", weekNotes.verses],
  ["edge-cases", edge.verses],
];
for (const [name, verses] of corpora) {
  test(`§6.5 invariants: every verse of ${name}`, () => {
    const objs = verses.map((v, i) => verseUnits(v.he, { ref: v.ref, final: name !== "edge-cases" && i === verses.length - 1 }));
    objs.forEach((o, vi) => {
      const ref = o.ref;
      // Round trip: resolved text = the verse minus markup; units are exact slices of it; syllables
      // tile their unit (maqaf and sof pasuq belong to no syllable).
      assert.equal(o.he, plainText(verses[vi].he), `${ref} round trip`);
      for (const u of o.units) {
        assert.equal(o.he.slice(...u.range), u.text, `${ref} range`);
        assert.equal(u.words.join(""), u.text, `${ref} words`);
        assert.equal(u.syllables.map(s => s.he).join(""), u.text.replace(/[־׃]/g, ""), `${ref} syllables tile ${u.text}`);
        // Exactly one tonic per accented unit, none in an unaccented one.
        assert.equal(tonics(u).length, u.accents.length ? 1 : 0, `${ref} tonic count in ${u.text}`);
        // The tonic carries its accent's mark (or MAM's helper copy), except where a furtive patach
        // pushed the stress back one syllable.
        const t = u.syllables.findIndex(s => s.stress === "tonic");
        if (t >= 0) {
          const s = u.syllables[t], next = u.syllables[t + 1];
          const a = u.accents.find(x => x.name === s.accent);
          const chars = a.name === "zarka" ? ["֘", "֮"] : [String.fromCodePoint(parseInt(a.cp, 16))];
          const where = s.read || s.he;
          if (!(next && next.furtive)) assert.ok(chars.some(c => where.includes(c)), `${ref} tonic ${where} carries ${a.name}`);
        }
        // Syllables = vowels (full vowels, shureq, vocal shevas); one vowel phoneme each; every phoneme known.
        const read = u.syllables.map(s => s.read ?? s.he).join("");
        const na = u.syllables.filter(s => s.sheva === "na").length;
        assert.equal(u.syllables.length, writtenVowels(read) + na, `${ref} syllables vs vowels in ${u.text}`);
        for (const s of u.syllables) {
          assert.equal(s.ph.filter(p => PROFILE.symbols[p] && PROFILE.symbols[p].type === "vowel").length, 1, `${ref} one vowel in ${s.he} ${s.ph}`);
          for (const p of s.ph) assert.ok(typeof p === "string" && PROFILE.symbols[p], `${ref} phoneme ${p} in ${s.he}`);
          if (s.sheva === "na") assert.ok(s.he.includes("ְ") || (s.read || "").includes("ְ"), `${ref} sheva na has a sheva`);
        }
        assert.ok(u.trope.family, `${ref} family for ${u.text}`);
      }
      assert.deepEqual(o.warnings.filter(w => !/^strict havarotjs/.test(w)), [], `${ref} warnings`);
    });
    // The engine's families equal the chanter's copy's legend.
    if (name !== "edge-cases") {
      const fams = new Set(objs.flatMap(o => o.units.map(u => u.trope.family)));
      assert.deepEqual([...fams].sort(), [...lib.tropeFamiliesUsed(verses)].sort());
    }
  });
}

// ---- §6.4 edge cases, by number -------------------------------------------------------
test("6.4 #1 maqaf chains: two and three words, monosyllabic end, meteg on a non-final word", () => {
  const u = unit(units("I Samuel 20:18"), "ויאמרלו");
  assert.equal(u.words.length, 2);
  assert.ok(u.syllables.slice(0, 3).every(s => s.stress === null), "no stress on the first word");
  const k = unit(units("II Kings 4:2"), "מהישלך");
  assert.equal(k.words.length, 3);
  assert.equal(sy(k, { lexical: false }), "ma yesh LACH");
  const a = unit(units("I Samuel 20:38"), "אלתעמד");
  assert.equal(a.syllables[0].stress, "secondary");
  assert.equal(a.syllables[0].meteg, true);
  assert.equal(sy(a), "al ta-a-MOD");
  const l = unit(units("I Samuel 20:20"), "לשלחלי");
  assert.equal(sy(l), "le-sha-LACH LI");
  assert.equal(tonics(l).length, 1);
});

test("6.4 #2 doubled postpositives: the copy off the word edge is the stress", () => {
  assert.equal(sy(unit(units("I Samuel 20:27"), "החדש")), "ha-CHO-desh");
  assert.equal(sy(unit(units("I Samuel 20:25"), "ויקם")), "va-YA-kom");
  assert.equal(sy(unit(units("I Samuel 20:29"), "זבח")), "ZE-vach");               // telisha ketana
  assert.equal(sy(unit(units("I Samuel 20:41"), "הנער")), "ha-NA-ar");             // zarka + helper
  assert.equal(sy(unit(units("II Kings 23:4"), "אתחלקיהו")), "et chil-ki-YA-hu");  // telisha ketana
  const j = unit(units("Isaiah 40:2"), "ירושלם");                                    // with CGJ
  assert.equal(sy(j), "ye-ru-sha-LA-yim");
  assert.equal(tonics(j)[0].accent, "pashta");
});

test("6.4 #3 a single postpositive sits on a final-stressed word", () => {
  const amor = unit(units("I Samuel 20:21"), "אםאמר");
  assert.equal(sy(amor), "im a-MOR");
  assert.equal(tonics(amor)[0].accent, "telisha-ketana");
  assert.equal(sy(unit(units("I Samuel 20:41"), "בא")), "BA");
  assert.equal(sy(unit(units("I Samuel 20:22"), "אמר")), "o-MAR");
});

test("6.4 #4 prepositives: doubled telisha gedola takes the later copy; yetiv", () => {
  const m = unit(units("I Samuel 20:25"), "המלך");
  assert.equal(sy(m), "ha-ME-lech");
  assert.equal(m.accents[0].name, "telisha-gedola");
  assert.equal(m.accents.length, 1, "the doubled copy is one accent");
  assert.equal(sy(unit(units("II Kings 4:1"), "בניהנביאים")), "ve-NE ha-ne-vi-IM");
  const y = unit(units("Isaiah 40:6"), "קול");
  assert.equal(y.accents[0].name, "yetiv");
  assert.equal(tonics(y).length, 1);
});

test("6.4 #5 legarmeh vs plain paseq vs shalshelet's paseq", () => {
  const v = units("I Samuel 20:21");
  const leg = unit(v, "החצים");
  assert.equal(leg.legarmeh, true);
  assert.equal(leg.accents[0].name, "legarmeh");
  assert.equal(leg.trope.family, "revia");
  const pq = unit(v, "קחנו");
  assert.equal(pq.paseq, true);
  assert.equal(pq.legarmeh, false);
  assert.equal(pq.trope.accent, "darga");
  assert.match(v.he, / ׀ /);
  const amos = units("Amos 1:2");
  const sh = unit(amos, "ויאמר");
  assert.equal(sh.legarmeh, false, "bold stroke after shalshelet is not legarmeh");
  assert.equal(sh.paseq, true);
  assert.equal(sh.trope.accent, "shalshelet");
  assert.equal(sh.trope.family, "segol");   // lib.js BLOCK_ENDING groups shalshelet with segol
});

test("6.4 #6 meteg: silluq vs ga'ya; a sheva after meteg is vocal", () => {
  const last = units("I Samuel 20:19").units.at(-1);
  assert.equal(tonics(last)[0].accent, "silluq");
  const g = unit(units("I Samuel 20:19"), "המעשה");
  assert.equal(g.syllables[0].stress, "secondary");
  assert.equal(tonics(g)[0].accent, "etnachta");
  assert.equal(sy(unit(units("I Samuel 20:41"), "וישקו")), "va-yi-she-KU");
  assert.equal(sy(unit(units("Isaiah 40:2"), "מלאה")), "ma-le-A");
});

test("6.4 #7 ketiv/qere: k-first, q-first, trivial, ketiv velo qere, qere velo ketiv", () => {
  const k = units("I Samuel 20:24");
  assert.equal(sy(unit(k, "אלהלחם")), "el ha-LE-chem");
  assert.ok(!k.he.includes("על"), "the ketiv is not read");
  assert.equal(sy(unit(units("I Samuel 20:38"), "אתהחצים")), "et ha-chi-TZIM");
  const triv = unit(units("Ezekiel 37:19"), "חברו");
  assert.equal(sy(triv), "cha-ve-RAV");
  assert.deepEqual(triv.syllables.at(-1).ph, ["r", "a", "v"]);
  const ruth = units("Ruth 3:12");
  assert.ok(!ruth.units.some(u => letters(u.text) === "אם"), "ketiv velo qere is skipped");
  assert.equal(verseToSyllableString(ruth).split(" ").slice(3, 5).join(" "), "KI go-EL");
  assert.equal(sy(unit(units("Jeremiah 31:38"), "באים")), "ba-IM");
  assert.equal(sy(unit(units("II Samuel 8:3"), "בנהרפרת")), "bi-ne-HAR pe-RAT");
});

test("6.4 #8 the divine name: Adonai, Elohim, accents carried, prefixed", () => {
  const a = unit(units("I Samuel 20:21"), "חייהוה");
  assert.equal(a.name, "adonai");
  assert.equal(sy(a), "chay a-do-NAY");
  assert.equal(tonics(a)[0].accent, "silluq");
  assert.equal(a.syllables.slice(1).map(s => s.he).join(""), "יְהֹוָֽה".normalize("NFD"));
  assert.deepEqual(a.syllables.slice(1).map(s => s.read), ["אֲ", "דֹ", "נָֽי"].map(s => s.normalize("NFD")));
  const e = unit(units("Ezekiel 37:19"), "יהוה");
  assert.equal(e.name, "elohim");
  assert.equal(sy(e), "e-lo-HIM");
  assert.equal(tonics(e)[0].accent, "segol");
  const p = unit(units("I Samuel 20:42"), "יהוה");
  assert.equal(tonics(p)[0].accent, "pashta");
  assert.equal(sy(unit(units("Jeremiah 31:38"), "ליהוה")), "la-do-NAY");
  assert.equal(sy(unit(units("Isaiah 41:16"), "ביהוה")), "ba-do-NAY");
});

test("6.4 #9 qamats qatan and hataf qamats are o", () => {
  const b = unit(units("I Samuel 20:34"), "בחריאף");
  assert.equal(sy(b), "bo-cho-RI AF");
  assert.equal(sy(unit(units("I Samuel 20:27"), "ממחרת")), "mi-mo-cho-RAT");
  assert.equal(b.syllables[0].vowel, "QAMATS_QATAN");
});

test("6.4 #10 holam haser for vav vs holam male", () => {
  const a = unit(units("Isaiah 40:2"), "עונה");
  assert.deepEqual(a.syllables.map(s => s.ph), [["a"], ["v", "o"], ["n", "a", "h"]]);
  assert.deepEqual(unit(units("I Samuel 20:18"), "ויאמרלו").syllables.at(-1).ph, ["l", "o"]);
  assert.equal(sy(unit(units("II Kings 23:3"), "מצותיו")), "mitz-vo-TAV");
});

test("6.4 #11 mappiq he and furtive patach", () => {
  assert.deepEqual(unit(units("Isaiah 40:2"), "צבאה").syllables.at(-1).ph, ["a", "h"]);
  const g = unit(units("Isaiah 40:9"), "הרגבה");
  assert.equal(sy(g), "har ga-VO-ah");
  assert.equal(g.syllables.at(-1).furtive, true);
  assert.deepEqual(g.syllables.at(-1).ph, ["a", "h"]);
  assert.equal(sy(unit(units("I Samuel 20:27"), "מדוע")), "ma-DU-a");
  const l = unit(units("Ezekiel 37:21"), "לקח");
  assert.equal(sy(l), "lo-KE-ach");
  assert.deepEqual(l.syllables.at(-1).ph, ["a", "x"]);
});

test("6.4 #12 quiescent alef; alef with a vowel has no onset", () => {
  assert.deepEqual(unit(units("I Samuel 20:18"), "ויאמרלו").syllables[1].ph, ["j", "o"]);
  assert.equal(sy(unit(units("I Samuel 20:42"), "לאמר")), "le-MOR");
  assert.deepEqual(unit(units("II Kings 4:2"), "אליה").syllables[0].ph, ["e"]);
});

test("6.4 #13 sheva: initial, two mid-word, under forte, after a long vowel, sqnmlvy, final", () => {
  const v = units("I Samuel 20:18");
  assert.equal(unit(v, "יהונתן").syllables[0].sheva, "na");
  assert.deepEqual(unit(v, "ונפקדת").syllables.map(s => s.sheva), ["na", "nach", "nach", null]);
  assert.equal(sy(unit(units("I Samuel 20:21"), "ממך")), "mi-me-CHA");
  assert.equal(sy(unit(units("I Samuel 20:23"), "ובינך")), "u-ve-ne-CHA");      // Tiberian default
  assert.equal(sy(unit(units("I Samuel 20:22"), "והלאה")), "va-HA-le-a");
  assert.equal(sy(unit(units("I Samuel 20:24"), "ויהי")), "va-ye-HI");           // sqnmlvy
  assert.equal(sy(unit(units("I Samuel 20:38"), "וילקט")), "va-ye-la-KET");
  const lech = unit(units("I Samuel 20:21"), "לך");
  assert.deepEqual(lech.syllables.map(s => s.ph), [["l", "e", "x"]]);
  // The Israeli habit is one flag in the profile (havarotjs longVowels: false).
  const israeli = { ...PROFILE, syllabifier: { ...PROFILE.syllabifier, longVowels: false } };
  assert.equal(sy(unit(units("I Samuel 20:23", { pronunciation: israeli }), "ובינך")), "u-ven-CHA");
});

test("6.4 #14 dagesh lene vs forte", () => {
  const b = unit(units("I Samuel 20:24"), "בשדה");
  assert.deepEqual(b.syllables.map(s => s.ph), [["b", "a", "s"], ["s", "a"], ["d", "e"]]);
  assert.equal(b.syllables[0].gem, "s");
  assert.deepEqual(unit(units("I Samuel 20:25"), "הקיר").syllables.map(s => s.ph), [["h", "a", "k"], ["k", "i", "r"]]);
  const t = unit(units("Ezekiel 37:20"), "אשרתכתב");
  assert.deepEqual(t.syllables.slice(2).map(s => s.ph), [["t", "i", "x"], ["t", "o", "v"]]);
  assert.ok(!t.syllables[2].gem, "lene after a silent sheva doubles nothing");
  // geminate: "single" writes the forte once.
  const single = { ...PROFILE, rules: { ...PROFILE.rules, geminate: "single" } };
  assert.deepEqual(unit(units("I Samuel 20:24", { pronunciation: single }), "בשדה").syllables[0].ph, ["b", "a"]);
});

test("6.4 #15 two accents on one word: the disjunctive is the tonic, the conjunctive secondary", () => {
  const y = unit(units("I Samuel 20:25"), "יהונתן");
  assert.deepEqual(y.syllables.map(s => s.stress), [null, "secondary", null, "tonic"]);
  assert.deepEqual(y.accents.map(a => a.name), ["munach", "zakef-katan"]);
  assert.equal(y.trope.accent, "zakef-katan");
  const m = unit(units("I Samuel 20:25"), "עלמושבו");
  assert.equal(m.trope.accent, "geresh");
  assert.equal(m.syllables.find(s => s.accent === "kadma").stress, "secondary");
  assert.equal(sy(unit(units("I Samuel 20:19"), "וישבת")), "ve-ya-shav-TA");
  assert.equal(sy(unit(units("I Samuel 20:23"), "והדבר")), "ve-ha-da-VAR");
});

test("6.4 #16 unaccented words: maqaf-joined, and meteg only", () => {
  const k = unit(units("I Samuel 20:30"), "כיבחר");
  assert.equal(k.syllables[0].stress, "secondary");
  assert.equal(tonics(k).length, 1);
  assert.equal(sy(k), "ki vo-CHER");
});

test("6.4 #17 pisqa mid-verse; a raw API string gives the same units as the sheet text", () => {
  const v = units("I Samuel 20:27");
  const before = unit(v, "דוד");
  assert.equal(before.pisqa, true);
  assert.equal(v.units.filter(u => u.pisqa).length, 1);
  const e = edge.verses.find(x => x.ref === "Isaiah 40:2");
  const raw = verseUnits(e.raw, { ref: e.ref });
  const clean = verseUnits(e.he, { ref: e.ref });
  assert.equal(raw.break, "setumah");
  assert.deepEqual(raw.units, clean.units);
});

test("6.4 #18 the haftarah's last verse ends in sof-haftarah, the others in sof-pasuk", () => {
  const last = units("I Samuel 20:42", { final: true });
  assert.equal(last.units.at(-1).trope.family, "sof-haftarah");
  assert.equal(last.units.at(-1).trope.accent, "silluq");
  assert.equal(units("I Samuel 20:41").units.at(-1).trope.family, "sof-pasuk");
});

test("6.4 #19 markup noise (synthetic markup around real words): footnote, implicit maqaf, &nbsp;, invnun", () => {
  const html = 'וַיֹּאמֶר<span class="mam-implicit-maqaf">־</span>ל֥וֹ<sup>*</sup><i class="footnote">A note with <i>nested</i> text</i>&nbsp;&nbsp;יְהוֹנָתָ֖ן <span class="mam-spi-invnun">׆</span> מָחָ֣ר';
  const r = resolveMarkup(html);
  assert.equal(r.text, "וַיֹּאמֶר־ל֥וֹ יְהוֹנָתָ֖ן מָחָ֣ר".normalize("NFD"));
  assert.equal(verseUnits(html).units[0].words.length, 2);
});
