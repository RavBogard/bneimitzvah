import type { ServiceSlot } from "../../lib/readings/reading-date";
import { identifier, studentInput, type StudentInput } from "./validation";

export type ExternalRosterFields = Readonly<{
  firstName: string; lastName: string; ceremonyDate: string;
  studentKind?: "child" | "adult"; serviceSlot?: ServiceSlot;
  parentEmail?: string | null; ownEmail?: string | null;
  hebrewName?: string | null; secondParentEmail?: string | null;
}>;
export type ExternalRosterBatch = Readonly<{
  version: 1; tenantId: string; sourceNamespace: string;
  rows: readonly Readonly<{ sourceRecordId: string; fields: ExternalRosterFields }>[];
}>;
export type ExternalRosterSnapshot = Readonly<{
  version: 1; tenantId: string; sourceNamespace: string;
  students: readonly Readonly<{
    tenantId: string; studentId: string; revision: number; disabled: boolean; fields: Readonly<StudentInput>;
  }>[];
  identities: readonly Readonly<{
    tenantId: string; sourceNamespace: string; sourceRecordId: string; studentId: string;
  }>[];
}>;
export type ExternalRosterField = keyof ExternalRosterFields;
export type ExternalRosterIssue = Readonly<{
  row: number;
  code: "invalid-batch" | "invalid-snapshot" | "scope-mismatch" | "invalid-row" | "duplicate-source-id" | "linked-student-disabled";
}>;
export type ExternalRosterSuggestion = Readonly<{ studentId: string; expectedRevision: number; disabled: boolean }>;
export type ExternalRosterRowPlan =
  | Readonly<{ row: number; kind: "unchanged"; studentId: string; expectedRevision: number }>
  | Readonly<{ row: number; kind: "update-proposal"; studentId: string; expectedRevision: number; changedFields: readonly ExternalRosterField[] }>
  | Readonly<{ row: number; kind: "new-candidate" }>
  | Readonly<{ row: number; kind: "reconciliation-required"; suggestions: readonly ExternalRosterSuggestion[] }>;
export type ExternalRosterPlan =
  | Readonly<{ ok: false; version: 1; issues: readonly ExternalRosterIssue[] }>
  | Readonly<{ ok: true; version: 1; rows: readonly ExternalRosterRowPlan[] }>;

const fields: readonly ExternalRosterField[] = ["firstName", "lastName", "ceremonyDate", "studentKind", "serviceSlot", "parentEmail", "ownEmail", "hebrewName", "secondParentEmail"];
const requiredFields = ["firstName", "lastName", "ceremonyDate"];
const snapshotFields = [...requiredFields, "studentKind", "serviceSlot", "parentEmail", "ownEmail"];
const issuesOrder: readonly ExternalRosterIssue["code"][] = ["invalid-batch", "invalid-snapshot", "scope-mismatch", "invalid-row", "duplicate-source-id", "linked-student-disabled"];
const failure = (code: ExternalRosterIssue["code"]): ExternalRosterPlan => ({ ok: false, version: 1, issues: [{ row: 0, code }] });

// Accept data properties only: JSON-shaped callers cannot execute accessors or
// toJSON hooks during validation/byte accounting. No input object is modified.
function closed(value: unknown, allowed: readonly string[], required = allowed): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every(key => {
    if (typeof key !== "string" || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && "value" in descriptor && descriptor.value !== undefined;
  }) && required.every(key => Object.hasOwn(value, key));
}
function boundedArray(value: unknown, minimum: number, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) return false;
  return keys.every(key => {
    if (key === "length") return true;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return descriptor.enumerable && "value" in descriptor && descriptor.value !== undefined;
  });
}
function fieldShape(value: unknown, snapshot = false): value is Record<string, string | null> {
  // Bound raw cells before trim/normalization or aggregate JSON allocation.
  // Existing studentInput remains authoritative for normalized field limits.
  return closed(value, fields, snapshot ? snapshotFields : requiredFields) && Object.entries(value).every(([key, cell]) =>
    (typeof cell === "string" && cell.length <= 2048 && cell.isWellFormed() && Buffer.byteLength(cell, "utf8") <= 2048)
    || (cell === null && ["parentEmail", "ownEmail", "hebrewName", "secondParentEmail"].includes(key)));
}
const tenant = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const namespace = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9._-]{0,63}$/.test(value);
const sourceId = (value: unknown): value is string => typeof value === "string" && !!value && value.length <= 256 && value.isWellFormed() && value.trim() === value && Buffer.byteLength(value, "utf8") <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const bytesWithin = (value: unknown, maximum: number) => Buffer.byteLength(JSON.stringify(value), "utf8") <= maximum;
const uuid = (value: unknown) => identifier(value).toLowerCase();
/** The name-and-date key that suggests (never establishes) a reconciliation. */
export const rosterNameKey = (firstName: string, lastName: string, ceremonyDate: string) => JSON.stringify([firstName, lastName].map(name => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()).concat(ceremonyDate));
const nameKey = (value: StudentInput) => rosterNameKey(value.firstName, value.lastName, value.ceremonyDate);

type StudentSnapshot = { studentId: string; revision: number; disabled: boolean; fields: StudentInput };

/**
 * Pure, provider-free proposal summaries, never a full field diff or an apply
 * capability. A future authorized adapter must supply the trusted scoped
 * snapshot, then revalidate authority, identities and revisions before writing.
 * No raw contact/field values or source IDs are returned, including in errors.
 */
