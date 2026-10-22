import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql, getTableName } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { invitesFixture } from "./invites-fixture";
import { createStudentService } from "../../src/server/students/service";
import { AccessDenied } from "../../src/server/access/errors";
import * as data from "../../src/server/data/roster";
import * as s from "../../src/server/db/index";

const FULL = "firstName,lastName,ceremonyDate,parentEmail,ownEmail,service_slot,parashah,tutor,parent1_name,household_phone,parent2_name,parent2_email,hebrew_name,notes";
const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
function csv(tutor = "Synthetic Named Tutor", suffix = "Intake") {
  return FULL + "\n" + ["Synthetic", suffix, "2027-01-02", "primary@example.test", "", "havdalah", "Synthetic display label", tutor, "Synthetic Guardian", "555-0100", "Synthetic Second", "secondary@example.test", "Synthetic Hebrew", "Synthetic admin-only intake detail"].map(cell).join(",");
}
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
async function fixture() {
  const f = await accessFixture(); opened.push(f); const time = Date.now();
  const service = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), now: () => time, loadReading: async () => { throw new Error("Import must not load a reading"); } });
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
async function tutor(f: Awaited<ReturnType<typeof accessFixture>>, name: string, options: { tenant?: string; verified?: boolean; revoked?: boolean; disabled?: boolean } = {}) {
  return f.owner(async () => {
    const id = randomUUID(), tenantId = options.tenant ?? "crc";
    await f.db.insert(s.user).values({ id, name, email: `${id}@example.test`, emailVerified: options.verified !== false });
    const [member] = await f.db.insert(s.membership).values({ tenantId, userId: id, ...(options.disabled ? { disabledAt: new Date() } : {}) }).returning();
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId, membershipId: member.id, role: "tutor", ...(options.revoked ? { revokedAt: new Date() } : {}) }).returning();
    return { member, grant, userId: id };
  });
}

test("tutor proposals go stale on name, eligibility or ambiguity changes instead of silently changing the reviewed proposal", async () => {
  for (const change of ["rename", "revoke", "ambiguity"] as const) {
    const f = await fixture(); await f.owner(async () => { await f.db.update(s.user).set({ name: "Synthetic Named Tutor" }).where(eq(s.user.id, f.identities.multi.id)); });
    const input = csv(), preview = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false });
    expect(preview.tutorMatches).toEqual([{ row: 2, status: "matched" }]);
    if (change === "rename") await f.owner(async () => { await f.db.update(s.user).set({ name: "Synthetic Renamed Tutor" }).where(eq(s.user.id, f.identities.multi.id)); });
    else if (change === "revoke") await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id)); });
    else await tutor(f, "Synthetic Named Tutor");
    const before = await counts(f);
    expect(await f.studentsService.confirmImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false, binding: preview.binding! })).toEqual({ ok: false, code: "stale-revision" });
    expect(await counts(f)).toEqual(before);
  }
}, 60_000);

test("only eligible current-tenant tutors can become pending proposals and ambiguity never selects a grant", async () => {
  const f = await fixture();
  for (const options of [{ tenant: "other" }, { verified: false }, { revoked: true }, { disabled: true }]) await tutor(f, "Synthetic Excluded Tutor", options);
  let input = csv("Synthetic Excluded Tutor"), preview = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false });
  expect(preview.tutorMatches).toEqual([{ row: 2, status: "unmatched" }]);
  await tutor(f, "Synthetic Duplicate Tutor"); await tutor(f, "Synthetic Duplicate Tutor");
  input = csv("Synthetic Duplicate Tutor"); preview = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false });
  expect(preview.tutorMatches).toEqual([{ row: 2, status: "ambiguous" }]);
  const before = await counts(f), mails = f.delivered.length;
  const fetch = vi.fn(async () => { throw new Error("No outbound import request allowed"); }); vi.stubGlobal("fetch", fetch);
  try {
    const saved = await f.studentsService.confirmImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false, binding: preview.binding! }); expect(saved.ok).toBe(true); if (!saved.ok) throw new Error("Synthetic import failed");
    const after = await counts(f); expect(after).toEqual({ ...before, student: before.student + 1, audit_event: before.audit_event + 1 });
    expect(fetch).toHaveBeenCalledTimes(0); expect(f.delivered.length).toBe(mails);
    await f.owner(async () => { const [row] = await f.db.select().from(s.student).where(eq(s.student.id, saved.ids[0])); expect(row.importMetadata?.tutorMatch).toEqual({ status: "ambiguous" }); });
  } finally { vi.unstubAllGlobals(); }
});

test("actor expiry after the first import audit rolls back all students and audits atomically", async () => {
  const f = await fixture(), input = csv("", "ExpiryOne") + "\n" + csv("", "ExpiryTwo").split("\n")[1];
  const preview = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false }), before = await counts(f), original = data.audit;
  vi.spyOn(data, "audit").mockImplementationOnce(async (...args) => { await original(...args); vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30 * 24 * 60 * 60 * 1000); });
  expect(await denied(() => f.studentsService.confirmImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false, binding: preview.binding! }), 401)).toBe(true);
  vi.restoreAllMocks(); expect(await counts(f)).toEqual(before);
});

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
  const f = await fixture(), input = csv(""), preview = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false });
  const saved = await f.studentsService.confirmImport(f.mutation(), { mode: "admin", csv: input, allowDuplicates: false, binding: preview.binding! }); if (!saved.ok) throw new Error("Synthetic import failed"); const id = saved.ids[0];
  await f.owner(async () => {
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
