import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { postgresAccessFixture, deferred, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentService } from "../../src/server/students/service";
import { AccessDenied } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as data from "../../src/server/service-learning/data";
import * as s from "../../src/server/db/index";
type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
const safe = <T>(operation: PromiseLike<T>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: string; cause?: unknown } | undefined;
    for (let i = 0; value && i < 4; i++, value = value.cause as typeof value) if (value.code) return value.code;
    return "unknown";
  }
}
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f); const payload = syntheticServiceCatalog(), catalogId = randomUUID();
  await f.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.student.id));
  await f.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: payload.identity, feedBytes: payload.feedBytes, provenanceBytes: payload.provenanceBytes, pins: payload.pins });
  const [lifecycle] = await f.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" }).returning();
  const a = createServiceLearningService({ access: f.a, practice: createPracticeService({ access: f.a }), signingSecret: "synthetic-service-learning-review-secret" });
  const b = createServiceLearningService({ access: f.b, practice: createPracticeService({ access: f.b }), signingSecret: "synthetic-service-learning-review-secret" });
  const request = () => ({ ...f.request("tutor"), method: "POST", headers: new Headers({ ...Object.fromEntries(f.request("tutor").headers), origin: "http://localhost:3000" }) });
  const selection = { mode: "tutor" as const, studentId: f.student.id, expectedStudentRevision: 1, expectedPlanRevision: 0, catalogId, catalogIdentity: payload.identity, selectedIds: [payload.first] };
  async function prepare() { const value = await a.prepare(request(), selection); if (!value.ok) throw new Error("Synthetic service review missing"); return value; }
  async function save() { const review = await prepare(), value = await a.confirm(request(), { mode: "tutor", studentId: f.student.id, binding: review.binding }); if (!value.ok) throw new Error("Synthetic service plan missing"); return value; }
  return { ...f, payload, catalogId, lifecycle, aService: a, bService: b, serviceRequest: request, selection, prepare, save };
}

test("restricted role has only catalog SELECT and immutable lifecycle lock-ID UPDATE, with forced cross-tenant RLS", async () => {
  const f = await fixture();
  await withTenantTransaction(f.aDb, { tenantId: "crc" }, async tx => { expect(await data.lifecycle(tx, "crc", f.catalogId)).not.toBeNull(); });
  for (const command of [sql`update service_catalog set identity=identity`, sql`delete from service_catalog`, sql`insert into service_catalog select * from service_catalog`,
    sql`update service_catalog_lifecycle set id=${randomUUID()}`, sql`update service_catalog_lifecycle set state='withdrawn'`, sql`update service_catalog_lifecycle set revision=2`, sql`delete from service_catalog_lifecycle`, sql`insert into service_catalog_lifecycle select * from service_catalog_lifecycle`]) {
    expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.execute(command)))).not.toBe("accepted");
  }
  await withTenantTransaction(f.aDb, { tenantId: "other" }, async tx => { expect(await data.lifecycle(tx, "crc", f.catalogId)).toBeNull(); expect(await data.catalog(tx, "crc", f.catalogId)).toBeNull(); });
  expect(await sqlState(f.ownerDb.update(s.serviceCatalog).set({ identity: "2".repeat(64) }))).toBe("23514");
  await f.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "superseded", revision: 2 });
  expect((await f.ownerDb.select().from(s.serviceCatalogLifecycle))[0].state).toBe("superseded");
});

for (const kind of ["first", "update"] as const) test(`simultaneous ${kind}-plan confirmations have one CAS winner and one audit`, async () => {
  const f = await fixture(); if (kind === "update") { await f.save(); f.selection.expectedPlanRevision = 1; }
  const aReview = await f.prepare(), bReview = await f.prepare(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith(`${kind === "first" ? "insert into" : "update"} "student_service_plan"`), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.aService.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: aReview.binding })); let b: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, a); b = safe(f.bService.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: bReview.binding })); await f.waitForLock(f.pidB, f.pidA); }
  finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, revision: kind === "first" ? 1 : 2 }); expect(await b).toEqual({ ok: false, code: "stale-revision" });
  expect(await f.ownerDb.select().from(s.studentServicePlan)).toHaveLength(1);
  expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "service-plan.set"))).toHaveLength(kind === "first" ? 1 : 2);
});

