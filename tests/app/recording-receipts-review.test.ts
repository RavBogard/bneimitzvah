import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptConflict } from "../../src/server/recordings/receipts";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as data from "../../src/server/data/recording-receipts";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await accessFixture(); opened.push(f);
  const practice = createPracticeService({ access: f.service }), dependencies = { access: f.service, practice, storeGeneration: "review-v1" };
  const service = createRecordingReceiptService(dependencies), selected = { mode: "student" as const, studentId: f.students[0].id };
  const mutation = (who: "learner" | "multi" = "learner", handle?: string) => { const r = f.request(who); r.headers.set("origin", "http://localhost:3000"); if (handle) r.headers.set("X-Practice-Context", handle); return { ...r, method: "POST" }; };
  return { ...f, practice, dependencies, service, selected, mutation,
    maintenance: createRecordingReceiptTestMaintenance({ transaction: action => f.owner(() => f.db.transaction(action)) }),
    heads: () => f.owner(() => f.db.select().from(s.recordingReceipt)), slots: () => f.owner(() => f.db.select().from(s.recordingReceiptSlot)) };
}
const admission = (declaredBytes = 46) => ({ requestId: randomUUID(), declaredBytes });
const target = (r: Awaited<ReturnType<ReturnType<typeof createRecordingReceiptService>["admit"]>>) => ({ receiptId: r.receiptId, expectedRevision: r.revision, slotIndex: 0, expectedSlotRevision: r.slots[0].revision });

test("review exact replay cannot renew session, store generation or student revision and does not charge a replay", async () => {
  const f = await fixture(), request = admission(), first = await f.service.admit(f.mutation(), f.selected, request);
  for (let i = 0; i < 5; i++) expect(await f.service.admit(f.mutation(), f.selected, request)).toEqual(first);
  await expect(createRecordingReceiptService({ ...f.dependencies, storeGeneration: "other-v1" }).admit(f.mutation(), f.selected, request)).rejects.toBeInstanceOf(RecordingReceiptConflict);
  const login = await f.signIn("learner@example.test"), secondSession = f.mutation(); secondSession.headers.set("cookie", login.cookie);
  await expect(f.service.admit(secondSession, f.selected, request)).rejects.toBeInstanceOf(RecordingReceiptConflict);
  expect(await f.service.admit(f.mutation(), f.selected, request)).toEqual(first);
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2027-01-03", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.selected.studentId)));
  await expect(f.service.admit(f.mutation(), f.selected, request)).rejects.toBeInstanceOf(RecordingReceiptConflict);
  await expect(f.service.prepareSlot(f.mutation(), f.selected, { ...target(first), bodySha256: "a".repeat(64), permitEtag: '"A"' })).rejects.toMatchObject({ status: 404 });
  expect(await f.heads()).toHaveLength(1); expect((await f.heads())[0].relationshipRevision).toBeNull();
  expect((await f.slots())[0]).toMatchObject({ state: "reserved", revision: 1n });
});

test("review original child-context lifetime cannot be adopted by another live handle or a stronger selected role", async () => {
  const f = await fixture(), child = { mode: "child-practice" as const, studentId: f.selected.studentId };
  const context = await f.practice.enter(f.mutation("multi"), { studentId: f.selected.studentId }), request = admission();
  const first = await f.service.admit(f.mutation("multi", context.handle), child, request);
  const next = await f.practice.enter(f.mutation("multi"), { studentId: f.selected.studentId });
  await expect(f.service.admit(f.mutation("multi", next.handle), child, request)).rejects.toBeInstanceOf(RecordingReceiptConflict);
  await expect(f.service.openSlot(f.mutation("multi", next.handle), child, target(first))).rejects.toMatchObject({ status: 404 });
  for (const mode of ["parent", "tutor", "admin"] as const) await expect(f.service.admit(f.mutation("multi", next.handle), { mode, studentId: f.selected.studentId }, request)).rejects.toMatchObject({ status: 403 });
  expect(await f.heads()).toHaveLength(1); expect((await f.heads())[0]).toMatchObject({ mode: "child-practice", contextId: context.context.id, relationshipRevision: 1 });
});

test("review primary aggregates retain terminal IDs/markers/rates and charge deleting legacy rows without adopting collisions", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission(1048578));
  const retired = await f.service.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  await f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, x => x.closeNeverOpened(retired.revision));
  await f.owner(async () => {
    await f.db.insert(s.studentRecording).values([{ id: row.originalRecordingId, tenantId: "crc", studentId: f.selected.studentId, assetId: row.assetId, contentSha256: "a".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 10, state: "private", revision: 1, createdAt: new Date() }, { id: randomUUID(), tenantId: "crc", studentId: f.selected.studentId, assetId: randomUUID(), contentSha256: "b".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 200, durationMs: 10, state: "private", revision: 1, createdAt: new Date() }]);
    await f.db.update(s.studentRecording).set({ state: "deleting", revision: 2, deletionRequestedAt: new Date() }).where(eq(s.studentRecording.byteLength, 200));
  });
  const totals = await f.practice.withPracticeCapability(f.mutation(), { ...f.selected, capability: "practice-write" }, async (tx, actor) => { await data.mutex(tx, actor.tenantId, () => {}); return data.aggregates(tx, actor, await data.clock(tx), () => {}); });
  expect(totals).toMatchObject({ studentActive: 0n, actorActive: 0n, studentHour: 1n, studentDay: 1n, studentBytes: 300n, tenantBytes: 300n, studentTakes: 2n, tenantTakes: 2n, studentIds: 2n, tenantIds: 2n, studentMarkerBytes: 128n, tenantMarkerBytes: 128n });
  await expect(f.service.admit(f.mutation(), f.selected, { requestId: row.requestId, declaredBytes: row.declaredBytes })).rejects.toBeInstanceOf(RecordingReceiptConflict);
  expect((await f.heads())[0]).toMatchObject({ state: "terminal", logicalTakeReleased: true });
});

test("review ordinary auth/SQL errors never become the service's own collision bridge", async () => {
  const f = await fixture(), original = data.aggregates, spy = vi.spyOn(data, "aggregates");
  for (const status of [401, 403, 404] as const) { spy.mockRejectedValueOnce(new AccessDenied(status)); await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toMatchObject({ status }); }
  spy.mockRejectedValueOnce(Object.assign(Error("synthetic-private-query-detail"), { code: "23505" }));
  await expect(f.service.admit(f.mutation(), f.selected, admission())).rejects.toBeInstanceOf(AccessUnavailable);
  spy.mockImplementation(original); expect(await f.heads()).toEqual([]);
  expect(await f.service.admit(f.mutation(), f.selected, admission())).toMatchObject({ state: "receiving" });
});

test("review callback failure after complete maintenance SQL still rolls back every released fact", async () => {
  const f = await fixture(), row = await f.service.admit(f.mutation(), f.selected, admission());
  await f.service.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  const before = { heads: await f.heads(), slots: await f.slots() };
  await expect(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, async scope => {
    expect(Object.keys(scope).sort()).toEqual(["closeNeverOpened", "receipt"]);
    expect(Object.isFrozen(scope.receipt.slots)).toBe(true);
    await scope.closeNeverOpened(scope.receipt.revision); throw new AccessDenied(401);
  })).rejects.toMatchObject({ status: 401 });
  expect({ heads: await f.heads(), slots: await f.slots() }).toEqual(before);
});
