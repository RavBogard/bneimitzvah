import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudyWordAidsService } from "../../src/server/study/word-aids-service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import type { StudyRequest } from "../../src/server/study/types";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseStudyWordAids } from "../../src/lib/hebrew/word-aids";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { syntheticChapter } from "../helpers/study";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(verse => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: verse, verseRef: `Genesis 1:${verse}` })));
    return row;
  });
  // Invented, independently proven accented one-syllable forms; no passage text.
  const text = createSefariaStudyReader({ fetch: async () => {
    const chapter = syntheticChapter();
    return new Response(JSON.stringify({ ...chapter, versions: chapter.versions.map(version => version.language === "he" ? { ...version, text: version.text.map(() => "בָּ֑ג דָּ֖ג") } : version) }), { headers: { "content-type": "application/json" } });
  }, verseCounts: TANAKH_VERSE_COUNTS });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const path = (mode = "admin", extra = "", studentId = f.students[0].id) => `/api/students/${studentId}/study-word-aids?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0${extra}`;
  const wire = (loadText: (request: StudyRequest) => ReturnType<typeof text>) => {
    const studyWordAids = createStudyWordAidsService({ access: f.service, practice: f.runtime.practice, loadText });
    return { service: studyWordAids, dispatch: createHttpDispatcher(async action => action({ ...f.runtime, studyWordAids })) };
  };
  return { ...f, assignment, text, selection, path, wire };
}

test("review: real dispatcher rejects methods before runtime and exact query violations before text I/O", async () => {
  const f = await fixture(), runtime = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Synthetic runtime must remain unused"); });
  const early = createHttpDispatcher(runtime);
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await early(new Request(`http://localhost:3000${f.path()}`, { method }));
    expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  expect(runtime).not.toHaveBeenCalled();
  const load = vi.fn(f.text), { dispatch } = f.wire(load);
  const invalid = [f.path("admin", "&asset=ra_" + "a".repeat(32)), f.path("admin", "&ref=Genesis%201%3A1"), f.path("admin", "&text=synthetic"), f.path("admin", "&mode=student"),
    f.path("admin", "&handle=synthetic"), f.path().replace("offset=0", "offset=00"), f.path().replace("assignmentRevision=1", "assignmentRevision=0"), f.path().replace("translation=jps2023", "translation=other")];
  for (const path of invalid) expect((await dispatch(f.request(path, { who: "admin" }))).status).toBe(400);
  expect(load).not.toHaveBeenCalled();
});

test("review: actual authorized modes get only a private numeric guide bound to the selected canonical verse", async () => {
  const f = await fixture(), { dispatch } = f.wire(f.text);
  const page = await f.text({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: [1, 2, 3].map(n => `Genesis 1:${n}`), offset: 1, translation: "jps2023" });
  const verse = page.verses[0], projection = projectStudyVerse(verse.ref, verse.hebrew);
  if (projection.status !== "ready") throw new Error("Synthetic projection unavailable");
  for (const [mode, who] of [["admin", "admin"], ["student", "learner"], ["tutor", "multi"], ["parent", "multi"]] as const) {
    const response = await dispatch(f.request(f.path(mode).replace("offset=0", "offset=1"), { who }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "studentId", "studentRevision", "wordAids"]);
    expect(body.mode).toBe(mode); expect(body.wordAids.ref).toBe("Genesis 1:2");
    expect(body.wordAids.status).toBe("ready");
    expect(parseStudyWordAids(body.wordAids, { ref: verse.ref, readingTextSha256: createHash("sha256").update(projection.projection.readingText.normalize("NFC")).digest("hex"), words: projection.projection.words.map(w => w.text) })).toEqual(body.wordAids);
    const encoded = JSON.stringify(body);
    expect(encoded).not.toMatch(/[\u0590-\u05ff]/u);
    for (const forbidden of ["readingText\"", "english\"", "syllablesHe\"", "phoneme", "warnings\"", "units\"", "sessionId\"", "userId\""]) expect(encoded).not.toContain(forbidden);
  }
});

