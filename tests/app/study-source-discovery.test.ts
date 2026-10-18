import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudySourceDiscoveryService } from "../../src/server/study/source-discovery-service";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { discoverRelatedPage } from "../../src/server/study/sources/discovery";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const page = async (r: StudyRequest): Promise<StudyPage> => ({ offset: r.offset, nextOffset: null, totalVerses: r.verses.length,
  verses: [{ ref: r.verses[r.offset], hebrew: normalizeHebrew("בָּ֑ג דָּ֖ג׃"), english: null }], translation: { key: "jps2023", status: "unavailable" }, chapters: [] });
async function fixture(kind: "torah" | "haftarah" = "torah") {
  const f = await portalRoutesFixture(); fixtures.push(f); const ref = kind === "torah" ? "Genesis 1:1" : "Isaiah 1:1";
  const assignment = await f.owner(async () => {
    const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind, basis: "custom", ref, status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: 1, verseRef: ref }); return a;
  });
  const raw = Array.from({ length: 21 }, (_, i) => ({ _id: `source_${String(i).padStart(4,"0")}`, sourceRef: `Synthetic Work ${i}`, index_title: "Synthetic Work", category: "Commentary", anchorRef: ref }));
  const fetch = vi.fn(async () => new Response(JSON.stringify(raw), { headers: { "content-type": "application/json" } }));
  const related = createSefariaMetadataReader({ fetch: fetch as typeof globalThis.fetch }).related, loadText = vi.fn(page);
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const build = (read: typeof related = related, load: typeof page = loadText) => createStudySourceDiscoveryService({ access: f.service, practice: f.runtime.practice, loadText: load, related: read });
  const service = build(), dispatch = createHttpDispatcher(async action => action({ ...f.runtime, studySources: service }));
  const path = (offset: string | number = 0, hash?: string, mode = "admin", extra = "") => `/api/students/${selection.studentId}/study-sources?mode=${mode}&kind=${kind}&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0&sourceOffset=${offset}${hash ? `&catalogHash=${hash}` : ""}${extra}`;
  return { ...f, assignment, selection, ref, fetch, loadText, related, build, service, dispatch, path };
}
test("actual SDK and official reader deliver closed assigned Torah and haftarah pages in all existing modes", async () => {
  for (const kind of ["torah", "haftarah"] as const) {
    const f = await fixture(kind);
    for (const [mode, who] of [["admin", "admin"], ["tutor", "multi"], ["parent", "multi"], ["student", "learner"]] as const) {
      const response = await f.dispatch(f.request(f.path(0, undefined, mode), { who })); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
      const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "sources", "studentId", "studentRevision"]);
      expect(body.sources).toMatchObject({ ref: f.ref, pageSize: 10, totalEntries: 21, nextSourceOffset: 10 });
      const second = await f.dispatch(f.request(f.path(10, body.sources.catalogHash, mode), { who })); expect(second.status).toBe(200); expect((await second.json()).sources.entries[0].id).toBe("source_0010");
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(65536);
    }
    expect(f.fetch).toHaveBeenCalledTimes(8);
  }
});
test("strict methods, query, offsets and bodies fail without metadata work", async () => {
  const f = await fixture(), scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Unexpected runtime"); }), dispatch = createHttpDispatcher(scope);
  for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "DELETE"]) expect((await dispatch(new Request(`http://localhost:3000${f.path()}`, { method }))).status).toBe(405); expect(scope).not.toHaveBeenCalled();
  for (const offset of ["", "00", "1", "4091", "4100", "-10", "1e1"]) expect((await f.dispatch(f.request(f.path(offset), { who: "admin" }))).status).toBe(400);
  for (const path of [f.path(10), f.path().replace("&sourceOffset=0", ""), f.path(0, "A".repeat(64)), f.path(0, undefined, "admin", "&sourceOffset=0"), f.path(0, undefined, "admin", "&ref=Genesis%201%3A2"), f.path(0, undefined, "admin", "&url=unused")]) expect((await f.dispatch(f.request(path, { who: "admin" }))).status).toBe(400);
  expect((await f.dispatch(f.request(f.path(), { who: "admin", headers: { "content-length": "1" } }))).status).toBe(400); expect(f.loadText).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
