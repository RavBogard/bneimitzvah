import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { PROGRESS_SCHEMA } from "../../src/lib/service-course/progress";
import { syntheticServiceCatalog } from "../helpers/service-learning";

// Release 2.0 SC5 (A4 9): the per-part finished mark. Written only as a side effect of the student's own progress sync, only for
// the student's own assigned parts; read only by the student's assigned tutors and admins through
// GET /api/students/{id}/service-finished. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "anonymous";
const T1 = "2026-10-20T10:00:00.000Z";
const doc = (...lessons: string[]) => ({ schema: PROGRESS_SCHEMA, lessons: Object.fromEntries(lessons.map(id => [id, { done: T1 }])), cards: {} });
// 2.0 SC5a: the lessons finished under the account go beside the document as `stamps`; merge and put below send every lesson of the
// document as stamped unless told (null sends none, as an older browser does).
type Doc = ReturnType<typeof doc>;
const stampsOf = (progress: Doc, stamps: readonly string[] | null | undefined) => stamps === null ? {} : { stamps: stamps ?? Object.keys(progress.lessons) };
const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function setup(options: { plan?: boolean } = { plan: true }) {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const content = syntheticServiceCatalog("finished", { standard: true }), catalogId = randomUUID(), [own, sibling, unrelated] = f.students;
  await f.owner(async () => {
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
  });
  // The plan's parts in service order: two units no lesson teaches, V'ahavta and the blessing before the Torah reading.
  const parts = [content.first, content.standard.vahavta, content.second, content.standard.torahBefore];
  const plan = (studentId: string, selectedIds = parts) => f.owner(async () => {
    await f.db.delete(s.studentServicePlan).where(eq(s.studentServicePlan.studentId, studentId));
    await f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId, catalogId, catalogIdentity: content.identity, selectedIds,
      reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: f.adminMember.id });
  });
  if (options.plan) await plan(own.id);
  const cookie = (who: Who) => who === "anonymous" ? "" : f.identities[who].cookie;
  const call = async (path: string, who: Who, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const h = new Headers(init.headers ?? {}); if (cookie(who)) h.set("cookie", cookie(who));
    if (init.body !== undefined) { h.set("origin", ORIGIN); h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: h, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
    if (response.status !== 405) expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    const text = await response.text();
    return { status: response.status, text, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const owner = async (who: Who) => (await call("/api/learn/service/progress", who)).json as { owner: string; version: number };
  const merge = async (who: Who, progress: Doc, stamps?: readonly string[] | null) => { const o = await owner(who); return call("/api/learn/service/progress/merge", who, { body: { progress, owner: o.owner, ...stampsOf(progress, stamps) } }); };
  const put = async (who: Who, progress: Doc, stamps?: readonly string[] | null) => { const o = await owner(who); return call("/api/learn/service/progress/put", who, { body: { progress, owner: o.owner, expectedVersion: o.version, ...stampsOf(progress, stamps) } }); };
  const rows = () => f.owner(async () => (await f.db.select().from(s.servicePartFinished)).map(r => ({ student: r.studentId === own.id ? "own" : r.studentId === sibling.id ? "sibling" : "else", lesson: r.lessonId, at: r.finishedAt.toISOString() }))
    .sort((a, b) => `${a.student}${a.lesson}`.localeCompare(`${b.student}${b.lesson}`)));
  const audits = () => f.owner(async () => (await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "service-part.finish"))).map(r => ({ student: r.actingStudentId, target: r.targetId, type: r.targetType, mode: r.mode, grant: r.roleGrantId })));
  const read = (who: Who, studentId: string, mode = "tutor", headers: Record<string, string> = {}) => call(`/api/students/${studentId}/service-finished?mode=${mode}`, who, { headers });
  return { f, call, merge, put, owner, rows, audits, read, plan, parts, content, catalogId, own, sibling, unrelated };
}

