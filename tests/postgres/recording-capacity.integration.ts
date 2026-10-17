import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/recording-receipts";
import * as ledger from "../../src/server/data/recordings";
import { createStudentRecordingRegistrar, RecordingRegistrationLimit } from "../../src/server/recordings/registration";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptLimit } from "../../src/server/recordings/receipts";
import { AccessDenied } from "../../src/server/access/errors";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 100, durationMs: 100 } });
const admission = () => ({ requestId: randomUUID(), declaredBytes: 46 });
function safe<T>(p: Promise<T>) { return p.then(value => ({ value }), error => ({ error: error instanceof RecordingReceiptLimit || error instanceof RecordingRegistrationLimit ? "limit" : error instanceof AccessDenied ? error.status : 503 })); }
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const p = await f.practice(), request = (who: "admin" | "tutor" = "admin", handle?: string) => { const r = f.request(who); r.headers.set("origin", "http://localhost:3000"); if (handle) r.headers.set("X-Practice-Context", handle); return { ...r, method: "POST" }; };
  const context = await p.b.enter(request("tutor"), { studentId: f.student.id });
  const baselineAudits = await f.ownerDb.select().from(s.auditEvent);
  const aDeps = { access: f.a, practice: p.a }, bDeps = { access: f.b, practice: p.b };
  return { ...f, request, context, baselineAudits, selected: { mode: "student" as const, studentId: f.student.id }, child: { mode: "child-practice" as const, studentId: f.student.id },
    aRegistrar: createStudentRecordingRegistrar(aDeps), bRegistrar: createStudentRecordingRegistrar(bDeps),
    aReceipt: createRecordingReceiptService({ ...aDeps, storeGeneration: "capacity-v1" }), bReceipt: createRecordingReceiptService({ ...bDeps, storeGeneration: "capacity-v1" }),
    maintenance: createRecordingReceiptTestMaintenance({ transaction: action => f.ownerDb.transaction(action) }) };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, count: number) {
  await f.ownerDb.insert(s.studentRecording).values(Array.from({ length: count }, () => ({ id: randomUUID(), tenantId: "crc", studentId: f.student.id, assetId: randomUUID(), contentSha256: "b".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 100, state: "private" as const, revision: 1, createdAt: new Date() })));
}

test("receipt-first holds admission through commit; the waiting legacy writer freshly observes the final take and refuses", async () => {
  const f = await fixture(); await seed(f, 999);
  const original = data.insert, entry = deferred(), release = deferred();
  vi.spyOn(data, "insert").mockImplementation(async (...args) => { const row = await original(...args); entry.resolve(); await release.promise; return row; });
  const first = safe(f.aReceipt.admit(f.request(), f.selected, admission())); let second: ReturnType<typeof safe> | undefined;
  try {
    await waitForEntry(entry.promise, first);
    second = safe(f.bRegistrar.register(f.request("tutor", f.context.handle), f.child, descriptor()));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); await Promise.all([first, second]); }
  expect(await first).toHaveProperty("value"); expect(await second).toEqual({ error: "limit" });
  expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(999); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(f.baselineAudits);
});

test("registrar-first holds admission through audit and outer commit; receipt freshly refuses and exact replay never double charges", async () => {
  const f = await fixture(); await seed(f, 999);
  const id = randomUUID(), value = descriptor(), original = ledger.audit, entry = deferred(), release = deferred();
  const spy = vi.spyOn(ledger, "audit").mockImplementation(async (...args) => { await original(...args); entry.resolve(); await release.promise; });
  const first = safe(f.aRegistrar.withRegistrationAuthority(f.request(), f.selected, x => x.registerVerified(id, value))); let second: ReturnType<typeof safe> | undefined;
  try { await waitForEntry(entry.promise, first); second = safe(f.bReceipt.admit(f.request("tutor", f.context.handle), f.child, admission())); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); await Promise.all([first, second]); spy.mockRestore(); }
  expect(await first).toHaveProperty("value"); expect(await second).toEqual({ error: "limit" });
  const baseline = await f.ownerDb.select().from(s.auditEvent);
  expect(await safe(f.aRegistrar.withRegistrationAuthority(f.request(), f.selected, x => x.registerVerified(id, value)))).toEqual(await first);
  await f.aRegistrar.register(f.request(), f.selected, value);
  expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1000); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(baseline); expect(baseline).toHaveLength(f.baselineAudits.length + 1);
});

test("mutex precedes callback entry; real session expiry while waiting prevents caller SQL or registration", async () => {
  const f = await fixture(), expires = Date.now() + 1400;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.admin.sessionId));
  await f.ownerDb.insert(s.recordingAdmission).values({ tenantId: "crc" });
  const entry = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const holding = f.ownerDb.transaction(async tx => { await tx.select().from(s.recordingAdmission).for("update"); entry.resolve(); await release.promise; });
  let called = 0, operation: ReturnType<typeof safe> | undefined;
  try { await waitForEntry(entry.promise, holding); operation = safe(f.aRegistrar.withRegistrationAuthority(f.request(), f.selected, async x => { called++; await ledger.audit(x.tx, x.actor, "delete-request", randomUUID()); })); await f.waitForLock(f.pidA, ownerPid); expect(called).toBe(0); await delay(Math.max(1, expires - Date.now() + 30)); }
  finally { release.resolve(); await Promise.all([holding, operation]); }
  expect(await operation).toEqual({ error: 401 }); expect(called).toBe(0); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(f.baselineAudits);
});

test("maintenance-first releases only never-opened liability before waiting registrar; date work settles without reversing the lock order", async () => {
  const f = await fixture(), head = await f.aReceipt.admit(f.request(), f.selected, admission());
  await f.aReceipt.retire(f.request(), f.selected, { receiptId: head.receiptId, expectedRevision: head.revision }); await seed(f, 999);
  const original = data.closeSlots, entry = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
  vi.spyOn(data, "closeSlots").mockImplementation(async (...args) => { const rows = await original(...args); entry.resolve(); await release.promise; return rows; });
  const closing = safe(f.maintenance.withHead({ tenantId: "crc", receiptId: head.receiptId }, x => x.closeNeverOpened(2n)));
  let registration: ReturnType<typeof safe> | undefined, date: Promise<unknown> | undefined, called = 0;
  try {
    await waitForEntry(entry.promise, closing);
    registration = safe(f.aRegistrar.withRegistrationAuthority(f.request(), f.selected, x => { called++; return x.registerVerified(randomUUID(), descriptor()); }));
    await f.waitForLock(f.pidA, ownerPid); expect(called).toBe(0);
    // Independent connection needs the student lock held by the registrar,
    // while maintenance owns admission but never asks for that student lock.
    date = f.bDb.transaction(async tx => { await tx.execute(sql`SELECT set_config('app.tenant_id','crc',true)`); await tx.update(s.student).set({ ceremonyDate: "2027-01-03", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.student.id)); });
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); await Promise.all([closing, registration, date]); }
  expect(await closing).toBeDefined(); expect(await registration).toHaveProperty("value"); expect(called).toBe(1);
  expect((await f.ownerDb.select().from(s.recordingReceipt))[0]).toMatchObject({ state: "terminal", logicalTakeReleased: true });
  expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1000); expect(await f.ownerDb.select().from(s.auditEvent)).toHaveLength(f.baselineAudits.length + 1);
});
