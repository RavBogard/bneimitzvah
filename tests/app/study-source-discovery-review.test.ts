// Independent invented catalogs and local SDK fixtures only; no live metadata.
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { parseRelatedMetadata, SourceMetadataUnavailable, type RelatedSourceCatalog } from "../../src/server/study/sources/metadata";
import { discoverRelatedPage, sourcePageSelection } from "../../src/server/study/sources/discovery";
import { createStudySourceDiscoveryService } from "../../src/server/study/source-discovery-service";
import { createSefariaMetadataReader } from "../../src/server/study/sources/sefaria-metadata";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher, type HttpRuntimeScope } from "../../src/server/http/dispatch";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";
import type { StudySelection } from "../../src/server/study/service";

const ref = "Genesis 1:1";
function rows(count: number, verse = ref) { return Array.from({ length: count }, (_, i) => ({ _id: `link-${String(i).padStart(4, "0")}`, sourceRef: `Invented Complex Commentary, Part A ${i + 1}`, index_title: "Invented Complete Work", category: "Commentary", anchorRef: verse, collectiveTitle: { en: "Invented title", he: "דג" } })); }
const catalog = (count: number, verse = ref) => parseRelatedMetadata(rows(count, verse), verse);
const mutable = (value: RelatedSourceCatalog) => ({ ...value, entries: value.entries.map(row => ({ ...row, labels: { ...row.labels } })) });
function ready(value: ReturnType<typeof discoverRelatedPage>) { expect(value.status).toBe("ready"); if (value.status !== "ready") throw new Error("Synthetic expected ready page"); return value.page; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });

test("review all4096 accepted entries are reachable in ordinal ID order with no small-catalog truncation", () => {
  const input = mutable(catalog(4096)); input.entries.reverse();
  const first = ready(discoverRelatedPage(input, ref, { sourceOffset: 0 })), seen = [...first.entries.map(row => row.id)];
  let next = first.nextSourceOffset; while (next !== null) { const page = ready(discoverRelatedPage(input, ref, { sourceOffset: next, catalogHash: first.catalogHash })); expect(page.sourceOffset).toBe(next); expect(page.catalogHash).toBe(first.catalogHash); seen.push(...page.entries.map(row => row.id)); next = page.nextSourceOffset; }
  expect(seen).toEqual(rows(4096).map(row => row._id)); expect(new Set(seen).size).toBe(4096); expect(first.totalEntries).toBe(4096); expect(first.receivedRows).toBe(4096); expect(first.pageSize).toBe(10);
  expect(ready(discoverRelatedPage(input, ref, { sourceOffset: 4090, catalogHash: first.catalogHash })).entries).toHaveLength(6);
});

test("review hash is independent of provider/property order but sensitive to retained metadata and held/duplicate counts", () => {
  const input = catalog(15), first = ready(discoverRelatedPage(input, ref, { sourceOffset: 0 }));
  const reordered = { duplicateCount: input.duplicateCount, heldCount: input.heldCount, receivedRows: input.receivedRows, entries: [...input.entries].reverse().map(row => ({ labels: { he: row.labels.he, en: row.labels.en }, category: row.category, indexTitle: row.indexTitle, ref: row.ref, id: row.id })), verse: input.verse, schema: input.schema };
  expect(ready(discoverRelatedPage(reordered, ref, { sourceOffset: 0 })).catalogHash).toBe(first.catalogHash);
  const changed = mutable(input); changed.entries[0].labels.en = "Invented changed label";
  expect(discoverRelatedPage(changed, ref, { sourceOffset: 10, catalogHash: first.catalogHash })).toEqual({ status: "catalog-changed" });
  const counted = parseRelatedMetadata([...rows(15), rows(15)[0]], ref); expect(ready(discoverRelatedPage(counted, ref, { sourceOffset: 0 })).catalogHash).not.toBe(first.catalogHash);
  const held = parseRelatedMetadata([...rows(15), { malformed: true }], ref); expect(ready(discoverRelatedPage(held, ref, { sourceOffset: 0 })).catalogHash).not.toBe(first.catalogHash);
  // A shorter changed catalog must never become a bounds error first.
  expect(discoverRelatedPage(catalog(1), ref, { sourceOffset: 10, catalogHash: first.catalogHash })).toEqual({ status: "catalog-changed" });
  expect(discoverRelatedPage(input, ref, { sourceOffset: 20, catalogHash: first.catalogHash })).toEqual({ status: "invalid-page" });
  expect(ready(discoverRelatedPage(catalog(0), ref, { sourceOffset: 0 }))).toMatchObject({ entries: [], nextSourceOffset: null, totalEntries: 0 });
  const ordinal = parseRelatedMetadata(["a", "B", "_", "-", "Z", "0"].map(id => ({ ...rows(1)[0], _id: id })), ref);
  expect(ready(discoverRelatedPage(ordinal, ref, { sourceOffset: 0 })).entries.map(row => row.id)).toEqual(["-", "0", "B", "Z", "_", "a"]);
});