describe("the finished mark is written only from the student's own sync, for the student's own assigned parts", () => {
  it("marks each finished assigned part once, with one audit row in the student's name; lessons outside the parts write nothing", async () => {
    const t = await setup();
    // V'ahavta is assigned; the Sh'ma, Modeh Ani and the fluency strand are not, so they write nothing.
    expect((await t.merge("learner", doc("vahavta", "shma", "modeh-ani", "f1"))).status).toBe(200);
    const first = await t.rows();
    expect(first.map(r => `${r.student}:${r.lesson}`)).toEqual(["own:vahavta"]);
    expect(await t.audits()).toEqual([{ student: t.own.id, target: "vahavta", type: "service-part", mode: "student", grant: t.f.learnerGrant.id }]);
    // Finishing the second part marks it; the first keeps its instant; nothing is marked twice.
    expect((await t.put("learner", doc("vahavta", "shma", "modeh-ani", "f1", "torah-before"))).status).toBe(200);
    const second = await t.rows();
    expect(second.map(r => `${r.student}:${r.lesson}`)).toEqual(["own:torah-before", "own:vahavta"]);
    expect(second.find(r => r.lesson === "vahavta")!.at).toBe(first[0].at);
    expect((await t.put("learner", doc("vahavta", "shma", "modeh-ani", "f1", "torah-before"))).status).toBe(200);
    expect((await t.rows()).length).toBe(2);
    expect((await t.audits()).map(a => a.target).sort()).toEqual(["torah-before", "vahavta"]);
    // finished_at is the server's own instant, never the done instant the browser sent.
    expect(second.every(r => r.at !== T1)).toBe(true);
  });

  it("writes nothing with no plan or a cleared plan, and marks a part finished before it was assigned at the next sync after the tutor assigns it", async () => {
    const t = await setup({ plan: false });
    expect((await t.merge("learner", doc("vahavta", "torah-before"))).status).toBe(200);
    expect(await t.rows()).toEqual([]);
    await t.plan(t.own.id, []);
    expect((await t.put("learner", doc("vahavta", "torah-before"))).status).toBe(200);
    expect(await t.rows()).toEqual([]);
    await t.plan(t.own.id, [t.content.standard.torahBefore]);
    expect((await t.put("learner", doc("vahavta", "torah-before"))).status).toBe(200);
    expect((await t.rows()).map(r => `${r.student}:${r.lesson}`)).toEqual(["own:torah-before"]);
  });

  it("writes nothing for anyone who is not that student: a parent, a tutor or an admin syncing their own progress", async () => {
    const t = await setup();
    await t.plan(t.sibling.id);
    for (const who of ["multi", "admin"] as const) expect((await t.merge(who, doc("vahavta", "torah-before"))).status, who).toBe(200);
    expect(await t.rows()).toEqual([]);
    expect(await t.audits()).toEqual([]);
  });

  it("writes nothing once the student's link or grant is revoked or the student is disabled, and the progress itself is still saved", async () => {
    const t = await setup();
    await t.f.owner(() => t.f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, t.own.id)));
    expect((await t.merge("learner", doc("vahavta"))).status).toBe(200);
    expect(await t.rows()).toEqual([]);
    await t.f.owner(() => t.f.db.update(s.student).set({ disabledAt: null }).where(eq(s.student.id, t.own.id)));
    await t.f.owner(() => t.f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, t.f.learnerLink.id)));
    const saved = await t.put("learner", doc("vahavta", "torah-before"));
    expect(saved.status).toBe(200);
    expect(Object.keys(saved.json.progress.lessons).sort()).toEqual(["torah-before", "vahavta"]);
    expect(await t.rows()).toEqual([]);
  });
});

