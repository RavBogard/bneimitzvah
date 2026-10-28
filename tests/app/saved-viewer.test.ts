import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createSavedViewerAccess } from "../../src/server/saved/access";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { HttpBoundaryError } from "../../src/server/http/responses";
import type { AccessRequest } from "../../src/server/access/types";

// Readings for everyone (plan D4): the staff read path to a learner's shelf. An admin, or a tutor who claims the learner or is
// linked to the learner's student, reads the learner's readings, marks and work, and nothing else; everyone else is 404; nothing on
// the path can write. Synthetic people only.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return "ok"; } catch (error) { return error instanceof AccessDenied && error.status === status ? status : error; }
}

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  // Two more synthetic people in this congregation: a learner with no role and a second tutor; and a tutor in the other congregation.
  const extra = await f.owner(async () => {
    const people: Record<string, { id: string; cookie: string; membershipId: string; grantId: string | null }> = {};
    for (const [key, email, tenant, role] of [["learner", "viewer-learner@example.test", "crc", null], ["other", "viewer-other-tutor@example.test", "crc", "tutor"], ["away", "viewer-away@example.test", "other", "tutor"]] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic viewer identity failed");
      const [member] = await f.db.insert(s.membership).values({ tenantId: tenant, userId: proof.user.id }).returning();
      const grant = role ? (await f.db.insert(s.roleGrant).values({ tenantId: tenant, membershipId: member.id, role }).returning())[0] : null;
      people[key] = { id: proof.user.id, cookie, membershipId: member.id, grantId: grant?.id ?? null };
    }
    return people;
  });
  const request = (who: "admin" | "multi" | "learner" | "recipient" | keyof typeof extra, origin = ORIGIN): AccessRequest & { method: string } =>
    ({ url: `${origin}/mine`, method: "GET", headers: new Headers({ cookie: who in extra ? extra[who].cookie : f.identities[who as "admin"].cookie }) });
  // The learner keeps a reading with a note and a mark, through the owner's own path.
  const seed = async (who: "learner" | "multi" | "recipient") => {
    const cookie = who in extra ? extra[who as "learner"].cookie : f.identities[who as "multi"].cookie;
    const made = await f.runtime.saved.create({ url: `${ORIGIN}/read`, method: "POST", headers: new Headers({ cookie, origin: ORIGIN }) }, { name: `${who} reading`, date: "2026-11-07", kind: "torah", ranges: "Genesis 1:1-3" });
    if (!made.ok) throw new Error("Synthetic reading failed");
    const write = { url: `${ORIGIN}/read`, method: "POST", headers: new Headers({ cookie, origin: ORIGIN }) };
    await f.runtime.saved.work(write, { readingId: made.reading.id, verseRef: "Genesis 1:1", stream: "note", text: "private note", expectedVersion: 0 });
    await f.runtime.saved.mark(write, { readingId: made.reading.id, verseRef: "Genesis 1:2", state: "working", expectedVersion: 0 });
    return made.reading;
  };
  const claim = (learner: string, grantId: string) => f.owner(() => f.db.insert(s.learnerClaim).values({ tenantId: "crc", learnerMembershipId: learner, tutorGrantId: grantId }).returning());
  return { f, extra, request, seed, claim, saved: f.runtime.saved };
}

