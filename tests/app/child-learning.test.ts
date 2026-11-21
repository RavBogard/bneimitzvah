import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { PERSONAL_STUDY_HEADER, PRACTICE_STUDENT_HEADER } from "../../src/lib/learn/child-practice";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { syntheticServiceCatalog } from "../helpers/service-learning";

const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
const done = "2026-11-20T12:00:00.000Z";
const progress = (kind: "learn" | "service", lesson: string) => ({
  schema: kind === "learn" ? "learn-progress/v1" : "service-course-progress/v1", lessons: { [lesson]: { done } }, cards: {},
});
const review = (id: string) => ({ schema: "learn-verses/v1", cards: { [id]: { box: 0, due: "2026-11-20" } } });
const learn = "/api/learn/progress", service = "/api/learn/service/progress", verses = "/api/learn/verses";

async function fixture() {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async run => run(f.runtime));
  async function call(path: string, init?: Parameters<typeof f.request>[1]) {
    const response = await dispatch(f.request(path, init));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    return { status: response.status, json: await response.json() };
  }
  const enter = async (studentId: string, handle?: string) => {
    const result = await call(handle ? "/api/practice/switch" : "/api/practice/enter", { handle, body: { studentId } });
    expect(result.status).toBe(201);
    return { handle: result.json.handle as string, headers: { [PRACTICE_STUDENT_HEADER]: studentId } };
  };
  const [a, b, unrelated] = f.students;
  await f.owner(async () => {
    for (const [student, kind, ref] of [[a, "torah", "Genesis 1:1"], [b, "haftarah", "Isaiah 1:1"]] as const) {
      const [reading] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: student.id, kind, ref, basis: "custom",
        status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
      await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", assignmentId: reading.id, studentId: student.id, verseRef: ref, ordinal: 1 });
    }
  });
  return { f, call, enter, a, b, unrelated };
}

it("binds both courses, assigned verses and review writes to the selected sibling across two tabs", async () => {
  const { f, call, enter, a, b, unrelated } = await fixture();
  const tabA = await enter(a.id), tabB = await enter(b.id);
  for (const [target, tab, kind, ref, lesson] of [[a, tabA, "torah", "Genesis 1:1", "intro-phrases"],
    [b, tabB, "haftarah", "Isaiah 1:1", "torah-etnachta"]] as const) {
    const reading = await call(`/api/students/${target.id}/reading?mode=child-practice`, tab);
    expect(reading.json.readings).toEqual([expect.objectContaining({ kind, verses: [ref] })]);
    const get = await call(learn, tab), serviceGet = await call(service, tab), verseGet = await call(verses, tab);
    expect([get.status, serviceGet.status, verseGet.status]).toEqual([200, 200, 200]);
    expect((await call("/api/learn/service/path", tab)).json.state).toBe("no-plan");
    expect((await call(learn + "/put", { ...tab, body: { progress: progress("learn", lesson), owner: get.json.owner, expectedVersion: 0 } })).status).toBe(200);
    expect((await call(service + "/put", { ...tab, body: { progress: progress("service", "shma"), owner: serviceGet.json.owner, expectedVersion: 0 } })).status).toBe(200);
    expect((await call(verses + "/put", { ...tab, body: { review: review(`${kind}|${ref}`), expectedOwner: verseGet.json.owner, expectedVersion: 0 } })).status).toBe(200);
  }
  const aCourse = await call(learn, tabA), aReview = await call(verses, tabA);
  expect((await call(learn, { who: "learner" })).json).toEqual(aCourse.json);
  expect((await call(verses, { who: "learner" })).json).toEqual(aReview.json);
  expect((await call(learn, tabB)).json.owner).not.toBe(aCourse.json.owner);
  expect((await call(verses, tabB)).json.review).toEqual(review("haftarah|Isaiah 1:1"));
  expect((await call(learn, { ...tabA, headers: { [PRACTICE_STUDENT_HEADER]: unrelated.id } })).status).toBe(404);
  expect([403, 404]).toContain((await call(learn, { ...tabA, who: "admin" })).status);
  expect((await call(learn)).json.progress).toBeNull();
  expect((await call(verses)).status).toBe(403);

  const switched = await enter(b.id, tabA.handle);
  const late = { progress: progress("learn", "intro-phrases"), owner: aCourse.json.owner, expectedVersion: aCourse.json.version };
  expect((await call(learn + "/put", { ...tabA, body: late })).status).toBe(404);
  expect((await call(learn + "/put", { ...switched, body: late })).status).toBe(403);
  expect((await call(learn, tabB)).json.progress).toEqual(progress("learn", "torah-etnachta"));
  expect((await call(verses, await enter(a.id))).json).toEqual(aReview.json);

  await f.owner(() => f.db.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.id, f.guardians[1].id)));
  for (const path of [learn, service, verses, "/api/learn/service/path"]) expect((await call(path, switched)).status).toBe(404);
  const expiring = await enter(a.id);
  vi.setSystemTime(Date.now() + 61 * 60_000);
  expect((await call(learn + "/put", { ...expiring, body: late })).status).toBe(404);
  expect((await call(verses, expiring)).status).toBe(404);
  const renewed = await enter(a.id);
  expect((await call(verses, renewed)).json).toEqual(aReview.json);
});

