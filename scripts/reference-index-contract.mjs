// Reference-audio ingestion contract: validates a private PocketTorah verse index
// (pockettorah-verse-index/v1, or v2 with refined word boundaries), maps its aligned words onto the portal's own reading words, and builds
// the small client-safe verse DTO a reviewed player adapter may serve. No I/O; only node:crypto. The
// index's Hebrew is alignment evidence only; the portal's licensed study text stays the authority for
// what a word is. See docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md.
import { createHash } from "node:crypto";

export const INDEX_SCHEMA = "pockettorah-verse-index/v1";
/** v2 adds, per word, the refined start's measured end and the original CTC onset (scripts/reference-boundary-refine.mjs). */
export const INDEX_SCHEMA_V2 = "pockettorah-verse-index/v2";
/** A v2 start may differ from its CTC onset only inside this window (seconds); anything else is refused. */
export const WORD_MOVE_BOUNDS = Object.freeze({ backS: 0.120, forwardS: 0.060 });
export const DTO_SCHEMA = "reference-verse/v1";

/** Seconds. Every bound is checked inclusively with EPSILON where stated; nothing is ever clamped. */
export const TOLERANCES = Object.freeze({
  EPSILON: 0.0015,            // index times are rounded to 1 ms
  MIN_VERSE_SECONDS: 0.5,     // shorter cuts are not a verse
  MAX_VERSE_SECONDS: 180,
  MAX_RECORDING_SECONDS: 4 * 3600,
  MAX_WORDS_PER_VERSE: 512,   // the portal's own projection limit
  MAX_RECORDINGS: 5000,
  MAX_VERSES_PER_RECORDING: 400,
});

/** The only review states the index may declare, and the playback review each one becomes. */
export const REVIEW_STATES = Object.freeze({
  "start moved earlier to pitched sound before the aligned first word": "start-moved",
});

/** Recordings known to be missing from the source; anything else missing is a gap to report, never to fill. */
export const KNOWN_GAPS = Object.freeze({
  "Haazinu-1": "no PocketTorah recording",
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
const BOOK_RE = BOOKS.join("|");
const VERSE_REF = new RegExp(`^(${BOOK_RE}) ([1-9]\\d{0,2}):([1-9]\\d{0,2})$`);
const RANGE_PART = new RegExp(`^(${BOOK_RE}) ([1-9]\\d{0,2}):([1-9]\\d{0,2})-([1-9]\\d{0,2}):([1-9]\\d{0,2})$`);
const KEY = /^([A-Za-z]{2,40})-([1-7]|h)$/;
const ARCHIVE_FILE = /^[A-Za-z0-9_-]{1,80}\.mp3$/;
const ASSET_ID = /^ra_[0-9a-f]{32}$/;   // a random or keyed-hash id from the approved-asset registry
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Index word text: Hebrew points, accents, letters, maqaf, paseq, sof pasuq, geresh marks and CGJ only.
const WORD_TEXT = /^[֑-ׇא-תװ-״͏]{1,64}$/u;
const HEBREW_LETTER = /[א-ת]/u;
const MAQAF = "־", PASEQ = "׀", SOF_PASUQ = "׃", CGJ = /͏/gu;

const RECORDING_FIELDS = new Set(["key", "parsha", "part", "table", "ref", "archiveFile", "seconds", "wordLabelsMatched", "verses"]);
const VERSE_FIELDS = new Set(["ref", "start", "end", "words", "alignScore", "startVsSoundOnsetMs", "labelGapMedianMs", "review"]);
const WORD_FIELDS = new Set(["he", "start", "label"]);
const WORD_FIELDS_V2 = new Set(["he", "start", "end", "ctcStart", "label"]);
const TOP_FIELDS = new Set(["schema", "source", "method", "recordings"]);

const finite = x => typeof x === "number" && Number.isFinite(x);
const isObject = x => x !== null && typeof x === "object" && !Array.isArray(x);
const sha256 = s => createHash("sha256").update(s, "utf8").digest("hex");
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1];
const safeKey = k => /^[A-Za-z0-9_]{1,40}$/.test(k) ? k : "?";

/** "Isaiah 40:1" -> {book, chapter, verse}, or null for anything not canonical. */
export function parseVerseRef(ref) {
  const m = typeof ref === "string" ? VERSE_REF.exec(ref) : null;
  return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null;
}
/**
 * "Jeremiah 2:4-2:28; Jeremiah 3:4-3:4" -> parts, or null. Every part runs forward, all parts are in one
 * book, and no two parts share a verse. Parts are read in the order written: a haftarah may genuinely
 * jump back (Jeremiah 34:8-34:22; Jeremiah 33:25-33:26), so a declared backward part is allowed and
 * marked `back`, while verses that leave the declared order are rejected by validateIndex.
 */
export function parseRangeRef(ref) {
  if (typeof ref !== "string" || ref.length > 200) return null;
  const parts = ref.split("; ").map(p => RANGE_PART.exec(p));
  if (parts.some(p => !p)) return null;
  const out = parts.map(m => ({ book: m[1], from: [Number(m[2]), Number(m[3])], to: [Number(m[4]), Number(m[5])] }));
  if (out.some(p => p.book !== out[0].book || cmp(p.from, p.to) > 0)) return null;
  for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) {
    if (cmp(out[a].from, out[b].to) <= 0 && cmp(out[b].from, out[a].to) <= 0) return null;   // overlap or duplicate
  }
  return out.map((p, k) => ({ ...p, back: k > 0 && cmp(p.from, out[k - 1].to) < 0 }));
}

