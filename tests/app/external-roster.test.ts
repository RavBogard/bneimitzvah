import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { planExternalRoster, type ExternalRosterBatch, type ExternalRosterFields, type ExternalRosterSnapshot } from "../../src/server/students/external-roster";
import type { StudentInput } from "../../src/server/students/validation";
import type { ServiceSlot } from "../../src/lib/readings/reading-date";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const fields = (patch: Partial<StudentInput> = {}): StudentInput => ({ firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", studentKind: "child", serviceSlot: "morning", parentEmail: "synthetic-parent@example.test", ownEmail: null, ...patch });
const student = (number = 1, patch: Partial<StudentInput> = {}, disabled = false) => ({ tenantId: "crc", studentId: id(number), revision: number + 1, disabled, fields: fields(patch) });
const identity = (sourceRecordId = "synthetic-source-1", number = 1) => ({ tenantId: "crc", sourceNamespace: "maven.bnai-mitzvah", sourceRecordId, studentId: id(number) });
const record = (patch: Partial<ExternalRosterFields> = {}, sourceRecordId = "synthetic-source-1") => ({ sourceRecordId, fields: { firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02", parentEmail: "synthetic-parent@example.test", ...patch } });
const batch = (rows: ExternalRosterBatch["rows"] = [record()]): ExternalRosterBatch => ({ version: 1, tenantId: "crc", sourceNamespace: "maven.bnai-mitzvah", rows });
const snapshot = (students: ExternalRosterSnapshot["students"] = [student()], identities: ExternalRosterSnapshot["identities"] = [identity()]): ExternalRosterSnapshot => ({ version: 1, tenantId: "crc", sourceNamespace: "maven.bnai-mitzvah", students, identities });
const bad = (code: string, row = 0) => ({ ok: false, version: 1, issues: [{ row, code }] });
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("stable namespaced identity retains the same student and revision when mutable facts change", () => {
  expect(planExternalRoster(batch([record({ firstName: "Changed", lastName: "Name", ceremonyDate: "2028-02-05", parentEmail: "changed-parent@example.test" })]), snapshot())).toEqual({
    ok: true, version: 1, rows: [{ row: 1, kind: "update-proposal", studentId: id(1), expectedRevision: 2, changedFields: ["firstName", "lastName", "ceremonyDate", "parentEmail"] }],
  });
});

test("omitted update fields preserve kind, slot and all optional contacts/names", () => {
  const current = student(1, { studentKind: "adult", serviceSlot: "havdalah", ownEmail: "synthetic-adult@example.test", parentEmail: null, hebrewName: "שֵׁם", secondParentEmail: "synthetic-second@example.test" });
  const incoming = { sourceRecordId: "synthetic-source-1", fields: { firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-02" } };
  expect(planExternalRoster(batch([incoming]), snapshot([current]))).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "unchanged", studentId: id(1), expectedRevision: 2 }] });
});

test("explicit nullable fields clear only where existing student validation permits", () => {
  const current = student(1, { studentKind: "adult", ownEmail: "synthetic-adult@example.test", hebrewName: "שֵׁם", secondParentEmail: "synthetic-second@example.test" });
  expect(planExternalRoster(batch([record({ parentEmail: null, hebrewName: null, secondParentEmail: null })]), snapshot([current]))).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "update-proposal", studentId: id(1), expectedRevision: 2, changedFields: ["parentEmail", "hebrewName", "secondParentEmail"] }] });
  expect(planExternalRoster(batch([record({ ownEmail: null })]), snapshot([current]))).toEqual(bad("invalid-row", 1));
  expect(planExternalRoster(batch([record({ parentEmail: null })]), snapshot())).toEqual(bad("invalid-row", 1));
});

test("new candidates use existing child/contact and missing-slot defaults without inventing fields", () => {
  const empty = snapshot([], []);
  expect(planExternalRoster(batch(), empty)).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "new-candidate" }] });
  const { parentEmail: _omitted, ...withoutParent } = record().fields;
  expect(planExternalRoster(batch([{ sourceRecordId: "new", fields: withoutParent }]), empty)).toEqual(bad("invalid-row", 1));
  expect(planExternalRoster(batch([record({ studentKind: "adult", parentEmail: null, ownEmail: "synthetic-adult@example.test" })]), empty)).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "new-candidate" }] });
  expect(planExternalRoster(batch([record({ studentKind: "adult", ownEmail: null })]), empty)).toEqual(bad("invalid-row", 1));
});

