import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createProgressService } from "../../src/server/progress/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentService } from "../../src/server/students/service";
import { expandReadingRanges, parseCeremonyDate } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(range = "Genesis 1:1-3") {
  const f = await accessFixture(); fixtures.push(f);
  const refs = expandReadingRanges([range], "torah", TANAKH_VERSE_COUNTS);
  const assignment = await f.owner(async () => {
    await f.db.update(s.student).set({ serviceSlot: "morning" });
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id,
      kind: "torah", basis: "custom", ref: range, status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(refs.map((verseRef, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: i + 1, verseRef })));
    return row;
  });
  const practice = createPracticeService({ access: f.service }), progress = createProgressService({ access: f.service, practice });
  const selection = { mode: "student" as const, studentId: f.students[0].id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 };
  const request = (who: "admin" | "multi" | "learner" = "learner", handle?: string) => ({ ...f.request(who, "http://localhost:3000", { origin: "http://localhost:3000", ...(handle ? { "X-Practice-Context": handle } : {}) }), method: "POST" });
  return { ...f, refs, assignment, practice, progress, selection, mutation: request };
}
const self = (state: "unmarked" | "working" | "got-it", expectedVersion = 0, verseRef = "Genesis 1:1") => ({ state, expectedVersion, verseRef });
const assessment = (state: "not-started" | "working" | "solid", expectedVersion = 0, verseRef = "Genesis 1:1") => ({ state, expectedVersion, verseRef });

test("clear-to-default retains both stream versions, rejects ABA and requires current CAS even for same-state no-op", async () => {
  const f = await fixture(), staff = { ...f.selection, mode: "tutor" as const }, auditBefore = await f.owner(() => f.db.select().from(s.auditEvent));
  await f.progress.page(f.mutation(), f.selection);
  expect(await f.owner(() => f.db.select().from(s.verseSelfCheck))).toHaveLength(0);
  expect(await f.owner(() => f.db.select().from(s.verseAssessment))).toHaveLength(0);
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("unmarked"))).toMatchObject({ ok: true, state: "unmarked", version: 0 });
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("got-it"))).toMatchObject({ ok: true, version: 1 });
  expect(await f.progress.setAssessment(f.mutation("multi"), staff, assessment("solid"))).toMatchObject({ ok: true, version: 1 });
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("unmarked", 1))).toMatchObject({ ok: true, state: "unmarked", version: 2 });
  expect(await f.progress.setAssessment(f.mutation("multi"), staff, assessment("not-started", 1))).toMatchObject({ ok: true, state: "not-started", version: 2 });
  for (const expectedVersion of [0, 1]) {
    expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("unmarked", expectedVersion))).toEqual({ ok: false, code: "conflict" });
    expect(await f.progress.setAssessment(f.mutation("multi"), staff, assessment("not-started", expectedVersion))).toEqual({ ok: false, code: "conflict" });
  }
  const auditAfterChanges = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(auditAfterChanges.length - auditBefore.length).toBe(4);
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("unmarked", 2))).toMatchObject({ ok: true, version: 2 });
  expect(await f.progress.setAssessment(f.mutation("multi"), staff, assessment("not-started", 2))).toMatchObject({ ok: true, version: 2 });
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(auditAfterChanges);
  expect(await f.owner(() => f.db.select().from(s.verseSelfCheck))).toMatchObject([{ state: "unmarked", version: 2 }]);
  expect(await f.owner(() => f.db.select().from(s.verseAssessment))).toMatchObject([{ state: "not-started", version: 2 }]);
  await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)));
  await expect(f.progress.setSelfCheck(f.mutation(), f.selection, self("unmarked", 2))).rejects.toMatchObject({ status: 404 });
});

