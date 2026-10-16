import "server-only";
import { createHash } from "node:crypto";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { JPS2023, MAM } from "./versions";
import type { EditionProvenance, HebrewSegment, HebrewVerse, StudyVerse, TranslationKey } from "./types";

export const STUDY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const STUDY_CACHE_MAX_BYTES = 512 * 1024;
export const STUDY_CACHE_NAMESPACE = Object.freeze({ provider: "sefaria", apiVersion: "v3",
  parserVersion: "parse5-8.0.1", policyVersion: "study-normalized-v1",
  hebrewEdition: "mam", hebrewLanguage: "he", translationEdition: "jps2023", translationLanguage: "en" } as const);
export type StudyCacheBinding = Readonly<typeof STUDY_CACHE_NAMESPACE & { book: string; chapter: number }>;
export type StudyChapterContent = Readonly<{ verses: readonly StudyVerse[]; editions: readonly EditionProvenance[] }>;
export type StudyCacheEntry = Readonly<{ binding: StudyCacheBinding; payload: StudyChapterContent;
  fetchedAt: number; expiresAt: number; hash: string }>;
export interface StudyChapterCache {
  get(binding: StudyCacheBinding): Promise<StudyCacheEntry | null>;
  set(binding: StudyCacheBinding, entry: StudyCacheEntry): Promise<void>;
}
export class StudyCacheUnavailable extends Error {
  readonly code = "cache";
  constructor() { super("Study text unavailable"); this.name = "StudyCacheUnavailable"; }
}
const invalid = (): never => { throw new StudyCacheUnavailable(); };
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return invalid();
  return value as Record<string, unknown>;
}
function normalized(value: unknown, hebrew: boolean): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > 64 * 1024 || !value.isWellFormed()
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(value)) return invalid();
  const text = value.normalize("NFC").replace(/[\u00A0\u2009\t\r ]+/g, " ");
  const result = hebrew ? text.replace(/\n/g, " ").replace(/ +/g, " ") : text.replace(/ *\n */g, "\n");
  if (result !== value) return invalid();
  return result;
}
export function studyCacheBinding(ref: string, translation: TranslationKey = "jps2023"): StudyCacheBinding {
  if (typeof ref !== "string" || translation !== "jps2023") return invalid();
  const match = /^(.*) ([1-9]\d*)$/.exec(ref);
  if (!match) return invalid();
  return validateStudyCacheBinding({ ...STUDY_CACHE_NAMESPACE, book: match[1], chapter: Number(match[2]) });
}
export function validateStudyCacheBinding(value: unknown): StudyCacheBinding {
  const row = exact(value, [...Object.keys(STUDY_CACHE_NAMESPACE), "book", "chapter"]);
  for (const [key, expected] of Object.entries(STUDY_CACHE_NAMESPACE)) if (row[key] !== expected) return invalid();
  if (typeof row.book !== "string" || !Object.hasOwn(TANAKH_VERSE_COUNTS, row.book)
    || !Number.isSafeInteger(row.chapter) || (row.chapter as number) < 1
    || (row.chapter as number) > TANAKH_VERSE_COUNTS[row.book].length) return invalid();
  return Object.freeze({ ...STUDY_CACHE_NAMESPACE, book: row.book, chapter: row.chapter as number });
}
export const studyCacheChapterRef = (binding: StudyCacheBinding) => `${binding.book} ${binding.chapter}`;
export const studyCacheChapterUrl = (binding: StudyCacheBinding) => `https://www.sefaria.org/${encodeURIComponent(binding.book)}.${binding.chapter}`;
function hebrewVerse(value: unknown): HebrewVerse {
  const row = exact(value, ["text", "readingText", "segments", "paragraphAfter"]);
  if (!Array.isArray(row.segments) || row.segments.length < 1 || row.segments.length > 4096) return invalid();
  const segments: HebrewSegment[] = row.segments.map(value => {
    if (value === null || typeof value !== "object") return invalid();
    const kind = (value as Record<string, unknown>).kind;
    if (kind === "text") {
      const part = exact(value, ["kind", "text"]), text = normalized(part.text, true);
      if (!text) return invalid();
      return Object.freeze({ kind, text });
    }
    if (kind === "alternative") {
      const part = exact(value, ["kind", "written", "read"]);
      const written = normalized(part.written, true), read = normalized(part.read, true);
      if (!written || !read || written !== written.trim() || read !== read.trim() || /[\[\]]/.test(written + read)
        || !/[א-ת]/u.test(written) || !/[א-ת]/u.test(read)) return invalid();
      return Object.freeze({ kind, written, read });
    }
    if (kind === "gap") {
      const part = exact(value, ["kind", "break"]);
      if (part.break !== "petuchah" && part.break !== "setumah") return invalid();
      return Object.freeze({ kind, break: part.break });
    }
    if (kind === "inverted-nun") { exact(value, ["kind"]); return Object.freeze({ kind }); }
    return invalid();
  });
  // Recompute all redundant projections from segments, using the normalizer's
  // spacing and end-marker rules. A matching hash alone cannot establish these.
  const combine = (reading: boolean) => segments.map(segment => segment.kind === "text" ? segment.text
    : segment.kind === "alternative" ? (reading ? segment.read : segment.written) : segment.kind === "gap" ? " " : "")
    .join("").normalize("NFC").replace(/ +/g, " ").trim();
  const text = combine(false), readingText = combine(true);
  if (!/[א-ת]/u.test(text) || !/[א-ת]/u.test(readingText) || row.text !== text || row.readingText !== readingText) return invalid();
  let paragraphAfter: HebrewVerse["paragraphAfter"] = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind === "text" && !segment.text.trim() || segment.kind === "inverted-nun") continue;
    if (segment.kind === "gap") paragraphAfter = segment.break;
    break;
  }
  if (row.paragraphAfter !== paragraphAfter) return invalid();
  return Object.freeze({ text, readingText, segments: Object.freeze(segments), paragraphAfter });
}
function edition(value: unknown, expected: EditionProvenance) {
  const row = exact(value, Object.keys(expected));
  if (Object.entries(expected).some(([key, expectedValue]) => row[key] !== expectedValue)) return invalid();
  return expected;
}
export function validateStudyChapterContent(binding: StudyCacheBinding, value: unknown): StudyChapterContent {
  const validBinding = validateStudyCacheBinding(binding), row = exact(value, ["verses", "editions"]);
  if (!Array.isArray(row.verses) || row.verses.length !== TANAKH_VERSE_COUNTS[validBinding.book][validBinding.chapter - 1]
    || !Array.isArray(row.editions) || row.editions.length < 1 || row.editions.length > 2) return invalid();
  const editions = [edition(row.editions[0], MAM)];
  if (row.editions.length === 2) editions.push(edition(row.editions[1], JPS2023));
  const verses = row.verses.map((value, i) => {
    const verse = exact(value, ["ref", "hebrew", "english"]);
    if (verse.ref !== `${studyCacheChapterRef(validBinding)}:${i + 1}`) return invalid();
    const english = verse.english === null ? null : normalized(verse.english, false);
    if (english !== null && (!english || english !== english.trim() || editions.length !== 2)) return invalid();
    return Object.freeze({ ref: verse.ref as string, hebrew: hebrewVerse(verse.hebrew), english });
  });
  const payload = Object.freeze({ verses: Object.freeze(verses), editions: Object.freeze(editions) });
  if (Buffer.byteLength(JSON.stringify(payload)) > STUDY_CACHE_MAX_BYTES) return invalid();
  return payload;
}
export const studyChapterHash = (payload: StudyChapterContent) => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
/** Accepts the adapter's complete normalized chapter result, never its selected
 * page subset or raw provider response. Hash semantics match the adapter. */
