// Independent invented extents only; no source fetch, real family data or SQL server.
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import type { Assigned } from "../../src/components/portal/workspace/api";
import { captureSourceContent, parseSourceContentResponse as clientParse, type EditionChoice, type SourceSegments } from "../../src/components/portal/workspace/study/sources/content-api";
import { parseSourceContent, parseSourceContentResponse as serverParse } from "../../src/server/study/sources/content";
import { parseSourceSegments } from "../../src/server/study/sources/content-extents";
import { parseRelatedMetadata, parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { projectEditionCatalog } from "../../src/server/study/sources/editions";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { portalRoutesFixture } from "./portal-routes-fixture";

const work = "Invented Review Commentary", parent = `${work} 4:9`, range = `${parent}:7-9`;
const source = (ref = parent) => ({ id: "review_extent", ref, indexTitle: work, category: "Commentary", labels: { en: null, he: null } });
const edition = { versionTitle: "Invented Review Edition", language: "en", actualLanguage: "he", license: "CC0", source: "inert:review provenance" } as const;
const input = (ref = parent) => ({ source: source(ref), edition, language: "he" as const });
function body(text: unknown = [" First e\u0301.\n", "", "Last."], ref = parent, sections = ["4", "9"], end = sections, depth = 3) {
  return { ref, indexTitle: work, textDepth: depth, sections, toSections: end, isComplex: false, addressTypes: Array(depth).fill("Integer"), index_offsets_by_depth: {}, isSpanning: false, warnings: [], missings: [], versions: [{ versionTitle: edition.versionTitle, language: "en", actualLanguage: "he", languageFamilyName: "hebrew", license: "CC0", versionSource: edition.source, text }] };
}
const parse = (raw: unknown = body(), ref = parent) => parseSourceSegments(raw, input(ref));
const id = "10000000-0000-4000-8000-000000000001", aid = "10000000-0000-4000-8000-000000000002", hash = "a".repeat(64);
function base(): Assigned { return { mode: "student", student: { id, revision: 2, firstName: "Invented", lastName: "Review", ceremonyDate: "2027-01-02" }, context: null, readings: [{ id: aid, kind: "torah", revision: 3, ranges: ["Genesis 1:1"], verses: ["Genesis 1:1"], needsReview: false, aliyahStarts: null, basis: "custom", confirmationDate: "2027-01-02", source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } }] }; }
const choice: EditionChoice = { editionCatalogHash: "b".repeat(64), edition, language: "he" };
function capture(ref = parent) { return captureSourceContent({ baseline: base(), kind: "torah", offset: 0 }, { source: source(ref), sourceScope: "related", sourceCatalogHash: hash }); }
function projection(): SourceSegments { return { schema: "study-source-segments/v1", ref: parent, extent: { kind: "parent", parentRef: parent, requestedStart: null, requestedEnd: null, observedStart: "1", observedEnd: "3" }, segments: [{ ref: `${parent}:1`, status: "text", text: " First e\u0301.\n" }, { ref: `${parent}:2`, status: "missing", text: null }, { ref: `${parent}:3`, status: "text", text: "Last." }], edition: { versionTitle: edition.versionTitle, language: "en", actualLanguage: "he" }, provenance: { provider: "Sefaria", sourceRef: parent, editionTitle: edition.versionTitle, license: "CC0", versionSource: edition.source, format: "text_only" } }; }
function envelope(text: unknown = projection()) { return { ok: true, studentId: id, studentRevision: 2, mode: "student", context: null, assignment: { id: aid, revision: 3, kind: "torah", needsReview: false }, verseRef: "Genesis 1:1", source: source(), sourceCatalogHash: hash, text }; }
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });

test("review parent positions preserve an interior hole and NFD without canonical-tail claims", () => {
  const raw = body(), result = parse(raw); expect(result).toEqual(projection());
  expect(result.segments.map(row => row.ref)).toEqual([`${parent}:1`, `${parent}:2`, `${parent}:3`]);
  (raw.versions[0].text as string[])[0] = "Changed"; expect(result.segments[0].text).toBe(" First e\u0301.\n");
  expect(Object.isFrozen(result.segments)).toBe(true); expect(Object.isFrozen(result.segments[1])).toBe(true); expect(Object.isFrozen(result.extent)).toBe(true);
  expect(Object.keys(result.extent).sort()).toEqual(["kind", "observedEnd", "observedStart", "parentRef", "requestedEnd", "requestedStart"]);
});

