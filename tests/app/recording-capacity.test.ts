import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict, RecordingRegistrationLimit } from "../../src/server/recordings/registration";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance } from "../../src/server/recordings/receipts";
import { RECORDING_CAPACITY, withinRecordingCapacity, type RecordingCapacity } from "../../src/server/recordings/capacity";
import type { VerifiedRecordingDescriptor } from "../../src/server/recordings/validation";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as admission from "../../src/server/data/recording-receipts";
import * as data from "../../src/server/data/recordings";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const descriptor = (byteLength = 100): VerifiedRecordingDescriptor => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus", byteLength, durationMs: 100 } });
async function fixture() {
  const f = await accessFixture(); opened.push(f); let now = Date.now();
  const deps = { access: f.service, practice: createPracticeService({ access: f.service }), now: () => now };
  const registrar = createStudentRecordingRegistrar(deps), selected = { mode: "student" as const, studentId: f.students[0].id };
  const request = () => { const r = f.request("learner"); r.headers.set("origin", "http://localhost:3000"); return { ...r, method: "POST" }; };
  return { ...f, registrar, selected, request, clock: (v: number) => { now = v; }, receipts: createRecordingReceiptService({ ...deps, storeGeneration: "capacity-v1" }),
    exact: (id: string, value: ReturnType<typeof descriptor>) => registrar.withRegistrationAuthority(request(), selected, x => x.registerVerified(id, value)),
    rows: () => f.owner(() => f.db.select().from(s.studentRecording)), audits: () => f.owner(() => f.db.select().from(s.auditEvent)) };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, count: number, bytes = 100) {
  await f.owner(async () => { for (let i = 0; i < count; i += 200) await f.db.insert(s.studentRecording).values(Array.from({ length: Math.min(count - i, 200) }, () => ({ id: randomUUID(), tenantId: "crc", studentId: f.selected.studentId, assetId: randomUUID(), contentSha256: "b".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: bytes, durationMs: 100, state: "private" as const, revision: 1, createdAt: new Date() }))); });
}

test("retained capacity has independent exact bigint student and tenant boundaries without receipt-rate attribution", () => {
  const zero: RecordingCapacity = { studentBytes: 0n, tenantBytes: 0n, studentTakes: 0n, tenantTakes: 0n, studentIds: 0n, tenantIds: 0n };
  for (const key of Object.keys(RECORDING_CAPACITY) as (keyof RecordingCapacity)[]) {
    const increment = key.endsWith("Bytes") ? 46n : 1n, last = { ...zero, [key]: RECORDING_CAPACITY[key] - increment };
    expect(withinRecordingCapacity(last, 46)).toBe(true);
    expect(withinRecordingCapacity({ ...last, [key]: last[key] + 1n }, 46)).toBe(false);
  }
  expect(withinRecordingCapacity({ ...zero, tenantBytes: 9007199254740993n }, 46)).toBe(false);
});

test("actual deleting ledger bytes fill the student cap and neither registrar path inserts or audits above it", async () => {
  const f = await fixture(); await seed(f, 320, 33554432);
  await f.owner(() => f.db.update(s.studentRecording).set({ state: "deleting", revision: 2, deletionRequestedAt: new Date() }));
  await expect(f.registrar.register(f.request(), f.selected, descriptor())).rejects.toBeInstanceOf(RecordingRegistrationLimit);
  await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(RecordingRegistrationLimit);
  expect(await f.rows()).toHaveLength(320); expect(await f.audits()).toEqual([]);
});

test("exact asset and original-ID replays above historical take capacity remain single-charge and audit-once", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor(), first = await f.exact(id, value);
  await seed(f, 1000);
  expect(await f.exact(id, value)).toEqual(first); expect(await f.registrar.register(f.request(), f.selected, value)).toEqual(first);
  await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(RecordingRegistrationLimit);
  expect(await f.rows()).toHaveLength(1001); expect((await f.audits()).map(x => x.action)).toEqual(["recording.create"]);
});

