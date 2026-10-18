// Independent invented source data; actual local SDK authority, never public network.
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { parseSourceContent, SourceContentUnavailable, SourceContentUnsupported, type ContentSelection } from "../../src/server/study/sources/content";
import { projectEditionCatalog, editionPage, selectEdition } from "../../src/server/study/sources/editions";
import { createSefariaContentReader } from "../../src/server/study/sources/content-reader";
import { parseRelatedMetadata, parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { portalRoutesFixture } from "./portal-routes-fixture";

const ref = "Genesis 1:1", work = "Invented Complete Work", title = "Invented public edition";
const related = () => parseRelatedMetadata([{ _id: "content_link_0", sourceRef: `${work} 1:1:1`, index_title: work, category: "Commentary", anchorRef: ref }], ref);
const editions = () => parseEditionMetadata([{ title: work, versionTitle: title, language: "he", actualLanguage: "he", license: "Public Domain", versionSource: "https://example.test/source" }], work);
const source = related().entries[0], edition = editions().entries[0];
const sourceHash = () => projectRelatedCatalog(related(), ref).catalogHash;
const editionHash = () => projectEditionCatalog(editions(), work).editionCatalogHash;
function raw(text = " Invented source sentence.\n") {
  return { ref: source.ref, indexTitle: work, textDepth: 3, sections: ["1", "1", "1"], toSections: ["1", "1", "1"], isSpanning: false, spanningRefs: [], warnings: [], versions: [{ versionTitle: title, language: "he", actualLanguage: "he", languageFamilyName: "hebrew", license: "Public Domain", versionSource: "https://example.test/source", text }] };
}
const binding = { source, edition, language: "he" as const };
const selector: ContentSelection = { ref: source.ref, indexTitle: work, editionTitle: title, language: "he", actualLanguage: "he", motherTongue: "hebrew" };
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });

test("review scalar is exact copied data with full credit, not markup or a provider object", () => {
  const body = raw(), value = parseSourceContent(body, binding);
  expect(value.text).toBe(" Invented source sentence.\n");
  expect(value.provenance).toEqual({ provider: "Sefaria", sourceRef: source.ref, editionTitle: title, license: "Public Domain", versionSource: "https://example.test/source", format: "text_only" });
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.edition)).toBe(true); expect(Object.isFrozen(value.provenance)).toBe(true);
  body.versions[0].text = "Changed"; expect(value.text).not.toBe("Changed");
  expect(Object.keys(value).sort()).toEqual(["edition", "provenance", "ref", "schema", "text"]);
});

test("review complete numeric STRING leaf and empty warnings cannot be replaced by extent guesses", () => {
  for (const patch of [{ ref: `${source.ref}-2` }, { indexTitle: "Other Work" }, { textDepth: 2 }, { sections: [1, 1, 1] }, { sections: ["01", "1", "1"] }, { toSections: ["1", "1", "2"] }, { isSpanning: true }, { spanningRefs: [source.ref] }, { warnings: ["held"] }, { warnings: undefined }, { versions: [] }, { versions: [raw().versions[0], raw().versions[0]] }]) {
    expect(() => parseSourceContent({ ...raw(), ...patch }, binding)).toThrow(SourceContentUnavailable);
  }
  for (const badRef of [`${work} 1:1`, `${work} 1:1:01`, `${work} 1:1:1-2`, `${work}, Introduction 1`]) {
    if (badRef === `${work} 1:1`) expect(() => parseSourceContent(raw(), { ...binding, source: { ...source, ref: badRef } })).toThrow();
    else expect(() => parseSourceContent(raw(), { ...binding, source: { ...source, ref: badRef } })).toThrow(SourceContentUnsupported);
  }
});

