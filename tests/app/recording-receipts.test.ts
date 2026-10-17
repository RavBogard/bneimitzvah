import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptConflict, RecordingReceiptLimit } from "../../src/server/recordings/receipts";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as data from "../../src/server/data/recording-receipts";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await accessFixture(); opened.push(f); let clock = Date.now();
  const practice = { ...createPracticeService({ access: f.service }) }, dependencies = { access: f.service, practice, storeGeneration: "synthetic-v1", now: () => clock };
  const service = createRecordingReceiptService(dependencies);
  const mutation = (who: "learner" | "multi" | "admin" = "learner", handle?: string) => { const r = f.request(who); r.headers.set("origin", "http://localhost:3000"); if (handle) r.headers.set("X-Practice-Context", handle); return { ...r, method: "POST" }; };
  const maintenance = createRecordingReceiptTestMaintenance({ transaction: action => f.owner(() => f.db.transaction(action)) });
  return { ...f, practice, dependencies, service, mutation, selected: { mode: "student" as const, studentId: f.students[0].id }, maintenance, clock: (value: number) => { clock = value; },
    heads: () => f.owner(() => f.db.select().from(s.recordingReceipt)), slots: () => f.owner(() => f.db.select().from(s.recordingReceiptSlot)) };
}
const admission = (declaredBytes = 46) => ({ requestId: randomUUID(), declaredBytes });
function slotTarget(row: Awaited<ReturnType<ReturnType<typeof createRecordingReceiptService>["admit"]>>, index = 0) { return { receiptId: row.receiptId, expectedRevision: row.revision, slotIndex: index, expectedSlotRevision: row.slots[index].revision }; }

// All callers here are internal fixtures; no route/runtime/provider composition.
test("idempotent freshly authorized admission reserves exact IDs/slots and no ledger/audit; changed declaration/binding is closed conflict", async () => {
  const f = await fixture(), request = admission(1048578), first = await f.service.admit(f.mutation(), f.selected, request);
  expect(first.slots.map(s => s.expectedBytes)).toEqual([1048576, 2]); expect(first.revision).toBe(1n);
  expect(await f.service.admit(f.mutation(), f.selected, request)).toEqual(first);
  await expect(f.service.admit(f.mutation(), f.selected, { ...request, declaredBytes: 46 })).rejects.toBeInstanceOf(RecordingReceiptConflict);
  expect((await f.heads())[0].relationshipRevision).toBeNull(); expect(await f.heads()).toHaveLength(1);
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toEqual([]); expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual([]);
  for (const value of [{ ...request, storeGeneration: "untrusted" }, { ...request, declaredBytes: 47 }, { ...request, requestId: "invalid" }]) await expect(f.service.admit(f.mutation(), f.selected, value)).rejects.toMatchObject({ status: 400 });
});

test("prepare is immutable and opening is opaque, post-COMMIT, same-factory and single-use; replay cannot issue a second permission", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission());
  const prepared = await f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  expect(prepared.slots[0].revision).toBe(2n);
  expect(await f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(prepared), bodySha256: "a".repeat(64), permitEtag: '"A"' })).toEqual(prepared);
  await expect(f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(prepared), bodySha256: "b".repeat(64), permitEtag: '"A"' })).rejects.toBeInstanceOf(RecordingReceiptConflict);
  const opening = await f.service.openSlot(f.mutation(), f.selected, slotTarget(prepared)); expect(Object.keys(opening)).toEqual([]);
  expect((await f.slots())[0].everUploadOpened).toBe(true);
  const other = createRecordingReceiptService(f.dependencies); expect(() => other.consumeOpening(opening)).toThrow(AccessUnavailable);
  const descriptor = f.service.consumeOpening(opening); expect(descriptor).toMatchObject({ receiptId: row.receiptId, bodySha256: "a".repeat(64), permitEtag: '"A"' });
  expect(() => f.service.consumeOpening(opening)).toThrow(AccessUnavailable); expect(() => f.service.consumeOpening({})).toThrow(AccessUnavailable);
  await expect(f.service.openSlot(f.mutation(), f.selected, slotTarget(prepared))).rejects.toBeInstanceOf(RecordingReceiptConflict);
});