for (const phase of ["read", "confirm"] as const) test(`withdrawal winning the lifecycle lock blocks subsequent ${phase}`, async () => {
  const f = await fixture(); await f.save();
  const review = await f.aService.prepare(f.serviceRequest(), { ...f.selection, expectedPlanRevision: 1 }); if (!review.ok) throw new Error("Synthetic review missing");
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => {
    await tx.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }).where(eq(s.serviceCatalogLifecycle.id, f.lifecycle.id)); entered.resolve(); await release.promise;
  }));
  let operation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, hold); const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = phase === "read" ? safe(f.aService.metadata(f.request("tutor"), { mode: "tutor", studentId: f.student.id })) : safe(f.aService.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: review.binding }));
    await f.waitForLock(f.pidA, ownerPid);
  } finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toMatchObject(phase === "read" ? { state: "withdrawn" } : { ok: false, code: "stale-revision" });
  expect((await f.ownerDb.select().from(s.studentServicePlan))[0].revision).toBe(1);
});

test("a permitted material read holds lifecycle SHARE until projection completes, then withdrawal prevents the next read", async () => {
  const f = await fixture(), saved = await f.save(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes('from "service_catalog"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const selected = { mode: "tutor" as const, studentId: f.student.id, planId: saved.planId, planRevision: 1, catalogIdentity: f.payload.identity, unitId: f.payload.first };
  const read = safe(f.aService.unit(f.request("tutor"), selected)); let withdrawal: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, read); const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    withdrawal = safe(f.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }));
    const deadline = Date.now() + 5000; let observed = false;
    while (Date.now() < deadline) { const result = await f.bDb.execute(sql`select ${f.pidA}::integer = any(pg_blocking_pids(${ownerPid}::integer)) as blocked`); if (result.rows[0]?.blocked === true) { observed = true; break; } await delay(10); }
    expect(observed).toBe(true);
  } finally { release.resolve(); stop(); await Promise.all([read, withdrawal]); }
  expect(await read).toMatchObject({ state: "assigned" });
  expect(await f.aService.unit(f.request("tutor"), selected)).toMatchObject({ state: "withdrawn" });
});