test("review edition orientation never substitutes for actual language and all fresh provenance fields bind", () => {
  for (const patch of [{ versionTitle: "Other edition" }, { language: "en" }, { actualLanguage: "en" }, { languageFamilyName: "english" }, { license: "CC0" }, { versionSource: "https://example.test/changed" }]) {
    const body = raw(); Object.assign(body.versions[0], patch); expect(() => parseSourceContent(body, binding)).toThrow(SourceContentUnavailable);
  }
  for (const patch of [{ actualLanguage: null }, { license: null }, { license: "CC BY-SA" }, { source: null }, { versionTitle: "wrong|selector" }]) expect(() => parseSourceContent(raw(), { ...binding, edition: { ...edition, ...patch } })).toThrow(SourceContentUnsupported);
  const entry = { ...edition, language: "en", actualLanguage: "he" }; const body = raw(); body.versions[0].language = "en";
  expect(parseSourceContent(body, { ...binding, edition: entry }).edition).toMatchObject({ language: "en", actualLanguage: "he" });
});

test("review plain scalar, accessors, sparse arrays and intrinsic byte bounds fail closed without invoking getters", () => {
  for (const text of ["", "  ", "<p>invented</p>", "&amp;", "&#x41;", "x\u202ey", "x\u0000y", "\ud800", "x".repeat(65537)]) expect(() => parseSourceContent(raw(text), binding)).toThrow(SourceContentUnavailable);
  const getter = vi.fn(() => "bad"); const body = raw(); Object.defineProperty(body.versions[0], "text", { get: getter }); expect(() => parseSourceContent(body, binding)).toThrow(); expect(getter).not.toHaveBeenCalled();
  const sparse = raw(); delete (sparse.sections as (string | undefined)[])[1]; expect(() => parseSourceContent(sparse, binding)).toThrow();
  expect(Buffer.byteLength(parseSourceContent(raw("x".repeat(65536)), binding).text)).toBe(65536);
  expect(Buffer.byteLength(parseSourceContent(raw("\"".repeat(65536)), binding).text)).toBe(65536); // escaped whole-response cap belongs to the service.
});

test("review all512 editions remain reachable; full sorted hash includes off-page rights and held facts", () => {
  const input = parseEditionMetadata(Array.from({ length: 512 }, (_, i) => ({ title: work, versionTitle: `Edition ${String(i).padStart(3, "0")}`, language: "he", actualLanguage: "he", license: "CC0", versionSource: "https://example.test/edition" })), work);
  const catalog = projectEditionCatalog(input, work), reverse = projectEditionCatalog({ ...input, entries: [...input.entries].reverse() }, work);
  expect(reverse).toEqual(catalog); const seen: string[] = [];
  for (let offset: number | null = 0; offset !== null;) { const page = editionPage(catalog, offset); expect(page.totalEntries).toBe(512); expect(page.editionCatalogHash).toBe(catalog.editionCatalogHash); seen.push(...page.entries.map(e => e.versionTitle)); offset = page.nextEditionOffset; }
  expect(seen).toEqual(input.entries.map(e => e.versionTitle)); expect(new Set(seen).size).toBe(512);
  const changed = { ...input, entries: input.entries.map((e, i) => i === 511 ? { ...e, license: "Public Domain" } : e) };
  expect(projectEditionCatalog(changed, work).editionCatalogHash).not.toBe(catalog.editionCatalogHash);
  expect(projectEditionCatalog({ ...input, receivedRows: 512, heldCount: 1, entries: input.entries.slice(0, 511) }, work).editionCatalogHash).not.toBe(catalog.editionCatalogHash);
  expect(() => editionPage(catalog, 511)).toThrow(); expect(Object.isFrozen(catalog.entries[0])).toBe(true);
});

test("review same actual-language/title under two legacy buckets is ambiguous, not first-picked", () => {
  const value = parseEditionMetadata([{ title: work, versionTitle: title, language: "he", actualLanguage: "he", license: "Public Domain", versionSource: "https://example.test/source" }, { title: work, versionTitle: title, language: "en", actualLanguage: "he", license: "Public Domain", versionSource: "https://example.test/source" }], work);
  expect(value.entries).toHaveLength(2); expect(selectEdition(projectEditionCatalog(value, work), "he", title)).toBeNull();
});

