import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createServiceCourseProgressService, serviceCourseOwnerName } from "../../src/server/service-course/progress-service";
import { createServicePartFinished } from "../../src/server/service-course/finished";
import { postgresAccessFixture } from "./access-fixture";
import { query } from "./disposable.mjs";
import { syntheticServiceCatalog } from "../helpers/service-learning";

// Release 2.0 SC5 (A4 9): the finished mark's write (a savepoint inside the student's own progress sync) and its staff read, on
// real PostgreSQL through the restricted runtime login, so the driver's savepoints, the column-only INSERT and the policies run for real.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
// 2.0 SC5a: lessons done while synced carry the account's owner name; only those mark.
const doc = (by: string, ...lessons: string[]) => ({ schema: "service-course-progress/v1", lessons: Object.fromEntries(lessons.map(id => [id, { done: "2026-10-20T10:00:00.000Z", by }])), cards: {} });
const status = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(() => 200, error => error instanceof AccessDenied ? error.status : 503);

test("a student's sync marks only their assigned parts on real PostgreSQL, and only the linked tutor and the admin read the marks", async () => {
  const f = await postgresAccessFixture(); fixtures.push(f);
  // The fixture's "tutor" account also learns: a student grant linked to the fixture's student, so one cookie writes as the student
  // and reads as the tutor, each through its own grant.
  const member = (await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.tutor.id)))[0];
  const [studentGrant] = await f.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
  await f.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.student.id, roleGrantId: studentGrant.id });
  const content = syntheticServiceCatalog("finished-pg", { standard: true }), catalogId = randomUUID();
  await f.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
  await f.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
  const adminMember = (await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id)))[0];
  await f.ownerDb.insert(s.studentServicePlan).values({ tenantId: "crc", studentId: f.student.id, catalogId, catalogIdentity: content.identity,
    selectedIds: [content.first, content.standard.vahavta, content.standard.torahBefore], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: adminMember.id });

  const course = createServiceCourseProgressService({ access: f.a }), finished = createServicePartFinished({ access: f.b });
  const mutation = () => { const value = f.request("tutor"); value.headers.set("origin", "http://localhost:3000"); return { ...value, method: "POST" }; };
  const owner = serviceCourseOwnerName({ tenantId: "crc", membershipId: member.id });
  expect(await course.merge(mutation(), { progress: doc(owner, "vahavta", "shma", "f1"), owner })).toMatchObject({ ok: true, version: 1 });
  expect(await course.put(mutation(), { progress: doc(owner, "vahavta", "shma", "f1", "torah-before"), expectedVersion: 1, owner })).toMatchObject({ ok: true, version: 2 });
  const rows = (await query(f.owner, "SELECT lesson_id FROM service_part_finished WHERE student_id = $1 ORDER BY lesson_id", [f.student.id])).rows as { lesson_id: string }[];
  expect(rows.map(r => r.lesson_id)).toEqual(["torah-before", "vahavta"]);
  expect((await query(f.owner, "SELECT count(*)::int AS n FROM audit_event WHERE action = 'service-part.finish'")).rows[0]).toEqual({ n: 2 });

  for (const [who, mode] of [["tutor", "tutor"], ["admin", "admin"]] as const) {
    const answer = await finished.read(f.request(who), { mode, studentId: f.student.id });
    expect(answer.parts.map(p => [p.lesson, typeof p.finished])).toEqual([["vahavta", "string"], ["torah-before", "string"]]);
    expect(answer.parts.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.finished!))).toBe(true);
  }
  // Without the tutor_student row the same tutor reads nothing; another congregation's student is not found.
  await query(f.owner, "UPDATE tutor_student SET revoked_at = now() WHERE student_id = $1", [f.student.id]);
  expect(await status(finished.read(f.request("tutor"), { mode: "tutor", studentId: f.student.id }))).toBe(404);
  expect(await status(finished.read(f.request("admin"), { mode: "admin", studentId: f.otherStudent.id }))).toBe(404);
  expect(await status(finished.read(f.request("tutor"), { mode: "parent" as "tutor", studentId: f.student.id }))).toBe(403);
});
