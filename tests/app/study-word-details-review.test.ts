import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { createStudyWordDetailsService } from "../../src/server/study/word-details-service";
import { createStepSourceLoader, type StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { STEP_SOURCE_MANIFEST } from "../../src/server/study/lexical/source-manifest";
import { parseTahot, parseTbesh, type StepVerse } from "../../src/server/study/lexical/step";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { parseStudyWordDetails } from "../../src/lib/hebrew/word-details";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const text = "דָּג בָּג", words = text.normalize("NFC").split(" ");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const bookText = [1, 2].flatMap(verse => words.map((word, i) => `Gen.1.${verse}#${i + 1}=L\t${word}\tDISCARDED\tInvented occurrence ${i}\t{H000${i + 2}}/H9001\tHNcmsa\t`)).join("\n");
// Dictionary grammar is deliberately a verb: occurrence grammar must stay a noun.
const lexText = words.map((word, i) => `H000${i + 2}#1\tH000${i + 2}\tH000${i + 2}\t${word}\tDISCARDED\tHVqp3ms\tInvented dictionary ${i}`).join("\n");
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2].map(ordinal => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal, verseRef: `Genesis 1:${ordinal}` }))); return row;
  });
  const books = { ...STEP_SOURCE_MANIFEST.torah, bytes: Buffer.byteLength(bookText), sha256: sha(bookText) }, lexicon = { ...STEP_SOURCE_MANIFEST.lexicon, bytes: Buffer.byteLength(lexText), sha256: sha(lexText) };
  const sourceFetch = vi.fn(async (url: string) => { const response = new Response(url === lexicon.url ? lexText : bookText); Object.defineProperty(response, "url", { value: url }); return response; });
  const source = createStepSourceLoader({ books: { Gen: books }, lexicon, fetch: sourceFetch, parseBook: parseTahot, parseLexicon: parseTbesh });
  const loadText = vi.fn(async (request: StudyRequest): Promise<StudyPage> => ({ offset: request.offset, nextOffset: null, totalVerses: request.verses.length,
    verses: [{ ref: request.verses[request.offset], hebrew: normalizeHebrew(text), english: "Synthetic private authorized verse translation" }], translation: { key: "jps2023", status: "available" }, chapters: [] }));
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const path = (mode = "admin", extra = "", studentId = f.students[0].id) => `/api/students/${studentId}/study-word-details?mode=${mode}&kind=torah&assignmentId=${assignment.id}&assignmentRevision=1&translation=jps2023&offset=0&wordIndex=0${extra}`;
  const wire = (injectedSource: StepSourceLoader = source, load: typeof loadText | ((request: StudyRequest) => Promise<StudyPage>) = loadText) => {
    const service = createStudyWordDetailsService({ access: f.service, practice: f.runtime.practice, loadText: load, source: injectedSource });
    return { service, dispatch: createHttpDispatcher(async action => action({ ...f.runtime, studyWordDetails: service })) };
  };
  const held = () => { const entered = deferred<void>(), release = deferred<readonly StepVerse[]>();
    const heldSource: StepSourceLoader = { book: async () => { entered.resolve(); return release.promise; }, lexicon: signal => source.lexicon(signal) };
    return { ...wire(heldSource), ready: entered.promise, release: async () => { release.resolve(await source.book("Gen")); } };
  };
  return { ...f, assignment, source, sourceFetch, loadText, selection, path, wire, held };
}

test("review actual authority returns only a selected bound word, with occurrence grammar distinct from dictionary sense", async () => {
  const f = await fixture(), { dispatch } = f.wire(), response = await dispatch(f.request(f.path(), { who: "admin" }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "studentId", "studentRevision", "wordDetails"]);
  const selected = parseStudyWordDetails(body.wordDetails, { ref: "Genesis 1:1", wordIndex: 0, readingTextSha256: sha(text.normalize("NFC")), words });
  expect(selected?.status).toBe("ready"); if (selected?.status !== "ready") throw 0;
  expect(selected.occurrence).toMatchObject({ gloss: "Invented occurrence 0", grammar: { status: "ready", morphemes: [{ partOfSpeech: "noun" }] } });
  expect(selected.dictionary).toEqual([{ lemma: "H0002", status: "ready", headword: words[0], dictionaryGloss: "Invented dictionary 0" }]);
  expect(JSON.stringify(body)).not.toMatch(/DISCARDED|H9001|variant|transliteration|\bipa\b|authSession|readingText"|segments|chapters|Synthetic private/);
});

test("review methods and strict selected-index/query grammar stop before runtime or any text/source I/O", async () => {
  const f = await fixture(), runtime = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Synthetic runtime must remain unused"); }), early = createHttpDispatcher(runtime);
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) { const response = await early(new Request(`http://localhost:3000${f.path()}`, { method })); expect(response.status).toBe(405); expect(response.headers.get("allow")).toBe("GET"); }
  expect(runtime).not.toHaveBeenCalled(); const { dispatch } = f.wire();
  for (const query of [f.path().replace("&wordIndex=0", ""), ...["-1", "-0", "00", "1.0", "1e0", "512", "NaN"].map(index => f.path().replace("wordIndex=0", `wordIndex=${index}`)), f.path("admin", "&wordIndex=1"), f.path("admin", "&url=ignored"), f.path("admin", "&text=ignored"), f.path("admin", "&ref=Genesis%201%3A2")]) {
    const response = await dispatch(f.request(query, { who: "admin" })); expect(response.status).toBe(400); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.sourceFetch).not.toHaveBeenCalled();
});

