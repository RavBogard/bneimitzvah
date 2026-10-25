import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer, uuid } from "../student-work/validation";
import { parseCeremonyDate } from "../../lib/readings/ranges";
import type { LessonLogCreate, LessonLogCursor, LessonLogDelete, LessonLogEdit, LessonLogSelection } from "../../lib/lesson-log/types";

export function selection(value: unknown): LessonLogSelection {
  const row = closedObject(value, ["mode", "studentId"]);
  if (!["student", "parent", "tutor", "admin", "child-practice"].includes(row.mode as string)) throw new HttpBoundaryError();
  return Object.freeze({ mode: row.mode as LessonLogSelection["mode"], studentId: uuid(row.studentId) });
}
export function lessonDate(value: unknown): string {
  // Only the real Gregorian date algorithm is reused, without scheduling rules.
  try { return parseCeremonyDate(value); } catch { throw new HttpBoundaryError(); }
}
export function summary(value: unknown): string {
  if (typeof value !== "string" || !value.isWellFormed()) throw new HttpBoundaryError();
  const text = value.replace(/\r\n?/g, "\n");
  if (!text.trim() || Buffer.byteLength(text, "utf8") > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) throw new HttpBoundaryError();
  return text;
}
/** The "Before next time" line (N12): absent stays absent (an edit keeps the saved line), null or blank means none,
 * otherwise plain text of at most 1024 UTF-8 bytes, held to the summary's own character rules. */
export const beforeNextLimit = 1024;
export function beforeNext(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !value.isWellFormed()) throw new HttpBoundaryError();
  const text = value.replace(/\r\n?/g, "\n");
  if (!text.trim()) return null;
  if (Buffer.byteLength(text, "utf8") > beforeNextLimit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) throw new HttpBoundaryError();
  return text;
}
export function cursor(value: unknown): LessonLogCursor | undefined {
  if (value === undefined) return undefined;
  const row = closedObject(value, ["lessonDate", "entryId"]);
  return Object.freeze({ lessonDate: lessonDate(row.lessonDate), entryId: uuid(row.entryId) });
}
export function create(value: unknown): LessonLogCreate & { beforeNext: string | null } {
  const row = closedObject(value, ["entryId", "lessonDate", "summary"], ["beforeNext"]);
  return Object.freeze({ entryId: uuid(row.entryId), lessonDate: lessonDate(row.lessonDate), summary: summary(row.summary), beforeNext: beforeNext(row.beforeNext) ?? null });
}
export function edit(value: unknown): LessonLogEdit {
  const row = closedObject(value, ["entryId", "expectedVersion", "lessonDate", "summary"], ["beforeNext"]);
  const next = beforeNext(row.beforeNext);
  return Object.freeze({ entryId: uuid(row.entryId), lessonDate: lessonDate(row.lessonDate), summary: summary(row.summary), ...(next === undefined ? {} : { beforeNext: next }),
    expectedVersion: integer(row.expectedVersion, 1, 2147483647) });
}
export function remove(value: unknown): LessonLogDelete {
  const row = closedObject(value, ["entryId", "expectedVersion"]);
  return Object.freeze({ entryId: uuid(row.entryId), expectedVersion: integer(row.expectedVersion, 1, 2147483647) });
}
