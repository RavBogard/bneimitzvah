// The trope engine's text front end: one verse of Sefaria's MAM HTML -> accent units, syllables,
// stress, trope family and phonemes (hebrew-text-pipeline.md §6, stages 1-7). The object verseUnits()
// returns is the contract with trope/melody.mjs (§6.3); fields may be added, never renamed or dropped.
// Pure functions. Dependencies: the vendored havarotjs (syllables) and template/lib.js (trope phrases),
// so the chanter's copy and the sung motifs always agree on where a phrase ends.

import { createRequire } from "node:module";
import { Text } from "./vendor/havarotjs/index.js";

const require = createRequire(import.meta.url);
const lib = require("../template/lib.js");
const PRONUNCIATION = require("./pronunciation.json");

export const VERSION_TITLE = "Miqra according to the Masorah";

// ---- accents -----------------------------------------------------------------
// Codepoint -> [name, role, edge]. edge "post"/"pre" marks the accents MAM writes at the word edge and
// doubles on the stressed syllable when that is elsewhere (§3). U+0598 is MAM's zarka helper (Unicode
// calls it ZARQA; it is really tsinnorit) and U+05AE the zarka itself; both are "zarka" here.
const ACCENTS = {
  "֑": ["etnachta", "disjunctive"], "֒": ["segol", "disjunctive", "post"],
  "֓": ["shalshelet", "disjunctive"], "֔": ["zakef-katan", "disjunctive"],
  "֕": ["zakef-gadol", "disjunctive"], "֖": ["tipcha", "disjunctive"],
  "֗": ["revia", "disjunctive"], "֘": ["zarka", "disjunctive", "post"],
  "֙": ["pashta", "disjunctive", "post"], "֚": ["yetiv", "disjunctive", "pre"],
  "֛": ["tevir", "disjunctive"], "֜": ["geresh", "disjunctive"],
  "֝": ["geresh-muqdam", "disjunctive"], "֞": ["gershayim", "disjunctive"],
  "֟": ["karnei-para", "disjunctive"], "֠": ["telisha-gedola", "disjunctive", "pre"],
  "֡": ["pazer", "disjunctive"], "֢": ["atnach-hafukh", "conjunctive"],
  "֣": ["munach", "conjunctive"], "֤": ["mahpach", "conjunctive"],
  "֥": ["merkha", "conjunctive"], "֦": ["merkha-kefula", "conjunctive"],
  "֧": ["darga", "conjunctive"], "֨": ["kadma", "conjunctive"],
  "֩": ["telisha-ketana", "conjunctive", "post"], "֪": ["yerach-ben-yomo", "conjunctive"],
  "֫": ["ole", "disjunctive"], "֬": ["iluy", "conjunctive"],
  "֭": ["dehi", "disjunctive", "pre"], "֮": ["zarka", "disjunctive", "post"],
};
const cpHex = ch => ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

const LETTER = /[א-ת]/;
const LETTERS_G = /[א-ת]/g;
const MAQAF = "־", PASEQ = "׀", SOF_PASUQ = "׃", METEG = "ֽ", CGJ = "͏";
const FULL_VOWEL = /[ֱ-ׇֻ]/;   // hataf vowels through qubuts, plus qamats qatan

// ---- stage 0: Sefaria's raw text into sheet.json form ------------------------
// The same cleanup scripts/fetch.mjs applies (cleanHebrew there is not exported): a trailing {ס}/{פ}
// is the paragraph break after the verse, a mid-verse one is a pisqa. Idempotent on sheet.json text,
// so verseUnits() takes either a sheet verse or a fresh API response.
const BREAK_TRAIL_RE = /(?:&nbsp;|\s)*<span class="mam-spi-(samekh|pe)">\{[ספ]\}<\/span>(?:&nbsp;|\s|<br\s*\/?>)*$/;
const BREAK_MID_RE = /(?:&nbsp;|\s)*<span class="mam-spi-(samekh|pe)">\{[ספ]\}<\/span>(?:&nbsp;|\s|<br\s*\/?>)*/g;
function sheetForm(html) {
  let brk = null;
  let out = String(html == null ? "" : html).replace(/(?:&nbsp;|\s)+$/g, "").replace(/(<br\s*\/?>\s*)+$/g, "").trim();
  out = out.replace(BREAK_TRAIL_RE, (_, kind) => { brk = kind === "pe" ? "petuchah" : "setumah"; return ""; });
  out = out.replace(BREAK_MID_RE, ' <span class="pisqa"></span> ');
  out = out.replace(/<br\s*\/?>/g, " ").replace(/\s{2,}/g, " ").trim();
  return { html: out, break: brk };
}

