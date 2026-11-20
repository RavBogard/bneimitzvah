import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { withTenantTransaction } from "../../src/server/db/runtime";
import type { AccessRequest, AccessTransaction, StudentActor } from "../../src/server/access/types";
import type { StudentView } from "../../src/server/data/students";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createTutorSpokenService, type SpokenTransport } from "../../src/server/tutor-spoken/service";
import { boundedAudio, MAX_SPOKEN_BYTES, validateMedia } from "../../src/server/tutor-spoken/media";
import { createHttpDispatcher } from "../../src/server/http/dispatch";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.client.close(); });
const bytes = Uint8Array.from([82, 73, 70, 70, 24, 0, 0, 0, 87, 65, 86, 69, ...Array(20).fill(0)]);
const stream = (value: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(value); controller.close(); } });
async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-4", status: "confirmed", setByMembershipId: f.adminMember.id, aliyahStarts: ["Genesis 1:3"] }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3, 4].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    return row;
  });
  const blobs = new Map<string, Uint8Array>(), removed: string[] = [];
  const transport: SpokenTransport = { put: vi.fn(async (path, value) => { blobs.set(path, value); }), get: vi.fn(async path => { const value = blobs.get(path); if (!value) throw 0; return stream(value); }), remove: vi.fn(async path => { removed.push(path); blobs.delete(path); }) };
  const build = (storage: SpokenTransport | undefined = transport) => createTutorSpokenService({ access: f.service, transport: storage });
  const service = build(), selection = { mode: "tutor" as const, studentId: f.students[0].id, assignmentId: assignment.id, assignmentRevision: 1, startVerse: "Genesis 1:1" };
  const request = (who: "multi" | "admin" | "learner" | "recipient" | "anonymous" = "multi") => f.request("/api/spoken", { who, method: "POST" });
  const expected = async () => { const info = await service.read(request(), selection); return { revision: info.expectedClipRevision, id: info.expectedClipId }; };
  const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, tutorSpoken: service }));
  return { ...f, service, selection, transport, blobs, removed, build, request, expected, dispatch };
}

test("a tutor shares private human speech for one canonical aliyah; learner playback has no storage locator and parents/unrelated people cannot read", async () => {
  const f = await fixture();
  expect(await f.service.replace(f.request(), f.selection, { revision: 0, id: null }, bytes, "audio/wav")).toEqual({ ok: true });
  const own = await f.service.read(f.request(), f.selection);
  expect(own.clip).toMatchObject({ startVerse: "Genesis 1:1", endVerse: "Genesis 1:2", canManage: true });
  expect([...f.blobs.keys()][0]).toMatch(/^tutor-spoken\/[a-f0-9-]{36}$/);
  const learner = { ...f.selection, mode: "student" as const }, info = await f.service.read(f.request("learner"), learner);
  expect(info).toMatchObject({ canShare: false, expectedClipId: null, expectedClipRevision: 0, clip: { canManage: false } });
  expect(JSON.stringify(info)).not.toMatch(/tutor-spoken\/|https:/);
  expect((await f.service.audio(f.request("learner"), learner, info.clip!.id)).bytes).toEqual(bytes);
  await expect(f.service.read(f.request(), { ...f.selection, mode: "parent" })).rejects.toMatchObject({ status: 403 });
  await expect(f.service.read(f.request("anonymous"), learner)).rejects.toBeDefined();
  await expect(f.service.read(f.request("recipient"), learner)).rejects.toBeDefined();
  await expect(f.service.replace(f.request("learner"), learner, { revision: 0, id: null }, bytes, "audio/wav")).rejects.toBeDefined();
});

test("only the creator or an authorized admin replaces/withdraws a current clip; withdrawal opens the slot to another assigned tutor", async () => {
  const f = await fixture(), admin = { ...f.selection, mode: "admin" as const };
  await f.service.replace(f.request("admin"), admin, { revision: 0, id: null }, bytes, "audio/wav");
  expect((await f.service.read(f.request(), f.selection)).canShare).toBe(false);
  const original = await f.service.read(f.request("admin"), admin), expected = { id: original.expectedClipId, revision: original.expectedClipRevision };
  await expect(f.service.replace(f.request(), f.selection, expected, bytes, "audio/wav")).rejects.toMatchObject({ status: 403 });
  await expect(f.service.withdraw(f.request(), f.selection, expected)).rejects.toMatchObject({ status: 403 });
  expect(await f.service.withdraw(f.request("admin"), admin, expected)).toEqual({ ok: true });
  expect(f.removed).toHaveLength(1); expect(f.blobs.size).toBe(0);
  const empty = await f.expected();
  expect(await f.service.replace(f.request(), f.selection, empty, bytes, "audio/wav")).toEqual({ ok: true });
  const [row] = await f.owner(() => f.db.select().from(s.tutorSpoken));
  expect(row.creatorMembershipId).toBe(f.multiMember.id); expect(row.revision).toBe(3);
});