test("review source selection and injected catalog are closed snapshots with coherent counts and immutable copied page fields", () => {
  const input = mutable(catalog(1)), paging = { sourceOffset: 0 }, snapshot = sourcePageSelection(paging); paging.sourceOffset = 10; expect(snapshot.sourceOffset).toBe(0);
  const page = ready(discoverRelatedPage(input, ref, snapshot)); input.entries[0].labels.en = "Changed"; expect(page.entries[0].labels.en).toBe("Invented title"); expect(Object.isFrozen(page) && Object.isFrozen(page.entries) && Object.isFrozen(page.entries[0]) && Object.isFrozen(page.entries[0].labels)).toBe(true);
  for (const bad of [{}, { sourceOffset: 1 }, { sourceOffset: "0" }, { sourceOffset: 10 }, { sourceOffset: 4091, catalogHash: "a".repeat(64) }, { sourceOffset: 0, catalogHash: "A".repeat(64) }]) expect(() => sourcePageSelection(bad)).toThrow();
  for (const bad of [{ ...input, receivedRows: 2 }, { ...input, heldCount: -1 }, { ...input, duplicateCount: 0.5 }, { ...input, entries: [input.entries[0], input.entries[0]], receivedRows: 2 }]) expect(() => discoverRelatedPage(bad, ref, { sourceOffset: 0 })).toThrow(SourceMetadataUnavailable);
  // This trusted seam projects/drops extras; the public HTTP grammar stays strict.
  const expected = ready(discoverRelatedPage(input, ref, { sourceOffset: 0 })), getter = vi.fn(() => "Invented withheld value");
  const extra = { ...input, actor: { discarded: true }, entries: input.entries.map(row => ({ ...row, url: "https://example.invalid/not-a-target", labels: { ...row.labels, discarded: true } })) };
  Object.defineProperty(extra, "ignored", { get: getter }); Object.defineProperty(extra.entries[0], "ignored", { get: getter });
  expect(ready(discoverRelatedPage(extra, ref, { sourceOffset: 0 }))).toEqual(expected); expect(getter).not.toHaveBeenCalled();
  expect(sourcePageSelection({ sourceOffset: 0, sourceRef: "Discarded trusted extra" })).toEqual({ sourceOffset: 0 });
});

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignments = await f.owner(async () => {
    const result = [];
    for (const [kind, book] of [["torah", "Genesis"], ["haftarah", "Isaiah"]] as const) {
      const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind, basis: "custom", ref: `${book} 1:1-2`, status: "confirmed", setByMembershipId: f.adminMember.id, proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
      await f.db.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: n, verseRef: `${book} 1:${n}` }))); result.push(a);
    } return result;
  });
  const loadText = vi.fn(async (request: StudyRequest): Promise<StudyPage> => ({ offset: request.offset, nextOffset: null, totalVerses: request.verses.length, verses: [{ ref: request.verses[request.offset], hebrew: normalizeHebrew("דָּג בָּג"), english: "Invented withheld translation" }], translation: { key: "jps2023", status: "available" }, chapters: [] }));
  const fetcher = vi.fn<typeof fetch>(async input => { const url = new URL(String(input)), verse = decodeURIComponent(url.pathname.split("/").at(-1)!); const response = new Response(JSON.stringify(rows(75, verse)), { headers: { "content-type": "application/json" } }); Object.defineProperty(response, "url", { value: url.href }); return response; });
  const metadata = createSefariaMetadataReader({ fetch: fetcher });
  const selection = (mode: StudySelection["mode"] = "admin", kind: "torah" | "haftarah" = "torah", offset = 0): StudySelection => ({ mode, studentId: f.students[0].id, kind, assignmentId: assignments[kind === "torah" ? 0 : 1].id, assignmentRevision: 1, translation: "jps2023", offset });
  const path = (mode = "admin", extra = "&sourceOffset=0", kind = "torah", offset = 0, target = f.students[0].id) => `/api/students/${target}/study-sources?mode=${mode}&kind=${kind}&assignmentId=${assignments[kind === "torah" ? 0 : 1].id}&assignmentRevision=1&translation=jps2023&offset=${offset}${extra}`;
  const wire = (related: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog> = metadata.related) => { const service = createStudySourceDiscoveryService({ access: f.service, practice: f.runtime.practice, loadText, related }); return { service, dispatch: createHttpDispatcher(async action => action({ ...f.runtime, studySources: service })) }; };
  const held = (outcome: () => Promise<RelatedSourceCatalog> = async () => catalog(75)) => { const entered = deferred<void>(), gate = deferred<void>(); return { ...wire(async () => { entered.resolve(); await gate.promise; return outcome(); }), entered: entered.promise, release: () => gate.resolve() }; };
  return { ...f, assignments, loadText, fetcher, selection, path, wire, held };
}

