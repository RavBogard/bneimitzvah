import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { preferencesPut } from "../../src/server/saved/validation";
import { preferencesOwnerName } from "../../src/server/saved/service";
import { HttpBoundaryError } from "../../src/server/http/responses";
import { PREFERENCE_WORKS } from "../../src/lib/account-preferences/document";

// Release 1.7 M3b: the account keeps a member's own preferred commentaries and reading settings, through the real
// dispatcher, cookie session, Origin check and the saved layer's owner-only binding. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Who = "admin" | "multi" | "learner" | "recipient" | "anonymous";

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const members = await f.owner(async () => Object.fromEntries((await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "crc"))).map(row => [row.userId, row.id])));
  const ownerOf = (who: "admin" | "multi") => preferencesOwnerName({ tenantId: "crc", membershipId: members[f.identities[who].id] });
  function request(path: string, who: Who, body?: unknown, headers: Record<string, string> = {}, origin = ORIGIN) {
    const h = new Headers(headers), cookie = who === "anonymous" ? "" : f.identities[who].cookie;
    if (cookie && !h.has("cookie")) h.set("cookie", cookie);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", origin); if (!h.has("content-type")) h.set("content-type", "application/json"); }
    return new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}, origin = ORIGIN) => {
    const response = await dispatch(request(path, who, body, headers, origin));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control"), path).toBeNull();
    return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const get = (who: Who) => call("/api/saved/preferences", who);
  const put = (who: Who, preferences: unknown, expectedRevision: number, owner?: string) =>
    call("/api/saved/preferences/put", who, { preferences, expectedRevision, owner: owner ?? (who === "admin" || who === "multi" ? ownerOf(who) : "0".repeat(32)) });
  return { f, dispatch, call, get, put, ownerOf, members };
}

describe("account preferences: who may use them", () => {
  it("is 401 signed out, 403 for an account that does not keep saved readings (a student, a role-less account), and open to tutors, parents and admins", async () => {
    const t = await setup();
    for (const [who, status] of [["anonymous", 401], ["recipient", 403], ["learner", 403], ["multi", 200], ["admin", 200]] as [Who, number][]) {
      expect((await t.get(who)).status, who).toBe(status);
      expect((await t.put(who, { version: 1, colors: false }, 0)).status, who).toBe(status);
    }
  });

  it("answers the member's own document only: null at first, then theirs, never another member's (staff included)", async () => {
    const t = await setup();
    expect((await t.get("multi")).json).toEqual({ ok: true, owner: t.ownerOf("multi"), preferences: null, revision: 0 });
    const saved = await t.put("multi", { version: 1, works: [], colors: false, size: "large" }, 0);
    expect(saved).toEqual({ status: 200, json: { ok: true, owner: t.ownerOf("multi"), preferences: { version: 1, works: [], colors: false, size: "large" }, revision: 1 } });
    // The admin is staff, and still has only their own (none yet).
    expect((await t.get("admin")).json).toEqual({ ok: true, owner: t.ownerOf("admin"), preferences: null, revision: 0 });
    expect(t.ownerOf("admin")).not.toBe(t.ownerOf("multi"));
    // Naming another member's owner is a conflict that carries only the caller's own document, and writes nothing.
    const crossed = await t.put("admin", { version: 1, works: ["rashi"] }, 1, t.ownerOf("multi"));
    expect(crossed).toEqual({ status: 409, json: { ok: false, code: "conflict", current: { ok: true, owner: t.ownerOf("admin"), preferences: null, revision: 0 } } });
    expect((await t.get("multi")).json.preferences).toEqual({ version: 1, works: [], colors: false, size: "large" });
    // The same person's membership in another congregation (a student there) does not reach it.
    expect((await t.call("/api/saved/preferences", "multi", undefined, {}, "http://localhost:3101")).status).toBe(403);
    // One row, the owner's, and no audit row.
    const rows = await t.f.owner(async () => t.f.db.select().from(s.accountPreference));
    expect(rows.map(row => [row.membershipId, row.revision])).toEqual([[t.members[t.f.identities.multi.id], 1]]);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.targetType, "account_preference"))).length)).toBe(0);
    expect(JSON.stringify((await t.get("multi")).json)).not.toContain("@");
  });

  it("replaces the document under its revision; a stale revision is a 409 carrying the current one, and a first copy-up never overwrites an account copy", async () => {
    const t = await setup();
    expect((await t.put("multi", { version: 1, works: ["rashi", "womens"] }, 0)).json.revision).toBe(1);
    // A second device's first copy-up (revision 0) finds the account copy: it wins.
    const late = await t.put("multi", { version: 1, works: [] }, 0);
    expect(late).toEqual({ status: 409, json: { ok: false, code: "conflict", current: { ok: true, owner: t.ownerOf("multi"), preferences: { version: 1, works: ["rashi", "womens"] }, revision: 1 } } });
    // Turning every commentary off is kept as a choice.
    expect((await t.put("multi", { version: 1, works: [] }, 1)).json).toMatchObject({ ok: true, preferences: { version: 1, works: [] }, revision: 2 });
    expect((await t.put("multi", { version: 1, works: ["rashi"] }, 1)).status).toBe(409);
    expect((await t.get("multi")).json).toMatchObject({ preferences: { version: 1, works: [] }, revision: 2 });
  });
});

