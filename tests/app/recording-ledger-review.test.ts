import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudentRecordingService } from "../../src/server/recordings/service";
import { createStudentRecordingRegistrar } from "../../src/server/recordings/registration";
import { AccessDenied } from "../../src/server/access/errors";
import * as data from "../../src/server/data/recordings";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.client.close(); });
const before = Date.parse("2026-03-01T05:59:59.000Z"), due = before + 1000;
const descriptor = () => ({ assetId: randomUUID(), contentSha256: "c".repeat(64), media: { mediaType: "audio/webm;codecs=opus" as const, byteLength: 1024, durationMs: 1500 } });
async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f); let clock = before;
  await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2025-03-01" }).where(eq(s.student.id, f.students[0].id)));
  const dependencies = { access: f.service, practice: f.runtime.practice, now: () => clock };
  return { ...f, recordings: createStudentRecordingService(dependencies), registrar: createStudentRecordingRegistrar(dependencies), setClock: (value: number) => { clock = value; },
    selected: { studentId: f.students[0].id, mode: "student" as const }, mutation: () => f.request("/recording-review", { who: "learner", method: "POST" }) };
}
async function denied(operation: Promise<unknown>) { try { await operation; return 0; } catch (error) { return error instanceof AccessDenied ? error.status : 503; } }

test("post-query anniversary crossing hides private and submitted pages and cursors while preserving explicit own deletion", async () => {
  const f = await fixture(), privateId = randomUUID(), submitted = Array.from({ length: 51 }, () => randomUUID());
  await f.owner(async () => {
    await f.db.insert(s.studentRecording).values([...submitted, privateId].map((id, i) => ({ id, tenantId: "crc", studentId: f.selected.studentId, ...descriptor().media,
      assetId: randomUUID(), contentSha256: "d".repeat(64), state: "private", revision: 1, createdAt: new Date(before - (i + 1) * 1000) })));
    for (const id of submitted) await f.db.update(s.studentRecording).set({ state: "submitted", revision: 2, submittedAt: new Date(before) }).where(eq(s.studentRecording.id, id));
  });
  const original = data.page;
  vi.spyOn(data, "page").mockImplementationOnce(async (...args) => { const rows = await original(...args); expect(rows).toHaveLength(51); f.setClock(due); return rows; });
  const page = await f.recordings.page(f.mutation(), f.selected);
  expect(page.entries).toEqual([]); expect(page.nextCursor).toBeNull();
  const staff = { ...f.selected, mode: "tutor" as const };
  expect((await f.recordings.page(f.request("/recording-review"), staff)).entries).toEqual([]);
  expect(await denied(f.recordings.page(f.request("/recording-review"), staff, privateId))).toBe(404);
  expect(await denied(f.recordings.page(f.mutation(), f.selected, submitted[0]))).toBe(404);
  expect(await denied(f.recordings.page(f.mutation(), f.selected, privateId))).toBe(404);
  expect(await f.recordings.remove(f.mutation(), f.selected, { recordingId: privateId, expectedRevision: 1 })).toEqual({ ok: true, recording: { id: privateId, revision: 2, state: "deleting" } });
  expect(await f.owner(() => f.db.select().from(s.studentRecording).where(eq(s.studentRecording.id, privateId)))).toMatchObject([{ state: "deleting", revision: 2, submittedAt: null }]);
});

test("anniversary crossing after actual creation/submission audit rolls back the metadata and audit together", async () => {
  const f = await fixture(), value = descriptor(), original = data.audit;
  const audits = () => f.owner(() => f.db.select().from(s.auditEvent));
  const baseline = await audits();
  vi.spyOn(data, "audit").mockImplementationOnce(async (...args) => { await original(...args); f.setClock(due); });
  expect(await denied(f.registrar.register(f.mutation(), f.selected, value))).toBe(404);
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toEqual([]); expect(await audits()).toEqual(baseline);
  vi.restoreAllMocks(); f.setClock(before);
  const created = await f.registrar.register(f.mutation(), f.selected, value); if (!created.ok) throw new Error("Synthetic registration failed");
  const registered = await audits();
  vi.spyOn(data, "audit").mockImplementationOnce(async (...args) => { await original(...args); f.setClock(due); });
  expect(await denied(f.recordings.submit(f.mutation(), f.selected, { recordingId: created.recording.id, expectedRevision: 1 }))).toBe(404);
  expect(await f.owner(() => f.db.select().from(s.studentRecording))).toMatchObject([{ id: created.recording.id, state: "private", revision: 1, submittedAt: null }]);
  expect(await audits()).toEqual(registered);
});

test("overlapping parent mode is denied before every recording lookup or registration attempt", async () => {
  const f = await fixture(), selected = { ...f.selected, mode: "parent" as const }, calls = [vi.spyOn(data, "page"), vi.spyOn(data, "cursor"), vi.spyOn(data, "lock"), vi.spyOn(data, "insertWithId")];
  const request = f.request("/recording-review", { who: "multi", method: "POST" });
  expect(await denied(f.recordings.page(request, selected, randomUUID()))).toBe(403);
  expect(await denied(f.recordings.submit(request, selected, { recordingId: randomUUID(), expectedRevision: 1 }))).toBe(403);
  expect(await denied(f.recordings.remove(request, selected, { recordingId: randomUUID(), expectedRevision: 1 }))).toBe(403);
  expect(await denied(f.registrar.register(request, selected, descriptor()))).toBe(403);
  for (const call of calls) expect(call).not.toHaveBeenCalled();
});
