import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import * as s from "../../src/server/db/index";

test("review: all nine relationship routes retain literal admin authority and reject extra claims and child headers", async () => {
  const f = await portalRoutesFixture();
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const base = `/api/admin/students/${f.students[0].id}/relationships`;
    const routes: [string, Record<string, unknown> | undefined][] = [
      ["/api/admin/tutors", undefined], [base, undefined],
      [`${base}/tutors`, { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" }],
      [`${base}/tutors/${f.tutorLink.id}/revoke`, { expectedState: "active" }],
      [`${base}/guardians/${f.guardians[0].id}/revoke`, { expectedState: "active" }],
      [`${base}/identities/${f.learnerLink.id}/revoke`, { expectedState: "active" }],
      [`${base}/guardians/${f.guardians[0].id}/practice`, { expectedRevision: 1, practiceEnabled: false }],
      [`/api/admin/grants/${f.parentGrant.id}/revoke`, { expectedRevision: 1, expectedState: "active" }],
      [`/api/admin/tutors/${f.tutorGrant.id}/cantor`, { expectedRevision: 1, isCantor: true }],
    ];
    for (const [path, body] of routes) {
      // This account already owns the parent/tutor targets; those roles must not union into admin.
      expect((await dispatch(f.request(path, { body }))).status).toBe(403);
      expect((await dispatch(f.request(path, { who: "admin", body, handle: "" }))).status).toBe(403);
      const claimed = body === undefined ? f.request(`${path}?mode=admin`, { who: "admin" })
        : f.request(path, { who: "admin", body: { ...body, mode: "admin", tenantId: "crc" } });
      expect((await dispatch(claimed)).status).toBe(400);
    }
    await f.owner(async () => {
      expect((await f.db.select().from(s.auditEvent)).length).toBe(0);
      const [guardian] = await f.db.select().from(s.guardian).where(eq(s.guardian.id, f.guardians[0].id));
      const [grant] = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.id, f.parentGrant.id));
      expect(guardian.revokedAt === null && guardian.practiceEnabled && guardian.revision === 1 && grant.revokedAt === null && grant.revision === 1).toBe(true);
    });
  } finally { await f.client.close(); }
});

test("review: adapter rejects foreign grants and permits disabled-student cleanup without enabling new authority", async () => {
  const f = await portalRoutesFixture();
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const base = `/api/admin/students/${f.students[0].id}/relationships`;
    let foreignGrantId = "";
    await f.owner(async () => {
      const [member] = await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "tutor" }).returning();
      foreignGrantId = grant.id;
    });
    const adminCall = (path: string, body?: Record<string, unknown>) => dispatch(f.request(path, { who: "admin", body }));
    expect((await adminCall(`${base}/tutors`, { tutorGrantId: foreignGrantId, expectedState: "unassigned" })).status).toBe(404);
    expect((await adminCall(`/api/admin/grants/${foreignGrantId}/revoke`, { expectedRevision: 1, expectedState: "active" })).status).toBe(404);
    expect((await adminCall(`/api/admin/tutors/${foreignGrantId}/cantor`, { expectedRevision: 1, isCantor: true })).status).toBe(404);
    await f.owner(async () => {
      const [grant] = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.id, foreignGrantId));
      expect(grant.revokedAt === null && grant.revision === 1 && !grant.isCantor).toBe(true);
      expect((await f.db.select().from(s.auditEvent)).length).toBe(0);
      await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[0].id));
    });
    const inspected = await adminCall(base);
    expect(inspected.status).toBe(200);
    expect((await inspected.json()).student.disabled).toBe(true);
    expect((await adminCall(`${base}/tutors`, { tutorGrantId: f.tutorGrant.id, expectedState: "unassigned" })).status).toBe(404);
    const flag = `${base}/guardians/${f.guardians[0].id}/practice`;
    expect((await adminCall(flag, { expectedRevision: 1, practiceEnabled: true })).status).toBe(404);
    expect((await adminCall(flag, { expectedRevision: 1, practiceEnabled: false })).status).toBe(200);
    for (const path of [`${base}/tutors/${f.tutorLink.id}/revoke`, `${base}/guardians/${f.guardians[0].id}/revoke`, `${base}/identities/${f.learnerLink.id}/revoke`]) {
      expect((await adminCall(path, { expectedState: "active" })).status).toBe(200);
      const stale = await adminCall(path, { expectedState: "active" });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ ok: false, code: "stale-state" });
    }
    expect((await adminCall(flag, { expectedRevision: 3, practiceEnabled: true })).status).toBe(409);
    const current = await (await adminCall(base)).json();
    expect(current.student.disabled && current.guardians.length === 0 && current.identities.length === 0 && current.tutors.length === 0).toBe(true);
  } finally { await f.client.close(); }
});
