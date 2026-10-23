import { TANAKH_VERSE_COUNTS } from "./catalog";
import { NEVIIM_BOOKS, TORAH_BOOKS, type CommentaryRun } from "./commentary";

/**
 * Compare (1.3): every English translation Sefaria has for one verse, and its Targum (Onkelos on the Torah,
 * Targum Jonathan on the Prophets), each credited by what Sefaria states. Shared by the server projection,
 * the public route and the browser parser. Numbers, book names and limits only.
 */
export type CompareVerse = Readonly<{ ref: string; book: string; chapter: number; verse: number; corpus: "torah" | "neviim" }>;
export type CompareEdition = Readonly<{ title: string; license: string; licenseLabel: string; credit: string; url: string; runs: readonly CommentaryRun[] }>;
export type TargumWork = "Onkelos" | "Targum Jonathan";
export type CompareTargum = Readonly<{ work: TargumWork; aramaic: CompareEdition | null; english: CompareEdition | null }>;
/** `translations` or `targum` is null when that half could not be read; never both (that is a failure). */
export type CompareAnswer = Readonly<{ verse: string; translations: readonly CompareEdition[] | null; targum: CompareTargum | null }>;
export const COMPARE_LIMITS = Object.freeze({ translations: 40, textChars: 16 * 1024, responseBytes: 256 * 1024, upstreamBytes: 1024 * 1024, requestMs: 5000 });

const torah: ReadonlySet<string> = new Set(TORAH_BOOKS), neviim: ReadonlySet<string> = new Set(NEVIIM_BOOKS);
/** "Genesis 12:1" in the Torah or the Prophets, in range; else null. */
export function parseCompareVerse(value: unknown): CompareVerse | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const match = /^([A-Za-z]+(?: [A-Za-z]+)?) ([1-9]\d{0,2}):([1-9]\d{0,2})$/.exec(value);
  if (!match) return null;
  const book = match[1], chapter = Number(match[2]), verse = Number(match[3]);
  const corpus = torah.has(book) ? "torah" : neviim.has(book) ? "neviim" : null;
  if (!corpus || !Object.hasOwn(TANAKH_VERSE_COUNTS, book) || verse > (TANAKH_VERSE_COUNTS[book][chapter - 1] ?? 0)) return null;
  return Object.freeze({ ref: value, book, chapter, verse, corpus });
}
export const targumWork = (verse: CompareVerse): TargumWork => verse.corpus === "torah" ? "Onkelos" : "Targum Jonathan";
/** Sefaria's ref for the verse's Targum: "Onkelos Genesis 12:1", "Targum Jonathan on Isaiah 40:1". */
export const targumRef = (verse: CompareVerse) => verse.corpus === "torah" ? `Onkelos ${verse.ref}` : `Targum Jonathan on ${verse.ref}`;
/** Sefaria's page for a ref in one named edition, e.g. https://www.sefaria.org/Genesis.12.1?ven=Title&lang=bi */
export function sefariaEditionUrl(ref: string, language: "he" | "en", title: string): string {
  const at = ref.lastIndexOf(" "), [chapter, verse] = ref.slice(at + 1).split(":");
  const url = new URL(`https://www.sefaria.org/${ref.slice(0, at).replaceAll(" ", "_")}.${chapter}.${verse}`);
  url.searchParams.set(language === "he" ? "vhe" : "ven", title.replaceAll(" ", "_"));
  url.searchParams.set("lang", "bi");
  return url.href;
}
