import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type { AccessTransaction } from "../../src/server/access/types";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudentRecordingRegistrar } from "../../src/server/recordings/registration";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { recordingDue, recordingDate } from "../../src/server/recordings/retention";
import * as s from "../../src/server/db/index";
import type { RecordingReceipt } from "../../src/lib/recordings/types";
import type { VerifiedRecordingDescriptor } from "../../src/server/recordings/validation";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const descriptor = (): VerifiedRecordingDescriptor => ({ assetId: randomUUID(), contentSha256: "a".repeat(64), media: { mediaType: "audio/webm;codecs=opus", byteLength: 1024, durationMs: 1500 } });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const dependencies = { access: f.service, practice: f.runtime.practice }, registrar = createStudentRecordingRegistrar(dependencies);
  const selection = { mode: "student" as const, studentId: f.students[0].id }, path = `/api/students/${selection.studentId}/recordings`;
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const request = () => f.request(path, { who: "learner", method: "POST" });
  async function register(value = descriptor()) {
    const result = await registrar.register(request(), selection, value); expect(result.ok).toBe(true);
    return { result: result as RecordingReceipt, value };
  }
  return { ...f, dependencies, registrar, selection, path, dispatch, recordingRequest: request, register };
}
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("recording registration stays internal; explicit HTTP transitions use CAS, private DTOs and one audit per actual change", async () => {
  const f = await fixture(), { result, value } = await f.register(), id = result.recording.id;
  expect(Object.keys(f.runtime.recordings).sort()).toEqual(["page", "remove", "submit"]);
  expect("register" in f.runtime.recordings).toBe(false);
  expect(await f.registrar.register(f.recordingRequest(), f.selection, value)).toEqual(result);
  expect(await f.registrar.register(f.recordingRequest(), f.selection, { ...value, contentSha256: "b".repeat(64) })).toEqual({ ok: false, code: "conflict" });
  const read = await f.dispatch(f.request(f.path + "?mode=student", { who: "learner" }));
  expect(read.status).toBe(200); expect(read.headers.get("cache-control")).toBe("private, no-store");
  const page = await read.json(); expect(Object.keys(page.entries[0]).sort()).toEqual(["id", "media", "recordedDate", "revision", "state"]);
  expect(JSON.stringify(page)).not.toContain(value.assetId); expect(JSON.stringify(page)).not.toContain(value.contentSha256);
  expect(page.entries[0]).toMatchObject({ id, revision: 1, state: "private", media: value.media });
  expect((await f.dispatch(f.request(f.path + "?mode=tutor"))).status).toBe(200);
  expect((await f.runtime.recordings.page(f.request(f.path), { ...f.selection, mode: "tutor" })).entries).toHaveLength(0);
  const submit = (expectedRevision: number) => f.dispatch(f.request(`${f.path}/${id}/submit`, { who: "learner", body: { mode: "student", expectedRevision } }));
  expect((await submit(1)).status).toBe(200); expect((await submit(1)).status).toBe(409); expect((await submit(2)).status).toBe(200);
  expect((await f.registrar.register(f.recordingRequest(), f.selection, value))).toEqual({ ok: true, recording: { id, revision: 2, state: "submitted" } });
  const staff = await f.runtime.recordings.page(f.request(f.path), { ...f.selection, mode: "tutor" });
  expect(Object.keys(staff.entries[0]).sort()).toEqual(["id", "media", "revision", "state", "submittedDate"]);
  expect((await f.dispatch(f.request(`${f.path}/${id}/delete`, { who: "learner", body: { mode: "student", expectedRevision: 2 } }))).status).toBe(200);
  expect(await f.runtime.recordings.remove(f.recordingRequest(), f.selection, { recordingId: id, expectedRevision: 3 })).toEqual({ ok: true, recording: { id, revision: 3, state: "deleting" } });
  expect(await f.runtime.recordings.submit(f.recordingRequest(), f.selection, { recordingId: id, expectedRevision: 3 })).toEqual({ ok: false, code: "conflict" });
  expect(await f.registrar.register(f.recordingRequest(), f.selection, value)).toEqual({ ok: false, code: "conflict" });
  expect((await f.runtime.recordings.page(f.request(f.path, { who: "learner" }), f.selection)).entries).toHaveLength(0);
  expect((await f.owner(() => f.db.select().from(s.auditEvent))).map(row => row.action)).toEqual(["recording.create", "recording.submit", "recording.delete-request"]);
  expect(await f.owner(() => f.db.select().from(s.practiceEvent))).toHaveLength(0);
  expect(await f.owner(() => f.db.select().from(s.verseSelfCheck))).toHaveLength(0);
});

