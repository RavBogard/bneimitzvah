import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeService } from "../../src/server/practice/service";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

// Release 1.9 N12: "Before next time" on a lesson note. The line has the note's readers and no others: the student and the
// parent who read the note see it, and another family's parent, another tutor's student and an unrelated tutor do not.
// Runs as portal_runtime under the forced row security (PGlite); tests/postgres/lesson-note-before-next.integration.ts repeats
// the reader matrix on a real server. Synthetic people and text only.
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const LINE = "When I get home on Tuesday, I will chant verse two with the recording.";

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const target = f.students[0].id, unrelated = f.students[2].id;
  // Outsiders: another family's parent (guardian of the unrelated student only), that student (whose tutor is another tutor),
  // and that other tutor, who teaches only the unrelated student.
  const outsiders = await f.owner(async () => {
    const people = {} as Record<"otherParent" | "otherStudent" | "otherTutor", { cookie: string }>;
    for (const [key, role] of [["otherParent", "parent"], ["otherStudent", "student"], ["otherTutor", "tutor"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(`n12-${key.toLowerCase()}@example.test`);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic N12 identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id }).returning();
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role }).returning();
      if (role === "parent") await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: unrelated, parentGrantId: grant.id, linkProvenance: "synthetic" });
      if (role === "student") await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: unrelated, roleGrantId: grant.id });
      if (role === "tutor") await f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: unrelated, tutorGrantId: grant.id });
      people[key] = { cookie };
    }
    return people;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookieOf = (who: string) => who in outsiders ? outsiders[who as keyof typeof outsiders].cookie : f.identities[who as "multi"].cookie;
  const call = async (who: string, suffix: string, body?: unknown) => {
    const headers = new Headers({ cookie: cookieOf(who), origin: "http://localhost:3000" });
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await dispatch(new Request(`http://localhost:3000/api/students/${target}/lesson-log${suffix}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, data: await response.json() as Record<string, any> };
  };
  return { ...f, target, unrelated, call };
}

test("saved with the note, read by the student and the parent who read the note, and by nobody else", async () => {
  const f = await fixture(), entryId = randomUUID();
  const created = await f.call("multi", "", { mode: "tutor", entryId, lessonDate: "2026-10-23", summary: "Synthetic lesson: verse one.", beforeNext: LINE });
  expect(created.status).toBe(200); expect(created.data.entry).toMatchObject({ entryId, beforeNext: LINE, version: 1 });
  // The readers who already read the note read the line with it.
  for (const [who, mode] of [["learner", "student"], ["multi", "parent"], ["multi", "tutor"], ["admin", "admin"]] as const) {
    const page = await f.call(who, `?mode=${mode}`);
    expect(page.status, `${who} ${mode}`).toBe(200); expect(page.data.entries).toEqual([expect.objectContaining({ entryId, summary: "Synthetic lesson: verse one.", beforeNext: LINE })]);
  }
  // Another family's parent, another tutor's student and an unrelated tutor read neither the note nor the line.
  for (const [who, mode] of [["otherParent", "parent"], ["otherStudent", "student"], ["otherTutor", "tutor"], ["otherTutor", "admin"], ["learner", "parent"], ["learner", "tutor"]] as const) {
    const page = await f.call(who, `?mode=${mode}`);
    expect(page.status, `${who} ${mode}`).toBeGreaterThanOrEqual(403); expect(page.status).toBeLessThanOrEqual(404);
    expect(JSON.stringify(page.data)).not.toContain("verse two");
  }
  // Row security: another congregation sees no row and so no line; the column carries no wider grant than the note.
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select({ beforeNext: s.lessonLog.beforeNext }).from(s.lessonLog))).toEqual([]);
  const privileges = await withTenantTransaction(f.db, { tenantId: "crc" }, async tx => ((await tx.execute(sql`select
      has_column_privilege('portal_runtime', 'lesson_log', 'before_next', 'SELECT') = has_column_privilege('portal_runtime', 'lesson_log', 'summary', 'SELECT') as same_select,
      has_column_privilege('portal_runtime', 'lesson_log', 'before_next', 'UPDATE') = has_column_privilege('portal_runtime', 'lesson_log', 'summary', 'UPDATE') as same_update,
      (select count(*)::int from pg_policies where tablename = 'lesson_log') as policies`)) as unknown as { rows: Record<string, unknown>[] }).rows);
  expect(privileges).toEqual([{ same_select: true, same_update: true, policies: 1 }]);
  // The audit records that a lesson changed, never its words.
  const audit = await f.owner(() => f.db.select().from(s.auditEvent));
  expect(JSON.stringify(audit)).not.toContain("verse two");
});

test("the service path refuses outsiders before any row is read, and child practice reads what the student reads", async () => {
  const f = await fixture(), entryId = randomUUID();
  const practice = createPracticeService({ access: f.service }), lesson = createLessonLogService({ access: f.service, practice });
  const post = (who: "multi" | "learner", handle?: string) => ({ url: "http://localhost:3000/students", method: "POST", headers: new Headers({ cookie: f.identities[who].cookie, origin: "http://localhost:3000", ...(handle ? { "X-Practice-Context": handle } : {}) }) });
  await lesson.create(post("multi"), { mode: "tutor", studentId: f.target }, { entryId, lessonDate: "2026-10-23", summary: "Synthetic lesson.", beforeNext: LINE });
  const child = await practice.enter(post("multi"), { studentId: f.target });
  expect(await lesson.page(post("multi", child.handle), { mode: "child-practice", studentId: f.target })).toMatchObject({ entries: [{ entryId, beforeNext: LINE, canEdit: false }] });
  expect(await lesson.page(post("learner"), { mode: "student", studentId: f.target })).toMatchObject({ entries: [{ entryId, beforeNext: LINE, canEdit: false }] });
  // The parent of two children reads the line only on the child whose note it is.
  expect(await lesson.page(post("multi"), { mode: "parent", studentId: f.students[1].id })).toMatchObject({ entries: [] });
  await expect(lesson.page(post("multi"), { mode: "parent", studentId: f.unrelated })).rejects.toMatchObject({ status: 404 });
});

test("the line is optional, bounded with one refusal, kept by an edit that leaves it out, cleared by null or blank, and gone with a deleted note", async () => {
  const f = await fixture(), entryId = randomUUID(), base = { mode: "tutor", entryId, lessonDate: "2026-10-23", summary: "Synthetic lesson." };
  // Too long, not text, or with a hidden character: one 400, and nothing saved.
  for (const beforeNext of ["x".repeat(1025), "א".repeat(513), 7, ["When"], { when: "x" }, "When\u0000 I", "\ud800"]) {
    const refused = await f.call("multi", "", { ...base, beforeNext });
    expect(refused.status).toBe(400); expect(refused.data).toEqual({ error: "invalid-request" });
  }
  expect(await f.owner(() => f.db.select().from(s.lessonLog))).toHaveLength(0);
  // Exactly at the limit saves; CRLF is stored as LF, like the summary.
  const atLimit = await f.call("multi", "", { ...base, beforeNext: "א".repeat(511) + "x\r\n" });
  expect(atLimit.status).toBe(200); expect(atLimit.data.entry.beforeNext).toBe("א".repeat(511) + "x\n");
  // A replay of the create with a different line is a conflict, not a silent change.
  expect((await f.call("multi", "", { ...base, beforeNext: LINE })).status).toBe(409);
  // An edit that leaves the line out keeps it (an older page never erases it); a blank or null clears it.
  const kept = await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 1, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson." });
  expect(kept.data.entry).toMatchObject({ version: 2, beforeNext: "א".repeat(511) + "x\n" });
  const changed = await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 2, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: LINE });
  expect(changed.data.entry).toMatchObject({ version: 3, beforeNext: LINE });
  // The same text again is a no-op that keeps the version.
  expect((await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 3, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: LINE })).data.entry.version).toBe(3);
  const blank = await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 3, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: " \n\t " });
  expect(blank.data.entry).toMatchObject({ version: 4, beforeNext: null });
  await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 4, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: LINE });
  const cleared = await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 5, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: null });
  expect(cleared.data.entry).toMatchObject({ version: 6, beforeNext: null });
  await f.call("multi", `/${entryId}/edit`, { mode: "tutor", expectedVersion: 6, lessonDate: base.lessonDate, summary: "Synthetic corrected lesson.", beforeNext: LINE });
  // A note without the line is still a note, and a learner can never write one.
  const plain = await f.call("multi", "", { ...base, entryId: randomUUID() }); expect(plain.data.entry.beforeNext).toBeNull();
  expect((await f.call("learner", "", { ...base, mode: "student", entryId: randomUUID(), beforeNext: LINE })).status).toBe(403);
  // Delete leaves a tombstone with no summary and no line.
  expect((await f.call("multi", `/${entryId}/delete`, { mode: "tutor", expectedVersion: 7 })).status).toBe(200);
  const rows = await f.owner(() => f.db.select().from(s.lessonLog));
  expect(rows.find(row => row.entryId === entryId)).toMatchObject({ deleted: true, summary: "", beforeNext: null });
  expect((await f.call("learner", "?mode=student")).data.entries.map((entry: { beforeNext: unknown }) => entry.beforeNext)).toEqual([null]);
  // A delete body that names the line is refused: delete takes only its own fields.
  expect((await f.call("multi", `/${plain.data.entry.entryId}/delete`, { mode: "tutor", expectedVersion: 1, beforeNext: null })).status).toBe(400);
});
