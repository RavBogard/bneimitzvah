// Independent invented citations and text; blocked browser-transport mocks only.
import { afterEach, expect, test, vi } from "vitest";
import type { Assigned, ReadingMode, Selection } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { captureSourceContent, captureSourceContentTarget, createSourceContentClient, parseSourceEditionResponse, parseSourceTextResponse, isSourceMissing, SourceContentError, type SourceContentTarget, type EditionChoice, type SourceContentClient, type SourceEditionPage, type SourceText } from "../../src/components/portal/workspace/study/sources/content-api";
import { createSourceContentBudget } from "../../src/components/portal/workspace/study/sources/content-budget";
import { createSourceContentOwner } from "../../src/components/portal/workspace/study/sources/content-owner";

const studentId = "70000000-0000-4000-8000-000000000001", readingId = "70000000-0000-4000-8000-000000000002", contextId = "70000000-0000-4000-8000-000000000003";
const ref = "Genesis 1:1", sourceHash = "b".repeat(64), editionHash = "c".repeat(64);
const source = { id: "invented_reader_1", ref: "Invented Reader Work 1:1:1", indexTitle: "Invented Reader Work", category: "Commentary", labels: { en: "Invented reader source", he: null } };
const edition = { versionTitle: "Invented reader edition", language: "en", actualLanguage: "he", license: "CC0", source: "https://example.test/inert" };
const choice: EditionChoice = { editionCatalogHash: editionHash, edition, language: "he" };
const target = (): SourceContentTarget => ({ source: structuredClone(source), sourceScope: "assigned", expectedSetVersion: 4 });
function base(mode: ReadingMode = "tutor"): Assigned { return { mode, student: { id: studentId, revision: 3, firstName: "Synthetic", lastName: "Reader", ceremonyDate: "2027-01-02" }, context: mode === "child-practice" ? { id: contextId, authorityRevision: 2, studentId, studentRevision: 3, expiresAt: new Date(Date.now() + 60000).toISOString() } : null, readings: [{ id: readingId, kind: "torah", revision: 5, ranges: ["Genesis 1:1-2"], verses: [ref, "Genesis 1:2"], basis: "custom", aliyahStarts: null, needsReview: false, confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] }; }
function scope(b = base(), lane = target()) { return { ok: true, studentId, studentRevision: 3, mode: b.mode, context: b.context, assignment: { id: readingId, revision: 5, kind: "torah", needsReview: false }, verseRef: ref, source: structuredClone(source), ...(lane.sourceScope === "assigned" ? { expectedSetVersion: lane.expectedSetVersion } : { sourceCatalogHash: lane.sourceCatalogHash }) }; }
function text(value = "  Invented scalar e\u0301.\n", b = base(), lane = target()) { return { ...scope(b, lane), text: { schema: "study-source-text/v1", ref: source.ref, text: value, edition: { versionTitle: edition.versionTitle, language: "en", actualLanguage: "he" }, provenance: { provider: "Sefaria", sourceRef: source.ref, editionTitle: edition.versionTitle, license: "CC0", versionSource: edition.source, format: "text_only" } } }; }
function page(b = base(), offset = 0, total = 12, lane = target()) { return { ...scope(b, lane), editions: { schema: "study-edition-page/v1", workTitle: source.indexTitle, editionCatalogHash: editionHash, editionOffset: offset, pageSize: 10, totalEntries: total, receivedRows: total, heldCount: 0, duplicateCount: 0, nextEditionOffset: offset + 10 < total ? offset + 10 : null, entries: Array.from({ length: Math.max(0, Math.min(10, total - offset)) }, (_, n) => ({ ...edition, versionTitle: `Edition ${String(n + offset).padStart(3, "0")}` })) } }; }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const capture = () => captureSourceContent({ baseline: base(), kind: "torah", offset: 0 }, target());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("review actual source/reading capture fixes both lanes without source URLs or writes", async () => {
  for (const lane of [target(), { source: structuredClone(source), sourceScope: "related" as const, sourceCatalogHash: sourceHash }]) {
    const b = base(), mutableSource = structuredClone(source), wire = text(undefined, base(), structuredClone(lane)), client = createSourceContentClient({ baseline: b, kind: "torah", offset: 0 }, { ...lane, source: mutableSource }), fetcher = vi.fn(async () => response(wire)); vi.stubGlobal("fetch", fetcher);
    b.student.id = "70000000-0000-4000-8000-000000000009"; b.readings[0].revision = 99; mutableSource.ref = "Changed Work 2";
    await client.text(choice, new AbortController().signal); const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit], q = new URL(url, "https://example.test").searchParams;
    expect(q.get("verseRef")).toBe(ref); expect(q.get("sourceId")).toBe(source.id); expect(q.get("assignmentRevision")).toBe("5"); expect(q.get("language")).toBe("he"); expect(q.has("sourceRef")).toBe(false); expect(q.has("url")).toBe(false);
    expect(q.has("expectedSetVersion")).toBe(lane.sourceScope === "assigned"); expect(q.has("sourceCatalogHash")).toBe(lane.sourceScope === "related"); expect(options).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error" }); expect(options.body).toBeUndefined();
  }
});