test("unrelated aliyah boundary edits preserve playback, target boundary edits hide it, and stale writers cannot publish", async () => {
  const f = await fixture(); await f.service.replace(f.request(), f.selection, await f.expected(), bytes, "audio/wav");
  const info = await f.service.read(f.request(), f.selection);
  await f.owner(() => f.db.update(s.assignment).set({ revision: 2, aliyahStarts: ["Genesis 1:3", "Genesis 1:4"] }).where(eq(s.assignment.id, f.selection.assignmentId)));
  expect((await f.service.audio(f.request(), f.selection, info.clip!.id)).bytes).toEqual(bytes);
  expect(await f.service.replace(f.request(), f.selection, { id: info.expectedClipId, revision: info.expectedClipRevision }, bytes, "audio/wav")).toEqual({ ok: false, code: "stale-revision" });
  await f.owner(() => f.db.update(s.assignment).set({ revision: 3, aliyahStarts: ["Genesis 1:2", "Genesis 1:3"] }).where(eq(s.assignment.id, f.selection.assignmentId)));
  expect((await f.service.read(f.request(), f.selection)).clip).toBeNull();
  await expect(f.service.audio(f.request(), f.selection, info.clip!.id)).rejects.toMatchObject({ status: 404 });
});

test("revocation during provider work refuses playback and publication; concurrent replacements retain the committed object", async () => {
  const f = await fixture(); await f.service.replace(f.request(), f.selection, await f.expected(), bytes, "audio/wav");
  const info = await f.service.read(f.request(), f.selection), expected = await f.expected();
  const results = await Promise.all([f.service.replace(f.request(), f.selection, expected, bytes, "audio/wav"), f.service.replace(f.request(), f.selection, expected, bytes, "audio/wav")]);
  expect(results.filter(row => row.ok)).toHaveLength(1); expect(f.blobs.size).toBe(1);
  const current = await f.service.read(f.request(), f.selection);
  const service = f.build({ ...f.transport, get: async path => { await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id))); return stream(f.blobs.get(path)!); } });
  await expect(service.audio(f.request(), f.selection, current.clip!.id)).rejects.toMatchObject({ status: 404 });
  expect(info.clip).not.toBeNull();
});

test("a provider deletion failure leaves obsolete paths queued, and unavailable provider hides controls", async () => {
  const f = await fixture(), service = f.build({ ...f.transport, remove: async () => { throw new Error("Synthetic provider unavailable"); } });
  await service.replace(f.request(), f.selection, await f.expected(), bytes, "audio/wav");
  await service.replace(f.request(), f.selection, await f.expected(), bytes, "audio/wav");
  expect(await f.owner(() => f.db.select().from(s.tutorSpokenCleanup))).toHaveLength(1);
  const unavailable = createTutorSpokenService({ access: f.runtime.access });
  expect(await unavailable.read(f.request(), f.selection)).toMatchObject({ available: false, clip: null, canShare: false });
});

test("HTTP returns private same-origin audio, rejects foreign origins, malformed selectors and invalid media", async () => {
  const f = await fixture();
  const query = new URLSearchParams({ mode: "tutor", assignmentId: f.selection.assignmentId, assignmentRevision: "1", startVerse: f.selection.startVerse, expectedClipRevision: "0" });
  const path = `/api/students/${f.selection.studentId}/tutor-spoken`, upload = (origin: string, body = bytes, type = "audio/wav") => new Request(`http://localhost:3000${path}?${query}`, { method: "POST", headers: { cookie: f.identities.multi.cookie, origin, "content-type": type }, body: Buffer.from(body) });
  expect((await f.dispatch(upload("https://evil.example"))).status).toBe(403);
  expect((await f.dispatch(upload("http://localhost:3000", new Uint8Array(32)))).status).toBe(415);
  expect((await f.dispatch(upload("http://localhost:3000", bytes, "text/html"))).status).toBe(415);
  expect((await f.dispatch(upload("http://localhost:3000"))).status).toBe(200);
  const info = await f.service.read(f.request(), f.selection); query.delete("expectedClipRevision"); query.set("clipId", info.clip!.id);
  const response = await f.dispatch(new Request(`http://localhost:3000${path}/audio?${query}`, { headers: { cookie: f.identities.multi.cookie } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.has("location")).toBe(false); expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
});

test("bounded audio rejects oversized, aborted and stalled streams, dishonest lengths and MIME/container mismatches", async () => {
  await expect(boundedAudio(stream(new Uint8Array(MAX_SPOKEN_BYTES + 1)))).rejects.toMatchObject({ status: 413 });
  await expect(boundedAudio(stream(bytes), { expectedLength: 40 })).rejects.toMatchObject({ status: 400 });
  const abort = new AbortController(); abort.abort();
  await expect(boundedAudio(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }), { signal: abort.signal })).rejects.toMatchObject({ status: 408 });
  await expect(boundedAudio(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } }), { deadlineMs: 10 })).rejects.toMatchObject({ status: 408 });
  expect(() => validateMedia(bytes, "audio/mp4")).toThrow();
});


