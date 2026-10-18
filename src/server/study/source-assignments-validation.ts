import "server-only";
import { createHash } from "node:crypto";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import * as work from "../student-work/validation";
export type SourceAssignmentSelection = work.WorkSelection;
export type SourceAssignmentIntent = Readonly<{ verseRef: string; expectedVersion: number; mutationId: string; sourceIds: readonly string[]; catalogHash?: string }>;
export const selection = work.selection;
export const verse = work.verse;
export function intent(value: unknown): SourceAssignmentIntent {
  const row = closedObject(value, ["verseRef", "expectedVersion", "mutationId", "sourceIds"], ["catalogHash"]);
  if (!Array.isArray(row.sourceIds) || Object.getPrototypeOf(row.sourceIds) !== Array.prototype || row.sourceIds.length > 32 || Reflect.ownKeys(row.sourceIds).length !== row.sourceIds.length + 1) throw new HttpBoundaryError();
  const ids: string[] = [];
  for (let i = 0; i < row.sourceIds.length; i++) { const d = Object.getOwnPropertyDescriptor(row.sourceIds, String(i));
    if (!d || !Object.hasOwn(d, "value") || typeof d.value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(d.value) || ids.includes(d.value)) throw new HttpBoundaryError(); ids.push(d.value); }
  const catalogHash = row.catalogHash;
  if (catalogHash !== undefined && (typeof catalogHash !== "string" || !/^[a-f0-9]{64}$/.test(catalogHash))) throw new HttpBoundaryError();
  return Object.freeze({ verseRef: work.verse(row.verseRef), expectedVersion: work.integer(row.expectedVersion, 0, 2147483646), mutationId: work.uuid(row.mutationId),
    sourceIds: Object.freeze(ids.sort()), ...(catalogHash === undefined ? {} : { catalogHash: catalogHash as string }) });
}
export function digest(selection: SourceAssignmentSelection, write: SourceAssignmentIntent): string {
  return createHash("sha256").update(JSON.stringify(["verse-source-assignment:v1", selection.studentId, selection.kind, selection.assignmentId, selection.assignmentRevision,
    selection.mode, write.verseRef, write.expectedVersion, write.sourceIds, write.catalogHash ?? null])).digest("hex");
}