test("review actual SDK and fixed metadata reader return only closed assigned Torah/haftarah citation pages in all existing modes", async () => {
  const f = await fixture(), { dispatch } = f.wire();
  for (const [mode, who, kind, offset] of [["admin", "admin", "torah", 0], ["tutor", "multi", "haftarah", 1], ["parent", "multi", "torah", 1], ["student", "learner", "haftarah", 0]] as const) {
    const response = await dispatch(f.request(f.path(mode, "&sourceOffset=0", kind, offset), { who })); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["assignment", "context", "mode", "sources", "studentId", "studentRevision"]); expect(body.sources).toMatchObject({ schema: "study-related-page/v1", ref: `${kind === "torah" ? "Genesis" : "Isaiah"} 1:${offset + 1}`, sourceOffset: 0, pageSize: 10, totalEntries: 75, nextSourceOffset: 10 }); expect(body.sources.entries).toHaveLength(10);
    expect(JSON.stringify(body)).not.toMatch(/withheld|translation|segments|authSession|actorUser|anchorRef|index_title|versionSource|license|sourceRef|https:/);
  }
  expect(f.fetcher).toHaveBeenCalledTimes(4); for (const [input] of f.fetcher.mock.calls) expect(new URL(String(input)).pathname).toContain("/api/links/");
});

