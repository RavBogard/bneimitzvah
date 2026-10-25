import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { VERSE_REVIEW_SCHEMA } from "../../src/lib/learn/verse-review";

// 1.9 N19: a student's own verse cards through /api/learn/verses*. Synthetic people only. Nobody but the student reads them:
// not another student, not the student's parent or tutor (the fixture's "multi" is both), not an admin, not a Member.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "sibling" | "revoked" | "member" | "anonymous";
const doc = (cards: Record<string, [number, string]> = {}) => ({ schema: VERSE_REVIEW_SCHEMA, cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) });

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const extra = await f.owner(async () => {
    const people: Record<string, { cookie: string }> = {};
    const identity = async (email: string) => {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic verse identity failed");
      return { cookie, userId: proof.user.id };
    };
    // Another student: the learner's synthetic sibling, signed in as themself.
    const sibling = await identity("verse-sibling@example.test");
    const [siblingMember] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: sibling.userId }).returning();
    const [siblingGrant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: siblingMember.id, role: "student" }).returning();
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.students[1].id, roleGrantId: siblingGrant.id });
    people.sibling = sibling;
    const revoked = await identity("verse-revoked@example.test");
    const [revokedMember] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: revoked.userId }).returning();
    await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: revokedMember.id, role: "student", revokedAt: new Date() });
    people.revoked = revoked;
    const member = await identity("verse-member@example.test");
    const [memberRow] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: member.userId }).returning();
    await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: memberRow.id, userId: member.userId, displayName: "Synthetic member", approvedByMembershipId: f.adminMember.id });
    people.member = member;
    return people;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookie = (who: Who) => who === "anonymous" ? "" : who in extra ? extra[who].cookie : f.identities[who as "admin"].cookie;
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}, raw?: string) => {
    const h = new Headers(headers), c = cookie(who);
    if (c && !h.has("cookie")) h.set("cookie", c);
    if (body !== undefined || raw !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); if (!h.has("content-type")) h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: body === undefined && raw === undefined ? "GET" : "POST", headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control"), path).toBeNull();
    return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { f, call };
}

describe("a student's own verse cards", () => {
  it("answer only a signed-in student with a live student grant: 401 signed out, 403 for the parent, the tutor, an admin, a Member and a revoked student", async () => {
    const t = await setup();
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["multi", 403], ["admin", 403], ["member", 403], ["revoked", 403], ["learner", 200], ["sibling", 200]] as const)
      expect((await t.call("/api/learn/verses", who)).status, who).toBe(status);
    for (const who of ["multi", "admin", "member", "revoked"] as const)
      expect((await t.call("/api/learn/verses/put", who, { review: doc(), expectedVersion: 0 })).status, who).toBe(403);
  });

  it("are written under a version and read back by the student, with the student's own ceremony date for the cap", async () => {
    const t = await setup();
    expect((await t.call("/api/learn/verses", "learner")).json).toEqual({ ok: true, review: null, version: 0, until: "2027-01-02" });
    const one = doc({ "torah|Genesis 23:1": [1, "2026-11-03"] });
    expect((await t.call("/api/learn/verses/put", "learner", { review: one, expectedVersion: 0 })).json).toEqual({ ok: true, review: one, version: 1, until: "2027-01-02" });
    const stale = await t.call("/api/learn/verses/put", "learner", { review: doc(), expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json).toEqual({ ok: false, code: "conflict", current: { ok: true, review: one, version: 1, until: "2027-01-02" } });
    const two = doc({ "torah|Genesis 23:1": [0, "2026-11-04"], "torah|Genesis 23:3": [0, "2026-11-04"] });
    expect((await t.call("/api/learn/verses/put", "learner", { review: two, expectedVersion: 1 })).json).toMatchObject({ ok: true, review: two, version: 2 });
    expect((await t.call("/api/learn/verses", "learner")).json).toMatchObject({ version: 2, review: two });
  });

  it("are never read by another account: another student, the parent, the tutor and the admin each see only their own answer, never the cards", async () => {
    const t = await setup();
    const mine = doc({ "torah|Genesis 23:1": [2, "2026-11-05"], "torah|Genesis 23:8": [0, "2026-11-02"] });
    await t.call("/api/learn/verses/put", "learner", { review: mine, expectedVersion: 0 });
    const sibling = await t.call("/api/learn/verses", "sibling");
    expect(sibling.json).toEqual({ ok: true, review: null, version: 0, until: "2027-01-02" });
    // The sibling's own write lands in the sibling's own document and changes nothing of the learner's.
    const theirs = doc({ "torah|Genesis 24:1": [1, "2026-11-03"] });
    expect((await t.call("/api/learn/verses/put", "sibling", { review: theirs, expectedVersion: 0 })).json).toMatchObject({ ok: true, version: 1, review: theirs });
    expect((await t.call("/api/learn/verses", "learner")).json).toMatchObject({ version: 1, review: mine });
    for (const who of ["multi", "admin", "member", "recipient", "anonymous"] as const) {
      const seen = await t.call("/api/learn/verses", who);
      expect(JSON.stringify(seen.json), who).not.toContain("Genesis 23");
      expect(Object.keys(seen.json), who).toEqual(["error"]);
    }
    // The parent acting for the child (a practice context) never reaches them either.
    expect((await t.call("/api/learn/verses", "multi", undefined, { "x-practice-context": "00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect((await t.call("/api/learn/verses", "learner", undefined, { "x-practice-context": "00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    // Nothing the staff-facing progress API answers carries a card: the tutor's and the parent's reads of the learner are unchanged.
    for (const [who, mode] of [["multi", "tutor"], ["multi", "parent"], ["admin", "admin"]] as const) {
      const listed = await t.call(`/api/students?mode=${mode}`, who);
      expect(listed.status, mode).toBe(200);
      expect(JSON.stringify(listed.json), mode).not.toMatch(/learn-verses|Genesis 23:8|"box"/);
    }
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.verseReviewTable)).length)).toBe(2);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.verseReviewTable).where(eq(s.verseReviewTable.membershipId, t.f.learnerMember.id))).length)).toBe(1);
  });

  it("refuses bad documents, extra keys, a foreign Origin, queries and other methods, echoing nothing", async () => {
    const t = await setup();
    for (const body of [{ review: { ...doc(), extra: 1 } }, { review: doc({ "torah|Isaiah 40:1": [1, "2026-11-03"] }), expectedVersion: 0 }, { review: doc({ "torah|Genesis 23:1": [9, "2026-11-03"] }), expectedVersion: 0 },
      { review: doc(), expectedVersion: 0, more: true }, { review: doc(), expectedVersion: -1 }, { review: doc(), expectedVersion: 1.5 }, { review: doc() }, { review: "x", expectedVersion: 0 }, {}]) {
      const result = await t.call("/api/learn/verses/put", "learner", body);
      expect(result.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(JSON.stringify(result.json)).not.toContain("Isaiah");
    }
    expect((await t.call("/api/learn/verses/put", "learner", { review: doc(), expectedVersion: 0 }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await t.call("/api/learn/verses/put", "learner", { review: doc(), expectedVersion: 0 }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await t.call("/api/learn/verses/put", "learner", undefined, {}, "{")).status).toBe(400);
    expect((await t.call("/api/learn/verses?x=1", "learner")).status).toBe(400);
    expect((await t.call("/api/learn/verses/merge", "learner", { review: doc() })).status).toBe(404);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.verseReviewTable)).length)).toBe(0);
  });
});
