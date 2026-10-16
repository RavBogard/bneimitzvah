// Copied from RavBogard/haftarah template/lib.js at 5b2530f72c544a9dab028d73076d47744b8252dc.
// Source lines 9-11 and 478-570; keep in parity with the source until its shared engine package exists.
// Dependency-free CommonJS; includes only the trope phrase functions and their constants.
"use strict";

// Any Tetragrammaton, with any pointing (including the Elohim pointing). The class holds combining
// marks only: maqaf U+05BE, paseq U+05C0, sof pasuq U+05C3, nun hafukha U+05C6 stay outside the match.
const TETRA = /י[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]*ה[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]*ו[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]*ה[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]*/g;


// ---- trope phrases (the chanter's copy) ----------------------------------------
// TropeTrainer's grouping: a block ends at every word carrying one of these accents; tipcha,
// pashta, yetiv and zarka (U+05AE and U+0598) fold into the block after them, and conjunctives
// never end one. Munach before a standalone paseq is legarmeh, a revia block.
const BLOCK_ENDING = {
  "֑": "etnachta", "֔": "zakef", "֕": "zakef-gadol", "֗": "revia",
  "֛": "tevir", "֒": "segol", "֓": "segol",
  "֜": "azla", "֝": "azla", "֞": "azla", "֩": "telisha-ketana",
  "֡": "pazer", "֠": "pazer", "֟": "pazer",
};
const TROPE_FAMILIES = [
  ["zakef", "zakef"], ["etnachta", "etnachta"], ["sof-pasuk", "sof pasuk"], ["revia", "revia"],
  ["tevir", "tevir"], ["segol", "segol"], ["azla", "kadma v’azla"], ["telisha-ketana", "telisha ketana"],
  ["pazer", "pazer"], ["zakef-gadol", "zakef gadol"], ["sof-haftarah", "end of the haftarah"],
];

// Words split on whitespace at nesting depth zero only: a tag is atomic, and an open element
// (Sefaria's ketiv/qere span) keeps its inner space, so it stays one word.
function tropeTokens(html) {
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

// Trope phrases for the chanter's copy: the verse HTML cut into blocks, each ending at a
// block-ending accent (TropeTrainer's grouping: tipcha, pashta, yetiv and zarka fold into the
// block after them). Returns [{ family, html }] in verse order, plus separators for letterless
// tokens as { family: null, html }. Joining every html with " " gives the input back up to
// whitespace: &thinsp;, &nbsp; and runs of whitespace come back as one space.
function tropePhrases(html, { final = false } = {}) {
  const words = tropeTokens(String(html == null ? "" : html)).map(t => {
    const text = t.replace(/<[^>]*>/g, "");
    return { html: t, text, letters: /[א-תיִ-ﭏ]/.test(text), paseq: text.trim() === "׀" };
  });
  let last = -1;
  words.forEach((w, k) => { if (w.letters) last = k; });
  const out = [];
  let open = [];   // pieces of the block in progress; a separator mid-block splits it in two
  let piece = [];
  const cut = () => { if (piece.length) { const p = { family: null, html: piece.join(" ") }; out.push(p); open.push(p); } piece = []; };
  const close = family => { cut(); for (const p of open) p.family = family; open = []; };
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (!w.letters && !w.paseq) { cut(); out.push({ family: null, html: w.html }); continue; }
    piece.push(w.html);
    if (!w.letters) continue;   // a paseq joins the block in progress
    let family = null;
    for (const ch of w.text) if (BLOCK_ENDING[ch]) { family = BLOCK_ENDING[ch]; break; }
    if (!family && w.text.includes("֣") && words[k + 1] && words[k + 1].paseq) family = "revia";
    if (k === last) family = final ? "sof-haftarah" : "sof-pasuk";
    if (!family) continue;
    while (words[k + 1] && words[k + 1].paseq) piece.push(words[++k].html);
    close(family);
  }
  // Only a verse with no letters at all (a lone paseq) gets here; its text still comes back.
  if (piece.length || open.length) close(final ? "sof-haftarah" : "sof-pasuk");
  return out;
}

// The verse HTML with each trope phrase in <span class="tr tr-<family>">; separators (a pisqa)
// stay bare. The spans are always there; trope.css colors them only under html[data-trope].
function tropeHtml(html, { final = false } = {}) {
  return tropePhrases(html, { final }).map(b => b.family ? `<span class="tr tr-${b.family}">${b.html}</span>` : b.html).join(" ");
}

// The families a haftarah's verses ([{ he }], in order) use, for the trope legend; the last verse
// is final. Raw he gives the families the rows show: divineName keeps every accent on יי, and a
// gloss key only appends a <sup> to a word, so neither moves a phrase boundary.
function tropeFamiliesUsed(verses) {
  const fams = new Set();
  (verses || []).forEach((v, i) => tropePhrases(String(v.he == null ? "" : v.he).replace(/&thinsp;|\u2009/g, " "), { final: i === verses.length - 1 }).forEach(b => { if (b.family) fams.add(b.family); }));
  return fams;
}


module.exports = { TETRA, TROPE_FAMILIES, tropePhrases, tropeHtml, tropeFamiliesUsed };
