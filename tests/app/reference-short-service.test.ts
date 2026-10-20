import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createShortReferenceAudioService } from "../../src/server/reference-audio/short-service";
import { createShortSourceManifestLoader, findShortSource, readShortSourceEntry, type ShortSourceManifest } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog, resolveReference, unavailableReference } from "../../src/server/reference-audio/catalog";
import { REFERENCE_ATTRIBUTION } from "../../src/lib/reference-audio/contract";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { parseReferenceResolution } from "../../src/lib/reference-audio/source";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { syntheticResponse } from "../helpers/study";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex"), json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-3", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return row;
  });
  const asset = `ra_${"1".repeat(32)}`, readingTextSha256 = createHash("sha256").update("אָ֑ב ג׃".normalize("NFC")).digest("hex");
  const raw = { schema: "reference-catalog/v1", source: "PockettorahAudioFiles", assets: [{ id: asset, archiveFile: "Synthetic.mp3", sha256: "a".repeat(64), bytes: 7,
    verses: [1, 2, 3].map(n => ({ schema: "reference-verse/v1", ref: `Genesis 1:${n}`, table: "torah", playback: { status: "ready", asset, clip: { start: n * 3 + 0.00002, end: n * 3 + 2.00001 } },
      words: { status: "ready", readingTextSha256, starts: [n * 3 + 0.1, n * 3 + 1] }, attribution: REFERENCE_ATTRIBUTION })) }] };
  const catalog = parseReferenceCatalog(raw)!, parent = json(raw);
  const source = (n: number, digit = String(n)) => { const h = digit.repeat(64), first = Math.floor((n * 3 + 0.00002) * 44100), last = Math.ceil((n * 3 + 2.00001) * 44100);
    return { schema: "reference-short-source/v1", id: `rs_${h}`, parent: { asset, sha256: "a".repeat(64), bytes: 7 }, sha256: h, bytes: 16500, path: `/reference-audio/short-v1/${h}.mp3`, codec: "mp3", bitrate: 64000,
      sampleRate: 44100, channels: 2, presentationFrames: last - first, origin: { firstFrame: first, parentRate: 44100 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version }; };
  const manifest = async (sources = [source(1), source(2), source(3)]) => {
    const body = json({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: hash(parent), recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: sources });
    return createShortSourceManifestLoader({ sha256: hash(body), parentCatalogSHA256: hash(parent), parentCatalogBytes: parent,
      get: async () => new ReadableStream({ start(c) { c.enqueue(body); c.close(); } }) })();
  };
  const loadText = createSefariaStudyReader({ fetch: async () => syntheticResponse(), verseCounts: TANAKH_VERSE_COUNTS });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023" as const, offset: 0 };
  const sealed = await manifest(), loadCatalog = vi.fn(async () => catalog), loadManifest = vi.fn(async () => sealed), text = vi.fn(loadText);
  const service = (overrides: Partial<Parameters<typeof createShortReferenceAudioService>[0]> = {}) => createShortReferenceAudioService({ access: f.service, practice: f.runtime.practice, loadText: text, loadCatalog, loadManifest, ...overrides });
  const request = (who: Parameters<typeof f.request>[1] = { who: "admin" }) => f.request("/api/reference-short", who);
  return { ...f, assignment, selection, catalog, source, manifest, sealed, loadText, text, loadCatalog, loadManifest, service, request };
}