test("review empty/all-missing parents remain observations; ranges cannot invent absent tails", () => {
  expect(parse(body([]))).toMatchObject({ segments: [], extent: { requestedStart: null, requestedEnd: null, observedStart: null, observedEnd: null } });
  expect(parse(body(["", ""])).segments).toEqual([{ ref: `${parent}:1`, status: "missing", text: null }, { ref: `${parent}:2`, status: "missing", text: null }]);
  const valid = body(["", "Middle.", ""], range, ["4", "9", "7"], ["4", "9", "9"]);
  expect(parse(valid, range).segments.map(row => row.ref)).toEqual([`${parent}:7`, `${parent}:8`, `${parent}:9`]);
  for (const values of [[], [""], ["", "Middle."], ["", "Middle.", "", "Extra"]]) expect(() => parse({ ...valid, versions: [{ ...valid.versions[0], text: values }] }, range)).toThrow();
});

test("review depth2/depth4 and exact signed32 maximum do not overflow or renumber", () => {
  const shallow = `${work} 6`, deep = `${work} 2147483647:3:4`, high = `${work} 1:2147483646-2147483647`;
  expect(parse(body(["One"], shallow, ["6"], ["6"], 2), shallow).segments[0].ref).toBe(`${shallow}:1`);
  expect(parse(body(["One"], deep, ["2147483647", "3", "4"], ["2147483647", "3", "4"], 4), deep).segments[0].ref).toBe(`${deep}:1`);
  expect(parse(body(["", "End"], high, ["1", "2147483646"], ["1", "2147483647"], 2), high).segments.map(row => row.ref)).toEqual([`${work} 1:2147483646`, `${work} 1:2147483647`]);
  for (const ref of [`${work} 2147483648`, `${work} 01:9`, `${work} ４:9`, `${parent}:9-7`, `${parent}:7-7`, `${parent}:7-4:9:9`, `${work} 1:2:3:4`, `${work} 1:1-65`]) expect(() => parse(body(["x"], ref), ref)).toThrow();
});

test("review new profile cannot infer absent offsets, node type, addresses or edition facts", () => {
  for (const patch of [{ index_offsets_by_depth: undefined }, { index_offsets_by_depth: { "3": 0 } }, { index_offsets_by_depth: [] }, { isComplex: true }, { textDepth: 2 }, { addressTypes: ["Integer", "Integer", "Talmud"] }, { sections: [4, 9] }, { toSections: ["4", "10"] }, { ref: `${parent}:1` }, { missings: [["he", "edition"]] }, { warnings: ["held"] }, { isSpanning: true }]) expect(() => parse({ ...body(), ...patch })).toThrow();
  const inherited = Object.create({ index_offsets_by_depth: {} }); Object.assign(inherited, body()); delete inherited.index_offsets_by_depth; expect(() => parse(inherited)).toThrow();
  for (const patch of [{ license: "Public Domain" }, { versionSource: "changed" }, { language: "he" }, { languageFamilyName: "english" }, { actualLanguage: "en" }, { sources: [edition.versionTitle] }]) { const raw = body(); Object.assign(raw.versions[0], patch); expect(() => parse(raw)).toThrow(); }
  expect(() => parseSourceSegments(body(), { ...input(), edition: { ...edition, license: "Unknown rights" } })).toThrow();
});

test("review sparse/accessor/nested/unsafe scalar positions hold without invoking getters", () => {
  for (const value of [[null], [[]], [" "], ["<b>invented</b>"], ["&amp;"], ["x\u202ey"], ["\ud800"], Array(65).fill("")]) expect(() => parse(body(value))).toThrow();
  const getter = vi.fn(() => "x"), sparse = ["a", "b"]; delete sparse[0]; expect(() => parse(body(sparse))).toThrow();
  const accessor = ["a"]; Object.defineProperty(accessor, "0", { get: getter }); expect(() => parse(body(accessor))).toThrow();
  const raw = body(); Object.defineProperty(raw, "index_offsets_by_depth", { get: getter }); expect(() => parse(raw)).toThrow(); expect(getter).not.toHaveBeenCalled();
});

test("review aggregate64KiB is shared across positions, with independent client escaped128KiB", () => {
  const exact = ["x".repeat(32768), "y".repeat(32768)]; expect(parse(body(exact)).segments).toHaveLength(2);
  expect(() => parse(body([...exact, "z"]))).toThrow(); expect(parse(body(Array(64).fill(""))).segments).toHaveLength(64);
  const raw = { ...projection(), extent: { ...projection().extent, observedEnd: "2" }, segments: exact.map((text, i) => ({ ref: `${parent}:${i + 1}`, status: "text" as const, text })) };
  expect(clientParse(envelope(raw), capture(), choice).schema).toBe("study-source-segments/v1");
  raw.segments = raw.segments.map(row => ({ ...row, status: "text", text: '"'.repeat(32768) })); expect(() => clientParse(envelope(raw), capture(), choice)).toThrow();
});

