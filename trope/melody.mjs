// The melody engine: per-verse units (hebrew-text-pipeline.md §6.3) + a cell table
// (trope/cells/*.json) -> a score JSON of notes per syllable. Pure, dependency-free ESM.
// The grammar it implements is trope-grammar.md §2.2 (syllable fitting) and §3 (contexts);
// the score JSON is the contract with every renderer (MIDI today, a singing synth later).

// Accent codepoint -> trope id. Codepoints beat names: the front end's spellings
// ("merkha", "zaqef") may drift, the Unicode does not. U+0598 is MAM's zarka helper.
const CP_TROPE = {
  "0591": "etnachta", "0592": "segol", "0593": "shalshelet", "0594": "zakef-katan",
  "0595": "zakef-gadol", "0596": "tipcha", "0597": "revia", "0598": "zarka", "0599": "pashta",
  "059A": "yetiv", "059B": "tevir", "059C": "geresh", "059D": "geresh", "059E": "gershayim",
  "059F": "karnei-farah", "05A0": "telisha-gedola", "05A1": "pazer", "05A3": "munach",
  "05A4": "mahpach", "05A5": "mercha", "05A6": "mercha-kefula", "05A7": "darga", "05A8": "kadma",
  "05A9": "telisha-ketana", "05AA": "yerach-ben-yomo", "05AE": "zarka", "05BD": "silluq",
};
const NAME_ALIASES = {
  merkha: "mercha", "merkha-kefula": "mercha-kefula", zaqef: "zakef-katan", "zaqef-qatan": "zakef-katan",
  "zakef-katon": "zakef-katan", "zaqef-gadol": "zakef-gadol", atnach: "etnachta", etnahta: "etnachta",
  tifcha: "tipcha", tipha: "tipcha", "sof-pasuk": "silluq", "sof-pasuq": "silluq", siluk: "silluq",
  legarmeh: "munach-legarmeh", mapach: "mahpach", mahpakh: "mahpach", qadma: "kadma", azla: "geresh",
  zarqa: "zarka", "telisha-qetana": "telisha-ketana", segolta: "segol",
};

