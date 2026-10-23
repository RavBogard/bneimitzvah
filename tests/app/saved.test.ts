import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { savedRanges, SAVED_RANGE_LIMITS } from "../../src/server/saved/validation";
import { SAVED_CAPS } from "../../src/server/saved/service";
import { HttpBoundaryError } from "../../src/server/http/responses";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });

type Who = "admin" | "multi" | "learner" | "recipient" | "parentOnly" | "disabled" | "revoked" | "anonymous";
async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  // Three more synthetic people: a parent-only account, a parent whose membership is disabled, and one whose parent grant was revoked.
  const extra = await f.owner(async () => {
    const people: Record<string, { id: string; cookie: string; membershipId: string; grantId: string }> = {};
    for (const [key, email] of [["parentOnly", "saved-parent@example.test"], ["disabled", "saved-disabled@example.test"], ["revoked", "saved-revoked@example.test"]] as const) {
      // Fixture sign-ins share one synthetic address; clear the magic-link throttle between them.
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic saved identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id, disabledAt: key === "disabled" ? new Date() : null }).returning();
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "parent", revokedAt: key === "revoked" ? new Date() : null }).returning();
      people[key] = { id: proof.user.id, cookie, membershipId: member.id, grantId: grant.id };
    }
    return people;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookie = (who: Who) => who === "anonymous" ? "" : who in extra ? extra[who].cookie : f.identities[who as "admin"].cookie;
  function request(path: string, who: Who, body?: unknown, headers: Record<string, string> = {}) {
    const h = new Headers(headers), c = cookie(who);
    if (c && !h.has("cookie")) h.set("cookie", c);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); if (!h.has("content-type")) h.set("content-type", "application/json"); }
    return new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await dispatch(request(path, who, body, headers));
    expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control"), path).toBeNull();
    return { status: response.status, json: await response.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const create = (who: Who, ranges = "Genesis 1:1-2:3", kind = "torah", name = "Bereshit · Torah", date: string | null = "2026-10-17") =>
    call("/api/saved/readings/create", who, { name, date, kind, ranges });
  return { f, extra, dispatch, request, call, create };
}

describe("the saved layer: who may use it", () => {
  it("is 401 signed out, 403 without a membership or with only a student role, a disabled membership or a revoked grant, and open to parents, tutors and admins", async () => {
    const t = await setup();
    const body = { name: "Reading", date: null, kind: "torah", ranges: "Genesis 1:1-5" };
    const expected: [Who, number][] = [["anonymous", 401], ["recipient", 403], ["learner", 403], ["disabled", 403], ["revoked", 403], ["parentOnly", 200], ["multi", 200], ["admin", 200]];
    for (const [who, status] of expected) {
      expect((await t.call("/api/saved/readings", who)).status, who).toBe(status);
      expect((await t.call("/api/saved/stars", who)).status, who).toBe(status);
      expect((await t.call("/api/saved/readings/create", who, body)).status, who).toBe(status);
    }
    // The member's own state is all the list tells: no other field and no email address.
    const listed = await t.call("/api/saved/readings", "parentOnly");
    expect(Object.keys(listed.json).sort()).toEqual(["ok", "readings"]);
    expect(JSON.stringify(listed.json)).not.toContain("@");
  });

  it("refuses a practice-context header, a POST without the exact Origin and a cross-site fetch", async () => {
    const t = await setup();
    expect((await t.call("/api/saved/readings", "multi", undefined, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    expect((await t.call("/api/saved/readings/create", "multi", { name: "R", date: null, kind: "torah", ranges: "Genesis 1:1" }, { "X-Practice-Context": "x".repeat(43) })).status).toBe(403);
    for (const headers of [{ origin: "https://evil.example" }, { origin: "http://localhost:3101" }, { origin: ORIGIN, "sec-fetch-site": "cross-site" }] as Record<string, string>[])
      expect((await t.call("/api/saved/readings/create", "multi", { name: "R", date: null, kind: "torah", ranges: "Genesis 1:1" }, headers)).status).toBe(403);
    const bare = new Request(`${ORIGIN}/api/saved/readings/create`, { method: "POST", headers: { cookie: t.f.identities.multi.cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "R", date: null, kind: "torah", ranges: "Genesis 1:1" }) });
    expect((await t.dispatch(bare)).status).toBe(403);
    expect((await t.call("/api/saved/readings", "multi")).json.readings).toEqual([]);
    // Wrong methods and unknown query keys are refused before any service runs.
    expect((await t.dispatch(new Request(`${ORIGIN}/api/saved/readings/create`, { headers: { cookie: t.f.identities.multi.cookie } }))).status).toBe(405);
    expect((await t.call("/api/saved/readings?mode=admin", "multi")).status).toBe(400);
  });

  it("ends with the last eligible grant and returns, rows intact, when eligibility comes back", async () => {
    const t = await setup();
    const made = await t.create("parentOnly");
    expect(made.status).toBe(200);
    await t.f.owner(async () => { await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.extra.parentOnly.grantId)); });
    expect((await t.call("/api/saved/readings", "parentOnly")).status).toBe(403);
    expect((await t.call(`/api/saved/reading?id=${made.json.reading.id}`, "parentOnly")).status).toBe(403);
    await t.f.owner(async () => { await t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.extra.parentOnly.membershipId, role: "tutor" }); });
    expect((await t.call("/api/saved/readings", "parentOnly")).json.readings.map((r: { id: string }) => r.id)).toEqual([made.json.reading.id]);
    // A member with two eligible grants keeps access when one is revoked.
    await t.f.owner(async () => { await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.parentGrant.id)); });
    expect((await t.call("/api/saved/readings", "multi")).status).toBe(200);
  });

  it("keeps each congregation's saved layer to that congregation", async () => {
    const t = await setup();
    const mine = await t.create("multi");
    // multi is a student only in the other congregation, so has no saved layer there at all.
    expect((await t.dispatch(new Request("http://localhost:3101/api/saved/readings", { headers: { cookie: t.f.identities.multi.cookie } }))).status).toBe(403);
    const otherMember = await t.f.owner(async () => (await t.f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
    await t.f.owner(async () => { await t.f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "parent" }); });
    // Now eligible there too, the same person sees none of this congregation's rows, even by id.
    const there = await t.dispatch(new Request("http://localhost:3101/api/saved/readings", { headers: { cookie: t.f.identities.multi.cookie } }));
    expect(there.status).toBe(200); expect((await there.json()).readings).toEqual([]);
    const read = await t.dispatch(new Request(`http://localhost:3101/api/saved/reading?id=${mine.json.reading.id}`, { headers: { cookie: t.f.identities.multi.cookie } }));
    expect(read.status).toBe(404);
  });
});