test("review method/query/body and first-authority refusals do no metadata or text I/O", async () => {
  const f = await fixture(), scope = vi.fn<HttpRuntimeScope>(async () => { throw new Error("Synthetic unused scope"); }), early = createHttpDispatcher(scope), { dispatch } = f.wire();
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) expect((await early(new Request(`http://localhost:3000${f.path()}`, { method }))).status).toBe(405); expect(scope).not.toHaveBeenCalled();
  for (const suffix of ["", "&sourceOffset=00", "&sourceOffset=10", "&sourceOffset=1", "&sourceOffset=-0", "&sourceOffset=4091", "&sourceOffset=0&catalogHash=bad", `&sourceOffset=0&catalogHash=${"A".repeat(64)}`, "&sourceOffset=0&sourceOffset=0", "&sourceOffset=0&sourceRef=Invented", "&sourceOffset=0&url=ignored", "&sourceOffset=0&category=Commentary"]) expect((await dispatch(f.request(f.path("admin", suffix), { who: "admin" }))).status).toBe(400);
  expect((await dispatch(f.request(f.path(), { who: "admin", headers: { "content-length": "1" } }))).status).toBe(400);
  for (const [who, mode, status, target] of [["anonymous", "admin", 401, f.students[0].id], ["multi", "admin", 403, f.students[0].id], ["multi", "tutor", 404, f.students[3].id]] as const) expect((await dispatch(f.request(f.path(mode, "&sourceOffset=0", "torah", 0, target), { who }))).status).toBe(status);
  expect(f.loadText).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
});

test("review live authority receives only fixed staged503/changed409/bounds400 results, never partial catalog entries", async () => {
  const f = await fixture(), data = catalog(1), hash = ready(discoverRelatedPage(data, ref, { sourceOffset: 0 })).catalogHash;
  const unavailable = f.wire(async () => { throw new Error("Invented withheld provider failure"); }), normal = f.wire(async () => data);
  const samples = [await unavailable.dispatch(f.request(f.path(), { who: "admin" })), await normal.dispatch(f.request(f.path("admin", `&sourceOffset=10&catalogHash=${"b".repeat(64)}`), { who: "admin" })), await normal.dispatch(f.request(f.path("admin", `&sourceOffset=10&catalogHash=${hash}`), { who: "admin" }))];
  expect(samples.map(value => value.status)).toEqual([503, 409, 400]);
  for (const response of samples) { expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(JSON.stringify(await response.json())).not.toMatch(/entries|Invented|provider|indexTitle|catalogHash/); }
});

test("review complete HTTP authority envelope plus maximally escaped ten-entry page stays within64KiB", async () => {
  const f = await fixture(), raw = rows(10).map((row, index) => ({ ...row, _id: "x".repeat(124) + String(index).padStart(4, "0"), sourceRef: '\\"'.repeat(256), index_title: '"'.repeat(512), category: '"'.repeat(128), collectiveTitle: { en: '"'.repeat(256), he: '"'.repeat(256) } })), data = parseRelatedMetadata(raw, ref);
  expect(data.entries).toHaveLength(10); const { dispatch } = f.wire(async () => data), response = await dispatch(f.request(f.path(), { who: "admin" })); expect(response.status).toBe(200);
  const body = await response.text(); expect(Buffer.byteLength(body)).toBeLessThanOrEqual(64 * 1024); const parsed = JSON.parse(body); expect(parsed.sources.entries).toHaveLength(10); expect(parsed.sources.entries[0].ref).toBe(raw[0].sourceRef); expect(parsed.sources.nextSourceOffset).toBeNull();
});

test.each(["unavailable", "changed", "bounds", "catalog-mismatch"] as const)("review staged %s never bypasses the second actual relationship authorization", async outcome => {
  const f = await fixture(), data = catalog(1), page = ready(discoverRelatedPage(data, ref, { sourceOffset: 0 }));
  const held = f.held(async () => { if (outcome === "unavailable") throw new SourceMetadataUnavailable(); return outcome === "catalog-mismatch" ? catalog(1, "Genesis 1:2") : data; });
  const suffix = outcome === "changed" ? `&sourceOffset=10&catalogHash=${"a".repeat(64)}` : outcome === "bounds" ? `&sourceOffset=10&catalogHash=${page.catalogHash}` : "&sourceOffset=0";
  const pending = held.dispatch(f.request(f.path("parent", suffix), { who: "multi" })); await held.entered;
  await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date(), revision: sql`${s.guardian.revision}+1` }).where(eq(s.guardian.id, f.guardians[0].id)); }); held.release();
  const response = await pending; expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not-found" });
});