// ---- stage 1: markup resolver --------------------------------------------------
// Tokens exactly as lib.js tropeTokens() cuts them (it is not exported): whitespace, &thinsp; and
// &nbsp; at tag depth zero split; an open element (the ketiv/qere span) keeps its inner space. Keeping
// the two tokenizers in step is what lets a unit find its trope phrase by token index.
function htmlTokens(html) {
  const tokens = [];
  let cur = "", depth = 0, i = 0;
  const flush = () => { if (cur) tokens.push(cur); cur = ""; };
  while (i < html.length) {
    if (html[i] === "<") {
      const close = html.indexOf(">", i);
      const tag = html.slice(i, close < 0 ? html.length : close + 1);
      if (tag[1] === "/") depth = Math.max(0, depth - 1);
      else if (!tag.endsWith("/>") && !/^<(br|img|wbr|hr)\b/i.test(tag)) depth++;
      cur += tag; i += tag.length;
      continue;
    }
    if (depth === 0) {
      const ent = /^&(thinsp|nbsp);/.exec(html.slice(i, i + 8));
      if (ent) { flush(); i += ent[0].length; continue; }
      if (/\s/.test(html[i])) { flush(); i++; continue; }
    }
    cur += html[i++];
  }
  flush();
  return tokens;
}
const hasLetters = tok => /[א-תיִ-ﭏ]/.test(tok.replace(/<[^>]*>/g, ""));   // lib.js's letters test

const ENTITIES = { nbsp: " ", thinsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
const decodeEntities = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m));

// One token's HTML -> the words it reads aloud. Footnotes go; the ketiv (written, not read) goes with
// the space that separated it from its qere; qere and trivial-qere spans are unwrapped and their
// brackets dropped; an implicit maqaf becomes a maqaf.
function readToken(tok) {
  let s = tok
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>\s*<i class="footnote">(?:<i>[\s\S]*?<\/i>|(?!<\/i>)[\s\S])*?<\/i>/g, "")
    .replace(/<i class="footnote">(?:<i>[\s\S]*?<\/i>|(?!<\/i>)[\s\S])*?<\/i>/g, "")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/g, "")
    .replace(/\s*<span class="mam-kq-k">[\s\S]*?<\/span>\s*/g, "")
    .replace(/<span class="mam-implicit-maqaf">[\s\S]*?<\/span>/g, MAQAF)
    .replace(/<span class="mam-spi-invnun">[\s\S]*?<\/span>/g, "")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]*>/g, "");
  s = decodeEntities(s).replace(/[[\]]/g, "").normalize("NFD");
  return s.split(/\s+/).filter(Boolean);
}

// Stage 1 (§6.2): the verse HTML -> what is read, in order. items are words, paseq marks
// (kind "legarmeh" or "paseq") and pisqa breaks; text is the words and paseq marks joined by single
// spaces (pisqa is markup, not text), NFD. Each item keeps the index of the lib.js token it came from.
export function resolveMarkup(html) {
  const pre = sheetForm(html);
  const tokens = htmlTokens(pre.html);
  const items = [];
  tokens.forEach((tok, token) => {
    if (/^<span class="pisqa"><\/span>$/.test(tok)) { items.push({ type: "pisqa", token }); return; }
    const mark = /<b>\s*׀\s*<\/b>/.test(tok) ? "b" : /<small>\s*׀\s*<\/small>/.test(tok) ? "small" : null;
    for (const w of readToken(tok)) {
      // A paseq glued to a word (no space) is still a paseq after that word.
      const parts = w.split(new RegExp(`(${PASEQ})`)).filter(Boolean);
      for (const p of parts) {
        if (p === PASEQ) items.push({ type: "paseq", mark, token });
        else if (LETTER.test(p)) items.push({ type: "word", text: p, token });
        else if (items.length && items[items.length - 1].type === "word") items[items.length - 1].text += p;   // stray ׃ or maqaf
      }
    }
  });
  // Legarmeh vs paseq (§1.3): MAM bolds the legarmeh stroke and sets a plain paseq small. A bold
  // stroke after shalshelet (Amos 1:2) is the paseq that always follows it, not legarmeh, so the word
  // before must carry munach and no disjunctive. An unmarked stroke falls back to lib.js's rule.
  items.forEach((it, k) => {
    if (it.type !== "paseq") return;
    const prev = items[k - 1];
    const munach = prev && prev.type === "word" && prev.text.includes("֣") &&
      ![...prev.text].some(ch => ACCENTS[ch] && ACCENTS[ch][1] === "disjunctive");
    it.kind = it.mark !== "small" && munach ? "legarmeh" : "paseq";
  });
  const text = items.filter(it => it.type !== "pisqa").map(it => it.type === "word" ? it.text : PASEQ).join(" ");
  return { text, items, html: pre.html, break: pre.break, tokens };
}