/**
 * Validate a parsed index. Returns {ok, errors, warnings, recordings}: errors are {code, at} with `at` a
 * structural location only (recording key, verse ref, word number), never text or paths.
 *  - An invalid envelope (schema, unknown top-level field, recordings list) leaves recordings EMPTY.
 *  - Under a valid envelope a recording with any error is excluded whole, and every copy of a
 *    duplicated key or archive file is excluded; independently valid recordings remain usable.
 * options.verseCounts: {"Book": [verses in chapter 1, ...]} lets a reading cross a chapter boundary;
 * without it a chapter change cannot be checked for skipped verses and is rejected.
 * Never throws: hostile JSON becomes error codes.
 */
export function validateIndex(index, { verseCounts = null } = {}) {
  const errors = [], warnings = [], valid = new Map();
  let envelope = true;
  const fail = (code, at) => { errors.push({ code, at }); return false; };
  const bad = (code, at) => { envelope = false; return fail(code, at); };
  const done = () => ({ ok: errors.length === 0, errors, warnings, recordings: envelope ? valid : new Map() });
  if (!isObject(index)) { bad("not-an-object", "index"); return done(); }
  for (const k of Object.keys(index)) if (!TOP_FIELDS.has(k)) bad("unknown-field", `index.${safeKey(k)}`);
  if (index.schema !== INDEX_SCHEMA && index.schema !== INDEX_SCHEMA_V2) bad("schema", "index.schema");
  const v2 = index.schema === INDEX_SCHEMA_V2;
  for (const k of ["source", "method"]) if (index[k] !== undefined && (typeof index[k] !== "string" || index[k].length > 4000)) bad(k, `index.${k}`);
  if (!Array.isArray(index.recordings) || index.recordings.length === 0 || index.recordings.length > TOLERANCES.MAX_RECORDINGS) { bad("recordings", "index.recordings"); return done(); }
  const count = (f) => { const m = new Map(); for (const r of index.recordings) { const v = isObject(r) ? f(r) : null; if (typeof v === "string") m.set(v, (m.get(v) ?? 0) + 1); } return m; };
  const keyCount = count(r => r.key), fileCount = count(r => typeof r.archiveFile === "string" ? r.archiveFile.toLowerCase() : null);
  index.recordings.forEach((r, n) => {
    const before = errors.length;
    const at = isObject(r) && typeof r.key === "string" && KEY.test(r.key) ? r.key : `recording#${n}`;
    try { checkRecording(r, at, fail, keyCount, fileCount, verseCounts, v2); } catch { fail("malformed-recording", at); }
    if (errors.length === before) valid.set(r.key, r);
  });
  const byRef = new Map();
  for (const r of valid.values()) for (const v of r.verses) byRef.set(v.ref, (byRef.get(v.ref) ?? 0) + 1);
  const shared = [...byRef.values()].filter(x => x > 1).length;
  // The same verse in two recordings is legal (it can be read in two places); it is addressed only as (asset, ref).
  if (shared) warnings.push({ code: "verse-in-several-recordings", count: shared });
  const back = [...valid.values()].filter(r => parseRangeRef(r.ref).some(p => p.back)).length;
  if (back) warnings.push({ code: "declared-backward-range-part", count: back });
  return done();
}