describe("the staff read path to a learner's shelf", () => {
  it("lets an admin, and a tutor who claims the learner, read the learner's readings and a page with its marks and work; nobody else", async () => {
    const t = await setup();
    const reading = await t.seed("learner"), learner = t.extra.learner.membershipId;
    const admin = await t.saved.listReadingsOf(t.request("admin"), learner);
    expect(admin.readings.map(row => row.id)).toEqual([reading.id]);
    const page = await t.saved.readingOf(t.request("admin"), learner, reading.id);
    expect(page.ok && page.verses.map(row => [row.ref, row.note?.text ?? null, row.mark?.state ?? null])).toEqual([["Genesis 1:1", "private note", null], ["Genesis 1:2", null, "working"], ["Genesis 1:3", null, null]]);
    const paged = await t.saved.pageOf(t.request("admin"), learner, reading.id, 2);
    expect(paged.ok && [paged.offset, paged.verses.length]).toEqual([2, 1]);
    // The same body shape the owner's own page has.
    const own = await t.saved.reading(t.request("learner"), reading.id, 0);
    expect(own).toEqual(page);
    // A tutor without a claim or link: 404, the learner's existence not confirmed. With a claim: the same reads.
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), learner), 404)).toBe(404);
    expect(await denied(() => t.saved.readingOf(t.request("multi"), learner, reading.id), 404)).toBe(404);
    await t.claim(learner, t.f.tutorGrant.id);
    expect((await t.saved.listReadingsOf(t.request("multi"), learner)).readings.map(row => row.id)).toEqual([reading.id]);
    expect(await t.saved.pageOf(t.request("multi"), learner, reading.id, 0)).toEqual(page);
    // Another tutor, with no claim, is still 404; so is the learner asking about themself through the staff path, a student, and a person with no membership.
    for (const who of ["other", "learner", "recipient"] as const) expect(await denied(() => t.saved.listReadingsOf(t.request(who), learner), who === "recipient" ? 403 : 404), who).toBe(who === "recipient" ? 403 : 404);
    // A revoked claim ends the tutor's view at once; the admin's stays.
    await t.f.owner(() => t.f.db.update(s.learnerClaim).set({ revokedAt: new Date(), revokedBy: "learner", revokedByMembershipId: learner }).where(eq(s.learnerClaim.learnerMembershipId, learner)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), learner), 404)).toBe(404);
    expect((await t.saved.listReadingsOf(t.request("admin"), learner)).readings).toHaveLength(1);
    // A revoked tutor grant, or an admin grant revoked, ends it too.
    await t.claim(learner, t.f.tutorGrant.id);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), learner), 404)).toBe(404);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.adminGrant.id)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("admin"), learner), 404)).toBe(404);
  });

  it("lets the tutor linked to the learner's student read the learner's shelf, until the link, the identity or the ceremony ends it", async () => {
    const t = await setup();
    // The fixture's learner identity is a student of students[0], whose tutor is multi; the learner's own shelf is read through that link.
    const reading = await t.seed("learner");
    const grant = await t.f.owner(async () => (await t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.extra.learner.membershipId, role: "student" }).returning())[0]);
    const identity = await t.f.owner(async () => (await t.f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: t.f.students[1].id, roleGrantId: grant.id }).returning())[0]);
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), t.extra.learner.membershipId), 404)).toBe(404);
    const link = await t.f.owner(async () => (await t.f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: t.f.students[1].id, tutorGrantId: t.f.tutorGrant.id }).returning())[0]);
    expect((await t.saved.listReadingsOf(t.request("multi"), t.extra.learner.membershipId)).readings.map(row => row.id)).toEqual([reading.id]);
    // The other tutor, not linked to that student, sees nothing of it.
    expect(await denied(() => t.saved.listReadingsOf(t.request("other"), t.extra.learner.membershipId), 404)).toBe(404);
    await t.f.owner(() => t.f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, identity.id)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), t.extra.learner.membershipId), 404)).toBe(404);
    // A revocation is never undone (the immutable trigger); a new identity for the same student and grant restores the view.
    await t.f.owner(() => t.f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: t.f.students[1].id, roleGrantId: grant.id }));
    expect((await t.saved.listReadingsOf(t.request("multi"), t.extra.learner.membershipId)).readings).toHaveLength(1);
    await t.f.owner(() => t.f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, link.id)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), t.extra.learner.membershipId), 404)).toBe(404);
  });

  it("answers 404 for a learner of another congregation, a membership id that is not a learner here, a malformed id and a disabled learner; the viewer never reaches a third person's rows", async () => {
    const t = await setup();
    const learner = t.extra.learner.membershipId, reading = await t.seed("learner"), theirs = await t.seed("multi");
    await t.claim(learner, t.f.tutorGrant.id);
    // Review focus 1: a membership id of another tenant, or a tenant the viewer is not staff in, binds nothing.
    for (const target of [t.extra.away.membershipId, randomUUID(), t.f.students[0].id, t.f.tutorGrant.id]) {
      expect(await denied(() => t.saved.listReadingsOf(t.request("admin"), target), 404), target).toBe(404);
      expect(await denied(() => t.saved.listReadingsOf(t.request("multi"), target), 404), target).toBe(404);
    }
    // A malformed id is refused at the boundary (400) before any session is read; the binding itself refuses one too.
    for (const target of ["not-a-uuid", "", `${learner}x`]) {
      expect(await denied(() => t.saved.listReadingsOf(t.request("admin"), target), 404), target).toBeInstanceOf(HttpBoundaryError);
      expect(await denied(() => createSavedViewerAccess({ access: t.f.service }).withSavedViewer(t.request("admin"), target, async () => "bound"), 404), target).toBe(404);
    }
    // The away tutor, through the other congregation's host, is staff there and sees nothing of this one; through this host it has no membership.
    expect(await denied(() => t.saved.listReadingsOf(t.request("away", "http://localhost:3101"), learner), 404)).toBe(404);
    expect(await denied(() => t.saved.listReadingsOf(t.request("away"), learner), 403)).toBe(403);
    // The learner's page never carries another member's reading: the tutor who claims the learner cannot read multi's reading through the learner.
    expect(await denied(() => t.saved.readingOf(t.request("admin"), learner, theirs.id), 404)).toBe(404);
    expect(await denied(() => t.saved.readingOf(t.request("multi"), learner, theirs.id), 404)).toBe(404);
    expect((await t.saved.readingOf(t.request("admin"), learner, reading.id)).ok).toBe(true);
    // A practice-context header is refused before anything is looked up; a disabled learner is 404.
    expect(await denied(() => t.saved.listReadingsOf({ ...t.request("admin"), headers: new Headers({ cookie: t.f.identities.admin.cookie, "X-Practice-Context": "x".repeat(43) }) }, learner), 403)).toBe(403);
    await t.f.owner(() => t.f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, learner)));
    expect(await denied(() => t.saved.listReadingsOf(t.request("admin"), learner), 404)).toBe(404);
  });

  it("refuses every write inside the viewer binding at the database, and the action sees only the bound learner's rows", async () => {
    const t = await setup();
    const learner = t.extra.learner.membershipId, reading = await t.seed("learner");
    await t.seed("multi");
    const viewer = createSavedViewerAccess({ access: t.f.service });
    const counts = async () => t.f.owner(async () => [(await t.f.db.select().from(s.savedReading)).length, (await t.f.db.select().from(s.savedVerseWork)).length, (await t.f.db.select().from(s.savedVerseMark)).length]);
    const before = await counts();
    // Attack 2 of the adversarial pass: a write through withSavedViewer. The owner is never set, so owner_only admits nothing and the viewer policies are SELECT only.
    const attempts = [
      sql`insert into saved_reading (tenant_id, membership_id, user_id, name, kind, ranges, verse_count) values ('crc', ${learner}, ${t.extra.learner.id}, 'Planted', 'torah', 'Genesis 1:1', 1)`,
      sql`insert into saved_verse_work (tenant_id, membership_id, saved_reading_id, verse_ref, stream, text, version) values ('crc', ${learner}, ${reading.id}, 'Genesis 1:3', 'note', 'planted', 1)`,
      sql`insert into saved_verse_mark (tenant_id, membership_id, saved_reading_id, verse_ref, state, version) values ('crc', ${learner}, ${reading.id}, 'Genesis 1:3', 'got-it', 1)`,
      sql`insert into starred_comment (tenant_id, membership_id, user_id, work, verse_ref, comment_index) values ('crc', ${learner}, ${t.extra.learner.id}, 'rashi', 'Genesis 1:1', 1)`,
    ];
    for (const statement of attempts) {
      let outcome: unknown = "ok";
      try { await viewer.withSavedViewer(t.request("admin"), learner, tx => tx.execute(statement)); } catch (error) { outcome = error; }
      expect(outcome, statement.queryChunks.join("").slice(0, 40)).toBeInstanceOf(AccessUnavailable);
    }
    // Updates and deletes find no row to touch: the rows are visible to the viewer's SELECT only.
    const touched = await viewer.withSavedViewer(t.request("admin"), learner, async tx => {
      const run = async (statement: ReturnType<typeof sql>) => Number(((await tx.execute(statement)) as unknown as { affectedRows?: number }).affectedRows ?? 0);
      return [await run(sql`update saved_reading set name = 'Renamed'`), await run(sql`update saved_verse_work set text = 'Changed'`), await run(sql`update saved_verse_mark set state = 'got-it'`),
        await run(sql`delete from saved_reading`), await run(sql`delete from starred_comment`)];
    });
    expect(touched).toEqual([0, 0, 0, 0, 0]);
    expect(await counts()).toEqual(before);
    // Inside the binding, an unscoped select sees exactly the learner's rows, never multi's; and the owner setting is empty.
    const seen = await viewer.withSavedViewer(t.request("admin"), learner, async tx => {
      const rows = (await tx.execute(sql`select membership_id from saved_reading`)) as unknown as { rows: { membership_id: string }[] };
      const owner = (await tx.execute(sql`select coalesce(current_setting('app.saved_owner', true), '') as v`)) as unknown as { rows: { v: string }[] };
      return { members: [...new Set(rows.rows.map(row => row.membership_id))], owner: owner.rows[0].v };
    });
    expect(seen).toEqual({ members: [learner], owner: "" });
    // The owner's own path still works after all that, rows intact.
    expect((await t.saved.reading(t.request("learner"), reading.id, 0)).ok).toBe(true);
  });

  it("opens the directory to a live admin or tutor only, with counts and nearest dates per membership and nothing else", async () => {
    const t = await setup();
    const reading = await t.seed("learner");
    await t.seed("multi");
    // A past-dated reading never becomes "nearest"; the learner's dated one does. (The seed dates readings in the future.)
    await t.saved.create({ url: `${ORIGIN}/read`, method: "POST", headers: new Headers({ cookie: t.extra.learner.cookie, origin: ORIGIN }) }, { name: "Past", date: "2020-01-04", kind: "torah", ranges: "Genesis 2:1-3" });
    for (const who of ["admin", "multi", "other"] as const) {
      const value = await t.saved.directory(t.request(who));
      const rows = value.rows.filter(row => row.membershipId === t.extra.learner.membershipId);
      expect(rows, who).toEqual([{ membershipId: t.extra.learner.membershipId, readings: 2, nearest: { name: reading.name, date: "2026-11-07" } }]);
      expect(value.rows.map(row => row.membershipId).sort()).toEqual([t.extra.learner.membershipId, t.f.multiMember.id].sort());
      expect(JSON.stringify(value.rows)).not.toMatch(/private note|@|working/);
      expect(value.actor.grant.role).toBe(who === "admin" ? "admin" : "tutor");
    }
    for (const who of ["learner", "recipient"] as const) expect(await denied(() => t.saved.directory(t.request(who)), who === "recipient" ? 403 : 404), who).toBe(who === "recipient" ? 403 : 404);
    expect(await denied(() => t.saved.directory(t.request("away")), 403)).toBe(403);
    expect((await t.saved.directory(t.request("away", "http://localhost:3101"))).rows).toEqual([]);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)));
    expect(await denied(() => t.saved.directory(t.request("multi")), 404)).toBe(404);
  });
});
