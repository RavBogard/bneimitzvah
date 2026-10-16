import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPortalService } from "../../src/server/portal/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { createStudentService } from "../../src/server/students/service";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import type { Snapshot } from "../../src/lib/readings/proposals";
import { AccessDenied } from "../../src/server/access/errors";
import type { CookieMutationRequest } from "../../src/server/http/mutations";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });
async function fixture() {
  const f = await accessFixture(); open.push(f);
  let recipient!: { id: string; cookie: string; sessionId: string };
  await f.owner(async () => {
    const { cookie } = await f.signIn("portal-recipient@example.test");
    const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
    if (!proof) throw new Error("Synthetic portal recipient failed");
    recipient = { id: proof.user.id, cookie, sessionId: proof.session.id };
  });
  const identities = { ...f.identities, recipient };
  function http(who: keyof typeof identities = "multi", handle?: string, options: { origin?: string; method?: string; cookie?: string } = {}): CookieMutationRequest {
    const origin = options.origin ?? "http://localhost:3000";
    return { url: `${origin}/portal`, method: options.method ?? "GET", headers: new Headers({ origin, cookie: options.cookie ?? identities[who].cookie,
      ...(handle === undefined ? {} : { "X-Practice-Context": handle }) }) };
  }
  const practice = createPracticeService({ access: f.service });
  const portal = createPortalService({ access: f.service, practice, sessionBindingSecret: randomBytes(48).toString("base64url") });
  const deliveries: { url: string }[] = [];
  const invitations = createInvitationService({ db: f.db, access: f.service, throttleSecret: randomBytes(48).toString("base64url"),
    transport: async message => { deliveries.push({ url: message.url }); } });
  const studentsService = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"),
    loadReading: async (date, calendar) => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar,
      reading: { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:31-2:2" }], triennial: null },
      haftarah: "Isaiah 1:1-2" } satisfies Snapshot }) });
  async function confirm(kind: "torah" | "haftarah", ranges: string[]) {
    const request = http("admin", undefined, { method: "POST" });
    const prepared = await studentsService.prepareReading(request, { mode: "admin", studentId: f.students[0].id, kind, ranges });
    if (prepared.status !== "prepared") throw new Error("Synthetic reading preparation failed");
    const result = await studentsService.confirmReading(request, { mode: "admin", studentId: f.students[0].id, binding: prepared.binding });
    if (!result.ok) throw new Error("Synthetic reading confirmation failed");
    return result;
  }
  async function issue(studentId = f.students[0].id, email = "portal-recipient@example.test", role: "parent" | "student" = "parent") {
    const issued = await invitations.issue(http("admin", undefined, { method: "POST" }), { mode: "admin", role, studentId, email });
    const token = new URLSearchParams(new URL(deliveries.at(-1)!.url).hash.slice(1)).get("token");
    if (!token || issued.delivery !== "sent") throw new Error("Synthetic invitation missing");
    return { ...issued, token };
  }
  return { ...f, identities, http, practice, portal, invitations, studentsService, confirm, issue };
}
async function denied(action: () => Promise<unknown>, status = 404) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}

