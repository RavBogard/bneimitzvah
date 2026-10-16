import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudyService } from "../../src/server/study/service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createPersistentStudyCache } from "../../src/server/data/study-cache";
import { handlePortalRequest } from "../../src/server/http/portal";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticResponse } from "../helpers/study";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id,
      kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
    return row;
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => syntheticResponse());
  const load = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS });
  const service = createStudyService({ access: f.service, practice: f.runtime.practice, load });
  const runtime = { ...f.runtime, study: service };
  const path = (mode = "tutor", extra = "", studentId = f.students[0].id) => `/api/students/${studentId}/study-text?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0${extra}`;
  const call = (mode = "tutor", extra = "", options: Parameters<typeof f.request>[1] = {}) => handlePortalRequest(f.request(path(mode, extra), options), runtime).then(value => { if (!value) throw 0; return value; });
  return { ...f, assignment, fetch, load, study: service, runtime, path, call };
}

test("literal endpoint serves every authorized mode with fixed assignment/context projection and private headers", async () => {
  const f = await fixture();
  for (const [mode, who] of [["admin", "admin"], ["tutor", "multi"], ["parent", "multi"], ["student", "learner"]] as const) {
    const response = await f.call(mode, "", { who });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.json();
    expect(body.assignment).toEqual({ id: f.assignment.id, revision: 1, kind: "torah", needsReview: false });
    expect(body.verses.map((verse: { ref: string }) => verse.ref)).toEqual(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
    expect(body.chapters[0].editions.length).toBe(2);
    expect(Object.keys(body).sort()).toEqual(["assignment", "chapters", "context", "mode", "nextOffset", "offset", "studentId", "studentRevision", "totalVerses", "translation", "verses"]);
  }
  const entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000" }) }, { studentId: f.students[0].id });
  const child = await f.call("child-practice", "", { handle: entered.handle });
  expect(child.status).toBe(200); expect((await child.json()).context.id).toBe(entered.context.id);
  expect((await f.call("tutor", "", { handle: entered.handle })).status).toBe(403);
});

test("denies anonymous, foreign, unrelated, missing-role and malformed requests before public work", async () => {
  const f = await fixture();
  expect((await f.call("tutor", "", { who: "anonymous" })).status).toBe(401);
  expect((await f.call("admin")).status).toBe(403);
  for (const student of [f.students[2], f.students[3]]) {
    const response = await handlePortalRequest(f.request(f.path("tutor", "", student.id)), f.runtime);
    expect(response?.status).toBe(404);
  }
  for (const extra of ["&ref=Genesis%201", "&url=https%3A%2F%2Fexample.test", "&mode=admin", "&offset=1", "&translation=all", "&handle=secret"]) {
    expect((await f.call("tutor", extra)).status).toBe(400);
  }
  for (const replaced of [f.path().replace("offset=0", "offset=01"), f.path().replace("assignmentRevision=1", "assignmentRevision=0"), f.path().replace("kind=torah", "kind=blessing-before"), f.path().replace("translation=jps2023", "translation=all")]) {
    expect((await handlePortalRequest(f.request(replaced), f.runtime))?.status).toBe(400);
  }
  expect((await f.call("child-practice")).status).toBe(404);
  expect((await f.call("tutor", "", { method: "POST", body: {} })).status).toBe(405);
  expect(f.fetch).not.toHaveBeenCalled();
});

test("stale client assignment returns409 before fetch, corruption503, and an out-of-page offset400", async () => {
  const f = await fixture();
  const stale = f.path().replace("assignmentRevision=1", "assignmentRevision=2");
  expect((await handlePortalRequest(f.request(stale), f.runtime))?.status).toBe(409);
  expect((await handlePortalRequest(f.request(f.path().replace("offset=0", "offset=3")), f.runtime))?.status).toBe(400);
  await f.owner(async () => { await f.db.update(s.assignmentVerse).set({ verseRef: "Genesis 2:1" }).where(eq(s.assignmentVerse.ordinal, 1)); });
  expect((await f.call()).status).toBe(503); expect(f.fetch).not.toHaveBeenCalled();
});

test("revision drift during public work returns409, including grant, guardian, session expiry and needsReview changes", async () => {
  const f = await fixture();
  const mutations = [
    () => f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.tutorGrant.id)),
    () => f.db.update(s.guardian).set({ revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)),
    () => f.db.update(s.session).set({ expiresAt: new Date(Date.now() + 3600_000) }).where(eq(s.session.id, f.identities.multi.sessionId)),
    () => f.db.update(s.assignment).set({ proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: true } }).where(eq(s.assignment.id, f.assignment.id)),
  ];
  for (let index = 0; index < mutations.length; index++) {
    const study = createStudyService({ access: f.service, practice: f.runtime.practice, load: async request => {
      await f.owner(async () => { await mutations[index](); }); return f.load(request);
    } });
    const response = await handlePortalRequest(f.request(f.path(index === 1 ? "parent" : "tutor")), { ...f.runtime, study });
    expect(response?.status).toBe(409); expect(await response?.json()).toEqual({ ok: false, code: "stale-revision" });
  }
});

test("disconnects suppress final authorization/delivery even when the injected reader ignores abort", async () => {
  const f = await fixture(), controller = new AbortController();
  // Count calls with a wrapper; the production capability implementation runs.
  let calls = 0;
  const access = { ...f.service, withStudentCapability: (...args: Parameters<typeof f.service.withStudentCapability>) => { calls++; return f.service.withStudentCapability(...args); } } as typeof f.service;
  const study = createStudyService({ access, practice: f.runtime.practice, load: async request => { const page = await f.load(request); controller.abort(); return page; } });
  const response = await handlePortalRequest(new Request(`http://localhost:3000${f.path()}`, { headers: { cookie: f.identities.multi.cookie }, signal: controller.signal }), { ...f.runtime, study });
  expect(response?.status).toBe(503); expect(calls).toBe(1);
});

test("cache corruption has a fixed503 response with no fallback fetch or diagnostic leak", async () => {
  const f = await fixture();
  const study = createStudyService({ access: f.service, practice: f.runtime.practice, load: createSefariaStudyReader({ fetch: f.fetch, verseCounts: TANAKH_VERSE_COUNTS,
    cache: { ...createPersistentStudyCache(f.db), get: async () => { throw new Error("synthetic private cache diagnostic"); } } }) });
  const response = await handlePortalRequest(f.request(f.path()), { ...f.runtime, study });
  expect(response?.status).toBe(503); expect(await response?.json()).toEqual({ error: "unavailable" }); expect(f.fetch).not.toHaveBeenCalled();
});