function checkRecording(r, at, fail, keyCount, fileCount, verseCounts, v2 = false) {
  if (!isObject(r)) return fail("recording-not-object", at);
  for (const k of Object.keys(r)) if (!RECORDING_FIELDS.has(k)) fail("unknown-field", `${at}.${safeKey(k)}`);
  const key = typeof r.key === "string" ? KEY.exec(r.key) : null;
  if (!key) fail("recording-key", at);
  else if (keyCount.get(r.key) > 1) fail("duplicate-recording-key", at);
  if (typeof r.archiveFile !== "string" || !ARCHIVE_FILE.test(r.archiveFile)) fail("archive-file", at);
  else if (fileCount.get(r.archiveFile.toLowerCase()) > 1) fail("duplicate-archive-file", at);
  if (typeof r.parsha !== "string" || !key || r.parsha.replace(/[^A-Za-z]/g, "") !== key[1]) fail("parsha", at);
  if (typeof r.part !== "string" || !/^(?:[1-7]|h)$/.test(r.part)) fail("part", at);
  else if (key && key[2] !== r.part) fail("key-part-mismatch", at);
  if (!(r.table === "torah" && r.part !== "h" || r.table === "haftarah" && r.part === "h")) fail("table", at);
  if (!finite(r.seconds) || r.seconds <= 0 || r.seconds > TOLERANCES.MAX_RECORDING_SECONDS) fail("recording-seconds", at);
  if (typeof r.wordLabelsMatched !== "boolean") fail("labels-matched-flag", at);
  const range = parseRangeRef(r.ref);
  if (!range) fail("recording-ref", at);
  if (!Array.isArray(r.verses) || !r.verses.length || r.verses.length > TOLERANCES.MAX_VERSES_PER_RECORDING) return fail("verses", at);
  const seenRefs = new Set();
  let prev = null, part = 0;
  r.verses.forEach((v, i) => {
    const vat = `${at}/${isObject(v) && parseVerseRef(v.ref) ? v.ref : `verse#${i}`}`;
    if (!isObject(v)) return fail("verse-not-object", vat);
    for (const k of Object.keys(v)) if (!VERSE_FIELDS.has(k)) fail("unknown-field", `${vat}.${safeKey(k)}`);
    const p = parseVerseRef(v.ref);
    if (!p) { prev = null; return fail("verse-ref", vat); }
    if (seenRefs.has(v.ref)) fail("duplicate-verse-ref", vat);
    seenRefs.add(v.ref);
    if (range) {
      // Reading order: start at the range start, then the next verse, the next chapter's first verse when the
      // chapter's verse count shows it ended, or the next part's start once the current part is complete.
      const here = [p.chapter, p.verse];
      if (p.book !== range[0].book) fail("verse-outside-recording-ref", vat);
      else if (i === 0) { if (cmp(here, range[0].from) !== 0) fail("first-verse-not-range-start", vat); }
      else if (prev) {
        const last = [prev.chapter, prev.verse];
        if (cmp(last, range[part].to) === 0) {
          if (part + 1 < range.length && cmp(here, range[part + 1].from) === 0) part++;
          else fail("verse-outside-recording-ref", vat);
        } else if (!(p.chapter === prev.chapter && p.verse === prev.verse + 1)) {
          const counts = verseCounts?.[p.book];
          if (p.chapter === prev.chapter + 1 && p.verse === 1 && Array.isArray(counts)) { if (counts[prev.chapter - 1] !== prev.verse) fail("verse-skipped", vat); }
          else fail(p.chapter === prev.chapter + 1 && p.verse === 1 ? "chapter-end-unverified" : "verse-order", vat);
        }
        if (cmp(here, range[part].to) > 0) fail("verse-outside-recording-ref", vat);
      }
    }
    if (!finite(v.start) || !finite(v.end) || v.start < 0 || v.end > r.seconds + TOLERANCES.EPSILON) fail("verse-cut-out-of-range", vat);
    else {
      const d = v.end - v.start;
      if (d < TOLERANCES.MIN_VERSE_SECONDS || d > TOLERANCES.MAX_VERSE_SECONDS) fail("verse-duration", vat);
      if (i > 0 && finite(r.verses[i - 1]?.end) && v.start < r.verses[i - 1].end - TOLERANCES.EPSILON) fail("verse-overlap", vat);
    }
    if (v.review !== undefined && (typeof v.review !== "string" || !Object.hasOwn(REVIEW_STATES, v.review))) fail("review-state", vat);
    for (const k of ["alignScore", "startVsSoundOnsetMs", "labelGapMedianMs"]) if (v[k] !== undefined && v[k] !== null && !finite(v[k])) fail(`metric-${k}`, vat);
    if (!Array.isArray(v.words) || !v.words.length || v.words.length > TOLERANCES.MAX_WORDS_PER_VERSE) { prev = p; return fail("words", vat); }
    v.words.forEach((w, k) => {
      const wat = `${vat}#w${k}`;
      if (!isObject(w)) return fail("word-not-object", wat);
      for (const f of Object.keys(w)) if (!(v2 ? WORD_FIELDS_V2 : WORD_FIELDS).has(f)) fail("unknown-field", `${wat}.${safeKey(f)}`);
      if (typeof w.he !== "string" || !w.he.isWellFormed() || w.he !== w.he.normalize("NFC") || !WORD_TEXT.test(w.he) || !HEBREW_LETTER.test(w.he)) fail("word-text", wat);
      if (!finite(w.start)) return fail("word-start", wat);
      // A word starts inside its verse, strictly before the verse ends, and strictly after the previous word.
      if (finite(v.start) && finite(v.end) && (w.start < v.start || w.start >= v.end)) fail("word-outside-verse", wat);
      if (k > 0 && finite(v.words[k - 1]?.start) && !(w.start > v.words[k - 1].start)) fail("word-order", wat);
      // label is PocketTorah's own onset; it leads the voice and is never used for highlighting.
      if (w.label !== undefined && (!finite(w.label) || w.label < 0 || w.label > r.seconds + TOLERANCES.EPSILON)) fail("word-label", wat);
      if (w.label !== undefined && r.wordLabelsMatched !== true) fail("label-without-match", wat);
      if (v2) {
        // The CTC onset is kept beside the refined start: it obeys the v1 word rules, and the start stays
        // within WORD_MOVE_BOUNDS of it. Each end follows its start and reaches at most the next start
        // (the verse end for the last word); a gap between them is silence that belongs to no word.
        const prevW = k > 0 ? v.words[k - 1] : null, nextW = v.words[k + 1];
        if (!finite(w.ctcStart)) fail("word-ctc-start", wat);
        else {
          if (finite(v.start) && finite(v.end) && (w.ctcStart < v.start - TOLERANCES.EPSILON || w.ctcStart >= v.end)) fail("word-ctc-outside-verse", wat);
          if (isObject(prevW) && finite(prevW.ctcStart) && !(w.ctcStart > prevW.ctcStart)) fail("word-ctc-order", wat);
          if (finite(w.start) && (w.start < w.ctcStart - WORD_MOVE_BOUNDS.backS - TOLERANCES.EPSILON || w.start > w.ctcStart + WORD_MOVE_BOUNDS.forwardS + TOLERANCES.EPSILON)) fail("word-move-out-of-bounds", wat);
        }
        if (!finite(w.end) || !finite(w.start) || !(w.end > w.start)) fail("word-end", wat);
        else if (nextW !== undefined ? !isObject(nextW) || !finite(nextW.start) || w.end > nextW.start : !finite(v.end) || w.end > v.end) fail("word-end-overlap", wat);
      }
    });
    prev = p;
  });
  if (range && prev && !(part === range.length - 1 && cmp([prev.chapter, prev.verse], range.at(-1).to) === 0)) fail("recording-incomplete", at);
}

