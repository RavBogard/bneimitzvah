import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createReadingExplorationService } from "../../src/server/study/exploration";
import { createShortExplorationService } from "../../src/server/reference-audio/short-exploration-service";
import { createBindings } from "../../src/server/students/bindings";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { parseReferenceShortResolution } from "../../src/lib/reference-audio/short-resolution";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseCeremonyDate, expandReadingRanges } from "../../src/lib/readings/ranges";
import type { Snapshot } from "../../src/lib/readings/proposals";
import { handlePortalRequest, portalRouteMethods } from "../../src/server/http/portal";
import { syntheticResponse } from "../helpers/study";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f); let time = Date.now();
  const now = () => time, secret = randomBytes(48).toString("base64url"), id = f.students[0].id, ref = "Genesis 1:1-4:26";
  const calendar = vi.fn(async (date: string, calendar: "israel" | "diaspora"): Promise<{ fetchedAt: number; snapshot: Snapshot }> => ({ fetchedAt: time,
    snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular", reading: { parashah: "Synthetic", source: "Hebcal", type: "shabbat", summary: "",
      aliyot: [{ n: 1, ref }], triennial: null }, haftarah: null } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const reader = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }), text = vi.fn(reader);
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const manifest = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent,
    get: async () => byteStream(source.manifest) })();
  const loadCatalog = vi.fn(async () => catalog), loadManifest = vi.fn(async () => manifest);
  const base = { access: f.service, practice: f.runtime.practice, signingSecret: secret, now, loadReading: calendar, loadText: text };
  const normal = createReadingExplorationService(base), short = (released = true) => createShortExplorationService({ ...base, loadCatalog, loadManifest, studentRelease: released });
  const runtime = { ...f.runtime, readingExploration: normal, shortExplorationAudio: short() };
  const path = `/api/students/${id}/reading/explore/reference/short/page`;
  const call = async (body: unknown, options: Parameters<typeof f.request>[1] = { who: "learner" }, target = id) => {
    const response = await handlePortalRequest(f.request(`/api/students/${target}/reading/explore/reference/short/page`, { body, ...options }), runtime);
    if (!response) throw new Error("Expected exploration short route"); return response;
  };
  const prepare = async (mode = "student", options: Parameters<typeof f.request>[1] = { who: "learner" }) => {
    const response = await handlePortalRequest(f.request(`/api/students/${id}/reading/explore/prepare`, { body: { mode }, ...options }), runtime);
    if (!response || response.status !== 200) throw new Error("Expected actual prepared exploration"); return response.json();
  };
  const page = (binding: string, offset = 0) => call({ mode: "student", binding, offset });
  const assign = () => f.owner(async () => { const [assignment] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: id, kind: "torah", status: "confirmed", basis: "custom", ref: "Genesis 1:1-3", setByMembershipId: f.adminMember.id,
    proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); return assignment; });
  return { ...f, runtime, normal, short, id, path, ref, call, prepare, page, text, reader, fetch, loadCatalog, loadManifest, calendar, secret, assign, manifest, now, advance: (ms: number) => { time += ms; } };
}

test("actual existing prepare binding authorizes full proposed short pages100+6 without assignment/progress/audit writes", async () => {
  const f = await fixture(), snapshot = () => f.owner(async () => ({ assignment: await f.db.select().from(s.assignment), verses: await f.db.select().from(s.assignmentVerse),
    context: await f.db.select().from(s.practiceContext), checks: await f.db.select().from(s.verseSelfCheck), assessments: await f.db.select().from(s.verseAssessment), audit: await f.db.select().from(s.auditEvent) }));
  const before = await snapshot(), prepared = await f.prepare(); expect(prepared.status).toBe("prepared"); expect(prepared.ranges).toEqual([f.ref]); expect(prepared.verseCount).toBe(106);
  expect(portalRouteMethods(f.path)).toEqual(["POST"]); const refs = expandReadingRanges([f.ref], "torah", TANAKH_VERSE_COUNTS);
  for (const offset of [0, 100]) {
    const response = await f.page(prepared.binding, offset); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json(); expect(Object.keys(body).sort()).toEqual(["expiresAt", "kind", "mode", "page", "studentId", "studentRevision"]);
    expect(body.kind).toBe("torah"); expect(body.expiresAt).toBe(prepared.expiresAt); expect(body.page.references.map((v: { verse: { ref: string } }) => v.verse.ref)).toEqual(refs.slice(offset, offset + 100));
    expect(body.page.references.every((v: unknown) => parseReferenceShortResolution(v))).toBe(true); expect(body.page.references.length).toBeLessThanOrEqual(100);
    expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(1024 * 1024); expect(body).not.toHaveProperty("assignment");
    if (offset === 0) expect(body.page.references[0].source).not.toBeNull();
  }
  expect(f.text).toHaveBeenCalledTimes(2); expect(f.loadCatalog).toHaveBeenCalledTimes(2); expect(f.loadManifest).toHaveBeenCalledTimes(2); expect(f.calendar).toHaveBeenCalledOnce();
  expect(await snapshot()).toEqual(before);
});

