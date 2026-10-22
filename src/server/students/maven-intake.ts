import "server-only";
import { createHash } from "node:crypto";
import { ceremonyLocalDate } from "../service-ecosystem/scheduling";
import { planExternalRoster, rosterNameKey, type ExternalRosterField } from "./external-roster";
import type { MavenContactFacts, MavenRosterWindow } from "./maven-roster";
import { rehearsalsFit, studentInput, type StudentInput } from "./validation";

/**
 * Maven intake through the portal MCP (Decided 2026-10-21): the pure step between the decoded Maven
 * facts and the reviewable plan. Identity is the Contact id alone (planExternalRoster); a name and
 * date only suggest a reconciliation the rabbi must choose. Maven may change only the names, the
 * ceremony date and the Hebrew name of a linked student; contacts, kind and slot are set at creation
 * (kind and slot by the rabbi) and afterwards only in the portal.
 */
export type IntakeStudent = Readonly<{
  id: string; firstName: string; lastName: string; ceremonyDate: string; studentKind: "child" | "adult"; serviceSlot: "morning" | "havdalah" | "unknown";
  parentEmail: string | null; ownEmail: string | null; hebrewName: string | null; secondParentEmail: string | null;
  rehearsal1: string | null; rehearsal2: string | null; disabledAt: Date | null; revision: number;
}>;
export type IntakeIdentity = Readonly<{ sourceRecordId: string; studentId: string }>;
export type StudentKind = "child" | "adult";
export type IntakeField = "firstName" | "lastName" | "ceremonyDate" | "hebrewName";
export type IntakeSuggestion = Readonly<{ studentId: string; expectedRevision: number; disabled: boolean; linkedElsewhere: boolean; changedFields: readonly IntakeField[]; rehearsalsFit: boolean }>;
type Common = { row: number; sourceRecordId: string; digest: string };
export type IntakeRow = Readonly<Common & (
  | { kind: "unchanged"; studentId: string; expectedRevision: number }
  | { kind: "update"; studentId: string; expectedRevision: number; changedFields: readonly IntakeField[]; rehearsalsFit: boolean }
  | { kind: "new"; canCreateAs: readonly StudentKind[] }
  | { kind: "reconcile"; suggestions: readonly IntakeSuggestion[]; canCreateAs: readonly StudentKind[] }
  | { kind: "linked-student-disabled"; studentId: string }
  | { kind: "not-importable"; reason: "missing-name" | "invalid-field" | "no-email-on-file" })>;
export type IntakePlan = Readonly<{ ok: true; rows: readonly IntakeRow[] }> | Readonly<{ ok: false; code: string }>;

export const MAVEN_INTAKE_FIELDS: readonly IntakeField[] = Object.freeze(["firstName", "lastName", "ceremonyDate", "hebrewName"]);
const KINDS: readonly StudentKind[] = ["child", "adult"];
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Eight hex characters per row, bound into the signed plan token. */
export const ROW_DIGEST_LENGTH = 8;

/** Today (the congregation's local date) through two years ahead: 731 inclusive days, inside Maven's 1830. */
export function defaultMavenWindow(now: number): MavenRosterWindow {
  const start = ceremonyLocalDate(now), end = new Date(Date.parse(`${start}T00:00:00Z`) + 730 * 86_400_000).toISOString().slice(0, 10);
  return Object.freeze({ start, end });
}
/** A digest of the decoded facts: what the plan token binds, never the facts themselves. */
export const factsDigest = (facts: readonly MavenContactFacts[]) => sha(["maven-intake-facts/v1", facts]);

/** Only what Maven may write to a student: names, date, and a Hebrew name when Maven has one (blank counts as none, so it never clears the portal's). */
const sourceFields = (fact: MavenContactFacts) => ({ firstName: fact.firstName ?? "", lastName: fact.lastName ?? "", ceremonyDate: fact.ceremonyDate,
  ...(fact.hebrewName?.trim() ? { hebrewName: fact.hebrewName } : {}) });
/**
 * A new student's contacts by the kind the rabbi chose. A child's parent address is the household's
 * primary contact (only when that is someone other than the student); an adult is their own contact.
 * Neither creates a guardian: that waits on an invitation the rabbi sends from the portal.
 */
