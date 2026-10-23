import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { PROGRESS_SCHEMA } from "../../src/lib/learn/progress";

// Learn to lein, slice 3: a member's own course progress through /api/learn/progress*. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "disabled" | "revoked" | "member" | "ended" | "anonymous";
const doc = (lessons: Record<string, string> = {}, cards: Record<string, [number, string]> = {}) => ({ schema: PROGRESS_SCHEMA,
  lessons: Object.fromEntries(Object.entries(lessons).map(([id, done]) => [id, { done }])), cards: Object.fromEntries(Object.entries(cards).map(([id, [box, due]]) => [id, { box, due }])) });

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const extra = await f.owner(async () => {
    const people: Record<string, { cookie: string }> = {};
    for (const [key, email] of [["disabled", "course-disabled@example.test"], ["revoked", "course-revoked@example.test"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic course identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id, disabledAt: key === "disabled" ? new Date() : null }).returning();
      await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student", revokedAt: key === "revoked" ? new Date() : null });
      people[key] = { cookie };
    }
    // Approved Members with no role grant (release 1.4): one live, one whose membership an admin ended.
    for (const [key, email] of [["member", "course-member@example.test"], ["ended", "course-ended@example.test"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic course identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id }).returning();
      await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: member.id, userId: proof.user.id, displayName: "Synthetic member",
        approvedByMembershipId: f.adminMember.id, ...(key === "ended" ? { revokedAt: new Date(), revokedByMembershipId: f.adminMember.id } : {}) });
      people[key] = { cookie };
    }
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