test("the actual ServiceSlot contract validates both snapshots and explicit updates", () => {
  const slots: ServiceSlot[] = ["morning", "havdalah", "unknown"];
  for (const serviceSlot of slots) {
    expect(planExternalRoster(batch([record()]), snapshot([student(1, { serviceSlot })]))).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "unchanged", studentId: id(1), expectedRevision: 2 }] });
    expect(planExternalRoster(batch([record({ serviceSlot })]), snapshot([], [])).ok).toBe(true);
  }
  expect(planExternalRoster(batch([record({ serviceSlot: "friday-evening" as ServiceSlot })]), snapshot())).toEqual(bad("invalid-row", 1));
  expect(planExternalRoster(batch(), snapshot([student(1, { serviceSlot: "other" as ServiceSlot })]))).toEqual(bad("invalid-snapshot"));
});

test("unlinked name/date collisions are sorted suggestions only, including disabled students", () => {
  const incoming = record({ firstName: "  Ｓｙｎｔｈｅｔｉｃ  ", lastName: "LEARNER" }, "unlinked");
  expect(planExternalRoster(batch([incoming]), snapshot([student(2, {}, true), student(1)], []))).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "reconciliation-required", suggestions: [
    { studentId: id(1), expectedRevision: 2, disabled: false }, { studentId: id(2), expectedRevision: 3, disabled: true },
  ] }] });
  for (const patch of [{ ceremonyDate: "2027-01-09" }, { lastName: "Different" }]) expect(planExternalRoster(batch([record(patch, "unlinked")]), snapshot())).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "new-candidate" }] });
});

test("equal mutable facts with distinct source IDs never establish or change an identity", () => {
  expect(planExternalRoster(batch([record(), record({}, "another-source")]), snapshot())).toEqual({ ok: true, version: 1, rows: [
    { row: 1, kind: "unchanged", studentId: id(1), expectedRevision: 2 },
    { row: 2, kind: "reconciliation-required", suggestions: [{ studentId: id(1), expectedRevision: 2, disabled: false }] },
  ] });
});

test("source IDs stay opaque and case-sensitive rather than being trimmed or normalized", () => {
  expect(planExternalRoster(batch([record({}, "SOURCE"), record({}, "source")]), snapshot([student()], [identity("SOURCE")]))).toMatchObject({ ok: true, rows: [{ kind: "unchanged" }, { kind: "reconciliation-required" }] });
  expect(planExternalRoster(batch([record({}, "é"), record({}, "e\u0301")]), snapshot([student()], [identity("é")]))).toMatchObject({ ok: true, rows: [{ kind: "unchanged" }, { kind: "reconciliation-required" }] });
  for (const sourceRecordId of ["", " leading", "trailing ", "control\n", "\u0000"]) expect(planExternalRoster(batch([record({}, sourceRecordId)]), snapshot())).toEqual(bad("invalid-row", 1));
});

test("every duplicate incoming ID is flagged and no partial plan or first winner escapes", () => {
  const result = planExternalRoster(batch([record(), record({}, "other"), record({ firstName: "Changed" })]), snapshot());
  expect(result).toEqual({ ok: false, version: 1, issues: [{ row: 1, code: "duplicate-source-id" }, { row: 3, code: "duplicate-source-id" }] });
  expect(planExternalRoster(batch([record({ firstName: "Changed" }), record()]), snapshot())).toEqual({ ok: false, version: 1, issues: [{ row: 1, code: "duplicate-source-id" }, { row: 2, code: "duplicate-source-id" }] });
  expect(planExternalRoster(batch([record(), { sourceRecordId: "synthetic-source-1", fields: {} } as never]), snapshot())).toEqual({ ok: false, version: 1, issues: [{ row: 1, code: "duplicate-source-id" }, { row: 2, code: "invalid-row" }, { row: 2, code: "duplicate-source-id" }] });
});

test("malformed, duplicate, foreign or many-to-one identity snapshots never select a winner", () => {
  const invalid = [
    snapshot([student()], [identity(), identity()]),
    snapshot([student()], [identity(), identity("alias")]),
    snapshot([student(), student(2)], [identity(), identity("synthetic-source-1", 2)]),
    snapshot([student()], [identity("orphan", 2)]),
    snapshot([student()], [{ ...identity(), tenantId: "another-tenant" }]),
    snapshot([student()], [{ ...identity(), sourceNamespace: "another-source" }]),
    snapshot([student()], [{ ...identity(), studentId: "not-a-uuid" }]),
    snapshot([student(), student()], []),
    snapshot([{ ...student(), tenantId: "another-tenant" }], []),
    snapshot([{ ...student(), revision: 0 }], []),
    snapshot([{ ...student(), revision: Number.MAX_SAFE_INTEGER + 1 }], []),
    snapshot([{ ...student(), disabled: "false" } as never], []),
    snapshot([student(1, { parentEmail: null })], []),
  ];
  for (const input of invalid) expect(planExternalRoster(batch(), input)).toEqual(bad("invalid-snapshot"));
});