// ---- stages 2-3: divine name and special lexemes ---------------------------------
const TETRA_ONE = new RegExp(lib.TETRA.source);   // lib.js's pattern, without the g flag
const isAccent = ch => !!ACCENTS[ch];

// The Name is read Adonai, or Elohim when pointed with Elohim's vowels (§1.5). The substitute takes the
// Name's accents on its last syllable (where the stress is), a conjunctive before a disjunctive on its
// first, and every meteg/silluq on the last. After a prefix that took the Name's first vowel (לַיהוָה),
// the alef is quiescent: la-do-NAI.
function divineReading(word, profile) {
  const m = TETRA_ONE.exec(word);
  if (!m) return null;
  const name = m[0];
  const vowels = name.match(/[ְ-ׇֻ]/g) || [];
  const elohim = vowels[0] === "ֱ" || vowels[vowels.length - 1] === "ִ";
  const accents = [...name].filter(isAccent);
  const distinct = [...new Set(accents)];
  const lead = distinct.length > 1 ? distinct[0] : "";
  const tail = (lead ? accents.filter(a => a !== lead) : accents).join("") + [...name].filter(ch => ch === METEG).join("");
  const rules = profile.rules.divineName || {};
  const base = [...String(elohim ? rules.elohim || "אֱלֹהִים" : rules.adonai || "אֲדֹנָי").normalize("NFD")];
  const letterIdx = base.map((ch, i) => LETTER.test(ch) ? i : -1).filter(i => i >= 0);
  // The stressed syllable is the last one with a full vowel (נָי, הִים): its consonant gets the accents.
  let tonicLetter = letterIdx[0];
  for (const i of letterIdx) { const next = base[i + 1]; if (next && FULL_VOWEL.test(next)) tonicLetter = i; }
  const prefix = word.slice(0, m.index), suffix = word.slice(m.index + name.length);
  const yodVowel = /^י[֑-ּֽֿׅ֯ׄ]*[ְ-ׇֻ]/.test(name);
  const out = base.map((ch, i) => i === tonicLetter ? ch + tail : ch);
  if (lead) out[letterIdx[0]] += lead;   // marks sort into place under NFD
  if (prefix && !yodVowel) out.splice(1, 1);   // prefix took the vowel: drop the alef's hataf
  return { read: (prefix + out.join("") + suffix).normalize("NFD"), name: elohim ? "elohim" : "adonai" };
}

// Jerusalem is a qere perpetuum: written ירושלם, read yerushalayim. MAM puts the hiriq under the lamed
// (no yod to carry it), pinned after a CGJ: לַ֙͏ִם֙. Read it with the yod back in, accents in place, so
// havarotjs sees ye-ru-sha-la-yim and the doubled pashta lands on la.
const JERUSALEM = /ל([֑-ׇ͏]+)ם/;
function jerusalemReading(word) {
  if (!/ירושלם$/.test(word.replace(/[^א-ת]/g, ""))) return null;
  const m = JERUSALEM.exec(word);
  if (!m || !m[1].includes("ִ") || !/[ַָ]/.test(m[1])) return null;
  const marks = [...m[1]].filter(ch => ch !== "ִ" && ch !== CGJ).join("");
  return { read: word.replace(JERUSALEM, `ל${marks}יִם`).normalize("NFD"), lexeme: "jerusalem" };
}