describe("signed-in course progress", () => {
  it("is 401 signed out and 403 without a membership, with a disabled membership or with every grant revoked; any live grant keeps it, students included", async () => {
    const t = await setup();
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["disabled", 403], ["revoked", 403], ["ended", 403], ["member", 200], ["learner", 200], ["multi", 200], ["admin", 200]] as const)
      expect((await t.call("/api/learn/progress", who)).status, who).toBe(status);
  });

  it("copies a browser's progress on first sign-in, then merges: lessons the union with the earliest done, cards the higher box with its due", async () => {
    const t = await setup();
    const empty = await t.call("/api/learn/progress", "learner");
    expect(empty.json).toMatchObject({ ok: true, progress: null, version: 0 });
    expect(empty.json.owner).toMatch(/^[a-f0-9]{32}$/);
    const browser = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" }, { "sof-pasuk:torah:name": [3, "2026-10-30"] });
    const first = await t.call("/api/learn/progress/merge", "learner", { progress: browser });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ ok: true, version: 1, progress: browser, owner: empty.json.owner });
    const other = doc({ "intro-phrases": "2026-10-01T10:00:00.000Z", "torah-sof-pasuk": "2026-10-21T10:00:00.000Z" }, { "sof-pasuk:torah:name": [1, "2026-10-22"], "etnachta:torah:name": [2, "2026-10-25"] });
    const second = await t.call("/api/learn/progress/merge", "learner", { progress: other });
    expect(second.json).toMatchObject({ ok: true, version: 2 });
    expect(second.json.progress).toEqual(doc({ "intro-phrases": "2026-10-01T10:00:00.000Z", "torah-sof-pasuk": "2026-10-21T10:00:00.000Z" },
      { "etnachta:torah:name": [2, "2026-10-25"], "sof-pasuk:torah:name": [3, "2026-10-30"] }));
    expect((await t.call("/api/learn/progress", "learner")).json).toMatchObject({ version: 2, progress: second.json.progress });
  });

  it("replaces the document under its version and answers a stale version with the current one", async () => {
    const t = await setup();
    const one = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" });
    expect((await t.call("/api/learn/progress/put", "multi", { progress: one, expectedVersion: 0 })).json).toMatchObject({ ok: true, version: 1, progress: one });
    const stale = await t.call("/api/learn/progress/put", "multi", { progress: doc(), expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ ok: false, code: "conflict", current: { version: 1, progress: one } });
    // A put may lower a card (a missed answer); only merge takes the higher box.
    const lower = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" }, { "sof-pasuk:torah:name": [0, "2026-10-20"] });
    expect((await t.call("/api/learn/progress/put", "multi", { progress: lower, expectedVersion: 1 })).json).toMatchObject({ ok: true, version: 2, progress: lower });
  });

  it("keeps each member's document to that member: nobody else, staff included, ever sees it", async () => {
    const t = await setup();
    const mine = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" });
    await t.call("/api/learn/progress/merge", "learner", { progress: mine });
    for (const who of ["admin", "multi"] as const) {
      const seen = await t.call("/api/learn/progress", who);
      expect(seen.json).toMatchObject({ ok: true, progress: null, version: 0 });
      expect(seen.json.owner).not.toBe((await t.call("/api/learn/progress", "learner")).json.owner);
    }
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.courseProgressTable).where(eq(s.courseProgressTable.membershipId, t.f.learnerMember.id))).length)).toBe(1);
  });

  it("lets an approved Member with no role read and write only their own progress", async () => {
    const t = await setup();
    const theirs = doc({ "intro-phrases": "2026-10-20T10:00:00.000Z" });
    await t.call("/api/learn/progress/merge", "learner", { progress: theirs });
    const empty = await t.call("/api/learn/progress", "member");
    expect(empty.status).toBe(200);
    expect(empty.json).toMatchObject({ ok: true, progress: null, version: 0, until: null });
    expect(empty.json.owner).not.toBe((await t.call("/api/learn/progress", "learner")).json.owner);
    const mine = doc({ "torah-sof-pasuk": "2026-10-21T10:00:00.000Z" });
    expect((await t.call("/api/learn/progress/put", "member", { progress: mine, expectedVersion: 0 })).json).toMatchObject({ ok: true, version: 1, progress: mine });
    const merged = await t.call("/api/learn/progress/merge", "member", { progress: doc({ "intro-phrases": "2026-10-22T10:00:00.000Z" }) });
    expect(merged.json).toMatchObject({ ok: true, version: 2 });
    expect(Object.keys(merged.json.progress.lessons).sort()).toEqual(["intro-phrases", "torah-sof-pasuk"]);
    // The learner's document is untouched by the Member's writes, and neither sees the other's.
    expect((await t.call("/api/learn/progress", "learner")).json).toMatchObject({ version: 1, progress: theirs });
    expect((await t.call("/api/learn/progress", "member")).json).toMatchObject({ version: 2, progress: merged.json.progress });
    // An ended membership is refused, and its row stays the owner's alone.
    expect((await t.call("/api/learn/progress/put", "ended", { progress: mine, expectedVersion: 0 })).status).toBe(403);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.courseProgressTable)).length)).toBe(2);
  });

  it("gives a signed-in student their own ceremony date for the known-date cap, and nobody else a date", async () => {
    const t = await setup();
    expect((await t.call("/api/learn/progress", "learner")).json.until).toBe("2027-01-02");
    for (const who of ["admin", "multi"] as const) expect((await t.call("/api/learn/progress", who)).json.until, who).toBeNull();
    await t.f.owner(() => t.f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.roleGrantId, t.f.learnerGrant.id)));
    expect((await t.call("/api/learn/progress", "learner")).json.until).toBeNull();
  });

  it("refuses bad documents, extra keys, a missing or foreign Origin, queries and other methods, echoing nothing", async () => {
    const t = await setup();
    const bad = [{ progress: { ...doc(), extra: 1 } }, { progress: doc({ "intro-phrases": "not-a-time" }) }, { progress: doc({}, { "zakef:torah:name": [9, "2026-10-20"] }) },
      { progress: doc(), more: true }, { progress: "x" }, {}];
    for (const body of bad) {
      const result = await t.call("/api/learn/progress/merge", "learner", body);
      expect(result.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(JSON.stringify(result.json)).not.toContain("no-such-lesson");
    }
    for (const body of [{ progress: doc(), expectedVersion: -1 }, { progress: doc(), expectedVersion: 1.5 }, { progress: doc() }])
      expect((await t.call("/api/learn/progress/put", "learner", body)).status).toBe(400);
    expect((await t.call("/api/learn/progress/merge", "learner", { progress: doc() }, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await t.call("/api/learn/progress/merge", "learner", undefined, {}, "{")).status).toBe(400);
    expect((await t.call("/api/learn/progress?x=1", "learner")).status).toBe(400);
    expect((await t.call("/api/learn/progress/merge", "learner", { progress: doc() }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await t.call("/api/learn/progress/merge", "learner", undefined, {}, JSON.stringify({ progress: { ...doc(), pad: "x".repeat(80 * 1024) } }))).status).toBeGreaterThanOrEqual(400);
    expect((await t.call("/api/learn/progress", "anonymous")).status).toBe(401);
    // A practice context (a parent acting for a child) never reaches anyone's progress.
    expect((await t.call("/api/learn/progress", "multi", undefined, { "x-practice-context": "00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.courseProgressTable)).length)).toBe(0);
    // A lesson the course no longer knows is dropped, not refused, so an old browser's document still syncs.
    const kept = await t.call("/api/learn/progress/merge", "learner", { progress: doc({ "no-such-lesson": "2026-10-20T10:00:00.000Z", "intro-phrases": "2026-10-20T10:00:00.000Z" }) });
    expect(kept.status).toBe(200);
    expect(Object.keys(kept.json.progress.lessons)).toEqual(["intro-phrases"]);
  });
});
