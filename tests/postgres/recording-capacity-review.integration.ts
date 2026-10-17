import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as ledger from "../../src/server/data/recordings";
import * as receipts from "../../src/server/data/recording-receipts";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict, RecordingRegistrationLimit } from "../../src/server/recordings/registration";
import { createRecordingReceiptService, createRecordingReceiptTestMaintenance, RecordingReceiptLimit } from "../../src/server/recordings/receipts";
import { AccessDenied } from "../../src/server/access/errors";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { disposableConfig, query } from "./disposable.mjs";
const { Client } = createRequire(import.meta.url)("pg");
const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "c".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 100, durationMs: 100 } });
const settle = <T>(p: Promise<T>) => p.then(value => ({ value }), error => ({ error: error instanceof RecordingRegistrationLimit || error instanceof RecordingReceiptLimit ? "limit" : error instanceof RecordingRegistrationConflict ? "conflict" : error instanceof AccessDenied ? error.status : 503 }));
async function fixture() {
 const f = await postgresAccessFixture(); opened.push(f);
 const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
 const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
 await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
 const p = await f.practice(), request = (who: "admin" | "tutor" = "admin", handle?: string) => { const r = f.request(who); r.headers.set("origin", "http://localhost:3000"); if (handle) r.headers.set("X-Practice-Context", handle); return { ...r, method: "POST" }; };
 const context = await p.b.enter(request("tutor"), { studentId: f.student.id });
 const baseline = await f.ownerDb.select().from(s.auditEvent), a = { access: f.a, practice: p.a }, b = { access: f.b, practice: p.b };
 return { ...f, request, context, baseline, selected: { mode: "student" as const, studentId: f.student.id }, child: { mode: "child-practice" as const, studentId: f.student.id }, registrar: createStudentRecordingRegistrar(a), bRegistrar: createStudentRecordingRegistrar(b), aReceipts: createRecordingReceiptService({ ...a, storeGeneration: "capacity-review-v1" }), bReceipts: createRecordingReceiptService({ ...b, storeGeneration: "capacity-review-v1" }), maintenance: createRecordingReceiptTestMaintenance({ transaction: action => f.ownerDb.transaction(action) }) };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, count: number) { await f.ownerDb.insert(s.studentRecording).values(Array.from({ length: count }, () => ({ id: randomUUID(), tenantId: "crc", studentId: f.student.id, ...descriptor().media, assetId: randomUUID(), contentSha256: "d".repeat(64), state: "private" as const, revision: 1, createdAt: new Date() }))); }

test("review receipt-first commits fresh capacity while blocked implicit registrar must not enter ledger lookup", async () => {
 const f = await fixture(); await seed(f, 999);
 const original = receipts.insertSlots, entered = deferred(), release = deferred();
 vi.spyOn(receipts, "insertSlots").mockImplementation(async (...args) => { const rows = await original(...args); entered.resolve(); await release.promise; return rows; });
 const lookup = vi.spyOn(ledger, "registrationRow"), first = settle(f.aReceipts.admit(f.request(), f.selected, { requestId: randomUUID(), declaredBytes: 46 })); let second: ReturnType<typeof settle> | undefined;
 try { await waitForEntry(entered.promise, first); second = settle(f.bRegistrar.register(f.request("tutor", f.context.handle), f.child, descriptor())); await f.waitForLock(f.pidB, f.pidA); expect(lookup).not.toHaveBeenCalled(); }
 finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
 expect(await first).toHaveProperty("value"); expect(await second).toEqual({ error: "limit" }); expect(lookup).toHaveBeenCalledTimes(1); expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(999); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(f.baseline);
});

test("review original-ID callback already owns admission before any caller SQL and receipt observes committed ledger", async () => {
 const f = await fixture(); await seed(f, 999); const entered = deferred(), release = deferred(), value = descriptor(), id = randomUUID();
 const first = settle(f.registrar.withRegistrationAuthority(f.request(), f.selected, async scope => { entered.resolve(); await release.promise; return scope.registerVerified(id, value); })); let second: ReturnType<typeof settle> | undefined;
 const aggregates = vi.spyOn(receipts, "aggregates");
 try { await waitForEntry(entered.promise, first); second = settle(f.bReceipts.admit(f.request("tutor", f.context.handle), f.child, { requestId: randomUUID(), declaredBytes: 46 })); await f.waitForLock(f.pidB, f.pidA); expect(aggregates).not.toHaveBeenCalled(); }
 finally { release.resolve(); await Promise.allSettled([first, ...(second ? [second] : [])]); }
 expect(await first).toHaveProperty("value"); expect(await second).toEqual({ error: "limit" }); const baseline = await f.ownerDb.select().from(s.auditEvent);
 expect(await f.registrar.withRegistrationAuthority(f.request(), f.selected, x => x.registerVerified(id, value))).toEqual((await first as { value: unknown }).value);
 await f.registrar.register(f.request(), f.selected, value); expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1000); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(baseline); expect(baseline).toHaveLength(f.baseline.length + 1);
});

