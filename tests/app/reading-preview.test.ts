import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createReadingPreviewService } from "../../src/server/students/preview";
import { createBindings } from "../../src/server/students/bindings";
import { handlePortalRequest } from "../../src/server/http/portal";
import { createSefariaStudyReader, STUDY_LIMITS } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { ReadingUnavailable, type Snapshot } from "../../src/lib/readings/proposals";
import { parseAssigned } from "../../src/components/portal/workspace/api";
import { parsePreviewPreparation, parsePreviewPage } from "../../src/components/portal/workspace/preview-api";
import { syntheticResponse, deferred } from "../helpers/study";
import { syntheticUiStudyPage } from "../helpers/study-ui";
import * as roster from "../../src/server/data/roster";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f); let time = Date.now();
  const secret = randomBytes(48).toString("base64url");
  const calendar = vi.fn(async (date: string, calendar: "diaspora" | "israel"): Promise<{ snapshot: Snapshot; fetchedAt: number }> => ({ fetchedAt: time, snapshot: {
    date: parseCeremonyDate(date), calendar, classification: "regular", reading: { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal",
      aliyot: [{ n: 1, ref: "Genesis 1:1-2:25" }, { n: 2, ref: "Genesis 3:1-6:8" }, { n: "M", ref: "Numbers 28:9-10", reason: "Synthetic special maftir" }], triennial: null }, haftarah: "Isaiah 1:1-31" } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1)!)));
  const text = vi.fn(createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }));
  const service = createReadingPreviewService({ access: f.service, signingSecret: secret, loadReading: calendar, loadText: text, now: () => time });
  const runtime = { ...f.runtime, readingPreview: service }, id = f.students[0].id;
  const call = async (action: "prepare" | "page", body: unknown, options: Parameters<typeof f.request>[1] = {}) => {
    const response = await handlePortalRequest(f.request(`/api/students/${id}/reading/preview/${action}`, { body, ...options }), runtime);
    if (!response) throw new Error("Missing preview route"); return response;
  };
  const prepare = async (source: "calendar" | "manual" = "calendar", kind: "torah" | "haftarah" = "torah") => {
    const response = await call("prepare", { mode: "tutor", kind, source, ...(source === "manual" ? { ranges: ["Genesis 1:1-3"] } : {}) });
    expect(response.status).toBe(200); return response.json();
  };
  return { ...f, runtime, id, calendar, text, fetch, call, prepare, secret, advance: () => { time += 6 * 60000; }, now: () => time };
}

test("staff whole-portion preview is paginated, excludes extra maftir and round-trips canonical text/credits without changing assignments", async () => {
  const f = await fixture();
  const before = await f.owner(async () => ({ assignments: await f.db.select().from(s.assignment), verses: await f.db.select().from(s.assignmentVerse), audit: await f.db.select().from(s.auditEvent) }));
  const prepared = await f.prepare();
  expect(prepared).toMatchObject({ status: "prepared", ranges: ["Genesis 1:1-6:8"], verseCount: 146, maftir: { ref: "Numbers 28:9-10" }, calendarAliyot: [{ n: 1 }, { n: 2 }] });
  expect(prepared.pages).toHaveLength(2);
  const metadata = await handlePortalRequest(f.request(`/api/students/${f.id}/reading?mode=tutor`), f.runtime);
  const baseline = parseAssigned(await metadata!.json(), "tutor", f.id);
  const parsed = parsePreviewPreparation(prepared, baseline, "torah", "calendar");
  if (parsed.status !== "prepared") throw new Error("Expected prepared preview");
  for (const page of parsed.pages) {
    const response = await f.call("page", { mode: "tutor", binding: prepared.binding, offset: page.offset });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const body = await response.json(), text = parsePreviewPage(body, parsed, page.offset);
    expect(body.expiresAt).toBe(prepared.expiresAt); expect(text.verses.length).toBeLessThanOrEqual(100); expect(text.chapters.length).toBeLessThanOrEqual(8);
    expect(text.verses.every(verse => verse.ref.startsWith("Genesis "))).toBe(true); expect(text.chapters[0].editions[0].key).toBe("mam");
  }
  const claim = createBindings(f.secret, f.now).verify(prepared.binding, "reading-preview");
  expect(claim.sourceHash).toBeTypeOf("string"); expect(JSON.stringify(claim)).not.toMatch(/Synthetic example|hebrew|versions|readingText/);
  expect(f.fetch.mock.calls.every(([url, options]) => new URL(String(url)).origin === "https://www.sefaria.org" && options?.credentials === "omit")).toBe(true);
  expect(STUDY_LIMITS).toMatchObject({ verses: 100, chapters: 8, concurrency: 2, requestMs: 5000, pageMs: 8000 });
  const after = await f.owner(async () => ({ assignments: await f.db.select().from(s.assignment), verses: await f.db.select().from(s.assignmentVerse), audit: await f.db.select().from(s.auditEvent) }));
  expect(after).toEqual(before);
});