test("review: anonymous, cross-tenant, forged mode, stale selection and mixed practice context cannot reach text", async () => {
  const f = await fixture(), load = vi.fn(f.text), { dispatch } = f.wire(load);
  const entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  for (const [request, status] of [
    [f.request(f.path(), { who: "anonymous" }), 401], [f.request(f.path(), { who: "multi" }), 403],
    [f.request(f.path("tutor", "", f.students[3].id), { who: "multi" }), 404],
    [f.request(f.path().replace("assignmentRevision=1", "assignmentRevision=2"), { who: "admin" }), 409],
    [f.request(f.path("parent"), { who: "multi", handle: entered.handle }), 403],
    [f.request(f.path("child-practice", "", f.students[1].id), { who: "multi", handle: entered.handle }), 404],
  ] as const) {
    const response = await dispatch(request); expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(load).not.toHaveBeenCalled();
});

test("review: real guardian revocation during text work blocks child guide delivery", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  const { dispatch } = f.wire(async request => {
    const page = await f.text(request);
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); });
    return page;
  });
  const response = await dispatch(f.request(f.path("child-practice"), { who: "multi", handle: entered.handle }));
  expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not-found" });
});

test("review: sibling switch cannot borrow mutable replacement headers or selection for final authorization", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id });
  const original = f.request(f.path("child-practice"), { who: "multi", handle: entered.handle });
  const selection = { ...f.selection, mode: "child-practice" as const };
  const { service } = f.wire(async request => {
    const page = await f.text(request);
    const next = await f.runtime.practice.switch(f.request("/api/practice/switch", { who: "multi", method: "POST", handle: entered.handle }), { studentId: f.students[1].id });
    original.headers.set("X-Practice-Context", next.handle); selection.studentId = f.students[1].id; selection.offset = 1;
    return page;
  });
  await expect(service.read(original, selection)).rejects.toMatchObject({ status: 404 });
});

test("review: original SDK session expiration wins even when caller swaps its cookie after text starts", async () => {
  const f = await fixture(), original = f.request(f.path(), { who: "admin" });
  const { service } = f.wire(async request => {
    const page = await f.text(request); original.headers.set("cookie", f.identities.learner.cookie);
    await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    return page;
  });
  await expect(service.read(original, f.selection)).rejects.toMatchObject({ status: 401 });
});

test.each(["grant", "student", "assignment"] as const)("review: real %s revision drift during text work returns closed stale, never a numeric guide", async field => {
  const f = await fixture(), { dispatch } = f.wire(async request => {
    const page = await f.text(request);
    await f.owner(async () => {
      if (field === "grant") await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id));
      if (field === "student") await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id));
      if (field === "assignment") await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id));
    });
    return page;
  });
  const response = await dispatch(f.request(f.path(), { who: "admin" })); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ ok: false, code: "stale-revision" });
});

test("review: wrong target, abort and upstream private failure produce fixed unavailable without guide/text diagnostics", async () => {
  const f = await fixture();
  const wrong = f.wire(async request => { const page = await f.text(request); return { ...page, verses: [{ ...page.verses[0], ref: "Genesis 1:2" }] }; });
  expect((await wrong.dispatch(f.request(f.path(), { who: "admin" }))).status).toBe(503);
  const controller = new AbortController(), aborted = f.wire(async request => { const page = await f.text(request); controller.abort(); return page; });
  const request = f.request(f.path(), { who: "admin" });
  await expect(aborted.service.read({ url: request.url, headers: request.headers, signal: controller.signal }, f.selection)).rejects.toMatchObject({ code: "upstream" });
  const broken = f.wire(async () => { throw new Error("synthetic-private-text-provider-detail"); });
  const response = await broken.dispatch(f.request(f.path(), { who: "admin" }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
});
