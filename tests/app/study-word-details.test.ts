import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudyWordDetailsService } from "../../src/server/study/word-details-service";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const row = (v: number, n: number, word: string) => `Gen.1.${v}#${n}=L\t${word}\tDISCARDED\tSynthetic occurrence ${n}\t{H0001}\tHNcmsa\t`;
const book = parseTahot([1, 2, 3].flatMap(v => [row(v, 1, "בָּג"), row(v, 2, "דָּג")]).join("\n"), "Gen");
const lexicon = parseTbesh("H0001#1\tH0001\tH0001\tבָּג\tDISCARDED\tHVqp3ms\tSynthetic dictionary\tDISCARDED");
const page = async (request: StudyRequest): Promise<StudyPage> => ({ offset: request.offset, nextOffset: null, totalVerses: request.verses.length,
  verses: [{ ref: request.verses[request.offset], hebrew: normalizeHebrew("בָּ֑ג דָּ֖ג׃"), english: null }], translation: { key: "jps2023", status: "unavailable" }, chapters: [] });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return a;
  });
  const source: StepSourceLoader = { book: vi.fn(async () => book), lexicon: vi.fn(async () => lexicon) }, loadText = vi.fn(page);
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const build = (sources = source, load: typeof page = loadText) => createStudyWordDetailsService({ access: f.service, practice: f.runtime.practice, loadText: load, source: sources });
  const service = build(), dispatch = createHttpDispatcher(async action => action({ ...f.runtime, studyWordDetails: service }));
  const path = (index: string | number = 0, mode = "admin", extra = "") => `/api/students/${selection.studentId}/study-word-details?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0&wordIndex=${index}${extra}`;
  return { ...f, assignment, source, loadText, selection, service, build, dispatch, path };
}

test("real SDK authority returns only the selected closed detail and small authority envelope in each existing mode", async () => {
  const f = await fixture();
  for (const [mode, who] of [["admin", "admin"], ["tutor", "multi"], ["parent", "multi"], ["student", "learner"]] as const) {
    const response = await f.dispatch(f.request(f.path(1, mode), { who })); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "studentId", "studentRevision", "wordDetails"]);
    expect(body.wordDetails).toMatchObject({ status: "ready", ref: "Genesis 1:1", wordIndex: 1, wordCount: 2, occurrence: { gloss: "Synthetic occurrence 2", grammar: { morphemes: [{ partOfSpeech: "noun" }] } }, dictionary: [{ dictionaryGloss: "Synthetic dictionary" }] });
    expect(JSON.stringify(body)).not.toMatch(/DISCARDED|authSession|tenantId|userId|raw|variant|transliteration|chapters|segments|english|readingText"/);
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(32768);
  }
});

test("strict methods, word indexes, duplicate/foreign query keys and body claims are rejected before public source work", async () => {
  const f = await fixture(), scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Unexpected runtime"); }), dispatch = createHttpDispatcher(scope);
  for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "DELETE"]) expect((await dispatch(new Request(`http://localhost:3000${f.path()}`, { method }))).status).toBe(405);
  expect(scope).not.toHaveBeenCalled();
  for (const index of ["00", "-1", "512", "1.5", "1e0", "", "NaN"]) expect((await f.dispatch(f.request(f.path(index), { who: "admin" }))).status).toBe(400);
  for (const extra of ["&wordIndex=1", "&ref=Genesis%201%3A2", "&url=https%3A%2F%2Fexample.test", "&text=unused", "&handle=unused"]) expect((await f.dispatch(f.request(f.path(0, "admin", extra), { who: "admin" }))).status).toBe(400);
  expect((await f.dispatch(f.request(f.path(), { who: "admin", headers: { "content-length": "1" } }))).status).toBe(400);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.source.book).not.toHaveBeenCalled();
  // Syntactically bounded but nonexistent word fails after authorized text and before STEP.
  expect((await f.dispatch(f.request(f.path(2), { who: "admin" }))).status).toBe(400); expect(f.source.book).not.toHaveBeenCalled();
});