test("genuine finder requires unique exact parent identity and enclosing nonzero native geometry", async () => {
  const f = await fixture(), page = await f.loadText({ kind: "torah", ranges: ["Genesis 1:1-3"], verses: ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"], offset: 0, translation: "jps2023" });
  const resolved = resolveReference(f.catalog, page.verses[0]), entry = findShortSource(f.sealed, resolved)!;
  expect(readShortSourceEntry(entry).source).toEqual(f.source(1));
  expect(findShortSource(await f.manifest([f.source(2)]), resolved)).toBeNull();
  expect(findShortSource(await f.manifest([f.source(1), f.source(1, "4")]), resolved)).toBeNull();
  expect(() => findShortSource({} as ShortSourceManifest, resolved)).toThrow("Reference unavailable");
  for (const change of [{ sha256: "b".repeat(64) }, { bytes: 8 }, { asset: `ra_${"2".repeat(32)}` }]) {
    const changed = parseReferenceResolution({ ...resolved, source: { ...resolved.source!, ...change },
      verse: change.asset ? { ...resolved.verse, playback: { ...resolved.verse.playback, asset: change.asset } } : resolved.verse });
    expect(changed).not.toBeNull(); expect(findShortSource(f.sealed, changed!)).toBeNull();
  }
  expect(findShortSource(f.sealed, unavailableReference("Genesis 1:1"))).toBeNull();
  if (resolved.verse.playback.status !== "ready") throw 0;
  const shifted = parseReferenceResolution({ ...resolved, verse: { ...resolved.verse, playback: { ...resolved.verse.playback,
    clip: { start: resolved.verse.playback.clip.start + 1 / 44100, end: resolved.verse.playback.clip.end } } } });
  expect(shifted).not.toBeNull(); expect(findShortSource(f.sealed, shifted!)).toBeNull();
});

test("page resolves all authorized verses with one text/catalog/manifest load and no parent fallback", async () => {
  const f = await fixture(), result = await f.service().readPage(f.request(), f.selection);
  if (!result.ok || !("page" in result)) throw 0;
  expect(result.page?.references.map(v => v.verse.ref)).toEqual(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
  expect(result.page?.references.map(v => v.source?.id)).toEqual([1, 2, 3].map(n => `rs_${String(n).repeat(64)}`));
  expect(f.text).toHaveBeenCalledTimes(1); expect(f.loadCatalog).toHaveBeenCalledTimes(1); expect(f.loadManifest).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result)).not.toContain("archive.org"); expect(JSON.stringify(result)).not.toContain("blobKey");
  const missing = await f.service({ loadManifest: () => f.manifest([f.source(3)]) }).read(f.request(), f.selection);
  if (!missing.ok || !("reference" in missing)) throw 0; expect(missing.reference?.source).toBeNull(); expect(missing.reference?.verse.playback.status).toBe("ready");
  const offset = await f.service().read(f.request(), { ...f.selection, offset: 1 });
  if (!offset.ok || !("reference" in offset)) throw 0; expect(offset.reference?.verse.ref).toBe("Genesis 1:2");
});

test("default release and actual authority deny before provider work", async () => {
  const f = await fixture(), service = f.service();
  for (const mode of ["student", "child-practice", "parent", "tutor"] as const) expect(service.listeningEnabled(mode)).toBe(false);
  expect(service.listeningEnabled("admin")).toBe(true);
  const enabled = f.service({ studentRelease: true });
  for (const mode of ["student", "child-practice", "parent", "tutor", "admin"] as const) expect(enabled.listeningEnabled(mode)).toBe(true);
  expect(f.text).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
  await expect(service.readPage(f.request({ who: "anonymous" }), f.selection)).rejects.toMatchObject({ status: 401 });
  await expect(service.readPage(f.request({ who: "multi" }), f.selection)).rejects.toMatchObject({ status: 403 });
  expect(await service.readPage(f.request(), { ...f.selection, assignmentRevision: 2 })).toEqual({ ok: false, code: "stale-revision" }); expect(f.text).not.toHaveBeenCalled();
  const learner = await service.readPage(f.request({ who: "learner" }), { ...f.selection, mode: "student" });
  if (!learner.ok || !("page" in learner)) throw 0;
  expect(learner.page?.references.every(v => v.source === null && v.verse.playback.status === "unavailable")).toBe(true);
  const released = await f.service({ studentRelease: true }).readPage(f.request({ who: "learner" }), { ...f.selection, mode: "student" });
  if (!released.ok) throw 0; expect(released.page.references.every(v => v.source !== null)).toBe(true);
});

test("page scope/order and pagination cannot be replaced by upstream text", async () => {
  const f = await fixture();
  for (const mutation of [(p: Awaited<ReturnType<typeof f.loadText>>) => ({ ...p, verses: [...p.verses].reverse() }),
    (p: Awaited<ReturnType<typeof f.loadText>>) => ({ ...p, nextOffset: 99 }), (p: Awaited<ReturnType<typeof f.loadText>>) => ({ ...p, totalVerses: 4 })]) {
    await expect(f.service({ loadText: async r => mutation(await f.loadText(r)) }).readPage(f.request(), f.selection)).rejects.toThrow("Reference unavailable");
  }
  expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
});

test("assignment revision and staff grant drift during manifest await suppress entire page", async () => {
  for (const grant of [false, true]) {
    const f = await fixture(), service = f.service({ loadManifest: async () => {
      await f.owner(async () => { if (grant) await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.adminGrant.id));
        else await f.db.update(s.assignment).set({ revision: sql`${s.assignment.revision}+1` }).where(eq(s.assignment.id, f.assignment.id)); }); return f.sealed;
    } });
    expect(await service.readPage(f.request(), f.selection)).toEqual({ ok: false, code: "stale-revision" });
  }
});

