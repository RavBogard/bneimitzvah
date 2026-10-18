import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudyWordAidsService } from "../../src/server/study/word-aids-service";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { parseStudyWordAids } from "../../src/lib/hebrew/word-aids";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";
import { syntheticResponse } from "../helpers/study";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row;
  });
  const text = createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS }), loadText = vi.fn(text);
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const build = (load: (request: StudyRequest) => Promise<StudyPage> = loadText) => createStudyWordAidsService({ access: f.service, practice: f.runtime.practice, loadText: load });
  const aidService = build(), runtime = { ...f.runtime, studyWordAids: aidService }, dispatch = createHttpDispatcher(async action => action(runtime));
  const path = (mode = "admin", extra = "", id = selection.studentId) => `/api/students/${id}/study-word-aids?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0${extra}`;
  return { ...f, assignment, selection, loadText, text, aidService, build, runtime, dispatch, path };
}

test("actual SDK authority delivers only the bound numeric guide for every existing mode and offset", async () => {
  const f = await fixture();
  for (const [mode, who] of [["admin", "admin"], ["tutor", "multi"], ["parent", "multi"], ["student", "learner"]] as const) {
    const response = await f.dispatch(f.request(f.path(mode), { who })); expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "studentId", "studentRevision", "wordAids"]);
    expect(body.mode).toBe(mode); expect(body.context).toBeNull(); expect(body.assignment).toEqual({ id: f.assignment.id, revision: 1, kind: "torah", needsReview: true });
    const page = await f.text({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" }), target = page.verses[0];
    const projection = projectStudyVerse(target.ref, target.hebrew); if (projection.status !== "ready") throw 0;
    expect(parseStudyWordAids(body.wordAids, { ref: target.ref, readingTextSha256: createHash("sha256").update(projection.projection.readingText.normalize("NFC")).digest("hex"), words: projection.projection.words.map(w => w.text) })).toEqual(body.wordAids);
    expect(JSON.stringify(body)).not.toMatch(/[א-ת]|Synthetic example|readingText"|segments|chapters|authSession|warnings|engine|transliteration/);
  }
  const result = await f.aidService.read(f.request("/api/word-aids", { who: "admin" }), { ...f.selection, offset: 1 });
  if (!result.ok) throw 0; expect(result.wordAids.ref).toBe("Genesis 1:2"); expect(Object.isFrozen(result) && Object.isFrozen(result.wordAids)).toBe(true);
});

test("strict method and identical study-query grammar reject before runtime or text work", async () => {
  const f = await fixture(), scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Unexpected runtime"); }), dispatch = createHttpDispatcher(scope);
  for (const method of ["HEAD", "OPTIONS", "POST", "PATCH", "PUT", "DELETE"]) {
    const response = await dispatch(new Request(`http://localhost:3000${f.path()}`, { method })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET");
  }
  expect(scope).not.toHaveBeenCalled();
  for (const extra of ["&ref=Genesis%201%3A2", "&url=https%3A%2F%2Fexample.test", "&asset=ignored", "&text=ignored", "&mode=admin", "&offset=1", "&handle=ignored"]) expect((await f.dispatch(f.request(f.path("admin", extra), { who: "admin" }))).status).toBe(400);
  for (const pathname of [f.path().replace("offset=0", "offset=00"), f.path().replace("assignmentRevision=1", "assignmentRevision=0"), f.path().replace("kind=torah", "kind=all"), f.path().replace("translation=jps2023", "translation=other")]) expect((await f.dispatch(f.request(pathname, { who: "admin" }))).status).toBe(400);
  expect(f.loadText).not.toHaveBeenCalled();
});

test("anonymous, foreign, unrelated, missing-role, stale and malformed selections never load text", async () => {
  const f = await fixture();
  for (const [pathname, who, status] of [[f.path(), "anonymous", 401], [f.path(), "multi", 403], [f.path("tutor", "", f.students[2].id), "multi", 404], [f.path("tutor", "", f.students[3].id), "multi", 404], [f.path("child-practice"), "multi", 404], [f.path().replace("assignmentRevision=1", "assignmentRevision=2"), "admin", 409], [f.path().replace("offset=0", "offset=3"), "admin", 400]] as const) expect((await f.dispatch(f.request(pathname, { who }))).status).toBe(status);
  expect(f.loadText).not.toHaveBeenCalled();
});

test("assignment, student, role and provenance drift while text loads is rechecked before guide delivery", async () => {
  const f = await fixture();
  for (const mutate of [
    () => f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)),
    () => f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id)),
    () => f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id)),
    () => f.db.update(s.assignment).set({ proposalSnapshot: { confirmationDate: "2026-12-26", needsReview: false } }).where(eq(s.assignment.id, f.assignment.id)),
  ]) {
    const [current] = await f.owner(() => f.db.select().from(s.assignment).where(eq(s.assignment.id, f.assignment.id)));
    const service = f.build(async request => { const page = await f.text(request); await f.owner(async () => { await mutate(); }); return page; });
    expect(await service.read(f.request("/api/word-aids", { who: "admin" }), { ...f.selection, assignmentRevision: current.revision })).toEqual({ ok: false, code: "stale-revision" });
  }
});

