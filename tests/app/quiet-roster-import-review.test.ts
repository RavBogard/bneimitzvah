import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql, getTableName } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { invitesFixture } from "./invites-fixture";
import { createStudentService } from "../../src/server/students/service";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";

const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
async function fixture() {
  const f = await accessFixture(); opened.push(f); const time = Date.now();
  const service = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), now: () => time, loadReading: async () => { throw new Error("Listing the roster must not load a reading"); } });
  const request = () => ({ ...f.request("admin", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" });
  return { ...f, studentsService: service, mutation: request };
}
async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}
async function counts(f: Pick<Awaited<ReturnType<typeof accessFixture>>, "owner" | "db">) {
  return f.owner(async () => {
    const result: Record<string, number> = {};
    for (const table of [s.student, s.auditEvent, s.user, s.session, s.membership, s.roleGrant, s.guardian, s.studentIdentity, s.tutorStudent, s.invite, s.assignment, s.assignmentVerse]) {
      const [{ total }] = await f.db.select({ total: sql<number>`count(*)::int` }).from(table); result[getTableName(table)] = total;
    }
    return result;
  });
}

test("late secondary guardian contact blocks all student invitation transitions without issuing authority", async () => {
  const f = await invitesFixture(); opened.push(f);
  const selection = { mode: "admin" as const, role: "student" as const, studentId: f.students[2].id, email: "student-new@example.test" };
  const issued = await f.invitations.issue(f.request("admin"), selection), token = f.token(), review = await f.invitations.preview(f.request("newStudent"), { token });
  await f.owner(async () => { await f.db.update(s.student).set({ secondParentEmail: selection.email }).where(eq(s.student.id, selection.studentId)); });
  const before = await counts(f), mails = f.delivered.length;
  expect(await denied(() => f.invitations.issue(f.request("admin"), selection), 403)).toBe(true);
  expect(await denied(() => f.invitations.reissue(f.request("admin"), { mode: "admin", inviteId: issued.inviteId }), 403)).toBe(true);
  expect(await denied(() => f.invitations.preview(f.request("newStudent"), { token }), 404)).toBe(true);
  expect(await denied(() => f.invitations.acceptReviewed(f.request("newStudent"), { token, reviewBinding: review.reviewBinding }), 404)).toBe(true);
  expect(await counts(f)).toEqual(before); expect(f.delivered.length).toBe(mails);
});

test("stored intake remains admin-only even after independent explicit learner, guardian and tutor links exist", async () => {
  // The CSV import that once wrote intake details is gone (Daniel, 2026-11-17); rows it wrote stay, so this inserts one directly.
  const f = await fixture(), id = randomUUID();
  await f.owner(async () => {
    await f.db.insert(s.student).values({ id, tenantId: "crc", firstName: "Synthetic", lastName: "Intake", ceremonyDate: "2027-01-02", studentKind: "child", serviceSlot: "havdalah", parentEmail: "primary@example.test", ownEmail: null,
      hebrewName: "Synthetic Hebrew", secondParentEmail: "secondary@example.test",
      importMetadata: { version: 1, parent1Name: "Synthetic Guardian", householdPhone: "555-0100", parent2Name: "Synthetic Second", parashahLabel: "Synthetic display label", tutorName: null, tutorMatch: null, adminNotes: "Synthetic admin-only intake detail" } });
    await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: id, parentGrantId: f.parentGrant.id, linkProvenance: "synthetic explicit review setup" });
    await f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: id, tutorGrantId: f.tutorGrant.id });
    await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(and(eq(s.studentIdentity.studentId, f.students[0].id), eq(s.studentIdentity.roleGrantId, f.learnerGrant.id)));
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: id, roleGrantId: f.learnerGrant.id });
  });
  for (const [who, mode] of [["multi", "parent"], ["multi", "tutor"], ["learner", "student"]] as const) {
    const row = await f.service.readStudent(f.request(who), { mode, studentId: id });
    expect(Object.keys(row).sort()).toEqual(["id", "firstName", "lastName", "ceremonyDate", "rehearsal1", "rehearsal2", "serviceSlot", "revision"].sort());
    expect(JSON.stringify(await f.service.listStudents(f.request(who), { mode }))).not.toContain("Synthetic admin-only intake detail");
  }
  const [row] = (await f.studentsService.listRoster(f.mutation(), { mode: "admin" })).filter(row => row.id === id);
  expect(row.secondParentEmail).toBe("secondary@example.test"); expect(row.importMetadata?.adminNotes).toBe("Synthetic admin-only intake detail");
});
