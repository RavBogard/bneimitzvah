import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import type { ActiveMode } from "../access/types";

export type WorkSelection = Readonly<{ mode: ActiveMode | "child-practice"; studentId: string; kind: "torah" | "haftarah"; assignmentId: string; assignmentRevision: number }>;
export type WorkWrite = Readonly<{ verseRef: string; text: string; expectedVersion: number; mutationId: string }>;
export type Stream = "draft" | "note";
export const bindingKeys = ["mode", "studentId", "kind", "assignmentId", "assignmentRevision"] as const;
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new HttpBoundaryError();
  return value.toLowerCase();
}
export function integer(value: unknown, min: number, max = 2147483646): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpBoundaryError();
  return value;
}
export function verse(value: unknown): string {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(value)) throw new HttpBoundaryError();
  return value;
}
export function selection(value: unknown): WorkSelection {
  const row = closedObject(value, bindingKeys);
  if (!["student", "parent", "tutor", "admin", "child-practice"].includes(row.mode as string) || !["torah", "haftarah"].includes(row.kind as string)) throw new HttpBoundaryError();
  return Object.freeze({ mode: row.mode as WorkSelection["mode"], studentId: uuid(row.studentId), kind: row.kind as WorkSelection["kind"], assignmentId: uuid(row.assignmentId), assignmentRevision: integer(row.assignmentRevision, 1, 2147483647) });
}
export function write(value: unknown, stream: Stream): WorkWrite {
  const row = closedObject(value, ["verseRef", "text", "expectedVersion", "mutationId"]);
  if (typeof row.text !== "string" || !row.text.isWellFormed()) throw new HttpBoundaryError();
  const text = row.text.replace(/\r\n?/g, "\n");
  if (Buffer.byteLength(text, "utf8") > 4096 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text) || (stream === "note" && !text.trim())) throw new HttpBoundaryError();
  return Object.freeze({ verseRef: verse(row.verseRef), text, expectedVersion: integer(row.expectedVersion, 0), mutationId: uuid(row.mutationId) });
}
export function stream(value: unknown): Stream {
  if (value !== "draft" && value !== "note") throw new HttpBoundaryError();
  return value;
}
