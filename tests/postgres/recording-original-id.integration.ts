import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import * as data from "../../src/server/data/recordings";
import { AccessDenied } from "../../src/server/access/errors";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict } from "../../src/server/recordings/registration";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

const opened: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 2048, durationMs: 2000 } });
function safe(operation: PromiseLike<unknown>) { return Promise.resolve(operation).then(value => value, error => error instanceof RecordingRegistrationConflict ? { conflict: true } : { denied: error instanceof AccessDenied ? error.status : 503 }); }
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: grant.id });
  const practiceA = createPracticeService({ access: f.a }), practiceB = createPracticeService({ access: f.b });
  const mutation = (who: "admin" | "tutor" = "admin", handle?: string) => { const request = f.request(who); request.headers.set("origin", "http://localhost:3000"); if (handle) request.headers.set("X-Practice-Context", handle); return { ...request, method: "POST" }; };
  const context = await practiceB.enter(mutation("tutor"), { studentId: f.student.id });
  let clock = Date.now();
  return { ...f, mutation, context, selected: { mode: "student" as const, studentId: f.student.id }, child: { mode: "child-practice" as const, studentId: f.student.id },
    aRegistrar: createStudentRecordingRegistrar({ access: f.a, practice: practiceA, now: () => clock }), bRegistrar: createStudentRecordingRegistrar({ access: f.b, practice: practiceB, now: () => clock }), clock: (value: number) => { clock = value; } };
}

for (const sameId of [true, false]) test(`real unique wait ${sameId ? "replays only the original ID" : "rejects another ID without adopting the asset or committing caller audit"}`, async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor(), baseline = await f.ownerDb.select().from(s.auditEvent);
  const entered = deferred(), release = deferred();
  const a = safe(f.aRegistrar.withRegistrationAuthority(f.mutation(), f.selected, async x => { const receipt = await x.registerVerified(id, value); entered.resolve(); await release.promise; return receipt; }));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.bRegistrar.withRegistrationAuthority(f.mutation("tutor", f.context.handle), f.child, async x => {
      await data.audit(x.tx, x.actor, "delete-request", id);
      try { return await x.registerVerified(sameId ? id : randomUUID(), value); } catch { return "caught"; }
    }));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); await Promise.all([a, b]); }
  expect(await a).toEqual({ ok: true, recording: { id, state: "private", revision: 1 } });
  expect(await b).toEqual(sameId ? await a : { conflict: true });
  expect(await f.ownerDb.select().from(s.studentRecording)).toMatchObject([{ id, assetId: value.assetId }]);
  expect(await f.ownerDb.select().from(s.studentRecording)).toHaveLength(1);
  const audits = await f.ownerDb.select().from(s.auditEvent);
  expect(audits.slice(baseline.length).map(row => row.action).sort()).toEqual(sameId ? ["recording.create", "recording.delete-request"] : ["recording.create"]);
});

test("anniversary during an actual creation audit wait rolls back exact original ID and creation audit", async () => {
  const f = await fixture(), id = randomUUID(), before = Date.parse("2026-03-01T05:59:59Z"), baseline = await f.ownerDb.select().from(s.auditEvent);
  await f.ownerDb.update(s.student).set({ ceremonyDate: "2025-03-01" }).where(eq(s.student.id, f.student.id)); f.clock(before);
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const entered = deferred(), release = deferred();
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`lock table audit_event in share mode`); entered.resolve(); await release.promise; }));
  let operation: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, hold);
    operation = safe(f.aRegistrar.withRegistrationAuthority(f.mutation(), f.selected, async x => { await x.registerVerified(id, descriptor()); }));
    await f.waitForLock(f.pidA, ownerPid); f.clock(before + 1000);
  } finally { release.resolve(); await Promise.all([hold, operation]); }
  expect(await operation).toEqual({ denied: 404 });
  expect(await f.ownerDb.select().from(s.studentRecording)).toEqual([]); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(baseline);
});
