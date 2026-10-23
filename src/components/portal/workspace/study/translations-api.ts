import { PortalRequestError } from "../../api";
import { getJson } from "../../public-reading/api";
import { referenceRecord } from "../../../../lib/reference-audio/source";
import { COMPARE_LIMITS, parseCompareVerse, sefariaEditionUrl, targumRef, targumWork, type CompareAnswer, type CompareEdition, type CompareVerse } from "../../../../lib/readings/compare";
import { creditLine, EDITION_TEXT_LIMITS, licenseLabel, plainCredit } from "../../../../lib/readings/edition-credit";
import { parseRuns } from "./commentary-api";

/**
 * Compare in the browser: a same-origin GET to /api/public/translations (no cookie, no Authorization,
 * the same answer for every reader), strictly parsed. Every credit is recomputed here from the title and
 * licence and must match the server's, and every link must be Sefaria's page for that edition.
 */
const bad = (): never => { throw new PortalRequestError(503); };
export const comparePath = (verse: string) => `/api/public/translations?${new URLSearchParams([["verse", verse]]).toString()}`;

function edition(value: unknown, ref: string, language: "he" | "en"): CompareEdition {
  const row = referenceRecord(value, ["title", "license", "licenseLabel", "credit", "url", "runs"]);
  if (!row || typeof row.title !== "string" || plainCredit(row.title, EDITION_TEXT_LIMITS.title) !== row.title || typeof row.license !== "string"
    || row.license !== "" && plainCredit(row.license, EDITION_TEXT_LIMITS.license) !== row.license
    || row.licenseLabel !== licenseLabel(row.license) || row.credit !== creditLine(row.title, row.license) || row.url !== sefariaEditionUrl(ref, language, row.title)) return bad();
  const runs = parseRuns(row.runs, COMPARE_LIMITS.textChars);
  if (!runs.length) return bad();
  return Object.freeze({ title: row.title, license: row.license, licenseLabel: row.licenseLabel as string, credit: row.credit as string, url: row.url as string, runs });
}
export function parseCompareAnswer(value: unknown, verse: CompareVerse): CompareAnswer {
  const row = referenceRecord(value, ["verse", "translations", "targum"]);
  if (!row || row.verse !== verse.ref || row.translations === null && row.targum === null) return bad();
  let translations: readonly CompareEdition[] | null = null;
  if (row.translations !== null) {
    if (!Array.isArray(row.translations) || row.translations.length > COMPARE_LIMITS.translations) return bad();
    translations = Object.freeze(row.translations.map(item => edition(item, verse.ref, "en")));
    if (new Set(translations.map(item => item.title)).size !== translations.length) return bad();
  }
  let targum: CompareAnswer["targum"] = null;
  if (row.targum !== null) {
    const t = referenceRecord(row.targum, ["work", "aramaic", "english"]), ref = targumRef(verse);
    if (!t || t.work !== targumWork(verse) || t.aramaic === null && t.english === null) return bad();
    targum = Object.freeze({ work: targumWork(verse), aramaic: t.aramaic === null ? null : edition(t.aramaic, ref, "he"), english: t.english === null ? null : edition(t.english, ref, "en") });
  }
  return Object.freeze({ verse: verse.ref, translations, targum });
}
export async function fetchCompare(verseRef: string, signal: AbortSignal): Promise<CompareAnswer> {
  const verse = parseCompareVerse(verseRef);
  if (!verse) return bad();
  return parseCompareAnswer(await getJson(comparePath(verse.ref), COMPARE_LIMITS.responseBytes, signal), verse);
}
