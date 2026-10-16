import "server-only";
import type { EditionProvenance, TranslationKey } from "./types";

export const MAM: EditionProvenance = Object.freeze({ key: "mam", versionTitle: "Miqra according to the Masorah", language: "he",
  creator: "Dovi and Hebrew Wikisource contributors, via Sefaria",
  sourceUrl: "https://he.wikisource.org/wiki/משתמש:Dovi/מקרא_על_פי_המסורה",
  license: "CC-BY-SA-4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  changes: "Markup and notes removed; Unicode and spacing normalized; written/read alternatives and Masoretic breaks represented separately. Adapted text retains CC BY-SA 4.0." });
export const JPS2023: EditionProvenance = Object.freeze({ key: "jps2023", versionTitle: "THE JPS TANAKH: Gender-Sensitive Edition", language: "en",
  creator: "The Jewish Publication Society, 2023, via Sefaria", sourceUrl: "https://jps.org/books/the-jps-tanakh-gender-sensitive-edition/",
  license: "CC-BY-NC-4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  changes: "Markup and footnotes removed; Unicode and spacing normalized. Noncommercial use; no alternate edition substituted." });
export function translationEdition(key: TranslationKey): EditionProvenance {
  if (key !== "jps2023") throw new Error("Unsupported study edition");
  return JPS2023;
}
export const versionParameter = (edition: EditionProvenance) => `${edition.language === "he" ? "hebrew" : "english"}|${edition.versionTitle}`;
export function matchesEdition(value: Record<string, unknown>, edition: EditionProvenance) {
  try {
    return value.versionTitle === edition.versionTitle && value.language === edition.language && value.actualLanguage === edition.language
      && value.languageFamilyName === (edition.language === "he" ? "hebrew" : "english")
      && value.license === (edition.language === "he" ? "CC-BY-SA" : "CC-BY-NC")
      && typeof value.versionSource === "string" && new URL(value.versionSource).href === new URL(edition.sourceUrl).href;
  } catch { return false; }
}
