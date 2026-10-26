import { TranslationsUnavailable, type TranslationsReader } from "../../src/server/study/translations";
import { JPS2023 } from "../../src/server/study/versions";
import { SourceMetadataUnavailable } from "../../src/server/study/sources/metadata";
import { SourceTextUnavailable } from "../../src/server/study/source-text";
import { CourseTextUnavailable } from "../../src/server/service-course/text";

// Invented edition titles and numbered English only: never a translation's words, never a publisher's name.
/** A public runtime's Compare reader that always reports upstream trouble (for tests that do not use Compare). */
export const unavailableTranslations: TranslationsReader = async () => { throw new TranslationsUnavailable("upstream"); };

type Version = Record<string, unknown>;
export const englishVersion = (title: string, text: unknown = `Synthetic rendering of the verse by ${title}.`, extra: Version = {}): Version =>
  ({ versionTitle: title, language: "en", actualLanguage: "en", languageFamilyName: "english", license: "CC-BY", versionSource: "https://example.com/synthetic", text, ...extra });
export const targumVersion = (language: "he" | "en", title: string, text: unknown, license = "Public Domain"): Version =>
  ({ versionTitle: title, language, actualLanguage: language, languageFamilyName: language === "he" ? "hebrew" : "english", license, text });
/** The shown main translation, which Compare leaves out because it is already on the page. */
export const shownTranslation = () => englishVersion(JPS2023.versionTitle);

/** A v3 texts answer for one ref. */
export const textsAnswer = (ref: string, versions: readonly Version[], warnings: readonly unknown[] = []) =>
  ({ ref, heRef: "synthetic", sections: [], toSections: [], versions, warnings, available_versions: [] });

/**
 * Sefaria for Compare: the verse's English editions and its Targum. `english` and `targum` give each
 * answer (a body, or a status with a body); anything else is a 404.
 */
export function syntheticTranslationsFetch(options: { english?: (ref: string) => Response | unknown; targum?: (ref: string) => Response | unknown } = {}) {
  const calls: URL[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); calls.push(url);
    const ref = decodeURIComponent(url.pathname.replace(/^\/api\/v3\/texts\//, ""));
    const versions = url.searchParams.getAll("version");
    const answer = versions.includes("english|all") ? options.english?.(ref) : options.targum?.(ref);
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response(JSON.stringify({ error: `We have no text for ${ref}.` }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** The public runtime's Sefaria-backed extras, all reporting upstream trouble, for tests that use none of them. */
export const unavailableShelf = async (): Promise<never> => { throw new SourceMetadataUnavailable(); };
export const unavailableSource = async (): Promise<never> => { throw new SourceTextUnavailable("upstream"); };
/** The congregation's product name, as CRC's tenant row has it (the real runtime reads it with the shared reader). */
export const syntheticProductName = async () => "CRC Torah";
/** No curated discussions anywhere (1.7 M6), and a pinned source reader that reports upstream trouble. */
export const noDiscussions = async () => Object.freeze({ rows: Object.freeze([]), truncated: false, productName: "" });
export const unavailablePinnedSource = async (): Promise<never> => { throw new SourceTextUnavailable("upstream"); };
/** The service course's public text (2.0 SC2), not stored: every unit is unavailable. */
export const unavailableServiceText = async (): Promise<never> => { throw new CourseTextUnavailable("unavailable"); };
export const unavailableExtras = Object.freeze({ translations: unavailableTranslations, shelf: unavailableShelf, source: unavailableSource, productName: syntheticProductName,
  discussions: noDiscussions, pinnedSource: unavailablePinnedSource, serviceText: unavailableServiceText, eveningText: unavailableServiceText, portionSummary: async () => null });