// The written word -> the word to syllabify. Further hand-fixed lexemes go here as fixtures find them.
function readingForm(word, profile) {
  return divineReading(word, profile) || jerusalemReading(word) || { read: word };
}

// The written word cut into letter groups (a letter and the marks after it) so each syllable can
// point back at its exact stretch of the verse. Maqaf, sof pasuq and paseq belong to no syllable (§6.3
// writes מֶר, not מֶר־), so they are left out. In Jerusalem the CGJ + hiriq is its own group: it
// stands for the yod the reading adds.
function letterGroups(word, lexeme) {
  const groups = [];
  for (const ch of word) {
    if (ch === MAQAF || ch === SOF_PASUQ || ch === PASEQ) continue;
    const split = LETTER.test(ch) || (lexeme === "jerusalem" && ch === CGJ);
    if (split || !groups.length) groups.push(ch); else groups[groups.length - 1] += ch;
  }
  if (lexeme === "jerusalem" && !word.includes(CGJ)) {
    // No CGJ: split the lamed's group before its hiriq instead.
    const k = groups.findIndex((g, i) => g[0] === "ל" && g.includes("ִ") && groups[i + 1] && groups[i + 1][0] === "ם");
    if (k >= 0) { const at = groups[k].indexOf("ִ"); groups.splice(k, 1, groups[k].slice(0, at), groups[k].slice(at)); }
  }
  return groups;
}

// ---- stage 7 helpers: phonemes -----------------------------------------------------
function loadProfile(p) {
  if (p && typeof p === "object") return p;
  const name = p || PRONUNCIATION.default;
  const prof = PRONUNCIATION.profiles[name];
  if (!prof) throw new Error(`trope/text: unknown pronunciation profile "${name}"`);
  return prof;
}

const letterOf = c => (c.text.match(LETTER) || [""])[0];
const isLetterCluster = c => LETTER.test(c.text);

// One cluster's consonant sound. Silent letters give "": quiescent alef, mater he/vav/yod, the yod of ־ָיו.
function consonant(c, { vowel, next, lastInWord, prevVowel, holamBefore }, profile) {
  const L = letterOf(c), t = c.text, rules = profile.rules;
  const dagesh = t.includes("ּ"), sheva = c.hasSheva;
  if (L === "א") return vowel ? rules.alefOnset || "" : "";
  if (L === "ע") return rules.ayin || "";
  if (L === "ה") return vowel || sheva || dagesh ? "h" : "";   // dagesh in final he is mappiq
  if (L === "ו") {
    if (vowel || sheva || dagesh) return "v";
    return c.isMater || holamBefore ? "" : "v";   // holam male (also מֹאול); else ־ָו, ־ָיו: a consonant
  }
  if (L === "י") {
    if (vowel || sheva || dagesh) return "j";
    if (c.isMater) return rules.tsereYod === "ej" && (prevVowel === "TSERE" || prevVowel === "SEGOL") ? "j" : "";
    if (next && letterOf(next) === "ו" && lastInWord && !next.vowelNames.length && !next.hasSheva && !next.text.includes("ּ")) return "";   // ־ָיו = av
    return "j";
  }
  if (L === "ש") return t.includes("ׂ") ? profile.consonants["שׂ"] : profile.consonants["שׁ"];
  const e = profile.consonants[L];
  if (e == null) return undefined;   // the invariant tests catch this
  return typeof e === "string" ? e : (dagesh && !t.includes("ֿ") ? e.dagesh : e.plain);
}

const A_VOWELS = new Set(["PATAH", "QAMATS", "HATAF_PATAH"]);