test("recording routes deny parent/overlapping modes, staff mutations, malformed input and any public registration/completion path", async () => {
  const f = await fixture(), { result } = await f.register(), id = result.recording.id;
  for (const mode of ["parent", "unknown"]) expect((await f.dispatch(f.request(`${f.path}?mode=${mode}`))).status).toBe(mode === "parent" ? 403 : 400);
  for (const mode of ["tutor", "admin", "parent"]) expect((await f.dispatch(f.request(`${f.path}/${id}/submit`, { body: { mode, expectedRevision: 1 } }))).status).toBe(403);
  for (const path of [f.path + "/register", f.path + "/create", `${f.path}/${id}/complete-delete`, `${f.path}/${id}/bytes`]) expect((await f.dispatch(f.request(path, { body: {} }))).status).toBe(404);
  expect((await f.dispatch(f.request(f.path, { body: descriptor() }))).status).toBe(405);
  for (const suffix of ["?mode=student&mode=student", "?mode=student&assetId=synthetic", "?mode=student&afterId=invalid"]) expect((await f.dispatch(f.request(f.path + suffix, { who: "learner" }))).status).toBe(400);
  expect((await f.dispatch(f.request(`${f.path}/${id}/submit`, { who: "learner", body: { mode: "student", expectedRevision: 1, assetId: randomUUID() } }))).status).toBe(400);
  expect((await f.dispatch(f.request(`${f.path}/${id}/submit`, { who: "learner", body: { mode: "student", expectedRevision: 1 }, headers: { origin: "https://foreign.example.test" } }))).status).toBe(403);
  expect((await f.dispatch(f.request(`${f.path}?mode=student`, { who: "anonymous" }))).status).toBe(401);
  expect((await f.dispatch(f.request(`/api/students/${f.students[1].id}/recordings?mode=student`, { who: "learner" }))).status).toBe(404);
});

test("recording native guards force tenant integrity, private inserts, immutable capture and consecutive irreversible deletion without runtime DELETE", async () => {
  const f = await fixture(), { result } = await f.register(), id = result.recording.id;
  const within = <T>(action: (tx: AccessTransaction<PgliteQueryResultHKT>) => Promise<T>) => withTenantTransaction(f.db, { tenantId: "crc" }, action);
  const [row] = await f.owner(() => f.db.select().from(s.studentRecording));
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.studentRecording))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID() })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), studentId: f.students[3].id })))).toBe("23503");
  for (const patch of [{ state: "submitted", revision: 2, submittedAt: new Date() }, { state: "deleting", revision: 2, deletionRequestedAt: new Date() }]) expect(await sqlState(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.insert(s.studentRecording).values({ ...row, id: randomUUID(), assetId: randomUUID(), ...patch })))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ assetId: randomUUID() }).where(eq(s.studentRecording.id, id))))).toBe("42501");
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ revision: 2 })))).toBe("23514");
  expect(await sqlState(within(tx => tx.delete(s.studentRecording)))).toBe("42501");
  await within(tx => tx.update(s.studentRecording).set({ state: "submitted", revision: 2, submittedAt: new Date(Math.max(Date.now(), row.createdAt.getTime())) }));
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ state: "deleting", revision: 3, submittedAt: new Date(row.createdAt.getTime() + 1000), deletionRequestedAt: new Date(row.createdAt.getTime() + 1000) })))).toBe("23514");
  await within(tx => tx.update(s.studentRecording).set({ state: "deleting", revision: 3, deletionRequestedAt: new Date(Date.now() + 2000) }));
  expect(await sqlState(within(tx => tx.update(s.studentRecording).set({ state: "private", revision: 1, submittedAt: null, deletionRequestedAt: null })))).toBe("23514");
  expect((await f.owner(() => f.db.execute(sql`select relrowsecurity,relforcerowsecurity from pg_class where relname='student_recording'`))).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
});