for (const phase of ["read", "prepare", "confirm"] as const) test(`fresh real session expiry across final plan-lock wait rejects ${phase} without changing a valid review or plan`, async () => {
  const f = await fixture(); await f.save(); const expires = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.tutor.sessionId));
  const selection = { ...f.selection, expectedPlanRevision: 1 }, review = await f.aService.prepare(f.serviceRequest(), selection); if (!review.ok) throw new Error("Synthetic review missing");
  const before = { plans: await f.ownerDb.select().from(s.studentServicePlan), audit: await f.ownerDb.select().from(s.auditEvent) };
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from student_service_plan where student_id=${f.student.id} for update`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); const pid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = phase === "read" ? safe(f.aService.metadata(f.request("tutor"), { mode: "tutor", studentId: f.student.id }))
      : phase === "prepare" ? safe(f.aService.prepare(f.serviceRequest(), selection)) : safe(f.aService.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: review.binding }));
    await f.waitForLock(f.pidA, pid); vi.spyOn(Date, "now").mockReturnValue(expires + 1);
  } finally { release.resolve(); await Promise.all([hold, operation]); vi.restoreAllMocks(); }
  expect(await operation).toEqual({ denied: 401 });
  expect({ plans: await f.ownerDb.select().from(s.studentServicePlan), audit: await f.ownerDb.select().from(s.auditEvent) }).toEqual(before);
});

test("date-slot edit wins the authority lock, retains IDs/marks review and invalidates earlier service confirmation", async () => {
  const f = await fixture(); await f.save(); const review = await f.aService.prepare(f.serviceRequest(), { ...f.selection, expectedPlanRevision: 1 }); if (!review.ok) throw new Error("Synthetic review missing");
  const entered = deferred(), release = deferred(), stop = await f.intercept("b", text => text.startsWith('update "student_service_plan"'), async proceed => { const value = await proceed(); entered.resolve(); await release.promise; return value; });
  const students = createStudentService({ access: f.b, signingSecret: "synthetic-reading-review-signing-secret", loadReading: async () => { throw new Error("No synthetic calendar fetch"); } });
  const request = { ...f.request("admin"), method: "POST", headers: new Headers({ ...Object.fromEntries(f.request("admin").headers), origin: "http://localhost:3000" }) };
  const edit = safe(students.edit(request, { mode: "admin", studentId: f.student.id, expectedRevision: 1, student: { firstName: "Synthetic", lastName: "Learner", ceremonyDate: "2027-01-09", serviceSlot: "havdalah", parentEmail: "fixture@example.test" } }));
  let confirm: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, edit); confirm = safe(f.aService.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: review.binding })); await f.waitForLock(f.pidA, f.pidB); }
  finally { release.resolve(); stop(); await Promise.all([edit, confirm]); }
  expect(await edit).toMatchObject({ ok: true }); expect(await confirm).toEqual({ ok: false, code: "stale-revision" });
  expect((await f.ownerDb.select().from(s.studentServicePlan))[0]).toMatchObject({ revision: 2, needsReview: true, selectedIds: [f.payload.first] });
});

test("tutor revocation winning the relationship lock prevents a pending material read", async () => {
  const f = await fixture(), saved = await f.save(), entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id)); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); const pid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = safe(f.aService.unit(f.request("tutor"), { mode: "tutor", studentId: f.student.id, planId: saved.planId, planRevision: 1, catalogIdentity: f.payload.identity, unitId: f.payload.first })); await f.waitForLock(f.pidA, pid);
  } finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ denied: 404 });
});

for (const expiry of ["session", "review"] as const) test(`withdrawal stale-confirm status rechecks ${expiry} expiry after the observed lifecycle wait`, async () => {
  const f = await fixture(); await f.save(); let reviewTime = Date.now(); const sessionExpiry = Date.now() + 60_000;
  if (expiry === "session") await f.ownerDb.update(s.session).set({ expiresAt: new Date(sessionExpiry) }).where(eq(s.session.id, f.tutor.sessionId));
  const service = createServiceLearningService({ access: f.a, practice: createPracticeService({ access: f.a }), signingSecret: "synthetic-service-learning-review-secret", now: () => reviewTime });
  const review = await service.prepare(f.serviceRequest(), { ...f.selection, expectedPlanRevision: 1 }); if (!review.ok) throw new Error("Synthetic review missing");
  const before = { plans: await f.ownerDb.select().from(s.studentServicePlan), audit: await f.ownerDb.select().from(s.auditEvent) };
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined;
  try { await waitForEntry(entered.promise, hold); const pid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    operation = safe(service.confirm(f.serviceRequest(), { mode: "tutor", studentId: f.student.id, binding: review.binding }));
    await f.waitForLock(f.pidA, pid);
    if (expiry === "session") vi.spyOn(Date, "now").mockReturnValue(sessionExpiry + 1); else reviewTime += 6 * 60_000;
  } finally { release.resolve(); await Promise.all([hold, operation]); vi.restoreAllMocks(); }
  expect(await operation).toEqual({ denied: expiry === "session" ? 401 : 403 });
  expect({ plans: await f.ownerDb.select().from(s.studentServicePlan), audit: await f.ownerDb.select().from(s.auditEvent) }).toEqual(before);
});