// A havarotjs syllable -> phonemes. gem is the doubled consonant a dagesh forte in the next syllable
// adds as this syllable's coda (§2.1); furtive marks a furtive patach (vowel before its consonant).
function syllablePhonemes(syl, { next, prevVowel, last }, profile) {
  const vowelName = syl.vowelNames[0] || null;
  const vocal = vowelName === "SHEVA";
  const clusters = syl.clusters.filter(isLetterCluster);
  const ph = [];
  let furtive = false, shevaUsed = false;
  clusters.forEach((c, ci) => {
    let vowel = null;
    if (c.isShureq) vowel = "SHUREQ";
    else if (c.vowelNames.length) vowel = c.vowelNames[0];
    else if (vocal && c.hasSheva && !shevaUsed) { vowel = "SHEVA"; shevaUsed = true; }
    const v = vowel ? profile.vowels[vowel] : null;
    const lastInWord = last && ci === clusters.length - 1;
    const L = letterOf(c);
    const cons = c.isShureq && !c.vowelNames.length ? "" :
      consonant(c, { vowel: vowel || (clusters[ci + 1] && clusters[ci + 1].isShureq ? "SHUREQ" : null), next: clusters[ci + 1], lastInWord: last && ci + 1 === clusters.length - 1, prevVowel,
        holamBefore: clusters.slice(0, ci).some(x => x.vowelNames.includes("HOLAM")) }, profile);
    const isFurtive = lastInWord && vowel === "PATAH" && (L === "ח" || L === "ע" || (L === "ה" && c.text.includes("ּ"))) &&
      prevVowel && !A_VOWELS.has(prevVowel) && ci === 0 && profile.rules.furtive !== "after";
    if (isFurtive) { furtive = true; ph.push(v, cons); }
    else ph.push(cons, v);
  });
  let gem = null;
  if (next && syl.geminates) {
    const nc = next.clusters.find(isLetterCluster);
    if (nc) gem = consonant(nc, { vowel: "X", next: null, lastInWord: false, prevVowel: null }, profile) || null;
  }
  if (gem && profile.rules.geminate !== "single") ph.push(gem);
  const out = ph.filter(x => x !== "" && x !== null);
  const vi = out.findIndex(x => profile.symbols[x] && profile.symbols[x].type === "vowel");
  const closed = !!gem || (vi >= 0 && out.slice(vi + 1).some(x => profile.symbols[x] && profile.symbols[x].type !== "vowel"));
  return { ph: out, gem, furtive, closed, vowel: vowelName, vocal };
}

// ---- stages 4-5: syllabify a maqaf chain, then place the stress ---------------------
// Two repairs on havarotjs' syllables, as plain objects (text, clusters, vowelNames, coda, geminates). (1) A syllable with no vowel at all joins the one before as its coda: havarotjs
// makes one of a quiescent alef and a following sheva (צֵא|תְ in בְּצֵאתְךָ, יֹּ|אמְ in וַיֹּאמְרוּ), and
// those shevas are silent in the common reading (be-tzet-CHA, va-yom-RU). (2) rules.qamatsYodSheva
// "nach": a yod with sheva after an open qamats syllable closes it (לַ֫יְלָה-type הַלָּ֑יְלָה = ha-LAY-la),
// where havarotjs' longVowels rule would make the sheva vocal; a meteg on the qamats keeps it vocal.
function mergeSyllables(syls, profile) {
  // geminates: the next syllable's dagesh forte doubles its consonant into this syllable's coda.
  const plain = syls.map(s => ({ text: s.text, clusters: s.clusters, vowelNames: s.vowelNames, coda: s.coda, geminates: s.codaWithGemination !== s.coda }));
  const out = [];
  for (const s of plain) {
    const prev = out[out.length - 1];
    const letters = s.clusters.filter(isLetterCluster);
    const vowelless = !s.vowelNames.length;
    const qys = profile.rules.qamatsYodSheva !== "na" && prev && s.vowelNames.length === 1 && s.vowelNames[0] === "SHEVA" &&
      letters.length === 1 && letterOf(letters[0]) === "י" && prev.vowelNames[0] === "QAMATS" &&
      !prev.coda && !prev.geminates && !prev.text.includes(METEG);
    if (prev && (vowelless || qys)) {
      out[out.length - 1] = { text: prev.text + s.text, clusters: [...prev.clusters, ...s.clusters], vowelNames: prev.vowelNames,
        coda: prev.coda + s.text, geminates: s.geminates };
    } else out.push(s);
  }
  return out;
}

function havarotOptions(profile) {
  const { about, ...opts } = profile.syllabifier || {};
  return opts;
}