test("linked disabled students refuse without reactivation or partial candidates", () => {
  expect(planExternalRoster(batch([record(), record({}, "new")]), snapshot([student(1, {}, true)]))).toEqual(bad("linked-student-disabled", 1));
});

test("tenant and source scopes must be valid and exactly equal", () => {
  for (const patch of [{ tenantId: "other" }, { sourceNamespace: "other" }]) expect(planExternalRoster({ ...batch(), ...patch }, snapshot())).toEqual(bad("scope-mismatch"));
  for (const patch of [{ tenantId: "" }, { tenantId: "a".repeat(65) }, { sourceNamespace: "Uppercase" }, { sourceNamespace: "source/path" }, { sourceNamespace: "s".repeat(65) }]) {
    expect(planExternalRoster({ ...batch(), ...patch }, snapshot())).toEqual(bad("invalid-batch"));
    expect(planExternalRoster(batch(), { ...snapshot(), ...patch })).toEqual(bad("invalid-snapshot"));
  }
  const scope = { tenantId: "a".repeat(64), sourceNamespace: "s".repeat(64) };
  expect(planExternalRoster({ ...batch(), ...scope }, { ...snapshot([], []), ...scope }).ok).toBe(true);
});

test("closed versioned envelopes and nested records reject unknown/non-JSON fields", () => {
  for (const input of [null, [], { ...batch(), version: 2 }, { ...batch(), ignored: true }, { ...batch(), rows: [] }]) expect(planExternalRoster(input, snapshot())).toEqual(bad("invalid-batch"));
  for (const input of [null, [], { ...snapshot(), version: 2 }, { ...snapshot(), ignored: true }]) expect(planExternalRoster(batch(), input)).toEqual(bad("invalid-snapshot"));
  for (const input of [
    { ...record(), ignored: true }, { ...record(), fields: { ...record().fields, notes: "private note" } },
    { ...record(), fields: { ...record().fields, ownEmail: undefined } }, { ...record(), fields: { ...record().fields, firstName: 123 } },
    { ...record(), fields: { ...record().fields, ceremonyDate: null } }, { ...record(), fields: new Date() },
  ]) expect(planExternalRoster({ ...batch(), rows: [input] }, snapshot())).toEqual(bad("invalid-row", 1));
  expect(planExternalRoster(batch(), snapshot([{ ...student(), ignored: true } as never]))).toEqual(bad("invalid-snapshot"));
  expect(planExternalRoster(batch(), snapshot([student()], [{ ...identity(), ignored: true } as never]))).toEqual(bad("invalid-snapshot"));
  const { serviceSlot: _omitted, ...incomplete } = fields();
  expect(planExternalRoster(batch(), snapshot([{ ...student(), fields: incomplete } as never]))).toEqual(bad("invalid-snapshot"));
});

test("accessors, prototype instances, symbol keys, sparse or decorated arrays are refused without execution", () => {
  const getter = vi.fn(() => "crc"), accessor = { ...batch() };
  Object.defineProperty(accessor, "tenantId", { enumerable: true, get: getter });
  expect(planExternalRoster(accessor, snapshot())).toEqual(bad("invalid-batch")); expect(getter).not.toHaveBeenCalled();
  const symbol = { ...batch(), [Symbol("hidden")]: "secret" };
  expect(planExternalRoster(symbol, snapshot())).toEqual(bad("invalid-batch"));
  class Envelope { version = 1; tenantId = "crc"; sourceNamespace = "maven.bnai-mitzvah"; rows = [record()]; }
  expect(planExternalRoster(new Envelope(), snapshot())).toEqual(bad("invalid-batch"));
  for (const rows of [new Array(1), Object.assign([record()], { extra: "secret" }), Object.assign([record()], { toJSON: getter })]) expect(planExternalRoster({ ...batch(), rows }, snapshot())).toEqual(bad("invalid-batch"));
  expect(getter).not.toHaveBeenCalled();
});

