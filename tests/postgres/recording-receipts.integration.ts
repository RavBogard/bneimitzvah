import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/recording-receipts";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingRegistrar } from "../../src/server/recordings/registration";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptConflict, RecordingReceiptLimit, type ReceiptView } from "../../src/server/recordings/receipts";
import { AccessDenied } from "../../src/server/access/errors";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const admit = () => ({ requestId: randomUUID(), declaredBytes: 46 });
const target = (r: ReceiptView) => ({ receiptId: r.receiptId, expectedRevision: r.revision, slotIndex: 0, expectedSlotRevision: r.slots[0].revision });
function safe<T>(promise: Promise<T>) { return promise.then(value => ({ value }), error => ({ error: error instanceof RecordingReceiptLimit ? "limit" : error instanceof RecordingReceiptConflict ? "conflict" : error instanceof AccessDenied ? error.status : 503 })); }
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const p = await f.practice(), mutation = (who: "admin" | "tutor" = "admin", handle?: string) => { const r = f.request(who); r.headers.set("origin", "http://localhost:3000"); if (handle) r.headers.set("X-Practice-Context", handle); return { ...r, method: "POST" }; };
  const context = await p.b.enter(mutation("tutor"), { studentId: f.student.id });
  let clock = Date.now();
  const dependenciesA = { access: f.a, practice: p.a, storeGeneration: "synthetic-v1", now: () => clock }, dependenciesB = { access: f.b, practice: p.b, storeGeneration: "synthetic-v1", now: () => clock };
  return { ...f, p, mutation, context, dependenciesA, aService: createRecordingReceiptService(dependenciesA), bService: createRecordingReceiptService(dependenciesB),
    selected: { mode: "student" as const, studentId: f.student.id }, child: { mode: "child-practice" as const, studentId: f.student.id },
    clock: (value: number) => { clock = value; }, heads: () => f.ownerDb.select().from(s.recordingReceipt), slots: () => f.ownerDb.select().from(s.recordingReceiptSlot),
    maintenance: createRecordingReceiptTestMaintenance({ transaction: action => f.ownerDb.transaction(action) }) };
}

// The first transaction holds the real admission row after INSERT. The second
// must wait on the physical backend, not a mocked mutex, before its last-slot check.
async function quotaRace(f: Awaited<ReturnType<typeof fixture>>, first: () => Promise<ReceiptView>, second: () => Promise<ReceiptView>) {
  const entered = deferred(), release = deferred(), original = data.insert;
  const spy = vi.spyOn(data, "insert").mockImplementation(async (...args) => { const row = await original(...args); entered.resolve(); await release.promise; return row; });
  const a = safe(first()); let b: ReturnType<typeof safe<ReceiptView>> | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(second()); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); await Promise.all([a, b]); spy.mockRestore(); }
  expect(await a).toHaveProperty("value"); expect(await b).toEqual({ error: "limit" });
}

test("independent actors race for the last student admission and exact concurrent request replays one head", async () => {
  const f = await fixture(); await f.aService.admit(f.mutation(), f.selected, admit());
  await quotaRace(f, () => f.aService.admit(f.mutation(), f.selected, admit()), () => f.bService.admit(f.mutation("tutor", f.context.handle), f.child, admit()));
  expect(await f.heads()).toHaveLength(2);
  const replay = (await f.heads())[1];
  const request = { requestId: replay.requestId, declaredBytes: 46 };
  const results = await Promise.all([f.aService.admit(f.mutation(), f.selected, request), f.bService.admit(f.mutation(), f.selected, request)]);
  expect(results[0]).toEqual(results[1]); expect(results[0]).toMatchObject({ receiptId: replay.id }); expect(await f.heads()).toHaveLength(2);
});

test("one tenant-user quota is shared across distinct student contexts and real sessions", async () => {
  const f = await fixture();
  const otherSession = await f.signIn("pg-tutor"), otherRequest = { url: "http://localhost:3000/practice", method: "POST", headers: new Headers({ cookie: otherSession.cookie, origin: "http://localhost:3000" }) };
  const secondContext = await f.p.b.enter(otherRequest, { studentId: f.p.sibling.id }); otherRequest.headers.set("X-Practice-Context", secondContext.handle);
  const firstContext = await f.p.a.enter(f.mutation("tutor"), { studentId: f.student.id }), firstRequest = f.mutation("tutor", firstContext.handle);
  await f.aService.admit(firstRequest, f.child, admit());
  await quotaRace(f, () => f.aService.admit(firstRequest, f.child, admit()), () => f.bService.admit(otherRequest, { mode: "child-practice", studentId: f.p.sibling.id }, admit()));
  expect(await f.heads()).toHaveLength(2);
});

