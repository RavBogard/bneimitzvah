import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createServiceCoursePath } from "../../src/server/service-course/path";
import { PROGRESS_SCHEMA, completeLesson, emptyProgress, serializeProgress } from "../../src/lib/service-course/progress";
import { lessonById } from "../../src/lib/service-course/course";
import { parsePath } from "../../src/lib/service-course/path";
import { syntheticServiceCatalog } from "../helpers/service-learning";

// Release 2.0 SC4: a member's own service-course progress through /api/learn/service/progress*, and a student's own path through
// /api/learn/service/path. Synthetic people only, on Learn to lein's route test (course-progress.test.ts).
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "disabled" | "revoked" | "member" | "ended" | "anonymous";
const doc = (lessons: Record<string, string> = {}, cards: Record<string, [number, string]> = {}) => ({ schema: PROGRESS_SCHEMA,
  lessons: Object.fromEntries(Object.entries(lessons).map(([id, done]) => [id, { done }])), cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) });
const T1 = "2026-10-20T10:00:00.000Z", T2 = "2026-10-21T10:00:00.000Z";

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const extra = await f.owner(async () => {
    const people: Record<string, { cookie: string }> = {};
    for (const [key, email] of [["disabled", "service-disabled@example.test"], ["revoked", "service-revoked@example.test"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic course identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id, disabledAt: key === "disabled" ? new Date() : null }).returning();
      await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student", revokedAt: key === "revoked" ? new Date() : null });
      people[key] = { cookie };
    }
    for (const [key, email] of [["member", "service-member@example.test"], ["ended", "service-ended@example.test"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic course identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id }).returning();
      await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: member.id, userId: proof.user.id, displayName: "Synthetic member",
        approvedByMembershipId: f.adminMember.id, ...(key === "ended" ? { revokedAt: new Date(), revokedByMembershipId: f.adminMember.id } : {}) });
      people[key] = { cookie };
    }
    return people;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookie = (who: Who) => who === "anonymous" ? "" : who in extra ? extra[who].cookie : f.identities[who as "admin"].cookie;
  // Every write names the account it is for (2.0 SC4 review): the caller's own, read first, unless the test names one itself.
  const owners = new Map<Who, string | null>();
  const ownerOf = async (who: Who) => {
    if (!owners.has(who)) {
      const h = new Headers(); if (cookie(who)) h.set("cookie", cookie(who));
      const value = await (await dispatch(new Request(`${ORIGIN}/api/learn/service/progress`, { headers: h }))).json() as { owner?: unknown };
      owners.set(who, typeof value.owner === "string" ? value.owner : null);
    }
    return owners.get(who)!;
  };
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}, raw?: string) => {
    if (path.startsWith("/api/learn/service/progress/") && body && typeof body === "object" && !Array.isArray(body) && !("owner" in body)) {
      const owner = await ownerOf(who); if (owner) body = { ...body, owner };
    }
    const h = new Headers(headers), c = cookie(who);
    if (c && !h.has("cookie")) h.set("cookie", c);
    if (body !== undefined || raw !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); if (!h.has("content-type")) h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: body === undefined && raw === undefined ? "GET" : "POST", headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control"), path).toBeNull();
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { f, call, ownerOf };
}