// Accent events on one word: each accent once, a MAM doubled copy folded into the copy that marks the
// stress (§3: the earlier copy for a postpositive, the later for a prepositive; zarka's helper U+0598).
function wordEvents(syls) {
  const occ = [];
  syls.forEach((s, si) => s.taamim.forEach(ch => { const a = ACCENTS[ch]; occ.push({ ch, name: a[0], role: a[1], edge: a[2] || null, si }); }));
  const groups = new Map();
  occ.forEach((o, k) => { if (!groups.has(o.name)) groups.set(o.name, { first: k, list: [] }); groups.get(o.name).list.push(o); });
  return [...groups.values()].sort((a, b) => a.first - b.first).map(({ list }) => {
    const pick = list.length > 1 && list[0].edge === "pre" ? list[list.length - 1] : list[0];
    const shown = list.find(o => o.ch !== "֘") || list[0];
    return { name: pick.name, cp: cpHex(shown.ch), role: pick.role, si: pick.si };
  });
}

// One unit (a maqaf chain) -> syllables with stress, and its accents.
function unitSyllables(words, { last, legarmeh, profile, warnings }) {
  const readings = words.map(w => ({ orig: w, ...readingForm(w, profile) }));
  const chain = readings.map(r => r.read).join("").replace(new RegExp(`[${SOF_PASUQ}${PASEQ}]`, "g"), "");
  const opts = havarotOptions(profile);
  let hw;
  try { hw = new Text(chain, opts).words; }
  catch (e) { throw new Error(`trope/text: havarotjs failed on "${chain}": ${e.message}`); }
  if (opts.strict === false) {
    try { new Text(chain, { ...opts, strict: true }).words.forEach(w => w.syllables); }
    catch (e) { warnings.push(`strict havarotjs rejects "${chain}": ${e.message}`); }
  }
  if (hw.length !== readings.length) {
    // havarotjs sometimes keeps two maqaf-joined words together (וְאֶת־כׇּל־ in II Sam 6:12); then
    // syllabify word by word. Construct-state cues are lost, which only matters for its qamats-qatan
    // guess, and that is off (MAM marks qamats qatan).
    hw = readings.flatMap(r => new Text(r.read.replace(new RegExp(`[${SOF_PASUQ}${PASEQ}]`, "g"), ""), opts).words);
    if (hw.length !== readings.length) throw new Error(`trope/text: havarotjs split "${chain}" into ${hw.length} words, expected ${readings.length}`);
  }

  const syllables = [];
  const perWord = [];
  hw.forEach((w, wi) => {
    const r = readings[wi];
    const groups = letterGroups(r.orig, r.lexeme);
    const sylls = mergeSyllables(w.syllables, profile);
    let g = 0;
    const recs = sylls.map((syl, si) => {
      const n = (syl.text.match(LETTERS_G) || []).length;
      const take = si === sylls.length - 1 ? groups.length - g : n;
      const he = groups.slice(g, g + take).join("");
      g += take;
      const prevVowel = si > 0 ? sylls[si - 1].vowelNames[0] || null : null;
      const p = syllablePhonemes(syl, { next: sylls[si + 1] || null, prevVowel, last: si === sylls.length - 1 }, profile);
      const rec = {
        he, ph: p.ph, stress: null, accent: null, closed: p.closed,
        sheva: p.vocal ? "na" : syl.clusters.some(c => c.hasSheva) ? "nach" : null,
        vowel: p.vowel, word: wi,
      };
      if (r.read !== r.orig) rec.read = syl.text.replace(new RegExp(`[${MAQAF}${SOF_PASUQ}]`, "g"), "");
      if (p.gem) rec.gem = p.gem;
      if (p.furtive) rec.furtive = true;
      rec._taamim = [...syl.text].filter(isAccent);
      rec._meteg = syl.text.includes(METEG);
      return rec;
    });
    perWord.push({ recs, reading: r, offset: syllables.length });
    syllables.push(...recs);
  });

  // Stress (§3). The tonic is the main accent of the last accented word: its disjunctive, else its
  // conjunctive. The verse's last word takes silluq (its last meteg). Every other accent, and every
  // other meteg, is secondary. A furtive patach never takes the stress.
  const events = perWord.flatMap(({ recs, offset }, wi) =>
    wordEvents(recs.map(r => ({ taamim: r._taamim }))).map(e => ({ ...e, gi: offset + e.si, wi })));
  let main = null;
  const lastWord = perWord[perWord.length - 1];
  const lastMeteg = lastWord.recs.map((r, i) => r._meteg ? i : -1).filter(i => i >= 0).pop();
  if (last && lastMeteg != null && !events.some(e => e.wi === perWord.length - 1)) {
    main = { name: "silluq", cp: "05BD", role: "disjunctive", gi: lastWord.offset + lastMeteg, wi: perWord.length - 1 };
    events.push(main);
  } else if (events.length) {
    const wi = events[events.length - 1].wi;
    const own = events.filter(e => e.wi === wi);
    main = own.filter(e => e.role === "disjunctive").pop() || own[own.length - 1];
  }
  if (main && legarmeh && main.name === "munach") { main.name = "legarmeh"; main.role = "disjunctive"; }
  let tonic = main ? main.gi : -1;
  if (tonic > 0 && syllables[tonic].furtive && syllables[tonic - 1].word === syllables[tonic].word) tonic--;
  for (const e of events) {
    if (e === main) continue;
    const s = syllables[e.gi];
    if (e.gi !== tonic && !s.stress) { s.stress = "secondary"; s.accent = e.name; }
  }
  syllables.forEach((s, i) => {
    if (i === tonic) { s.stress = "tonic"; s.accent = main.name; }
    else if (s._meteg && !s.stress && !(main && main.name === "silluq" && i === main.gi)) { s.stress = "secondary"; s.meteg = true; }
    delete s._taamim; delete s._meteg;
  });
  const accents = events.map(e => ({ name: e.name, cp: e.cp, role: e.role }));
  const name = readings.find(r => r.name);
  return { syllables, accents, main, name: name ? name.name : null };
}