test("session expiry, abort, forged manifest and provider failures never deliver references", async () => {
  const f = await fixture(), abort = new AbortController();
  const req = f.request(), load = vi.fn(async () => { abort.abort(); return f.sealed; });
  await expect(f.service({ loadManifest: load }).readPage({ url: req.url, headers: req.headers, signal: abort.signal }, f.selection)).rejects.toThrow("Reference unavailable");
  expect(load).toHaveBeenCalledTimes(1);
  await expect(f.service({ loadManifest: async () => ({} as ShortSourceManifest) }).readPage(f.request(), f.selection)).rejects.toThrow("Reference unavailable");
  await expect(f.service({ loadManifest: async () => { throw new Error("synthetic provider failure"); } }).readPage(f.request(), f.selection)).rejects.toThrow("Reference unavailable");
  await expect(f.service({ loadManifest: async () => { await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, f.identities.admin.sessionId)); }); return f.sealed; } }).readPage(f.request(), f.selection)).rejects.toMatchObject({ status: 401 });
});

test("linked child practice revocation during manifest work denies delivery", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST",
    headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000" }) }, { studentId: f.students[0].id });
  const load = vi.fn(async () => { await f.runtime.practice.exit({ url: "http://localhost:3000/api/practice/leave", method: "POST",
    headers: new Headers({ cookie: f.identities.multi.cookie, origin: "http://localhost:3000", "X-Practice-Context": entered.handle }) }); return f.sealed; });
  await expect(f.service({ studentRelease: true, loadManifest: load }).readPage(f.request({ who: "multi", handle: entered.handle }),
    { ...f.selection, mode: "child-practice" })).rejects.toMatchObject({ status: 404 }); expect(load).toHaveBeenCalledTimes(1);
});

test("text input is detached before manifest awaits and optional asset is captured before text awaits", async () => {
  const f = await fixture(), selection = { ...f.selection, asset: f.source(1).parent.asset };
  let original: Awaited<ReturnType<typeof f.loadText>>;
  // Real readers freeze their result. Use an owned mutable provider fixture to
  // exercise an actual late change, rather than throwing at the mutation.
  const mutable = f.service({ loadText: async supplied => { original = structuredClone(await f.loadText(supplied)); selection.asset = `ra_${"2".repeat(32)}`; return original; },
    loadManifest: async () => { (original.verses[0] as { ref: string }).ref = "Genesis 1:9"; return f.sealed; } });
  const result = await mutable.read(f.request(), selection); if (!result.ok) throw 0;
  expect(result.reference.verse.ref).toBe("Genesis 1:1"); expect(result.reference.source?.parent.asset).toBe(f.source(1).parent.asset);
});