test("existing date, kind, contact and Hebrew validation remain authoritative", () => {
  for (const patch of [
    { ceremonyDate: "2027-02-30" }, { studentKind: "inferred" }, { parentEmail: "not-an-email" },
    { ownEmail: "synthetic-parent@example.test" }, { hebrewName: "<unsafe>" }, { secondParentEmail: "not-an-email" },
  ]) expect(planExternalRoster(batch([record(patch as never)]), snapshot())).toEqual(bad("invalid-row", 1));
  expect(planExternalRoster(batch([record({ parentEmail: " SYNTHETIC-PARENT@EXAMPLE.TEST " })]), snapshot())).toMatchObject({ ok: true, rows: [{ kind: "unchanged" }] });
  expect(planExternalRoster(batch([record({ hebrewName: null, secondParentEmail: null })]), snapshot())).toMatchObject({ ok: true, rows: [{ kind: "unchanged" }] });
});

test("strict row and trusted-snapshot counts accept maxima and refuse excess", () => {
  const rows = Array.from({ length: 500 }, (_, index) => record({ firstName: `Synthetic${index}` }, `source-${index}`));
  expect(planExternalRoster(batch(rows), snapshot([], [])).ok).toBe(true);
  expect(planExternalRoster(batch([...rows, record()]), snapshot([], []))).toEqual(bad("invalid-batch"));
  const students = Array.from({ length: 5000 }, (_, index) => student(index + 1, { firstName: `Synthetic${index}` }));
  const identities = students.map((_, index) => identity(`source-${index}`, index + 1));
  expect(planExternalRoster(batch([record({}, "new")]), snapshot(students, identities)).ok).toBe(true);
  expect(planExternalRoster(batch(), snapshot([...students, student(5001)], []))).toEqual(bad("invalid-snapshot"));
  expect(planExternalRoster(batch(), snapshot(students, [...identities, identity("extra")]))).toEqual(bad("invalid-snapshot"));
});

test("aggregate UTF-8 byte boundaries are exact with every raw cell independently bounded", () => {
  function pad(rows: { fields: { firstName: string; lastName: string } }[], remaining: number) {
    for (const row of rows) for (const field of ["firstName", "lastName"] as const) {
      const extra = Math.min(2048 - Buffer.byteLength(row.fields[field]), remaining);
      row.fields[field] = " ".repeat(extra) + row.fields[field]; remaining -= extra;
    }
    expect(remaining).toBe(0);
  }
  function sizedBatch(bytes: number) {
    const rows = Array.from({ length: 500 }, (_, index) => record({}, `source-${index}`)), value = batch(rows);
    pad(rows, bytes - Buffer.byteLength(JSON.stringify(value))); return value;
  }
  function sizedSnapshot(bytes: number) {
    const students = Array.from({ length: 5000 }, (_, index) => student(index + 1)), value = snapshot(students, []);
    pad(students, bytes - Buffer.byteLength(JSON.stringify(value))); return value;
  }
  const limit = 1024 * 1024, maximum = sizedBatch(limit), maximumSnapshot = sizedSnapshot(8 * limit);
  expect(Buffer.byteLength(JSON.stringify(maximum))).toBe(limit);
  expect(planExternalRoster(maximum, snapshot([], [])).ok).toBe(true);
  expect(planExternalRoster(sizedBatch(limit + 1), snapshot([], []))).toEqual(bad("invalid-batch"));
  expect(Buffer.byteLength(JSON.stringify(maximumSnapshot))).toBe(8 * limit);
  expect(planExternalRoster(batch(), maximumSnapshot).ok).toBe(true);
  expect(planExternalRoster(batch(), sizedSnapshot(8 * limit + 1))).toEqual(bad("invalid-snapshot"));
});

test("opaque source IDs use UTF-8 bytes and preserve UUID identity independently of hex case", () => {
  expect(planExternalRoster(batch([record({}, "é".repeat(128))]), snapshot([], [])).ok).toBe(true);
  expect(planExternalRoster(batch([record({}, "é".repeat(129))]), snapshot([], []))).toEqual(bad("invalid-row", 1));
  const uppercase = "ABCDEFAB-0000-4000-8000-000000000001", lowercase = uppercase.toLowerCase();
  expect(planExternalRoster(batch(), snapshot([{ ...student(), studentId: uppercase }], [{ ...identity(), studentId: lowercase }]))).toMatchObject({ ok: true, rows: [{ kind: "unchanged", studentId: lowercase }] });
});

