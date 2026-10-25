import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createLessonLogService } from "../../src/server/lesson-log/service";
import { createPracticeService } from "../../src/server/practice/service";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { postgresAccessFixture } from "./access-fixture";
import { query } from "./disposable.mjs";

// Release 1.9 N12 on a real server: the "Before next time" line (0047) is read by exactly the note's readers. Every read below
// runs as a NOBYPASSRLS login holding portal_runtime, under lesson_log's forced tenant_isolation policy. Synthetic people only.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const LINE = "When I get home on Tuesday, I will chant verse two with the recording.";
const outcome = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));

async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const practice = createPracticeService({ access: f.a }), lesson = createLessonLogService({ access: f.a, practice });
  // A second family in the same congregation, with its own parent, its own student and its own tutor.
  const [otherFamily] = await f.ownerDb.insert(s.student).values({ tenantId: "crc", firstName: "Synthetic", lastName: "Neighbour", ceremonyDate: "2027-02-06", parentEmail: "neighbour@example.test" }).returning();
  const person = async (name: string, role: "student" | "parent" | "tutor", studentId: string) => {
    await f.ownerDb.delete(s.rateLimit); // Five synthetic sign-ins from one test address would meet the magic-link rate limit.
    const who = await f.signIn(name);
    const [member] = await f.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: who.id }).returning();
    const [grant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role }).returning();
    if (role === "student") await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId, roleGrantId: grant.id });
    if (role === "parent") await f.ownerDb.insert(s.guardian).values({ tenantId: "crc", studentId, parentGrantId: grant.id, linkProvenance: "synthetic" });
    if (role === "tutor") await f.ownerDb.insert(s.tutorStudent).values({ tenantId: "crc", studentId, tutorGrantId: grant.id });
    return who;
  };
  const people = {
    learner: await person("pg-n12-learner", "student", f.student.id),
    parent: await person("pg-n12-parent", "parent", f.student.id),
    otherParent: await person("pg-n12-other-parent", "parent", otherFamily.id),
    otherStudent: await person("pg-n12-other-student", "student", otherFamily.id),
    otherTutor: await person("pg-n12-other-tutor", "tutor", otherFamily.id),
  };
  const as = (cookie: string) => ({ url: "http://localhost:3000/students", method: "POST", headers: new Headers({ cookie, origin: "http://localhost:3000" }) });
  return { ...f, lesson, people, otherFamily, as };
}

test("the line saved with a note is read by the student and the parent who read the note, and by no other family, student or tutor", async () => {
  const f = await fixture(), entryId = randomUUID(), target = f.student.id;
  const created = await f.lesson.create(f.as(f.tutor.cookie), { mode: "tutor", studentId: target }, { entryId, lessonDate: "2026-10-23", summary: "Synthetic lesson: verse one.", beforeNext: LINE });
  expect(created).toMatchObject({ ok: true, entry: { entryId, beforeNext: LINE, version: 1 } });
  // The readers the note already had.
  for (const [cookie, mode] of [[f.people.learner.cookie, "student"], [f.people.parent.cookie, "parent"], [f.tutor.cookie, "tutor"], [f.admin.cookie, "admin"]] as const) {
    expect(await f.lesson.page(f.as(cookie), { mode, studentId: target }), mode).toMatchObject({ ok: true, entries: [{ entryId, summary: "Synthetic lesson: verse one.", beforeNext: LINE }] });
  }
  // Another family's parent, another tutor's student, and a tutor of another student: refused before any row is read.
  for (const [who, mode] of [["otherParent", "parent"], ["otherStudent", "student"], ["otherTutor", "tutor"]] as const) {
    expect(await outcome(f.lesson.page(f.as(f.people[who].cookie), { mode, studentId: target })), who).toEqual({ denied: 404 });
  }
  // A role the person does not hold reads nothing either.
  for (const [who, mode] of [["learner", "parent"], ["parent", "student"], ["otherTutor", "admin"]] as const) {
    expect(await outcome(f.lesson.page(f.as(f.people[who].cookie), { mode, studentId: target })), `${who} as ${mode}`).toEqual({ denied: 403 });
  }
  // Each outsider still reads their own family's list, which holds no note and no line from this one.
  expect(await f.lesson.page(f.as(f.people.otherParent.cookie), { mode: "parent", studentId: f.otherFamily.id })).toMatchObject({ ok: true, entries: [] });
  expect(await f.lesson.page(f.as(f.people.otherStudent.cookie), { mode: "student", studentId: f.otherFamily.id })).toMatchObject({ ok: true, entries: [] });
  expect(await f.lesson.page(f.as(f.people.otherTutor.cookie), { mode: "tutor", studentId: f.otherFamily.id })).toMatchObject({ ok: true, entries: [] });
});