test("denials and stale assignment never acquire text or STEP sources", async () => {
  const f = await fixture();
  for (const [who, mode, status] of [["anonymous", "admin", 401], ["multi", "admin", 403], ["multi", "child-practice", 404]] as const) expect((await f.dispatch(f.request(f.path(0, mode), { who }))).status).toBe(status);
  expect((await f.dispatch(f.request(f.path().replace("assignmentRevision=1", "assignmentRevision=2"), { who: "admin" }))).status).toBe(409);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.source.book).not.toHaveBeenCalled(); expect(f.source.lexicon).not.toHaveBeenCalled();
});

test("original second authorization detects assignment/student/grant changes while sources load", async () => {
  const f = await fixture();
  for (const mutate of [
    () => f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)),
    () => f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id)),
    () => f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id)),
  ]) {
    const [current] = await f.owner(() => f.db.select().from(s.assignment).where(eq(s.assignment.id, f.assignment.id)));
    const service = f.build({ book: async () => { await f.owner(async () => { await mutate(); }); return book; }, lexicon: async () => lexicon });
    expect(await service.read(f.request("/api/word-details", { who: "admin" }), { ...f.selection, assignmentRevision: current.revision }, 0)).toEqual({ ok: false, code: "stale-revision" });
  }
});

test("source failure is a closed unavailable detail but does not skip the final session/authority pass", async () => {
  const f = await fixture();
  const service = f.build({ book: async () => { throw new Error("SYNTHETIC_PRIVATE_DETAILS"); }, lexicon: async () => lexicon });
  const result = await service.read(f.request("/api/word-details", { who: "admin" }), f.selection, 0);
  expect(result.ok && result.wordDetails).toMatchObject({ status: "unavailable", reason: "source-unavailable" }); expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
  const expired = f.build({ book: async () => { await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId)); }); throw new Error("SYNTHETIC_PRIVATE_DETAILS"); }, lexicon: async () => lexicon });
  await expect(expired.read(f.request("/api/word-details", { who: "admin" }), f.selection, 0)).rejects.toMatchObject({ status: 401 });
});

test("snapshots request selection/index before await and never shares a selected-word slot across concurrent reads", async () => {
  const f = await fixture(), request = f.request("/api/word-details", { who: "admin" }), selection = { ...f.selection };
  let release!: () => void, entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const service = f.build(f.source, async input => { entered(); await gate; return page(input); }); let index = 0;
  const first = service.read(request, selection, index); await started; selection.offset = 1; selection.mode = "student" as "admin"; request.headers.delete("cookie"); index = 1;
  const second = service.read(f.request("/api/word-details", { who: "admin" }), f.selection, index); release();
  const [a, b] = await Promise.all([first, second]); expect(a.ok && a.wordDetails).toMatchObject({ ref: "Genesis 1:1", wordIndex: 0, occurrence: { gloss: "Synthetic occurrence 1" } });
  expect(b.ok && b.wordDetails).toMatchObject({ ref: "Genesis 1:1", wordIndex: 1, occurrence: { gloss: "Synthetic occurrence 2" } });
});

test("aborted source and wrong text target cannot become authorized selected-word data", async () => {
  const f = await fixture(), controller = new AbortController();
  const abort = f.build({ book: async () => { controller.abort(); return book; }, lexicon: async () => lexicon });
  await expect(abort.read({ ...f.request("/api/word-details", { who: "admin" }), url: "http://localhost:3000/api/word-details", headers: f.request("/api/word-details", { who: "admin" }).headers, signal: controller.signal }, f.selection, 0)).rejects.toMatchObject({ code: "upstream" });
  const wrong = f.build(f.source, async input => { const value = await page(input); return { ...value, verses: [{ ...value.verses[0], ref: "Genesis 2:1" }] }; });
  await expect(wrong.read(f.request("/api/word-details", { who: "admin" }), f.selection, 0)).rejects.toMatchObject({ code: "upstream" });
});
