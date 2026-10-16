import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { MAM, JPS2023 } from "../../src/server/study/versions";
import type { StudyRequest } from "../../src/server/study/types";

// Generated invented syllables and numbered English labels, never passage text.
export function syntheticChapter(ref = "Genesis 1", padding = 0) {
  const match = /^(.*) (\d+)$/.exec(ref)!;
  const book = match[1], chapter = Number(match[2]), count = TANAKH_VERSE_COUNTS[book][chapter - 1];
  const version = (edition: typeof MAM) => ({ versionTitle: edition.versionTitle, versionSource: edition.sourceUrl,
    license: edition.language === "he" ? "CC-BY-SA" : "CC-BY-NC", language: edition.language,
    actualLanguage: edition.language, languageFamilyName: edition.language === "he" ? "hebrew" : "english",
    text: Array.from({ length: count }, (_, i) => edition.language === "he" ? "אָ֑ב ג׃" : `Synthetic example ${i + 1}`) });
  return { ref, book, indexTitle: book, textDepth: 2, isComplex: false, isSpanning: false, sectionNames: ["Chapter", "Verse"],
    sections: [String(chapter)], toSections: [String(chapter)], versions: [version(MAM), version(JPS2023)], warnings: [] as unknown[],
    ignoredSyntheticPadding: " ".repeat(padding) };
}
export const syntheticResponse = (ref = "Genesis 1", padding = 0) => new Response(JSON.stringify(syntheticChapter(ref, padding)), { headers: { "content-type": "application/json" } });
export function syntheticRequest(ranges = ["Genesis 1:1-3"]): StudyRequest {
  return { kind: "torah", ranges, verses: expandReadingRanges(ranges, "torah", TANAKH_VERSE_COUNTS), offset: 0, translation: "jps2023" };
}
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
