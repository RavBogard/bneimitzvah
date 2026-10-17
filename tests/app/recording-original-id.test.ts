import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudentRecordingRegistrar, RecordingRegistrationConflict } from "../../src/server/recordings/registration";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as data from "../../src/server/data/recordings";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 1024, durationMs: 1500 } });
async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f); let clock = Date.now();
  const deps = { access: f.service, practice: f.runtime.practice, now: () => clock };
  return { ...f, registrar: createStudentRecordingRegistrar(deps), recordings: createStudentRecordingService(deps),
    selected: { mode: "student" as const, studentId: f.students[0].id }, mutation: () => f.request("/registration-original", { who: "learner", method: "POST" }),
    clock: (value: number) => { clock = value; }, rows: () => f.owner(() => f.db.select().from(s.studentRecording)), audits: () => f.owner(() => f.db.select().from(s.auditEvent)) };
}

test("exact original ID registration and private/submitted replay preserve immutable facts and one create audit, including legacy asset retry", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor();
  const register = () => f.registrar.withRegistrationAuthority(f.mutation(), f.selected, ({ registerVerified }) => registerVerified(id, value));
  const first = await register(); expect(first).toEqual({ ok: true, recording: { id, state: "private", revision: 1 } });
  expect(await register()).toEqual(first);
  expect(await f.registrar.register(f.mutation(), f.selected, value)).toEqual(first);
  await f.recordings.submit(f.mutation(), f.selected, { recordingId: id, expectedRevision: 1 });
  expect(await register()).toEqual({ ok: true, recording: { id, state: "submitted", revision: 2 } });
  expect((await f.audits()).map(row => row.action)).toEqual(["recording.create", "recording.submit"]);
  expect(await f.rows()).toMatchObject([{ id, assetId: value.assetId, contentSha256: value.contentSha256 }]);
  expect(Object.keys(f.runtime.recordings).sort()).toEqual(["page", "remove", "submit"]);
});

test("same asset/new ID and same ID/changed facts never adopt or update; caught conflict still rolls back caller work", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor();
  await f.registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(id, value));
  const baseline = await f.audits();
  const cases = [
    { id: randomUUID(), value }, { id, value: { ...value, assetId: randomUUID() } }, { id, value: { ...value, contentSha256: "b".repeat(64) } },
    { id, value: { ...value, media: { ...value.media, byteLength: 1025 } } }, { id, value: { ...value, media: { ...value.media, durationMs: 1501 } } },
  ];
  for (const item of cases) {
    await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async x => {
      await data.audit(x.tx, x.actor, "delete-request", id);
      try { await x.registerVerified(item.id, item.value); } catch { /* Trusted caller cannot clear poison. */ }
      return "would commit";
    })).rejects.toBeInstanceOf(RecordingRegistrationConflict);
    expect(await f.audits()).toEqual(baseline); expect(await f.rows()).toHaveLength(1);
  }
  await f.recordings.remove(f.mutation(), f.selected, { recordingId: id, expectedRevision: 1 });
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(id, value))).rejects.toBeInstanceOf(RecordingRegistrationConflict);
  expect((await f.rows())[0].state).toBe("deleting");
});

test("caller/auth/database failures are never relabeled as collisions and caller failure rolls back ledger plus audit", async () => {
  const f = await fixture(), id = randomUUID(), value = descriptor();
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async x => {
    await x.registerVerified(id, value); throw new Error("synthetic caller failure");
  })).rejects.toBeInstanceOf(AccessUnavailable);
  expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
  await f.registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(id, value));
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async x => {
    try { await x.registerVerified(randomUUID(), value); } catch { /* Collision cannot mask later auth failure. */ }
    throw new AccessDenied(401);
  })).rejects.toMatchObject({ status: 401 });
  vi.spyOn(data, "audit").mockRejectedValueOnce(new Error("synthetic audit failure"));
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(randomUUID(), descriptor()))).rejects.toBeInstanceOf(AccessUnavailable);
  expect(await f.rows()).toHaveLength(1); expect(await f.audits()).toHaveLength(1);
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), { ...f.selected, mode: "parent" }, () => "no")).rejects.toMatchObject({ status: 403 });
});

test("anniversary after awaited create audit aborts all new original-ID metadata", async () => {
  const f = await fixture(), before = Date.parse("2026-03-01T05:59:59.000Z");
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2025-03-01" }).where(eq(s.student.id, f.selected.studentId)));
  f.clock(before); const audit = data.audit;
  vi.spyOn(data, "audit").mockImplementationOnce(async (...args) => { await audit(...args); f.clock(before + 1000); });
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, x => x.registerVerified(randomUUID(), descriptor()))).rejects.toMatchObject({ status: 404 });
  expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
});

test("concurrent invocation poisons the one-shot composition even when both rejections are caught", async () => {
  const f = await fixture();
  await expect(f.registrar.withRegistrationAuthority(f.mutation(), f.selected, async x => {
    const first = x.registerVerified(randomUUID(), descriptor()), second = x.registerVerified(randomUUID(), descriptor());
    await Promise.allSettled([first, second]); return "caught";
  })).rejects.toBeInstanceOf(AccessUnavailable);
  expect(await f.rows()).toEqual([]); expect(await f.audits()).toEqual([]);
});
