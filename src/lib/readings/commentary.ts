import { TANAKH_VERSE_COUNTS } from "./catalog";
import type { VerseCounts } from "./ranges";

/**
 * Verse commentaries (Rashi, The Torah: A Women's Commentary and, from 1.3, the classical Torah and Prophets
 * commentators below; others only once registered here),
 * shared by the public route, the server reader and the browser parser. Numeric
 * structure, edition titles, licences and credit lines only: no commentary text
 * lives in the repository. The readings never include Ketuvim, so a work covers
 * at most the Torah and Nevi'im.
 */
export const TORAH_BOOKS = Object.freeze(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"] as const);
export const NEVIIM_BOOKS = Object.freeze(["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"] as const);
export type CommentaryCorpus = "torah" | "neviim";
/** Sefaria's licence values for a pinned edition; "unknown" is what Sefaria states when it does not know. */
export type CommentaryLicense = "Public Domain" | "CC0" | "CC-BY" | "CC-BY-NC" | "CC-BY-SA" | "unknown";
/** `books`: the edition exists (or carries this licence) only in these books; absent, in every book the work covers. */
export type CommentaryEditionCandidate = Readonly<{ language: "he" | "en"; title: string; license: CommentaryLicense; credit: string; books?: readonly string[] }>;
/** Pinned editions in preference order per language; null when the work has no edition in that language. */
export type CommentaryEditionSet = Readonly<{ he: readonly CommentaryEditionCandidate[] | null; en: readonly CommentaryEditionCandidate[] | null }>;
export type CommentaryWork = Readonly<{
  key: string; title: string; hebrewTitle: string;
  /** Sefaria book-level title; {book} is the Tanakh book: "Rashi on {book}", "The Torah; A Women's Commentary, {book}". */
  index: string;
  /** Sefaria's indexTitle: the same as `index` for a simple index, the whole work's title for a complex one. */
  indexTitle: string;
  /** Sefaria's isComplex: one value for the work, or the books it is true for (it changes from book to book). */
  complex: boolean | readonly string[];
  /** Sefaria's names for the three levels of a chapter-level text, e.g. Chapter, Verse, Comment. */
  sectionNames: readonly [string, string, string];
  /** Per corpus covered: the first pinned edition Sefaria returns with any text in the chapter is used, per language. */
  editions: Readonly<Partial<Record<CommentaryCorpus, CommentaryEditionSet>>>;
}>;

const LICENSE_TEXT: Readonly<Record<CommentaryLicense, string>> = Object.freeze({ "Public Domain": "public domain", "CC0": "CC0", "CC-BY": "CC BY", "CC-BY-NC": "CC BY-NC",
  "CC-BY-SA": "CC BY-SA", "unknown": "licence not stated" });
/** The credit names the edition (and the work, when the edition title alone does not), the licence and Sefaria. */
const edition = (language: "he" | "en", title: string, license: CommentaryLicense, work?: string, books?: readonly string[]): CommentaryEditionCandidate =>
  Object.freeze({ language, title, license,
    credit: `${work ? `${work} (${title})` : title}, via Sefaria (${LICENSE_TEXT[license]}). Markup and footnotes removed; spacing normalized.`,
    ...books ? { books: Object.freeze([...books]) } : {} });
/** A registered work whose Sefaria index is one per Tanakh book ({book}). */
function work(key: string, title: string, hebrewTitle: string, index: string, complex: boolean | readonly string[], third: string,
  editions: Partial<Record<CommentaryCorpus, { he: readonly CommentaryEditionCandidate[] | null; en: readonly CommentaryEditionCandidate[] | null }>>): CommentaryWork {
  const sets = Object.fromEntries(Object.entries(editions).map(([corpus, set]) => [corpus, Object.freeze({ he: set.he && Object.freeze([...set.he]), en: set.en && Object.freeze([...set.en]) })]));
  return Object.freeze({ key, title, hebrewTitle, index, indexTitle: index, complex: Array.isArray(complex) ? Object.freeze([...complex]) : complex,
    sectionNames: Object.freeze(["Chapter", "Verse", third] as const), editions: Object.freeze(sets) });
}
/** Whether Sefaria marks this work complex for this book. */
export const commentaryComplex = (value: CommentaryWork, book: string) => Array.isArray(value.complex) ? value.complex.includes(book) : value.complex === true;
const silbermann = "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934";

// Edition titles and licences verified live on 2026-10-22: Rashi against
// https://www.sefaria.org/api/texts/versions/Rashi_on_<Book> for every Torah and Nevi'im book; the Women's
// Commentary against its versions listing and its v3 chapter texts. Daniel ruled on these licences 2026-10-22.
export const COMMENTARY_WORKS: Readonly<Record<string, CommentaryWork>> = Object.freeze({
  rashi: Object.freeze({ key: "rashi", title: "Rashi", hebrewTitle: "רש״י", index: "Rashi on {book}", indexTitle: "Rashi on {book}", complex: false,
    sectionNames: Object.freeze(["Chapter", "Verse", "Comment"] as const), editions: Object.freeze({
    torah: Object.freeze({
      he: Object.freeze([edition("he", silbermann, "Public Domain"),
        edition("he", "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann -- corrected vocalization", "Public Domain"),
        edition("he", "On Your Way", "Public Domain")]),
      en: Object.freeze([edition("en", silbermann, "Public Domain")]),
    }),
    neviim: Object.freeze({
      he: Object.freeze([edition("he", "Vocalized Edition", "CC0"), edition("he", "On Your Way", "Public Domain"), edition("he", "On Your Way -- new", "Public Domain")]),
      en: Object.freeze([edition("en", "The Judaica Press complete Tanach with Rashi, translated by A. J. Rosenberg", "CC-BY"),
        edition("en", "The Metsudah Tanach series, Lakewood, N.J", "CC-BY"),
        edition("en", "The Book of Joshua, Metsudah Publications, 1997", "CC-BY")]),
    }),
  }) }),
  // English only, Torah only; a complex index whose paragraphs mix italic titles, capitalized section headings and prose.
  womens: Object.freeze({ key: "womens", title: "The Torah: A Women's Commentary", hebrewTitle: "התורה: פירושן של נשים",
    index: "The Torah; A Women's Commentary, {book}", indexTitle: "The Torah; A Women's Commentary", complex: true,
    sectionNames: Object.freeze(["Chapter", "Verse", "Paragraph"] as const), editions: Object.freeze({
      torah: Object.freeze({ he: null,
        en: Object.freeze([edition("en", "CCAR Press and Women of Reform Judaism, 2008", "CC-BY-NC", "The Torah: A Women's Commentary")]) }),
    }) }),
  // 1.3 (plan 2026-10-22-shelf-1-3 §2): edition titles and licences verified against /api/texts/versions/<Work on Book>
  // for every book each covers, 2026-10-22; every covered chapter was swept live before merge (see the PR).
  ramban: work("ramban", "Ramban", "רמב״ן", "Ramban on {book}", true, "Comment", { torah: {
    he: [edition("he", "Vocalized Edition", "CC0", "Ramban", ["Genesis", "Leviticus", "Numbers", "Deuteronomy"]), edition("he", "Sefaria Vocalized Edition", "unknown", "Ramban", ["Exodus"])],
    en: [edition("en", "Commentary on the Torah by Ramban (Nachmanides). Translated and annotated by Charles B. Chavel. New York, Shilo Pub. House, 1971-1976", "CC-BY"),
      edition("en", "Sefaria Community Translation", "CC0", "Ramban")] } }),
  "ibn-ezra": work("ibn-ezra", "Ibn Ezra", "אבן עזרא", "Ibn Ezra on {book}", ["Genesis"], "Comment", { torah: {
    he: [edition("he", "Piotrkow, 1907-1911", "Public Domain", "Ibn Ezra", ["Genesis", "Exodus"]), edition("he", "On Your Way", "Public Domain", "Ibn Ezra")],
    en: [edition("en", "Ibn Ezra's commentary on the Pentateuch, tran. and annot. by H. Norman Strickman and Arthur M. Silver. Menorah Pub., 1988-2004", "CC-BY-NC"),
      edition("en", "Sefaria Community Translation", "CC0", "Ibn Ezra")] } }),
  sforno: work("sforno", "Sforno", "ספורנו", "Sforno on {book}", ["Genesis"], "Comment", { torah: {
    he: [edition("he", "Vocalized Edition", "CC0", "Sforno")],
    en: [edition("en", "Eliyahu Munk, HaChut Hameshulash", "CC-BY", "Sforno"), edition("en", "Sefaria Community Translation", "CC0", "Sforno")] } }),
  rashbam: work("rashbam", "Rashbam", "רשב״ם", "Rashbam on {book}", false, "Comment", { torah: {
    he: [["daat", "Genesis"], ["Rashbam on Torah -- Daat", "Exodus"], ["Rashbam on Leviticus - Daat", "Leviticus"], ["Rashbam on Numbers -- Daat", "Numbers"],
      ["Rashbam on Deuteronomy -- Daat", "Deuteronomy"]].map(([title, book]) => edition("he", title, "Public Domain", "Rashbam", [book])),
    en: [edition("en", "Eliyahu Munk, HaChut Hameshulash", "CC-BY", "Rashbam")] } }),
  "or-hachaim": work("or-hachaim", "Or HaChaim", "אור החיים", "Or HaChaim on {book}", ["Genesis"], "Comment", { torah: {
    he: [edition("he", "Vocalized Edition", "CC0", "Or HaChaim")],
    en: [edition("en", "Or Hachayim, trans. Eliyahu Munk", "CC-BY")] } }),
  // Its only complete English is a machine translation that names itself so (shown, credited by its own title).
  "kli-yakar": work("kli-yakar", "Kli Yakar", "כלי יקר", "Kli Yakar on {book}", ["Genesis"], "Comment", { torah: {
    he: [edition("he", "Vocalized Edition", "CC0", "Kli Yakar")],
    en: [edition("en", "Sefaria Kli Yakar, 2026 (Claude 3.7, ed. Francis Nataf) ✧", "CC-BY"), edition("en", "Sefaria Community Translation", "CC0", "Kli Yakar")] } }),
  chizkuni: Object.freeze({ ...work("chizkuni", "Chizkuni", "חזקוני", "Chizkuni, {book}", true, "Comment", { torah: {
    he: [edition("he", "Chizkuni", "Public Domain")],
    en: [edition("en", "Chizkuni, translated and annotated by Eliyahu Munk", "CC-BY")] } }), indexTitle: "Chizkuni" }),
  radak: work("radak", "Radak", "רד״ק", "Radak on {book}", false, "Paragraph", { neviim: {
    he: [edition("he", "Radak on Nach", "unknown")],
    en: [edition("en", "Sefaria Community Translation", "CC0", "Radak")] } }),
  "metzudat-david": work("metzudat-david", "Metzudat David", "מצודת דוד", "Metzudat David on {book}", false, "Comment", { neviim: {
    he: [edition("he", "On Your Way", "Public Domain", "Metzudat David")],
    // Sefaria states this translation's licence as CC BY in six books and does not state it in three.
    en: [edition("en", "Rabbi Mike Feuer, Jerusalem Anthology", "CC-BY", "Metzudat David", ["Joshua", "Judges", "II Samuel", "I Kings", "Jeremiah", "Micah"]),
      edition("en", "Rabbi Mike Feuer, Jerusalem Anthology", "unknown", "Metzudat David", ["Isaiah", "Zephaniah", "Zechariah"]),
      edition("en", "Sefaria Community Translation", "CC0", "Metzudat David")] } }),
});

// commentsPerVerse and runChars were raised for 1.3 after the live sweep (Or HaChaim on Genesis 1:1 has 63 comments;
// Ramban's and Ibn Ezra's English have single comments up to 38,712 characters, on Exodus 12:2).
export const COMMENTARY_LIMITS = Object.freeze({ commentsPerVerse: 100, runsPerComment: 400, runChars: 64 * 1024, chapterBytes: 512 * 1024, responseBytes: 1024 * 1024, chaptersPerPage: 16 });

export type CommentaryRun = Readonly<{ text: string; bold?: true; italic?: true }>;
/** One segment of the work: a comment (Rashi) or a paragraph (the Women's Commentary). Either language may be absent, never both. */
export type CommentaryComment = Readonly<{ hebrew: readonly CommentaryRun[] | null; english: readonly CommentaryRun[] | null }>;
/** As served: `credit` is the registry's attribution line (title, licence, "via Sefaria", changes made). */
export type CommentaryEdition = Readonly<{ language: "he" | "en"; title: string; license: CommentaryLicense; credit: string; url: string }>;
/** Verses with no comment are omitted; keys are verse numbers ("1", "2", ...). */
export type CommentaryChapter = Readonly<{ work: string; chapter: string; verses: Readonly<Record<string, Readonly<{ comments: readonly CommentaryComment[] }>>>;
  editions: readonly CommentaryEdition[] }>;
export type CommentaryChapterRef = Readonly<{ work: CommentaryWork; chapter: string; book: string; number: number; verseCount: number; corpus: CommentaryCorpus;
  /** Sefaria's book-level title and chapter ref, e.g. "Rashi on I Samuel" and "Rashi on I Samuel 20". */
  index: string; indexTitle: string; ref: string }>;

export const commentaryWork = (key: unknown): CommentaryWork | null => typeof key === "string" && Object.hasOwn(COMMENTARY_WORKS, key) ? COMMENTARY_WORKS[key] : null;
const torah = new Set<string>(TORAH_BOOKS), neviim = new Set<string>(NEVIIM_BOOKS);
/** A registered work and a real chapter ("Genesis 12", "I Samuel 20") of a book it covers, else null. */
export function parseCommentaryChapter(workKey: unknown, value: unknown, counts: VerseCounts = TANAKH_VERSE_COUNTS): CommentaryChapterRef | null {
  const work = commentaryWork(workKey);
  if (!work || typeof value !== "string" || value.length > 40) return null;
  const match = /^([A-Za-z]+(?: [A-Za-z]+)?) ([1-9]\d{0,2})$/.exec(value);
  if (!match) return null;
  const book = match[1], number = Number(match[2]);
  const corpus: CommentaryCorpus | null = torah.has(book) ? "torah" : neviim.has(book) ? "neviim" : null;
  if (!corpus || !work.editions[corpus] || !Object.hasOwn(counts, book)) return null;
  const verseCount = counts[book][number - 1];
  if (!Number.isSafeInteger(verseCount) || verseCount < 1) return null;
  const index = work.index.replace("{book}", book), indexTitle = work.indexTitle.replace("{book}", book);
  return Object.freeze({ work, chapter: value, book, number, verseCount, corpus, index, indexTitle, ref: `${index} ${number}` });
}
/** The commentary chapter a verse ref ("Genesis 12:3") belongs to, when the work covers it. */
export function commentaryChapterOfVerse(workKey: unknown, ref: string): CommentaryChapterRef | null {
  const match = /^(.+):([1-9]\d{0,2})$/.exec(ref);
  if (!match) return null;
  const chapter = parseCommentaryChapter(workKey, match[1]);
  return chapter && Number(match[2]) <= chapter.verseCount ? chapter : null;
}
/** Distinct covered chapters of a list of verse refs, in reading order, bounded. */
export function commentaryChaptersOf(workKey: unknown, refs: readonly string[]): readonly string[] {
  const seen: string[] = [];
  for (const ref of refs) {
    const chapter = commentaryChapterOfVerse(workKey, ref)?.chapter;
    if (chapter && !seen.includes(chapter)) { if (seen.length === COMMENTARY_LIMITS.chaptersPerPage) break; seen.push(chapter); }
  }
  return Object.freeze(seen);
}
/** Sefaria's page for the commentary on one verse, e.g. https://www.sefaria.org/Rashi_on_I_Samuel.20.5 */
export const commentarySefariaUrl = (chapter: CommentaryChapterRef, verse?: number) =>
  `https://www.sefaria.org/${chapter.index.replaceAll(" ", "_")}.${chapter.number}${verse === undefined ? "" : `.${verse}`}`;
/** Sefaria's page for the chapter in one named edition. */
export function commentaryEditionUrl(chapter: CommentaryChapterRef, candidate: CommentaryEditionCandidate): string {
  const url = new URL(commentarySefariaUrl(chapter));
  url.searchParams.set(candidate.language === "he" ? "vhe" : "ven", candidate.title.replaceAll(" ", "_"));
  url.searchParams.set("lang", "bi");
  return url.href;
}
const NO_EDITIONS: readonly CommentaryEditionCandidate[] = Object.freeze([]);
/** The pinned candidates for a chapter, each language in preference order (empty when the work has none in it). */
export function commentaryCandidates(chapter: CommentaryChapterRef): Readonly<{ he: readonly CommentaryEditionCandidate[]; en: readonly CommentaryEditionCandidate[] }> {
  const set = chapter.work.editions[chapter.corpus]!, here = (row: CommentaryEditionCandidate) => !row.books || row.books.includes(chapter.book);
  return { he: set.he?.filter(here) ?? NO_EDITIONS, en: set.en?.filter(here) ?? NO_EDITIONS };
}