test("receipt ID or asset reservations refuse new registration and privileged historical exact replay, even terminal reservations", async () => {
  const f = await fixture(), head = await f.receipts.admit(f.request(), f.selected, { requestId: randomUUID(), declaredBytes: 46 });
  const value = { ...descriptor(), assetId: head.assetId };
  await expect(f.exact(head.originalRecordingId, descriptor())).rejects.toBeInstanceOf(RecordingRegistrationConflict);
  expect(await f.registrar.register(f.request(), f.selected, value)).toEqual({ ok: false, code: "conflict" });
  const retired = await f.receipts.retire(f.request(), f.selected, { receiptId: head.receiptId, expectedRevision: head.revision });
  await createRecordingReceiptTestMaintenance({ transaction: action => f.owner(() => f.db.transaction(action)) })
    .withHead({ tenantId: "crc", receiptId: head.receiptId }, x => x.closeNeverOpened(retired.revision));
  // Privileged historical overlap is outside the application-writer invariant.
  await f.owner(() => f.db.insert(s.studentRecording).values({ id: head.originalRecordingId, tenantId: "crc", studentId: f.selected.studentId, assetId: value.assetId, contentSha256: value.contentSha256, ...value.media, state: "private", revision: 1, createdAt: new Date() }));
  await expect(f.exact(head.originalRecordingId, value)).rejects.toBeInstanceOf(RecordingRegistrationConflict);
  expect(await f.registrar.register(f.request(), f.selected, value)).toEqual({ ok: false, code: "conflict" });
  expect(await f.audits()).toEqual([]); expect(await f.rows()).toHaveLength(1);
});

test("one planned ID is checked before one INSERT; failed INSERT never looks up/adopts or regenerates another identity", async () => {
  const f = await fixture(), reserved = vi.spyOn(admission, "reserved"), insert = vi.spyOn(data, "insertWithId").mockResolvedValue(null), lookup = vi.spyOn(data, "registrationRow");
  expect(await f.registrar.register(f.request(), f.selected, descriptor())).toEqual({ ok: false, code: "conflict" });
  expect(reserved).toHaveBeenCalledTimes(1); expect(insert).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls[0][2]).toBe(reserved.mock.calls[0][2]); expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
});

test("caught limit poisons caller work, arbitrary auth/SQL/audit errors are never translated to limits, and postaggregate expiry rolls back", async () => {
  const f = await fixture(), original = admission.aggregates, spy = vi.spyOn(admission, "aggregates");
  spy.mockImplementationOnce(async (...args) => ({ ...await original(...args), studentTakes: 1000n }));
  await expect(f.registrar.withRegistrationAuthority(f.request(), f.selected, async x => {
    await data.audit(x.tx, x.actor, "delete-request", randomUUID());
    try { await x.registerVerified(randomUUID(), descriptor()); } catch { /* Cannot clear poison. */ }
  })).rejects.toBeInstanceOf(RecordingRegistrationLimit);
  for (const status of [401, 403, 404] as const) { spy.mockRejectedValueOnce(new AccessDenied(status)); await expect(f.exact(randomUUID(), descriptor())).rejects.toMatchObject({ status }); }
  spy.mockRejectedValueOnce(Object.assign(Error("Synthetic query detail"), { code: "23505" }));
  await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(AccessUnavailable);
  spy.mockImplementationOnce(async (...args) => { const value = await original(...args); f.clock(Date.parse("2030-01-01T00:00:00Z")); return value; });
  await expect(f.exact(randomUUID(), descriptor())).rejects.toMatchObject({ status: 404 }); f.clock(Date.now()); spy.mockRestore();
  vi.spyOn(data, "audit").mockRejectedValueOnce(Error("Synthetic audit detail")); await expect(f.exact(randomUUID(), descriptor())).rejects.toBeInstanceOf(AccessUnavailable);
  expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
});