test("a real longer assignment yields bounded sequential pages, never an arbitrary ref list", async () => {
  const f = await fixture(), ref = "Genesis 1:1-4:26", refs = expandReadingRanges([ref], "torah", TANAKH_VERSE_COUNTS);
  await f.owner(async () => {
    await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await f.db.update(s.assignment).set({ ref }).where(eq(s.assignment.id, f.assignment.id));
    await f.db.insert(s.assignmentVerse).values(refs.map((verseRef, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef })));
  });
  const fetch = vi.fn(async (url: Parameters<typeof globalThis.fetch>[0]) => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const loadText = vi.fn(createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS })), service = f.service({ loadText });
  const first = await service.readPage(f.request(), f.selection); if (!first.ok) throw 0;
  expect(first.page.references).toHaveLength(100); expect(first.page.nextOffset).toBe(100); expect(first.page.totalVerses).toBe(106);
  expect(first.page.references.map(v => v.verse.ref)).toEqual(refs.slice(0, 100)); expect(fetch).toHaveBeenCalledTimes(4);
  expect(f.loadCatalog).toHaveBeenCalledTimes(1); expect(f.loadManifest).toHaveBeenCalledTimes(1);
  const second = await service.readPage(f.request(), { ...f.selection, offset: 100 }); if (!second.ok) throw 0;
  expect(second.page.references.map(v => v.verse.ref)).toEqual(refs.slice(100)); expect(second.page.nextOffset).toBeNull();
  expect(loadText).toHaveBeenCalledTimes(2); expect(f.loadCatalog).toHaveBeenCalledTimes(2); expect(f.loadManifest).toHaveBeenCalledTimes(2);
  expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(1024 * 1024);
});

test("ambiguous derivatives remain absent and text drift cannot become playable", async () => {
  const f = await fixture(), ambiguous = await f.service({ loadManifest: () => f.manifest([f.source(1), f.source(1, "4")]) }).read(f.request(), f.selection);
  if (!ambiguous.ok) throw 0; expect(ambiguous.reference.source).toBeNull();
  const held = await f.service({ loadText: async r => { const page = structuredClone(await f.loadText(r));
    (page.verses[0] as { hebrew: unknown }).hebrew = { ...page.verses[0].hebrew, text: "דָ֑ג ג׃", readingText: "דָ֑ג ג׃", segments: [{ kind: "text", text: "דָ֑ג ג׃" }] }; return page; } }).read(f.request(), f.selection);
  if (!held.ok) throw 0; expect(held.reference.source).toBeNull(); expect(held.reference.verse.playback.status).toBe("needs-review");
});

test("invalid asset never starts text or metadata I/O", async () => {
  const f = await fixture();
  await expect(f.service().read(f.request(), { ...f.selection, asset: "../other.mp3" })).rejects.toThrow("Reference unavailable");
  expect(f.text).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
});

test("linked parent overview reads assigned public references without creating child practice; unrelated children refuse before public work", async () => {
  const f = await fixture(), service = f.service({ studentRelease: true });
  const snapshot = () => f.owner(async () => ({ contexts: await f.db.select().from(s.practiceContext),
    assignment: await f.db.select().from(s.assignment).where(eq(s.assignment.id, f.assignment.id)),
    verses: await f.db.select().from(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id)) }));
  const before = await snapshot(), result = await service.readPage(f.request({ who: "multi" }), { ...f.selection, mode: "parent" });
  if (!result.ok) throw 0; expect(result.mode).toBe("parent"); expect(result.context).toBeNull();
  expect(result.page.references).toHaveLength(3); expect(result.page.references.every(v => v.source !== null)).toBe(true);
  expect(await snapshot()).toEqual(before);
  f.text.mockClear(); f.loadCatalog.mockClear(); f.loadManifest.mockClear();
  for (const student of [f.students[2], f.students[3]]) await expect(service.readPage(f.request({ who: "multi" }),
    { ...f.selection, mode: "parent", studentId: student.id })).rejects.toMatchObject({ status: 404 });
  await expect(service.readPage(f.request({ who: "multi", handle: "not-an-entered-practice-context" }),
    { ...f.selection, mode: "parent" })).rejects.toMatchObject({ status: 403 });
  expect(f.text).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
  expect(await snapshot()).toEqual(before);
});
