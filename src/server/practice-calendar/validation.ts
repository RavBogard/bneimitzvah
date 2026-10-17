import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { integer, uuid, verse } from "../student-work/validation";
import { parseCeremonyDate } from "../../lib/readings/ranges";
import { dateOrdinal } from "./policy";
import type { PracticeEventWrite, PracticeRawCursor, PracticeSelection, PracticeTarget, PracticeWindow } from "../../lib/practice-calendar/types";

export function date(value: unknown): string { try { return parseCeremonyDate(value); } catch { throw new HttpBoundaryError(); } }
export function selection(value: unknown): PracticeSelection {
  const row = closedObject(value, ["mode", "studentId"]);
  if (!["student", "parent", "tutor", "admin", "child-practice"].includes(row.mode as string)) throw new HttpBoundaryError();
  return Object.freeze({ mode: row.mode as PracticeSelection["mode"], studentId: uuid(row.studentId) });
}
export function window(value: unknown): PracticeWindow {
  const row = closedObject(value, ["fromDate", "throughDate"]), fromDate = date(row.fromDate), throughDate = date(row.throughDate), days = dateOrdinal(throughDate) - dateOrdinal(fromDate) + 1;
  if (days < 1 || days > 366) throw new HttpBoundaryError();
  return Object.freeze({ fromDate, throughDate });
}
export function target(value: unknown): PracticeTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpBoundaryError();
  const type = Object.getOwnPropertyDescriptor(value, "type"); if (!type || !Object.hasOwn(type, "value")) throw new HttpBoundaryError();
  if (type.value === "verse") {
    const row = closedObject(value, ["type", "kind", "assignmentId", "assignmentRevision", "verseRef"]);
    if (row.kind !== "torah" && row.kind !== "haftarah") throw new HttpBoundaryError();
    return Object.freeze({ type: "verse", kind: row.kind, assignmentId: uuid(row.assignmentId), assignmentRevision: integer(row.assignmentRevision, 1, 2147483647), verseRef: verse(row.verseRef) });
  }
  if (type.value === "service-unit") {
    const row = closedObject(value, ["type", "catalogId", "catalogIdentity", "planId", "planRevision", "unitId"]);
    if (typeof row.catalogIdentity !== "string" || !/^[a-f0-9]{64}$/.test(row.catalogIdentity) || typeof row.unitId !== "string" || !row.unitId.length || row.unitId.length > 128 || /[\x00-\x1f\x7f-\x9f]/.test(row.unitId) || !row.unitId.isWellFormed()) throw new HttpBoundaryError();
    return Object.freeze({ type: "service-unit", catalogId: uuid(row.catalogId), catalogIdentity: row.catalogIdentity, planId: uuid(row.planId), planRevision: integer(row.planRevision, 1), unitId: row.unitId });
  }
  throw new HttpBoundaryError();
}
export function write(value: unknown): PracticeEventWrite {
  const row = closedObject(value, ["eventId", "expectedDay", "action", "target"]);
  if (row.action !== "visit" && row.action !== "play" && row.action !== "record") throw new HttpBoundaryError();
  return Object.freeze({ eventId: uuid(row.eventId), expectedDay: date(row.expectedDay), action: row.action, target: target(row.target) });
}
export function cursor(value: unknown): PracticeRawCursor | undefined {
  if (value === undefined) return undefined;
  const row = closedObject(value, ["receivedAt", "eventId"]);
  if (typeof row.receivedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.receivedAt) || !Number.isFinite(Date.parse(row.receivedAt)) || new Date(row.receivedAt).toISOString() !== row.receivedAt) throw new HttpBoundaryError();
  return Object.freeze({ receivedAt: row.receivedAt, eventId: uuid(row.eventId) });
}