test("known committed opening lost acknowledgement emits no permission; postouter freshness refuses and unknown never becomes conflict", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission()), prepared = await f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const original = f.practice.withPracticeCapability.bind(f.practice), spy = vi.spyOn(f.practice, "withPracticeCapability").mockImplementation(async (...args) => { await original(...args); throw Error("synthetic lost acknowledgement"); });
  let emitted = 0; await expect(f.service.openSlot(f.mutation(), f.selected, slotTarget(prepared)).then(p => { emitted++; return p; })).rejects.toBeInstanceOf(AccessUnavailable);
  expect(emitted).toBe(0); expect((await f.slots())[0].everUploadOpened).toBe(true); spy.mockRestore();
  const second = await f.service.admit(f.mutation(), f.selected, admission()), prep2 = await f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(second), bodySha256: "b".repeat(64), permitEtag: '"B"' });
  vi.spyOn(f.practice, "withPracticeCapability").mockImplementation(async (...args) => { const value = await original(...args); f.clock(Date.parse("2030-01-01T00:00:00Z")); return value; });
  await expect(f.service.openSlot(f.mutation(), f.selected, slotTarget(prep2))).rejects.toMatchObject({ status: 404 });
  expect((await f.slots()).every(s => s.everUploadOpened)).toBe(true);
});

test("student AND actor active/rate admission bounds count retiring and legacy liabilities honestly", async () => {
  const f = await fixture(), rows = [];
  for (let i = 0; i < 2; i++) rows.push(await f.service.admit(f.mutation(), f.selected, admission()));
  await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toBeInstanceOf(RecordingReceiptLimit);
  for (const row of rows) await f.service.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  const third = await f.service.admit(f.mutation(), f.selected, admission()); await f.service.retire(f.mutation(), f.selected, { receiptId: third.receiptId, expectedRevision: third.revision });
  const fourth = await f.service.admit(f.mutation(), f.selected, admission()); await f.service.retire(f.mutation(), f.selected, { receiptId: fourth.receiptId, expectedRevision: fourth.revision });
  await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toBeInstanceOf(RecordingReceiptLimit);
  expect(await f.heads()).toHaveLength(4);
});

test("parent/staff/foreign, revoked own identity and child switch cannot access or adopt unfinished work", async () => {
  const f = await fixture();
  for (const mode of ["parent", "admin", "tutor"] as const) await expect(f.service.admit(f.mutation("multi"), { mode, studentId: f.students[0].id }, admission())).rejects.toMatchObject({ status: 403 });
  await expect(f.service.admit(f.mutation(), { mode: "student", studentId: f.students[3].id }, admission())).rejects.toMatchObject({ status: 404 });
  const entered = await f.practice.enter(f.mutation("multi"), { studentId: f.students[0].id }), selected = { mode: "child-practice" as const, studentId: f.students[0].id }, row = await f.service.admit(f.mutation("multi", entered.handle), selected, admission());
  expect((await f.heads())[0].relationshipRevision).toBeGreaterThan(0);
  await f.practice.switch(f.mutation("multi", entered.handle), { studentId: f.students[1].id });
  await expect(f.service.prepareSlot(f.mutation("multi", entered.handle), selected, { ...slotTarget(row), bodySha256: "a".repeat(64), permitEtag: '"A"' })).rejects.toMatchObject({ status: 404 });
  await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
  await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toMatchObject({ status: 404 });
});