test("preview routes are closed staff-only POST bodies with Origin, tenant, relationship and context checks before public work", async () => {
  const f = await fixture(), body = { mode: "tutor", kind: "torah", source: "calendar" };
  for (const [change, status] of [[{ mode: "parent" }, 400], [{ mode: "student" }, 400], [{ mode: "child-practice" }, 400], [{ mode: "admin" }, 403], [{ url: "https://example.test" }, 400], [{ edition: "all" }, 400], [{ tenantId: "other" }, 400], [{ source: "arbitrary" }, 400]] as const)
    expect((await f.call("prepare", { ...body, ...change })).status).toBe(status);
  expect((await f.call("prepare", body, { who: "anonymous" })).status).toBe(401);
  expect((await f.call("prepare", body, { headers: { origin: "https://foreign.example.test" } })).status).toBe(403);
  expect((await f.call("prepare", body, { handle: "x".repeat(43) })).status).toBe(403);
  for (const id of [f.students[1].id, f.students[3].id]) {
    const response = await handlePortalRequest(f.request(`/api/students/${id}/reading/preview/prepare`, { body }), f.runtime); expect(response?.status).toBe(404);
  }
  const get = await handlePortalRequest(f.request(`/api/students/${f.id}/reading/preview/prepare`), f.runtime); expect(get?.status).toBe(405);
  const query = await handlePortalRequest(f.request(`/api/students/${f.id}/reading/preview/prepare?binding=synthetic`, { body }), f.runtime); expect(query?.status).toBe(400);
  for (const ranges of [["Genesis 1:999"], ["Genesis 1:2", "Genesis 1:1"], ["https://example.test"], ["Genesis 1:1-50:26"], Array(33).fill("Genesis 1:1")])
    expect([400, 403]).toContain((await f.call("prepare", { ...body, source: "manual", ranges })).status);
  expect(f.calendar).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
});

test("slot-derived candidates never skip weeks and unresolved calendar data permits only explicit manual preview", async () => {
  const f = await fixture();
  await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.id)); });
  const haft = await f.prepare("calendar", "haftarah"); expect(haft).toMatchObject({ readingDate: "2027-01-09", ranges: ["Isaiah 1:1-31"], calendarAliyot: [] });
  expect(f.calendar.mock.calls[0][0]).toBe("2027-01-09");
  const original = await f.calendar("2027-01-09", "diaspora");
  for (const classification of ["holiday", "multiple", "nonregular", "missing"] as const) {
    f.calendar.mockResolvedValueOnce({ ...original, snapshot: { ...original.snapshot, classification } });
    expect(await f.prepare()).toMatchObject({ status: "manual-required", manualFallback: classification, readingDate: "2027-01-09" });
  }
  f.calendar.mockRejectedValueOnce(new ReadingUnavailable("upstream")); expect(await f.prepare()).toMatchObject({ status: "manual-required", manualFallback: "calendar-source-unavailable" });
  await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, f.id)); });
  f.calendar.mockClear(); expect(await f.prepare()).toMatchObject({ status: "manual-required", readingDate: null, manualFallback: "unknown-slot" });
  const manual = await f.prepare("manual"); expect(manual).toMatchObject({ status: "prepared", source: "manual", readingDate: null, sourceFetchedAt: null, calendarAliyot: [] });
  expect((await f.call("page", { mode: "tutor", binding: manual.binding, offset: 0 })).status).toBe(200);
  expect(f.calendar).not.toHaveBeenCalled();
});