const slug = s => String(s || "").toLowerCase().replace(/[\s_’']+/g, "-");
function accentTrope(a) {
  const cp = a && a.cp ? String(a.cp).toUpperCase().padStart(4, "0") : null;
  if (cp && CP_TROPE[cp]) return CP_TROPE[cp];
  const n = slug(a && a.name);
  return NAME_ALIASES[n] || n || null;
}

// The unit's own trope: the last disjunctive (a conjunctive on the same word is folded into the
// disjunctive's cell, §3 of the text report), else the last accent. Munach before a paseq arrives
// either as a legarmeh accent or as a flag on the unit.
export function unitTrope(unit) {
  const accents = (unit && unit.accents) || [];
  const dis = accents.filter(a => a.role === "disjunctive");
  const main = (dis.length ? dis : accents).at(-1);
  let trope = main ? accentTrope(main) : null;
  if (trope === "munach" && (unit.legarmeh || accents.some(a => /legarmeh/i.test(a.role || "")))) trope = "munach-legarmeh";
  if (!trope && unit && unit.trope && slug(unit.trope.family) === "sof-pasuk") trope = "silluq";
  return trope;
}

// The other accents on the unit (kadma + zakef on one word, §3 "metiga-zakef").
function otherAccents(unit, own) {
  const seen = new Set();
  for (const a of (unit.accents || [])) { const t = accentTrope(a); if (t && t !== own) seen.add(t); }
  return [...seen];
}

// The special melodies a verse may be flagged with (torah-grammar.md §3.3-3.4). Only those a table
// has cells for (context.special) are computed; the rest are still scored with the regular cells but
// reported, so a renderer can swap in a whole-passage recording.
export const SPECIAL_MELODIES = ["creation", "journeys", "song-of-the-sea"];

// A verse's reading flags, normalised. final = last verse of the reading (the haftarah cadence);
// endOfAliyah / endOfBook = the Torah cadences; special = one of SPECIAL_MELODIES or null.
// An unknown special throws: a typo must not silently fall back to the regular melody.
export function readingFlags(v = {}) {
  const special = v.special || null;
  if (special && !SPECIAL_MELODIES.includes(special)) throw new Error(`unknown special melody: ${special}`);
  return { final: Boolean(v.final), endOfAliyah: Boolean(v.endOfAliyah), endOfBook: Boolean(v.endOfBook), special };
}

const isEndFamily = fam => fam === "sof-haftarah" || fam === "sof-pasuk";
const famOf = unit => slug(unit && unit.trope && unit.trope.family);

// The fifth end-of-aliyah pattern (etnachta straight to silluq, torah-grammar.md §3.1) is the
// sof-pasuk phrase with no tipcha in it; none of the four cadence patterns then applies.
function phraseLacksTipcha(units) {
  return !units.some(u => isEndFamily(famOf(u)) && unitTrope(u) === "tipcha");
}

// Musical context of unit i in its verse, in the cell table's vocabulary.
// group is lib.js's phrase family; the last verse's sof-pasuk phrase is the end of the reading.
// The Torah cadences (endOfAliyah, endOfBook) likewise apply to the sof-pasuk phrase only, while
// special marks every unit: a special melody covers the whole verse (cells narrow it with group).
export function unitContext(units, i, { final = false, endOfAliyah = false, endOfBook = false, special = null } = {}) {
  const unit = units[i];
  const trope = unitTrope(unit);
  const fam = famOf(unit);
  const endFamily = isEndFamily(fam);
  const cadence = endFamily && (endOfAliyah || endOfBook);
  return {
    trope,
    before: i + 1 < units.length ? unitTrope(units[i + 1]) : null,
    after: i > 0 ? unitTrope(units[i - 1]) : null,
    group: fam === "sof-haftarah" ? "sof-pasuk" : fam || null,
    endOfReading: Boolean(final && endFamily) || fam === "sof-haftarah",
    endOfAliyah: Boolean(endOfAliyah && endFamily),
    endOfBook: Boolean(endOfBook && endFamily),
    noTipcha: Boolean(cadence && phraseLacksTipcha(units)),
    special: special || null,
    onOneWord: otherAccents(unit, trope),
    monosyllabic: ((unit.syllables || []).length === 1),
  };
}

// How much each satisfied context key counts toward choosing the most specific cell.
// endOfReading outranks everything (the last-verse cadence replaces the normal cells);
// "immediately before X" outranks "somewhere in X's group". A book end is also an aliyah end, so
// endOfBook (and a special melody, which replaces the cadence it falls on) must beat endOfAliyah
// even against an aliyah cell with more keys.
const WEIGHT = { endOfBook: 32, special: 32, endOfReading: 16, endOfAliyah: 16, before: 8, after: 4, onOneWord: 4, monosyllabic: 2, noTipcha: 2, group: 1 };
const BOOLEAN_KEYS = new Set(["endOfReading", "endOfAliyah", "endOfBook", "noTipcha", "monosyllabic"]);

function keyMatches(key, want, ctx) {
  if (key === "onOneWord") return (ctx.onOneWord || []).includes(want);
  if (BOOLEAN_KEYS.has(key)) return Boolean(ctx[key]) === Boolean(want);
  return ctx[key] === want;
}

// The cell for a unit: among the table's cells for its trope, every one whose context keys all
// hold, the most specific wins (first in table order on a tie). A trope the table has no cell for
// (shalshelet etc., which never occur in a haftarah) gets the reciting tone, flagged as a fallback.
export function selectCell(unit, ctx, table) {
  const trope = (ctx && ctx.trope) || unitTrope(unit);
  let best = null, bestScore = -1;
  for (const cell of table.cells) {
    if (cell.trope !== trope) continue;
    let score = 0, ok = true;
    for (const [k, v] of Object.entries(cell.context || {})) {
      if (v === undefined || v === null) continue;
      if (!keyMatches(k, v, ctx || {})) { ok = false; break; }
      score += WEIGHT[k] || 1;
    }
    if (ok && score > bestScore) { best = cell; bestScore = score; }
  }
  if (best) return best;
  return { id: `fallback:${trope}`, trope, context: {}, upbeats: [], core: [{ deg: 1, dur: 0.5 }], source: "engine fallback: reciting tone", confidence: "none", fallback: true };
}

// The tonic syllable: the one the front end marked; failing that, the last (mil'ra is the default).
function tonicIndex(unit) {
  const syl = unit.syllables || [];
  const k = syl.findIndex(s => s.stress === "tonic");
  return k >= 0 ? k : Math.max(0, syl.length - 1);
}

const note = n => ({ deg: n.deg, dur: n.dur, ...(n.alt ? { alt: n.alt } : {}) });

// §2.2 rules 1-3 (rule 5, a missing conjunctive, needs nothing: its cell is simply never chosen).
// p pre-tonic syllables take the upbeats: none when p = 0 (rule 2), the last p when p <= upbeats,
// the first upbeat repeated in front when p is larger. The core is one melisma on the tonic; for
// q >= 1 post-tonic syllables (mil'el), the last core note moves to the first post-tonic syllable
// (rule 3) and is repeated on any further ones (q = 2, an enclitic after the stress, §4.1).
// Returns { syllables: [{ notes }], dropped } where dropped is the upbeat rule 2 removed, for elision.
export function fitSyllables(cell, unit) {
  const n = Math.max(1, (unit.syllables || []).length);
  const p = Math.min(tonicIndex(unit), n - 1);
  const q = n - 1 - p;
  const up = cell.upbeats || [];
  const core = cell.core || [];
  const out = Array.from({ length: n }, () => []);

  if (p > 0 && up.length) {
    const pre = p <= up.length ? up.slice(up.length - p) : [...Array(p - up.length).fill(up[0]), ...up];
    pre.forEach((u, k) => out[k].push(note(u)));
  } else if (p > 0) {
    // A cell with no upbeat (yetiv) on a word with pre-tonic syllables: recite them on the first core note.
    for (let k = 0; k < p; k++) out[k].push(note(core[0]));
  }

  if (q === 0 || core.length === 0) {
    core.forEach(c => out[p].push(note(c)));
  } else {
    const head = core.length > 1 ? core.slice(0, -1) : core;
    const last = core.at(-1);
    head.forEach(c => out[p].push(note(c)));
    for (let k = p + 1; k < n; k++) out[k].push(note(last));
  }

  const syllables = out.map(notes => ({ notes: notes.map((x, k) => ({ ...x, slur: k > 0 })) }));
  return { syllables, p, q, dropped: p === 0 && up.length ? note(up.at(-1)) : null };
}

// "D4", "F#3", "Bb4" -> MIDI number (C4 = 60).
export function keyToMidi(key) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(key || "D4").trim());
  if (!m) throw new Error(`bad key: ${key}`);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
}