export function planExternalRoster(batch: unknown, snapshot: unknown): ExternalRosterPlan {
  let boundary: "invalid-batch" | "invalid-snapshot" = "invalid-batch";
  try {
  if (!closed(batch, ["version", "tenantId", "sourceNamespace", "rows"]) || batch.version !== 1 || !tenant(batch.tenantId) || !namespace(batch.sourceNamespace) || !boundedArray(batch.rows, 1, 500)) return failure("invalid-batch");
  boundary = "invalid-snapshot";
  if (!closed(snapshot, ["version", "tenantId", "sourceNamespace", "students", "identities"]) || snapshot.version !== 1 || !tenant(snapshot.tenantId) || !namespace(snapshot.sourceNamespace) || !boundedArray(snapshot.students, 0, 5000) || !boundedArray(snapshot.identities, 0, 5000)) return failure("invalid-snapshot");
  if (batch.tenantId !== snapshot.tenantId || batch.sourceNamespace !== snapshot.sourceNamespace) return failure("scope-mismatch");

  const students = new Map<string, StudentSnapshot>(), identities = new Map<string, string>(), linkedStudents = new Set<string>();
  try {
    for (const row of snapshot.students) {
      if (!closed(row, ["tenantId", "studentId", "revision", "disabled", "fields"]) || row.tenantId !== snapshot.tenantId || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || typeof row.disabled !== "boolean" || !fieldShape(row.fields, true)) return failure("invalid-snapshot");
      const studentId = uuid(row.studentId);
      if (students.has(studentId)) return failure("invalid-snapshot");
      students.set(studentId, { studentId, revision: Number(row.revision), disabled: row.disabled, fields: studentInput(row.fields) });
    }
    for (const row of snapshot.identities) {
      if (!closed(row, ["tenantId", "sourceNamespace", "sourceRecordId", "studentId"]) || row.tenantId !== snapshot.tenantId || row.sourceNamespace !== snapshot.sourceNamespace || !sourceId(row.sourceRecordId)) return failure("invalid-snapshot");
      const studentId = uuid(row.studentId);
      if (!students.has(studentId) || identities.has(row.sourceRecordId) || linkedStudents.has(studentId)) return failure("invalid-snapshot");
      identities.set(row.sourceRecordId, studentId); linkedStudents.add(studentId);
    }
    if (!bytesWithin(snapshot, 8 * 1024 * 1024)) return failure("invalid-snapshot");
  } catch { return failure("invalid-snapshot"); }

  const suggestionsByName = new Map<string, ExternalRosterSuggestion[]>();
  for (const student of students.values()) {
    const key = nameKey(student.fields), suggestions = suggestionsByName.get(key) ?? [];
    suggestions.push({ studentId: student.studentId, expectedRevision: student.revision, disabled: student.disabled });
    suggestionsByName.set(key, suggestions);
  }
  for (const suggestions of suggestionsByName.values()) suggestions.sort((a, b) => a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0);

  boundary = "invalid-batch";
  const issues: ExternalRosterIssue[] = [], rows: ExternalRosterRowPlan[] = [];
  const sourceRows = new Map<string, number[]>(), parsed: { sourceRecordId: string; fields: Record<string, string | null> }[] = [];
  for (const [index, row] of batch.rows.entries()) {
    if (!closed(row, ["sourceRecordId", "fields"]) || !sourceId(row.sourceRecordId)) { issues.push({ row: index + 1, code: "invalid-row" }); continue; }
    const duplicate = sourceRows.get(row.sourceRecordId) ?? [];
    duplicate.push(index + 1); sourceRows.set(row.sourceRecordId, duplicate);
    if (!fieldShape(row.fields)) { issues.push({ row: index + 1, code: "invalid-row" }); continue; }
    parsed[index] = { sourceRecordId: row.sourceRecordId, fields: row.fields };
  }
  for (const duplicates of sourceRows.values()) if (duplicates.length > 1) for (const row of duplicates) issues.push({ row, code: "duplicate-source-id" });
  if (!issues.length && !bytesWithin(batch, 1024 * 1024)) return failure("invalid-batch");
  for (const [index, row] of parsed.entries()) {
    if (!row) continue;
    const studentId = identities.get(row.sourceRecordId), current = studentId ? students.get(studentId)! : undefined;
    if (current?.disabled) { issues.push({ row: index + 1, code: "linked-student-disabled" }); continue; }
    try {
      const proposed = studentInput({ ...current?.fields, ...row.fields });
      if (current) {
        const changedFields = fields.filter(field => (current.fields[field] ?? null) !== (proposed[field] ?? null));
        rows.push(changedFields.length
          ? { row: index + 1, kind: "update-proposal", studentId: current.studentId, expectedRevision: current.revision, changedFields }
          : { row: index + 1, kind: "unchanged", studentId: current.studentId, expectedRevision: current.revision });
      } else {
        const suggestions = (suggestionsByName.get(nameKey(proposed)) ?? []).map(suggestion => ({ ...suggestion }));
        rows.push(suggestions.length ? { row: index + 1, kind: "reconciliation-required", suggestions } : { row: index + 1, kind: "new-candidate" });
      }
    } catch { issues.push({ row: index + 1, code: "invalid-row" }); }
  }
  if (issues.length) return { ok: false, version: 1, issues: issues.sort((a, b) => a.row - b.row || issuesOrder.indexOf(a.code) - issuesOrder.indexOf(b.code)) };
  return { ok: true, version: 1, rows };
  } catch { return failure(boundary); }
}