describe("the saved layer: readings, work, marks and stars", () => {
  it("creates, lists, pages, renames and removes a member's own reading", async () => {
    const t = await setup();
    const made = await t.create("multi", "Genesis 1:1-2:3", "torah", "  Bereshit · Torah  ");
    expect(made.json).toMatchObject({ ok: true, reading: { name: "Bereshit · Torah", date: "2026-10-17", kind: "torah", ranges: "Genesis 1:1-2:3", verseCount: 34, revision: 1 } });
    const id = made.json.reading.id as string;
    await t.create("multi", "Isaiah 42:5-43:10", "haftarah", "Haftarah", null);
    const list = (await t.call("/api/saved/readings", "multi")).json.readings;
    expect(list.map((r: { name: string }) => r.name)).toEqual(["Bereshit · Torah", "Haftarah"]);
    const page = await t.call(`/api/saved/reading?id=${id}`, "multi");
    expect(page.json).toMatchObject({ ok: true, offset: 0, totalVerses: 34, nextOffset: 10 });
    expect(page.json.verses.map((v: { ref: string }) => v.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `Genesis 1:${i + 1}`));
    expect(page.json.verses[0]).toEqual({ ref: "Genesis 1:1", translation: null, note: null, mark: null });
    const last = await t.call(`/api/saved/reading?id=${id}&offset=30`, "multi");
    expect(last.json).toMatchObject({ offset: 30, nextOffset: null });
    expect(last.json.verses.map((v: { ref: string }) => v.ref)).toEqual(["Genesis 1:31", "Genesis 2:1", "Genesis 2:2", "Genesis 2:3"]);
    expect((await t.call(`/api/saved/reading?id=${id}&offset=34`, "multi")).status).toBe(400);
    for (const query of ["", "?id=nope", `?id=${id}&offset=-1`, `?id=${id}&offset=01`, `?id=${id}&offset=1&offset=2`]) expect((await t.call(`/api/saved/reading${query}`, "multi")).status, query).toBe(400);
    // Rename and re-date under the revision; a stale revision is a conflict with the current reading.
    const renamed = await t.call("/api/saved/readings/update", "multi", { id, revision: 1, name: "Creation", date: null });
    expect(renamed.json).toMatchObject({ ok: true, reading: { name: "Creation", date: null, revision: 2 } });
    const stale = await t.call("/api/saved/readings/update", "multi", { id, revision: 1, name: "Again", date: null });
    expect(stale.status).toBe(409); expect(stale.json).toMatchObject({ ok: false, code: "conflict", current: { name: "Creation", revision: 2 } });
    expect((await t.call("/api/saved/readings/remove", "multi", { id, revision: 1 })).status).toBe(409);
    // Remove is a hard delete that takes the reading's translation, notes and marks with it.
    await t.call("/api/saved/work", "multi", { readingId: id, verseRef: "Genesis 1:1", stream: "note", expectedVersion: 0, text: "A note." });
    await t.call("/api/saved/mark", "multi", { readingId: id, verseRef: "Genesis 1:1", expectedVersion: 0, state: "working" });
    expect((await t.call("/api/saved/readings/remove", "multi", { id, revision: 2 })).json).toEqual({ ok: true, removed: id });
    expect((await t.call(`/api/saved/reading?id=${id}`, "multi")).status).toBe(404);
    const left = await t.f.owner(async () => ({ work: (await t.f.db.select().from(s.savedVerseWork)).length, marks: (await t.f.db.select().from(s.savedVerseMark)).length }));
    expect(left).toEqual({ work: 0, marks: 0 });
  });

  it("keeps translation, notes and marks under optimistic versions, inside the reading only", async () => {
    const t = await setup();
    const id = (await t.create("multi", "Genesis 1:1-5")).json.reading.id as string;
    const work = (body: Record<string, unknown>) => t.call("/api/saved/work", "multi", { readingId: id, verseRef: "Genesis 1:2", stream: "translation", expectedVersion: 0, text: "Mine.", ...body });
    expect((await work({})).json).toMatchObject({ ok: true, verseRef: "Genesis 1:2", stream: "translation", work: { text: "Mine.", version: 1 } });
    const conflict = await work({ text: "Lost." });
    expect(conflict.status).toBe(409); expect(conflict.json).toMatchObject({ ok: false, code: "conflict", current: { text: "Mine.", version: 1 } });
    expect((await work({ expectedVersion: 1, text: "Mine,\r\nrevised." })).json.work).toMatchObject({ text: "Mine,\nrevised.", version: 2 });
    expect((await work({ expectedVersion: 5 })).status).toBe(409);
    // The note is its own stream on the same verse; a note may be cleared to empty.
    expect((await work({ stream: "note", text: "A note." })).json.work.version).toBe(1);
    expect((await work({ stream: "note", expectedVersion: 1, text: "" })).json.work).toMatchObject({ text: "", version: 2 });
    // A verse outside the reading, or a reading that is not the member's, is 404.
    expect((await work({ verseRef: "Genesis 1:6" })).status).toBe(404);
    expect((await work({ verseRef: "Exodus 1:1" })).status).toBe(404);
    expect((await t.call("/api/saved/work", "admin", { readingId: id, verseRef: "Genesis 1:2", stream: "note", expectedVersion: 0, text: "Not mine." })).status).toBe(404);
    for (const bad of [{ text: "x".repeat(4097) }, { text: "bell\u0007" }, { text: "line\u2028sep" }, { text: "para\u2029sep" }, { text: "next\u0085line" }, { text: "c1\u009f" }, { text: "del\u007f" }, { text: "\ud800" }, { stream: "draft" }, { verseRef: "Genesis 1" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { extra: 1 }])
      expect((await work(bad)).status, JSON.stringify(bad)).toBe(400);
    const mark = (body: Record<string, unknown>) => t.call("/api/saved/mark", "multi", { readingId: id, verseRef: "Genesis 1:3", expectedVersion: 0, state: "working", ...body });
    expect((await mark({})).json).toMatchObject({ ok: true, verseRef: "Genesis 1:3", mark: { state: "working", version: 1 } });
    expect((await mark({ state: "got-it" })).status).toBe(409);
    expect((await mark({ expectedVersion: 1, state: "got-it" })).json.mark).toMatchObject({ state: "got-it", version: 2 });
    expect((await mark({ state: "done" })).status).toBe(400);
    expect((await mark({ verseRef: "Genesis 2:1" })).status).toBe(404);
    const page = (await t.call(`/api/saved/reading?id=${id}`, "multi")).json.verses;
    expect(page[1]).toMatchObject({ ref: "Genesis 1:2", translation: { text: "Mine,\nrevised.", version: 2 }, note: { text: "", version: 2 }, mark: null });
    expect(page[2]).toMatchObject({ ref: "Genesis 1:3", translation: null, note: null, mark: { state: "got-it", version: 2 } });
  });

  it("never lets one member see, change or remove another member's reading by its id", async () => {
    const t = await setup();
    const id = (await t.create("multi", "Genesis 1:1-5")).json.reading.id as string;
    await t.call("/api/saved/work", "multi", { readingId: id, verseRef: "Genesis 1:1", stream: "note", expectedVersion: 0, text: "Private." });
    for (const who of ["admin", "parentOnly"] as const) {
      expect((await t.call(`/api/saved/reading?id=${id}`, who)).status).toBe(404);
      expect((await t.call("/api/saved/readings/update", who, { id, revision: 1, name: "Taken", date: null })).status).toBe(404);
      expect((await t.call("/api/saved/readings/remove", who, { id, revision: 1 })).status).toBe(404);
      expect((await t.call("/api/saved/mark", who, { readingId: id, verseRef: "Genesis 1:1", expectedVersion: 0, state: "working" })).status).toBe(404);
      expect((await t.call("/api/saved/readings", who)).json.readings).toEqual([]);
    }
    expect((await t.call(`/api/saved/reading?id=${id}`, "multi")).json.verses[0].note.text).toBe("Private.");
  });

  it("validates names, dates, kinds and ranges to the 1.3 ref contract", async () => {
    const t = await setup();
    for (const [ranges, kind, verses] of [["Genesis 1:1-2:3", "torah", 34], ["Exodus 30:11", "torah", 1], ["Genesis 1:1-5; Genesis 2:1-3", "torah", 8],
      ["Isaiah 27:6-28:13; Isaiah 29:22-23", "haftarah", 23], ["Hosea 14:2-10; Micah 7:18-20; Joel 2:15-27", "haftarah", 25], ["I Samuel 20:18-42", "haftarah", 25]] as const) {
      const made = await t.create("admin", ranges, kind);
      expect(made.json.reading, ranges).toMatchObject({ ranges, kind, verseCount: verses });
    }
    const refused = ["Genesis 12:1-12:5", "Genesis 1:1;Genesis 1:2", "Genesis 1:1;  Genesis 1:2", "Genesis 1:1; ", "Genesis 1:1;", " Genesis 1:1", "Genesis  1:1", "Genesis 1:1-1",
      "Genesis 1:40", "Genesis 51:1", "Genesis 1:0", "Genesis 01:1", "Genesis 1:1-50:26", "Genesis 1:1-3; Genesis 1:2-4", "Genesis 2:1; Genesis 1:1", "Genesis 1:1; Exodus 1:1",
      "Genesis １:1", "Genesis ١:1", "genesis 1:1", "Bereshit 1:1", Array(33).fill(0).map((_, i) => `Genesis ${i + 1}:1`).join("; "), "Genesis 1:1".padEnd(1001, "0"), ""];
    for (const ranges of refused) expect((await t.create("admin", ranges)).status, ranges).toBe(400);
    for (const [ranges, kind] of [["Isaiah 1:1", "torah"], ["Genesis 1:1", "haftarah"], ["Psalms 1:1-6", "haftarah"], ["Ruth 1:1", "haftarah"], ["Genesis 1:1", "blessing-before"]])
      expect((await t.create("admin", ranges, kind)).status, `${kind} ${ranges}`).toBe(400);
    for (const name of ["", "   ", "x".repeat(81), "Line\nbreak", "Tab\tname", "\u0085next", "a\u2028b", "a\u2029b", "a\u0007b", "a\u009fb", "\ud800"]) expect((await t.create("admin", "Genesis 1:1", "torah", name)).status, JSON.stringify(name)).toBe(400);
    expect((await t.create("admin", "Genesis 1:1", "torah", "ש".repeat(80))).status).toBe(200);
    for (const date of ["2026-02-30", "26-10-17", "2026-10-17T00:00:00Z", 20261017]) expect((await t.call("/api/saved/readings/create", "admin", { name: "R", date, kind: "torah", ranges: "Genesis 1:1" })).status, String(date)).toBe(400);
    for (const body of [{ name: "R", kind: "torah", ranges: "Genesis 1:1" }, { name: "R", date: null, kind: "torah", ranges: "Genesis 1:1", membershipId: "x" }, [], null])
      expect((await t.call("/api/saved/readings/create", "admin", body)).status).toBe(400);
  });

  it("keeps the canonical-range helper's limits identical to the 1.3 ref contract", () => {
    expect(SAVED_RANGE_LIMITS).toEqual({ characters: 1000, segments: 32, verses: 1000 });
    expect(savedRanges("Genesis 1:1-31; Genesis 2:1-3", "torah")).toMatchObject({ ranges: "Genesis 1:1-31; Genesis 2:1-3" });
    expect(savedRanges("Genesis 1:1-31; Genesis 2:1-3", "torah").verses).toHaveLength(34);
    const exactly32 = Array.from({ length: 32 }, (_, i) => `Genesis ${i + 1}:1`).join("; ");
    expect(savedRanges(exactly32, "torah").verses).toHaveLength(32);
    // Exactly 1000 verses is accepted and 1001 refused, built from the trusted chapter counts.
    const chapters = TANAKH_VERSE_COUNTS.Genesis; let total = 0, last = 0;
    while (total + chapters[last] <= 1000) total += chapters[last++];
    const thousand = `Genesis 1:1-${last}:${chapters[last - 1]}; Genesis ${last + 1}:1-${1000 - total}`;
    expect(savedRanges(thousand, "torah").verses).toHaveLength(1000);
    expect(() => savedRanges(`Genesis 1:1-${last}:${chapters[last - 1]}; Genesis ${last + 1}:1-${1001 - total}`, "torah")).toThrow(HttpBoundaryError);
    expect(() => savedRanges("Genesis 1:1-50:26", "torah")).toThrow(HttpBoundaryError);
    for (const bad of [42, null, undefined, {}, ["Genesis 1:1"]]) expect(() => savedRanges(bad, "torah")).toThrow(HttpBoundaryError);
  });

  it("stars a registered commentary's comment on a verse it covers, per member; unstarring deletes the star", async () => {
    const t = await setup();
    const star = (body: Record<string, unknown>, who: Who = "multi") => t.call("/api/saved/star", who, { work: "rashi", verseRef: "Genesis 1:1", comment: 2, starred: true, ...body });
    expect((await star({})).json).toEqual({ ok: true, star: { work: "rashi", verseRef: "Genesis 1:1", comment: 2, starred: true } });
    expect((await star({ verseRef: "Isaiah 1:1" })).status).toBe(200);
    expect((await star({ work: "womens", verseRef: "Exodus 2:1", comment: 1 })).status).toBe(200);
    // Starring twice is idempotent; unstarring removes the row, and unstarring again is harmless.
    expect((await star({})).json.star.starred).toBe(true);
    expect((await star({ comment: 2, starred: false })).json).toEqual({ ok: true, star: { work: "rashi", verseRef: "Genesis 1:1", comment: 2, starred: false } });
    expect((await star({ comment: 2, starred: false })).status).toBe(200);
    expect(await t.f.owner(async () => (await t.f.db.select().from(s.starredComment)).length)).toBe(2);
    for (const bad of [{ work: "unknown" }, { work: "Rashi" }, { work: "womens", verseRef: "Isaiah 1:1" }, { verseRef: "Psalms 1:1" }, { verseRef: "Genesis 1:32" }, { comment: 0 }, { comment: 61 }, { starred: "yes" }])
      expect((await star(bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await t.call("/api/saved/stars", "multi")).json.stars).toEqual([{ work: "rashi", verseRef: "Isaiah 1:1", comment: 2 }, { work: "womens", verseRef: "Exodus 2:1", comment: 1 }]);
    expect((await t.call("/api/saved/stars", "admin")).json.stars).toEqual([]);
  });
});

describe("the saved layer: caps", () => {
  it("holds 100 readings, 3,000 work rows, 10,000 marks and 2,000 stars per member; updates to existing rows still go through", async () => {
    const t = await setup();
    expect(SAVED_CAPS).toEqual({ readings: 100, work: 3000, marks: 10000, stars: 2000 });
    const id = (await t.create("multi", "Genesis 1:1-31")).json.reading.id as string;
    const member = t.f.multiMember.id, user = t.f.identities.multi.id;
    await t.f.owner(async () => {
      await t.f.client.query(`insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) select 'crc',$1,$2,'Seed '||g,'torah','Genesis 1:1',1 from generate_series(1,99) g`, [member, user]);
      const readings = (await t.f.client.query<{ id: string }>("select id from saved_reading where membership_id=$1 and id<>$2 order by id limit 10", [member, id])).rows.map(r => r.id);
      await t.f.client.query(`insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) select 'crc',$1,$2,'Genesis 2:'||g,st,'x',1 from generate_series(1,1500) g, unnest(array['translation','note']) st`, [member, readings[0]]);
      await t.f.client.query(`insert into saved_verse_mark(tenant_id,membership_id,saved_reading_id,verse_ref,state,version) select 'crc',$1,r,'Genesis 3:'||g,'working',1 from generate_series(1,1000) g, unnest($2::uuid[]) r`, [member, readings]);
      await t.f.client.query(`insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) select 'crc',$1,$2,'rashi','Genesis 4:'||v,c from generate_series(1,40) v, generate_series(1,50) c`, [member, user]);
    });
    const limit = { ok: false, code: "limit" };
    const over = await t.create("multi");
    expect(over.status).toBe(409); expect(over.json).toEqual(limit);
    expect((await t.call("/api/saved/work", "multi", { readingId: id, verseRef: "Genesis 1:1", stream: "note", expectedVersion: 0, text: "x" })).json).toEqual(limit);
    expect((await t.call("/api/saved/mark", "multi", { readingId: id, verseRef: "Genesis 1:1", expectedVersion: 0, state: "working" })).json).toEqual(limit);
    expect((await t.call("/api/saved/star", "multi", { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).json).toEqual(limit);
    // A full account still renames, toggles an existing star, and frees room by removing a reading.
    expect((await t.call("/api/saved/readings/update", "multi", { id, revision: 1, name: "Renamed", date: null })).status).toBe(200);
    expect((await t.call("/api/saved/star", "multi", { work: "rashi", verseRef: "Genesis 4:1", comment: 1, starred: false })).status).toBe(200);
    // Unstarring frees room under the cap, so a full account is never stuck at 409.
    expect((await t.call("/api/saved/stars", "multi")).json.stars).toHaveLength(1999);
    expect((await t.call("/api/saved/star", "multi", { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true })).json).toMatchObject({ ok: true });
    expect((await t.call("/api/saved/star", "multi", { work: "rashi", verseRef: "Genesis 1:2", comment: 1, starred: true })).json).toEqual(limit);
    expect((await t.call("/api/saved/readings/remove", "multi", { id, revision: 2 })).status).toBe(200);
    expect((await t.create("multi")).status).toBe(200);
    // Another member is unaffected by this member's caps.
    expect((await t.create("admin")).status).toBe(200);
  }, 120_000);

  it("serializes one member's concurrent creates so the cap holds exactly", async () => {
    const t = await setup();
    await t.f.owner(async () => { await t.f.client.query(`insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) select 'crc',$1,$2,'Seed '||g,'torah','Genesis 1:1',1 from generate_series(1,98) g`, [t.f.multiMember.id, t.f.identities.multi.id]); });
    const results = await Promise.all(Array.from({ length: 4 }, () => t.create("multi")));
    expect(results.map(r => r.status).sort()).toEqual([200, 200, 409, 409]);
    expect((await t.call("/api/saved/readings", "multi")).json.readings).toHaveLength(100);
  });
});

it("serves every saved route private and no-store, errors included, and never under /api/public/", async () => {
  const t = await setup();
  const id = (await t.create("multi", "Genesis 1:1-3")).json.reading.id as string;
  const posts: Record<string, unknown> = { "/api/saved/readings/create": { name: "R", date: null, kind: "torah", ranges: "Genesis 1:1" }, "/api/saved/readings/update": { id, revision: 1, name: "R", date: null },
    "/api/saved/readings/remove": { id, revision: 9 }, "/api/saved/work": { readingId: id, verseRef: "Genesis 1:1", stream: "note", expectedVersion: 0, text: "x" },
    "/api/saved/mark": { readingId: id, verseRef: "Genesis 1:1", expectedVersion: 0, state: "working" }, "/api/saved/star": { work: "rashi", verseRef: "Genesis 1:1", comment: 1, starred: true } };
  for (const who of ["anonymous", "learner", "multi"] as const) {
    for (const path of ["/api/saved/readings", `/api/saved/reading?id=${id}`, "/api/saved/stars"]) await t.call(path, who);
    for (const [path, body] of Object.entries(posts)) { await t.call(path, who, body); await t.call(path, who, { bad: true }); }
  }
  for (const path of ["/api/public/saved/readings", "/api/public/saved"]) expect((await t.dispatch(t.request(path, "multi"))).status).not.toBe(200);
});