test("review child private handle and original context are copied; local exact expiry refuses another GET", async () => {
  const b = base("child-practice"), selected: Selection = { handle: "h".repeat(43), context: { ...b.context! } }, lane = target(), client = createSourceContentClient({ baseline: b, kind: "torah", offset: 0, selection: selected }, lane), fetcher = vi.fn(async () => response(text(undefined, b, lane))); vi.stubGlobal("fetch", fetcher);
  selected.handle = "x".repeat(43); await client.text(choice, new AbortController().signal); const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).not.toContain("h".repeat(43)); expect(new Headers(init.headers).get("X-Practice-Context")).toBe("h".repeat(43));
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(b.context!.expiresAt)); await expect(client.text(choice, new AbortController().signal)).rejects.toMatchObject({ status: 404 }); expect(fetcher).toHaveBeenCalledTimes(1);
});

test("review complete closed authority/citation/lane is mandatory; echoed edition hash is not accepted", () => {
  const c = capture();
  for (const patch of [{ studentId: readingId }, { studentRevision: 4 }, { mode: "admin" }, { context: {} }, { assignment: { ...scope().assignment, revision: 6 } }, { verseRef: "Genesis 1:2" }, { source: { ...source, category: "Changed" } }, { expectedSetVersion: 5 }, { sourceCatalogHash: sourceHash }, { editionCatalogHash: editionHash }]) expect(() => parseSourceTextResponse({ ...text(), ...patch }, c, choice)).toThrow();
  const result = parseSourceTextResponse(text(), c, choice); expect(result.text).toBe("  Invented scalar e\u0301.\n"); expect(result.text.normalize("NFC")).not.toBe(result.text); expect(Object.isFrozen(result.provenance)).toBe(true); expect(Object.keys(result)).not.toContain("editionCatalogHash");
});

test("review language orientation, exact provenance and plain scalar cannot be substituted", () => {
  const c = capture();
  for (const patch of [{ text: "<b>invented</b>" }, { text: "&amp;" }, { text: "x\u202ey" }, { text: "\ud800" }, { text: ["invented"] }, { edition: { ...text().text.edition, language: "he" } }, { provenance: { ...text().text.provenance, versionSource: "changed" } }, { provenance: { ...text().text.provenance, license: "Public Domain" } }, { extra: true }]) expect(() => parseSourceTextResponse({ ...text(), text: { ...text().text, ...patch } }, c, choice)).toThrow();
  const getter = vi.fn(() => "invented"), raw = text(); Object.defineProperty(raw.text, "text", { get: getter }); expect(() => parseSourceTextResponse(raw, c, choice)).toThrow(); expect(getter).not.toHaveBeenCalled();
  expect(() => parseSourceTextResponse(text("x".repeat(65537)), c, choice)).toThrow(); expect(parseSourceTextResponse(text("x".repeat(65536)), c, choice).text.length).toBe(65536);
  expect(() => createSourceContentClient({ baseline: base(), kind: "torah", offset: 0 }, { ...target(), sourceCatalogHash: sourceHash } as SourceContentTarget)).toThrow();
  const badSource = { ...source }; Object.defineProperty(badSource, "ref", { get: getter }); expect(() => captureSourceContentTarget({ source: badSource, sourceScope: "assigned", expectedSetVersion: 4 })).toThrow(); expect(getter).not.toHaveBeenCalled();
});

test("review all512 edition rows can be paged; hash/count/offset/sparse conflicts refuse rather than truncate", () => {
  const c = capture(), seen: string[] = [];
  for (let offset = 0; offset <= 510; offset += 10) { const result = parseSourceEditionResponse(page(base(), offset, 512), c, { editionOffset: offset, ...(offset ? { editionCatalogHash: editionHash } : {}) }); seen.push(...result.entries.map(e => e.versionTitle)); expect(result.totalEntries).toBe(512); }
  expect(seen).toHaveLength(512); expect(new Set(seen).size).toBe(512); expect(seen.at(-1)).toBe("Edition 511");
  for (const patch of [{ pageSize: 9 }, { totalEntries: 513 }, { receivedRows: 11 }, { nextEditionOffset: null }, { editionOffset: 10 }, { workTitle: "Other Work" }, { entries: [edition] }]) expect(() => parseSourceEditionResponse({ ...page(), editions: { ...page().editions, ...patch } }, c, { editionOffset: 0 })).toThrow();
  expect(() => parseSourceEditionResponse(page(base(), 10), c, { editionOffset: 10, editionCatalogHash: "d".repeat(64) })).toThrow(); const sparse = page(); delete (sparse.editions.entries as (typeof edition | undefined)[])[3]; expect(() => parseSourceEditionResponse(sparse, c, { editionOffset: 0 })).toThrow();
  const repeated = page(base(), 0, 2); repeated.editions.entries = [{ ...edition, versionTitle: "Repeated", license: "CC0" }, { ...edition, versionTitle: "Repeated", license: "Public Domain" }];
  expect(() => parseSourceEditionResponse(repeated, c, { editionOffset: 0 })).toThrow();
});