// Diatonic degree -> semitones above the tonic, through the table's map, extended by octaves.
export function degreeSemitones(deg, table) {
  const map = (table && table.degrees && table.degrees.semitones) || { 1: 0, 2: 2, 3: 3, 4: 5, 5: 7, 6: 8, 7: 10 };
  if (map[deg] !== undefined) return map[deg];
  const step = deg - 1, oct = Math.floor(step / 7), base = ((step % 7) + 7) % 7 + 1;
  return oct * 12 + map[base];
}

// The table with some cells swapped for a named variant, e.g. { "silluq": "rosowsky" }:
// how the cantor's answer to a diagnostic question becomes the table he sings.
export function withVariants(table, picks) {
  return { ...table, cells: table.cells.map(c => {
    const v = picks && picks[c.id] && c.variants && c.variants[picks[c.id]];
    return v ? { ...c, upbeats: v.upbeats, core: v.core, variantOf: picks[c.id] } : c;
  }) };
}

const DISJUNCTIVE_END = new Set(["silluq"]);

// One verse -> score JSON. elision (§2.2 rule 4): when a disjunctive's upbeat is dropped because
// its word is stressed on syllable 1 and the previous unit is a conjunctive, that upbeat is sung
// as an extra last note on the previous word. Off by default; the cantor decides (§7 Q5).
export function scoreVerse(unitsJson, { table, key = "D4", tempo = 96, elision = false } = {}) {
  if (!table) throw new Error("scoreVerse needs a cell table");
  const tonic = keyToMidi(key);
  const units = unitsJson.units || [];
  const flags = readingFlags(unitsJson);
  const midi = n => tonic + degreeSemitones(n.deg, table) + (n.alt || 0);

  const scored = units.map((unit, i) => {
    const ctx = unitContext(units, i, flags);
    const cell = selectCell(unit, ctx, table);
    const fit = fitSyllables(cell, unit);
    return { unit, ctx, cell, fit };
  });

  if (elision) {
    for (let i = 1; i < scored.length; i++) {
      const cur = scored[i], prev = scored[i - 1];
      const prevConj = (prev.unit.accents || []).every(a => a.role !== "disjunctive");
      if (cur.fit.dropped && prevConj) {
        const last = prev.fit.syllables.at(-1);
        last.notes.push({ ...cur.fit.dropped, slur: last.notes.length > 0, elided: true });
      }
    }
  }

  // special: the verse's special melody, if any; specialCells: whether this table computed it. When
  // false the notes are the regular cells', and a renderer should play a recording instead.
  const out = {
    ref: unitsJson.ref || null, key, tempo, table: table.name || null,
    flags: { final: flags.final, endOfAliyah: flags.endOfAliyah, endOfBook: flags.endOfBook },
    special: flags.special,
    ...(flags.special ? { specialCells: table.cells.some(c => c.context && c.context.special === flags.special) } : {}),
    units: [], events: [],
  };
  let t = 0;
  scored.forEach(({ unit, ctx, cell, fit }, ui) => {
    const syllables = (unit.syllables && unit.syllables.length ? unit.syllables : [{ he: unit.text, ph: [], stress: "tonic" }]).map((s, si) => {
      const notes = fit.syllables[si].notes.map(n => ({ deg: n.deg, midi: midi(n), dur: n.dur, slur: n.slur, ...(n.elided ? { elided: true } : {}) }));
      notes.forEach((n, ni) => {
        out.events.push({ t, dur: n.dur, midi: n.midi, deg: n.deg, unit: ui, syllable: si, slur: n.slur, ...(ni === 0 ? { lyric: (s.ph || []).join(""), he: s.he } : {}) });
        t += n.dur;
      });
      return { he: s.he, ph: s.ph || [], stress: s.stress || null, notes };
    });
    // A breath after sof pasuk only; the other phrase ends are carried by their held notes.
    if (DISJUNCTIVE_END.has(ctx.trope)) t += 0.5;
    out.units.push({
      text: unit.text,
      cell: { id: cell.id, trope: cell.trope, context: cell.context, ...(cell.confidence ? { confidence: cell.confidence } : {}), ...(cell.fallback ? { fallback: true } : {}) },
      syllables,
    });
  });
  out.beats = t;
  out.seconds = Math.round(t * 60 / tempo * 1000) / 1000;
  return out;
}

// Degree as the report writes it: 0 -> 7_, -1 -> 6_.
export function degreeLabel(deg) {
  if (deg >= 1) return String(deg);
  return `${deg + 7}_`;
}