// ---- read-word crosswalk ---------------------------------------------------------------------------
// The portal's reading words (projectStudyVerse().words[].text, qere already chosen) are the authority;
// the portal splits words at a maqaf, so no portal word contains maqaf, paseq or sof pasuq.
// An index word matches portal word k when, after removing CGJ (invisible) from both, it equals the
// portal word plus at most one trailing maqaf, paseq or sof pasuq. Its trailing maqaf must stand exactly
// where the portal's reading text has a maqaf between words k and k+1. Nothing else is normalized.
const core = w => w.replace(CGJ, "");
const trailing = w => [MAQAF, PASEQ, SOF_PASUQ].includes(w.at(-1)) ? w.at(-1) : null;

/**
 * Map portal reading words one-to-one to index words. Returns {status: "exact"} or {status:
 * "unavailable", reason}. readingText is the portal's readingText, used to locate the separators.
 * Never shifts, skips, merges or fuzzily matches a word.
 */
export function crosswalkWords(portalWords, readingText, indexWords) {
  if (!Array.isArray(portalWords) || !Array.isArray(indexWords) || !portalWords.length || !indexWords.length) return { status: "unavailable", reason: "no-words" };
  if (typeof readingText !== "string") return { status: "unavailable", reason: "text-binding-missing" };
  if (portalWords.some(w => typeof w !== "string" || !w) || indexWords.some(w => typeof w !== "string" || !w)) return { status: "unavailable", reason: "empty-word" };
  if (portalWords.length !== indexWords.length) return { status: "unavailable", reason: "word-count-mismatch" };
  const text = readingText.normalize("NFC");
  let cursor = 0;
  const ends = [];
  for (let k = 0; k < portalWords.length; k++) {
    const p = portalWords[k].normalize("NFC");
    if (/[־׀׃]/u.test(p)) return { status: "unavailable", reason: "portal-word-punctuation" };
    const at = text.indexOf(p, cursor);
    if (at < 0 || text.slice(cursor, at).match(/[א-ת]/u)) return { status: "unavailable", reason: "text-binding-mismatch" };
    cursor = at + p.length; ends.push([at, cursor]);
    const i = indexWords[k].normalize("NFC"), t = trailing(i);
    if (core(t ? i.slice(0, -1) : i) !== core(p)) return { status: "unavailable", reason: "text-mismatch" };
    if (k > 0) {
      const joinedByMaqaf = text.slice(ends[k - 1][1], at).includes(MAQAF);
      if (joinedByMaqaf !== (trailing(indexWords[k - 1].normalize("NFC")) === MAQAF)) return { status: "unavailable", reason: "maqaf-mismatch" };
    }
  }
  if (trailing(indexWords.at(-1).normalize("NFC")) === MAQAF) return { status: "unavailable", reason: "maqaf-mismatch" };
  return { status: "exact" };
}