test("preview purpose, student/actor binding and server-selected offsets cannot authorize assignment confirmation or arbitrary reads", async () => {
  const f = await fixture(), prepared = await f.prepare();
  const confirm = await handlePortalRequest(f.request(`/api/students/${f.id}/reading/confirm`, { body: { mode: "tutor", binding: prepared.binding } }), f.runtime); expect(confirm?.status).toBe(403);
  for (const change of [{ binding: `${prepared.binding}x` }, { offset: 1 }, { url: "https://example.test" }, { ranges: ["Genesis 50:1-26"] }, { kind: "haftarah" }])
    expect([400, 403]).toContain((await f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0, ...change })).status);
  expect((await f.call("page", { mode: "admin", binding: prepared.binding, offset: 0 }, { who: "admin" })).status).toBe(403);
  expect((await f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0 }, { headers: { origin: "https://foreign.example.test" } })).status).toBe(403);
  expect(f.text).not.toHaveBeenCalled();
});

test("calendar preparation rechecks changed context before issuing any token", async () => {
  const f = await fixture(), original = await f.calendar("2027-01-02", "diaspora");
  f.calendar.mockImplementationOnce(async () => { await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "havdalah", revision: sql`${s.student.revision}+1` }).where(eq(s.student.id, f.id)); }); return original; });
  const response = await f.call("prepare", { mode: "tutor", kind: "torah", source: "calendar" }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: "stale-revision" });
  expect(f.text).not.toHaveBeenCalled();
});

test("stale date/slot/authority prevents a token's next page before fetching and revoked tutors receive no public text", async () => {
  const f = await fixture(), prepared = await f.prepare();
  await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.id)); });
  expect((await f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0 })).status).toBe(409); expect(f.text).not.toHaveBeenCalled();
  await f.owner(async () => { await f.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.id)); });
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revision: sql`${s.roleGrant.revision}+1` }).where(eq(s.roleGrant.id, f.tutorGrant.id)); });
  expect((await f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0 })).status).toBe(409); expect(f.text).not.toHaveBeenCalled();
  const fresh = await f.prepare();
  f.text.mockImplementationOnce(async request => { await f.owner(async () => { await f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.studentId, f.id)); }); return syntheticUiStudyPage(request); });
  const denied = await f.call("page", { mode: "tutor", binding: fresh.binding, offset: 0 }); expect(denied.status).toBe(404); expect(await denied.json()).toEqual({ error: "not-found" });
});

test("expiry after the final assignment lock wait withholds the already-loaded page", async () => {
  const f = await fixture(), prepared = await f.prepare(), waiting = deferred(), release = deferred(); let calls = 0;
  const original = roster.readingAssignmentVersion;
  vi.spyOn(roster, "readingAssignmentVersion").mockImplementation(async (...args) => { calls++; if (calls === 2) { waiting.resolve(); await release.promise; } return original(...args); });
  try {
    const result = f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0 }); await waiting.promise; expect(f.text).toHaveBeenCalledTimes(1); f.advance(); release.resolve();
    const response = await result; expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "forbidden" });
  } finally { release.resolve(); }
});


test("an assignment replacement during public text work makes the preview stale without returning licensed content",async()=>{
 const f=await fixture(),prepared=await f.prepare();
 f.text.mockImplementationOnce(async request=>{
  await f.owner(async()=>{await f.db.insert(s.assignment).values({tenantId:"crc",studentId:f.id,kind:"torah",basis:"custom",ref:"Genesis 1:1",status:"confirmed",setByMembershipId:f.adminMember.id});});
  return syntheticUiStudyPage(request);
 });
 const response=await f.call("page",{mode:"tutor",binding:prepared.binding,offset:0});
 expect(response.status).toBe(409);expect(await response.json()).toEqual({ok:false,code:"stale-revision"});
});


test("calendar maftir with an omitted optional reason projects a nullable reason and still opens the whole-portion page",async()=>{
 const f=await fixture(),original=await f.calendar("2027-01-02","diaspora");
 const reading=original.snapshot.reading!;
 f.calendar.mockResolvedValueOnce({...original,snapshot:{...original.snapshot,reading:{...reading,aliyot:reading.aliyot.map(row=>row.n==="M"?{n:row.n,ref:row.ref}:row)}}});
 const response=await f.call("prepare",{mode:"tutor",kind:"torah",source:"calendar"});
 expect(response.status).toBe(200);
 const body=await response.json();expect(body.maftir).toEqual({ref:"Numbers 28:9-10",reason:null});
 expect((await f.call("page",{mode:"tutor",binding:body.binding,offset:0})).status).toBe(200);
});
