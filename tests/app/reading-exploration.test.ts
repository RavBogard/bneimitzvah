import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createReadingExplorationService } from "../../src/server/study/exploration";
import { createBindings } from "../../src/server/students/bindings";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { ReadingUnavailable, type Snapshot } from "../../src/lib/readings/proposals";
import { handlePortalRequest } from "../../src/server/http/portal";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { syntheticResponse } from "../helpers/study";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f); let time = Date.now();
  const secret = randomBytes(48).toString("base64url"), id = f.students[0].id;
  const calendar = vi.fn(async (date: string, calendar: "israel" | "diaspora"): Promise<{ fetchedAt: number; snapshot: Snapshot }> => ({ fetchedAt: time,
    snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular", reading: { parashah: "Synthetic", source: "Hebcal", type: "shabbat", summary: "",
      aliyot: [{ n: 1, ref: "Genesis 1:1-2:25" }, { n: 2, ref: "Genesis 3:1-6:8" }, { n: "M", ref: "Numbers 28:9-10" }], triennial: null }, haftarah: null } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(String(url)).pathname.split("/").at(-1)!)));
  const reader = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }), text = vi.fn(reader);
  const exploration = createReadingExplorationService({ access: f.service, practice: f.runtime.practice, loadReading: calendar, loadText: text, signingSecret: secret, now: () => time });
  const runtime = { ...f.runtime, readingExploration: exploration };
  const call = async (action: "prepare" | "page", body: unknown, options: Parameters<typeof f.request>[1] = {}, studentId = id) => {
    const response = await handlePortalRequest(f.request(`/api/students/${studentId}/reading/explore/${action}`, { body, ...options }), runtime);
    if (!response) throw new Error("Exploration route missing"); return response;
  };
  const prepare = async (mode = "student", options: Parameters<typeof f.request>[1] = { who: "learner" }) => {
    const response = await call("prepare", { mode }, options); expect(response.status).toBe(200); return response.json();
  };
  const page = (binding: string, offset = 0) => call("page", { mode: "student", binding, offset }, { who: "learner" });
  const assign = () => f.owner(async () => {
    const [assignment] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: id, kind: "torah", status: "confirmed", basis: "custom", ref: "Genesis 1:1-3", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: "2027-01-02" } }).returning();
    await f.db.insert(s.assignmentVerse).values([1, 2, 3].map(n => ({ tenantId: "crc", studentId: id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
    return assignment;
  });
  return { ...f, id, runtime, calendar, reader, text, fetch, call, prepare, page, secret, assign, now: () => time, advance: (ms: number) => { time += ms; } };
}

test("self exploration returns the complete computed portion, paginates canonical text and never persists assignment, progress or audit", async () => {
  const f = await fixture();
  const snapshot = () => f.owner(async () => ({ assignments: await f.db.select().from(s.assignment), verses: await f.db.select().from(s.assignmentVerse),
    selfChecks: await f.db.select().from(s.verseSelfCheck), assessments: await f.db.select().from(s.verseAssessment), audit: await f.db.select().from(s.auditEvent) }));
  const before = await snapshot(), prepared = await f.prepare();
  expect(prepared).toMatchObject({ status: "prepared", kind: "torah", readingDate: "2027-01-02", ranges: ["Genesis 1:1-6:8"], verseCount: 146 });
  for (const key of ["actor", "context", "sessionExpiresAt", "authSessionId", "tenantId", "assignmentId", "sourceHash"]) expect(prepared).not.toHaveProperty(key);
  expect(prepared.pages).toHaveLength(2); let total = 0;
  for (const part of prepared.pages) {
    const response = await f.page(prepared.binding, part.offset), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(body.verses.length).toBeLessThanOrEqual(100); expect(body.chapters.length).toBeLessThanOrEqual(8);
    expect(body.chapters[0].editions[0].key).toBe("mam"); expect(body).not.toHaveProperty("assignment"); total += body.verses.length;
  }
  expect(total).toBe(146); expect(await snapshot()).toEqual(before);
});

test("confirmed Torah wins without divisions and without calendar or public-text work", async () => {
  const f = await fixture(), assignment = await f.assign(), value = await f.prepare();
  expect(value).toMatchObject({ status: "assigned", assignment: { id: assignment.id, revision: 1 } });
  expect(value).not.toHaveProperty("binding"); expect(f.calendar).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled();
});

test("only self, explicitly selected child, assigned tutor and admin read scopes can prepare; parent dashboard cannot", async () => {
  const f = await fixture();
  for (const [mode, who] of [["student", "learner"], ["tutor", "multi"], ["admin", "admin"]] as const)
    expect((await f.prepare(mode, { who })).status).toBe("prepared");
  const selected = await f.runtime.practice.enter({ url: "http://localhost:3000/api/practice/enter", method: "POST", headers: new Headers({ origin: "http://localhost:3000", cookie: f.identities.multi.cookie }) }, { studentId: f.id });
  expect((await f.prepare("child-practice", { handle: selected.handle })).status).toBe("prepared");
  for (const [mode, options, id, status] of [
    ["parent", {}, f.id, 400], ["child-practice", {}, f.id, 404], ["student", { who: "multi" }, f.id, 403],
    ["student", { who: "learner" }, f.students[1].id, 404], ["tutor", {}, f.students[2].id, 404], ["tutor", {}, f.students[3].id, 404],
    ["student", { who: "anonymous" }, f.id, 401], ["student", { who: "learner", handle: selected.handle }, f.id, 403],
  ] as const) expect((await f.call("prepare", { mode }, options, id)).status).toBe(status);
});

test("date and explicit service slot control the proposal; unknown and nonregular sources stay unresolved", async () => {
  const f = await fixture();
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.id)));
  expect(await f.prepare()).toMatchObject({ readingDate: "2027-01-09", status: "prepared" });
  expect(f.calendar.mock.calls[0][0]).toBe("2027-01-09");
  for (const classification of ["holiday", "multiple", "nonregular", "missing"] as const) {
    const loaded = await f.calendar("2027-01-09", "diaspora"); f.calendar.mockResolvedValueOnce({ ...loaded, snapshot: { ...loaded.snapshot, classification } });
    expect(await f.prepare()).toMatchObject({ status: "unresolved", reason: classification });
  }
  f.calendar.mockRejectedValueOnce(new ReadingUnavailable("upstream")); expect(await f.prepare()).toMatchObject({ status: "unresolved", reason: "calendar-source-unavailable" });
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, f.id)));
  f.calendar.mockClear(); expect(await f.prepare()).toMatchObject({ status: "unresolved", readingDate: null, reason: "unknown-slot" }); expect(f.calendar).not.toHaveBeenCalled();
});

