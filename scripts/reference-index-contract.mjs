// Reference-audio ingestion contract: validates a private PocketTorah verse index
// (pockettorah-verse-index/v1), maps its aligned words onto the portal's own reading words, and builds
// the small client-safe verse DTO a reviewed player adapter may serve. Pure functions, no I/O, no
// dependencies. The index's Hebrew is alignment evidence only; the portal's licensed study text stays
// the authority for what a word is. See docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md.

export const INDEX_SCHEMA = "pockettorah-verse-index/v1";
export const DTO_SCHEMA = "reference-verse/v1";

/** Seconds. Every bound is checked inclusively with EPSILON; anything outside is rejected, never clamped. */
export const TOLERANCES = Object.freeze({
  EPSILON: 0.0015,            // index times are rounded to 1 ms
  MIN_VERSE_SECONDS: 0.5,     // shorter cuts are not a verse
  MAX_VERSE_SECONDS: 180,
  MAX_RECORDING_SECONDS: 4 * 3600,
  MAX_WORDS_PER_VERSE: 512,   // the portal's own projection limit
  MAX_RECORDINGS: 5000,
  MAX_VERSES_PER_RECORDING: 400,
});

/** The only review states the index may declare, and what each means for playback. */
export const REVIEW_STATES = Object.freeze({
  "start moved earlier to pitched sound before the aligned first word": "start-moved",
});

/** Recordings known to be missing from the source; anything else missing is a gap to report, never to fill. */
export const KNOWN_GAPS = Object.freeze({
  "Haazinu-1": "no PocketTorah recording",
  "torah-1..torah-12": "short trope-example files, not readings; excluded",
  holidays: "festival, special-Shabbat and megillah readings are not in the source",
});

export const ATTRIBUTION = Object.freeze({
  title: "PocketTorah Audio Files",
  creator: "not-a-box media lab",
  license: "CC BY-SA 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  changes: "Cut into single verses with computed word timings.",
});

export const BOOKS = Object.freeze(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges",
  "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel", "Hosea", "Joel", "Amos", "Obadiah",
  "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Psalms", "Proverbs", "Job",
  "Song of Songs", "Ruth", "Lamentations", "Ecclesiastes", "Esther", "Daniel", "Ezra", "Nehemiah", "I Chronicles", "II Chronicles"]);
const BOOK_RE = BOOKS.map(b => b.replace(/ /g, " ")).join("|");
const VERSE_REF = new RegExp(`^(${BOOK_RE}) ([1-9]\\d{0,2}):([1-9]\\d{0,2})$`);
const SPAN = `([1-9]\\d{0,2}):([1-9]\\d{0,2})-([1-9]\\d{0,2}):([1-9]\\d{0,2})`;
const RANGE_PART = new RegExp(`^(${BOOK_RE}) ${SPAN}$`);
const KEY = /^[A-Za-z]{2,40}-(?:[1-7]|h)$/;
const ARCHIVE_FILE = /^[A-Za-z0-9_-]{1,80}\.mp3$/;
const ASSET_ID = /^ra_[a-z0-9]{16,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const HEBREW_LETTER = /[א-ת]/u;
const BAD_TEXT = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩﻿\s]/u;

const RECORDING_FIELDS = new Set(["key", "parsha", "part", "table", "ref", "archiveFile", "seconds", "wordLabelsMatched", "verses"]);
const VERSE_FIELDS = new Set(["ref", "start", "end", "words", "alignScore", "startVsSoundOnsetMs", "labelGapMedianMs", "review"]);
const WORD_FIELDS = new Set(["he", "start", "label"]);
const TOP_FIELDS = new Set(["schema", "source", "method", "recordings"]);

const finite = x => typeof x === "number" && Number.isFinite(x);
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);

/** "Isaiah 40:1" -> {book, chapter, verse}, or null for anything not canonical. */
export function parseVerseRef(ref) {
  const m = typeof ref === "string" ? VERSE_REF.exec(ref) : null;
  return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null;
}
/** "Jeremiah 2:4-2:28; Jeremiah 3:4-3:4" -> parts, or null. */
export function parseRangeRef(ref) {
  if (typeof ref !== "string" || ref.length > 200) return null;
  const parts = ref.split("; ").map(p => RANGE_PART.exec(p));
  if (parts.some(p => !p)) return null;
  const out = parts.map(m => ({ book: m[1], from: [Number(m[2]), Number(m[3])], to: [Number(m[4]), Number(m[5])] }));
  return out.every(p => cmp(p.from, p.to) <= 0) ? out : null;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];