test("review only exact closed404 source-not-found is local; actual denial and wrong status are not", async () => {
  const client = createSourceContentClient({ baseline: base(), kind: "torah", offset: 0 }, target());
  for (const [status, body, local] of [[404, { ok: false, error: "source-not-found" }, true], [404, { error: "not-found" }, false], [404, { ok: false, error: "source-not-found", extra: true }, false], [503, { ok: false, error: "source-not-found" }, false], [200, { ok: false, error: "source-not-found" }, false]] as const) {
    vi.stubGlobal("fetch", vi.fn(async () => response(body, status))); const caught = await client.text(choice, new AbortController().signal).then(() => undefined, e => e); expect(caught).toBeInstanceOf(PortalRequestError); expect(isSourceMissing(caught)).toBe(local);
  }
  for (const broken of [new Response("{", { status: 404, headers: { "content-type": "application/json" } }), new Response("not JSON", { status: 404, headers: { "content-type": "text/html" } }), new Response(new ReadableStream({ start(c) { c.error(new Error("Synthetic body interruption")); } }), { status: 404, headers: { "content-type": "application/json" } })]) {
    vi.stubGlobal("fetch", vi.fn(async () => broken)); const caught = await client.text(choice, new AbortController().signal).then(() => undefined, e => e); expect(caught).toMatchObject({ status: 404 }); expect(isSourceMissing(caught)).toBe(false);
  }
});

test("review actual128KiB stream bound is independent from64KiB text and header declarations", async () => {
  const client = createSourceContentClient({ baseline: base(), kind: "torah", offset: 0 }, target());
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(text()) + " ".repeat(131072), { headers: { "content-type": "application/json" } }))); await expect(client.text(choice, new AbortController().signal)).rejects.toBeDefined();
  vi.stubGlobal("fetch", vi.fn(async () => response(text('"'.repeat(65536))))); await expect(client.text(choice, new AbortController().signal)).rejects.toBeDefined();
  vi.stubGlobal("fetch", vi.fn(async () => response(text("x".repeat(65536))))); const scalar = await client.text(choice, new AbortController().signal); expect(scalar.schema).toBe("study-source-text/v1"); if (scalar.schema !== "study-source-text/v1") throw new Error("Expected scalar compatibility"); expect(scalar.text.length).toBe(65536);
});

test("review transport30s headers/5s body idle and late nonsettling cancellation cannot hang", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); const late = deferred<Response>(), canceled = deferred(), cancel = vi.fn(() => { canceled.resolve(); return new Promise<void>(() => {}); });
  vi.stubGlobal("fetch", vi.fn(() => late.promise)); const client = createSourceContentClient({ baseline: base(), kind: "torah", offset: 0 }, target()), pending = client.text(choice, new AbortController().signal), refusal = expect(pending).rejects.toBeDefined(); await vi.advanceTimersByTimeAsync(30000); await refusal;
  late.resolve(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } })); await canceled.promise; expect(cancel).toHaveBeenCalledTimes(1);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream(), { headers: { "content-type": "application/json" } }))); const noBody = client.text(choice, new AbortController().signal), idle = expect(noBody).rejects.toBeDefined(); await vi.advanceTimersByTimeAsync(5000); await idle;
});

test("review synchronous elapsed phases and one45s parent deadline cannot be renewed by later steps", async () => {
  let time = 0; vi.spyOn(performance, "now").mockImplementation(() => time); const budget = createSourceContentBudget(new AbortController().signal);
  expect(await budget.run(12000, async () => { time = 11000; return "pre"; })).toBe("pre");
  expect(await budget.run(30000, async () => { time = 40000; return "endpoint"; })).toBe("endpoint");
  await expect(budget.run(12000, async () => { time = 45000; return "post"; })).rejects.toMatchObject({ status: 503 }); budget.dispose();
  time = 0; const shorter = createSourceContentBudget(new AbortController().signal); await expect(shorter.run(12000, async () => { time = 12000; return "late"; })).rejects.toMatchObject({ status: 503 }); shorter.dispose();
});

