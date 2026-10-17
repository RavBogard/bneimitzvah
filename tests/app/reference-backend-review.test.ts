import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createReferenceAudioService } from "../../src/server/reference-audio/service";
import { parseReferenceCatalog, ReferenceUnavailable } from "../../src/server/reference-audio/catalog";
import { createReferenceCatalogLoader } from "../../src/server/reference-audio/storage";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticResponse } from "../helpers/study";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id, proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    return row;
  });
  const asset = "ra_" + "4".repeat(32);
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Independent.mp3", sha256: "b".repeat(64), bytes: 4, verses: [1, 2, 3].map(n => ({ schema: "reference-verse/v1", ref: `Genesis 1:${n}`, table: "torah", playback: { status: "ready", asset, clip: { start: 1, end: 3 } }, words: { status: "ready", readingTextSha256: sha("אָ֑ב ג׃".normalize("NFC")), starts: [1, 2] }, attribution: REFERENCE_ATTRIBUTION })) }] })!;
  const loadText = createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  return { ...f, assignment, asset, catalog, loadText, selection };
}

it("default release is based on actual authorized admin mode, not membership overlap or request labels", async () => {
  const f = await fixture(), service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => f.catalog });
  const admin = await service.read(f.request("/api/reference", { who: "admin" }), f.selection);
  expect(admin.ok && admin.reference.source?.asset).toBe(f.asset);
  const entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  for (const mode of ["parent", "tutor", "student", "child-practice"] as const) {
    const request = f.request("/api/reference", { who: mode === "student" ? "learner" : "multi", handle: mode === "child-practice" ? entered.handle : undefined });
    const result = await service.read(request, { ...f.selection, mode });
    if (!result.ok) throw new Error("Synthetic authorization unexpectedly stale");
    expect(result.reference).toMatchObject({ source: null, verse: { playback: { status: "unavailable" }, words: { status: "unavailable", reason: "no-playback" } } });
  }
  await expect(service.read(f.request("/api/reference", { who: "multi" }), f.selection)).rejects.toMatchObject({ status: 403 });
  const released = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => f.catalog, studentRelease: true });
  const learner = await released.read(f.request("/api/reference", { who: "learner" }), { ...f.selection, mode: "student" });
  expect(learner.ok && learner.reference.source?.asset).toBe(f.asset);
});

it("rechecks a real expired original session after catalog I/O even when the caller replaces its cookie", async () => {
  const f = await fixture(), request = f.request("/api/reference", { who: "admin" });
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => {
    request.headers.set("cookie", f.identities.learner.cookie);
    await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    return f.catalog;
  } });
  await expect(service.read(request, f.selection)).rejects.toMatchObject({ status: 401 });
});

it("rechecks guardian revocation after catalog I/O before releasing a child-practice source", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, studentRelease: true, loadCatalog: async () => {
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); });
    return f.catalog;
  } });
  await expect(service.read(f.request("/api/reference", { who: "multi", handle: entered.handle }), { ...f.selection, mode: "child-practice" })).rejects.toMatchObject({ status: 404 });
});

it("does not borrow a replacement child context from mutable request headers after a real switch", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  const request = f.request("/api/reference", { who: "multi", handle: entered.handle });
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, studentRelease: true, loadCatalog: async () => {
    const next = await f.runtime.practice.switch(f.request("/api/practice/switch", { who: "multi", method: "POST", handle: entered.handle }), { studentId: f.students[1].id });
    request.headers.set("X-Practice-Context", next.handle);
    return f.catalog;
  } });
  await expect(service.read(request, { ...f.selection, mode: "child-practice" })).rejects.toMatchObject({ status: 404 });
});

it("rejects and cancels a catalog stream whose getter settles beyond the monotonic deadline", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const stream = new ReadableStream<Uint8Array>(), cancel = vi.spyOn(stream, "cancel");
  const load = createReferenceCatalogLoader({ sha256: "a".repeat(64), get: async () => { now = 10_001; return stream; } });
  await expect(load()).rejects.toBeInstanceOf(ReferenceUnavailable);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
});

it("never returns partial catalog on a stream exception and redacts getter/decoder details", async () => {
  const payload = new TextEncoder().encode('{"schema":"reference-catalog/v1",');
  const original = new Error("synthetic-private-getter-details");
  const bad = createReferenceCatalogLoader({ sha256: sha(payload), get: async () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(payload); c.error(original); } }) });
  await expect(bad()).rejects.toMatchObject({ name: "ReferenceUnavailable", message: "Reference unavailable" });
  const thrown = createReferenceCatalogLoader({ sha256: "a".repeat(64), get: async () => { throw original; } });
  await expect(thrown()).rejects.toMatchObject({ name: "ReferenceUnavailable", message: "Reference unavailable" });
});