/**
 * Validate a parsed index. Returns {ok, errors, warnings, recordings} where errors are {code, at} with
 * `at` a structural location only (recording key / verse ref / word number), never text or paths.
 * Nothing is repaired: a recording with any error is excluded whole, so a player never guesses.
 */
export function validateIndex(index) {
  const errors = [], warnings = [], valid = new Map();
  const fail = (code, at) => { errors.push({ code, at }); return false; };
  if (!isObject(index)) return { ok: false, errors: [{ code: "not-an-object", at: "index" }], warnings, recordings: valid };
  for (const k of Object.keys(index)) if (!TOP_FIELDS.has(k)) fail("unknown-field", `index.${safeKey(k)}`);
  if (index.schema !== INDEX_SCHEMA) fail("schema", "index.schema");
  if (!Array.isArray(index.recordings) || index.recordings.length === 0 || index.recordings.length > TOLERANCES.MAX_RECORDINGS) {
    fail("recordings", "index.recordings");
    return { ok: false, errors, warnings, recordings: valid };
  }
  const seenKeys = new Set(), seenFiles = new Set();
  index.recordings.forEach((r, n) => {
    const before = errors.length;
    const at = isObject(r) && typeof r.key === "string" && KEY.test(r.key) ? r.key : `recording#${n}`;
    if (!isObject(r)) return fail("recording-not-object", at);
    for (const k of Object.keys(r)) if (!RECORDING_FIELDS.has(k)) fail("unknown-field", `${at}.${safeKey(k)}`);
    if (typeof r.key !== "string" || !KEY.test(r.key)) fail("recording-key", at);
    else if (seenKeys.has(r.key)) fail("duplicate-recording-key", at);
    if (typeof r.archiveFile !== "string" || !ARCHIVE_FILE.test(r.archiveFile)) fail("archive-file", at);
    else if (seenFiles.has(r.archiveFile.toLowerCase())) fail("duplicate-archive-file", at);
    if (typeof r.parsha !== "string" || !r.parsha) fail("parsha", at);
    if (!(r.part === "h" || /^[1-7]$/.test(String(r.part)))) fail("part", at);
    if (typeof r.key === "string" && r.key.slice(r.key.lastIndexOf("-") + 1) !== String(r.part)) fail("key-part-mismatch", at);
    if (!(r.table === "torah" && r.part !== "h" || r.table === "haftarah" && r.part === "h")) fail("table", at);
    if (!finite(r.seconds) || r.seconds <= 0 || r.seconds > TOLERANCES.MAX_RECORDING_SECONDS) fail("recording-seconds", at);
    if (typeof r.wordLabelsMatched !== "boolean") fail("labels-matched-flag", at);
    const range = parseRangeRef(r.ref);
    if (!range) fail("recording-ref", at);
    if (!Array.isArray(r.verses) || !r.verses.length || r.verses.length > TOLERANCES.MAX_VERSES_PER_RECORDING) { fail("verses", at); return; }
    const seenRefs = new Set();
    let prev = null;
    r.verses.forEach((v, i) => {
      const vat = `${at}/${isObject(v) && parseVerseRef(v.ref) ? v.ref : `verse#${i}`}`;
      if (!isObject(v)) return fail("verse-not-object", vat);
      for (const k of Object.keys(v)) if (!VERSE_FIELDS.has(k)) fail("unknown-field", `${vat}.${safeKey(k)}`);
      const p = parseVerseRef(v.ref);
      if (!p) return fail("verse-ref", vat);
      if (seenRefs.has(v.ref)) fail("duplicate-verse-ref", vat);
      seenRefs.add(v.ref);
      if (range && !range.some(part => part.book === p.book && cmp(part.from, [p.chapter, p.verse]) <= 0 && cmp([p.chapter, p.verse], part.to) <= 0)) fail("verse-outside-recording-ref", vat);
      // Consecutive verses, a new chapter's first verse, or the first verse of a later part of a split range.
      const partStart = range && range.some(part => part.book === p.book && part.from[0] === p.chapter && part.from[1] === p.verse);
      if (prev && !(prev.book === p.book && (p.chapter === prev.chapter && p.verse === prev.verse + 1 || p.chapter === prev.chapter + 1 && p.verse === 1)) && !partStart) fail("verse-order", vat);
      if (!prev && range && !(range[0].book === p.book && range[0].from[0] === p.chapter && range[0].from[1] === p.verse)) fail("first-verse-not-range-start", vat);
      if (!finite(v.start) || !finite(v.end) || v.start < -TOLERANCES.EPSILON || v.end > r.seconds + TOLERANCES.EPSILON) fail("verse-cut-out-of-range", vat);
      else {
        const d = v.end - v.start;
        if (d < TOLERANCES.MIN_VERSE_SECONDS || d > TOLERANCES.MAX_VERSE_SECONDS) fail("verse-duration", vat);
        if (i > 0 && finite(r.verses[i - 1]?.end) && v.start < r.verses[i - 1].end - TOLERANCES.EPSILON) fail("verse-overlap", vat);
      }
      if (v.review !== undefined && !Object.hasOwn(REVIEW_STATES, v.review)) fail("review-state", vat);
      for (const k of ["alignScore", "startVsSoundOnsetMs", "labelGapMedianMs"]) if (v[k] !== undefined && v[k] !== null && !finite(v[k])) fail(`metric-${k}`, vat);
      if (!Array.isArray(v.words) || !v.words.length || v.words.length > TOLERANCES.MAX_WORDS_PER_VERSE) return fail("words", vat);
      v.words.forEach((w, k) => {
        const wat = `${vat}#w${k}`;
        if (!isObject(w)) return fail("word-not-object", wat);
        for (const f of Object.keys(w)) if (!WORD_FIELDS.has(f)) fail("unknown-field", `${wat}.${safeKey(f)}`);
        if (typeof w.he !== "string" || !w.he || w.he.length > 64 || !w.he.isWellFormed() || w.he !== w.he.normalize("NFC") || BAD_TEXT.test(w.he) || !HEBREW_LETTER.test(w.he)) fail("word-text", wat);
        if (!finite(w.start)) return fail("word-start", wat);
        if (finite(v.start) && finite(v.end) && (w.start < v.start - TOLERANCES.EPSILON || w.start > v.end + TOLERANCES.EPSILON)) fail("word-outside-verse", wat);
        if (k > 0 && finite(v.words[k - 1]?.start) && w.start < v.words[k - 1].start) fail("word-order", wat);
        // label is PocketTorah's own onset; it leads the voice and is never used for highlighting.
        if (w.label !== undefined && (!finite(w.label) || w.label < 0 || w.label > r.seconds + TOLERANCES.EPSILON)) fail("word-label", wat);
        if (w.label !== undefined && r.wordLabelsMatched !== true) fail("label-without-match", wat);
      });
      prev = p;
    });
    if (typeof r.key === "string") seenKeys.add(r.key);
    if (typeof r.archiveFile === "string") seenFiles.add(r.archiveFile.toLowerCase());
    if (errors.length === before) valid.set(r.key, r);
  });
  // The same verse in two recordings is legal (it can be read in two places) but never resolved by guessing.
  const byRef = new Map();
  for (const r of valid.values()) for (const v of r.verses) byRef.set(v.ref, (byRef.get(v.ref) ?? 0) + 1);
  const shared = [...byRef.values()].filter(n => n > 1).length;
  if (shared) warnings.push({ code: "verse-in-several-recordings", count: shared });
  return { ok: errors.length === 0, errors, warnings, recordings: valid };
}
const safeKey = k => /^[A-Za-z0-9_]{1,40}$/.test(k) ? k : "?";

