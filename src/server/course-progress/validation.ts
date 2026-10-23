import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { parseProgress, serializeProgress, type Progress } from "../../lib/learn/progress";

/**
 * Course-progress request shapes. The document is checked by the browser's own `learn-progress/v1`
 * parser (strict keys, known lessons and cards, real dates, bounded size); every failure is a closed
 * 400 and nothing a caller sent is echoed.
 */
const invalid = (): never => { throw new HttpBoundaryError(); };
export const COURSE_VERSION_MAX = 2147483646;
export function progress(value: unknown): Progress {
  const parsed = parseProgress(value);
  return parsed && serializeProgress(parsed) !== null ? parsed : invalid();
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > COURSE_VERSION_MAX) return invalid();
  return value;
}
export type PutInput = Readonly<{ progress: Progress; expectedVersion: number }>;
/** Replace the member's document: `expectedVersion` is the version last seen, 0 when there is none yet. */
export function put(value: unknown): PutInput {
  const row = closedObject(value, ["progress", "expectedVersion"]);
  return Object.freeze({ progress: progress(row.progress), expectedVersion: version(row.expectedVersion) });
}
export type MergeInput = Readonly<{ progress: Progress }>;
/** Fold a browser's progress into the account's (first sign-in, or a conflict between devices). */
export function merge(value: unknown): MergeInput {
  const row = closedObject(value, ["progress"]);
  return Object.freeze({ progress: progress(row.progress) });
}
