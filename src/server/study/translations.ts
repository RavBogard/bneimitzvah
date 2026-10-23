import "server-only";
import { COMPARE_LIMITS, parseCompareVerse, sefariaEditionUrl, targumRef, targumWork, type CompareAnswer, type CompareEdition, type CompareVerse } from "../../lib/readings/compare";
import { creditLine, EDITION_TEXT_LIMITS, licenseLabel, plainCredit } from "../../lib/readings/edition-credit";
import { JPS2023 } from "./versions";
import { sefariaRuns } from "./sefaria-runs";
import { fetchSefariaJson, SEFARIA_ORIGIN } from "./sefaria-json";
import { isNoTextAnswer } from "./commentary";

/**
 * Compare's public reader: two bounded Sefaria requests in parallel, each 5 s and 1 MiB at most.
 * - Every English edition of the verse (`version=english|all`), in Sefaria's order: the JPS 2023 the page
 *   already shows, empty texts, editions whose title marks another language ("[ro]") and repeated titles
 *   are left out; at most 40, 16 KiB of text each, 256 KiB in all.
 * - The verse's Targum (Onkelos on the Torah, Targum Jonathan on the Prophets) in Sefaria's default Aramaic
 *   and English editions.
 * Text goes through the shared HTML-to-runs sanitiser; titles and licences are plain and bounded, and
 * credited as Sefaria states them. One side failing leaves that side null; both failing is a failure.
 */
export class TranslationsUnavailable extends Error {
  constructor(readonly code: "invalid-request" | "upstream") { super("Translations unavailable"); this.name = "TranslationsUnavailable"; }
}
export type TranslationsResult = Readonly<{ answer: CompareAnswer; complete: boolean }>;
export type TranslationsReader = (verse: string, signal?: AbortSignal) => Promise<TranslationsResult>;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const OTHER_LANGUAGE = /\[([a-z]{2,3})\]\s*$/i;

function textUrl(ref: string, versions: readonly string[]): URL {
  const url = new URL(`${SEFARIA_ORIGIN}/api/v3/texts/${encodeURIComponent(ref)}`);
  for (const version of versions) url.searchParams.append("version", version);
  url.searchParams.set("fill_in_missing_segments", "0");
  url.searchParams.set("return_format", "default");
  return url;
}
/** One edition of one verse, or null when it has nothing usable to show. */
function editionOf(value: unknown, ref: string, language: "he" | "en"): CompareEdition | null {
  if (!object(value) || value.language !== language || value.actualLanguage !== language || typeof value.text !== "string") return null;
  const title = plainCredit(value.versionTitle, EDITION_TEXT_LIMITS.title);
  if (!title) return null;
  let runs;
  try { runs = sefariaRuns(value.text, { runChars: COMPARE_LIMITS.textChars, runsPerComment: 400 }); } catch { return null; }
  if (!runs.length) return null;
  const license = plainCredit(value.license, EDITION_TEXT_LIMITS.license) ?? "";
  return Object.freeze({ title, license, licenseLabel: licenseLabel(license), credit: creditLine(title, license), url: sefariaEditionUrl(ref, language, title), runs: Object.freeze(runs) });
}
function checkedPayload(json: unknown, ref: string): Record<string, unknown> {
  if (!object(json) || json.ref !== ref || !Array.isArray(json.versions) || json.versions.length > 400) throw new TranslationsUnavailable("upstream");
  return json;
}
export function projectTranslations(json: unknown, verse: CompareVerse): readonly CompareEdition[] {
  const payload = checkedPayload(json, verse.ref), seen = new Set<string>(), out: CompareEdition[] = [];
  let bytes = 0;
  for (const raw of payload.versions as unknown[]) {
    if (out.length === COMPARE_LIMITS.translations) break;
    if (!object(raw) || raw.versionTitle === JPS2023.versionTitle) continue;
    const language = typeof raw.versionTitle === "string" ? OTHER_LANGUAGE.exec(raw.versionTitle)?.[1]?.toLowerCase() : undefined;
    if (language && language !== "en") continue;
    const edition = editionOf(raw, verse.ref, "en");
    if (!edition || seen.has(edition.title)) continue;
    const size = Buffer.byteLength(JSON.stringify(edition));
    if (bytes + size > COMPARE_LIMITS.responseBytes - 16 * 1024) break; // room left for the Targum
    seen.add(edition.title); out.push(edition); bytes += size;
  }
  return Object.freeze(out);
}
export function projectTargum(json: unknown, verse: CompareVerse): CompareAnswer["targum"] {
  const ref = targumRef(verse), payload = checkedPayload(json, ref);
  const first = (language: "he" | "en") => { for (const raw of payload.versions as unknown[]) { const edition = editionOf(raw, ref, language); if (edition) return edition; } return null; };
  const aramaic = first("he"), english = first("en");
  return aramaic || english ? Object.freeze({ work: targumWork(verse), aramaic, english }) : null;
}

export function createSefariaTranslationsReader(input: { fetch: typeof globalThis.fetch }): TranslationsReader {
  const limits = { deadlineMs: COMPARE_LIMITS.requestMs, maxBytes: COMPARE_LIMITS.upstreamBytes };
  return async function read(value: string, signal?: AbortSignal): Promise<TranslationsResult> {
    const verse = parseCompareVerse(value);
    if (!verse) throw new TranslationsUnavailable("invalid-request");
    const [translations, targum] = await Promise.allSettled([
      fetchSefariaJson(input.fetch, textUrl(verse.ref, ["english|all"]), limits, signal).then(row => {
        if (row.status !== 200) throw new TranslationsUnavailable("upstream");
        return projectTranslations(row.json, verse);
      }),
      fetchSefariaJson(input.fetch, textUrl(targumRef(verse), ["hebrew", "english"]), limits, signal).then(row => {
        // Sefaria's own "We have no text for …" is an answer (no Targum); any other 404 is a failure, never cached long.
        if (row.status === 404 && isNoTextAnswer(row.json)) return null;
        if (row.status !== 200) throw new TranslationsUnavailable("upstream");
        return projectTargum(row.json, verse);
      }),
    ]);
    if (signal?.aborted || translations.status === "rejected" && targum.status === "rejected") throw new TranslationsUnavailable("upstream");
    const english = translations.status === "fulfilled" ? translations.value : null, aramaic = targum.status === "fulfilled" ? targum.value : null;
    const answer: CompareAnswer = Object.freeze({ verse: verse.ref, translations: english, targum: aramaic });
    const fits = (value: CompareAnswer) => Buffer.byteLength(JSON.stringify(value)) <= COMPARE_LIMITS.responseBytes;
    if (fits(answer)) return Object.freeze({ answer, complete: translations.status === "fulfilled" && targum.status === "fulfilled" });
    // An oversize Targum costs only the Targum: the translations still answer, briefly cached, never a repeated 503.
    const without: CompareAnswer = Object.freeze({ verse: verse.ref, translations: english, targum: null });
    if (english && fits(without)) return Object.freeze({ answer: without, complete: false });
    throw new TranslationsUnavailable("upstream");
  };
}