test("an ambiguous committed response never deletes the active blob", async () => {
  const f = await fixture(), access = f.runtime.access; let calls = 0;
  const uncertain = createTutorSpokenService({ transport: f.transport, access: {
    async withStudentCapability<T>(request: AccessRequest, selection: Parameters<typeof access.withStudentCapability>[1], action: (tx: AccessTransaction<PgQueryResultHKT>, actor: StudentActor, student: StudentView) => Promise<T>): Promise<T> {
      const result = await access.withStudentCapability(request, selection, action);
      if (++calls === 2) throw new Error("Synthetic response lost after commit");
      return result;
    },
  } });
  await expect(uncertain.replace(f.request(), f.selection, { id: null, revision: 0 }, bytes, "audio/wav")).rejects.toBeDefined();
  expect(f.removed).toHaveLength(0); expect(f.blobs.size).toBe(1);
  expect((await f.service.read(f.request(), f.selection)).clip).not.toBeNull();
});

test("upload transport rechecks a revoked tutor link before publication", async () => {
  const f = await fixture();
  const service = f.build({ ...f.transport, put: async (path, value, type) => { await f.transport.put(path, value, type); await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id))); } });
  await expect(service.replace(f.request(), f.selection, { id: null, revision: 0 }, bytes, "audio/wav")).rejects.toBeDefined();
  expect(await f.owner(() => f.db.select().from(s.tutorSpoken))).toHaveLength(0);
});


test("0060 forces tenant isolation on clips and cleanup rows and forbids deleting clip history", async () => {
  const f = await fixture(); await f.service.replace(f.request(), f.selection, { id: null, revision: 0 }, bytes, "audio/wav");
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.tutorSpoken))).toEqual([]);
  await expect(withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.delete(s.tutorSpoken))).rejects.toBeDefined();
  const flags = await f.owner(() => f.client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('tutor_spoken','tutor_spoken_cleanup') order by relname"));
  expect(flags.rows).toEqual([{ relname: "tutor_spoken", relrowsecurity: true, relforcerowsecurity: true }, { relname: "tutor_spoken_cleanup", relrowsecurity: true, relforcerowsecurity: true }]);
});


test("the dedicated POST withdrawal route keeps the origin boundary and rejects DELETE and nonempty bodies", async () => {
  const f = await fixture();
  await f.service.replace(f.request(), f.selection, { id: null, revision: 0 }, bytes, "audio/wav");
  const info = await f.service.read(f.request(), f.selection);
  const query = new URLSearchParams({ mode: "tutor", assignmentId: f.selection.assignmentId, assignmentRevision: "1", startVerse: f.selection.startVerse, expectedClipRevision: String(info.expectedClipRevision), expectedClipId: info.expectedClipId! });
  const path = `/api/students/${f.selection.studentId}/tutor-spoken`;
  const withdraw = (origin: string, body: unknown = {}) => new Request(`http://localhost:3000${path}/withdraw?${query}`, { method: "POST", headers: { cookie: f.identities.multi.cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect((await f.dispatch(withdraw("https://evil.example"))).status).toBe(403);
  expect((await f.dispatch(withdraw("http://localhost:3000", { extra: true }))).status).toBe(400);
  expect((await f.dispatch(new Request(`http://localhost:3000${path}?${query}`, { method: "DELETE", headers: { cookie: f.identities.multi.cookie, origin: "http://localhost:3000" } }))).status).toBe(405);
  expect((await f.service.read(f.request(), f.selection)).clip).not.toBeNull();
  const result = await f.dispatch(withdraw("http://localhost:3000"));
  expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true });
  expect((await f.service.read(f.request(), f.selection)).clip).toBeNull(); expect(f.blobs.size).toBe(0);
});