test("cross-purpose/forged/cross-child/mode bindings and parent dashboard cannot reach public work", async () => {
  const f = await fixture(), prepared = await f.prepare(), claim = createBindings(f.secret, f.now).verify(prepared.binding, "reading-exploration");
  for (const binding of [prepared.binding + "x", createBindings(f.secret, f.now).sign({ ...claim, purpose: "reading-preview" }), createBindings(f.secret, f.now).sign({ ...claim, purpose: "student-reading" })]) expect((await f.page(binding)).status).toBe(403);
  expect((await f.call({ mode: "student", binding: prepared.binding, offset: 0 }, { who: "learner" }, f.students[1].id)).status).toBe(403);
  expect((await f.call({ mode: "tutor", binding: prepared.binding, offset: 0 }, { who: "multi" })).status).toBe(403);
  expect((await f.call({ mode: "parent", binding: prepared.binding, offset: 0 }, { who: "multi" })).status).toBe(400);
  expect((await f.call({ mode: "student", binding: prepared.binding, offset: 0 }, { who: "anonymous" })).status).toBe(401);
  expect(f.text).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled(); expect(f.loadManifest).not.toHaveBeenCalled();
});

test("POST same-origin/closed body/query/offset boundary and incumbent assigned-purpose separation remain strict", async () => {
  const f = await fixture(), prepared = await f.prepare(), valid = { mode: "student", binding: prepared.binding, offset: 0 };
  for (const extra of [{ assignmentId: f.id }, { ranges: ["Genesis 1:1"] }, { kind: "haftarah" }, { tenantId: "crc" }]) expect((await f.call({ ...valid, ...extra })).status).toBe(400);
  expect((await f.call({ ...valid, offset: 1 })).status).toBe(400); expect((await f.call({ ...valid, offset: "0" })).status).toBe(400);
  expect((await f.call(valid, { who: "learner", headers: { origin: "https://foreign.example.test" } })).status).toBe(403);
  expect((await handlePortalRequest(f.request(f.path + "?offset=0", { who: "learner", body: valid }), f.runtime))?.status).toBe(400);
  expect((await handlePortalRequest(f.request(f.path, { who: "learner" }), f.runtime))?.status).toBe(405);
  const assigned = `/api/students/${f.id}/reference-audio/short/page?mode=student&kind=torah&binding=${encodeURIComponent(prepared.binding)}&offset=0`;
  expect((await handlePortalRequest(f.request(assigned, { who: "learner" }), f.runtime))?.status).toBe(400);
  expect(f.text).not.toHaveBeenCalled(); expect(f.loadCatalog).not.toHaveBeenCalled();
});

test("confirmed Torah always wins; unknown slot/nonregular proposal never yields a short capability", async () => {
  const f = await fixture(); await f.assign(); const assigned = await f.prepare(); expect(assigned.status).toBe("assigned"); expect(assigned).not.toHaveProperty("binding"); expect(f.calendar).not.toHaveBeenCalled();
  const g = await fixture(); await g.owner(() => g.db.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, g.id)));
  expect(await g.prepare()).toMatchObject({ status: "unresolved", reason: "unknown-slot" }); expect(g.calendar).not.toHaveBeenCalled();
  await g.owner(() => g.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, g.id)));
  const source = await g.calendar("2027-01-02", "diaspora"); g.calendar.mockResolvedValueOnce({ ...source, snapshot: { ...source.snapshot, classification: "holiday" } });
  expect(await g.prepare()).toMatchObject({ status: "unresolved", reason: "holiday" }); expect(g.loadCatalog).not.toHaveBeenCalled();
});

test("assignment arrival, ceremony/slot drift and live relationship revocation during manifest work suppress page", async () => {
  for (const change of ["assignment", "date", "slot", "relationship"] as const) {
    const f = await fixture(), prepared = await f.prepare();
    f.loadManifest.mockImplementationOnce(async () => {
      if (change === "assignment") await f.assign();
      else if (change === "date") await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2027-01-09", revision: 2 }).where(eq(s.student.id, f.id)));
      else if (change === "slot") await f.owner(() => f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.id)));
      else await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
      return f.manifest;
    });
    const response = await f.page(prepared.binding); expect(response.status, change).toBe(change === "relationship" ? 404 : 409);
    expect(f.loadManifest).toHaveBeenCalledOnce(); expect(await response.text()).not.toContain("references");
  }
});