test("closed POST boundary refuses arbitrary ranges/tenant/edition/query and foreign Origin before public work", async () => {
  const f = await fixture();
  for (const extra of [{ ranges: ["Genesis 1:1"] }, { tenantId: "crc" }, { kind: "haftarah" }, { translation: "all" }, { offset: 0 }])
    expect((await f.call("prepare", { mode: "student", ...extra }, { who: "learner" })).status).toBe(400);
  expect((await f.call("prepare", { mode: "student" }, { who: "learner", headers: { origin: "https://foreign.example.test" } })).status).toBe(403);
  expect((await handlePortalRequest(f.request(`/api/students/${f.id}/reading/explore/prepare?mode=student`, { body: { mode: "student" }, who: "learner" }), f.runtime))?.status).toBe(400);
  expect((await handlePortalRequest(f.request(`/api/students/${f.id}/reading/explore/prepare`, { who: "learner" }), f.runtime))?.status).toBe(405);
  expect(f.calendar).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled();
});

test("dedicated binding cannot authorize assigned text, staff preview or writes; tamper, cross-mode and expired binding fail", async () => {
  const f = await fixture(), prepared = await f.prepare();
  expect(() => createBindings(f.secret, f.now).verify(prepared.binding, "student-reading")).toThrow();
  expect(() => createBindings(f.secret, f.now).verify(prepared.binding, "reading-preview")).toThrow();
  expect((await f.page(prepared.binding + "x")).status).toBe(403);
  expect((await f.call("page", { mode: "tutor", binding: prepared.binding, offset: 0 })).status).toBe(403);
  expect((await f.page(prepared.binding, 1)).status).toBe(400);
  const assigned = await handlePortalRequest(f.request(`/api/students/${f.id}/study-text?mode=student&kind=torah&binding=${encodeURIComponent(prepared.binding)}&offset=0`, { who: "learner" }), f.runtime);
  expect(assigned?.status).toBe(400); expect(f.text).not.toHaveBeenCalled();
  f.advance(6 * 60000); expect((await f.page(prepared.binding)).status).toBe(403);
});