test("review reader uses exactly one fixed selector, no ambient credentials, redirect or provenance fetch", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(raw()));
  expect(await createSefariaContentReader({ fetch }).text({ ...selector, language: "en" }, new AbortController().signal)).toEqual(raw());
  expect(fetch).toHaveBeenCalledTimes(1); const [url, init] = fetch.mock.calls[0], target = new URL(String(url));
  expect(target.origin).toBe("https://www.sefaria.org"); expect(decodeURIComponent(target.pathname)).toBe(`/api/v3/texts/${source.ref}`);
  expect([...target.searchParams]).toEqual([["version", `hebrew|${title}`], ["fill_in_missing_segments", "0"], ["return_format", "text_only"]]);
  expect(init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", headers: { accept: "application/json" } });
  expect(Object.keys(init!.headers!)).toEqual(["accept"]);
});

test("review reader rejects measured oversize, malformed UTF8/status/headers and cancels a rejected late body", async () => {
  for (const response of [new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }), new Response("{}", { status: 302, headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "text/html" } }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "2097153" } }), new Response(new Uint8Array(2097153), { headers: { "content-type": "application/json" } })]) {
    await expect(createSefariaContentReader({ fetch: vi.fn(async () => response) }).text(selector, new AbortController().signal)).rejects.toThrow("Source content unavailable");
  }
  const entered = deferred(), result = deferred<Response>(), canceled = deferred(), cancel = vi.fn(() => { canceled.resolve(); return new Promise<void>(() => {}); }), controller = new AbortController();
  const reader = createSefariaContentReader({ fetch: vi.fn(async () => { entered.resolve(); return result.promise; }) });
  const pending = reader.text(selector, controller.signal), refusal = expect(pending).rejects.toThrow(SourceContentUnavailable); await entered.promise; controller.abort(); await refusal;
  result.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } })); await canceled.promise; expect(cancel).toHaveBeenCalledTimes(1);
});

test("review reader pending headers have a10s total bound and body progress has a5s idle bound", async () => {
  vi.useFakeTimers();
  const noHeaders = createSefariaContentReader({ fetch: vi.fn(() => new Promise<Response>(() => {})) }).text(selector, new AbortController().signal);
  const headerRefusal = expect(noHeaders).rejects.toThrow(SourceContentUnavailable); await vi.advanceTimersByTimeAsync(10000); await headerRefusal;
  const canceled = deferred(), cancel = vi.fn(() => { canceled.resolve(); });
  const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } }));
  const noBody = createSefariaContentReader({ fetch }).text(selector, new AbortController().signal), bodyRefusal = expect(noBody).rejects.toThrow(SourceContentUnavailable);
  await vi.advanceTimersByTimeAsync(5000); await bodyRefusal; await canceled.promise; expect(cancel).toHaveBeenCalledTimes(1);
});

