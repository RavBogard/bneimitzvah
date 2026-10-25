/**
 * A prayer's public text as the Read step receives it (2.0 SC2): `GET /api/public/service-text?unit=` answers one unit of
 * the pinned public volume as lines of Hebrew, each with the volume's own transliteration and English when it has them.
 * This module is shared by the server's projection and the browser's parser, and knows nothing of where the bytes live.
 * It holds no text itself.
 */
export type TextLine = Readonly<{ he: string; tr?: string; en?: string }>;
/**
 * `credit` is the public build's book and licence (A7 `read.credit`), or, for the evening lessons' text from the congregation's own
 * siddur (2.0 SC7), that book's title and its own attribution line, shown verbatim as the 1.8 Service parts show it.
 */
export type ServiceCredit = Readonly<{ title: string; licence: string }> | Readonly<{ title: string; attribution: string }>;
export type ServiceText = Readonly<{ unit: string; volume: string; credit: ServiceCredit; lines: readonly TextLine[] }>;
export const SERVICE_TEXT_LIMITS = Object.freeze({ lines: 64, he: 4096, tr: 4096, en: 8192, answerBytes: 256 * 1024 });
/**
 * The evening and Havdalah lessons' text (2.0 SC7, MISSION amended 2026-10-25): units of the congregation's own Beit Mitzvah siddur,
 * served by `GET /api/public/evening-text?unit=&build=` on the CRC site only. Only the Saturday-evening family is ever asked for.
 */
export const EVENING_UNIT = /^[a-z0-9-]+\.[a-z0-9-]+@bm-maariv$/;
/**
 * The pinned siddur build every evening text URL names (the first twelve hex of its catalog identity), so a moved pin moves every URL
 * and no cache pairs an old build's lines with a new course file's word indices. Equal to the server pin's identity prefix (tested).
 */
export const EVENING_TEXT_BUILD = "781faabb7b21";
export const EVENING_TEXT_LIMITS = Object.freeze({ title: 80, attribution: 400 });
/**
 * A unit that is never read, served or stored as course text, whatever the build says (A2 discrepancy 13). The Mi Shebeirach is
 * the one "mixed" unit: the licensed build fills it with the Friedman/Setel setting, licensed to CRC only, and the public build
 * with a placeholder. Neither is shown; the lesson links to the siddur page. The course file, the route and the parser all refuse it.
 */
export const REFUSED_UNIT = /mi-shebeirach/;
/**
 * The pinned build's source sha, part of every text URL (`?unit=&build=`). A cached answer is the answer for one build: when the pin
 * moves, so do the URLs, and no cache can pair an old build's lines with a new course file's word indices. Equal to the pin's
 * `sourceGitSha` (src/server/service-course/pin.ts; a test checks it).
 */
export const SERVICE_TEXT_BUILD = "edfef85";

const HEBREW_LETTER = /[\u05D0-\u05EA]/, LATIN_LETTER = /[A-Za-z]/;
/**
 * A line's words, as the course counts them: pieces separated by a space or by a maqaf (the maqaf stays on the word before it,
 * as printed), keeping only pieces with a Hebrew letter, so a paseq or a dash is never a word. Key-word and check indices in
 * course.json count words this way, and so does the word card's verse (one reading word per maqaf part).
 */
export const hebrewWords = (he: string): readonly string[] => he.split(/\s+|(?<=\u05BE)/).filter(word => HEBREW_LETTER.test(word));
/** The transliteration's words, by spaces, keeping only pieces with a Latin letter ("/" and "—" are not words). */
export const translitWords = (tr: string): readonly string[] => tr.split(/\s+/).filter(word => LATIN_LETTER.test(word));
/** A word as a choice or a card heading: no surrounding punctuation, sof pasuq or brackets. Points and accents stay. */
export const plainWord = (word: string): string => word.replace(/^[(\[«"'“‘]+|[)\]»"'”’.,;:!?\u05C3\u05BE]+$/gu, "").replace(/^[(\[]+/, "");
/** A transliterated word without its punctuation: "Yisra’el," becomes "Yisra’el". */
export const plainTranslit = (word: string): string => word.replace(/^[(\["“‘]+|[)\]"”.,;:!?—]+$/gu, "");
/**
 * Word-by-word transliteration for a line, only when its transliteration splits into exactly as many words as its Hebrew
 * (A4 8.2): otherwise null, and no reading item uses that line.
 */
export function alignedTranslit(line: TextLine): readonly string[] | null {
  if (!line.tr) return null;
  const he = hebrewWords(line.he), tr = translitWords(line.tr);
  return he.length > 0 && he.length === tr.length ? tr.map(plainTranslit) : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value.isWellFormed();
/** The browser's parse of a route answer: exact keys, bounded strings, the unit it asked for. Anything else is null. */
export function parseServiceText(value: unknown, unit: string): ServiceText | null {
  if (!isObject(value) || Object.keys(value).some(key => !["unit", "volume", "credit", "lines"].includes(key))) return null;
  if (value.unit !== unit || !boundedString(value.volume, 64) || !isObject(value.credit) || !Array.isArray(value.lines)) return null;
  const credit = value.credit;
  if (Object.keys(credit).some(key => key !== "title" && key !== "licence") || !boundedString(credit.title, 80) || !boundedString(credit.licence, 40)) return null;
  const lines = parseLines(value.lines);
  return lines && Object.freeze({ unit, volume: value.volume, credit: Object.freeze({ title: credit.title as string, licence: credit.licence as string }), lines });
}
function parseLines(value: unknown[]): readonly TextLine[] | null {
  if (value.length < 1 || value.length > SERVICE_TEXT_LIMITS.lines) return null;
  const lines: TextLine[] = [];
  for (const row of value) {
    if (!isObject(row) || Object.keys(row).some(key => !["he", "tr", "en"].includes(key)) || !boundedString(row.he, SERVICE_TEXT_LIMITS.he) || !HEBREW_LETTER.test(row.he)) return null;
    if (row.tr !== undefined && !boundedString(row.tr, SERVICE_TEXT_LIMITS.tr)) return null;
    if (row.en !== undefined && !boundedString(row.en, SERVICE_TEXT_LIMITS.en)) return null;
    lines.push(Object.freeze({ he: row.he, ...(row.tr !== undefined ? { tr: row.tr as string } : {}), ...(row.en !== undefined ? { en: row.en as string } : {}) }));
  }
  return Object.freeze(lines);
}
/**
 * The browser's parse of an evening text answer (2.0 SC7): the same lines, a Saturday-evening unit of the siddur `volume` names (the
 * congregation's siddur book), and the book's title and attribution as its credit. Anything else is null.
 */
export function parseEveningText(value: unknown, unit: string, volume: string): ServiceText | null {
  if (!EVENING_UNIT.test(unit) || REFUSED_UNIT.test(unit)) return null;
  if (!isObject(value) || Object.keys(value).some(key => !["unit", "volume", "credit", "lines"].includes(key))) return null;
  if (value.unit !== unit || value.volume !== volume || !isObject(value.credit) || !Array.isArray(value.lines)) return null;
  const credit = value.credit;
  if (Object.keys(credit).some(key => key !== "title" && key !== "attribution") || !boundedString(credit.title, EVENING_TEXT_LIMITS.title) || !boundedString(credit.attribution, EVENING_TEXT_LIMITS.attribution)) return null;
  const lines = parseLines(value.lines);
  return lines && Object.freeze({ unit, volume, credit: Object.freeze({ title: credit.title as string, attribution: credit.attribution as string }), lines });
}