test("review first-pass denial, stale assignment and out-of-vector index never invoke STEP", async () => {
  const f = await fixture(), { dispatch } = f.wire();
  for (const [request, status] of [[f.request(f.path(), { who: "anonymous" }), 401], [f.request(f.path(), { who: "multi" }), 403], [f.request(f.path("tutor", "", f.students[3].id), { who: "multi" }), 404], [f.request(f.path().replace("assignmentRevision=1", "assignmentRevision=2"), { who: "admin" }), 409]] as const) expect((await dispatch(request)).status).toBe(status);
  expect(f.loadText).not.toHaveBeenCalled();
  expect((await dispatch(f.request(f.path().replace("wordIndex=0", "wordIndex=2"), { who: "admin" }))).status).toBe(400);
  expect(f.loadText).toHaveBeenCalledTimes(1); expect(f.sourceFetch).not.toHaveBeenCalled();
});

test("review an actual guardian revocation while source is held blocks the final HTTP projection", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id }), held = f.held();
  const pending = held.dispatch(f.request(f.path("child-practice"), { who: "multi", handle: entered.handle })); await held.ready;
  await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); }); await held.release();
  const response = await pending; expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not-found" }); expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("review a warmed public book and lexicon cannot bypass the second actual relationship check", async () => {
  const f = await fixture(); await Promise.all([f.source.book("Gen"), f.source.lexicon()]); expect(f.sourceFetch).toHaveBeenCalledTimes(2);
  const { dispatch } = f.wire(f.source, async request => { const page = await f.loadText(request); await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); }); return page; });
  const response = await dispatch(f.request(f.path("parent"), { who: "multi" })); expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not-found" }); expect(f.sourceFetch).toHaveBeenCalledTimes(2);
});

test("review a sibling switch cannot rescue the original context by mutating its headers or selection", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id }), held = f.held();
  const request = f.request(f.path("child-practice"), { who: "multi", handle: entered.handle }), selection = { ...f.selection, mode: "child-practice" as const };
  const pending = held.service.read(request, selection, 0), refusal = expect(pending).rejects.toMatchObject({ status: 404 }); await held.ready;
  const next = await f.runtime.practice.switch(f.request("/api/practice/switch", { who: "multi", method: "POST", handle: entered.handle }), { studentId: f.students[1].id });
  request.headers.set("X-Practice-Context", next.handle); selection.studentId = f.students[1].id; selection.offset = 1; await held.release(); await refusal;
});

test("review original session expiry remains401 even if the caller substitutes another valid cookie during source work", async () => {
  const f = await fixture(), held = f.held(), request = f.request(f.path(), { who: "admin" });
  const pending = held.service.read(request, f.selection, 0), refusal = expect(pending).rejects.toMatchObject({ status: 401 }); await held.ready;
  request.headers.set("cookie", f.identities.learner.cookie); await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
  await held.release(); await refusal;
});

test("review concurrent selected indexes and original headers/selections are captured independently before any source await", async () => {
  const f = await fixture(), held = f.held(), original = f.request(f.path(), { who: "admin" }), selection = { ...f.selection };
  const first = held.service.read(original, selection, 0), second = held.service.read(f.request(f.path(), { who: "admin" }), { ...f.selection }, 1); await held.ready;
  original.headers.set("cookie", ""); selection.studentId = f.students[3].id; selection.assignmentRevision = 2; selection.offset = 1; await held.release();
  const [a, b] = await Promise.all([first, second]); if (!a.ok || !b.ok) throw 0;
  expect(a.mode).toBe("admin"); expect(a.studentId).toBe(f.students[0].id); expect(a.wordDetails).toMatchObject({ status: "ready", ref: "Genesis 1:1", wordIndex: 0, occurrence: { gloss: "Invented occurrence 0" } });
  expect(b.wordDetails).toMatchObject({ status: "ready", ref: "Genesis 1:1", wordIndex: 1, occurrence: { gloss: "Invented occurrence 1" } });
});

test.each(["grant", "student", "assignment"] as const)("review actual %s drift during source loading returns only the closed stale envelope", async field => {
  const f = await fixture(), held = f.held(), pending = held.dispatch(f.request(f.path(), { who: "admin" })); await held.ready;
  await f.owner(async () => {
    if (field === "grant") await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id));
    if (field === "student") await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id));
    if (field === "assignment") await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id));
  }); await held.release(); const response = await pending; expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: "stale-revision" }); expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("review caller abort during held source work cannot deliver a ready or held selected word", async () => {
  const f = await fixture(), held = f.held(), controller = new AbortController(), original = f.request(f.path(), { who: "admin" });
  const pending = held.service.read({ url: original.url, headers: original.headers, signal: controller.signal }, f.selection, 0), refusal = expect(pending).rejects.toMatchObject({ code: "upstream" });
  await held.ready; controller.abort(); await held.release(); await refusal;
});