export function createStudyCacheEntry(binding: StudyCacheBinding,
  result: StudyChapterContent & Readonly<{ fetchedAt: number; hash: string }>): StudyCacheEntry {
  return validateStudyCacheEntry(binding, { binding, payload: { verses: result.verses, editions: result.editions },
    fetchedAt: result.fetchedAt, expiresAt: result.fetchedAt + STUDY_CACHE_TTL_MS, hash: result.hash });
}
export function validateStudyCacheEntry(expected: StudyCacheBinding, value: unknown, now?: number): StudyCacheEntry {
  const binding = validateStudyCacheBinding(expected), row = exact(value, ["binding", "payload", "fetchedAt", "expiresAt", "hash"]);
  const actual = validateStudyCacheBinding(row.binding);
  if (actual.book !== binding.book || actual.chapter !== binding.chapter) return invalid();
  if (!Number.isSafeInteger(row.fetchedAt) || (row.fetchedAt as number) < 0 || !Number.isSafeInteger(row.expiresAt)
    || (row.expiresAt as number) > 8_640_000_000_000_000
    || row.expiresAt !== (row.fetchedAt as number) + STUDY_CACHE_TTL_MS
    || now !== undefined && (!Number.isSafeInteger(now) || now < 0 || (row.fetchedAt as number) > now)) return invalid();
  const payload = validateStudyChapterContent(binding, row.payload);
  if (typeof row.hash !== "string" || !/^[a-f0-9]{64}$/.test(row.hash) || row.hash !== studyChapterHash(payload)) return invalid();
  return Object.freeze({ binding, payload, fetchedAt: row.fetchedAt as number, expiresAt: row.expiresAt as number, hash: row.hash });
}