test("review strict client rederives count/ref/extent and never trusts an echoed position map", () => {
  expect(clientParse(envelope(), capture(), choice)).toEqual(projection());
  for (const patch of [{ segments: [...projection().segments].reverse() }, { segments: [projection().segments[0], projection().segments[0], projection().segments[2]] }, { segments: [] }, { extent: { ...projection().extent, observedEnd: "4" } }, { extent: { ...projection().extent, requestedStart: "1" } }, { extent: { ...projection().extent, kind: "range" } }, { provenance: { ...projection().provenance, sourceRef: `${parent}:1` } }, { extra: true }]) expect(() => clientParse(envelope({ ...projection(), ...patch }), capture(), choice)).toThrow();
  for (const patch of [{ studentRevision: 3 }, { mode: "parent" }, { sourceCatalogHash: "c".repeat(64) }, { source: source(`${parent}:1`) }, { expectedSetVersion: 1 }]) expect(() => clientParse({ ...envelope(), ...patch }, capture(), choice)).toThrow();
  const getter = vi.fn(), raw = projection(); Object.defineProperty(raw.segments[0], "text", { get: getter }); expect(() => clientParse(envelope(raw), capture(), choice)).toThrow(); expect(getter).not.toHaveBeenCalled();
});

test("review old scalar parser and union dispatcher retain exact single-leaf compatibility", () => {
  const ref = `${parent}:2`, raw = body(" Exact scalar e\u0301.\n", ref, ["4", "9", "2"], ["4", "9", "2"]);
  const prior = parseSourceContent(raw, input(ref)); expect(prior.schema).toBe("study-source-text/v1"); expect(serverParse(raw, input(ref))).toEqual(prior);
  expect(() => parseSourceContent(body(), input())).toThrow(); expect(serverParse(body(), input()).schema).toBe("study-source-segments/v1");
});

async function serviceFixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => { const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1", status: "confirmed", setByMembershipId: f.adminMember.id }).returning(); await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: 1, verseRef: "Genesis 1:1" }); return a; });
  const related = parseRelatedMetadata([{ _id: source().id, sourceRef: parent, index_title: work, category: "Commentary", anchorRef: "Genesis 1:1" }], "Genesis 1:1");
  const editions = parseEditionMetadata([{ title: work, ...edition, versionSource: edition.source }], work);
  const sourceHash = projectRelatedCatalog(related, "Genesis 1:1").catalogHash;
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 };
  const intent = { verseRef: "Genesis 1:1", sourceId: source().id, sourceScope: "related" as const, sourceCatalogHash: sourceHash, editionCatalogHash: projectEditionCatalog(editions, work).editionCatalogHash, editionTitle: edition.versionTitle, language: "he" as const };
  const request = () => f.request("/api/source", { who: "admin" });
  const writeRequest = () => f.request("/api/source", { who: "admin", method: "POST" });
  const build = (content: () => Promise<unknown>) => createSourceContentService({ access: f.service, practice: f.runtime.practice, related: async () => related, editions: async () => editions, content });
  const writes = createSourceAssignmentsService({ access: f.service, practice: f.runtime.practice, related: async () => related });
  return { ...f, selection, intent, request, writeRequest, build, writes, sourceHash };
}

test("review actual assigned head change wins over a late empty extent, without provider re-resolution", async () => {
  const f = await serviceFixture(); const initial = await f.writes.replace(f.writeRequest(), f.selection, { verseRef: "Genesis 1:1", expectedVersion: 0, mutationId: randomUUID(), sourceIds: [source().id], catalogHash: f.sourceHash }); expect(initial.ok).toBe(true);
  let entered!: () => void, release!: () => void; const entry = new Promise<void>(r => entered = r), wait = new Promise<void>(r => release = r);
  const { sourceCatalogHash: _hash, ...rest } = f.intent;
  const pending = f.build(async () => { entered(); await wait; return body([]); }).text(f.request(), f.selection, { ...rest, sourceScope: "assigned", expectedSetVersion: 1 }); await entry;
  try { const changed = await f.writes.replace(f.writeRequest(), f.selection, { verseRef: "Genesis 1:1", expectedVersion: 1, mutationId: randomUUID(), sourceIds: [] }); expect(changed.ok).toBe(true); } finally { release(); }
  expect(await pending).toEqual({ ok: false, error: "source-set-changed" });
});

test("review actual session expiry outranks malformed offset proof and all-missing success", async () => {
  for (const malformed of [false, true]) { const f = await serviceFixture(); const service = f.build(async () => { await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.id, f.identities.admin.sessionId))); return { ...body(["", ""]), ...(malformed ? { index_offsets_by_depth: { "3": 0 } } : {}) }; }); await expect(service.text(f.request(), f.selection, f.intent)).rejects.toMatchObject({ status: 401 }); }
});

test("review shared public20s deadline fences an otherwise valid empty-parent observation", async () => {
  const f = await serviceFixture(); let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  const service = f.build(async () => { now = 20000; return body([]); }); expect(await service.text(f.request(), f.selection, f.intent)).toEqual({ ok: false, error: "unavailable" });
});