test("student/date/slot or new assignment drift invalidates prepared exploration before loading text", async () => {
  const f = await fixture(), prepared = await f.prepare();
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.id)));
  expect((await f.page(prepared.binding)).status).toBe(409);
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.id)));
  await f.assign(); expect((await f.page(prepared.binding)).status).toBe(409); expect(f.text).not.toHaveBeenCalled();
});

test("authority revocation and new confirmed reading during public work withhold the result", async () => {
  for (const change of ["link", "assignment", "student"] as const) {
    const f = await fixture(), prepared = await f.prepare();
    f.text.mockImplementationOnce(async request => { const page = await f.reader(request);
      if (change === "link") await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
      else if (change === "assignment") await f.assign();
      else await f.owner(() => f.db.update(s.student).set({ revision: 2, ceremonyDate: "2027-01-09" }).where(eq(s.student.id, f.id)));
      return page;
    });
    expect((await f.page(prepared.binding)).status).toBe(change === "link" ? 404 : 409);
  }
});

test("binding expiry and aborted delivery after text work cannot return a successful page", async () => {
  const f = await fixture(), prepared = await f.prepare();
  f.text.mockImplementationOnce(async request => { const page = await f.reader(request); f.advance(6 * 60000); return page; });
  expect((await f.page(prepared.binding)).status).toBe(403);
  const g = await fixture(), current = await g.prepare(), abort = new AbortController();
  g.text.mockImplementationOnce(async request => { const page = await g.reader(request); abort.abort(); return page; });
  const request = g.request("/api/exploration", { body: {}, who: "learner" });
  await expect(g.runtime.readingExploration.page({ ...request, url: request.url, method: request.method, headers: request.headers, signal: abort.signal }, { mode: "student", studentId: g.id, binding: current.binding, offset: 0 })).rejects.toMatchObject({ code: "upstream" });
});

test("ceremony change during calendar work cannot sign an old-date scope", async () => {
  const f = await fixture(), loaded = await f.calendar("2027-01-02", "diaspora");
  f.calendar.mockImplementationOnce(async () => {
    await f.owner(() => f.db.update(s.student).set({ ceremonyDate: "2027-01-09", revision: 2 }).where(eq(s.student.id, f.id)));
    return loaded;
  });
  const response = await f.call("prepare", { mode: "student" }, { who: "learner" });
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ ok: false, code: "stale-revision" }); expect(f.text).not.toHaveBeenCalled();
});

test("natural session expiry during public text work wins even while the five-minute proposal remains valid", async () => {
  const f = await fixture();
  await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(f.now() + 60000) }).where(eq(s.session.id, f.identities.learner.sessionId)));
  const prepared = await f.prepare();
  f.text.mockImplementationOnce(async request => { const page = await f.reader(request); f.advance(61000); return page; });
  expect((await f.page(prepared.binding)).status).toBe(401);
});

test("actual HTTP page projection strips unexpected provider and authority fields instead of spreading them into a response", async () => {
  const f = await fixture(), prepared = await f.prepare();
  f.text.mockImplementationOnce(async request => ({ ...await f.reader(request), actor: { tenantId: "synthetic-hidden" }, binding: "synthetic-hidden-binding", source: "synthetic-hidden-source" }));
  const response = await f.page(prepared.binding), body = await response.json();
  expect(response.status).toBe(200); expect(body.verses.length).toBeGreaterThan(0);
  for (const key of ["actor", "context", "binding", "source", "sessionExpiresAt", "authSessionId", "tenantId", "assignmentId"]) expect(body).not.toHaveProperty(key);
  expect(JSON.stringify(body)).not.toContain("synthetic-hidden");
});
