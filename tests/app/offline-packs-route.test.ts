import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createOfflineService, OFFLINE_MEMBER_UPCOMING } from "../../src/server/offline/service";
import { addDays, congregationToday } from "../../src/lib/readings/public-shabbat";
import { parseOwnerAnswer } from "../../src/lib/offline/packer";

// GET /api/offline/packs (1.5 plan §3.10, A2): descriptors only, private and no-store, per person and per congregation.
// Daniel's rulings (2026-10-23): a student's confirmed readings; a member's three nearest upcoming saved readings;
// nothing for tutor, admin or parent grants, and no child's reading through a parent. Synthetic people only.
const ORIGIN = "http://localhost:3000", OTHER = "http://localhost:3101";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

type Who = "admin" | "multi" | "learner" | "recipient" | "anonymous";
async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookie = (who: Who) => who === "anonymous" ? "" : f.identities[who].cookie;
  async function call(who: Who, options: { origin?: string; path?: string; headers?: Record<string, string>; method?: string } = {}) {
    const headers = new Headers(options.headers); if (cookie(who)) headers.set("cookie", cookie(who));
    if (options.method === "POST") headers.set("origin", options.origin ?? ORIGIN);
    const response = await dispatch(new Request(`${options.origin ?? ORIGIN}${options.path ?? "/api/offline/packs"}`, { method: options.method ?? "GET", headers }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBeNull();
    return { status: response.status, json: await response.json() as Record<string, any>, text: "" }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  /** A confirmed reading for a student, written as the fixture's admin would have confirmed it. */
  async function confirm(studentIndex: number, kind: "torah" | "haftarah", ref: string, verses: string[], tenantId = "crc") {
    await f.owner(async () => {
      const [row] = await f.db.insert(s.assignment).values({ tenantId, studentId: f.students[studentIndex].id, kind, basis: "custom", status: "confirmed", ref,
        setByMembershipId: tenantId === "crc" ? f.adminMember.id : (await f.db.select().from(s.membership)).find(m => m.tenantId === "other")!.id,
        proposalSnapshot: { needsReview: false, confirmationDate: "2026-10-01" } }).returning();
      await f.db.insert(s.assignmentVerse).values(verses.map((verseRef, index) => ({ tenantId, studentId: f.students[studentIndex].id, assignmentId: row.id, ordinal: index + 1, verseRef })));
    });
  }
  /** Makes a person an approved member (an active tenant_member row) of the crc congregation. */
  async function member(who: "recipient" | "multi") {
    return f.owner(async () => {
      const membership = who === "multi" ? f.multiMember : (await f.db.insert(s.membership).values({ tenantId: "crc", userId: f.identities.recipient.id }).returning())[0];
      await f.db.insert(s.tenantMember).values({ tenantId: "crc", membershipId: membership.id, userId: membership.userId, displayName: "Synthetic member", approvedByMembershipId: f.adminMember.id });
      return membership;
    });
  }
  async function save(who: Who, name: string, date: string | null, ranges = "Genesis 1:1-5", kind = "torah") {
    const headers = new Headers({ cookie: cookie(who), origin: ORIGIN, "content-type": "application/json" });
    const response = await dispatch(new Request(`${ORIGIN}/api/saved/readings/create`, { method: "POST", headers, body: JSON.stringify({ name, date, kind, ranges }) }));
    expect(response.status).toBe(200);
  }
  return { f, call, confirm, member, save };
}

describe("GET /api/offline/packs: who gets which readings", () => {
  it("is 401 signed out and refuses a practice context, a query and other methods", async () => {
    const t = await setup();
    expect((await t.call("anonymous")).status).toBe(401);
    expect((await t.call("learner", { headers: { "X-Practice-Context": "x".repeat(43) } })).status).toBe(403);
    expect((await t.call("learner", { path: "/api/offline/packs?mode=student" })).status).toBe(400);
    expect((await t.call("learner", { method: "POST" })).status).toBe(405);
    // The signed-out answer reads as signed out on the device: owner packs go, public ones stay.
    expect(parseOwnerAnswer(401, null)).toEqual({ state: "signed-out" });
  });

  it("gives a student only their own confirmed readings, and nothing when none is confirmed", async () => {
    const t = await setup();
    const before = await t.call("learner");
    expect(before.status).toBe(200);
    expect(before.json.packs).toEqual([]);
    await t.confirm(0, "torah", "Genesis 1:1-2", ["Genesis 1:1", "Genesis 1:2"]);
    await t.confirm(1, "haftarah", "Isaiah 1:1-2", ["Isaiah 1:1", "Isaiah 1:2"]);
    const after = await t.call("learner");
    // A CRC member may also keep the evening lessons' text (2.0 SC7): a flag, never the text.
    expect(after.json).toEqual({ owner: before.json.owner, packs: [{ kind: "torah", ref: "Genesis 1:1-2", name: null }], evening: true });
    // Descriptors only: no name, email address, ceremony date or text.
    const body = JSON.stringify(after.json);
    for (const leak of ["@", "Synthetic", "Sibling", "2027-01-02", "2026-10-01", "hebrew", "english"]) expect(body, leak).not.toContain(leak);
    expect(parseOwnerAnswer(200, after.json)).toEqual({ state: "owner", owner: after.json.owner, packs: after.json.packs, evening: true });
  });

  it("gives tutor, admin and parent grants nothing: no child's or tutee's reading travels offline", async () => {
    const t = await setup();
    await t.confirm(0, "torah", "Genesis 1:1-2", ["Genesis 1:1", "Genesis 1:2"]);
    await t.confirm(1, "torah", "Genesis 1:3-4", ["Genesis 1:3", "Genesis 1:4"]);
    // multi is parent of students 0 and 1 and tutor of student 0; admin sees every student.
    for (const who of ["multi", "admin"] as const) expect((await t.call(who)).json.packs, who).toEqual([]);
    // A signed-in person with no membership here has an owner and no packs.
    const stranger = await t.call("recipient");
    expect(stranger.status).toBe(200); expect(stranger.json.packs).toEqual([]);
  });

  it("gives a member the three nearest upcoming saved readings, in date order, with their own names; past, undated and later ones are skipped", async () => {
    const t = await setup();
    await t.member("recipient");
    const today = congregationToday();
    await t.save("recipient", "Past", addDays(today, -1), "Genesis 2:1-3");
    await t.save("recipient", "Undated", null, "Genesis 2:4-6");
    await t.save("recipient", "Fourth", addDays(today, 40), "Genesis 3:1-3");
    await t.save("recipient", "Second", addDays(today, 7), "Isaiah 42:5-7", "haftarah");
    await t.save("recipient", "First", today, "Genesis 1:1-5");
    await t.save("recipient", "Third", addDays(today, 14), "Genesis 4:1-3");
    const answer = await t.call("recipient");
    expect(OFFLINE_MEMBER_UPCOMING).toBe(3);
    expect(answer.json.packs).toEqual([{ kind: "torah", ref: "Genesis 1:1-5", name: "First" }, { kind: "haftarah", ref: "Isaiah 42:5-7", name: "Second" },
      { kind: "torah", ref: "Genesis 4:1-3", name: "Third" }]);
    expect(JSON.stringify(answer.json)).not.toContain("@");
  });

  it("a parent or tutor who is also a member gets their own saved readings, still never a child's", async () => {
    const t = await setup();
    await t.confirm(0, "torah", "Genesis 1:1-2", ["Genesis 1:1", "Genesis 1:2"]);
    await t.save("multi", "Mine", congregationToday(), "Genesis 5:1-3");
    // Saved, but no member row yet: a parent or tutor grant alone gives no packs.
    expect((await t.call("multi")).json.packs).toEqual([]);
    await t.member("multi");
    expect((await t.call("multi")).json.packs).toEqual([{ kind: "torah", ref: "Genesis 5:1-3", name: "Mine" }]);
  });

  it("keeps the owner stable for a person, different between people and between congregations", async () => {
    const t = await setup();
    const a = await t.call("learner"), again = await t.call("learner"), b = await t.call("multi"), admin = await t.call("admin");
    expect(a.json.owner).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(again.json.owner).toBe(a.json.owner);
    expect(new Set([a.json.owner, b.json.owner, admin.json.owner]).size).toBe(3);
    // multi is a student in the other congregation, with a confirmed reading only there.
    await t.confirm(3, "torah", "Genesis 6:9-10", ["Genesis 6:9", "Genesis 6:10"], "other");
    const there = await t.call("multi", { origin: OTHER });
    expect(there.json.packs).toEqual([{ kind: "torah", ref: "Genesis 6:9-10", name: null }]);
    expect(there.json.owner).not.toBe(b.json.owner);
    expect((await t.call("multi")).json.packs).toEqual([]);
  });

  it("lets only a signed-in CRC person keep the evening lessons' text (2.0 SC7): never signed out, never on another congregation's site", async () => {
    const t = await setup();
    // Signed in at CRC, with a membership: the flag, never the text.
    for (const who of ["learner", "admin", "multi"] as const) expect((await t.call(who)).json.evening, who).toBe(true);
    expect(JSON.stringify((await t.call("learner")).json)).not.toMatch(/[\u0590-\u05FF]|evening-text|bm-maariv/);
    // The same person on a synthetic second congregation's site: no evening text to keep there.
    const there = await t.call("multi", { origin: OTHER });
    expect(there.status).toBe(200); expect(there.json.evening).toBe(false);
    expect(parseOwnerAnswer(200, there.json)).not.toHaveProperty("evening");
    // Signed out: 401, which the device reads as signed out and keeps no owner pack.
    const out = await t.call("anonymous");
    expect(out.status).toBe(401); expect(out.json).not.toHaveProperty("evening");
    expect(parseOwnerAnswer(401, out.json)).toEqual({ state: "signed-out" });
  });

  it("a revoked student grant or a removed link takes the readings away at the next ask", async () => {
    const t = await setup();
    await t.confirm(0, "torah", "Genesis 1:1-2", ["Genesis 1:1", "Genesis 1:2"]);
    expect((await t.call("learner")).json.packs).toHaveLength(1);
    await t.f.owner(async () => { await t.f.db.delete(s.studentIdentity).where((await import("drizzle-orm")).eq(s.studentIdentity.id, t.f.learnerLink.id)); });
    expect((await t.call("learner")).json.packs).toEqual([]);
  });
});

it("refuses a short owner secret", () => {
  expect(() => createOfflineService({ access: {} as never, portal: {} as never, saved: {} as never, ownerSecret: "short" })).toThrow();
  expect(() => createOfflineService({ access: {} as never, portal: {} as never, saved: {} as never, ownerSecret: randomBytes(48).toString("base64url") })).not.toThrow();
});