test("claim expiry and natural originating-session expiry after metadata awaits are final delivery fences", async () => {
  const f = await fixture(), prepared = await f.prepare(); f.loadManifest.mockImplementationOnce(async () => { f.advance(300001); return f.manifest; });
  expect((await f.page(prepared.binding)).status).toBe(403); expect(f.loadManifest).toHaveBeenCalledOnce();
  const g = await fixture(); await g.owner(() => g.db.update(s.session).set({ expiresAt: new Date(g.now() + 60000) }).where(eq(s.session.id, g.identities.learner.sessionId)));
  const current = await g.prepare(); g.loadManifest.mockImplementationOnce(async () => { g.advance(61000); return g.manifest; });
  expect((await g.page(current.binding)).status).toBe(401); expect(g.loadManifest).toHaveBeenCalledOnce();
});

test("explicit child practice works, context revocation during metadata work denies without parent fallback", async () => {
  const f = await fixture(), entered = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ origin: "http://localhost:3000", cookie: f.identities.multi.cookie }) }, { studentId: f.id });
  const prepared = await f.prepare("child-practice", { who: "multi", handle: entered.handle }), body = { mode: "child-practice", binding: prepared.binding, offset: 0 };
  expect((await f.call(body, { who: "multi", handle: entered.handle })).status).toBe(200);
  f.loadManifest.mockImplementationOnce(async () => { await f.runtime.practice.exit({ url: "http://localhost:3000/api/practice/exit", method: "POST", headers: new Headers({ origin: "http://localhost:3000", cookie: f.identities.multi.cookie, "X-Practice-Context": entered.handle }) }); return f.manifest; });
  expect((await f.call(body, { who: "multi", handle: entered.handle })).status).toBe(404);
  expect((await f.call(body, { who: "multi" })).status).toBe(404);
});

test("default release masks learner references but admin remains available using its own real prepare", async () => {
  const f = await fixture(); f.runtime.shortExplorationAudio = f.short(false);
  const learner = await f.prepare(), result = await f.page(learner.binding); expect(result.status).toBe(200);
  expect((await result.json()).page.references.every((v: { source: unknown; verse: { playback: { status: string } } }) => v.source === null && v.verse.playback.status === "unavailable")).toBe(true);
  const admin = await f.prepare("admin", { who: "admin" }), response = await f.call({ mode: "admin", binding: admin.binding, offset: 0 }, { who: "admin" });
  expect(response.status).toBe(200); expect((await response.json()).page.references[0].source).not.toBeNull();
});

test("wrong text page scope or metadata failure cannot leak private diagnostics or return partial metadata", async () => {
  const f = await fixture(), prepared = await f.prepare();
  f.text.mockImplementationOnce(async r => { const page = await f.reader(r); return { ...page, verses: [...page.verses].reverse() }; });
  expect((await f.page(prepared.binding)).status).toBe(503); expect(f.loadCatalog).not.toHaveBeenCalled();
  f.loadManifest.mockRejectedValueOnce(new Error("synthetic private detail")); const failed = await f.page(prepared.binding);
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("synthetic");
  const abort = new AbortController(); f.loadManifest.mockImplementationOnce(async () => { abort.abort(); return f.manifest; });
  const req = f.request(f.path, { body: {}, who: "learner" });
  const calls = f.loadManifest.mock.calls.length;
  await expect(f.runtime.shortExplorationAudio.page({ url: req.url, method: req.method, headers: req.headers, signal: abort.signal },
    { mode: "student", studentId: f.id, binding: prepared.binding, offset: 0 })).rejects.toThrow("Reference unavailable");
  expect(f.loadManifest).toHaveBeenCalledTimes(calls + 1); expect(abort.signal.aborted).toBe(true);
});

test("late mutable provider text cannot replace the already checked page or expose hidden fields", async () => {
  const f = await fixture(), prepared = await f.prepare(); let original: Awaited<ReturnType<typeof f.reader>>;
  f.text.mockImplementationOnce(async r => { original = structuredClone(await f.reader(r)); return original; });
  f.loadManifest.mockImplementationOnce(async () => { (original.verses[0] as { ref: string }).ref = "Genesis 9:9"; return f.manifest; });
  const response = await f.page(prepared.binding); expect(response.status).toBe(200); const body = await response.json();
  expect(body.page.references[0].verse.ref).toBe("Genesis 1:1"); expect(body.page.references[0].source).not.toBeNull();
  expect(body).not.toHaveProperty("binding"); expect(body).not.toHaveProperty("context"); expect(body).not.toHaveProperty("ceremonyDate");
});
