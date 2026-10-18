import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { handlePortalRequest, portalRouteMethods } from "../../src/server/http/portal";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import { syntheticResponse } from "../helpers/study";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row;
  });
  const publicData = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(publicData.parent)))!;
  const manifest = await createShortSourceManifestLoader({ sha256: publicData.manifestSHA256, parentCatalogSHA256: publicData.parentCatalogSHA256, parentCatalogBytes: publicData.parent,
    get: async () => byteStream(publicData.manifest) })();
  const loadText = vi.fn(createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS })), loadCatalog = vi.fn(async () => catalog), loadManifest = vi.fn(async () => manifest);
  const service = (studentRelease = true) => createShortReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText, loadCatalog, loadManifest, studentRelease });
  const runtime = { ...f.runtime, shortReferenceAudio: service() }, path = `/api/students/${f.students[0].id}/reference-audio/short/page`;
  const query = { mode: "admin", kind: "torah", assignmentId: assignment.id, assignmentRevision: "1", translation: "jps2023", offset: "0" };
  const request = (changes: Record<string, string> = {}, options: Parameters<typeof f.request>[1] = { who: "admin" }) => f.request(path + "?" + new URLSearchParams({ ...query, ...changes }), options);
  const call = async (req: Request) => { const response = await handlePortalRequest(req, runtime); if (!response) throw new Error("Expected owned short route"); return response; };
  return { ...f, assignment, runtime, path, query, request, call, service, loadText, loadCatalog, loadManifest };
}
function privateResponse(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("vercel-cdn-cache-control")).toBe(false); expect(response.headers.has("access-control-allow-origin")).toBe(false);
}

test("real assigned short page returns closed private metadata, including linked-parent public read without practice", async () => {
  const f = await fixture();
  expect(portalRouteMethods(f.path)).toEqual(["GET"]);
  for (const [mode, who] of [["admin", "admin"], ["student", "learner"], ["parent", "multi"]] as const) {
    const response = await f.call(f.request({ mode }, { who })); expect(response.status).toBe(200); privateResponse(response);
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "page", "studentId", "studentRevision"]);
    expect(Object.keys(body.page).sort()).toEqual(["nextOffset", "offset", "references", "totalVerses"]); expect(body.context).toBeNull(); expect(body.mode).toBe(mode);
    expect(body.page.references).toHaveLength(3); expect(body.page.references.every((v: unknown) => parseReferenceShortResolution(v))).toBe(true);
    expect(body.page.references[0].source).not.toBeNull(); expect(body.page.references[1].source).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/archive\.org\/download|blobKey|"actor":|"hebrew":|"english":|"readingText":|catalogSha256|storeId/);
  }
  expect(f.loadText).toHaveBeenCalledTimes(3); expect(f.loadCatalog).toHaveBeenCalledTimes(3); expect(f.loadManifest).toHaveBeenCalledTimes(3);
});

test("closed query/body/method and mode boundaries refuse before any text or metadata work", async () => {
  const f = await fixture();
  const invalid: Record<string, string>[] = [{ extra: "1" }, { asset: "ra_" + "1".repeat(32) }, { offset: "01" }, { offset: "1000" }, { offset: "-1" }, { assignmentRevision: "0" },
    { translation: "other" }, { kind: "blessing-before" }, { mode: "other" }];
  for (const changes of invalid) {
    const response = await f.call(f.request(changes)); expect(response.status, Object.keys(changes)[0]).toBe(400); privateResponse(response);
  }
  expect((await f.call(f.request({ assignmentId: "fake-proposed-reading" }))).status).toBe(404);
  const duplicate = await f.call(new Request(f.request().url + "&offset=0", { headers: f.request().headers }));
  expect(duplicate.status).toBe(400);
  for (const method of ["POST", "HEAD", "OPTIONS"] as const) {
    const response = await f.call(new Request(f.request().url, { method, headers: f.request().headers })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  const framed = await f.call(new Request(f.request().url, { headers: new Headers([...f.request().headers, ["content-length", "3"]]) })); expect(framed.status).toBe(400);
  const parentHandle = await f.call(f.request({ mode: "parent" }, { who: "multi", handle: "not-entered" })); expect(parentHandle.status).toBe(403);
  const missingChildHandle = await f.call(f.request({ mode: "child-practice" }, { who: "multi" })); expect(missingChildHandle.status).toBe(404);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
});

test("actual anonymous/unrelated/host/stale authority statuses and no-store responses remain intact", async () => {
  const f = await fixture();
  const anonymous = await f.call(f.request({}, { who: "anonymous" })); expect(anonymous.status).toBe(401); privateResponse(anonymous);
  const wrongRole = await f.call(f.request({}, { who: "multi" })); expect(wrongRole.status).toBe(403);
  const other = new URL(f.request({ mode: "parent" }, { who: "multi" }).url); other.pathname = `/api/students/${f.students[2].id}/reference-audio/short/page`;
  expect((await f.call(new Request(other, { headers: f.request({}, { who: "multi" }).headers }))).status).toBe(404);
  expect((await f.call(new Request(f.request().url.replace("localhost", "unmapped.test"), { headers: f.request().headers }))).status).toBe(404);
  const stale = await f.call(f.request({ assignmentRevision: "2" })); expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ ok: false, code: "stale-revision" });
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
});