test("row security and grants on the real server: the column is as private as the note, no wider, and another congregation reads no line", async () => {
  const f = await fixture(), entryId = randomUUID();
  await f.lesson.create(f.as(f.tutor.cookie), { mode: "tutor", studentId: f.student.id }, { entryId, lessonDate: "2026-10-23", summary: "Synthetic lesson.", beforeNext: LINE });
  type Result = { rows: Record<string, unknown>[] };
  const rows = (tenant: string, statement: ReturnType<typeof sql>) => withTenantTransaction(f.bDb, { tenantId: tenant }, async tx => ((await tx.execute(statement)) as unknown as Result).rows);
  // The runtime login cannot bypass row security; with no tenant, or another one, the line is unreachable.
  expect((await query<{ bypass: boolean }>(f.owner, "select rolbypassrls as bypass from pg_roles where rolname = 'portal_runtime'")).rows).toEqual([{ bypass: false }]);
  expect(await f.bDb.select({ beforeNext: s.lessonLog.beforeNext }).from(s.lessonLog)).toEqual([]);
  expect(await rows("other", sql`select before_next from lesson_log`)).toEqual([]);
  expect(await rows("crc", sql`select before_next from lesson_log`)).toEqual([{ before_next: LINE }]);
  // Another congregation cannot write a line onto this one's note.
  expect(await withTenantTransaction(f.bDb, { tenantId: "other" }, async tx => ((await tx.execute(sql`update lesson_log set before_next = 'Synthetic intrusion', version = version + 1`)) as unknown as { rowCount: number }).rowCount)).toBe(0);
  // One policy, the same as before 0047, forced; the column's privileges are exactly the summary's.
  const catalog = await query<Record<string, unknown>>(f.owner, `select
      (select count(*)::int from pg_policies where tablename = 'lesson_log') as policies,
      (select string_agg(policyname || ':' || cmd, ',') from pg_policies where tablename = 'lesson_log') as policy,
      (select relforcerowsecurity from pg_class where oid = 'lesson_log'::regclass) as forced,
      has_column_privilege('portal_runtime', 'lesson_log', 'before_next', 'SELECT') = has_column_privilege('portal_runtime', 'lesson_log', 'summary', 'SELECT') as same_select,
      has_column_privilege('portal_runtime', 'lesson_log', 'before_next', 'UPDATE') = has_column_privilege('portal_runtime', 'lesson_log', 'summary', 'UPDATE') as same_update,
      has_column_privilege('portal_runtime', 'lesson_log', 'before_next', 'INSERT') = has_column_privilege('portal_runtime', 'lesson_log', 'summary', 'INSERT') as same_insert,
      (select count(*)::int from information_schema.column_privileges where table_name = 'lesson_log' and column_name = 'before_next' and grantee = 'PUBLIC') as public_grants`);
  expect(catalog.rows).toEqual([{ policies: 1, policy: "tenant_isolation:ALL", forced: true, same_select: true, same_update: true, same_insert: true, public_grants: 0 }]);
  // The CHECK holds for the runtime: too long is refused, and a tombstone keeps no line.
  const state = async (statement: ReturnType<typeof sql>) => { try { await withTenantTransaction(f.bDb, { tenantId: "crc" }, tx => tx.execute(statement)); return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown"; } };
  expect(await state(sql`update lesson_log set before_next = ${"x".repeat(1025)}, version = 2 where entry_id = ${entryId}`)).toBe("23514");
  expect(await state(sql`update lesson_log set summary = '', deleted = true, version = 2 where entry_id = ${entryId}`)).toBe("23514");
  expect(await f.lesson.remove(f.as(f.tutor.cookie), { mode: "tutor", studentId: f.student.id }, { entryId, expectedVersion: 1 })).toMatchObject({ ok: true, version: 2 });
  expect(await rows("crc", sql`select summary, before_next, deleted from lesson_log`)).toEqual([{ summary: "", before_next: null, deleted: true }]);
});
