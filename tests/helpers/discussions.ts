import { SourceTextUnavailable, type PinnedSourceReader, type SourceText } from "../../src/server/study/source-text";
import { creditLine, licenseLabel } from "../../src/lib/readings/edition-credit";
import { sourceSefariaUrl } from "../../src/lib/readings/shelf";

// Curated discussions (1.7 M6) without Sefaria: invented edition titles, invented commentators and numbered English only.
export const EN = "Synthetic English Edition", HE = "Synthetic Hebrew Edition";
export const REFS = Object.freeze(["Synthetic Commentator on Genesis 12:1:1", "Synthetic Commentator on Genesis 12:2:1", "Synthetic Mishnah 1:14", "Synthetic Midrash on Isaiah 40:1"]);

/** A pinned reader that holds `refs` in EN (with HE beside) and HE alone; anything else is "unsupported". Records each call. */
export function syntheticPinned(refs: readonly string[] = REFS, calls: string[] = []): PinnedSourceReader & { calls: string[] } {
  const read = async (ref: string, edition: { language: "he" | "en"; title: string }): Promise<SourceText> => {
    calls.push(`${ref}|${edition.language}|${edition.title}`);
    if (!refs.includes(ref) || edition.title !== (edition.language === "en" ? EN : HE)) throw new SourceTextUnavailable("unsupported");
    const he = { language: "he" as const, title: HE, license: "Public Domain", licenseLabel: licenseLabel("Public Domain"), credit: creditLine(HE, "Public Domain"), url: sourceSefariaUrl(ref, { language: "he", title: HE }) };
    const en = { language: "en" as const, title: EN, license: "CC-BY", licenseLabel: licenseLabel("CC-BY"), credit: creditLine(EN, "CC-BY"), url: sourceSefariaUrl(ref, { language: "en", title: EN }) };
    return Object.freeze({ ref, sefariaUrl: sourceSefariaUrl(ref), segments: [{ hebrew: [{ text: "synthetic-he" }], english: edition.language === "en" ? [{ text: `Synthetic English for ${ref}` }] : null }],
      editions: edition.language === "en" ? [he, en] : [he] });
  };
  return Object.assign(read, { calls });
}
