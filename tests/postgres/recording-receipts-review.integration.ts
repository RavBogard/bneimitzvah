import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, or, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/recording-receipts";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptConflict } from "../../src/server/recordings/receipts";
import { AccessDenied } from "../../src/server/access/errors";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const admission = () => ({ requestId: randomUUID(), declaredBytes: 46 });
function safe<T>(promise: Promise<T>) { return promise.then(value => ({ value }), error => ({ error: error instanceof RecordingReceiptConflict ? "conflict" : error instanceof AccessDenied ? error.status : 503 })); }
async function bounded<T>(promise: Promise<T>) { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Independent operation did not settle while unrelated row remained locked")), 5000); })]); } finally { clearTimeout(timer); } }
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const practice = await f.practice(), service = createRecordingReceiptService({ access: f.a, practice: practice.a, storeGeneration: "review-v1" });
  const request = () => { const r = f.request("admin"); r.headers.set("origin", "http://localhost:3000"); return { ...r, method: "POST" }; };
  const selected = { mode: "student" as const, studentId: f.student.id };
  return { ...f, service, request, selected, heads: () => f.ownerDb.select().from(s.recordingReceipt), slots: () => f.ownerDb.select().from(s.recordingReceiptSlot), maintenance: createRecordingReceiptTestMaintenance({ transaction: action => f.ownerDb.transaction(action) }) };
}
type View = Awaited<ReturnType<ReturnType<typeof createRecordingReceiptService>["admit"]>>;
const target = (r: View) => ({ receiptId: r.receiptId, expectedRevision: r.revision, slotIndex: 0, expectedSlotRevision: r.slots[0].revision });