test("distinct actors and students race for tenant slot128 using primary rows", async () => {
  const f = await fixture(), template = await f.aService.admit(f.mutation(), f.selected, admit());
  const [head] = await f.heads();
  // Fixture-only complete heads for an unrelated student's and actor's usage.
  await f.ownerDb.transaction(async tx => {
    for (let i = 0; i < 126; i++) {
      const id = randomUUID(), assetId = randomUUID();
      await tx.insert(s.recordingReceipt).values({ ...head, id, requestId: randomUUID(), originalRecordingId: randomUUID(), assetId, studentId: f.p.sibling.id, actorUserId: `synthetic-${i}`, admittedAt: undefined });
      await tx.insert(s.recordingReceiptSlot).values({ tenantId: "crc", receiptId: id, slotIndex: 0, objectKey: `recordings/v1/${assetId}/chunk-00`, expectedBytes: 46, state: "reserved", revision: 1n });
    }
  });
  // The sibling's count cannot influence either target's student quota.
  const [third] = await f.ownerDb.insert(s.student).values({ tenantId: "crc", firstName: "Synthetic", lastName: "Third", ceremonyDate: "2027-01-02", parentEmail: "fixture@example.test" }).returning();
  const [guardian] = await f.ownerDb.select().from(s.guardian).where(eq(s.guardian.studentId, f.student.id));
  await f.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId: third.id, parentGrantId: guardian.parentGrantId, linkProvenance: "synthetic" });
  const childContext = await f.p.b.enter(f.mutation("tutor"), { studentId: third.id });
  await quotaRace(f, () => f.aService.admit(f.mutation(), f.selected, admit()), () => f.bService.admit(f.mutation("tutor", childContext.handle), { mode: "child-practice", studentId: third.id }, admit()));
  expect(await f.heads()).toHaveLength(128); expect(template.declaredBytes).toBe(46);
});

test("confirmed opening wins before retirement; never-opened closure cannot release it", async () => {
  const f = await fixture(), row = await f.aService.admit(f.mutation(), f.selected, admit()), prepared = await f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const entered = deferred(), release = deferred(), original = data.open;
  const spy = vi.spyOn(data, "open").mockImplementation(async (...args) => { const result = await original(...args); entered.resolve(); await release.promise; return result; });
  const open = safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared))); let retire: ReturnType<typeof safe<ReceiptView>> | undefined;
  try { await waitForEntry(entered.promise, open); retire = safe(f.bService.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision })); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); await Promise.all([open, retire]); spy.mockRestore(); }
  expect(await retire).toHaveProperty("value"); const result = await open; if (!("value" in result)) throw Error("Opening failed");
  expect(f.aService.consumeOpening(result.value)).toMatchObject({ receiptId: row.receiptId });
  await expect(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, x => x.closeNeverOpened(x.receipt.revision))).rejects.toBeInstanceOf(RecordingReceiptConflict);
  expect((await f.slots())[0]).toMatchObject({ everUploadOpened: true, audioLiabilityReleased: false });
});

test("terminal closure wins its real row wait and an old prepared opening never receives permission", async () => {
  const f = await fixture(), row = await f.aService.admit(f.mutation(), f.selected, admit()), prepared = await f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  await f.aService.retire(f.mutation(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  const entered = deferred(), release = deferred(), pid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const close = safe(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, async x => { const value = await x.closeNeverOpened(x.receipt.revision); entered.resolve(); await release.promise; return value; }));
  let opening: ReturnType<typeof safe<unknown>> | undefined;
  try { await waitForEntry(entered.promise, close); opening = safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared))); await f.waitForLock(f.pidA, pid); }
  finally { release.resolve(); await Promise.all([close, opening]); }
  expect(await close).toHaveProperty("value"); expect(await opening).toEqual({ error: "conflict" });
  expect((await f.slots())[0]).toMatchObject({ state: "never-opened", everUploadOpened: false, audioLiabilityReleased: true });
});

test("actual lost COMMIT acknowledgement emits no permission and never treats a durable true bit as replay authority", async () => {
  const f = await fixture(), row = await f.aService.admit(f.mutation(), f.selected, admit()), prepared = await f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const baseline = await f.ownerDb.select().from(s.auditEvent);
  const rollback = await f.intercept("a", text => text.startsWith('update "recording_receipt_slot"'), async proceed => { await proceed(); throw Error("Synthetic failure after UPDATE"); });
  let scheduled = 0;
  try { expect(await safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared)).then(p => { scheduled++; return p; }))).toEqual({ error: 503 }); }
  finally { rollback(); }
  expect(scheduled).toBe(0); expect((await f.slots())[0]).toMatchObject({ state: "prepared", everUploadOpened: false });
  const restore = await f.intercept("a", text => /^commit$/i.test(text), async proceed => { await proceed(); throw Error("Synthetic lost acknowledgement"); });
  try { expect(await safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared)).then(p => { scheduled++; return p; }))).toEqual({ error: 503 }); }
  finally { restore(); }
  expect(scheduled).toBe(0); expect((await f.slots())[0].everUploadOpened).toBe(true);
  expect(await safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared)))).toEqual({ error: "conflict" });
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual([]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(baseline);
});