test("review original session expiry outranks provider failure despite caller cookie substitution", async () => {
  const f = await fixture(), held = f.held(async () => { throw new SourceMetadataUnavailable(); }), request = f.request(f.path(), { who: "admin" });
  const pending = held.service.read(request, f.selection(), { sourceOffset: 0 }), refused = expect(pending).rejects.toMatchObject({ status: 401 }); await held.entered;
  request.headers.set("cookie", f.identities.learner.cookie); await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId)); }); held.release(); await refused;
});

test("review original caller selection, paging and headers cannot rebind after public work begins", async () => {
  const f = await fixture(), held = f.held(), request = f.request(f.path(), { who: "admin" }), selection = { ...f.selection() }, paging = { sourceOffset: 0 };
  const pending = held.service.read(request, selection, paging); await held.entered; request.headers.delete("cookie"); selection.offset = 1; selection.studentId = f.students[3].id; paging.sourceOffset = 10; held.release();
  const result = await pending; expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic expected authorized result"); expect(result.sources).toMatchObject({ ref, sourceOffset: 0 }); expect(result.studentId).toBe(f.students[0].id);
});

test.each(["original", "other"] as const)("review mutated returned text target cannot redirect %s metadata after its await", async source => {
  const f = await fixture(), original = f.loadText.getMockImplementation()!; let target!: { ref: string };
  f.loadText.mockImplementation(async request => { const page = await original(request), copied = { ...page.verses[0] }; target = copied; return { ...page, verses: [copied] }; });
  const held = f.held(async () => catalog(1, source === "original" ? ref : "Genesis 1:2")), pending = held.dispatch(f.request(f.path(), { who: "admin" }));
  await held.entered; target.ref = "Genesis 1:2"; held.release(); const response = await pending;
  if (source === "original") { expect(response.status).toBe(200); expect((await response.json()).sources.ref).toBe(ref); }
  else { expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toMatch(/Genesis|entries|catalogHash/); }
});

test("review a real sibling replacement cannot rescue the old child-context request by mutating its handle", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { who: "multi", method: "POST" }), { studentId: f.students[0].id }), held = f.held();
  const request = f.request(f.path("child-practice"), { who: "multi", handle: entered.handle }), pending = held.service.read(request, f.selection("child-practice"), { sourceOffset: 0 }), refused = expect(pending).rejects.toMatchObject({ status: 404 }); await held.entered;
  const replacement = await f.runtime.practice.switch(f.request("/api/practice/switch", { who: "multi", method: "POST", handle: entered.handle }), { studentId: f.students[1].id }); request.headers.set("X-Practice-Context", replacement.handle); held.release(); await refused;
});

test.each(["student", "assignment", "grant"] as const)("review actual %s drift yields the old closed stale response with no catalog page", async field => {
  const f = await fixture(), held = f.held(), pending = held.dispatch(f.request(f.path(), { who: "admin" })); await held.entered;
  await f.owner(async () => {
    if (field === "student") await f.db.update(s.student).set({ revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.students[0].id));
    if (field === "assignment") await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignments[0].id));
    if (field === "grant") await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id));
  }); held.release(); const response = await pending; expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: "stale-revision" });
});

test("review abort during held discovery never projects a citation or staged source outcome", async () => {
  const f = await fixture(), held = f.held(), controller = new AbortController(), original = f.request(f.path(), { who: "admin" });
  const pending = held.service.read({ url: original.url, headers: original.headers, signal: controller.signal }, f.selection(), { sourceOffset: 0 }), refused = expect(pending).rejects.toMatchObject({ code: "upstream" }); await held.entered; controller.abort(); held.release(); await refused;
});