describe("count only signed-in (Daniel, 2026-10-26, 2.0 SC5a)", () => {
  it("an older browser's request, with no stamps, still syncs as progress and writes no mark", async () => {
    const t = await setup();
    const merged = await t.merge("learner", doc("vahavta"), null);
    expect(merged.status).toBe(200);
    expect(merged.json.progress.lessons).toEqual({ vahavta: { done: T1 } });
    const put = await t.put("learner", doc("vahavta", "torah-before"), null);
    expect(put.status).toBe(200);
    expect(Object.keys(put.json.progress.lessons).sort()).toEqual(["torah-before", "vahavta"]);
    expect(await t.rows()).toEqual([]);
    expect(await t.audits()).toEqual([]);
    // The same lesson, finished again under the account, marks it, and only it.
    expect((await t.put("learner", doc("vahavta", "torah-before"), ["vahavta"])).status).toBe(200);
    expect((await t.rows()).map(r => `${r.student}:${r.lesson}`)).toEqual(["own:vahavta"]);
  });

  it("a lesson finished offline under the account, sent when the device is back online, marks the part", async () => {
    const t = await setup();
    expect((await t.put("learner", doc("shma"), null)).status).toBe(200);
    expect((await t.put("learner", doc("shma", "vahavta"), ["vahavta"])).status).toBe(200);
    expect((await t.rows()).map(r => `${r.student}:${r.lesson}`)).toEqual(["own:vahavta"]);
  });

  it("keeps stamps out of the document: the answer and the stored copy are lessons as { done } only, and a stamp for a lesson not done marks nothing", async () => {
    const t = await setup();
    const answer = await t.merge("learner", doc("shma"), ["shma", "vahavta"]);
    expect(answer.status).toBe(200);
    expect(answer.json.progress).toEqual(doc("shma"));
    expect(answer.text).not.toContain("stamps");
    expect(await t.rows()).toEqual([]);
  });

  it("refuses stamps of any other shape, and stores nothing", async () => {
    const t = await setup();
    const mine = (await t.call("/api/learn/service/progress", "learner")).json.owner as string;
    for (const stamps of [["nope"], ["vahavta", "vahavta"], "vahavta", [1], null, { vahavta: true }])
      expect((await t.call("/api/learn/service/progress/merge", "learner", { body: { progress: doc("vahavta"), owner: mine, stamps } })).status, JSON.stringify(stamps)).toBe(400);
    expect((await t.call("/api/learn/service/progress", "learner")).json.version).toBe(0);
    expect(await t.rows()).toEqual([]);
  });

  it("answers a put that drops a lesson the account has done as a conflict, and changes nothing; the merge that follows keeps every lesson", async () => {
    const t = await setup();
    expect((await t.merge("learner", doc("shma", "vahavta"), null)).status).toBe(200);
    const dropped = await t.put("learner", doc("shma"));
    expect(dropped.status).toBe(409);
    expect(dropped.json).toMatchObject({ ok: false, code: "conflict", current: { version: 1, progress: doc("shma", "vahavta") } });
    expect(await t.rows()).toEqual([]);
    const merged = await t.merge("learner", doc("shma"), ["shma"]);
    expect(merged.status).toBe(200);
    expect(Object.keys(merged.json.progress.lessons).sort()).toEqual(["shma", "vahavta"]);
  });
});

