import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer, selection as workSelection, verse } from "../student-work/validation";
import { selfCheckStates, assessmentStates, type ProgressSelection, type ProgressStream, type ProgressWrite } from "../../lib/progress/types";

export type { ProgressSelection, ProgressStream, ProgressWrite } from "../../lib/progress/types";
export const bindingKeys = ["mode", "kind", "assignmentId", "assignmentRevision"] as const;
export const selection = workSelection;
export function state(value: unknown, stream: ProgressStream): ProgressWrite["state"] {
  const states: readonly string[] = stream === "self-check" ? selfCheckStates : assessmentStates;
  if (typeof value !== "string" || !states.includes(value)) throw new HttpBoundaryError();
  return value as ProgressWrite["state"];
}
export function write(value: unknown, stream: ProgressStream): ProgressWrite {
  const row = closedObject(value, ["verseRef", "state", "expectedVersion"]);
  return Object.freeze({ verseRef: verse(row.verseRef), state: state(row.state, stream), expectedVersion: integer(row.expectedVersion, 0, 2147483647) });
}
export function offset(value: unknown): number { return integer(value, 0, 999); }