function contactsFor(fact: MavenContactFacts, kind: StudentKind) {
  if (kind === "adult") return { parentEmail: null, ownEmail: fact.contact.email };
  const primary = fact.householdPrimaryContact;
  return { parentEmail: primary && primary.contactId !== fact.sourceRecordId ? primary.email : null, ownEmail: null };
}
/** The full StudentInput a new student is created with; throws AccessDenied when it is not valid. */
export function newStudentValues(fact: MavenContactFacts, kind: StudentKind, serviceSlot: "morning" | "havdalah" | "unknown"): StudentInput {
  return studentInput({ ...sourceFields(fact), studentKind: kind, serviceSlot, ...contactsFor(fact, kind) });
}
/** A linked student's update: Maven's fields over the student's own kind, slot and contacts. Omitted keys are kept. */
export function updatedStudentValues(fact: MavenContactFacts, current: Pick<IntakeStudent, "serviceSlot" | "studentKind" | "parentEmail" | "ownEmail">): StudentInput {
  return studentInput({ ...sourceFields(fact), serviceSlot: current.serviceSlot, studentKind: current.studentKind, parentEmail: current.parentEmail, ownEmail: current.ownEmail });
}
export const contactPresence = (fact: MavenContactFacts) => Object.freeze({
  contactEmailOnFile: fact.contact.email !== null,
  householdPrimaryEmailOnFile: !!fact.householdPrimaryContact?.email && fact.householdPrimaryContact.contactId !== fact.sourceRecordId,
  householdPrimaryIsStudent: fact.householdPrimaryContact?.contactId === fact.sourceRecordId,
});

const snapshotFields = (st: IntakeStudent) => ({ firstName: st.firstName, lastName: st.lastName, ceremonyDate: st.ceremonyDate, studentKind: st.studentKind, serviceSlot: st.serviceSlot,
  parentEmail: st.parentEmail, ownEmail: st.ownEmail, hebrewName: st.hebrewName, secondParentEmail: st.secondParentEmail });
const attempt = <T>(action: () => T): T | null => { try { return action(); } catch { return null; } };
function changedAgainst(fact: MavenContactFacts, st: IntakeStudent): IntakeField[] | null {
  const current = attempt(() => studentInput(snapshotFields(st))), merged = attempt(() => studentInput({ ...snapshotFields(st), ...sourceFields(fact) }));
  if (!current || !merged) return null;
  return MAVEN_INTAKE_FIELDS.filter(field => (current[field] ?? null) !== (merged[field] ?? null));
}
const fits = (fact: MavenContactFacts, st: IntakeStudent) => rehearsalsFit(fact.ceremonyDate, st.rehearsal1, st.rehearsal2);
type Undigested = IntakeRow extends infer R ? R extends unknown ? Omit<R, "digest"> : never : never;
function digestRow(row: Undigested): IntakeRow {
  return Object.freeze({ ...row, digest: sha(["maven-intake-row/v1", row]).slice(0, ROW_DIGEST_LENGTH) }) as IntakeRow;
}

/**
 * The reviewable plan for one decoded Maven result against the tenant's live roster and identities.
 * Rows that cannot enter the planner (no name, a linked student who is disabled, no address for any
 * kind) are reported instead of failing the whole plan. Every row carries a digest of its expected
 * state (kind, student, revision, fields, suggestions): apply compares it row by row.
 */
