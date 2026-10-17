import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict } from "../../src/server/recordings/registration";
import * as data from "../../src/server/data/recordings";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "e".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 1024, durationMs: 1500 } });
async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f);
  let clock = Date.parse("2026-03-01T05:59:59Z");
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2025-03-01" }).where(eq(s.student.id, f.students[0].id)));
  return { ...f, registrar: createStudentRecordingRegistrar({ access: f.service, practice: f.runtime.practice, now: () => clock }),
    selected: { studentId: f.students[0].id, mode: "student" as const }, mutation: () => f.request("/original-id-review", { who: "learner", method: "POST" }), due: () => { clock += 1000; } };
}

test("caught invalid original descriptor poisons prior caller audit and cannot commit caller success", async () => {
  const f = await fixture(), before = await f.owner(() => f.db.select().from(s.auditEvent));
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => {
    await data.audit(scope.tx, scope.actor, "create", randomUUID());
    try { await scope.registerVerified(randomUUID(), { ...descriptor(), contentSha256: "invalid" }); } catch { /* Intentionally caught by caller. */ }
    return "caller-success";
  })).rejects.toThrow();
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toEqual([]);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});

test("repeated registration caught after successful first call poisons row and both caller and creation audits", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor(), before = await f.owner(() => f.db.select().from(s.auditEvent));
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => {
    await data.audit(scope.tx, scope.actor, "create", randomUUID());
    await scope.registerVerified(id, value);
    try { await scope.registerVerified(id, value); } catch { /* Intentional repeated-use catch. */ }
    return "caller-success";
  })).rejects.toThrow();
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toEqual([]);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});

test("registration closure retained after callback has no insertion or audit authority", async () => {
  const f = await fixture(), calls = [vi.spyOn(data, "insertWithId"), vi.spyOn(data, "audit")];
  let escaped!: (id: string, value: ReturnType<typeof descriptor>) => Promise<unknown>;
  expect(await f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => { escaped = scope.registerVerified; return "closed"; })).toBe("closed");
  await expect(escaped(randomUUID(), descriptor())).rejects.toThrow();
  for (const call of calls) expect(call).not.toHaveBeenCalled();
});

test("freshness after all caller work rolls back successful registration and subsequent caller audit", async () => {
  const f = await fixture(), before = await f.owner(() => f.db.select().from(s.auditEvent));
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async scope => {
    await scope.registerVerified(randomUUID(), descriptor());
    await data.audit(scope.tx, scope.actor, "create", randomUUID());
    f.due();
    return "caller-success";
  })).rejects.toMatchObject({ status: 404 });
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toEqual([]);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});
test("ordinary authorization and public lookalike conflict exceptions cannot impersonate the private collision bridge", async () => {
  const f = await fixture();
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async () => { throw new AccessDenied(403); })).rejects.toMatchObject({ status: 403 });
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async () => { throw new RecordingRegistrationConflict(); })).rejects.toMatchObject({ status: 503 });
});
