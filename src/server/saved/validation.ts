import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { commentaryChapterOfVerse, commentaryWork } from "../../lib/readings/commentary";
import { parseCeremonyDate } from "../../lib/readings/ranges";
import { canonicalReadingRef, READING_REF_LIMITS } from "../../lib/readings/reading-ref";

/**
 * The saved layer's request shapes. Every failure is a closed 400; nothing a caller sent is echoed.
 * Ranges are the 1.3 ref contract itself (`canonicalReadingRef`): canonical Hebcal segments joined by
 * exactly "; ", within READING_REF_LIMITS, Torah or Nevi'im only. Anything a member saves, the public
 * ref routes can open.
 */
export const SAVED_RANGE_LIMITS = READING_REF_LIMITS;
export type SavedKind = "torah" | "haftarah";
export type MarkState = "unmarked" | "working" | "got-it";
export type WorkStream = "translation" | "note";

const invalid = (): never => { throw new HttpBoundaryError(); };
// The same code points the 0036 CHECKs refuse (SAVED_TEXT_CONTROLS, SAVED_NAME_CONTROLS), plus NUL, which Postgres text cannot hold:
// C0 (text keeps tab and newline), DEL, C1 including U+0085, and the line and paragraph separators U+2028 and U+2029.
// The app refuses first, so a CHECK never fails on a member's words (which Postgres would quote in its log).
const TEXT_CONTROLS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u2028\u2029]/;
const NAME_CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return invalid();
  return value.toLowerCase();
}
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}
export function kind(value: unknown): SavedKind {
  return value === "torah" || value === "haftarah" ? value : invalid();
}
/** A reading's own name: trimmed, 1-80 characters, no control characters. */
export function name(value: unknown): string {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  const trimmed = value.trim(), length = Array.from(trimmed).length;
  if (length < 1 || length > 80 || NAME_CONTROLS.test(trimmed)) return invalid();
  return trimmed;
}
export function readingDate(value: unknown): string | null {
  if (value === null) return null;
  try { return parseCeremonyDate(value); } catch { return invalid(); }
}
/** The canonical ranges and their verses (the 1.3 ref contract), or a 400. */
export function savedRanges(value: unknown, readingKind: SavedKind): { ranges: string; verses: string[] } {
  const ref = canonicalReadingRef(value, readingKind);
  return ref ? { ranges: ref.ref, verses: [...ref.verses] } : invalid();
}
export function verse(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(value)) return invalid();
  return value;
}
/** Translation or note text: may be empty (clearing it), at most 4 KB, tabs and newlines only. */
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  const normalized = value.replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(normalized, "utf8") > 4096 || TEXT_CONTROLS.test(normalized)) return invalid();
  return normalized;
}
export function stream(value: unknown): WorkStream {
  return value === "translation" || value === "note" ? value : invalid();
}
export function markState(value: unknown): MarkState {
  return value === "unmarked" || value === "working" || value === "got-it" ? value : invalid();
}

export type CreateInput = Readonly<{ name: string; date: string | null; kind: SavedKind; ranges: string; verses: readonly string[] }>;
export function create(value: unknown): CreateInput {
  const row = closedObject(value, ["name", "date", "kind", "ranges"]);
  const readingKind = kind(row.kind), parsed = savedRanges(row.ranges, readingKind);
  return Object.freeze({ name: name(row.name), date: readingDate(row.date), kind: readingKind, ranges: parsed.ranges, verses: Object.freeze(parsed.verses) });
}
export type UpdateInput = Readonly<{ id: string; revision: number; name: string; date: string | null }>;
export function update(value: unknown): UpdateInput {
  const row = closedObject(value, ["id", "revision", "name", "date"]);
  return Object.freeze({ id: uuid(row.id), revision: integer(row.revision, 1, 2147483646), name: name(row.name), date: readingDate(row.date) });
}
export type RemoveInput = Readonly<{ id: string; revision: number }>;
export function remove(value: unknown): RemoveInput {
  const row = closedObject(value, ["id", "revision"]);
  return Object.freeze({ id: uuid(row.id), revision: integer(row.revision, 1, 2147483646) });
}
export type WorkInput = Readonly<{ readingId: string; verseRef: string; stream: WorkStream; expectedVersion: number; text: string }>;
export function work(value: unknown): WorkInput {
  const row = closedObject(value, ["readingId", "verseRef", "stream", "expectedVersion", "text"]);
  return Object.freeze({ readingId: uuid(row.readingId), verseRef: verse(row.verseRef), stream: stream(row.stream), expectedVersion: integer(row.expectedVersion, 0, 2147483646), text: text(row.text) });
}
export type MarkInput = Readonly<{ readingId: string; verseRef: string; expectedVersion: number; state: MarkState }>;
export function mark(value: unknown): MarkInput {
  const row = closedObject(value, ["readingId", "verseRef", "expectedVersion", "state"]);
  return Object.freeze({ readingId: uuid(row.readingId), verseRef: verse(row.verseRef), expectedVersion: integer(row.expectedVersion, 0, 2147483646), state: markState(row.state) });
}
export type StarInput = Readonly<{ work: string; verseRef: string; comment: number; starred: boolean }>;
/** A star names a registered commentary work and a verse that work covers. */
export function star(value: unknown): StarInput {
  const row = closedObject(value, ["work", "verseRef", "comment", "starred"]);
  if (typeof row.work !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(row.work) || !commentaryWork(row.work) || typeof row.starred !== "boolean") return invalid();
  const verseRef = verse(row.verseRef);
  if (!commentaryChapterOfVerse(row.work, verseRef)) return invalid();
  return Object.freeze({ work: row.work, verseRef, comment: integer(row.comment, 1, 60), starred: row.starred });
}