test("whole-assignment counts and closed page rows keep student Got it distinct from staff Solid without read writes or actor metadata", async () => {
  const f = await fixture("Genesis 1:1-5:20"), last = f.refs.at(-1)!;
  await f.progress.setSelfCheck(f.mutation(), f.selection, self("working"));
  await f.progress.setSelfCheck(f.mutation(), f.selection, self("got-it", 0, last));
  await f.progress.setAssessment(f.mutation("multi"), { ...f.selection, mode: "tutor" }, assessment("solid", 0, "Genesis 1:2"));
  // Corrupt/legacy heads not in the current verse list must never affect a DTO.
  await f.owner(async () => {
    const key = { tenantId: "crc", studentId: f.selection.studentId, assignmentId: f.assignment.id, verseRef: "Genesis 9:1", version: 1 };
    await f.db.insert(s.verseSelfCheck).values({ ...key, state: "got-it" });
    await f.db.insert(s.verseAssessment).values({ ...key, state: "solid" });
  });
  const before = await f.owner(() => f.db.select().from(s.auditEvent));
  const page = await f.progress.page(f.mutation("multi"), { ...f.selection, mode: "parent" });
  if (!page.ok) throw new Error("Expected synthetic progress page");
  expect(Object.keys(page).sort()).toEqual(["binding", "counts", "nextOffset", "offset", "ok", "totalVerses", "verses"]);
  expect(Object.keys(page.binding).sort()).toEqual(["assignmentId", "assignmentRevision", "kind", "mode", "studentId"]);
  expect(page.totalVerses).toBe(f.refs.length); expect(page.verses).toHaveLength(100); expect(page.nextOffset).toBe(100);
  expect(page.counts).toEqual({ selfCheck: { unmarked: f.refs.length - 2, working: 1, "got-it": 1 }, assessment: { "not-started": f.refs.length - 1, working: 0, solid: 1 } });
  for (const row of page.verses) {
    expect(Object.keys(row).sort()).toEqual(["assessment", "selfCheck", "verseRef"]);
    expect(Object.keys(row.selfCheck).sort()).toEqual(["state", "version"]); expect(Object.keys(row.assessment).sort()).toEqual(["state", "version"]);
  }
  expect(page.verses[0]).toMatchObject({ selfCheck: { state: "working", version: 1 }, assessment: { state: "not-started", version: 0 } });
  expect(page.verses[1]).toMatchObject({ selfCheck: { state: "unmarked", version: 0 }, assessment: { state: "solid", version: 1 } });
  const next = await f.progress.page(f.mutation(), f.selection, 100);
  expect(next).toMatchObject({ ok: true, counts: page.counts, totalVerses: page.totalVerses });
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
  for (const identity of [f.identities.learner.id, f.identities.multi.id, f.learnerMember.id, f.tutorGrant.id]) expect(JSON.stringify(page)).not.toContain(identity);
});

test("overlapping parent and tutor roles cannot impersonate self-checks; assisted writes require the exact live child context", async () => {
  const f = await fixture();
  for (const mode of ["parent", "tutor", "admin"] as const) await expect(f.progress.setSelfCheck(f.mutation(mode === "admin" ? "admin" : "multi"), { ...f.selection, mode }, self("working"))).rejects.toMatchObject({ status: 403 });
  for (const mode of ["student", "parent"] as const) await expect(f.progress.setAssessment(f.mutation(mode === "student" ? "learner" : "multi"), { ...f.selection, mode }, assessment("solid"))).rejects.toMatchObject({ status: 403 });
  const child = await f.practice.enter(f.mutation("multi"), { studentId: f.selection.studentId }), selection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.progress.setSelfCheck(f.mutation("multi", child.handle), selection, self("got-it"))).toMatchObject({ ok: true, state: "got-it", version: 1 });
  await expect(f.progress.setSelfCheck(f.mutation("learner", child.handle), selection, self("got-it", 1))).rejects.toMatchObject({ status: 403 });
  await expect(f.progress.setSelfCheck(f.mutation("multi", child.handle), { ...selection, studentId: f.students[1].id }, self("working"))).rejects.toMatchObject({ status: 404 });
  await expect(f.progress.setAssessment(f.mutation("multi", child.handle), selection, assessment("solid"))).rejects.toMatchObject({ status: 403 });
  await expect(f.progress.page(f.mutation("multi", child.handle), { ...f.selection, mode: "parent" })).rejects.toMatchObject({ status: 403 });
  await f.practice.exit(f.mutation("multi", child.handle));
  await expect(f.progress.setSelfCheck(f.mutation("multi", child.handle), selection, self("got-it", 1))).rejects.toMatchObject({ status: 404 });
  expect(await f.progress.page(f.mutation("multi"), { ...f.selection, mode: "parent" })).toMatchObject({ ok: true, verses: expect.arrayContaining([expect.objectContaining({ selfCheck: { state: "got-it", version: 1 } })]) });
});