test.each(["implicit", "original"] as const)("review %s registrar refuses actual invisible unique-conflict INSERT without replay adoption", async mode => {
 const f = await fixture(), entered = deferred(), release = deferred(), rawId = randomUUID(), value = descriptor(), ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
 const originalInsert = vi.spyOn(ledger, "insertWithId"), lookup = vi.spyOn(ledger, "registrationRow");
 const raw = f.ownerDb.transaction(async tx => { await tx.insert(s.studentRecording).values({ id: rawId, tenantId: "crc", studentId: f.student.id, assetId: value.assetId, contentSha256: value.contentSha256, ...value.media, state: "private", revision: 1, createdAt: new Date() }); entered.resolve(); await release.promise; });
 let registration: ReturnType<typeof settle> | undefined;
 try { await waitForEntry(entered.promise, raw); registration = settle(mode === "implicit" ? f.registrar.register(f.request(), f.selected, value) : f.registrar.withRegistrationAuthority(f.request(), f.selected, x => x.registerVerified(rawId, value))); await f.waitForLock(f.pidA, ownerPid); expect(originalInsert).toHaveBeenCalledTimes(1); expect(lookup).toHaveBeenCalledTimes(1); }
 finally { release.resolve(); await Promise.allSettled([raw, ...(registration ? [registration] : [])]); }
 expect(await registration).toEqual(mode === "implicit" ? { value: { ok: false, code: "conflict" } } : { error: "conflict" });
 expect(lookup).toHaveBeenCalledTimes(1); expect(originalInsert).toHaveBeenCalledTimes(1); expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id: rawId, assetId: value.assetId }]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(f.baseline);
});

test("review date-first maintenance/head wait cannot invert admission/student; fresh registrar sees terminal release", async () => {
 const f = await fixture(), head = await f.aReceipts.admit(f.request(), f.selected, { requestId: randomUUID(), declaredBytes: 46 });
 await f.aReceipts.retire(f.request(), f.selected, { receiptId: head.receiptId, expectedRevision: head.revision }); await seed(f, 999);
 // Separate synthetic monitor avoids queuing observations behind the owner's
 // deliberately blocked maintenance query; no configured remote database used.
 const monitor = new Client({ ...disposableConfig(), database: f.owner.connectionParameters.database }); await monitor.connect();
 async function blocked(pid: number, blocker: number) { const deadline = Date.now() + 5000; for (;;) { const r = await query<{ blocked: boolean }>(monitor, "SELECT $1::integer=ANY(pg_blocking_pids($2::integer)) AS blocked", [blocker, pid]); if (r.rows[0].blocked) return; if (Date.now() >= deadline) throw Error("Expected date-first blocking edge was not observed"); await new Promise(r => setTimeout(r, 10)); } }
 const entered = deferred(), release = deferred(), ownerPid = (await query<{ pid: number }>(f.owner, "SELECT pg_backend_pid() AS pid")).rows[0].pid;
 const date = settle(f.bDb.transaction(async tx => { await tx.execute(sql`SELECT set_config('app.tenant_id','crc',true)`); await tx.update(s.student).set({ ceremonyDate: "2027-02-03", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.student.id)); entered.resolve(); await release.promise; }));
 let maintenance: ReturnType<typeof settle> | undefined, registration: ReturnType<typeof settle> | undefined, called = 0;
 try { await waitForEntry(entered.promise, date); maintenance = settle(f.maintenance.withHead({ tenantId: "crc", receiptId: head.receiptId }, x => x.closeNeverOpened(x.receipt.revision))); await blocked(ownerPid, f.pidB); registration = settle(f.registrar.withRegistrationAuthority(f.request(), f.selected, x => { called++; return x.registerVerified(randomUUID(), descriptor()); })); await blocked(f.pidA, f.pidB); expect(called).toBe(0); }
 finally { release.resolve(); await Promise.allSettled([date, ...(maintenance ? [maintenance] : []), ...(registration ? [registration] : [])]); await monitor.end(); }
 expect(await date).toHaveProperty("value"); expect(await maintenance).toHaveProperty("value"); expect(await registration).toHaveProperty("value"); expect(called).toBe(1); expect((await f.ownerDb.select().from(s.recordingReceipt))[0]).toMatchObject({ state: "terminal", logicalTakeReleased: true }); expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1000); expect(await f.ownerDb.select().from(s.auditEvent)).toHaveLength(f.baseline.length + 1);
});