describe("the finished mark is read only by the student's assigned tutors and admins", () => {
  it("shows a tutor with a live tutor_student row and an admin each part on the plan, in service order, finished with its day or not yet", async () => {
    const t = await setup();
    await t.merge("learner", doc("vahavta", "shma"));
    const expected = { parts: [{ lesson: "vahavta", finished: chicagoToday() }, { lesson: "torah-before", finished: null }] };
    for (const [who, mode] of [["multi", "tutor"], ["admin", "admin"]] as const) {
      const answer = await t.read(who, t.own.id, mode);
      expect(answer.status, who).toBe(200);
      expect(answer.json, who).toEqual(expected);
      // Lesson ids and days only: never the feed's unit ids, a unit's name or a time of day.
      for (const absent of ["bm-shacharit", "Synthetic", "T10:", "\"at\"", "shma\""]) expect(answer.text, absent).not.toContain(absent);
    }
  });

  it("refuses a tutor without a live tutor_student row, a revoked one, a parent, a student, a practice context and anyone signed out", async () => {
    const t = await setup();
    await t.plan(t.sibling.id);
    await t.f.owner(() => t.f.db.insert(s.servicePartFinished).values([{ tenantId: "crc", studentId: t.sibling.id, lessonId: "vahavta" }, { tenantId: "crc", studentId: t.own.id, lessonId: "vahavta" }]));
    // multi is Sibling B's parent but not her tutor: no tutor_student row, so nothing.
    expect((await t.read("multi", t.sibling.id, "tutor")).status).toBe(404);
    expect((await t.read("multi", t.unrelated.id, "tutor")).status).toBe(404);
    // A parent in parent view, a student, child practice, a missing or unknown mode, and an extra query are refused at the boundary.
    for (const mode of ["parent", "student", "child-practice", "", "rabbi"]) expect((await t.read("multi", t.own.id, mode)).status, mode).toBe(400);
    expect((await t.call(`/api/students/${t.own.id}/service-finished`, "multi")).status).toBe(400);
    expect((await t.call(`/api/students/${t.own.id}/service-finished?mode=tutor&studentId=${t.sibling.id}`, "multi")).status).toBe(400);
    expect((await t.read("multi", t.own.id, "tutor", { "X-Practice-Context": "A".repeat(43) })).status).toBe(400);
    expect((await t.read("learner", t.own.id, "tutor")).status).toBe(403);
    expect((await t.read("learner", t.own.id, "admin")).status).toBe(403);
    expect((await t.read("anonymous", t.own.id, "tutor")).status).toBe(401);
    expect((await t.read("recipient", t.own.id, "tutor")).status).toBe(403);
    expect((await t.call(`/api/students/not-a-student/service-finished?mode=admin`, "admin")).status).toBe(400);
    expect((await t.call(`/api/students/${t.own.id}/service-finished?mode=tutor`, "multi", { method: "POST", body: {} })).status).toBe(405);
    // A student of another congregation is not found, not shown.
    expect((await t.read("admin", t.f.students[3].id, "admin")).status).toBe(404);
    // The positive control, then the revocation: the same tutor reads nothing the moment the row is revoked.
    expect((await t.read("multi", t.own.id, "tutor")).json.parts[0]).toEqual({ lesson: "vahavta", finished: chicagoToday() });
    await t.f.owner(() => t.f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(and(eq(s.tutorStudent.id, t.f.tutorLink.id))));
    expect((await t.read("multi", t.own.id, "tutor")).status).toBe(404);
    // An admin reads one student at a time: Sibling B's answer carries Sibling B's mark and nothing of the other student's.
    const siblingAnswer = await t.read("admin", t.sibling.id, "admin");
    expect(siblingAnswer.json).toEqual({ parts: [{ lesson: "vahavta", finished: chicagoToday() }, { lesson: "torah-before", finished: null }] });
    expect(siblingAnswer.text).not.toContain(t.own.id);
  });

  it("shows no parts with no plan or a cleared plan, and only the parts still on the plan after it changes", async () => {
    const t = await setup({ plan: false });
    expect((await t.read("admin", t.own.id, "admin")).json).toEqual({ parts: [] });
    await t.plan(t.own.id);
    await t.merge("learner", doc("vahavta", "torah-before"));
    await t.plan(t.own.id, [t.content.standard.torahBefore]);
    expect((await t.read("admin", t.own.id, "admin")).json).toEqual({ parts: [{ lesson: "torah-before", finished: chicagoToday() }] });
    await t.plan(t.own.id, []);
    expect((await t.read("admin", t.own.id, "admin")).json).toEqual({ parts: [] });
    // The marks themselves stay: a part, once finished, stays finished.
    expect((await t.rows()).length).toBe(2);
  });
});