test("real session expiry after loading preserves401, not a successful or guessed unavailable guide", async () => {
  const f = await fixture(), studyWordAids = f.build(async request => { const page = await f.text(request); await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.session.id, f.identities.admin.sessionId)); }); return page; });
  const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, studyWordAids })), response = await dispatch(f.request(f.path(), { who: "admin" }));
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: "authentication-required" });
});

test("wrong target or reader failure is fixed503; a legitimate reconstruction hold remains authorized200", async () => {
  const f = await fixture();
  for (const variant of ["target", "failure", "held"] as const) {
    const studyWordAids = f.build(async request => { if (variant === "failure") throw new Error("SYNTHETIC_PRIVATE_DETAIL"); const page = await f.text(request), first = page.verses[0];
      return { ...page, verses: [{ ...first, ref: variant === "target" ? "Genesis 2:1" : first.ref, hebrew: variant === "held" ? { ...first.hebrew, readingText: "mismatch" } : first.hebrew }, ...page.verses.slice(1)] }; });
    const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, studyWordAids })), response = await dispatch(f.request(f.path(), { who: "admin" }));
    expect(response.status).toBe(variant === "held" ? 200 : 503); const body = await response.json();
    if (variant === "held") expect(body.wordAids).toEqual({ schema: "study-word-aids/v1", ref: "Genesis 1:1", status: "unavailable", reason: "reconstruction" }); else expect(body).toEqual({ error: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC_PRIVATE_DETAIL");
  }
});

test("ignored abort suppresses analysis delivery and mutable request selection is snapshotted before loading", async () => {
  const f = await fixture(), controller = new AbortController(); let passes = 0;
  const access = { ...f.service, withStudentCapability: (...args: Parameters<typeof f.service.withStudentCapability>) => { passes++; return f.service.withStudentCapability(...args); } } as typeof f.service;
  const aborted = createStudyWordAidsService({ access, practice: f.runtime.practice, loadText: async request => { const page = await f.text(request); controller.abort(); return page; } });
  const request = f.request("/api/word-aids", { who: "admin" }); await expect(aborted.read({ url: request.url, headers: request.headers, signal: controller.signal }, f.selection)).rejects.toMatchObject({ code: "upstream" }); expect(passes).toBe(1);
  const selection = { ...f.selection }, captured = f.build(async supplied => { selection.offset = 1; selection.assignmentId = f.students[1].id; request.headers.set("X-Practice-Context", "unused"); return f.text(supplied); });
  const result = await captured.read(request, selection); if (!result.ok) throw 0; expect(result.wordAids.ref).toBe("Genesis 1:1");
});