test("review reader intrinsic typedarray span ignores shadowed bounds and 65 empty chunks cannot spin", async () => {
  const oversized = new Uint8Array(2097153); Object.defineProperty(oversized, "byteLength", { value: 1 });
  for (const chunk of [oversized, "not-bytes"]) {
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(chunk as Uint8Array); c.close(); } }), { headers: { "content-type": "application/json" } }));
    await expect(createSefariaContentReader({ fetch }).text(selector, new AbortController().signal)).rejects.toThrow(SourceContentUnavailable);
  }
  const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); } }), { headers: { "content-type": "application/json" } }));
  await expect(createSefariaContentReader({ fetch }).text(selector, new AbortController().signal)).rejects.toThrow(SourceContentUnavailable);
});

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => { const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: f.adminMember.id, proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning(); await f.db.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row; });
  const selection = (mode: "admin" | "tutor" | "parent" | "student" | "child-practice" = "admin") => ({ mode, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 });
  const request = (who: "admin" | "multi" | "learner" = "admin", handle?: string, method = "GET") => f.request("/api/content-review", { who, handle, method });
  const intent = () => ({ verseRef: ref, sourceId: source.id, sourceScope: "related" as const, sourceCatalogHash: sourceHash(), editionCatalogHash: editionHash(), editionTitle: title, language: "he" as const });
  const loads = { related: vi.fn(async () => related()), editions: vi.fn(async () => editions()), content: vi.fn(async () => raw()) };
  const service = createSourceContentService({ access: f.service, practice: f.runtime.practice, ...loads });
  const sets = createSourceAssignmentsService({ access: f.service, practice: f.runtime.practice, related: loads.related });
  async function assign(ids = [source.id], version = 0) { return sets.replace(request("admin", undefined, "POST"), selection(), { verseRef: ref, sourceIds: ids, expectedVersion: version, mutationId: randomUUID(), ...(ids.length ? { catalogHash: sourceHash() } : {}) }); }
  return { ...f, access: f.service, assignment, selection, requestFor: request, intent, loads, service, sets, assign };
}

test("review actual read modes and both lanes use live SDK; assigned scope never re-fetches related catalog", async () => {
  const f = await fixture(); expect(await f.assign()).toMatchObject({ ok: true, committedVersion: 1 }); f.loads.related.mockClear();
  for (const [who, mode] of [["admin", "admin"], ["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const) {
    const result = await f.service.text(f.requestFor(who), f.selection(mode), { verseRef: ref, sourceId: source.id, sourceScope: "assigned", expectedSetVersion: 1, editionCatalogHash: editionHash(), editionTitle: title, language: "he" });
    expect(result).toMatchObject({ ok: true, mode, expectedSetVersion: 1, text: { text: raw().versions[0].text } });
  }
  expect(f.loads.related).not.toHaveBeenCalled(); const child = await f.runtime.practice.enter(f.requestFor("multi", undefined, "POST"), { studentId: f.students[0].id });
  expect(await f.service.text(f.requestFor("multi", child.handle), f.selection("child-practice"), f.intent())).toMatchObject({ ok: true, mode: "child-practice", sourceCatalogHash: sourceHash() });
  const before = f.loads.related.mock.calls.length; await expect(f.service.text(f.requestFor("multi"), { ...f.selection("tutor"), studentId: f.students[2].id }, f.intent())).rejects.toMatchObject({ status: 404 }); expect(f.loads.related).toHaveBeenCalledTimes(before);
});

test("review captured headers, selection and target intent cannot be rebound while public load is held", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); f.loads.editions.mockImplementation(async () => { entered.resolve(); await release.promise; return editions(); });
  const request = f.requestFor(), selection = f.selection(), intent = f.intent(), pending = f.service.text(request, selection, intent); await entered.promise;
  request.headers.set("cookie", f.identities.multi.cookie); selection.studentId = f.students[2].id; intent.verseRef = "Genesis 1:2"; intent.editionTitle = "Changed"; intent.sourceId = "changed";
  release.resolve(); expect(await pending).toMatchObject({ ok: true, studentId: f.students[0].id, verseRef: ref, text: { edition: { versionTitle: title } } });
});

test.each(["student", "assignment", "grant"] as const)("review held public failure cannot conceal actual %s authority revision drift", async field => {
  const f = await fixture(), entered = deferred(), release = deferred(); f.loads.editions.mockImplementation(async () => { entered.resolve(); await release.promise; throw new Error("Synthetic withheld provider message"); });
  const pending = f.service.text(f.requestFor(), f.selection(), f.intent()); await entered.promise;
  await f.owner(async () => { if (field === "student") await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id)); if (field === "assignment") await f.db.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)); if (field === "grant") await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  release.resolve(); expect(await pending).toEqual({ ok: false, error: "stale-revision" });
});

