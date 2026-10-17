import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createReferenceAudioService } from "../../src/server/reference-audio/service";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticResponse } from "../helpers/study";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: verse, verseRef: `Genesis 1:${verse}` }))); return row;
  });
  const loadText = createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: "ra_" + "1".repeat(32), archiveFile: "Synthetic.mp3", sha256: "a".repeat(64), bytes: 4,
    verses: [1, 2, 3].map(n => ({ schema: "reference-verse/v1", ref: `Genesis 1:${n}`, table: "torah", playback: { status: "ready", asset: "ra_" + "1".repeat(32), clip: { start: 1, end: 3 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update("אָ֑ב ג׃".normalize("NFC")).digest("hex"), starts: [1, 2] }, attribution: REFERENCE_ATTRIBUTION })) }] })!;
  const request = (who: Parameters<typeof f.request>[1] = { who: "admin" }) => f.request("/api/reference", who);
  return { ...f, assignment, selection, catalog, loadText, request };
}

test("reference read reuses actual authority, projects only bound facts and keeps default student release closed", async () => {
  const f = await fixture(), loadCatalog = vi.fn(async () => f.catalog);
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog });
  const result = await service.read(f.request(), f.selection); expect(result.ok).toBe(true);
  if (!result.ok) throw 0;
  expect(result.reference.source?.asset).toBe("ra_" + "1".repeat(32));
  expect(Object.keys(result).sort()).toEqual(["assignment", "context", "mode", "ok", "reference", "studentId", "studentRevision"]);
  const offset = await service.read(f.request(), { ...f.selection, offset: 1 }); if (!offset.ok) throw 0; expect(offset.reference.verse.ref).toBe("Genesis 1:2");
  const learner = await service.read(f.request({ who: "learner" }), { ...f.selection, mode: "student" }); if (!learner.ok) throw 0; expect(learner.reference.source).toBeNull(); expect(learner.reference.verse.playback.status).toBe("unavailable");
  loadCatalog.mockClear(); await expect(service.read(f.request({ who: "anonymous" }), f.selection)).rejects.toMatchObject({ status: 401 }); expect(loadCatalog).not.toHaveBeenCalled();
  await expect(service.read(f.request({ who: "multi" }), f.selection)).rejects.toMatchObject({ status: 403 }); expect(loadCatalog).not.toHaveBeenCalled();
  expect(await service.read(f.request(), { ...f.selection, studentId: f.students[2].id })).toEqual({ ok: false, code: "stale-revision" }); expect(loadCatalog).not.toHaveBeenCalled();
});

test("assignment and grant drift during catalog I/O cannot release timing/source", async () => {
  const f = await fixture();
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => {
    await f.owner(async () => { await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)); }); return f.catalog;
  } });
  expect(await service.read(f.request(), f.selection)).toEqual({ ok: false, code: "stale-revision" });
});

test("catalog abort and child context revocation after public work suppress delivery", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000" }) }, { studentId: f.students[0].id });
  const controller = new AbortController();
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => { controller.abort(); return f.catalog; } });
  const req = f.request(); await expect(service.read({ url: req.url, headers: req.headers, signal: controller.signal }, f.selection)).rejects.toMatchObject({ code: "upstream" });
  const child = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => {
    await f.runtime.practice.exit({ url: "http://localhost:3000/api/practice/leave", method: "POST", headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000", "X-Practice-Context": entered.handle }) }); return f.catalog;
  } });
  await expect(child.read(f.request({ who: "multi", handle: entered.handle }), { ...f.selection, mode: "child-practice" })).rejects.toMatchObject({ status: 404 });
});

test("grant revision and real session expiry during catalog work preserve original authorization outcomes", async () => {
  const f = await fixture(); let expire = false;
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => {
    await f.owner(async () => { if (expire) await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.session.id, f.identities.admin.sessionId));
      else await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id)); }); return f.catalog;
  } });
  expect(await service.read(f.request(), f.selection)).toEqual({ ok: false, code: "stale-revision" });
  expire = true; await expect(service.read(f.request(), f.selection)).rejects.toMatchObject({ status: 401 });
});

test("malformed asset and stale assignment refuse catalog I/O; mutable asset selection is captured before awaiting text", async () => {
  const f = await fixture(), loadCatalog = vi.fn(async () => f.catalog);
  const service = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog });
  await expect(service.read(f.request(), { ...f.selection, asset: "../bad" })).rejects.toThrow("Reference unavailable"); expect(loadCatalog).not.toHaveBeenCalled();
  expect(await service.read(f.request(), { ...f.selection, assignmentRevision: 2 })).toEqual({ ok: false, code: "stale-revision" }); expect(loadCatalog).not.toHaveBeenCalled();
  const selection = { ...f.selection, asset: "ra_" + "1".repeat(32) };
  const captured = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: async supplied => { selection.asset = "ra_" + "2".repeat(32); return f.loadText(supplied); }, loadCatalog });
  const result = await captured.read(f.request(), selection); if (!result.ok) throw 0; expect(result.reference.source?.asset).toBe("ra_" + "1".repeat(32));
});
