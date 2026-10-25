import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { parseProgress, serializeProgress, type Progress } from "../../lib/service-course/progress";

/**
 * Service-course progress request shapes (2.0 SC4), a fork of course-progress/validation.ts. The document is checked by
 * the browser's own `service-course-progress/v1` parser (strict keys, known lessons, card ids of the course's shape, real
 * dates, bounded size); every failure is a closed 400 and nothing a caller sent is echoed.
 */
const invalid = (): never => { throw new HttpBoundaryError(); };
export const SERVICE_COURSE_VERSION_MAX = 2147483646;
export function progress(value: unknown): Progress {
  const parsed = parseProgress(value);
  return parsed && serializeProgress(parsed) !== null ? parsed : invalid();
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > SERVICE_COURSE_VERSION_MAX) return invalid();
  return value;
}
/** The owner name the browser believes it writes for (progress-access.ts `serviceCourseOwnerName`). */
function ownerName(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) return invalid();
  return value;
}
export type PutInput = Readonly<{ progress: Progress; expectedVersion: number; owner: string }>;
/** Replace the member's document: `expectedVersion` is the version last seen, 0 when there is none yet; `owner` whose it is. */
export function put(value: unknown): PutInput {
  const row = closedObject(value, ["progress", "expectedVersion", "owner"]);
  return Object.freeze({ progress: progress(row.progress), expectedVersion: version(row.expectedVersion), owner: ownerName(row.owner) });
}
export type MergeInput = Readonly<{ progress: Progress; owner: string }>;
/** Fold a browser's progress into the account's (first sign-in, or a conflict between devices); `owner` is whose it is. */
export function merge(value: unknown): MergeInput {
  const row = closedObject(value, ["progress", "owner"]);
  return Object.freeze({ progress: progress(row.progress), owner: ownerName(row.owner) });
}