test("review45s outer wait terminates an abort-ignoring dependency without touching caller signal", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }); const caller = new AbortController(), budget = createSourceContentBudget(caller.signal), pending = budget.run(45000, () => new Promise<void>(() => {})), refusal = expect(pending).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(45000); await refusal; expect(caller.signal.aborted).toBe(false); budget.dispose();
});

function ownerFixture(overrides: Partial<SourceContentClient> = {}) {
  const editions = vi.fn(async () => parseSourceEditionResponse(page(), capture(), { editionOffset: 0 }));
  const body = vi.fn(async (selected: EditionChoice) => {
    const raw = text(); Object.assign(raw.text.edition, { versionTitle: selected.edition.versionTitle }); Object.assign(raw.text.provenance, { editionTitle: selected.edition.versionTitle });
    return parseSourceTextResponse(raw, capture(), selected);
  });
  const api = { editions, text: body, ...overrides }, onChange = vi.fn(), owner = createSourceContentOwner({ api, onChange });
  const choose = (n = 0): EditionChoice => ({ editionCatalogHash: owner.state.page!.editionCatalogHash, edition: owner.state.page!.entries[n], language: "he" });
  return { api, editions, body, owner, choose, onChange };
}

test("review owner construction is idle, opening lists only, and body requires explicit eligible edition", async () => {
  const f = ownerFixture(); expect(f.editions).not.toHaveBeenCalled(); expect(f.body).not.toHaveBeenCalled();
  await f.owner.open(); expect(f.editions).toHaveBeenCalledTimes(1); expect(f.body).not.toHaveBeenCalled();
  await f.owner.choose(f.choose()); expect(f.owner.state.phase).toBe("text"); expect(f.body).toHaveBeenCalledTimes(1);
  f.owner.back(); expect(f.owner.state.phase).toBe("editions"); expect(f.owner.state.text).toBeNull(); expect(f.editions).toHaveBeenCalledTimes(1); f.owner.dispose();
});

test("review newest explicit edition alone may publish even if older transport ignores abort", async () => {
  const old = deferred<SourceText>(), f = ownerFixture(); await f.owner.open();
  f.body.mockImplementationOnce(() => old.promise); const firstChoice = f.choose(), pending = f.owner.choose(firstChoice); const secondChoice = f.choose(1);
  expect(await f.owner.choose(secondChoice)).toBe(true); const latest = f.owner.state.text;
  const firstWire = text(); firstWire.text.edition.versionTitle = firstChoice.edition.versionTitle; firstWire.text.provenance.editionTitle = firstChoice.edition.versionTitle;
  old.resolve(parseSourceTextResponse(firstWire, capture(), firstChoice)); expect(await pending).toBe(false);
  expect(f.owner.state.text).toBe(latest); expect(f.owner.state.text?.edition.versionTitle).toBe(secondChoice.edition.versionTitle); f.owner.dispose();
});

test("review clear during editions fences late catalog facts and permits a new explicit independent load", async () => {
  const old = deferred<SourceEditionPage>(), f = ownerFixture(); f.editions.mockImplementationOnce(() => old.promise);
  const first = f.owner.open(); f.owner.clear(); expect(f.owner.state.phase).toBe("closed");
  expect(await f.owner.open()).toBe(true); const page = f.owner.state.page; old.resolve({ ...page!, editionCatalogHash: "d".repeat(64) }); expect(await first).toBe(false); expect(f.owner.state.page).toBe(page);
  f.owner.dispose(); expect(await f.owner.open()).toBe(false); expect(f.owner.state.text).toBeNull();
});

test("review local absence holds only its reader, whereas genuine authority404 destroys private owner state", async () => {
  const held = ownerFixture({ text: async () => { throw new SourceContentError(404, "source-not-found"); } }); await held.owner.open(); await held.owner.choose(held.choose()); expect(held.owner.state.phase).toBe("held"); expect(held.owner.state.error).toBe("source-not-found"); held.owner.clear(); expect(await held.owner.open()).toBe(true); held.owner.dispose();
  const denied = ownerFixture({ text: async () => { throw new PortalRequestError(404); } }); await denied.owner.open(); await denied.owner.choose(denied.choose()); expect(denied.owner.state.phase).toBe("disposed"); expect(denied.owner.state.page).toBeNull(); expect(await denied.owner.open()).toBe(false);
});

test("review stale hash/head response cannot auto-adopt a new catalog or retry under replacement facts", async () => {
  const f = ownerFixture({ text: async () => { throw new SourceContentError(409, "source-set-changed"); } }); await f.owner.open(); await f.owner.choose(f.choose()); expect(f.owner.state.phase).toBe("stale"); expect(f.owner.state.page).toBeNull();
  expect(await f.owner.retry()).toBe(false); expect(await f.owner.open()).toBe(false); expect(f.editions).toHaveBeenCalledTimes(1); f.owner.dispose();
});