test("session expiry after a measured SQL wait remains401 and cannot emit committed permission", async () => {
  const f = await fixture(), expires = Date.now() + 1400;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.admin.sessionId));
  const row = await f.aService.admit(f.mutation(), f.selected, admit()), prepared = await f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const entered = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table recording_receipt_slot in share mode`); entered.resolve(); await release.promise; }));
  let opening: ReturnType<typeof safe<unknown>> | undefined;
  try { await waitForEntry(entered.promise, hold); opening = safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared))); await f.waitForLock(f.pidA, ownerPid); await delay(Math.max(1, expires - Date.now() + 25)); }
  finally { release.resolve(); await Promise.all([hold, opening]); }
  expect(await opening).toEqual({ error: 401 }); expect((await f.slots())[0].everUploadOpened).toBe(false);
});

test("a later legacy identity collision is locked and refused instead of adopted on replay or opening", async () => {
  const f = await fixture(), request = admit(), row = await f.aService.admit(f.mutation(), f.selected, request);
  const registrar = createStudentRecordingRegistrar(f.dependenciesA);
  await registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(row.originalRecordingId, { assetId: row.assetId, contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus", byteLength: 2048, durationMs: 2000 } }));
  expect(await safe(f.aService.admit(f.mutation(), f.selected, request))).toEqual({ error: "conflict" });
  expect(await safe(f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' }))).toEqual({ error: "conflict" });
  expect((await f.slots())[0].state).toBe("reserved"); expect(await f.heads()).toHaveLength(1); expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1);
  await f.ownerDb.update(s.studentRecording).set({ state: "deleting", revision: 2, deletionRequestedAt: new Date() }).where(eq(s.studentRecording.id, row.originalRecordingId));
  const aggregate = data.aggregates; let totals: Awaited<ReturnType<typeof aggregate>> | undefined;
  const spy = vi.spyOn(data, "aggregates").mockImplementation(async (...args) => { const value = await aggregate(...args); totals = value; return value; });
  await f.aService.admit(f.mutation(), f.selected, admit()); spy.mockRestore();
  expect(totals).toMatchObject({ studentBytes: 2094n, studentTakes: 2n, studentIds: 1n, studentMarkerBytes: 64n });
});

test("unknown admission COMMIT is reconciled only by its same UUID without escaping reserved identities or charging twice", async () => {
  const f = await fixture(), request = admit();
  const restore = await f.intercept("a", text => /^commit$/i.test(text), async proceed => { await proceed(); throw Error("Synthetic lost admission acknowledgement"); });
  try { expect(await safe(f.aService.admit(f.mutation(), f.selected, request))).toEqual({ error: 503 }); } finally { restore(); }
  const [durable] = await f.heads(), replay = await f.aService.admit(f.mutation(), f.selected, request);
  expect(replay).toMatchObject({ receiptId: durable.id, originalRecordingId: durable.originalRecordingId, assetId: durable.assetId }); expect(await f.heads()).toHaveLength(1);
  expect(await safe(f.bService.admit(f.mutation("tutor", f.context.handle), f.child, request))).toEqual({ error: "conflict" });
  expect(await f.slots()).toHaveLength(1); expect((await f.slots())[0].everUploadOpened).toBe(false);
});

test("a real prepared-slot wait crossing retention rolls back opening; legacy increasing writer bypass remains an explicit activation blocker", async () => {
  const f = await fixture(), row = await f.aService.admit(f.mutation(), f.selected, admit()), prepared = await f.aService.prepareSlot(f.mutation(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const entered = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table recording_receipt_slot in share mode`); entered.resolve(); await release.promise; }));
  let opening: ReturnType<typeof safe<unknown>> | undefined;
  try { await waitForEntry(entered.promise, hold); opening = safe(f.aService.openSlot(f.mutation(), f.selected, target(prepared))); await f.waitForLock(f.pidA, ownerPid); f.clock(Date.parse("2030-01-01T00:00:00Z")); }
  finally { release.resolve(); await Promise.all([hold, opening]); }
  expect(await opening).toEqual({ error: 404 }); expect((await f.slots())[0].everUploadOpened).toBe(false);
  f.clock(Date.now());
  const aggregate = data.aggregates, aggregateEntered = deferred(), aggregateRelease = deferred();
  const spy = vi.spyOn(data, "aggregates").mockImplementation(async (...args) => { const totals = await aggregate(...args); aggregateEntered.resolve(); await aggregateRelease.promise; return totals; });
  const admission = safe(f.aService.admit(f.mutation(), f.selected, admit()));
  const registrar = createStudentRecordingRegistrar({ access: f.b, practice: createPracticeService({ access: f.b }) });
  try { await waitForEntry(aggregateEntered.promise, admission);
    // Another actor's legacy path does not acquire recording_admission.
    await registrar.withRegistrationAuthority(f.mutation("tutor", f.context.handle), f.child, x => x.registerVerified(randomUUID(), { assetId: randomUUID(), contentSha256: "b".repeat(64), media: { mediaType: "audio/webm;codecs=opus", byteLength: 2048, durationMs: 2000 } }));
  } finally { aggregateRelease.resolve(); await admission; spy.mockRestore(); }
  expect(await admission).toHaveProperty("value"); expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1);
});
