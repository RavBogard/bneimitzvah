import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { handlePortalRequest, portalRouteMethods } from "../../src/server/http/portal";
import * as s from "../../src/server/db/index";

const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
async function fixture() { const f = await portalRoutesFixture(); open.push(f); return f; }
afterEach(async () => { vi.useRealTimers(); await Promise.all(open.splice(0).map(f => f.client.close())); });
const json = (response: Response) => response.json();
const active = { expectedState: "active" };
const path = (id: string) => `/api/admin/students/${id}/relationships`;

describe("relationship HTTP adapters with real authenticated sessions", () => {
  it("projects authorized tutor and current relationship DTOs without private identity fields", async () => {
    const f = await fixture();
    await f.owner(async () => { await f.db.update(s.user).set({ name: "Synthetic selection label" }).where(eq(s.user.id, f.identities.multi.id)); });
    const response = await f.call("/api/admin/tutors?limit=1", { who: "admin" }), list = await json(response);
    expect(response.status).toBe(200); expect(list.tutors).toHaveLength(1);
    expect(list.tutors[0]).toEqual({ id: f.tutorGrant.id, revision: 1, isCantor: false, displayName: "Synthetic selection label" });
    expect((await json(await f.call(`/api/admin/tutors?afterId=${f.tutorGrant.id}`, { who: "admin" }))).tutors).toHaveLength(0);
    const current = await json(await f.call(path(f.students[0].id), { who: "admin" }));
    expect(current.guardians).toHaveLength(1); expect(current.identities).toHaveLength(1); expect(current.tutors).toHaveLength(1);
    expect(current.guardians[0].displayName).toBe("Synthetic selection label");
    expect(current.student.disabled).toBe(false);
    const encoded = JSON.stringify({ list, current });
    for (const sentinel of ["@", f.identities.multi.id, f.identities.multi.sessionId, f.multiMember.id, "actorUserId", "linkProvenance", "parentEmail", "provider", "cookie"])
      expect(encoded.includes(sentinel)).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("assigns/unassigns an existing tutor and prevents stale immutable IDs from revoking a replacement", async () => {
    const f = await fixture(), p = `${path(f.students[1].id)}/tutors`;
    const created = await f.call(p, { who: "admin", body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } }), first = await json(created);
    expect(created.status).toBe(201); expect(first.studentId).toBe(f.students[1].id);
    expect((await f.call(p, { who: "admin", body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } })).status).toBe(409);
    expect((await f.call(`${p}/${first.id}/revoke`, { who: "admin", body: active })).status).toBe(200);
    const second = await json(await f.call(p, { who: "admin", body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } }));
    expect(second.id === first.id).toBe(false);
    const stale = await f.call(`${p}/${first.id}/revoke`, { who: "admin", body: active });
    expect(stale.status).toBe(409); expect((await json(stale)).code).toBe("stale-state");
    const current = await json(await f.call(path(f.students[1].id), { who: "admin" }));
    expect(current.tutors).toHaveLength(1); expect(current.tutors[0].id).toBe(second.id);
  });

  it("toggles practice with revision CAS and immediately invalidates only the selected guardian contexts", async () => {
    const f = await fixture();
    await f.owner(async () => { await f.db.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.id, f.guardians[0].id)); });
    const toggle = `${path(f.students[0].id)}/guardians/${f.guardians[0].id}/practice`;
    const enabled = await json(await f.call(toggle, { who: "admin", body: { expectedRevision: 1, practiceEnabled: true } }));
    expect(enabled).toEqual({ ok: true, id: f.guardians[0].id, revision: 2, practiceEnabled: true });
    const entered = await json(await f.call("/api/practice/enter", { body: { studentId: f.students[0].id } }));
    const sibling = await json(await f.call("/api/practice/enter", { body: { studentId: f.students[1].id } }));
    expect(typeof entered.handle).toBe("string");
    const disabled = await json(await f.call(toggle, { who: "admin", body: { expectedRevision: 2, practiceEnabled: false } }));
    expect(disabled.revision).toBe(3);
    expect((await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[0].id}`, { handle: entered.handle })).status).toBe(404);
    expect((await f.call(`/api/practice/read?mode=child-practice&studentId=${f.students[1].id}`, { handle: sibling.handle })).status).toBe(200);
    const stale = await f.call(toggle, { who: "admin", body: { expectedRevision: 1, practiceEnabled: true } });
    expect(stale.status).toBe(409); expect((await json(stale)).code).toBe("stale-state");
    expect((await f.call(`${path(f.students[0].id)}/guardians/${f.guardians[0].id}/revoke`, { who: "admin", body: active })).status).toBe(200);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=parent`)).status).toBe(404);
    expect((await f.call(`/api/students/${f.students[1].id}?mode=parent`)).status).toBe(200);
  });

  it("revokes an exact student identity while retaining independent parent access", async () => {
    const f = await fixture(), p = `${path(f.students[0].id)}/identities/${f.learnerLink.id}/revoke`;
    expect((await f.call(p, { who: "admin", body: active })).status).toBe(200);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=student`, { who: "learner" })).status).toBe(404);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=parent`)).status).toBe(200);
    expect((await f.call(p, { who: "admin", body: active })).status).toBe(409);
  });

  it("changes cantor metadata without granting authority and revokes only the explicit nonadmin grant", async () => {
    const f = await fixture(), cantor = `/api/admin/tutors/${f.tutorGrant.id}/cantor`, revoke = `/api/admin/grants/${f.tutorGrant.id}/revoke`;
    const changed = await json(await f.call(cantor, { who: "admin", body: { expectedRevision: 1, isCantor: true } }));
    expect(changed).toEqual({ ok: true, id: f.tutorGrant.id, revision: 2, isCantor: true });
    expect((await f.call(cantor, { who: "admin", body: { expectedRevision: 1, isCantor: false } })).status).toBe(409);
    expect((await f.call("/api/admin/tutors")).status).toBe(403);
    expect((await f.call(revoke, { who: "admin", body: { expectedRevision: 1, ...active } })).status).toBe(409);
    expect((await f.call(revoke, { who: "admin", body: { expectedRevision: 2, ...active } })).status).toBe(200);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=tutor`)).status).toBe(403);
    expect((await f.call(`/api/students/${f.students[0].id}?mode=parent`)).status).toBe(200);
    expect((await f.call(`/api/admin/grants/${f.adminGrant.id}/revoke`, { who: "admin", body: { expectedRevision: 1, ...active } })).status).toBe(403);
  });

  it("requires actual admin authority and exact tenant on every read and mutation", async () => {
    const f = await fixture();
    for (const who of ["multi", "learner", "recipient"] as const) {
      expect((await f.call("/api/admin/tutors", { who })).status).toBe(403);
      expect((await f.call(path(f.students[0].id), { who })).status).toBe(403);
      expect((await f.call(`${path(f.students[1].id)}/tutors`, { who, body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } })).status).toBe(403);
    }
    expect((await f.call("/api/admin/tutors", { who: "anonymous" })).status).toBe(401);
    expect((await f.call(path(f.students[3].id), { who: "admin" })).status).toBe(404);
    expect((await f.call(`${path(f.students[3].id)}/tutors`, { who: "admin", body: { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" } })).status).toBe(404);
    expect((await f.call("/api/admin/tutors", { who: "admin", origin: "http://localhost:3101" })).status).toBe(403);
    expect((await f.call(`${path(f.students[0].id)}/guardians/${f.guardians[1].id}/revoke`, { who: "admin", body: active })).status).toBe(404);
  });

  it("rejects child headers, wrong Origin/method and closed-contract violations before invoking mutations", async () => {
    const f = await fixture(), p = `${path(f.students[0].id)}/guardians/${f.guardians[0].id}/practice`;
    for (const target of ["/api/admin/tutors", path(f.students[0].id)]) expect((await f.call(target, { who: "admin", handle: "" })).status).toBe(403);
    expect((await f.call(p, { who: "admin", handle: "forged", body: { expectedRevision: 1, practiceEnabled: false } })).status).toBe(403);
    expect((await f.call(p, { who: "admin", headers: { origin: "https://evil.example.test" }, body: { expectedRevision: 1, practiceEnabled: false } })).status).toBe(403);
    const missingOrigin = f.request(p, { who: "admin", body: { expectedRevision: 1, practiceEnabled: false } }); missingOrigin.headers.delete("origin");
    expect((await handlePortalRequest(missingOrigin, f.runtime))?.status).toBe(403);
    const wrongMethod = await f.call(p, { who: "admin" }); expect(wrongMethod.status).toBe(405); expect(wrongMethod.headers.get("allow")).toBe("POST");
    for (const extra of ["mode", "actor", "tenantId", "sessionId"]) {
      expect((await f.call(p, { who: "admin", body: { expectedRevision: 1, practiceEnabled: false, [extra]: "claimed" } })).status).toBe(400);
      expect((await f.call(`/api/admin/tutors?${extra}=claimed`, { who: "admin" })).status).toBe(400);
    }
    for (const body of [{ expectedRevision: 0, practiceEnabled: false }, { expectedRevision: 1, practiceEnabled: "true" }, { expectedRevision: 1 }])
      expect((await f.call(p, { who: "admin", body })).status).toBe(400);
    expect((await f.call("/api/admin/tutors?limit=101", { who: "admin" })).status).toBe(400);
    expect((await f.call("/api/admin/tutors?limit=1&limit=2", { who: "admin" })).status).toBe(400);
    expect((await f.call(`${path(f.students[0].id)}/identities/${f.learnerLink.id}/practice`, { who: "admin", body: {} })).status).toBe(404);
    expect(portalRouteMethods(p)).toEqual(["POST"]);
  });

  it("retains nonfresh reads, requires fresh writes, and rechecks late actor revocation", async () => {
    const f = await fixture();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    expect((await f.call("/api/admin/tutors", { who: "admin" })).status).toBe(200);
    expect((await f.call(path(f.students[0].id), { who: "admin" })).status).toBe(200);
    expect((await f.call(`/api/admin/tutors/${f.tutorGrant.id}/cantor`, { who: "admin", body: { expectedRevision: 1, isCantor: true } })).status).toBe(403);
    vi.useRealTimers();
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
    expect((await f.call("/api/admin/tutors", { who: "admin" })).status).toBe(403);
  });
});