// ---- read-word crosswalk ---------------------------------------------------------------------------
// The portal's reading words (projectStudyVerse().words[].text, qere already chosen) are the authority.
// Comparison key: NFC with sof pasuq, paseq, maqaf and CGJ removed; nothing else is touched, so any
// difference in a letter, vowel or accent makes the verse unavailable for word highlighting.
const STRIP = /[׃׀־͏]/gu, MAQAF_CH = "־";
export const comparisonKey = w => String(w).normalize("NFC").replace(STRIP, "");

/**
 * Map portal reading words to index words. Exact when each portal word equals the concatenation of
 * one or more consecutive index words (a maqaf compound the aligner split), covering both sequences
 * completely. Returns {status: "exact", groups} (groups[p] = index word numbers for portal word p) or
 * {status: "unavailable", reason}. Never shifts, skips or fuzzily matches a word.
 */
export function crosswalkWords(portalWords, indexWords) {
  if (!Array.isArray(portalWords) || !Array.isArray(indexWords) || !portalWords.length || !indexWords.length) return { status: "unavailable", reason: "no-words" };
  const P = portalWords.map(comparisonKey), I = indexWords.map(comparisonKey);
  if (P.some(w => !w) || I.some(w => !w)) return { status: "unavailable", reason: "empty-word" };
  const groups = [];
  let i = 0;
  for (const p of P) {
    const g = [];
    let acc = "";
    while (i < I.length && acc.length < p.length) {
      // Only a maqaf joins two index words into one portal word; a space never does.
      if (g.length && !String(indexWords[i - 1]).normalize("NFC").endsWith(MAQAF_CH)) return { status: "unavailable", reason: "text-mismatch" };
      acc += I[i]; g.push(i++);
      if (!p.startsWith(acc)) return { status: "unavailable", reason: "text-mismatch" };
    }
    if (acc !== p) return { status: "unavailable", reason: i >= I.length ? "index-words-exhausted" : "text-mismatch" };
    groups.push(g);
  }
  if (i !== I.length) return { status: "unavailable", reason: "index-words-left-over" };
  return { status: "exact", groups };
}