test("recording expiry hides submitted metadata and blocks registration/replay while due deletion remains authorized", async () => {
  const f = await fixture(); let now = Date.parse("2028-01-02T05:59:59.999Z");
  const dependencies = { ...f.dependencies, now: () => now }, registrar = createStudentRecordingRegistrar(dependencies), recordings = createStudentRecordingService(dependencies);
  const value = descriptor(), initial = await registrar.register(f.recordingRequest(), f.selection, value); expect(initial.ok).toBe(true);
  if (!initial.ok) throw new Error("Synthetic registration failed");
  await recordings.submit(f.recordingRequest(), f.selection, { recordingId: initial.recording.id, expectedRevision: 1 });
  expect((await recordings.page(f.recordingRequest(), f.selection)).entries).toHaveLength(1);
  now++;
  expect((await recordings.page(f.recordingRequest(), f.selection)).entries).toEqual([]);
  await expect(registrar.register(f.recordingRequest(), f.selection, value)).rejects.toMatchObject({ status: 404 });
  await expect(recordings.submit(f.recordingRequest(), f.selection, { recordingId: initial.recording.id, expectedRevision: 2 })).rejects.toMatchObject({ status: 404 });
  expect((await recordings.remove(f.recordingRequest(), f.selection, { recordingId: initial.recording.id, expectedRevision: 2 })).ok).toBe(true);
});

test("recording linked-child authority binds the exact context and opaque cursors reveal no private staff rows", async () => {
  const f = await fixture(), request = () => f.request(f.path, { method: "POST" });
  const child = await f.runtime.practice.enter(request(), { studentId: f.selection.studentId });
  const childRequest = () => f.request(f.path, { method: "POST", handle: child.handle });
  const selection = { ...f.selection, mode: "child-practice" as const }, first = await f.registrar.register(childRequest(), selection, descriptor());
  expect(first.ok).toBe(true); if (!first.ok) throw new Error("Synthetic child registration failed");
  expect((await f.runtime.recordings.page(childRequest(), selection)).entries).toHaveLength(1);
  await expect(f.runtime.recordings.page(f.request(f.path), selection)).rejects.toMatchObject({ status: 404 });
  await expect(f.runtime.recordings.page(f.request(f.path), { ...f.selection, mode: "tutor" }, first.recording.id)).rejects.toMatchObject({ status: 404 });
  const seeded = Array.from({ length: 52 }, (_, index) => ({ id: randomUUID(), tenantId: "crc", studentId: f.selection.studentId, assetId: randomUUID(), contentSha256: "c".repeat(64), mediaType: "audio/webm;codecs=opus", byteLength: 100, durationMs: 100, state: "private", revision: 1, createdAt: new Date(Date.now() - 1000 - index) }));
  await f.owner(() => f.db.insert(s.studentRecording).values(seeded));
  const page = await f.runtime.recordings.page(childRequest(), selection); expect(page.entries).toHaveLength(50); expect(page.nextCursor).toBe(page.entries[49].id);
  const rest = await f.runtime.recordings.page(childRequest(), selection, page.nextCursor!); expect(rest.entries).toHaveLength(3); expect(rest.nextCursor).toBeNull();
  expect(new Set([...page.entries, ...rest.entries].map(row => row.id)).size).toBe(53);
  await f.runtime.practice.switch(childRequest(), { studentId: f.students[1].id });
  await expect(f.runtime.recordings.submit(childRequest(), selection, { recordingId: first.recording.id, expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
});

test.each([
  ["2024-02-29", "2025-02-28T05:59:59.999Z", false], ["2024-02-29", "2025-02-28T06:00:00.000Z", true],
  ["2026-03-09", "2027-03-09T05:59:59.999Z", false], ["2026-03-09", "2027-03-09T06:00:00.000Z", true],
  ["9999-12-31", "9999-12-31T23:59:59.999Z", false],
] as const)("recording Chicago anniversary %s at %s is due=%s", (ceremony, instant, due) => {
  expect(recordingDue(ceremony, Date.parse(instant))).toBe(due);
  expect(recordingDate(new Date(instant))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