describe("signed-in service-course progress", () => {
  it("is 401 signed out and 403 without a membership, with a disabled membership or with every grant revoked; any live grant keeps it, students included", async () => {
    const t = await setup();
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["disabled", 403], ["revoked", 403], ["ended", 403], ["member", 200], ["learner", 200], ["multi", 200], ["admin", 200]] as const)
      expect((await t.call("/api/learn/service/progress", who)).status, who).toBe(status);
  });

  it("copies a browser's progress on first sign-in, then merges: lessons the union with the earliest done, cards the higher box with its due", async () => {
    const t = await setup();
    const empty = await t.call("/api/learn/service/progress", "learner");
    expect(empty.json).toMatchObject({ ok: true, progress: null, version: 0 });
    expect(empty.json.owner).toMatch(/^[a-f0-9]{32}$/);
    const browser = doc({ shma: T2 }, { "word:shma:read": [3, "2026-10-30"] });
    const first = await t.call("/api/learn/service/progress/merge", "learner", { progress: browser });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, version: 1, progress: browser, owner: empty.json.owner });
    const other = doc({ shma: T1, vahavta: T2 }, { "word:shma:read": [1, "2026-10-22"], "word:shma:meaning": [2, "2026-10-25"] });
    const second = await t.call("/api/learn/service/progress/merge", "learner", { progress: other });
    expect(second.json).toMatchObject({ ok: true, version: 2 });
    expect(second.json.progress).toEqual(doc({ shma: T1, vahavta: T2 }, { "word:shma:meaning": [2, "2026-10-25"], "word:shma:read": [3, "2026-10-30"] }));
    expect((await t.call("/api/learn/service/progress", "learner")).json).toMatchObject({ version: 2, progress: second.json.progress });
  });

  it("keeps SC3's Reading Hebrew lessons and every review card a lesson plants, under the same rules", async () => {
    const t = await setup();
    const planted = [lessonById("f1")!, lessonById("f3")!, lessonById("shma")!].reduce((value, lesson) => completeLesson(value, lesson, Date.parse(T1)), emptyProgress());
    expect(Object.keys(planted.cards).length).toBeGreaterThan(2);
    const saved = await t.call("/api/learn/service/progress/merge", "learner", { progress: planted });
    expect(saved.status).toBe(200);
    expect(saved.json.progress).toEqual(JSON.parse(serializeProgress(planted)!));
  });

  it("refuses a write named for another account, on put and on merge, naming only the signed-in account and changing nothing", async () => {
    const t = await setup();
    await t.call("/api/learn/service/progress/merge", "learner", { progress: doc({ shma: T1 }) });
    const learner = await t.ownerOf("learner"), multi = await t.ownerOf("multi");
    expect(learner).not.toBe(multi);
    // A tab still holding the learner's progress writes after another account signed in on the same device.
    for (const [path, body] of [["/api/learn/service/progress/put", { progress: doc({ vahavta: T2 }), expectedVersion: 0, owner: learner }],
      ["/api/learn/service/progress/merge", { progress: doc({ vahavta: T2 }), owner: learner }]] as const) {
      const refused = await t.call(path, "multi", body);
      expect(refused.status, path).toBe(403);
      expect(refused.json, path).toEqual({ error: "forbidden", owner: multi });
    }
    expect((await t.call("/api/learn/service/progress", "multi")).json).toMatchObject({ progress: null, version: 0 });
    expect((await t.call("/api/learn/service/progress", "learner")).json).toMatchObject({ version: 1, progress: doc({ shma: T1 }) });
    // A missing or malformed owner is a plain 400.
    for (const owner of [undefined, "", "x".repeat(32), learner!.toUpperCase()]) {
      const body = owner === undefined ? { progress: doc() } : { progress: doc(), owner };
      expect((await t.call("/api/learn/service/progress/merge", "multi", undefined, {}, JSON.stringify(body))).status, String(owner)).toBe(400);
    }
  });

  it("refuses with 409 a merge whose result one document cannot hold, and stores nothing new", async () => {
    const t = await setup();
    const cards = (word: string) => Object.fromEntries(Array.from({ length: 125 }, (_, i) => [[`word:${word}${i}:read`, [2, "2026-11-01"] as [number, string]], [`word:${word}${i}:meaning`, [2, "2026-11-01"] as [number, string]]]).flat());
    const first = doc({ shma: T1 }, cards("a")), second = doc({ vahavta: T2 }, cards("b"));
    expect(Object.keys(first.cards)).toHaveLength(250);
    expect((await t.call("/api/learn/service/progress/merge", "learner", { progress: first })).json).toMatchObject({ ok: true, version: 1 });
    const merged = await t.call("/api/learn/service/progress/merge", "learner", { progress: second });
    expect(merged.status).toBe(409);
    expect(merged.json).toMatchObject({ ok: false, code: "too-large", current: { version: 1 } });
    const after = await t.call("/api/learn/service/progress", "learner");
    expect(after.status).toBe(200);
    expect(after.json).toMatchObject({ version: 1 });
    expect(Object.keys(after.json.progress.cards)).toHaveLength(250);
  });

  it("replaces the document under its version and answers a stale version with the current one", async () => {
    const t = await setup();
    const one = doc({ shma: T1 });
    expect((await t.call("/api/learn/service/progress/put", "multi", { progress: one, expectedVersion: 0 })).json).toMatchObject({ ok: true, version: 1, progress: one });
    const stale = await t.call("/api/learn/service/progress/put", "multi", { progress: doc(), expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ ok: false, code: "conflict", current: { version: 1, progress: one } });
    const lower = doc({ shma: T1 }, { "word:shma:read": [0, "2026-10-20"] });
    expect((await t.call("/api/learn/service/progress/put", "multi", { progress: lower, expectedVersion: 1 })).json).toMatchObject({ ok: true, version: 2, progress: lower });
  });

  it("keeps each member's document to that member: nobody else, staff included, ever sees it", async () => {
    const t = await setup();
    await t.call("/api/learn/service/progress/merge", "learner", { progress: doc({ shma: T1 }) });
    const learnerOwner = (await t.call("/api/learn/service/progress", "learner")).json.owner;
    for (const who of ["admin", "multi", "member"] as const) {
      const seen = await t.call("/api/learn/service/progress", who);
      expect(seen.json).toMatchObject({ ok: true, progress: null, version: 0 });
      expect(seen.json.owner).not.toBe(learnerOwner);
    }
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.serviceCourseProgressTable).where(eq(s.serviceCourseProgressTable.membershipId, t.f.learnerMember.id))).length)).toBe(1);
  });

  it("is a document apart from Learn to lein's: neither course's writes reach the other, and the owner names differ", async () => {
    const t = await setup();
    await t.call("/api/learn/progress/merge", "learner", { progress: { schema: "learn-progress/v1", lessons: { "intro-phrases": { done: T1 } }, cards: {} } });
    expect((await t.call("/api/learn/service/progress", "learner")).json).toMatchObject({ progress: null, version: 0 });
    await t.call("/api/learn/service/progress/merge", "learner", { progress: doc({ shma: T2 }) });
    const learn = await t.call("/api/learn/progress", "learner");
    expect(Object.keys(learn.json.progress.lessons)).toEqual(["intro-phrases"]);
    expect(learn.json.owner).not.toBe((await t.call("/api/learn/service/progress", "learner")).json.owner);
    // Each route refuses the other course's document.
    expect((await t.call("/api/learn/service/progress/merge", "learner", { progress: { schema: "learn-progress/v1", lessons: {}, cards: {} } })).status).toBe(400);
    expect((await t.call("/api/learn/progress/merge", "learner", { progress: doc() })).status).toBe(400);
  });

  it("lets an approved Member with no role keep only their own progress, and refuses an ended membership naming only its own owner", async () => {
    const t = await setup();
    const mine = doc({ vahavta: T2 });
    expect((await t.call("/api/learn/service/progress/put", "member", { progress: mine, expectedVersion: 0 })).json).toMatchObject({ ok: true, version: 1, progress: mine, until: null });
    const ended = await t.call("/api/learn/service/progress/put", "ended", { progress: mine, expectedVersion: 0 });
    expect(ended.status).toBe(403);
    expect(Object.keys(ended.json).sort()).toEqual(["error", "owner"]);
    expect(ended.json.owner).toMatch(/^[a-f0-9]{32}$/);
    expect((await t.call("/api/learn/service/progress", "ended")).json.owner).toBe(ended.json.owner);
    for (const who of ["recipient", "disabled", "anonymous"] as const) expect(Object.keys((await t.call("/api/learn/service/progress", who)).json), who).toEqual(["error"]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.serviceCourseProgressTable)).length)).toBe(1);
  });

  it("gives a signed-in student their own ceremony date, and nobody else a date", async () => {
    const t = await setup();
    expect((await t.call("/api/learn/service/progress", "learner")).json.until).toBe("2027-01-02");
    for (const who of ["admin", "multi"] as const) expect((await t.call("/api/learn/service/progress", who)).json.until, who).toBeNull();
  });

  it("refuses bad documents, extra keys, a missing or foreign Origin, queries, a practice context and other methods, echoing nothing", async () => {
    const t = await setup();
    const bad = [{ progress: { ...doc(), extra: 1 } }, { progress: doc({ shma: "not-a-time" }) }, { progress: doc({}, { "word:shma:read": [9, "2026-10-20"] }) },
      { progress: doc(), more: true }, { progress: "x" }, {}];
    for (const body of bad) {
      const result = await t.call("/api/learn/service/progress/merge", "learner", body);
      expect(result.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(result.text).not.toContain("not-a-time");
    }
    for (const body of [{ progress: doc(), expectedVersion: -1 }, { progress: doc(), expectedVersion: 1.5 }, { progress: doc() }])
      expect((await t.call("/api/learn/service/progress/put", "learner", body)).status).toBe(400);
    expect((await t.call("/api/learn/service/progress/merge", "learner", { progress: doc() }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await t.call("/api/learn/service/progress/merge", "learner", undefined, {}, "{")).status).toBe(400);
    expect((await t.call("/api/learn/service/progress?x=1", "learner")).status).toBe(400);
    expect((await t.call("/api/learn/service/progress/merge", "learner", { progress: doc() }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await t.call("/api/learn/service/progress/merge", "learner", undefined, {}, JSON.stringify({ progress: { ...doc(), pad: "x".repeat(80 * 1024) } }))).status).toBeGreaterThanOrEqual(400);
    expect((await t.call("/api/learn/service/progress", "multi", undefined, { "x-practice-context": "00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect((await t.call("/api/learn/service/progress/put", "learner")).status).toBe(405);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.serviceCourseProgressTable)).length)).toBe(0);
    // A lesson the course no longer knows is dropped, not refused, so an old browser's document still syncs.
    const kept = await t.call("/api/learn/service/progress/merge", "learner", { progress: doc({ "no-such-lesson": T1, shma: T1 }) });
    expect(kept.status).toBe(200);
    expect(Object.keys(kept.json.progress.lessons)).toEqual(["shma"]);
  });
});

describe("a student's own path", () => {
  async function withCatalog(options: { slot?: "morning" | "havdalah" | "unknown" } = {}) {
    const t = await setup();
    const content = syntheticServiceCatalog("path", { standard: true }), catalogId = randomUUID(), studentId = t.f.students[0].id;
    await t.f.owner(async () => {
      await t.f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
      await t.f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
      if (options.slot) await t.f.db.update(s.student).set({ serviceSlot: options.slot }).where(eq(s.student.id, studentId));
    });
    const plan = async (selectedIds: string[], extra: Partial<typeof s.studentServicePlan.$inferInsert> = {}) => t.f.owner(async () => {
      await t.f.db.delete(s.studentServicePlan).where(eq(s.studentServicePlan.studentId, studentId));
      const [row] = await t.f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId, catalogId, catalogIdentity: content.identity, selectedIds,
        reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: t.f.adminMember.id, ...extra }).returning();
      return row;
    });
    return { ...t, content, catalogId, studentId, plan };
  }

  it("with no plan, is the six default parts with the morning's pages; signed out 401, an account with no student of its own 403", async () => {
    const t = await withCatalog();
    const answer = await t.call("/api/learn/service/path", "learner");
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ ok: true, state: "no-plan", slot: "morning", review: false, items: [
      { lesson: "shma", page: 10 }, { lesson: "vahavta", page: 11 }, { lesson: "torah-before", page: 22 }, { lesson: "torah-after", page: 22 }, { lesson: "haftarah-before", page: 23 }, { lesson: "haftarah-after", page: 24 }] });
    expect(parsePath(answer.json)).not.toBeNull();
    expect((await t.call("/api/learn/service/path", "anonymous")).status).toBe(401);
    // Staff, a parent, a Member, and a student grant in another congregation (multi's) have no path here.
    for (const who of ["admin", "multi", "member", "recipient", "revoked", "disabled", "ended"] as const) {
      const refused = await t.call("/api/learn/service/path", who);
      expect(refused.status, who).toBe(403);
      expect(Object.keys(refused.json), who).toEqual(["error"]);
    }
  });

  it("with a plan, is the student's assigned parts in service order with their own pages, and never a unit's name or caption", async () => {
    const t = await withCatalog();
    const saved = await t.plan([t.content.first, t.content.standard.vahavta, t.content.second, t.content.standard.torahBefore]);
    const answer = await t.call("/api/learn/service/path", "learner");
    expect(answer.status).toBe(200);
    // The synthetic catalog prints its units from page 1 in feed order: V'ahavta is its second unit and the Torah blessing its fifth.
    expect(answer.json).toEqual({ ok: true, state: "assigned", slot: "morning", review: false, items: [{ lesson: "vahavta", page: 2 }, { lesson: "torah-before", page: 5 }],
      serviceStart: 1, plan: { id: saved.id, revision: 1, catalogId: t.catalogId, catalogIdentity: t.content.identity } });
    for (const field of ["Synthetic part", "Synthetic caption", "Synthetic translation", "Synthetic morning", t.content.first, t.content.standard.vahavta, "bm-shacharit", "\"name\"", "\"caption\"", "\"section\"", "\"he\"", "\"en\""])
      expect(answer.text).not.toContain(field);
    expect(parsePath(answer.json)).toMatchObject({ state: "assigned", items: [{ lesson: "vahavta" }, { lesson: "torah-before" }] });
  });

  it("says when parts may change, are cleared or are withdrawn, and when the service time is not set", async () => {
    const t = await withCatalog();
    await t.plan([t.content.standard.vahavta], { needsReview: true });
    expect((await t.call("/api/learn/service/path", "learner")).json).toMatchObject({ state: "assigned", review: true, items: [{ lesson: "vahavta", page: 2 }] });
    const cleared = await t.plan([]);
    expect((await t.call("/api/learn/service/path", "learner")).json).toEqual({ ok: true, state: "cleared", slot: "morning", review: false, items: [],
      plan: { id: cleared.id, revision: 1, catalogId: t.catalogId, catalogIdentity: t.content.identity } });
    await t.plan([t.content.standard.vahavta]);
    await t.f.owner(() => t.f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }).where(eq(s.serviceCatalogLifecycle.catalogId, t.catalogId)));
    expect((await t.call("/api/learn/service/path", "learner")).json).toMatchObject({ state: "withdrawn", items: [] });
    // A slot that is not set: the default parts with the morning's pages, and the home says so.
    const unknown = await withCatalog({ slot: "unknown" });
    const unset = (await unknown.call("/api/learn/service/path", "learner")).json;
    expect(unset).toMatchObject({ state: "no-plan", slot: "unknown" });
    expect(unset.items.slice(0, 2)).toEqual([{ lesson: "shma", page: 10 }, { lesson: "vahavta", page: 11 }]);
    // An evening student with no plan: no morning page is passed off as theirs.
    const evening = await withCatalog({ slot: "havdalah" });
    const answer = (await evening.call("/api/learn/service/path", "learner")).json;
    expect(answer).toMatchObject({ state: "no-plan", slot: "havdalah" });
    expect(answer.items).toEqual(["shma", "vahavta", "torah-before", "torah-after", "haftarah-before", "haftarah-after"].map(lesson => ({ lesson })));
  });

  it("reads only the signed-in student's own plan: another student's plan never reaches them, and staff cannot read a student's path", async () => {
    const t = await withCatalog();
    // A plan for a different student of the same congregation, with parts the learner does not have.
    await t.f.owner(async () => {
      await t.f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: t.f.students[1].id, catalogId: t.catalogId, catalogIdentity: t.content.identity,
        selectedIds: [t.content.standard.torahBefore], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: t.f.adminMember.id });
    });
    expect((await t.call("/api/learn/service/path", "learner")).json).toMatchObject({ state: "no-plan" });
    // The route takes no query: no student id, mode or tenant can be named.
    for (const query of [`?studentId=${t.f.students[1].id}`, "?mode=admin", "?tenant=other"]) expect((await t.call(`/api/learn/service/path${query}`, "learner")).status, query).toBe(400);
    expect((await t.call("/api/learn/service/path", "admin")).status).toBe(403);
    expect((await t.call("/api/learn/service/path", "learner", undefined, { "x-practice-context": "00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect((await t.call("/api/learn/service/path", "learner", {})).status).toBe(405);
    // A revoked student link ends the path at once.
    await t.f.owner(() => t.f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.roleGrantId, t.f.learnerGrant.id)));
    expect((await t.call("/api/learn/service/path", "learner")).status).toBe(403);
  });

  it("reads the plan again once when it moved during the read, and otherwise fails plainly", async () => {
    const t = await withCatalog();
    const real = createServiceLearningService({ access: t.f.service, practice: t.f.runtime.practice, signingSecret: "synthetic-service-course-path-secret" });
    let stale = 1;
    const flaky = { metadata: async (...args: Parameters<typeof real.metadata>) => stale-- > 0 ? { state: "stale" as const } : real.metadata(...args) };
    const path = createServiceCoursePath({ access: t.f.service, serviceLearning: flaky });
    const dispatch = createHttpDispatcher(async action => action({ ...t.f.runtime, serviceCoursePath: path }));
    const ask = () => dispatch(new Request(`${ORIGIN}/api/learn/service/path`, { headers: { cookie: t.f.identities.learner.cookie } }));
    expect((await ask()).status).toBe(200);
    stale = 2;
    const failed = await ask();
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("stale");
  });
});