// ---- the verse ----------------------------------------------------------------------
// Stage 6: trope families from lib.js tropePhrases(), fed exactly what tropeFamiliesUsed() feeds it,
// so the engine's families equal the chanter's copy's by construction. Returns, per letter-bearing
// token, { family, phrase } (phrase = index among the verse's phrases).
function tokenPhrases(html, final) {
  const fed = html.replace(/&thinsp;| /g, " ");
  const out = [];
  let phrase = 0;
  for (const p of lib.tropePhrases(fed, { final })) {
    if (!p.family) continue;
    const toks = htmlTokens(p.html).filter(hasLetters);
    if (!toks.length) continue;
    toks.forEach(() => out.push({ family: p.family, phrase }));
    phrase++;
  }
  return out;
}

// Stages 1-7 for one verse: the §6.3 object. html is a sheet.json verses[].he or a raw Sefaria v3
// string; final marks the haftarah's last verse (sof-haftarah); pronunciation is a profile name from
// pronunciation.json or a profile object.
export function verseUnits(html, { final = false, pronunciation, ref = null } = {}) {
  const profile = loadProfile(pronunciation);
  const r = resolveMarkup(html);
  const warnings = [];

  // Letter-bearing tokens in order: the index that ties a unit to its lib.js phrase.
  const letterIndex = new Map();
  r.tokens.forEach((t, k) => { if (hasLetters(t)) letterIndex.set(k, letterIndex.size); });
  const phrases = tokenPhrases(r.html, final);
  if (phrases.length !== letterIndex.size) warnings.push(`phrase tokens ${phrases.length} != verse tokens ${letterIndex.size}`);

  // Units: one per maqaf chain. A word ending in maqaf joins the next word.
  const units = [];
  let offset = 0, open = null;
  r.items.forEach(it => {
    if (it.type === "pisqa") { if (units.length) units[units.length - 1].pisqa = true; return; }
    const start = offset;
    offset += (it.type === "word" ? it.text.length : 1) + 1;
    if (it.type === "paseq") {
      const u = units[units.length - 1];
      if (u) { if (it.kind === "legarmeh") u.legarmeh = true; else u.paseq = true; }
      return;
    }
    if (open) { open.words.push(it.text); open.range[1] = start + it.text.length; open.token = it.token; }
    else { open = { words: [it.text], range: [start, start + it.text.length], token: it.token, legarmeh: false, paseq: false, pisqa: false }; units.push(open); }
    if (!it.text.endsWith(MAQAF)) open = null;
  });
  // A maqaf-joined pair is written without a space; keep the text as one stretch.
  units.forEach(u => { u.text = r.text.slice(u.range[0], u.range[1]); u.words = u.text.match(new RegExp(`[^${MAQAF}]+${MAQAF}?|${MAQAF}`, "g")); });

  const phraseSize = new Map();
  units.forEach(u => {
    const k = letterIndex.get(u.token);
    u._ph = phrases[k] || { family: null, phrase: null };
    phraseSize.set(u._ph.phrase, (phraseSize.get(u._ph.phrase) || 0) + 1);
  });
  const seen = new Map();
  const out = units.map((u, i) => {
    const { syllables, accents, main, name } = unitSyllables(u.words, { last: i === units.length - 1, legarmeh: u.legarmeh, profile, warnings });
    const pos = seen.get(u._ph.phrase) || 0;
    seen.set(u._ph.phrase, pos + 1);
    const unit = {
      text: u.text, words: u.words, range: u.range, accents,
      trope: { family: u._ph.family, phrase: u._ph.phrase, pos, of: phraseSize.get(u._ph.phrase), accent: main ? main.name : null },
      syllables,
      legarmeh: u.legarmeh, paseq: u.paseq, pisqa: u.pisqa,
    };
    if (name) unit.name = name;
    return unit;
  });
  const obj = {
    ref, version: VERSION_TITLE, pronunciation: profile.name || null, final: !!final,
    he: r.text, break: r.break, units: out, ipa: "", warnings,
  };
  obj.ipa = verseIpa(obj, profile);
  return obj;
}

