import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { learnersRouteMethods } from "../../src/server/http/learners";
import { savedRouteMethods } from "../../src/server/http/saved";

// Readings for everyone (plan D5) through the dispatcher: the learner directory, claims and their undo, the learner's own tutor line,
// and the read-only routes a tutor or the rabbi uses to see a learner's shelf. Synthetic @example.test people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "bare" | "second" | "away" | "anonymous";

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  // Names the directory shows; the learner's is an address, which never shows. Three more people: a bare membership (no role), a second
  // tutor, and a tutor of the other congregation.
  const extra = await f.owner(async () => {
    await f.db.update(s.user).set({ name: "Synthetic Rabbi" }).where(eq(s.user.id, f.identities.admin.id));
    await f.db.update(s.user).set({ name: "Synthetic Tutor" }).where(eq(s.user.id, f.identities.multi.id));
    await f.db.update(s.user).set({ name: "learner@example.test" }).where(eq(s.user.id, f.identities.learner.id));
    const people: Record<string, { id: string; cookie: string; membershipId: string; grantId: string | null }> = {};
    for (const [key, email, name, tenant, role] of [["bare", "learners-bare@example.test", "Synthetic Bare", "crc", null], ["second", "learners-second@example.test", "Synthetic Second", "crc", "tutor"], ["away", "learners-away@example.test", "Synthetic Away", "other", "tutor"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic learner identity failed");
      await f.db.update(s.user).set({ name }).where(eq(s.user.id, proof.user.id));
      const [member] = await f.db.insert(s.membership).values({ tenantId: tenant, userId: proof.user.id }).returning();
      const grant = role ? (await f.db.insert(s.roleGrant).values({ tenantId: tenant, membershipId: member.id, role }).returning())[0] : null;
      people[key] = { id: proof.user.id, cookie, membershipId: member.id, grantId: grant?.id ?? null };
    }
    return people;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookie = (who: Who) => who === "anonymous" ? "" : who in extra ? extra[who].cookie : f.identities[who as "admin"].cookie;
  async function call(path: string, who: Who, body?: unknown, headers: Record<string, string> = {}, origin = ORIGIN) {
    const h = new Headers(headers), c = cookie(who);
    if (c && !h.has("cookie")) h.set("cookie", c);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", origin); if (!h.has("content-type")) h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control"), path).toBeNull();
    return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  const save = (who: Who, name: string, date: string | null) => call("/api/saved/readings/create", who, { name, date, kind: "torah", ranges: "Genesis 1:1-3" });
  const claims = () => f.owner(() => f.db.select().from(s.learnerClaim).orderBy(s.learnerClaim.createdAt));
  const audits = (action: string) => f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, action)));
  const links = (studentId: string) => f.owner(() => f.db.select().from(s.tutorStudent).where(and(eq(s.tutorStudent.studentId, studentId))));
  /** Gives the bare membership a student identity on the unrelated student, so a claim on it also writes the tutor link. */
  const linkBare = () => f.owner(async () => {
    const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: extra.bare.membershipId, role: "student" }).returning();
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.students[2].id, roleGrantId: grant.id });
    return grant;
  });
  return { f, extra, dispatch, call, save, claims, audits, links, linkBare };
}
const learnerOf = (list: { json: Record<string, any> }, id: string) => (list.json.learners as { membershipId: string }[]).find(row => row.membershipId === id) as Record<string, unknown> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("Find a learner", () => {
  it("lists every other live membership by name with counts, nearest dates, tutors and student records, never an email; for a live tutor or admin only", async () => {
    const t = await setup();
    await t.save("bare", "Noach", "2026-10-24"); await t.save("bare", "Lech Lecha", "2099-10-31"); await t.save("bare", "Vayera", "2099-11-07");
    await t.save("learner", "Student reading", null);
    const list = await t.call("/api/learners", "multi");
    expect(list.status).toBe(200);
    expect(list.json.learners.map((row: { name: string }) => row.name)).toEqual(["A learner (no name yet)", "Synthetic Bare", "Synthetic Rabbi", "Synthetic Second"]);
    expect(JSON.stringify(list.json)).not.toContain("@");
    expect(learnerOf(list, t.extra.bare.membershipId)).toEqual({ membershipId: t.extra.bare.membershipId, name: "Synthetic Bare", readings: 3, nearest: { name: "Lech Lecha", date: "2099-10-31" }, tutor: null, student: null });
    // The fixture's learner is students[0]'s student, assigned to multi by the rabbi: that tutor shows, unclaimed, and is "mine" to multi.
    expect(learnerOf(list, t.f.learnerMember.id)).toEqual({ membershipId: t.f.learnerMember.id, name: "A learner (no name yet)", readings: 1, nearest: null, tutor: { name: "Synthetic Tutor", claimed: false, mine: true },
      student: { id: t.f.students[0].id, firstName: "Synthetic", lastName: "Sibling A", ceremonyDate: "2027-01-02" } });
    expect(learnerOf(await t.call("/api/learners", "second"), t.f.learnerMember.id)).toMatchObject({ tutor: { name: "Synthetic Tutor", claimed: false, mine: false } });
    // The rabbi lists too (never "mine": an admin without a tutor grant claims nothing); the prefix search is case-insensitive; the cursor continues.
    expect((await t.call("/api/learners", "admin")).json.learners.map((row: { name: string }) => row.name)).toEqual(["A learner (no name yet)", "Synthetic Bare", "Synthetic Second", "Synthetic Tutor"]);
    expect((await t.call("/api/learners?q=synthetic%20b", "multi")).json.learners.map((row: { name: string }) => row.name)).toEqual(["Synthetic Bare"]);
    expect((await t.call("/api/learners?q=%25", "multi")).json.learners).toEqual([]);
    expect((await t.call(`/api/learners?after=${t.extra.bare.membershipId}`, "multi")).json.learners.map((row: { name: string }) => row.name)).toEqual(["Synthetic Rabbi", "Synthetic Second"]);
    expect((await t.call(`/api/learners?after=${randomUUID()}`, "multi")).json.learners).toEqual([]);
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["learner", 404], ["bare", 404], ["away", 403]] as const) expect((await t.call("/api/learners", who)).status, who).toBe(status);
    for (const query of ["q=" + "x".repeat(81), "q=a%0ab", "after=nope", "limit=5"]) expect((await t.call(`/api/learners?${query}`, "multi")).status, query).toBe(400);
    expect((await t.call("/api/learners", "multi", undefined, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    // The other congregation's tutor sees that congregation's people only.
    expect((await t.call("/api/learners", "away", undefined, {}, "http://localhost:3101")).json.learners.map((row: { name: string }) => row.name)).toEqual(["Synthetic Tutor"]);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)));
    expect((await t.call("/api/learners", "multi")).status).toBe(404);
  });
});