test("review deferred COMMIT failure after successful opening SQL never emits an opaque permission", async () => {
  const f = await fixture(), row = await f.service.admit(f.request(), f.selected, admission());
  const prepared = await f.service.prepareSlot(f.request(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' });
  const baseline = await f.ownerDb.select().from(s.auditEvent), original = data.open;
  vi.spyOn(data, "open").mockImplementationOnce(async (tx, slot) => {
    const opened = await original(tx, slot);
    // Legal immediate head transition, intentionally inconsistent FINAL slot
    // set: only the real deferred outer COMMIT must reject this transaction.
    await tx.update(s.recordingReceipt).set({ state: "retiring", revision: 2n, retiringAt: sql`clock_timestamp()` }).where(eq(s.recordingReceipt.id, row.receiptId));
    return opened;
  });
  let commits = 0, emitted = 0;
  const restore = await f.intercept("a", text => /^commit$/i.test(text), async proceed => { commits++; return proceed(); });
  try { expect(await safe(f.service.openSlot(f.request(), f.selected, target(prepared)).then(value => { emitted++; return value; }))).toEqual({ error: 503 }); }
  finally { restore(); }
  expect(commits).toBe(1); expect(emitted).toBe(0);
  expect((await f.heads())[0]).toMatchObject({ state: "receiving", revision: 1n, logicalTakeReleased: false });
  expect((await f.slots())[0]).toMatchObject({ state: "prepared", revision: 2n, everUploadOpened: false, audioLiabilityReleased: false });
  expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(baseline); expect(await f.ownerDb.select().from(s.studentRecording)).toEqual([]);
});

test("review pending unawaited maintenance drains held SQL before rollback and cannot queue slot release after scope closure", async () => {
  const f = await fixture(), row = await f.service.admit(f.request(), f.selected, admission());
  await f.service.retire(f.request(), f.selected, { receiptId: row.receiptId, expectedRevision: row.revision });
  const entry = deferred(), release = deferred(), original = data.terminal, ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const slots = vi.spyOn(data, "closeSlots"), terminal = vi.spyOn(data, "terminal").mockImplementation(async (...args) => { const result = await original(...args); entry.resolve(); await release.promise; return result; });
  let settled = false;
  const closing = safe(f.maintenance.withHead({ tenantId: "crc", receiptId: row.receiptId }, async scope => { void scope.closeNeverOpened(scope.receipt.revision); })).then(value => { settled = true; return value; });
  let date: ReturnType<typeof safe> | undefined;
  try {
    await waitForEntry(entry.promise, closing); expect(settled).toBe(false);
    date = safe(f.bDb.transaction(async tx => { await tx.execute(sql`SELECT set_config('app.tenant_id','crc',true)`); await tx.update(s.student).set({ ceremonyDate: "2000-01-01", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.student.id)); }));
    await f.waitForLock(f.pidB, ownerPid); expect(settled).toBe(false);
  } finally { release.resolve(); await Promise.allSettled([closing, ...(date ? [date] : [])]); terminal.mockRestore(); }
  expect(await closing).toEqual({ error: 503 }); expect(await date).toHaveProperty("value"); expect(slots).not.toHaveBeenCalled();
  expect((await f.heads())[0]).toMatchObject({ state: "retiring", revision: 3n, logicalTakeReleased: false });
  expect((await f.heads())[0].retentionLatchedAt).not.toBeNull();
  expect((await f.slots())[0]).toMatchObject({ state: "retiring", revision: 2n, audioLiabilityReleased: false, everUploadOpened: false });
});

test("review double ledger collisions lock at most one present identity and never proceed to the receipt head", async () => {
  const f = await fixture(), row = await f.service.admit(f.request(), f.selected, admission()), secondId = randomUUID();
  await f.ownerDb.insert(s.studentRecording).values([
    { id: row.originalRecordingId, tenantId: "crc", studentId: f.student.id, assetId: randomUUID(), contentSha256: "a".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 10, state: "private", revision: 1, createdAt: new Date() },
    { id: secondId, tenantId: "crc", studentId: f.student.id, assetId: row.assetId, contentSha256: "b".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 10, state: "private", revision: 1, createdAt: new Date() },
  ]);
  const baseline = await f.ownerDb.select().from(s.studentRecording), headLock = vi.spyOn(data, "lock"), release = deferred(), entry = deferred();
  const ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await query(f.owner, "BEGIN"); await query(f.owner, "SELECT id FROM student_recording WHERE id=$1 FOR UPDATE", [row.originalRecordingId]);
  const other = f.bDb.transaction(async tx => { await tx.execute(sql`SELECT set_config('app.tenant_id','crc',true)`); await tx.select().from(s.studentRecording).where(eq(s.studentRecording.id, secondId)).for("update"); entry.resolve(); await release.promise; });
  let operation: ReturnType<typeof safe> | undefined;
  try {
    await waitForEntry(entry.promise, other);
    operation = safe(f.service.prepareSlot(f.request(), f.selected, { ...target(row), bodySha256: "a".repeat(64), permitEtag: '"A"' }));
    const until = Date.now() + 5000; let blocker = 0;
    while (Date.now() < until) { const list = (await query<{ ids: number[] }>(f.owner, "SELECT pg_blocking_pids($1) AS ids", [f.pidA])).rows[0].ids; blocker = list.find(id => id === ownerPid || id === f.pidB) ?? 0; if (blocker) break; await delay(10); }
    expect(blocker === ownerPid || blocker === f.pidB).toBe(true); await f.waitForLock(f.pidA, blocker);
    if (blocker === ownerPid) await query(f.owner, "COMMIT"); else { release.resolve(); await other; }
    // The OTHER matching ledger row is still locked. A multi-row lock would
    // hang here, rather than returning its closed collision refusal.
    expect(await bounded(operation)).toEqual({ error: "conflict" }); expect(headLock).not.toHaveBeenCalled();
  } finally { release.resolve(); await query(f.owner, "ROLLBACK"); await Promise.allSettled([other, ...(operation ? [operation] : [])]); }
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual(baseline);
  expect((await f.slots())[0]).toMatchObject({ state: "reserved", revision: 1n, everUploadOpened: false });
});
