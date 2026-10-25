import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeService } from "../../src/server/practice/service";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await accessFixture(); fixtures.push(f);
  const practice = createPracticeService({ access: f.service }), lesson = createLessonLogService({ access: f.service, practice });
  const selection = { mode: "tutor" as const, studentId: f.students[0].id };
  const request = (who: "admin" | "multi" | "learner" = "multi", handle?: string, origin = "http://localhost:3000") => ({ ...f.request(who, origin, { origin, ...(handle ? { "X-Practice-Context": handle } : {}) }), method: "POST" });
  return { ...f, practice, lesson, selection, mutation: request };
}
const create = (entryId = randomUUID(), summary = "Synthetic original lesson", lessonDate = "2026-10-16") => ({ entryId, summary, lessonDate });
const conflict = { ok: false, code: "conflict" };

test("create replay is exact live v1 only; edits, text cycles, stale requests and irreversible tombstones never resurrect old content", async () => {
  const f = await fixture(), input = create(randomUUID(), "Synthetic first line\r\nSynthetic second line"), normalized = { ...input, summary: input.summary.replace(/\r\n/g, "\n") };
  const initial = await f.lesson.create(f.mutation(), f.selection, input);
  expect(initial).toMatchObject({ ok: true, entry: { ...normalized, version: 1, canEdit: true, canDelete: true } });
  const beforeReplay = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(await f.lesson.create(f.mutation(), f.selection, normalized)).toEqual(initial);
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(beforeReplay);
  for (const change of [{ summary: "Synthetic changed lesson" }, { lessonDate: "2026-10-17" }]) expect(await f.lesson.create(f.mutation(), f.selection, { ...normalized, ...change })).toEqual(conflict);
  expect(await f.lesson.edit(f.mutation(), f.selection, { ...normalized, summary: "Synthetic changed lesson", expectedVersion: 1 })).toMatchObject({ ok: true, entry: { version: 2 } });
  expect(await f.lesson.create(f.mutation(), f.selection, normalized)).toEqual(conflict);
  expect(await f.lesson.edit(f.mutation(), f.selection, { ...normalized, expectedVersion: 2 })).toMatchObject({ ok: true, entry: { version: 3 } });
  // Matching text again is not proof that the original create is still current.
  expect(await f.lesson.create(f.mutation(), f.selection, normalized)).toEqual(conflict);
  expect(await f.lesson.edit(f.mutation(), f.selection, { ...normalized, expectedVersion: 1 })).toEqual(conflict);
  expect(await f.lesson.remove(f.mutation(), f.selection, { entryId: input.entryId, expectedVersion: 2 })).toEqual(conflict);
  expect(await f.lesson.remove(f.mutation(), f.selection, { entryId: input.entryId, expectedVersion: 3 })).toEqual({ ok: true, entryId: input.entryId, version: 4 });
  expect(await f.lesson.create(f.mutation(), f.selection, normalized)).toEqual(conflict);
  expect(await f.lesson.edit(f.mutation(), f.selection, { ...normalized, expectedVersion: 4 })).toEqual(conflict);
  expect(await f.lesson.remove(f.mutation(), f.selection, { entryId: input.entryId, expectedVersion: 4 })).toEqual(conflict);
  expect(await f.lesson.page(f.mutation(), f.selection)).toMatchObject({ ok: true, entries: [], nextCursor: null });
  expect(await f.owner(() => f.db.select().from(s.lessonLog))).toMatchObject([{ entryId: input.entryId, summary: "", deleted: true, version: 4 }]);
  const audit = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(audit.length - beforeReplay.length).toBe(3);
  for (const text of [normalized.summary, "Synthetic changed lesson"]) expect(JSON.stringify(audit)).not.toContain(text);
});

