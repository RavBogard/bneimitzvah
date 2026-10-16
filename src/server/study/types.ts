import "server-only";

export type TranslationKey = "jps2023";
export type HebrewSegment = Readonly<
  { kind: "text"; text: string } | { kind: "alternative"; written: string; read: string }
  | { kind: "gap"; break: "petuchah" | "setumah" } | { kind: "inverted-nun" }
>;
export type HebrewVerse = Readonly<{ text: string; readingText: string; segments: readonly HebrewSegment[];
  paragraphAfter: "petuchah" | "setumah" | null }>;
export type EditionProvenance = Readonly<{ key: "mam" | TranslationKey; versionTitle: string; language: "he" | "en";
  creator: string; sourceUrl: string; license: "CC-BY-SA-4.0" | "CC-BY-NC-4.0"; licenseUrl: string; changes: string }>;
export type StudyVerse = Readonly<{ ref: string; hebrew: HebrewVerse; english: string | null }>;
export type StudyRequest = Readonly<{ kind: "torah" | "haftarah"; ranges: readonly string[]; verses: readonly string[];
  offset: number; translation: TranslationKey; signal?: AbortSignal }>;
export type StudyPage = Readonly<{ offset: number; nextOffset: number | null; totalVerses: number;
  verses: readonly StudyVerse[]; translation: Readonly<{ key: TranslationKey; status: "available" | "partial" | "unavailable" }>;
  chapters: readonly Readonly<{ ref: string; sefariaUrl: string; fetchedAt: number; hash: string; editions: readonly EditionProvenance[] }>[] }>;
export class StudyUnavailable extends Error {
  constructor(public readonly code: "invalid-request" | "upstream" | "invalid-response") {
    super("Study text unavailable"); this.name = "StudyUnavailable";
  }
}