test("review actual guardian revocation wins even over a staged missing source", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); f.loads.related.mockImplementation(async () => { entered.resolve(); await release.promise; return related(); });
  const intent = { ...f.intent(), sourceId: "missing_id" }, pending = f.service.text(f.requestFor("multi"), f.selection("parent"), intent), refusal = expect(pending).rejects.toMatchObject({ status: 404 }); await entered.promise;
  await f.owner(() => f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id))); release.resolve(); await refusal; expect(f.loads.editions).not.toHaveBeenCalled();
});

test("review original session expiry is checked after public work despite a replacement caller cookie", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(); f.loads.content.mockImplementation(async () => { entered.resolve(); await release.promise; return raw(); });
  const request = f.requestFor(), pending = f.service.text(request, f.selection(), f.intent()), refusal = expect(pending).rejects.toMatchObject({ status: 401 }); await entered.promise;
  request.headers.set("cookie", f.identities.multi.cookie); await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId))); release.resolve(); await refusal;
});

test("review actual child switch revokes a held old-context read even if original header is replaced", async () => {
  const f = await fixture(), child = await f.runtime.practice.enter(f.requestFor("multi", undefined, "POST"), { studentId: f.students[0].id }), entered = deferred(), release = deferred();
  f.loads.content.mockImplementation(async () => { entered.resolve(); await release.promise; return raw(); });
  const request = f.requestFor("multi", child.handle), pending = f.service.text(request, f.selection("child-practice"), f.intent()), refusal = expect(pending).rejects.toMatchObject({ status: 404 }); await entered.promise;
  const next = await f.runtime.practice.switch(f.requestFor("multi", child.handle, "POST"), { studentId: f.students[1].id }); request.headers.set("x-practice-context", next.handle);
  release.resolve(); await refusal;
});

test("review caller abort during public work refuses delivery; it is not converted into a source outcome", async () => {
  const f = await fixture(), entered = deferred(), caller = new AbortController();
  f.loads.content.mockImplementation(async () => { entered.resolve(); return new Promise<ReturnType<typeof raw>>(() => {}); });
  const request = f.requestFor(), pending = f.service.text({ url: request.url, headers: request.headers, signal: caller.signal }, f.selection(), f.intent()), refusal = expect(pending).rejects.toBeDefined(); await entered.promise;
  caller.abort(); await refusal;
});

test("review assigned clear/re-add cannot resurrect a captured head even with identical citation and failing provider", async () => {
  const f = await fixture(); await f.assign(); const entered = deferred(), release = deferred(); f.loads.editions.mockImplementation(async () => { entered.resolve(); await release.promise; throw new Error("Synthetic withheld provider message"); });
  const pending = f.service.text(f.requestFor(), f.selection(), { verseRef: ref, sourceId: source.id, sourceScope: "assigned", expectedSetVersion: 1, editionCatalogHash: editionHash(), editionTitle: title, language: "he" }); await entered.promise;
  expect(await f.assign([], 1)).toMatchObject({ ok: true, committedVersion: 2 }); expect(await f.assign([source.id], 2)).toMatchObject({ ok: true, committedVersion: 3 });
  release.resolve(); expect(await pending).toEqual({ ok: false, error: "source-set-changed" });
});

test("review exhausted whole provider budget does not abort the copied request or hide final authority denial", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), caller = new AbortController(), seen: AbortSignal[] = []; let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  f.loads.editions.mockImplementation(async () => { entered.resolve(); await release.promise; time = 20001; return editions(); });
  const service = createSourceContentService({ access: f.access, practice: f.runtime.practice, related: async (_r, signal) => { seen.push(signal); return related(); }, editions: async (_w, signal) => { seen.push(signal); return f.loads.editions(); }, content: f.loads.content });
  const request = f.requestFor("multi"), pending = service.text({ url: request.url, headers: request.headers, signal: caller.signal }, f.selection("tutor"), f.intent()), refusal = expect(pending).rejects.toMatchObject({ status: 404 }); await entered.promise;
  await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id))); release.resolve(); await refusal;
  expect(caller.signal.aborted).toBe(false); expect(seen.every(signal => signal.aborted)).toBe(true); expect(f.loads.content).not.toHaveBeenCalled();
});