test("closed service binding rejects role/ref/kind and cross-tenant substitutions before any progress change", async () => {
  const f = await fixture();
  for (const selection of [{ ...f.selection, actorUserId: f.identities.learner.id }, { ...f.selection, assignmentRevision: "1" }, { ...f.selection, kind: "service" }, { ...f.selection, mode: "owner" }]) {
    await expect(f.progress.setSelfCheck(f.mutation(), selection as never, self("got-it"))).rejects.toMatchObject({ status: 400 });
  }
  await expect(f.progress.setSelfCheck(f.mutation(), f.selection, { ...self("got-it"), actorUserId: f.identities.learner.id } as never)).rejects.toMatchObject({ status: 400 });
  await expect(f.progress.setSelfCheck(f.mutation(), f.selection, { ...self("got-it"), state: "solid" } as never)).rejects.toMatchObject({ status: 400 });
  await expect(f.progress.setAssessment(f.mutation("multi"), { ...f.selection, mode: "tutor" }, { ...assessment("solid"), state: "got-it" } as never)).rejects.toMatchObject({ status: 400 });
  for (const selection of [{ ...f.selection, kind: "haftarah" as const }, { ...f.selection, assignmentId: randomUUID() }, { ...f.selection, assignmentRevision: 2 }]) expect(await f.progress.setSelfCheck(f.mutation(), selection, self("got-it"))).toEqual({ ok: false, code: "stale-assignment" });
  await expect(f.progress.setSelfCheck(f.mutation(), f.selection, self("got-it", 0, "Genesis 2:1"))).rejects.toMatchObject({ status: 404 });
  await expect(f.progress.setSelfCheck(f.mutation(), { ...f.selection, studentId: f.students[3].id }, self("got-it"))).rejects.toMatchObject({ status: 404 });
  expect(await f.progress.page(f.mutation(), f.selection)).toMatchObject({ ok: true, counts: { selfCheck: { unmarked: 3, working: 0, "got-it": 0 }, assessment: { "not-started": 3, working: 0, solid: 0 } } });
});

test("replacement preserves intersection across regenerated verse UUIDs, prunes removed marks and never resurrects them on re-add", async () => {
  const f = await fixture(), staff = { ...f.selection, mode: "tutor" as const };
  for (const ref of ["Genesis 1:1", "Genesis 1:2"]) {
    await f.progress.setSelfCheck(f.mutation(), f.selection, self("got-it", 0, ref));
    await f.progress.setAssessment(f.mutation("multi"), staff, assessment("solid", 0, ref));
  }
  const service = createStudentService({ access: f.service, signingSecret: "synthetic-progress-independent-reading-secret", loadReading: async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, reading: null, haftarah: null, classification: "missing" } }) });
  async function replace(ranges: string[]) {
    const review = await service.prepareReading(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId, ranges });
    if (review.status !== "prepared") throw new Error("Expected synthetic reading review");
    const result = await service.confirmReading(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId, binding: review.binding });
    if (!result.ok) throw new Error("Expected synthetic reading confirmation"); return result.revision;
  }
  const oldIds = await f.owner(() => f.db.select({ id: s.assignmentVerse.id }).from(s.assignmentVerse));
  expect(await replace(["Genesis 1:2-4"])).toBe(2);
  const ids = await f.owner(() => f.db.select({ id: s.assignmentVerse.id }).from(s.assignmentVerse)); expect(ids.some(row => oldIds.some(prior => prior.id === row.id))).toBe(false);
  const current = { ...f.selection, assignmentRevision: 2 };
  expect(await f.progress.page(f.mutation(), current)).toMatchObject({ ok: true, verses: expect.arrayContaining([{ verseRef: "Genesis 1:2", selfCheck: { state: "got-it", version: 1 }, assessment: { state: "solid", version: 1 } }]), counts: { selfCheck: { "got-it": 1 }, assessment: { solid: 1 } } });
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("working", 1))).toEqual({ ok: false, code: "stale-assignment" });
  expect(await replace(["Genesis 1:1-3"])).toBe(3);
  const readded = { ...f.selection, assignmentRevision: 3 }, page = await f.progress.page(f.mutation(), readded);
  expect(page).toMatchObject({ ok: true, verses: expect.arrayContaining([{ verseRef: "Genesis 1:1", selfCheck: { state: "unmarked", version: 0 }, assessment: { state: "not-started", version: 0 } }, { verseRef: "Genesis 1:2", selfCheck: { state: "got-it", version: 1 }, assessment: { state: "solid", version: 1 } }]) });
  expect(await f.progress.setSelfCheck(f.mutation(), f.selection, self("got-it"))).toEqual({ ok: false, code: "stale-assignment" });
  expect(await f.progress.setSelfCheck(f.mutation(), readded, self("working"))).toMatchObject({ ok: true, version: 1 });
  const cuts = await service.prepareReading(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId, kind: "torah", preparationMode: "current-assignment", expectedAssignmentRevision: 3, aliyahStarts: [] });
  if (cuts.status !== "prepared") throw new Error("Expected synthetic cut-only review");
  expect(await service.confirmReading(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId, binding: cuts.binding })).toMatchObject({ ok: true, revision: 4 });
  expect(await f.progress.page(f.mutation(), { ...readded, assignmentRevision: 4 })).toMatchObject({ ok: true, verses: expect.arrayContaining([{ verseRef: "Genesis 1:2", selfCheck: { state: "got-it", version: 1 }, assessment: { state: "solid", version: 1 } }]) });
});