export function planMavenIntake(input: { tenantId: string; facts: readonly MavenContactFacts[]; students: readonly IntakeStudent[]; identities: readonly IntakeIdentity[] }): IntakePlan {
  const byId = new Map(input.students.map(st => [st.id, st])), linked = new Map(input.identities.map(i => [i.sourceRecordId, i.studentId]));
  const linkedStudents = new Set(input.identities.map(i => i.studentId));
  if (linked.size !== input.identities.length || linkedStudents.size !== input.identities.length || input.identities.some(i => !byId.has(i.studentId))) return { ok: false, code: "invalid-snapshot" };
  const byName = new Map<string, IntakeStudent[]>();
  for (const st of input.students) { const key = rosterNameKey(st.firstName, st.lastName, st.ceremonyDate); byName.set(key, [...(byName.get(key) ?? []), st]); }
  const suggestion = (fact: MavenContactFacts, studentId: string): IntakeSuggestion | null => {
    const st = byId.get(studentId), changedFields = st ? changedAgainst(fact, st) : null;
    return st && changedFields ? Object.freeze({ studentId: st.id, expectedRevision: st.revision, disabled: !!st.disabledAt, linkedElsewhere: linkedStudents.has(st.id), changedFields, rehearsalsFit: fits(fact, st) }) : null;
  };
  const rows: (IntakeRow | undefined)[] = new Array(input.facts.length), batch: { sourceRecordId: string; fields: Record<string, string | null> }[] = [], batchRows: number[] = [];
  const canCreate = new Map<number, StudentKind[]>();
  input.facts.forEach((fact, index) => {
    const row = index + 1, sourceRecordId = fact.sourceRecordId;
    if (!fact.firstName?.trim() || !fact.lastName?.trim()) { rows[index] = digestRow({ row, sourceRecordId, kind: "not-importable", reason: "missing-name" }); return; }
    const studentId = linked.get(sourceRecordId);
    if (studentId) {
      const st = byId.get(studentId)!;
      if (st.disabledAt) { rows[index] = digestRow({ row, sourceRecordId, kind: "linked-student-disabled", studentId }); return; }
      if (!changedAgainst(fact, st)) { rows[index] = digestRow({ row, sourceRecordId, kind: "not-importable", reason: "invalid-field" }); return; }
      batch.push({ sourceRecordId, fields: sourceFields(fact) }); batchRows.push(index); return;
    }
    const kinds = KINDS.filter(kind => attempt(() => newStudentValues(fact, kind, "unknown")));
    canCreate.set(index, kinds);
    if (kinds.length) {
      // The planner validates a whole StudentInput; any creatable kind serves, since a new row's plan depends only on name and date.
      batch.push({ sourceRecordId, fields: { ...sourceFields(fact), studentKind: kinds[0], ...contactsFor(fact, kinds[0]) } }); batchRows.push(index); return;
    }
    // Not creatable as either kind (no usable address, or a field the portal refuses): it can still be linked to a student already in the portal.
    const suggestions = (byName.get(rosterNameKey(fact.firstName, fact.lastName, fact.ceremonyDate)) ?? []).map(st => suggestion(fact, st.id)).filter(s => s !== null)
      .sort((a, b) => a.studentId < b.studentId ? -1 : 1);
    const presence = contactPresence(fact);
    rows[index] = digestRow(suggestions.length ? { row, sourceRecordId, kind: "reconcile", suggestions, canCreateAs: [] }
      : { row, sourceRecordId, kind: "not-importable", reason: presence.contactEmailOnFile || presence.householdPrimaryEmailOnFile ? "invalid-field" : "no-email-on-file" });
  });
  if (batch.length) {
    const plan = planExternalRoster({ version: 1, tenantId: input.tenantId, sourceNamespace: "maven", rows: batch }, {
      version: 1, tenantId: input.tenantId, sourceNamespace: "maven",
      students: input.students.map(st => ({ tenantId: input.tenantId, studentId: st.id, revision: st.revision, disabled: !!st.disabledAt, fields: snapshotFields(st) })),
      identities: input.identities.map(i => ({ tenantId: input.tenantId, sourceNamespace: "maven", sourceRecordId: i.sourceRecordId, studentId: i.studentId })),
    });
    if (!plan.ok) return { ok: false, code: plan.issues[0]?.code ?? "invalid-batch" };
    for (const planned of plan.rows) {
      const index = batchRows[planned.row - 1], fact = input.facts[index], row = index + 1, sourceRecordId = fact.sourceRecordId;
      if (planned.kind === "unchanged") rows[index] = digestRow({ row, sourceRecordId, kind: "unchanged", studentId: planned.studentId, expectedRevision: planned.expectedRevision });
      else if (planned.kind === "update-proposal") {
        const changedFields = planned.changedFields.filter((f: ExternalRosterField): f is IntakeField => (MAVEN_INTAKE_FIELDS as readonly string[]).includes(f));
        rows[index] = digestRow({ row, sourceRecordId, kind: "update", studentId: planned.studentId, expectedRevision: planned.expectedRevision, changedFields, rehearsalsFit: fits(fact, byId.get(planned.studentId)!) });
      } else if (planned.kind === "new-candidate") rows[index] = digestRow({ row, sourceRecordId, kind: "new", canCreateAs: canCreate.get(index) ?? [] });
      else {
        const suggestions = planned.suggestions.map(s => suggestion(fact, s.studentId)).filter(s => s !== null), canCreateAs = canCreate.get(index) ?? [];
        rows[index] = digestRow(suggestions.length ? { row, sourceRecordId, kind: "reconcile", suggestions, canCreateAs } : { row, sourceRecordId, kind: "new", canCreateAs });
      }
    }
  }
  // Spread, not some(): a hole in the sparse array must count as a missing row.
  if (rows.length !== input.facts.length || [...rows].some(row => !row)) return { ok: false, code: "invalid-batch" };
  return { ok: true, rows: Object.freeze(rows as IntakeRow[]) };
}
/** Every row's digest, in order: the plan token's per-row binding. */
export const rowDigests = (rows: readonly IntakeRow[]) => rows.map(row => row.digest).join("");