describe("private portal read DTOs and recipient invitation review", () => {
  it("summarizes active tenant roles without identity secrets, default mode or implicit membership", async () => {
    const f = await fixture();
    expect(await denied(() => f.portal.sessionSummary(f.http("multi", undefined, { cookie: "" })), 401)).toBe(true);
    const empty = await f.portal.sessionSummary(f.http("recipient"));
    expect(!empty.membershipAvailable && empty.roles.length === 0 && Object.keys(empty).sort().join() === "membershipAvailable,roles,sessionBinding").toBe(true);
    const summary = await f.portal.sessionSummary(f.http());
    expect(summary.membershipAvailable && summary.roles.join() === "parent,tutor" && !JSON.stringify(summary).includes("@")).toBe(true);
    const other = await f.portal.sessionSummary(f.http("multi", undefined, { origin: "http://localhost:3101" }));
    expect(other.membershipAvailable && other.roles.join() === "student").toBe(true);
    for (const handle of ["", randomBytes(32).toString("base64url")]) expect(await denied(() => f.portal.sessionSummary(f.http("multi", handle)), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.tutorGrant.id)); });
    expect((await f.portal.sessionSummary(f.http())).roles.join() === "parent").toBe(true);
    await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.multiMember.id)); });
    expect(await denied(() => f.portal.sessionSummary(f.http()), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.recipient.id)); });
    expect(await denied(() => f.portal.sessionSummary(f.http("recipient")), 403)).toBe(true);
  });

  it("returns confirmed readings for each explicit authorized base mode and honest empty assignments", async () => {
    const f = await fixture(); await f.confirm("torah", ["Genesis 1:31-2:2"]);
    for (const [who, mode] of [["admin", "admin"], ["multi", "parent"], ["multi", "tutor"], ["learner", "student"]] as const) {
      const result = await f.portal.assignedReading(f.http(who), { mode, studentId: f.students[0].id });
      expect(result.mode === mode && result.context === null && result.readings.length === 1 && result.readings[0].verses.join() === "Genesis 1:31,Genesis 2:1,Genesis 2:2").toBe(true);
    }
    expect((await f.portal.assignedReading(f.http(), { mode: "parent", studentId: f.students[1].id })).readings.length === 0).toBe(true);
    for (const studentId of [f.students[2].id, f.students[3].id, crypto.randomUUID()]) expect(await denied(() => f.portal.assignedReading(f.http(), { mode: "parent", studentId }))).toBe(true);
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id)); });
    expect(await denied(() => f.portal.assignedReading(f.http(), { mode: "parent", studentId: f.students[0].id }))).toBe(true);
  });

  it("whitelists source metadata and preserves deterministic kind/verse order without leaking opaque snapshots", async () => {
    const f = await fixture();
    await f.confirm("haftarah", ["Isaiah 1:1-2"]); const confirmed = await f.confirm("torah", ["Genesis 1:31-2:2"]);
    const sentinel = "PRIVATE_SENTINEL_MUST_NOT_LEAVE_DATABASE";
    await f.owner(async () => {
      const [row] = await f.db.select().from(s.assignment).where(eq(s.assignment.id, confirmed.assignmentId));
      await f.db.update(s.assignment).set({ proposalSnapshot: { ...row.proposalSnapshot, private: sentinel, email: "hidden@example.test",
        source: { ...(row.proposalSnapshot!.source as object), private: sentinel, rawLicensedText: sentinel } } }).where(eq(s.assignment.id, row.id));
      const verses = await f.db.select().from(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, row.id));
      await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, row.id));
      await f.db.insert(s.assignmentVerse).values(verses.reverse()); // Reverse physical INSERT order, retain true ordinal.
    });
    const result = await f.portal.assignedReading(f.http(), { mode: "parent", studentId: f.students[0].id });
    const [torah, haftarah] = result.readings;
    expect(result.readings.length === 2 && torah.kind === "torah" && haftarah.kind === "haftarah" && torah.verses.join() === "Genesis 1:31,Genesis 2:1,Genesis 2:2").toBe(true);
    expect(torah.revision === 1 && torah.confirmationDate === "2027-01-02" && !torah.needsReview && torah.source.status === "available"
      && torah.source.calendar === "diaspora" && torah.source.date === "2027-01-02" && torah.source.attribution?.name === "Hebcal" && typeof torah.source.fetchedAt === "number").toBe(true);
    const serialized = JSON.stringify(result);
    expect(!serialized.includes(sentinel) && !serialized.includes("@") && !serialized.includes(f.identities.multi.sessionId)
      && !serialized.includes(f.adminMember.id) && !serialized.includes(f.parentGrant.id) && !serialized.includes("setByMembershipId") && !serialized.includes("proposalSnapshot")).toBe(true);
  });

  it("preserves confirmed old references and source date while marking a changed ceremony date for review", async () => {
    const f = await fixture(); await f.confirm("torah", ["Genesis 1:31-2:2"]);
    const current = f.students[0];
    const edited = await f.studentsService.edit(f.http("admin", undefined, { method: "POST" }), { mode: "admin", studentId: current.id, expectedRevision: 1,
      student: { firstName: current.firstName, lastName: current.lastName, ceremonyDate: "2027-01-09", parentEmail: current.parentEmail } });
    expect(edited.ok && edited.readingNeedsReview).toBe(true);
    const result = await f.portal.assignedReading(f.http(), { mode: "parent", studentId: current.id });
    expect(result.student.ceremonyDate === "2027-01-09" && result.student.revision === 2 && result.readings.length === 1
      && result.readings[0].revision === 2 && result.readings[0].needsReview && result.readings[0].confirmationDate === "2027-01-02"
      && result.readings[0].source.date === "2027-01-02" && result.readings[0].verses.join() === "Genesis 1:31,Genesis 2:1,Genesis 2:2").toBe(true);
  });

  it("reports absent provenance as unknown and omits proposed and unsupported reading kinds", async () => {
    const f = await fixture(); const confirmed = await f.confirm("torah", ["Genesis 1:1"]);
    await f.owner(async () => {
      await f.db.update(s.assignment).set({ proposalSnapshot: null }).where(eq(s.assignment.id, confirmed.assignmentId));
      await f.db.insert(s.assignment).values([{ tenantId: "crc", studentId: f.students[0].id, kind: "haftarah", basis: "custom", ref: "Isaiah 1:1", status: "proposed", setByMembershipId: f.adminMember.id },
        { tenantId: "crc", studentId: f.students[0].id, kind: "blessing-before", basis: "custom", ref: "Synthetic liturgy", status: "confirmed", setByMembershipId: f.adminMember.id }]);
    });
    const result = await f.portal.assignedReading(f.http(), { mode: "parent", studentId: f.students[0].id });
    expect(result.readings.length === 1 && result.readings[0].source.status === "unknown" && result.readings[0].source.fetchedAt === null
      && result.readings[0].source.calendar === null && result.readings[0].source.date === null && result.readings[0].source.attribution === null
      && result.readings[0].confirmationDate === null && result.readings[0].needsReview).toBe(true);
  });

  it("uses live child context authorization without exposing the handle or crossing to another child", async () => {
    const f = await fixture(); await f.confirm("torah", ["Genesis 1:1"]);
    const entered = await f.practice.enter(f.http("multi", undefined, { method: "POST" }), { studentId: f.students[0].id });
    const result = await f.portal.assignedReading(f.http("multi", entered.handle), { mode: "child-practice", studentId: f.students[0].id });
    expect(result.context?.id === entered.context.id && result.context.authorityRevision === f.multiMember.authorityRevision && !JSON.stringify(result).includes(entered.handle)).toBe(true);
    expect(await denied(() => f.portal.assignedReading(f.http("multi", entered.handle), { mode: "child-practice", studentId: f.students[1].id }))).toBe(true);
    expect(await denied(() => f.portal.assignedReading(f.http("multi", entered.handle), { mode: "tutor", studentId: f.students[0].id }), 403)).toBe(true);
    await f.practice.switch(f.http("multi", entered.handle, { method: "POST" }), { studentId: f.students[1].id });
    expect(await denied(() => f.portal.assignedReading(f.http("multi", entered.handle), { mode: "child-practice", studentId: f.students[0].id }))).toBe(true);
  });

  it("previews only a verified matching recipient and grants/consumes/audits nothing on GET", async () => {
    const f = await fixture(); const issued = await f.issue();
    let before = "";
    await f.owner(async () => { before = JSON.stringify({ members: await f.db.select().from(s.membership), grants: await f.db.select().from(s.roleGrant), links: await f.db.select().from(s.guardian), invites: await f.db.select().from(s.invite), audit: await f.db.select().from(s.auditEvent) }); });
    expect(await denied(() => f.invitations.preview(f.http("recipient", undefined, { cookie: "" }), { token: issued.token }), 401)).toBe(true);
    expect(await denied(() => f.invitations.preview(f.http("multi"), { token: issued.token }))).toBe(true);
    expect(await denied(() => f.invitations.preview(f.http("recipient", undefined, { origin: "http://localhost:3101" }), { token: issued.token }))).toBe(true);
    expect(await denied(() => f.invitations.preview(f.http("recipient", ""), { token: issued.token }), 403)).toBe(true);
    const preview = await f.invitations.preview(f.http("recipient"), { token: issued.token });
    expect(preview.role === "parent" && preview.student?.firstName === f.students[0].firstName && preview.student.lastName === f.students[0].lastName && preview.requiresConfirmation).toBe(true);
    expect(/^[0-9]+\.[A-Za-z0-9_-]{43}$/.test(preview.reviewBinding) && !JSON.stringify(preview).includes(issued.token) && !JSON.stringify(preview).includes("@")
      && !JSON.stringify(preview).includes(f.identities.recipient.id) && !JSON.stringify(preview).includes(f.identities.recipient.sessionId)).toBe(true);
    await f.invitations.preview(f.http("recipient"), { token: issued.token });
    await f.owner(async () => { expect(before === JSON.stringify({ members: await f.db.select().from(s.membership), grants: await f.db.select().from(s.roleGrant), links: await f.db.select().from(s.guardian), invites: await f.db.select().from(s.invite), audit: await f.db.select().from(s.auditEvent) })).toBe(true); });
    expect(!(await f.portal.sessionSummary(f.http("recipient"))).membershipAvailable).toBe(true);
  });

  it("rechecks late revoke, target disable, unverified recipient and exact invitation expiry", async () => {
    const f = await fixture(); const issued = await f.issue(), expiring = await f.issue(f.students[1].id);
    const preview = await f.invitations.preview(f.http("recipient"), { token: issued.token });
    await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[0].id)); });
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: issued.token }))).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: issued.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: null }).where(eq(s.student.id, f.students[0].id)); });
    await f.invitations.revoke(f.http("admin", undefined, { method: "POST" }), { mode: "admin", inviteId: issued.inviteId });
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: issued.token }))).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: issued.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.recipient.id)); });
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: expiring.token }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.recipient.id)); });
    const pending = await f.invitations.preview(f.http("recipient"), { token: expiring.token });
    vi.setSystemTime(new Date(pending.expiresAt));
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: expiring.token }))).toBe(true);
  });

  it("denies old pending guardian invites after unlink but previews and accepts a fresh explicit reinvite", async () => {
    const f = await fixture(); const old = await f.issue(f.students[0].id, "multi@example.test");
    const initial = await f.invitations.preview(f.http(), { token: old.token });
    expect(initial.student?.lastName === f.students[0].lastName).toBe(true);
    const revokedAt = new Date(Date.now() + 100);
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt }).where(eq(s.guardian.id, f.guardians[0].id)); });
    expect(await denied(() => f.invitations.preview(f.http(), { token: old.token }))).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(f.http("multi", undefined, { method: "POST" }), { token: old.token, reviewBinding: initial.reviewBinding }))).toBe(true);
    vi.setSystemTime(new Date(revokedAt.getTime() + 1000));
    const fresh = await f.issue(f.students[0].id, "multi@example.test");
    const preview = await f.invitations.preview(f.http(), { token: fresh.token });
    expect((await f.invitations.acceptReviewed(f.http("multi", undefined, { method: "POST" }), { token: fresh.token, reviewBinding: preview.reviewBinding })).studentId === f.students[0].id).toBe(true);
  });

  it("denies an occupied identity target even without a recipient grant, allowing a fresh invite after explicit unlink", async () => {
    const f = await fixture(); const old = await f.issue(f.students[0].id, "portal-recipient@example.test", "student");
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: old.token }))).toBe(true);
    const revokedAt = new Date(Date.now() + 100);
    await f.owner(async () => { await f.db.update(s.studentIdentity).set({ revokedAt }).where(eq(s.studentIdentity.id, f.learnerLink.id)); });
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: old.token }))).toBe(true);
    expect(!(await f.portal.sessionSummary(f.http("recipient"))).membershipAvailable).toBe(true);
    vi.setSystemTime(new Date(revokedAt.getTime() + 1000));
    const fresh = await f.issue(f.students[0].id, "portal-recipient@example.test", "student");
    const preview = await f.invitations.preview(f.http("recipient"), { token: fresh.token });
    expect((await f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: fresh.token, reviewBinding: preview.reviewBinding })).role === "student").toBe(true);
  });

  it("binds reviewed acceptance to the exact pending token, session and opaque untampered review", async () => {
    const f = await fixture(); const first = await f.issue(), sibling = await f.issue(f.students[1].id);
    const preview = await f.invitations.preview(f.http("recipient"), { token: first.token });
    const request = f.http("recipient", undefined, { method: "POST" });
    expect(await denied(() => f.invitations.acceptReviewed(request, { token: sibling.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    const [expiry, mac] = preview.reviewBinding.split(".");
    const tampered = `${expiry}.${mac[0] === "A" ? "B" : "A"}${mac.slice(1)}`;
    expect(await denied(() => f.invitations.acceptReviewed(request, { token: first.token, reviewBinding: tampered }))).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(request, { token: first.token, reviewBinding: "" }))).toBe(true);
    await f.owner(async () => { await f.db.insert(s.tenantHost).values({ host: "localhost:3002", tenantId: "crc", environment: "test", deployment: "suite", origin: "http://localhost:3002" }); });
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST", origin: "http://localhost:3002" }), { token: first.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    let newCookie = "";
    await f.owner(async () => { newCookie = (await f.signIn("portal-recipient@example.test")).cookie; });
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST", cookie: newCookie }), { token: first.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    const accepted = await f.invitations.acceptReviewed(request, { token: first.token, reviewBinding: preview.reviewBinding });
    expect(accepted.role === "parent" && accepted.studentId === f.students[0].id).toBe(true);
    expect(await denied(() => f.invitations.preview(f.http("recipient"), { token: first.token }))).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(request, { token: first.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    await f.owner(async () => { expect((await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "invite.accept"))).length === 1).toBe(true); });
  });

  it("clips review lifetime to the current locked session expiry", async () => {
    const f = await fixture(); const issued = await f.issue();
    const expiresAt = new Date(Date.now() + 60_000);
    await f.owner(async () => { await f.db.update(s.session).set({ expiresAt }).where(eq(s.session.id, f.identities.recipient.sessionId)); });
    const preview = await f.invitations.preview(f.http("recipient"), { token: issued.token });
    expect(Number(preview.reviewBinding.split(".")[0]) === expiresAt.getTime()).toBe(true);
    expect((await f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: issued.token, reviewBinding: preview.reviewBinding })).studentId === f.students[0].id).toBe(true);
  });

  it("expires review after five minutes and never consumes on a GET acceptance attempt", async () => {
    const f = await fixture(); const issued = await f.issue();
    const preview = await f.invitations.preview(f.http("recipient"), { token: issued.token });
    expect(Number(preview.reviewBinding.split(".")[0]) <= Date.now() + 5 * 60_000).toBe(true);
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient"), { token: issued.token, reviewBinding: preview.reviewBinding }), 403)).toBe(true);
    vi.setSystemTime(new Date(Number(preview.reviewBinding.split(".")[0])));
    expect(await denied(() => f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: issued.token, reviewBinding: preview.reviewBinding }))).toBe(true);
    const fresh = await f.invitations.preview(f.http("recipient"), { token: issued.token });
    expect((await f.invitations.acceptReviewed(f.http("recipient", undefined, { method: "POST" }), { token: issued.token, reviewBinding: fresh.reviewBinding })).studentId === f.students[0].id).toBe(true);
  });
});
