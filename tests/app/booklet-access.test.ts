import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { bookletRouteMethods } from "../../src/server/http/booklet";

// The study booklet's access rule (replacing the study-guide booklet, B2), through the dispatcher: the learner, a linked parent, a tutor
// under A1 (the rabbi's assignment, or a live claim on a learner) and an admin of the same congregation open it; everyone else gets one
// 404, the same as an unknown student. Synthetic @example.test people only.
const ORIGIN = "http://localhost:3000", AWAY = "http://localhost:3101";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
type Person = { cookie: string; membershipId: string; grantId: string | null };

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const people = await f.owner(async () => {
    const out: Record<string, Person> = {};
    for (const [key, email, name, tenant, role] of [
      ["assigned", "booklet-assigned@example.test", "Synthetic Assigned", "crc", "tutor"], ["claimer", "booklet-claimer@example.test", "Synthetic Claimer", "crc", "tutor"],
      ["bare", "booklet-bare@example.test", "Synthetic Bare", "crc", "student"], ["away", "booklet-away@example.test", "Synthetic Away", "other", "admin"],
    ] as const) {
      await f.db.delete(s.rateLimit);
      const { cookie } = await f.signIn(email);
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic booklet identity failed");
      await f.db.update(s.user).set({ name }).where(eq(s.user.id, proof.user.id));
      const [member] = await f.db.insert(s.membership).values({ tenantId: tenant, userId: proof.user.id }).returning();
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: tenant, membershipId: member.id, role }).returning();
      out[key] = { cookie, membershipId: member.id, grantId: grant.id };
    }
    // The rabbi assigns "assigned" to the unrelated student; "bare" is the learner whose student record is Sibling B.
    await f.db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: f.students[2].id, tutorGrantId: out.assigned.grantId! });
    await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.students[1].id, roleGrantId: out.bare.grantId! });
    return out;
  });
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const cookieOf = (who: string) => who === "anonymous" ? "" : who in people ? people[who].cookie : f.identities[who as "admin"].cookie;
  async function send(path: string, who: string, init: { body?: unknown; headers?: Record<string, string>; origin?: string } = {}) {
    const headers = new Headers(init.headers), cookie = cookieOf(who), origin = init.origin ?? ORIGIN;
    if (cookie) headers.set("cookie", cookie);
    if (init.body !== undefined) { headers.set("origin", origin); headers.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${origin}${path}`, { method: init.body === undefined ? "GET" : "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }));
    return { status: response.status, cache: response.headers.get("cache-control"), json: await response.json() as Record<string, unknown> };
  }
  const booklet = (who: string, studentId: string, init: { headers?: Record<string, string>; origin?: string } = {}) => send(`/api/students/${studentId}/booklet`, who, init);
  return { f, people, send, booklet };
}

describe("who may open a student's booklet", () => {
  it("routes one GET under /api/students/{id}/booklet and nothing else", () => {
    expect(bookletRouteMethods(`/api/students/${randomUUID()}/booklet`)).toEqual(["GET"]);
    for (const path of ["/api/students/booklet", `/api/students/${randomUUID()}/booklet/x`, `/api/public/students/${randomUUID()}/booklet`]) expect(bookletRouteMethods(path), path).toBeNull();
  });

  it("opens for the learner, a linked parent, the assigned tutor and an admin, each through that person's own mode, and says only the mode and the tutor", async () => {
    const t = await setup(), [own, sibling, unrelated] = t.f.students;
    const learner = await t.booklet("learner", own.id);
    expect(learner.status).toBe(200);
    expect(learner.cache).toBe("private, no-store");
    expect(Object.keys(learner.json).sort()).toEqual(["mode", "ok", "tutor"]);
    expect(learner.json).toMatchObject({ ok: true, mode: "student" });
    expect(typeof learner.json.tutor).toBe("string");
    // multi is the siblings' parent (and a tutor too): a parent's booklet carries no tutor line.
    expect((await t.booklet("multi", sibling.id)).json).toEqual({ ok: true, mode: "parent", tutor: null });
    expect((await t.booklet("assigned", unrelated.id)).json).toEqual({ ok: true, mode: "tutor", tutor: "Synthetic Assigned" });
    expect((await t.booklet("admin", unrelated.id)).json).toEqual({ ok: true, mode: "admin", tutor: "Synthetic Assigned" });
    for (const response of [learner, await t.booklet("admin", own.id)]) expect(JSON.stringify(response.json)).not.toContain("@");
  });

  it("refuses with one 404: an unlinked parent, a tutor with no link, signed out, no membership, a guessed or malformed id, a practice handle, another congregation", async () => {
    const t = await setup(), [own, sibling, unrelated, other] = t.f.students;
    const refused: [string, string, { headers?: Record<string, string>; origin?: string }?][] = [
      ["multi", unrelated.id], // a parent of other children, and a tutor with no link to this one
      ["assigned", own.id], ["assigned", sibling.id], // a tutor, not this student's
      ["learner", sibling.id], // a learner, not this student
      ["anonymous", own.id], ["recipient", own.id], // signed out; signed in with no membership here
      ["admin", randomUUID()], ["admin", "not-a-student"], // a guessed id; a malformed one
      ["admin", own.id, { headers: { "X-Practice-Context": "x".repeat(43) } }],
      ["admin", other.id], // the other congregation's student, asked of this congregation's admin
      ["away", own.id, { origin: AWAY }], // the other congregation's admin, on its own host
    ];
    for (const [who, id, init] of refused) {
      const response = await t.booklet(who, id, init);
      expect(response.status, `${who} ${id}`).toBe(404);
      expect(response.json, `${who} ${id}`).not.toHaveProperty("mode");
    }
    expect((await t.send(`/api/students/${own.id}/booklet`, "admin", { body: {} })).status).toBe(405);
    // A disabled student is unknown to everyone.
    await t.f.owner(() => t.f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, unrelated.id)));
    expect((await t.booklet("admin", unrelated.id)).status).toBe(404);
    expect((await t.booklet("assigned", unrelated.id)).status).toBe(404);
  });

  it("opens for a tutor whose live claim made the link, closes under A1 when the learner is staff, and closes again once the claim is revoked", async () => {
    const t = await setup(), sibling = t.f.students[1];
    expect((await t.booklet("claimer", sibling.id)).status).toBe(404);
    const claimed = await t.send("/api/learners/claim", "claimer", { body: { learner: t.people.bare.membershipId } });
    expect(claimed.json).toMatchObject({ ok: true, created: true });
    expect((await t.booklet("claimer", sibling.id)).json).toEqual({ ok: true, mode: "tutor", tutor: "Synthetic Claimer" });
    // A1: a claim never opens a colleague's booklet. Give the learner a tutor grant and the claim-made link no longer counts.
    const [staff] = await t.f.owner(() => t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.people.bare.membershipId, role: "tutor" }).returning());
    expect((await t.booklet("claimer", sibling.id)).status).toBe(404);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, staff.id)));
    expect((await t.booklet("claimer", sibling.id)).status).toBe(200);
    // The learner ends the claim ("Not my tutor"): its link ends with it, and the tutor's booklet is 404.
    expect((await t.send("/api/mine/tutor/remove", "bare", { body: {} })).json).toEqual({ ok: true });
    expect((await t.booklet("claimer", sibling.id)).status).toBe(404);
    // The parent still opens it; the learner too.
    expect((await t.booklet("multi", sibling.id)).json).toMatchObject({ mode: "parent" });
    expect((await t.booklet("bare", sibling.id)).json).toMatchObject({ mode: "student" });
  });

  it("closes for a tutor whose grant is revoked, and for a parent whose link is revoked", async () => {
    const t = await setup(), [own, sibling, unrelated] = t.f.students;
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.people.assigned.grantId!)));
    expect((await t.booklet("assigned", unrelated.id)).status).toBe(404);
    await t.f.owner(() => t.f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.studentId, sibling.id)));
    expect((await t.booklet("multi", sibling.id)).status).toBe(404);
    // multi still reads own's booklet: the guardian link there is live.
    expect((await t.booklet("multi", own.id)).json).toMatchObject({ mode: "parent" });
  });
  it("is one 404 for everyone on a disabled student, and for an admin whose grant is revoked", async () => {
    const t = await setup(), [own, sibling] = t.f.students;
    await t.f.owner(() => t.f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, own.id)));
    for (const who of ["learner", "multi", "admin"]) expect((await t.booklet(who, own.id)).status, who).toBe(404);
    expect((await t.booklet("admin", sibling.id)).status).toBe(200);
    await t.f.owner(() => t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.adminGrant.id)));
    expect((await t.booklet("admin", sibling.id)).status).toBe(404);
  });

  it("opens a ceremony-done student's booklet for the learner, the parent and the admin, never for the tutor", async () => {
    const t = await setup(), sibling = t.f.students[1];
    expect((await t.send("/api/learners/claim", "claimer", { body: { learner: t.people.bare.membershipId } })).json).toMatchObject({ ok: true, created: true });
    expect((await t.booklet("claimer", sibling.id)).status).toBe(200);
    await t.f.owner(() => t.f.db.insert(s.studentCeremonyDone).values({ tenantId: "crc", studentId: sibling.id, setByGrantId: t.f.adminGrant.id }));
    expect((await t.booklet("bare", sibling.id)).json).toMatchObject({ mode: "student" });
    expect((await t.booklet("multi", sibling.id)).json).toMatchObject({ mode: "parent" });
    expect((await t.booklet("admin", sibling.id)).json).toMatchObject({ mode: "admin" });
    expect((await t.booklet("claimer", sibling.id)).status).toBe(404);
  });
});

describe("A1 on the tutor's existing reading route (fix round)", () => {
  it("refuses a tutor whose own claim made the link once the learner is staff, and keeps the rabbi's assignment open", async () => {
    const t = await setup(), [, sibling, unrelated] = t.f.students;
    const reading = (who: string, id: string) => t.send(`/api/students/${id}/reading?mode=tutor`, who);
    expect((await t.send("/api/learners/claim", "claimer", { body: { learner: t.people.bare.membershipId } })).json).toMatchObject({ ok: true, created: true });
    expect((await reading("claimer", sibling.id)).status).toBe(200);
    expect((await t.send("/api/students?mode=tutor&limit=100", "claimer")).json.students).toEqual([expect.objectContaining({ id: sibling.id })]);
    await t.f.owner(() => t.f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: t.people.bare.membershipId, role: "tutor" }));
    expect((await reading("claimer", sibling.id)).status).toBe(404);
    expect((await t.send("/api/students?mode=tutor&limit=100", "claimer")).json.students).toEqual([]);
    // The rabbi's assignment is unaffected, and so is a student whose learner is now staff when the rabbi assigned the tutor.
    expect((await reading("assigned", unrelated.id)).status).toBe(200);
  });
});