/**
 * A reviewed override for a verse the exact rule cannot map. It binds to the exact texts it was
 * reviewed against; a changed portal text or index makes it stale, and stale means unavailable.
 */
export function applyOverride(override, { readingTextSha256, indexWordsSha256, portalCount, indexCount }) {
  if (!isObject(override) || override.readingTextSha256 !== readingTextSha256 || override.indexWordsSha256 !== indexWordsSha256) return { status: "unavailable", reason: "override-stale" };
  if (typeof override.reviewedBy !== "string" || !override.reviewedBy || typeof override.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(override.reviewedAt)) return { status: "unavailable", reason: "override-unreviewed" };
  const g = override.groups;
  if (!Array.isArray(g) || g.length !== portalCount) return { status: "unavailable", reason: "override-shape" };
  let next = 0;
  for (const group of g) {
    if (!Array.isArray(group) || !group.length) return { status: "unavailable", reason: "override-shape" };
    for (const k of group) if (k !== next++) return { status: "unavailable", reason: "override-shape" };
  }
  if (next !== indexCount) return { status: "unavailable", reason: "override-shape" };
  return { status: "exact", groups: g.map(x => [...x]) };
}

// ---- client DTO -----------------------------------------------------------------------------------
const ms = t => Math.round(t * 1000) / 1000;

/**
 * Build the client-safe DTO for one verse of one validated recording.
 *  asset: the approved-asset registry entry for this recording, {assetId, approved: true} (opaque id
 *         assigned by the server; no path, file name or URL ever reaches the client).
 *  portal: {status: "ready", words: string[], readingTextSha256} from the portal's own projection, or
 *          {status: "unavailable"}.
 *  hashes: {indexWordsSha256} computed by the caller over the index words (see indexWordsDigestInput).
 *  override: an optional reviewed override (applyOverride).
 * Playback and word highlighting are separate: a verse can play whole with highlighting unavailable.
 */
export function buildVerseDto({ recording, verse, asset, portal, indexWordsSha256 = null, override = null }) {
  if (!isObject(asset) || asset.approved !== true || typeof asset.assetId !== "string" || !ASSET_ID.test(asset.assetId)) {
    return { schema: DTO_SCHEMA, ref: verse.ref, playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } };
  }
  const review = verse.review === undefined ? null : REVIEW_STATES[verse.review];
  const playback = { status: review ? "needs-review" : "ready", ...(review ? { review } : {}), asset: asset.assetId, clip: { start: ms(verse.start), end: ms(verse.end) } };
  let words;
  if (!isObject(portal) || portal.status !== "ready" || !Array.isArray(portal.words)) words = { status: "unavailable", reason: "portal-text-unavailable" };
  else {
    let x = crosswalkWords(portal.words, verse.words.map(w => w.he));
    if (x.status !== "exact" && override) {
      x = (typeof portal.readingTextSha256 === "string" && SHA256.test(portal.readingTextSha256) && typeof indexWordsSha256 === "string" && SHA256.test(indexWordsSha256))
        ? applyOverride(override, { readingTextSha256: portal.readingTextSha256, indexWordsSha256, portalCount: portal.words.length, indexCount: verse.words.length })
        : { status: "unavailable", reason: "override-unbound" };
    }
    words = x.status === "exact"
      ? { status: "ready", ...(typeof portal.readingTextSha256 === "string" ? { readingTextSha256: portal.readingTextSha256 } : {}), starts: x.groups.map(g => ms(verse.words[g[0]].start)) }
      : { status: "unavailable", reason: x.reason };
  }
  return { schema: DTO_SCHEMA, ref: verse.ref, table: recording.table, playback, words, attribution: ATTRIBUTION };
}

/** The exact string whose SHA-256 binds an override to an index verse: words joined by U+0020. */
export const indexWordsDigestInput = verse => verse.words.map(w => w.he).join(" ");
