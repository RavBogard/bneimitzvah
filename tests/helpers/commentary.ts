import { commentaryCandidates, commentaryComplex, parseCommentaryChapter, COMMENTARY_WORKS, type CommentaryEditionCandidate } from "../../src/lib/readings/commentary";

// Invented syllables and numbered English labels only: never a commentary's words,
// never any licensed translation. The markup imitates Sefaria's shape, not its content.
export const SYNTHETIC_HEBREW = "<b>אָב גַּד.</b> הוּ זַח טִי";
export const SYNTHETIC_ENGLISH = "<b>SYNTHETIC LEMMA</b> — synthetic comment<sup class=\"footnote-marker\">1</sup><i class=\"footnote\">synthetic note</i>.";
export const versionParameter = (candidate: CommentaryEditionCandidate) => `${candidate.language === "he" ? "hebrew" : "english"}|${candidate.title}`;
export type SyntheticOptions = { present?: readonly CommentaryEditionCandidate[]; commented?: Readonly<Record<number, number>>;
  text?: (candidate: CommentaryEditionCandidate, verse: number, comment: number) => string; padding?: number };

/**
 * A chapter-level v3 payload for "<work index> <chapter>". `present` names the
 * editions Sefaria "has" (default: the first Hebrew and first English); every
 * other pinned edition is reported missing with warning 101. `commented` maps
 * 1-based verses to comment counts (default: verse 1 one comment, verse 3 two).
 */
export function syntheticCommentaryPayload(work = "rashi", chapterName = "Genesis 1", options: SyntheticOptions = {}) {
  const chapter = parseCommentaryChapter(work, chapterName)!, editions = commentaryCandidates(chapter);
  const candidates = [...editions.he, ...editions.en], present = options.present ?? [editions.he[0], editions.en[0]].filter(Boolean);
  const commented = options.commented ?? { 1: 1, 3: 2 };
  const text = options.text ?? ((candidate, verse, comment) => candidate.language === "he" ? SYNTHETIC_HEBREW : `${SYNTHETIC_ENGLISH} ${verse}.${comment + 1}`);
  const versions = present.map(candidate => ({ versionTitle: candidate.title, language: candidate.language, actualLanguage: candidate.language,
    languageFamilyName: candidate.language === "he" ? "hebrew" : "english", license: candidate.license, versionSource: "https://example.test/synthetic",
    text: Array.from({ length: chapter.verseCount + (options.padding ?? 0) }, (_, i) =>
      Array.from({ length: i < chapter.verseCount ? commented[i + 1] ?? 0 : 0 }, (_, c) => text(candidate, i + 1, c))) }));
  const warnings = candidates.filter(candidate => !present.includes(candidate)).map(candidate => ({ [versionParameter(candidate)]: { warning_code: 101, message: "synthetic" } }));
  return { ref: chapter.ref, book: chapter.index, indexTitle: chapter.indexTitle, textDepth: 3, isComplex: commentaryComplex(chapter.work, chapter.book), isSpanning: false,
    sectionNames: [...chapter.work.sectionNames], sections: [String(chapter.number)], toSections: [String(chapter.number)], versions, warnings };
}
export const syntheticJsonResponse = (payload: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(payload), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...init.headers } });
/** A fetch that answers Sefaria's v3 chapter URLs for any registered work from synthetic payloads. */
export function syntheticCommentaryFetch(options: SyntheticOptions = {}) {
  return async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const ref = decodeURIComponent(url.pathname.split("/").at(-1)!);
    const work = Object.values(COMMENTARY_WORKS).find(item => ref.startsWith(item.index.replace("{book}", "")));
    if (url.hostname !== "www.sefaria.org" || !work) throw new Error("Unexpected synthetic upstream");
    return syntheticJsonResponse(syntheticCommentaryPayload(work.key, ref.slice(work.index.replace("{book}", "").length), options));
  };
}