test("never-opened maintenance closes exactly one head; repeated/caught/unawaited/escaped scope rolls back and dates preserve liabilities", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission()), retired = await f.service.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  await expect(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, async x => { await x.closeNeverOpened(x.receipt.revision); try { await x.closeNeverOpened(x.receipt.revision); } catch { /* poison persists */ } })).rejects.toBeInstanceOf(AccessUnavailable);
  expect((await f.heads())[0].state).toBe("retiring");
  let escaped!: (revision: bigint) => Promise<unknown>;
  await expect(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, async x => { escaped = x.closeNeverOpened; void x.closeNeverOpened(x.receipt.revision); })).rejects.toBeInstanceOf(AccessUnavailable);
  await expect(escaped(retired.revision)).rejects.toBeInstanceOf(AccessUnavailable); expect((await f.heads())[0].state).toBe("retiring");
  const terminal = await f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, x => x.closeNeverOpened(x.receipt.revision)); expect(terminal.state).toBe("terminal");
  expect((await f.slots())[0].audioLiabilityReleased).toBe(true);
  await expect(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, x => x.closeNeverOpened(x.receipt.revision))).rejects.toBeInstanceOf(RecordingReceiptConflict);
  const aggregate = data.aggregates; let totals: Awaited<ReturnType<typeof aggregate>> | undefined;
  const spy = vi.spyOn(data, "aggregates").mockImplementation(async (...args) => { const value = await aggregate(...args); totals = value; return value; });
  const next = await f.service.admit(f.mutation(), f.selected, admission()), before = (await f.slots()).find(s => s.receiptId === next.receiptId)!;
  spy.mockRestore();
  expect(totals).toMatchObject({ studentBytes: 0n, studentTakes: 0n, studentMarkerBytes: 64n, tenantMarkerBytes: 64n, studentIds: 1n, studentHour: 1n });
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2000-01-01", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.selected.studentId)));
  const after = (await f.slots()).find(s => s.receiptId === next.receiptId)!; expect(after.expectedBytes).toBe(before.expectedBytes); expect(after.audioLiabilityReleased).toBe(false); expect(after.state).toBe("retiring");
});

test("committed permission is consumed before checking wall-clock freshness and cannot be replayed after refusal", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission()), prepared = await f.service.prepareSlot(f.mutation(), f.selected, { ...slotTarget(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const opening = await f.service.openSlot(f.mutation(), f.selected, slotTarget(prepared));
  f.clock(Date.parse("2030-01-01T00:00:00Z")); expect(() => f.service.consumeOpening(opening)).toThrow(AccessDenied);
  f.clock(Date.now()); expect(() => f.service.consumeOpening(opening)).toThrow(AccessUnavailable);
  expect((await f.slots())[0]).toMatchObject({ everUploadOpened: true, audioLiabilityReleased: false });
});

test("each fixed quota remains bigint-exact and failed admissions cannot consume a UUID or rate charge", async () => {
  const f = await fixture(), aggregate = data.aggregates, request = admission();
  const caps = { studentActive: 2n, actorActive: 2n, tenantActive: 128n, studentHour: 4n, actorHour: 4n, tenantHour: 200n, studentDay: 8n, actorDay: 8n, tenantDay: 512n,
    studentBytes: 10n * 1024n ** 3n, tenantBytes: 256n * 1024n ** 3n, studentTakes: 1000n, tenantTakes: 20000n, studentIds: 4096n, tenantIds: 65536n };
  const spy = vi.spyOn(data, "aggregates");
  for (const [key, value] of Object.entries(caps)) {
    spy.mockImplementationOnce(async (...args) => ({ ...await aggregate(...args), [key]: value }));
    await expect(f.service.admit(f.mutation(), f.selected, request)).rejects.toBeInstanceOf(RecordingReceiptLimit);
  }
  spy.mockRestore(); expect(await f.heads()).toEqual([]);
  expect(await f.service.admit(f.mutation(), f.selected, request)).toMatchObject({ requestId: request.requestId });
});

test("admission query failures and exact-ID/asset collisions cannot be adopted or committed as own conflicts", async () => {
  const f = await fixture();
  vi.spyOn(data, "aggregates").mockRejectedValueOnce(Error("synthetic query failure")); await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toBeInstanceOf(AccessUnavailable); expect(await f.heads()).toEqual([]);
  vi.spyOn(data, "collision").mockResolvedValueOnce(true); await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toBeInstanceOf(RecordingReceiptConflict); expect(await f.heads()).toEqual([]);
});