test("initial denial and stale assignment never fetch text or metadata", async () => {
  const f = await fixture();
  for (const [who, mode, status] of [["anonymous", "admin", 401], ["multi", "admin", 403], ["multi", "child-practice", 404]] as const) expect((await f.dispatch(f.request(f.path(0, undefined, mode), { who }))).status).toBe(status);
  expect((await f.dispatch(f.request(f.path().replace("assignmentRevision=1", "assignmentRevision=2"), { who: "admin" }))).status).toBe(409); expect(f.loadText).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});
test("all staged catalog outcomes yield to the original expired session final check", async () => {
  for (const outcome of ["unavailable", "malformed", "changed", "bounds"]) {
    const f = await fixture(), empty = parseRelatedMetadata([], f.ref), projected = discoverRelatedPage(empty, f.ref, { sourceOffset: 0 }); if (projected.status !== "ready") throw new Error("Expected empty");
    const service = f.build(async () => {
      await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
      if (outcome === "unavailable") throw new Error("PRIVATE_SOURCE_ERROR"); return outcome === "malformed" ? { ...empty, verse: "Genesis 1:2" } : empty;
    });
    await expect(service.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: outcome === "bounds" ? 10 : 0,
      ...(outcome === "bounds" ? { catalogHash: projected.page.catalogHash } : outcome === "changed" ? { catalogHash: "0".repeat(64) } : {}) })).rejects.toMatchObject({ status: 401 });
  }
});
test("authorized source failure, catalog change and matching invalid page are distinct closed outcomes", async () => {
  const f = await fixture(); await expect(f.build(async () => { throw new Error("PRIVATE_SOURCE_ERROR"); }).read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 0 })).rejects.toMatchObject({ code: "upstream" });
  const first = await f.service.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 0 }); if (!first.ok) throw new Error("Expected page");
  await expect(f.service.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 30, catalogHash: first.sources.catalogHash })).rejects.toMatchObject({ code: "invalid-request" });
  const response = await f.dispatch(f.request(f.path(0, "0".repeat(64)), { who: "admin" })); expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: "source-catalog-changed" });
});
test("original header, selection and paging snapshots survive mutation; final assignment drift still refuses", async () => {
  const f = await fixture(); let entered!: () => void, release!: () => void; const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const service = f.build(async (ref, signal) => { entered(); await gate; return f.related(ref, signal); }), paging = { sourceOffset: 0 }, selection = { ...f.selection }, request = f.request("/api/sources", { who: "admin" });
  const pending = service.read(request, selection, paging); await started; paging.sourceOffset = 10; selection.offset = 1; request.headers.delete("cookie"); release(); const result = await pending; expect(result.ok && result.sources.sourceOffset).toBe(0);
  const stale = f.build(async () => { await f.owner(async () => { await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)); }); throw new Error("PRIVATE"); });
  expect(await stale.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 0 })).toEqual({ ok: false, code: "stale-revision" });
});
test("wrong text target and caller abort cannot produce an authorized page", async () => {
  const f = await fixture(), wrong = f.build(f.related, async input => { const p = await page(input); return { ...p, verses: [{ ...p.verses[0], ref: "Genesis 1:2" }] }; });
  await expect(wrong.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 0 })).rejects.toMatchObject({ code: "upstream" }); expect(f.fetch).not.toHaveBeenCalled();
  const controller = new AbortController(), service = f.build(async ref => { controller.abort(); return parseRelatedMetadata([], ref); }), request = f.request("/api/sources", { who: "admin" });
  await expect(service.read({ url: request.url, headers: request.headers, signal: controller.signal }, f.selection, { sourceOffset: 0 })).rejects.toMatchObject({ code: "upstream" });
});
test("mutating the returned text page while metadata is held cannot rebind the requested catalog", async () => {
  const f = await fixture(); let entered!: () => void, release!: () => void, mutate!: () => void;
  const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { release = r; });
  const related = vi.fn(async (ref: string) => { entered(); await gate; return parseRelatedMetadata([], ref); });
  const service = f.build(related, async request => { const value = await page(request), loaded = { ...value, verses: value.verses.map(v => ({ ...v })) };
    mutate = () => { loaded.verses[0].ref = "Genesis 1:2"; }; return loaded; });
  const pending = service.read(f.request("/api/sources", { who: "admin" }), f.selection, { sourceOffset: 0 });
  await started; mutate(); release();
  const result = await pending; expect(related.mock.calls[0][0]).toBe(f.ref); expect(result.ok && result.sources.ref).toBe(f.ref);
});
