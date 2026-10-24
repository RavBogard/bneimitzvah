import { PortalRequestError } from "../../portal/api";
import { getJson } from "../../portal/public-reading/api";
import { publicTextPath } from "../../portal/public-reading/urls";
import { parseStudyContent, studyRangePlan } from "../../portal/workspace/study/api";
import { referenceRecord } from "../../../lib/reference-audio/source";
import { analyseVerse, type AnalysedVerse } from "../../../lib/learn/verse";
import { unitWordParts, type WordCardTarget } from "../../../lib/learn/word-tap";
import { letters } from "../../../lib/service-course/check";
import { hebrewWords, parseServiceText, SERVICE_TEXT_BUILD, SERVICE_TEXT_LIMITS, type ServiceText } from "../../../lib/service-course/text";
import type { TorahRef } from "../../../lib/service-course/course";

/**
 * The service course's two reads, both public and signed out: a prayer's text from /api/public/service-text (2.0 SC2), and, for a
 * line that is a Bible verse, that verse from the existing /api/public/text route so its words open the real word card (A4 7).
 * Same-origin GETs with no cookie, through the public reader's own fetch, which turns a 429 into its status (2.0 F1).
 */
const bad = (): never => { throw new PortalRequestError(503); };
export const serviceTextPath = (unit: string) => `/api/public/service-text?${new URLSearchParams([["unit", unit], ["build", SERVICE_TEXT_BUILD]]).toString()}`;
export async function fetchServiceText(unit: string, signal: AbortSignal): Promise<ServiceText> {
  return parseServiceText(await getJson(serviceTextPath(unit), SERVICE_TEXT_LIMITS.answerBytes, signal), unit) ?? bad();
}

/** The verse the card is about, analysed as Learn analyses its own verses. */
export async function fetchVerse(ref: TorahRef, signal: AbortSignal): Promise<AnalysedVerse> {
  const plan = studyRangePlan([ref.ref], ref.kind, 0);
  const row = referenceRecord(await getJson(publicTextPath({ by: "ref", ref: ref.ref, kind: ref.kind }, ref.kind, 0), 2 * 1024 * 1024, signal),
    ["kind", "ref", "offset", "nextOffset", "totalVerses", "translation", "verses", "chapters"]);
  if (!row || row.kind !== ref.kind || row.ref !== ref.ref) return bad();
  const page = parseStudyContent(row, plan, 0, 1), verse = page.verses[0];
  if (!verse || verse.ref !== ref.ref) return bad();
  return analyseVerse({ ref: ref.ref, kind: ref.kind, hebrew: verse.hebrew }) ?? bad();
}

/** The divine name's spellings, as letters: the prayer's two yods and the verse's four letters are the same word. */
const name = (word: string) => { const plain = letters(word); return plain === "\u05D9\u05D9" ? "\u05D9\u05D4\u05D5\u05D4" : plain; };
/**
 * Where the line's verse words sit in the verse: the one place their letters match, word for word, or null. A line may hold part of
 * a verse (the K'dushah's line starts after "and one called to another"), so the place is found, not assumed. No match, or two,
 * and the line keeps its glossary card (A4 7, the alignment check).
 */
export function verseTargets(verse: AnalysedVerse, lineHe: string, ref: TorahRef): ((word: number) => WordCardTarget | null) | null {
  const words: { text: string; unit: number; word: number }[] = [];
  verse.units.forEach((unit, index) => {
    const parts = unitWordParts(unit);
    if (parts) parts.forEach(part => words.push({ text: part.text, unit: index, word: part.word }));
    else words.push({ text: unit.text, unit: index, word: unit.words[0] });
  });
  const line = hebrewWords(lineHe).slice(ref.words[0], ref.words[1] + 1);
  if (!line.length || line.length > words.length) return null;
  const places: number[] = [];
  for (let at = 0; at + line.length <= words.length; at++) if (line.every((word, i) => name(word) && name(word) === name(words[at + i].text))) places.push(at);
  if (places.length !== 1) return null;
  const start = places[0];
  return word => {
    if (word < ref.words[0] || word > ref.words[1]) return null;
    const found = words[start + word - ref.words[0]];
    return found ? Object.freeze({ verse, unit: found.unit, word: found.word }) : null;
  };
}