it("uses the linked child's separate history while preserving a newly linked account's personal history for direct access", async () => {
  const { f, call, enter, b } = await fixture();
  await f.owner(() => f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }));
  const privateWork = progress("learn", "intro-phrases"), childWork = progress("learn", "torah-etnachta");
  const self = { who: "recipient" as const }, personal = { ...self, headers: { [PERSONAL_STUDY_HEADER]: "1" } };
  const own = (await call(learn, self)).json, tab = await enter(b.id), child = (await call(learn, tab)).json;
  expect((await call(learn + "/put", { ...self, body: { progress: privateWork, expectedVersion: own.version, owner: own.owner } })).status).toBe(200);
  expect((await call(learn + "/put", { ...tab, body: { progress: childWork, expectedVersion: child.version, owner: child.owner } })).status).toBe(200);
  await f.owner(async () => {
    const [membership] = await f.db.select().from(s.membership).where(eq(s.membership.userId, f.identities.recipient.id));
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: membership.id, role: "student" }).returning();
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: b.id, roleGrantId: grant.id });
  });
  expect((await call(learn, self)).json.progress).toEqual(childWork);
  expect((await call(learn, personal)).json.progress).toEqual(privateWork);
  expect((await call(learn, { ...tab, headers: { ...tab.headers, [PERSONAL_STUDY_HEADER]: "1" } })).status).toBe(403);
  expect((await call(learn, tab)).json.progress).toEqual(childWork);
});

it("keeps existing membership rows live through rollout and writes a delegated service completion to the selected student", async () => {
  const { f, call, enter, a, b } = await fixture();
  const content = syntheticServiceCatalog("child-learning", { standard: true }), catalogId = randomUUID();
  const legacyWork = progress("learn", "intro-phrases");
  await f.owner(async () => {
    const { id: membershipId, userId } = f.learnerMember;
    await f.db.insert(s.studentLearningLegacy).values({ tenantId: "crc", studentId: a.id, membershipId, userId });
    // Simulate an old app node persisting progress after the additive migration.
    await f.db.insert(s.courseProgressTable).values({ tenantId: "crc", membershipId, userId, progress: legacyWork, version: 7 });
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity,
      feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    await f.db.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: b.id, catalogId, catalogIdentity: content.identity,
      selectedIds: [content.standard.vahavta], reviewedDate: b.ceremonyDate, reviewedSlot: "morning", setByMembershipId: f.adminMember.id });
  });
  const first = await enter(a.id);
  const get = await call(learn, first);
  expect(get.json).toMatchObject({ progress: legacyWork, version: 7 });
  expect(get.json).toEqual((await call(learn, { who: "learner" })).json);
  await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
  expect((await call(learn, { who: "learner" })).status).toBe(403);
  expect((await call(learn, first)).json).toEqual(get.json);

  const second = await enter(b.id);
  expect((await call("/api/learn/service/path", second)).json.items).toEqual([expect.objectContaining({ lesson: "vahavta" })]);
  const started = (await call(service, second)).json;
  expect((await call(service + "/put", { ...second, body: { progress: progress("service", "vahavta"), owner: started.owner,
    expectedVersion: started.version, stamps: ["vahavta"] } })).status).toBe(200);
  const finished = await call(`/api/students/${b.id}/service-finished?mode=admin`, { who: "admin" });
  expect(finished.json.parts).toEqual([{ lesson: "vahavta", finished: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
  expect((await call(`/api/students/${b.id}/service-finished?mode=parent`)).status).toBe(400);
});