describe("Add to my students and its undo", () => {
  it("claims a member with no student record: a claim row, no tutor link, an audit in the tutor's own mode; one tutor at a time; idempotent", async () => {
    const t = await setup();
    const claimed = await t.call("/api/learners/claim", "second", { learner: t.extra.bare.membershipId });
    expect(claimed).toEqual({ status: 200, json: { ok: true, learner: t.extra.bare.membershipId, created: true } });
    const [claim] = await t.claims();
    expect(claim).toMatchObject({ tenantId: "crc", learnerMembershipId: t.extra.bare.membershipId, tutorGrantId: t.extra.second.grantId, tutorLinkId: null, revokedAt: null, revokedBy: null });
    expect((await t.audits("learner.claim")).map(row => [row.mode, row.roleGrantId, row.actorMembershipId, row.targetType, row.targetId])).toEqual([["tutor", t.extra.second.grantId, t.extra.second.membershipId, "learner_claim", claim.id]]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.tutorStudent)).length)).toBe(1);
    // The learner sees the tutor, undoable; the directory shows the claim.
    expect((await t.call("/api/mine/tutor", "bare")).json).toEqual({ ok: true, tutor: { name: "Synthetic Second", claimed: true } });
    expect(learnerOf(await t.call("/api/learners", "second"), t.extra.bare.membershipId)).toMatchObject({ tutor: { name: "Synthetic Second", claimed: true, mine: true } });
    expect(learnerOf(await t.call("/api/learners", "multi"), t.extra.bare.membershipId)).toMatchObject({ tutor: { name: "Synthetic Second", claimed: true, mine: false } });
    // A second tutor is refused; the same tutor again changes nothing.
    expect(await t.call("/api/learners/claim", "multi", { learner: t.extra.bare.membershipId })).toEqual({ status: 409, json: { ok: false, code: "has-tutor" } });
    expect((await t.call("/api/learners/claim", "second", { learner: t.extra.bare.membershipId })).json).toEqual({ ok: true, learner: t.extra.bare.membershipId, created: false });
    expect(await t.claims()).toHaveLength(1);
    expect(await t.audits("learner.claim")).toHaveLength(1);
    // Claiming someone the rabbi already assigned to this tutor changes nothing either; another tutor is refused.
    expect((await t.call("/api/learners/claim", "multi", { learner: t.f.learnerMember.id })).json).toEqual({ ok: true, learner: t.f.learnerMember.id, created: false });
    expect((await t.call("/api/learners/claim", "second", { learner: t.f.learnerMember.id })).status).toBe(409);
    expect(await t.claims()).toHaveLength(1);
  });

  it("claims a linked student with the tutor link as well, so the staff tools see the tutor; the learner's undo ends both and the tutor's read is 404 while the learner's own list still works", async () => {
    const t = await setup();
    await t.linkBare();
    await t.save("bare", "Mine", "2026-10-24");
    const claimed = await t.call("/api/learners/claim", "second", { learner: t.extra.bare.membershipId });
    expect(claimed.json).toMatchObject({ ok: true, created: true });
    const [claim] = await t.claims(), [link] = await t.links(t.f.students[2].id);
    expect(claim.tutorLinkId).toBe(link.id); expect(link).toMatchObject({ tutorGrantId: t.extra.second.grantId, revokedAt: null });
    expect((await t.audits("tutor.assign")).map(row => [row.mode, row.roleGrantId, row.targetId])).toEqual([["tutor", t.extra.second.grantId, link.id]]);
    const inspect = await t.call(`/api/admin/students/${t.f.students[2].id}/relationships`, "admin");
    expect(inspect.json.tutors.map((row: { id: string; displayName: string }) => [row.id, row.displayName])).toEqual([[link.id, "Synthetic Second"]]);
    expect(learnerOf(await t.call("/api/learners", "second"), t.extra.bare.membershipId)).toMatchObject({ tutor: { claimed: true, mine: true }, student: { id: t.f.students[2].id } });
    // The tutor reads the learner's shelf; the learner undoes the claim (review focus 2).
    const reading = (await t.call(`/api/saved/learner/readings?learner=${t.extra.bare.membershipId}`, "second")).json.readings[0];
    expect(reading.name).toBe("Mine");
    expect((await t.call(`/api/saved/learner/reading?learner=${t.extra.bare.membershipId}&id=${reading.id}`, "second")).status).toBe(200);
    expect((await t.call("/api/mine/tutor/remove", "bare", {})).json).toEqual({ ok: true });
    expect((await t.claims())[0]).toMatchObject({ revokedBy: "learner", revokedByMembershipId: t.extra.bare.membershipId });
    expect((await t.claims())[0].revokedAt).not.toBeNull();
    expect((await t.links(t.f.students[2].id))[0].revokedAt).not.toBeNull();
    expect((await t.audits("learner.unclaim")).map(row => [row.mode, row.actorMembershipId, row.targetId])).toEqual([["student", t.extra.bare.membershipId, claim.id]]);
    // The link's end is audited too, under the learner's own grant, in the learner's own mode.
    expect((await t.audits("tutor.revoke")).map(row => [row.mode, row.actorMembershipId, row.targetType, row.targetId, row.actingStudentId])).toEqual([["student", t.extra.bare.membershipId, "tutor_student", link.id, t.f.students[2].id]]);
    expect((await t.call(`/api/saved/learner/readings?learner=${t.extra.bare.membershipId}`, "second")).status).toBe(404);
    expect((await t.call(`/api/saved/learner/reading?learner=${t.extra.bare.membershipId}&id=${reading.id}`, "second")).status).toBe(404);
    expect((await t.call(`/api/saved/learner/page?learner=${t.extra.bare.membershipId}&id=${reading.id}&offset=0`, "second")).status).toBe(404);
    expect((await t.call("/api/saved/readings", "bare")).json.readings.map((row: { name: string }) => row.name)).toEqual(["Mine"]);
    expect((await t.call(`/api/saved/reading?id=${reading.id}`, "bare")).status).toBe(200);
    expect((await t.call("/api/mine/tutor", "bare")).json).toEqual({ ok: true, tutor: null });
    expect((await t.call(`/api/admin/students/${t.f.students[2].id}/relationships`, "admin")).json.tutors).toEqual([]);
    // Nothing left to undo: 404. A rabbi's assignment is not a claim: 409, and the tutor line stays.
    expect((await t.call("/api/mine/tutor/remove", "bare", {})).status).toBe(404);
    expect((await t.call("/api/mine/tutor", "learner")).json).toEqual({ ok: true, tutor: { name: "Synthetic Tutor", claimed: false } });
    expect(await t.call("/api/mine/tutor/remove", "learner", {})).toEqual({ status: 409, json: { ok: false, code: "assigned" } });
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.tutorStudent).where(eq(s.tutorStudent.id, t.f.tutorLink.id)))[0].revokedAt)).toBeNull();
  });

  it("lets the claiming tutor or an admin remove a claim, not another tutor; an admin's revoke of the link on the access page ends the claim too", async () => {
    const t = await setup();
    const claim = () => t.call("/api/learners/claim", "second", { learner: t.extra.bare.membershipId });
    expect((await claim()).status).toBe(200);
    expect((await t.call("/api/learners/unclaim", "multi", { learner: t.extra.bare.membershipId })).status).toBe(404);
    expect((await t.call("/api/learners/unclaim", "admin", { learner: t.extra.bare.membershipId })).json).toEqual({ ok: true, learner: t.extra.bare.membershipId });
    expect((await t.claims()).at(-1)).toMatchObject({ revokedBy: "admin", revokedByMembershipId: t.f.adminMember.id });
    expect((await t.audits("learner.unclaim")).map(row => [row.mode, row.roleGrantId])).toEqual([["admin", t.f.adminGrant.id]]);
    expect((await claim()).json.created).toBe(true);
    expect((await t.call("/api/learners/unclaim", "second", { learner: t.extra.bare.membershipId })).json).toEqual({ ok: true, learner: t.extra.bare.membershipId });
    expect((await t.claims()).at(-1)).toMatchObject({ revokedBy: "tutor", revokedByMembershipId: t.extra.second.membershipId });
    expect((await t.call("/api/learners/unclaim", "second", { learner: t.extra.bare.membershipId })).status).toBe(404);
    // With a student record: the admin revokes the tutor link on the access page; the claim that made it ends, audited in admin mode.
    await t.linkBare();
    expect((await claim()).json.created).toBe(true);
    const [link] = await t.links(t.f.students[2].id);
    expect((await t.call(`/api/admin/students/${t.f.students[2].id}/relationships/tutors/${link.id}/revoke`, "admin", { expectedState: "active" })).status).toBe(200);
    expect((await t.claims()).at(-1)).toMatchObject({ tutorLinkId: link.id, revokedBy: "admin", revokedByMembershipId: t.f.adminMember.id });
    expect((await t.audits("learner.unclaim")).map(row => row.mode)).toEqual(["admin", "tutor", "admin"]);
    expect((await t.call("/api/mine/tutor", "bare")).json).toEqual({ ok: true, tutor: null });
    // Claimed again, the tutor's own removal ends the link through the one tutor-revocation write, audited as the tutor's.
    expect((await claim()).json.created).toBe(true);
    expect((await t.call("/api/learners/unclaim", "second", { learner: t.extra.bare.membershipId })).status).toBe(200);
    expect((await t.links(t.f.students[2].id)).map(row => row.revokedAt === null)).toEqual([false, false]);
    expect((await t.audits("tutor.revoke")).map(row => row.mode)).toEqual(["admin", "tutor"]);
  });

  it("revoking a tutor's grant on the access page ends the claims it holds, as the admin's act: the learner's tutor is gone and another tutor may claim", async () => {
    const t = await setup();
    expect((await t.call("/api/learners/claim", "second", { learner: t.extra.bare.membershipId })).json.created).toBe(true);
    expect((await t.call("/api/mine/tutor", "bare")).json.tutor).toEqual({ name: "Synthetic Second", claimed: true });
    expect((await t.call(`/api/admin/grants/${t.extra.second.grantId}/revoke`, "admin", { expectedRevision: 1, expectedState: "active" })).status).toBe(200);
    expect((await t.claims())[0]).toMatchObject({ revokedBy: "admin", revokedByMembershipId: t.f.adminMember.id });
    expect((await t.claims())[0].revokedAt).not.toBeNull();
    expect((await t.audits("learner.unclaim")).map(row => [row.mode, row.roleGrantId, row.actorMembershipId])).toEqual([["admin", t.f.adminGrant.id, t.f.adminMember.id]]);
    expect((await t.call("/api/mine/tutor", "bare")).json).toEqual({ ok: true, tutor: null });
    expect(learnerOf(await t.call("/api/learners", "multi"), t.extra.bare.membershipId)).toMatchObject({ tutor: null });
    expect((await t.call("/api/learners/claim", "multi", { learner: t.extra.bare.membershipId })).json).toEqual({ ok: true, learner: t.extra.bare.membershipId, created: true });
    // Belt and braces: a live claim row whose grant is revoked behind the service's back counts for nothing either.
    await t.f.owner(() => t.f.db.update(s.learnerClaim).set({ revokedAt: new Date(), revokedBy: "admin", revokedByMembershipId: t.f.adminMember.id }).where(eq(s.learnerClaim.tutorGrantId, t.f.tutorGrant.id)));
    const [regrant] = await t.f.owner(() => t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.extra.second.membershipId, role: "tutor" }).returning());
    await t.f.owner(() => t.f.db.insert(s.learnerClaim).values({ tenantId: "crc", learnerMembershipId: t.extra.bare.membershipId, tutorGrantId: regrant.id }));
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, regrant.id)));
    expect((await t.call("/api/mine/tutor", "bare")).json).toEqual({ ok: true, tutor: null });
    expect(learnerOf(await t.call("/api/learners", "multi"), t.extra.bare.membershipId)).toMatchObject({ tutor: null });
    expect((await t.call(`/api/saved/learner/readings?learner=${t.extra.bare.membershipId}`, "second")).status).toBe(404);
  });

  it("refuses a claim by anyone without a live tutor grant, on oneself, on a disabled, missing or other-congregation membership, and without the exact Origin", async () => {
    const t = await setup();
    const body = { learner: t.extra.bare.membershipId };
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["learner", 403], ["bare", 403], ["admin", 403], ["away", 403]] as const) expect((await t.call("/api/learners/claim", who, body)).status, who).toBe(status);
    for (const headers of [{ origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }] as Record<string, string>[]) expect((await t.call("/api/learners/claim", "second", body, headers)).status).toBe(403);
    for (const bad of [{}, { learner: "nope" }, { learner: t.extra.bare.membershipId, extra: 1 }, { learner: 4 }]) expect((await t.call("/api/learners/claim", "second", bad)).status, JSON.stringify(bad)).toBe(400);
    for (const learner of [t.extra.second.membershipId, t.extra.away.membershipId, randomUUID(), t.f.students[0].id]) expect((await t.call("/api/learners/claim", "second", { learner })).status, learner).toBe(404);
    // The other congregation's tutor, through its own host, cannot claim this congregation's person.
    expect([403, 404]).toContain((await t.call("/api/learners/claim", "away", body, {}, "http://localhost:3101")).status);
    await t.f.owner(() => t.f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, t.extra.bare.membershipId)));
    expect((await t.call("/api/learners/claim", "second", body)).status).toBe(404);
    await t.f.owner(() => t.f.db.update(s.membership).set({ disabledAt: null }).where(eq(s.membership.id, t.extra.bare.membershipId)));
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.extra.second.grantId!)));
    expect((await t.call("/api/learners/claim", "second", body)).status).toBe(403);
    expect(await t.claims()).toEqual([]);
    // Two tutors at once: exactly one holds the claim.
    const [grant] = await t.f.owner(() => t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.extra.second.membershipId, role: "tutor" }).returning());
    expect(grant.id).not.toBe(t.extra.second.grantId);
    const results = await Promise.all([t.call("/api/learners/claim", "second", body), t.call("/api/learners/claim", "multi", body)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await t.claims()).filter(row => row.revokedAt === null)).toHaveLength(1);
  });

  it("registers its routes with their methods, refuses others and unknown query keys, and serves everything private", async () => {
    const t = await setup();
    expect(learnersRouteMethods("/api/learners")).toEqual(["GET"]); expect(learnersRouteMethods("/api/learners/claim")).toEqual(["POST"]); expect(learnersRouteMethods("/api/learners/unclaim")).toEqual(["POST"]);
    expect(learnersRouteMethods("/api/mine/tutor")).toEqual(["GET"]); expect(learnersRouteMethods("/api/mine/tutor/remove")).toEqual(["POST"]); expect(learnersRouteMethods("/api/mine")).toBeNull();
    for (const path of ["/api/saved/learner/readings", "/api/saved/learner/reading", "/api/saved/learner/page"]) expect(savedRouteMethods(path)).toEqual(["GET"]);
    for (const path of ["/api/learners/claim", "/api/learners/unclaim", "/api/mine/tutor/remove"]) expect((await t.dispatch(new Request(`${ORIGIN}${path}`, { headers: { cookie: t.extra.second.cookie } }))).status, path).toBe(405);
    for (const path of ["/api/learners", "/api/mine/tutor", "/api/saved/learner/readings?learner=" + t.extra.bare.membershipId]) expect((await t.call(path, "second", { learner: t.extra.bare.membershipId })).status, path).toBe(405);
    expect((await t.call("/api/mine/tutor?mode=student", "learner")).status).toBe(400);
    expect((await t.call("/api/mine/tutor/remove", "learner", { learner: t.extra.bare.membershipId })).status).toBe(400);
    expect((await t.call(`/api/saved/learner/readings?learner=${t.extra.bare.membershipId}&mode=tutor`, "second")).status).toBe(400);
    expect((await t.call("/api/saved/learner/readings?learner=nope", "second")).status).toBe(400);
    expect((await t.call("/api/saved/learner/readings", "second")).status).toBe(400);
    for (const who of ["anonymous", "recipient", "learner", "second", "admin"] as const) {
      for (const path of ["/api/learners", "/api/mine/tutor", `/api/saved/learner/readings?learner=${t.extra.bare.membershipId}`]) await t.call(path, who);
      for (const path of ["/api/learners/claim", "/api/learners/unclaim", "/api/mine/tutor/remove"]) await t.call(path, who, { bad: true });
    }
  });
});
