import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { createReferenceAudioService } from "../../src/server/reference-audio/service";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createRuntimeReferenceLoader } from "../../src/server/runtime/composition";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { parseReferenceResolution } from "../../src/lib/reference-audio/source";
import { syntheticResponse } from "../helpers/study";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(ends?: number[]) {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row;
  });
  const catalog = parseReferenceCatalog({ schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: "ra_" + "1".repeat(32), archiveFile: "Synthetic.mp3", sha256: "a".repeat(64), bytes: 4,
    verses: [1, 2, 3].map(n => ({ schema: "reference-verse/v1", ref: `Genesis 1:${n}`, table: "torah", playback: { status: "ready", asset: "ra_" + "1".repeat(32), clip: { start: 1, end: 3 } }, words: { status: "ready", readingTextSha256: createHash("sha256").update("אָ֑ב ג׃".normalize("NFC")).digest("hex"), starts: [1, 2], ...(ends ? { ends } : {}) }, attribution: REFERENCE_ATTRIBUTION })) }] })!;
  const loadText = vi.fn(createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS })), loadCatalog = vi.fn(async () => catalog);
  const referenceAudio = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText, loadCatalog });
  const runtime = { ...f.runtime, referenceAudio }, scope: HttpRuntimeScope = async action => action(runtime), dispatch = createHttpDispatcher(scope);
  const path = (mode = "admin", studentId = f.students[0].id, extra = "") => `/api/students/${studentId}/reference-audio?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0${extra}`;
  return { ...f, assignment, catalog, runtime, dispatch, path, loadText, loadCatalog };
}

test("real dispatcher admits only exact GET/query; wrong methods and malformed inputs cause no text/catalog I/O", async () => {
  const f = await fixture();
  const unused = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Unexpected runtime"); }), beforeRuntime = createHttpDispatcher(unused);
  for (const method of ["HEAD", "POST", "PUT", "OPTIONS", "DELETE"]) {
    const response = await beforeRuntime(new Request(`http://localhost:3000${f.path()}`, { method })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  expect(unused).not.toHaveBeenCalled();
  for (const extra of ["&asset=../bad", "&asset=", "&url=https%3A%2F%2Fexample.test", "&preview=true", "&mode=admin", "&handle=hidden"]) {
    expect((await f.dispatch(f.request(f.path("admin", undefined, extra), { who: "admin" }))).status).toBe(400);
  }
  for (const path of [f.path().replace("offset=0", "offset=00"), f.path().replace("assignmentRevision=1", "assignmentRevision=0"), f.path().replace("kind=torah", "kind=all"), f.path().replace("translation=jps2023", "translation=other")]) expect((await f.dispatch(f.request(path, { who: "admin" }))).status).toBe(400);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled();
});

test("HTTP emits the exact private reference projection, admin-only source by default, and no page/catalog payload", async () => {
  const f = await fixture(), response = await f.dispatch(f.request(f.path(), { who: "admin" })); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "reference", "studentId", "studentRevision"]);
  expect(parseReferenceResolution(body.reference)?.source?.asset).toBe("ra_" + "1".repeat(32)); expect(JSON.stringify(body)).not.toContain("readingText\""); expect(JSON.stringify(body)).not.toContain("assets\"");
  const learner = await f.dispatch(f.request(f.path("student"), { who: "learner" })); expect(learner.status).toBe(200); expect((await learner.json()).reference.source).toBeNull();
  expect((await f.dispatch(f.request(f.path("admin"), { who: "multi" }))).status).toBe(403);
  expect((await f.dispatch(f.request(f.path(), { who: "anonymous" }))).status).toBe(401);
  expect((await f.dispatch(f.request(f.path("tutor", f.students[3].id)))).status).toBe(404);
  const stale = await f.dispatch(f.request(f.path().replace("assignmentRevision=1", "assignmentRevision=2"), { who: "admin" })); expect(stale.status).toBe(409); expect(await stale.json()).toEqual({ ok: false, code: "stale-revision" });
});

test("scoped child may read held default result but revoked/mixed contexts and late authority cannot disclose", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000" }) }, { studentId: f.students[0].id });
  const response = await f.dispatch(f.request(f.path("child-practice"), { handle: entered.handle })); expect(response.status).toBe(200); const body = await response.json(); expect(body.context.id).toBe(entered.context.id); expect(body.reference.source).toBeNull();
  expect((await f.dispatch(f.request(f.path("tutor"), { handle: entered.handle }))).status).toBe(403);
  const referenceAudio = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: async () => {
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); }); return f.catalog;
  } });
  const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, referenceAudio }));
  const denied = await dispatch(f.request(f.path("child-practice"), { handle: entered.handle })); expect(denied.status).toBe(404); expect(await denied.json()).toEqual({ error: "not-found" });
});

test("unconfigured and malformed provider responses yield only fixed unavailable; other portal routes stay healthy", async () => {
  const f = await fixture(), referenceAudio = createReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: f.loadText, loadCatalog: createRuntimeReferenceLoader(undefined) });
  const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, referenceAudio }));
  const unavailable = await dispatch(f.request(f.path(), { who: "admin" })); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ error: "unavailable" });
  expect((await dispatch(f.request(`/api/students/${f.students[0].id}?mode=admin`, { who: "admin" }))).status).toBe(200);
});

test("HTTP keeps measured word ends beside starts, and emits none for a v1 catalog", async () => {
  const measured = await fixture([1.8, 3]), body = await (await measured.dispatch(measured.request(measured.path(), { who: "admin" }))).json();
  expect(body.reference.verse.words).toMatchObject({ status: "ready", starts: [1, 2], ends: [1.8, 3] });
  expect(parseReferenceResolution(body.reference)?.verse.words).toMatchObject({ ends: [1.8, 3] });
  const v1 = await fixture(), plain = await (await v1.dispatch(v1.request(v1.path(), { who: "admin" }))).json();
  expect(plain.reference.verse.words.status).toBe("ready"); expect("ends" in plain.reference.verse.words).toBe(false);
});