test("review synchronous loader past its10s call deadline cannot pass merely because aggregate20s remains", async () => {
  const f = await fixture(); let time = 0; vi.spyOn(performance, "now").mockImplementation(() => time);
  f.loads.related.mockImplementation(async () => { time = 10001; return related(); });
  expect(await f.service.text(f.requestFor(), f.selection(), f.intent())).toEqual({ ok: false, error: "unavailable" });
  expect(f.loads.editions).not.toHaveBeenCalled();
});

test("review escaped128KiB cap is independent from legal64KiB scalar and cannot leak a partial response", async () => {
  const f = await fixture(); f.loads.content.mockImplementation(async () => raw('"'.repeat(65536)));
  expect(await f.service.text(f.requestFor(), f.selection(), f.intent())).toEqual({ ok: false, error: "unavailable" });
  f.loads.content.mockImplementation(async () => raw("x".repeat(65536)));
  expect(await f.service.text(f.requestFor(), f.selection(), f.intent())).toMatchObject({ ok: true });
});

test("review real HTTP boundary rejects methods and mixed selectors before public work and projects private closed responses", async () => {
  const f = await fixture(), runtime = { ...f.runtime, sourceContent: f.service }, dispatch = createHttpDispatcher(action => action(runtime));
  const path = `/api/students/${f.students[0].id}/source-text`, q = new URLSearchParams({ mode: "admin", kind: "torah", assignmentId: f.assignment.id, assignmentRevision: "1", ...f.intent() });
  const scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Synthetic unused scope"); }), early = createHttpDispatcher(scope);
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) expect((await early(new Request(`http://localhost:3000${path}`, { method }))).status).toBe(405); expect(scope).not.toHaveBeenCalled();
  for (const extra of ["&language=he", "&url=https%3A%2F%2Fexample.test", "&expectedSetVersion=1", "&editionOffset=0", "&sourceRef=ignored"]) expect((await dispatch(f.request(path + "?" + q + extra, { who: "admin" }))).status).toBe(400);
  expect((await dispatch(f.request(path + "?" + q, { who: "admin", headers: { "content-length": "1" } }))).status).toBe(400); expect(f.loads.related).not.toHaveBeenCalled();
  const response = await dispatch(f.request(path + "?" + q, { who: "admin" })); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  const output = await response.text(); expect(output).not.toMatch(/authSession|roleGrantId|relationshipId|membershipId|requestDigest|headers|cookie/); expect(JSON.parse(output)).toMatchObject({ ok: true, source: { id: source.id }, text: { schema: "study-source-text/v1" } });
  const changed = new URLSearchParams(q); changed.set("editionCatalogHash", "a".repeat(64)); const mismatch = await dispatch(f.request(path + "?" + changed, { who: "admin" })); expect(mismatch.status).toBe(409); expect(await mismatch.json()).toEqual({ ok: false, error: "edition-catalog-changed" });
  f.loads.editions.mockImplementation(async () => { throw new Error("Synthetic withheld provider detail"); }); const unavailable = await dispatch(f.request(path + "?" + q, { who: "admin" })); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ ok: false, error: "unavailable" });
  const heldEditions = parseEditionMetadata([{ title: work, versionTitle: title, language: "he", actualLanguage: "he", license: "Unknown rights", versionSource: "https://example.test/source" }], work);
  f.loads.editions.mockImplementation(async () => heldEditions); const heldQuery = new URLSearchParams(q); heldQuery.set("editionCatalogHash", projectEditionCatalog(heldEditions, work).editionCatalogHash); const unsupported = await dispatch(f.request(path + "?" + heldQuery, { who: "admin" })); expect(unsupported.status).toBe(422); expect(await unsupported.json()).toEqual({ ok: false, error: "unsupported-edition" });
});