/**
 * A reviewed override for a verse the exact rule cannot map: groups[p] lists the index words whose
 * first start is portal word p's start. It binds to the exact portal words, reading text and index
 * words it was reviewed against; any change makes it stale, and stale means unavailable.
 */
export function applyOverride(override, { readingTextSha256, portalWordsSha256, indexWordsSha256, portalCount, indexCount }) {
  if (!isObject(override) || override.readingTextSha256 !== readingTextSha256 || override.portalWordsSha256 !== portalWordsSha256 || override.indexWordsSha256 !== indexWordsSha256) return { status: "unavailable", reason: "override-stale" };
  const d = typeof override.reviewedAt === "string" ? DATE.exec(override.reviewedAt) : null;
  const when = d ? new Date(`${override.reviewedAt}T00:00:00Z`) : null;
  const real = when && !Number.isNaN(when.getTime()) && when.toISOString().slice(0, 10) === override.reviewedAt;
  if (typeof override.reviewedBy !== "string" || !override.reviewedBy.trim() || !real) return { status: "unavailable", reason: "override-unreviewed" };
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

/** The exact strings whose SHA-256 values bind timings and overrides: words joined by U+0020. */
export const indexWordsDigestInput = verse => verse.words.map(w => w.he).join(" ");
export const portalWordsDigestInput = words => words.join(" ");

// ---- client DTO -----------------------------------------------------------------------------------
const ms = t => Math.round(t * 1000) / 1000;
const MISMATCH = new Set(["word-count-mismatch", "text-mismatch", "maqaf-mismatch"]);

/**
 * Build the client-safe DTO for one verse of a recording that validateIndex accepted.
 *  asset:  the approved-asset registry entry, {assetId: "ra_" + 32 hex, approved: true}. No path,
 *          file name or URL ever reaches the client.
 *  portal: {status: "ready", words: projection.words.map(w => w.text), readingText} from the portal's
 *          own projection, or {status: "unavailable"}.
 *  override: an optional reviewed override (applyOverride).
 * Every hash is computed here from the texts themselves; nothing a caller supplies is reflected.
 * Playback and highlighting are separate. A verse whose words disagree with the portal text still has
 * playback, but as needs-review ("text-mismatch"), since the disagreement questions which verse it is.
 */
export function buildVerseDto({ recording, verse, asset, portal, override = null }) {
  const unavailable = reason => ({ schema: DTO_SCHEMA, ref: verse.ref, playback: { status: "unavailable", reason }, words: { status: "unavailable", reason: "no-playback" } });
  if (!isObject(asset) || asset.approved !== true || typeof asset.assetId !== "string" || !ASSET_ID.test(asset.assetId)) return unavailable("asset-not-approved");
  let words, mismatch = false;
  if (!isObject(portal) || portal.status !== "ready" || !Array.isArray(portal.words)) words = { status: "unavailable", reason: "portal-text-unavailable" };
  else if (typeof portal.readingText !== "string" || !portal.readingText) words = { status: "unavailable", reason: "text-binding-missing" };
  else {
    const indexWords = verse.words.map(w => w.he);
    let x = crosswalkWords(portal.words, portal.readingText, indexWords);
    let groups = x.status === "exact" ? indexWords.map((_, k) => [k]) : null;
    if (x.status !== "exact" && override && portal.words.every(w => typeof w === "string")) {
      x = applyOverride(override, { readingTextSha256: sha256(portal.readingText.normalize("NFC")), portalWordsSha256: sha256(portalWordsDigestInput(portal.words)),
        indexWordsSha256: sha256(indexWordsDigestInput(verse)), portalCount: portal.words.length, indexCount: indexWords.length });
      groups = x.groups ?? null;
    }
    mismatch = x.status !== "exact" && MISMATCH.has(x.reason);
    words = x.status === "exact"
      ? { status: "ready", readingTextSha256: sha256(portal.readingText.normalize("NFC")), starts: groups.map(g => ms(verse.words[g[0]].start)),
          // v2: a portal word ends where its last index word ends. v1 has no ends; players fall back to the next start.
          ...(verse.words.every(w => finite(w.end)) ? { ends: groups.map(g => ms(verse.words[g.at(-1)].end)) } : {}) }
      : { status: "unavailable", reason: x.reason };
  }
  const review = mismatch ? "text-mismatch" : verse.review === undefined ? null : REVIEW_STATES[verse.review];
  const playback = { status: review ? "needs-review" : "ready", ...(review ? { review } : {}), asset: asset.assetId, clip: { start: ms(verse.start), end: ms(verse.end) } };
  return { schema: DTO_SCHEMA, ref: verse.ref, table: recording.table, playback, words, attribution: ATTRIBUTION };
}