test("current original-author tutor or admin alone may mutate, admin edits preserve creator attribution, and revoked creator grants do not erase family history", async () => {
  const f = await fixture(), input = create(), admin = { ...f.selection, mode: "admin" as const };
  await f.owner(async () => {
    await f.db.update(s.user).set({ name: "Synthetic Original Tutor" }).where(eq(s.user.id, f.identities.multi.id));
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.learnerMember.id, role: "tutor" }).returning();
    await f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: f.selection.studentId, tutorGrantId: grant.id });
  });
  await f.lesson.create(f.mutation(), f.selection, input);
  expect(await f.lesson.page(f.mutation("learner"), f.selection)).toMatchObject({ entries: [{ displayName: "Synthetic Original Tutor", canEdit: false, canDelete: false }] });
  await expect(f.lesson.edit(f.mutation("learner"), f.selection, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  await expect(f.lesson.remove(f.mutation("learner"), f.selection, { entryId: input.entryId, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  expect(await f.lesson.create(f.mutation("admin"), admin, input)).toEqual(conflict);
  expect(await f.lesson.edit(f.mutation("admin"), admin, { ...input, summary: "Synthetic administrator correction", expectedVersion: 1 })).toMatchObject({ ok: true, entry: { version: 2, displayName: "Synthetic Original Tutor", canEdit: true, canDelete: true } });
  const [row] = await f.owner(() => f.db.select().from(s.lessonLog));
  expect(row).toMatchObject({ creatorMembershipId: f.multiMember.id, creatorUserId: f.identities.multi.id });
  await f.owner(() => f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id)));
  await expect(f.lesson.edit(f.mutation(), f.selection, { ...input, expectedVersion: 2 })).rejects.toMatchObject({ status: 403 });
  expect(await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" })).toMatchObject({ entries: [{ summary: "Synthetic administrator correction", displayName: "Synthetic Original Tutor", canEdit: false, canDelete: false }] });
  expect(await f.lesson.page(f.mutation("learner"), f.selection)).toMatchObject({ entries: [{ canEdit: false, canDelete: false }] });
  expect(await f.lesson.remove(f.mutation("admin"), admin, { entryId: input.entryId, expectedVersion: 2 })).toMatchObject({ ok: true, version: 3 });
});

test("parent, student and exact linked-child practice are read-only even with overlapping staff roles, and switched handles cannot recover old lesson context", async () => {
  const f = await fixture(), input = create(); await f.lesson.create(f.mutation(), f.selection, input);
  for (const [mode, who] of [["parent", "multi"], ["student", "learner"]] as const) {
    const selection = { ...f.selection, mode };
    expect(await f.lesson.page(f.mutation(who), selection)).toMatchObject({ entries: [{ canEdit: false, canDelete: false }] });
    await expect(f.lesson.create(f.mutation(who), selection, create())).rejects.toMatchObject({ status: 403 });
    await expect(f.lesson.edit(f.mutation(who), selection, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(f.lesson.remove(f.mutation(who), selection, { entryId: input.entryId, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  }
  const child = await f.practice.enter(f.mutation(), { studentId: f.selection.studentId }), childSelection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.lesson.page(f.mutation("multi", child.handle), childSelection)).toMatchObject({ entries: [{ canEdit: false, canDelete: false }] });
  await expect(f.lesson.create(f.mutation("multi", child.handle), childSelection, create())).rejects.toMatchObject({ status: 403 });
  await expect(f.lesson.edit(f.mutation("multi", child.handle), childSelection, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  await expect(f.lesson.remove(f.mutation("multi", child.handle), childSelection, { entryId: input.entryId, expectedVersion: 1 })).rejects.toMatchObject({ status: 403 });
  await expect(f.lesson.page(f.mutation("multi", child.handle), f.selection)).rejects.toMatchObject({ status: 403 });
  await f.practice.switch(f.mutation("multi", child.handle), { studentId: f.students[1].id });
  await expect(f.lesson.page(f.mutation("multi", child.handle), childSelection)).rejects.toMatchObject({ status: 404 });
  expect(await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" })).toMatchObject({ entries: [{ summary: input.summary }] });
  await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)));
  await expect(f.lesson.create(f.mutation(), f.selection, input)).rejects.toMatchObject({ status: 404 });
});

test("the same client UUID is scoped by authorized tenant and student rather than becoming cross-student or cross-tenant authority", async () => {
  const f = await fixture(), input = create(), admin = { ...f.selection, mode: "admin" as const };
  await f.lesson.create(f.mutation("admin"), admin, input);
  await f.lesson.create(f.mutation("admin"), { ...admin, studentId: f.students[1].id }, { ...input, summary: "Synthetic sibling lesson" });
  await f.owner(async () => {
    const [member] = await f.db.insert(s.membership).values({ tenantId: "other", userId: f.identities.admin.id }).returning();
    await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "admin" });
  });
  const otherRequest = f.mutation("admin", undefined, "http://localhost:3101"), otherSelection = { ...admin, studentId: f.students[3].id };
  await f.lesson.create(otherRequest, otherSelection, { ...input, summary: "Synthetic other congregation lesson" });
  expect(await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" })).toMatchObject({ entries: [{ summary: input.summary }] });
  expect(await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent", studentId: f.students[1].id })).toMatchObject({ entries: [{ summary: "Synthetic sibling lesson" }] });
  expect(await f.lesson.page(otherRequest, otherSelection)).toMatchObject({ entries: [{ summary: "Synthetic other congregation lesson" }] });
  await expect(f.lesson.page(f.mutation("admin"), otherSelection)).rejects.toMatchObject({ status: 404 });
  await expect(f.lesson.edit(f.mutation(), { ...f.selection, studentId: f.students[1].id }, { ...input, expectedVersion: 1 })).rejects.toMatchObject({ status: 404 });
  expect(await f.owner(() => f.db.select().from(s.lessonLog))).toHaveLength(3);
});

test("current-only keyset ties, closed safe DTOs and unsafe creator names do not expose actor identifiers, timestamps, deleted text or mutation events", async () => {
  const f = await fixture(), ids = Array.from({ length: 53 }, (_, i) => `10000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`);
  await f.owner(() => f.db.insert(s.lessonLog).values(ids.map((entryId, i) => ({ tenantId: "crc", studentId: f.selection.studentId, entryId, creatorMembershipId: f.multiMember.id, creatorUserId: f.identities.multi.id, lessonDate: i === 51 ? "2026-09-01" : i === 52 ? "2027-01-01" : "2026-10-16", summary: `Synthetic numbered lesson ${i + 1}`, version: 1, deleted: false }))));
  await f.lesson.remove(f.mutation(), f.selection, { entryId: ids[52], expectedVersion: 1 });
  const before = await f.owner(() => f.db.select().from(s.auditEvent));
  const first = await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" });
  if (!first.ok || !first.nextCursor) throw new Error("Expected synthetic paged lesson list");
  expect(Object.keys(first).sort()).toEqual(["entries", "mode", "nextCursor", "ok", "studentId"]);
  expect(first.entries.map(row => row.entryId)).toEqual(ids.slice(1, 51).reverse());
  expect(first.nextCursor).toEqual({ lessonDate: "2026-10-16", entryId: ids[1] });
  const second = await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" }, first.nextCursor);
  expect(second).toMatchObject({ entries: [{ entryId: ids[0] }, { entryId: ids[51] }], nextCursor: null });
  for (const entry of first.entries) expect(Object.keys(entry).sort()).toEqual(["beforeNext", "canDelete", "canEdit", "displayName", "entryId", "lessonDate", "summary", "version"]);
  for (const name of ["unsafe@example.test", "Synthetic\u0007Tutor", "x".repeat(1000), "", " \n "]) {
    await f.owner(() => f.db.update(s.user).set({ name }).where(eq(s.user.id, f.identities.multi.id)));
    const page = await f.lesson.page(f.mutation(), { ...f.selection, mode: "parent" });
    if (!page.ok) throw new Error("Expected safe synthetic lesson projection");
    const label = page.entries[0].displayName;
    expect(label.trim().length).toBeGreaterThan(0); expect(label.length).toBeLessThan(200); expect(label).not.toMatch(/[@\u0000-\u001f\u007f]/); expect(label).not.toBe(name);
    for (const identity of [f.identities.multi.id, f.multiMember.id, f.tutorGrant.id]) expect(JSON.stringify(page)).not.toContain(identity);
    expect(JSON.stringify(page)).not.toContain("Synthetic numbered lesson 53");
  }
  expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
});