test("ill-formed UTF-16 identities refuse before a lossy UTF-8 round trip", () => {
  for (const sourceRecordId of ["\ud800", "\udfff", "id\ud800suffix", "id\udfff\ud800"]) {
    expect(planExternalRoster(batch([record({}, sourceRecordId)]), snapshot())).toEqual(bad("invalid-row", 1));
    expect(planExternalRoster(batch(), snapshot([student()], [identity(sourceRecordId)]))).toEqual(bad("invalid-snapshot"));
  }
  expect(planExternalRoster(batch([record({}, "id😀")]), snapshot([student()], [identity("id😀")]))).toMatchObject({ ok: true, rows: [{ kind: "unchanged" }] });
});

test("raw scalar bounds precede serialization and normalization without calling hooks", () => {
  const stringify = vi.spyOn(JSON, "stringify"), hook = vi.fn();
  for (const patch of [{ firstName: " ".repeat(2049) + "Synthetic" }, { lastName: " ".repeat(2049) + "Learner" }, { hebrewName: " ".repeat(2049) + "שֵׁם" }, { firstName: "א".repeat(1025) }]) {
    const value = batch([record(patch)]);
    expect(planExternalRoster(value, snapshot())).toEqual(bad("invalid-row", 1));
    expect(stringify.mock.calls.some(([argument]) => argument === value)).toBe(false);
    const current = snapshot([student(1, patch)]);
    expect(planExternalRoster(batch(), current)).toEqual(bad("invalid-snapshot"));
    expect(stringify.mock.calls.some(([argument]) => argument === current)).toBe(false);
  }
  const decorated = { ...record().fields, firstName: " ".repeat(2049), toJSON: hook };
  expect(planExternalRoster({ ...batch(), rows: [{ ...record(), fields: decorated }] }, snapshot())).toEqual(bad("invalid-row", 1));
  expect(hook).not.toHaveBeenCalled();
  expect(planExternalRoster(batch([record({ firstName: " ".repeat(2048 - 9) + "Synthetic" })]), snapshot()).ok).toBe(true);
});

test("throwing and revoked proxy shapes yield generic closed failures without diagnostics", () => {
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const secret = "Do not echo diagnostic";
  const throwing = new Proxy({}, { ownKeys() { throw new Error(secret); } });
  const throwingRead = new Proxy(batch(), { get() { throw new Error(secret); } });
  for (const value of [revoked.proxy, throwing, throwingRead]) {
    expect(planExternalRoster(value, snapshot())).toEqual(bad("invalid-batch"));
    expect(planExternalRoster(batch(), value)).toEqual(bad("invalid-snapshot"));
  }
  expect(planExternalRoster(batch(), snapshot([revoked.proxy as never], []))).toEqual(bad("invalid-snapshot"));
});

test("deterministic planning preserves deeply frozen inputs and never calls I/O", () => {
  const forbidden = vi.fn(() => { throw new Error("Network forbidden"); }); vi.stubGlobal("fetch", forbidden);
  const input = freeze(batch([record({}, "unlinked"), record({ ceremonyDate: "2027-01-09" })]));
  const current = freeze(snapshot([student(2), student(1)], [identity()]));
  const before = JSON.stringify([input, current]);
  const first = planExternalRoster(input, current);
  expect(planExternalRoster(input, current)).toEqual(first);
  expect(planExternalRoster(input, snapshot([...current.students].reverse(), [...current.identities].reverse()))).toEqual(first);
  expect(JSON.stringify([input, current])).toBe(before); expect(forbidden).not.toHaveBeenCalled();
});

test("results expose action metadata only and row/code failures never echo private values", () => {
  const current = snapshot([student(1, { hebrewName: "שֵׁם", secondParentEmail: "synthetic-second@example.test" })]);
  const result = planExternalRoster(batch([record({ parentEmail: "private-contact@example.test", hebrewName: "אַחֵר" })]), current);
  expect(result).toEqual({ ok: true, version: 1, rows: [{ row: 1, kind: "update-proposal", studentId: id(1), expectedRevision: 2, changedFields: ["parentEmail", "hebrewName"] }] });
  expect(JSON.stringify(result)).not.toMatch(/@|Synthetic|Learner|2027|שֵׁם|אַחֵר|source-1/);
  const failure = planExternalRoster({ ...batch(), rows: [{ ...record(), fields: { ...record().fields, notes: "Secret private note" } }] }, current);
  expect(failure).toEqual(bad("invalid-row", 1)); expect(JSON.stringify(failure)).not.toMatch(/Secret|@|source-1/);
});