// ---- renderings -----------------------------------------------------------------------
// IPA: syllables joined by ".", ˈ before the tonic, maqaf-joined words by "-", units by spaces.
export function verseIpa(obj, pronunciation) {
  const profile = loadProfile(pronunciation || obj.pronunciation);
  const sym = x => (profile.symbols[x] || {}).ipa ?? "?";
  return obj.units.map(u => {
    const words = [];
    u.syllables.forEach(s => {
      (words[s.word] = words[s.word] || []).push((s.stress === "tonic" ? "ˈ" : "") + s.ph.map(sym).join(""));
    });
    return words.map(w => w.join(".")).join("-");
  }).join(" ");
}

// The gold-set notation of §6.5: va-YO-mer LO ye-ho-na-TAN ma-CHAR CHO-desh. Words (maqaf-joined ones
// too) are separated by spaces, syllables by hyphens, the tonic in capitals. A doubled consonant is
// written once (yi-pa-KED), as people write it by hand. With lexical (the default), a maqaf-joined
// word that has no accent of its own gets its dictionary stress, as a human transcriber would mark it:
// mil'el for a final closed segol after a full vowel (va-YO-mer), else the last syllable;
// monosyllables stay lower case. That is a heuristic for notation only; the stress field never uses it.
export function verseToSyllableString(obj, { lexical = true, pronunciation } = {}) {
  const profile = loadProfile(pronunciation || obj.pronunciation);
  const roman = s => {
    const ph = s.gem && s.ph[s.ph.length - 1] === s.gem ? s.ph.slice(0, -1) : s.ph;
    return ph.map(x => (profile.symbols[x] || {}).roman ?? x).join("");
  };
  const out = [];
  for (const u of obj.units) {
    const words = [];
    u.syllables.forEach(s => (words[s.word] = words[s.word] || []).push(s));
    words.forEach((syls, wi) => {
      let k = syls.findIndex(s => s.stress === "tonic");
      if (k < 0 && lexical && wi < words.length - 1 && syls.length > 1) k = lexicalStress(syls);
      out.push(syls.map((s, i) => i === k ? roman(s).toUpperCase() : roman(s)).join("-"));
    });
  }
  return out.join(" ");
}

function lexicalStress(syls) {
  const n = syls.length, last = syls[n - 1], pen = syls[n - 2];
  if (last.furtive) return n - 2;
  if (last.vowel === "SEGOL" && last.closed && pen.vowel && pen.vowel !== "SHEVA" && !/^HATAF/.test(pen.vowel)) return n - 2;
  return n - 1;
}

export { loadProfile as pronunciationProfile, ACCENTS };
