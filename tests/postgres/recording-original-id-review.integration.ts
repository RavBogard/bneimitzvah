import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/recordings";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingRegistrar } from "../../src/server/recordings/registration";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";
const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "f".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 1024, durationMs: 1500 } });
const safe = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => ({ ok: true, value }), error => ({ ok: false, status: error?.status ?? null }));
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const registrar = createStudentRecordingRegistrar({ access: f.a, practice: createPracticeService({ access: f.a }) });
  const mutation = () => { const request = f.request("admin"); request.headers.set("origin", "http://localhost:3000"); return { ...request, method: "POST" }; };
  return { ...f, registrar, mutation, selected: { mode: "student" as const, studentId: f.student.id } };
}

test("unawaited original registration drains a physically blocked INSERT before rollback and issues no late audit", async () => {
  const f = await fixture(), before = await f.ownerDb.select().from(s.auditEvent), ownerPid = (await query<{pid:number}>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), insertStarted = deferred(), auditCalls = vi.spyOn(data, "audit");
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table student_recording in share mode`); entered.resolve(); await release.promise; }));
  const stop = await f.intercept("a", text => text.startsWith('insert into "student_recording"'), async proceed => { insertStarted.resolve(); return proceed(); });
  let settled = false, operation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    operation = safe(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => {
      await data.audit(scope.tx, scope.actor, "create", randomUUID());
      void scope.registerVerified(randomUUID(), descriptor()).catch(() => undefined);
      await insertStarted.promise;
      return "unawaited-success";
    })).then(value => { settled = true; return value; });
    await f.waitForLock(f.pidA, ownerPid);
    expect(settled).toBe(false);
  } finally { release.resolve(); await Promise.all([hold, operation]); stop(); }
  expect(await operation).toMatchObject({ ok: false });
  expect(auditCalls).toHaveBeenCalledTimes(1); // Only the caller audit; closed INSERT continuation cannot issue creation audit.
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual([]);
  expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

test("expiry after observed exact-ID replay lock rolls back earlier caller work and remains authority denial", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor();
  await f.registrar.withRegistrationAuthority(f.mutation(), f.selected, scope => scope.registerVerified(id, value));
  const expires = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.admin.sessionId));
  const before = await f.ownerDb.select().from(s.auditEvent), ownerPid = (await query<{pid:number}>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred(), hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from student_recording where id=${id} for update`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    operation = safe(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => {
      await data.audit(scope.tx, scope.actor, "create", randomUUID());
      return scope.registerVerified(id, value);
    }));
    await f.waitForLock(f.pidA, ownerPid);
    const mock = vi.spyOn(Date, "now").mockReturnValue(expires + 1); restore = () => mock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, operation]); restore?.(); }
  expect(await operation).toEqual({ ok: false, status: 401 });
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, state: "private", revision: 1 }]);
  expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});
