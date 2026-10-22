import { TANAKH_VERSE_COUNTS } from "./catalog";
import type { VerseCounts } from "./ranges";

/**
 * Verse commentaries (Rashi and The Torah: A Women's Commentary; others only once registered here),
 * shared by the public route, the server reader and the browser parser. Numeric
 * structure, edition titles, licences and credit lines only: no commentary text
 * lives in the repository. The readings never include Ketuvim, so a work covers
 * at most the Torah and Nevi'im.
 */
export const TORAH_BOOKS = Object.freeze(["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"] as const);
export const NEVIIM_BOOKS = Object.freeze(["Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings", "Isaiah", "Jeremiah", "Ezekiel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi"] as const);
export type CommentaryCorpus = "torah" | "neviim";
export type CommentaryLicense = "Public Domain" | "CC0" | "CC-BY" | "CC-BY-NC";
export type CommentaryEditionCandidate = Readonly<{ language: "he" | "en"; title: string; license: CommentaryLicense; credit: string }>;
/** Pinned editions in preference order per language; null when the work has no edition in that language. */
export type CommentaryEditionSet = Readonly<{ he: readonly CommentaryEditionCandidate[] | null; en: readonly CommentaryEditionCandidate[] | null }>;
export type CommentaryWork = Readonly<{
  key: string; title: string; hebrewTitle: string;
  /** Sefaria book-level title; {book} is the Tanakh book: "Rashi on {book}", "The Torah; A Women's Commentary, {book}". */
  index: string;
  /** Sefaria's indexTitle: the same as `index` for a simple index, the whole work's title for a complex one. */
  indexTitle: string;
  complex: boolean;
  /** Sefaria's names for the three levels of a chapter-level text, e.g. Chapter, Verse, Comment. */
  sectionNames: readonly [string, string, string];
  /** Per corpus covered: the first pinned edition Sefaria returns with any text in the chapter is used, per language. */
  editions: Readonly<Partial<Record<CommentaryCorpus, CommentaryEditionSet>>>;
}>;

const LICENSE_TEXT: Readonly<Record<CommentaryLicense, string>> = Object.freeze({ "Public Domain": "public domain", "CC0": "CC0", "CC-BY": "CC BY", "CC-BY-NC": "CC BY-NC" });
/** The credit names the edition (and the work, when the edition title alone does not), the licence and Sefaria. */
const edition = (language: "he" | "en", title: string, license: CommentaryLicense, work?: string): CommentaryEditionCandidate =>
  Object.freeze({ language, title, license,
    credit: `${work ? `${work} (${title})` : title}, via Sefaria (${LICENSE_TEXT[license]}). Markup and footnotes removed; spacing normalized.` });
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
});

export const COMMENTARY_LIMITS = Object.freeze({ commentsPerVerse: 60, runsPerComment: 400, runChars: 16 * 1024, chapterBytes: 512 * 1024, responseBytes: 1024 * 1024, chaptersPerPage: 16 });

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
  const set = chapter.work.editions[chapter.corpus]!;
  return { he: set.he ?? NO_EDITIONS, en: set.en ?? NO_EDITIONS };
}
