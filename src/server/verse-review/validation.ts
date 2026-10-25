import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { parseVerseReview, serializeVerseReview, type VerseReview } from "../../lib/learn/verse-review";

/**
 * Verse review request shapes (1.9 N19). The document is checked by the browser's own `learn-verses/v1` parser (strict
 * keys, real verses, real dates, bounded size); every failure is a closed 400 and nothing a caller sent is echoed.
 */
const invalid = (): never => { throw new HttpBoundaryError(); };
export const VERSE_REVIEW_VERSION_MAX = 2147483646;
const OWNER = /^[a-f0-9]{32}$/;
export function review(value: unknown): VerseReview {
  const parsed = parseVerseReview(value);
  return parsed && serializeVerseReview(parsed) !== null ? parsed : invalid();
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > VERSE_REVIEW_VERSION_MAX) return invalid();
  return value;
}
export type PutInput = Readonly<{ review: VerseReview; expectedVersion: number; expectedOwner: string }>;
/**
 * Replace the student's cards: `expectedVersion` is the version last seen, 0 when there is none yet, and `expectedOwner` the
 * owner name the page read them from, so a page left open while someone else signed in can never write into their account.
 */
export function put(value: unknown): PutInput {
  const row = closedObject(value, ["review", "expectedVersion", "expectedOwner"]);
  if (typeof row.expectedOwner !== "string" || !OWNER.test(row.expectedOwner)) return invalid();
  return Object.freeze({ review: review(row.review), expectedVersion: version(row.expectedVersion), expectedOwner: row.expectedOwner });
}