describe("account preferences: a stored commentary later removed from the registry", () => {
  it("is dropped when read, so the member is never locked out of their own preferences, and their next write replaces the row", async () => {
    const t = await setup();
    expect((await t.put("multi", { version: 1, works: ["rashi"], colors: false }, 0)).status).toBe(200);
    await t.f.owner(async () => t.f.db.update(s.accountPreference).set({ preferences: { version: 1, works: ["rashi", "retired-work"], colors: false } }));
    expect((await t.get("multi")).json).toMatchObject({ ok: true, preferences: { version: 1, works: ["rashi"], colors: false }, revision: 1 });
    expect((await t.put("multi", { version: 1, works: [], colors: false }, 1)).json).toMatchObject({ preferences: { version: 1, works: [] }, revision: 2 });
  });
  it("every registered work key fits the 0041 CHECK's key pattern, so the app never sends what the table refuses", () => {
    for (const work of PREFERENCE_WORKS) expect(work).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    expect(PREFERENCE_WORKS.length).toBeGreaterThanOrEqual(2);
  });
});

describe("account preferences: strict validation", () => {
  it("refuses anything but allow-listed fields and values, without echoing what was sent", async () => {
    const t = await setup();
    const owner = t.ownerOf("multi");
    const bad: unknown[] = [
      null, [], "x", {}, { preferences: { version: 1 } }, { preferences: { version: 1 }, expectedRevision: 0 }, { preferences: { version: 1 }, expectedRevision: 0, owner, extra: 1 },
      { preferences: { version: 1 }, expectedRevision: -1, owner }, { preferences: { version: 1 }, expectedRevision: 1.5, owner }, { preferences: { version: 1 }, expectedRevision: "0", owner },
      { preferences: { version: 1 }, expectedRevision: 2147483647, owner }, { preferences: { version: 1 }, expectedRevision: 0, owner: "A".repeat(32) }, { preferences: { version: 1 }, expectedRevision: 0, owner: 7 },
      ...[{}, { version: 2 }, { version: "1" }, { version: 1, note: "free text <b>" }, { version: 1, works: "rashi" }, { version: 1, works: ["Rashi"] }, { version: 1, works: ["nachmanides"] },
        { version: 1, works: ["womens", "rashi"] }, { version: 1, works: ["rashi", "rashi"] }, { version: 1, works: [null] }, { version: 1, colors: "true" }, { version: 1, colors: null },
        { version: 1, studyEnglish: 0 }, { version: 1, translation: "no" }, { version: 1, size: "giant" }, { version: 1, size: null }, { version: 1, tikkunView: "on" }, { version: 1, tikkun: true },
        { version: 1, works: ["rashi", "womens", "ramban", "sforno"] }].map(preferences => ({ preferences, expectedRevision: 0, owner })),
    ];
    // A document with an inherited field is not a plain object and is refused before it is read.
    expect(() => preferencesPut({ preferences: Object.assign(Object.create({ colors: true }), { version: 1 }), expectedRevision: 0, owner })).toThrow(HttpBoundaryError);
    for (const body of bad) {
      expect(() => preferencesPut(body), JSON.stringify(body)).toThrow(HttpBoundaryError);
      const answer = await t.call("/api/saved/preferences/put", "multi", body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(answer.json)).not.toMatch(/free text|giant|nachmanides/);
    }
    expect((await t.get("multi")).json.revision).toBe(0);
    // Every field at once is fine, and comes back in canonical order.
    const full = { tikkunView: "beside", size: "small", translation: true, colors: false, studyEnglish: false, works: ["rashi", "womens"], version: 1 };
    expect((await t.put("multi", full, 0)).json.preferences).toEqual({ version: 1, works: ["rashi", "womens"], studyEnglish: false, colors: false, translation: true, size: "small", tikkunView: "beside" });
  });

  it("refuses a practice-context header, a POST without the exact Origin, a wrong method and an unknown query key", async () => {
    const t = await setup();
    const body = { preferences: { version: 1, colors: false }, expectedRevision: 0, owner: t.ownerOf("multi") };
    expect((await t.call("/api/saved/preferences", "multi", undefined, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    expect((await t.call("/api/saved/preferences/put", "multi", body, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    for (const headers of [{ origin: "https://evil.example" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }] as Record<string, string>[])
      expect((await t.call("/api/saved/preferences/put", "multi", body, headers)).status).toBe(403);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/saved/preferences/put`, { headers: { cookie: t.f.identities.multi.cookie } }))).status).toBe(405);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/saved/preferences`, { method: "POST", headers: { cookie: t.f.identities.multi.cookie, origin: ORIGIN, "content-type": "application/json" }, body: "{}" }))).status).toBe(405);
    expect((await t.call("/api/saved/preferences?x=1", "multi")).status).toBe(400);
    expect((await t.get("multi")).json.revision).toBe(0);
  });
});