test("explicit child practice uses real selected context; released metadata does not grant assigned writes", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000" }) }, { studentId: f.students[0].id });
  const response = await f.call(f.request({ mode: "child-practice" }, { who: "multi", handle: entered.handle })); expect(response.status).toBe(200); privateResponse(response);
  const body = await response.json(); expect(body.context.id).toBe(entered.context.id); expect(body.mode).toBe("child-practice");
  expect((await f.call(f.request({ mode: "parent" }, { who: "multi", handle: entered.handle }))).status).toBe(403);
  const post = await f.call(f.request({}, { who: "multi", method: "POST", handle: entered.handle, body: { revision: 2 } })); expect(post.status).toBe(405);
});

test("manifest failure is generic503 and assignment drift after public work is409, never a partial page", async () => {
  const f = await fixture(); f.loadManifest.mockRejectedValueOnce(new Error("synthetic private provider detail"));
  const failed = await f.call(f.request()); expect(failed.status).toBe(503); privateResponse(failed); expect(await failed.text()).not.toContain("provider");
  f.loadManifest.mockImplementationOnce(async () => { await f.owner(async () => { await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)); });
    return await createShortSourceManifestLoader({ sha256: publicShortFixture().manifestSHA256, parentCatalogSHA256: publicShortFixture().parentCatalogSHA256,
      parentCatalogBytes: publicShortFixture().parent, get: async () => byteStream(publicShortFixture().manifest) })(); });
  const stale = await f.call(f.request()); expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ ok: false, code: "stale-revision" });
});

test("HTTP projection strips hidden service fields and refuses malformed descriptors or oversized results after real authorization", async () => {
  const f = await fixture(), real = f.runtime.shortReferenceAudio, sentinel = "synthetic-hidden-field";
  f.runtime.shortReferenceAudio = { ...real, readPage: async (...args) => { const value = await real.readPage(...args); if (!value.ok) return value;
    return { ...value, hidden: sentinel, assignment: { ...value.assignment, hidden: sentinel }, page: { ...value.page, hidden: sentinel } }; } };
  const projected = await f.call(f.request()); expect(projected.status).toBe(200); expect(await projected.text()).not.toContain(sentinel);
  const getter = vi.fn();
  f.runtime.shortReferenceAudio = { ...real, readPage: async (...args) => { const value = await real.readPage(...args); if (!value.ok) return value;
    const reference = Object.defineProperty({ ...value.page.references[0] }, "source", { get: getter });
    return { ...value, page: { ...value.page, references: [reference, ...value.page.references.slice(1)] } }; } };
  const malformed = await f.call(f.request()); expect(malformed.status).toBe(503); privateResponse(malformed); expect(getter).not.toHaveBeenCalled();
  f.runtime.shortReferenceAudio = { ...real, readPage: async (...args) => { const value = await real.readPage(...args); return value.ok ? { ...value, studentId: "x".repeat(1024 * 1024) } : value; } };
  const oversized = await f.call(f.request()); expect(oversized.status).toBe(503); privateResponse(oversized);
});
