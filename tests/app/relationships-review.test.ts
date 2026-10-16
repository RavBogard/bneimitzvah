import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { relationshipsFixture } from "./relationships-fixture";
import { createAccessService } from "../../src/server/access/service";
import { createRelationshipService } from "../../src/server/relationships/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";

async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}

test("review: exact guardian revocation preserves a different authenticated parent's context for the same child", async () => {
  const f = await relationshipsFixture();
  try {
    let secondCookie = "";
    await f.owner(async () => {
      secondCookie = (await f.signIn("review-second-parent@example.test")).cookie;
      const proof = await f.auth.api.getSession({ headers: new Headers({ cookie: secondCookie }), query: { disableRefresh: true, disableCookieCache: true } });
      if (!proof) throw new Error("Synthetic second parent session missing");
      const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: proof.user.id }).returning();
      const [grant] = await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "parent" }).returning();
      await f.db.insert(s.guardian).values({ tenantId: "crc", studentId: f.students[0].id, parentGrantId: grant.id, linkProvenance: "synthetic-review" });
    });
    const a = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const a2 = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const second = () => f.request("multi", undefined, { cookie: secondCookie });
    const b = await f.practice.enter(second(), { studentId: f.students[0].id });
    const result = await f.relationships.revokeGuardian(f.request("admin"), { mode: "admin", expectedState: "active", studentId: f.students[0].id, linkId: f.guardians[0].id });
    expect(result.ok).toBe(true);
    for (const old of [a, a2]) expect(await denied(() => f.practice.read(f.request("multi", old.handle), { mode: "child-practice", studentId: f.students[0].id }), 404)).toBe(true);
    const current = await f.practice.read(f.request("multi", b.handle, { cookie: secondCookie }), { mode: "child-practice", studentId: f.students[0].id });
    expect(current.context?.id === b.context.id).toBe(true);
    expect((await f.service.readStudent(f.request("learner"), { mode: "student", studentId: f.students[0].id })).id === f.students[0].id).toBe(true);
    await f.owner(async () => {
      const contexts = await f.db.select().from(s.practiceContext);
      expect(contexts.length === 3 && contexts.filter(row => row.revokedAt !== null).length === 2
        && contexts.find(row => row.id === b.context.id)?.revokedAt === null).toBe(true);
    });
  } finally { await f.client.close(); }
});

test("review: a genuine SDK proof cannot authorize relationship mutation after its admin grant is revoked", async () => {
  const f = await relationshipsFixture();
  try {
    let sawRealProof = false;
    const api = new Proxy(f.auth.api, { get(target, key, receiver) {
      if (key !== "getSession") return Reflect.get(target, key, receiver);
      return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
        const proof = await target.getSession(options);
        sawRealProof = Boolean(proof);
        await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
        return proof;
      };
    } });
    const relationships = createRelationshipService({ access: createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } }) });
    expect(await denied(() => relationships.setGuardianPractice(f.request("admin"), { mode: "admin", studentId: f.students[0].id,
      guardianId: f.guardians[0].id, expectedRevision: 1, practiceEnabled: false }), 403)).toBe(true);
    expect(sawRealProof).toBe(true);
    await f.owner(async () => {
      const [link] = await f.db.select().from(s.guardian).where(eq(s.guardian.id, f.guardians[0].id));
      expect(link.revision === 1 && link.practiceEnabled && link.revokedAt === null).toBe(true);
      expect((await f.db.select().from(s.auditEvent)).length).toBe(0);
    });
  } finally { await f.client.close(); }
});

test("review: failed grant-revocation audit rolls back completed grant and context writes", async () => {
  const f = await relationshipsFixture();
  try {
    const a = await f.practice.enter(f.request(), { studentId: f.students[0].id });
    const b = await f.practice.enter(f.request(), { studentId: f.students[1].id });
    await f.owner(async () => {
      await f.client.exec(`CREATE SEQUENCE synthetic_review_completed_writes;
        GRANT USAGE ON SEQUENCE synthetic_review_completed_writes TO portal_runtime;
        CREATE FUNCTION synthetic_review_grant_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action='grant.revoke' THEN
            IF EXISTS (SELECT 1 FROM role_grant WHERE id::text=NEW.target_id AND revoked_at IS NOT NULL)
              AND (SELECT count(*) FROM practice_context WHERE role_grant_id::text=NEW.target_id AND revoked_at IS NOT NULL)=2 THEN
              PERFORM nextval('synthetic_review_completed_writes');
            END IF;
            RAISE EXCEPTION 'Synthetic reviewer audit failure';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER synthetic_review_grant_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION synthetic_review_grant_audit_failure()`);
    });
    let safeFailure = false;
    try { await f.relationships.revokeRoleGrant(f.request("admin"), { mode: "admin", expectedState: "active", expectedRevision: 1, roleGrantId: f.parentGrant.id }); }
    catch (error) { safeFailure = error instanceof AccessUnavailable; }
    expect(safeFailure).toBe(true);
    await f.owner(async () => {
      // Sequence advancement survives transaction rollback: this proves both
      // writes completed, so an earlier SQL permission failure cannot pass.
      const marker = await f.client.query<{ is_called: boolean }>("SELECT is_called FROM synthetic_review_completed_writes");
      expect(marker.rows[0].is_called).toBe(true);
      const [grant] = await f.db.select().from(s.roleGrant).where(eq(s.roleGrant.id, f.parentGrant.id));
      expect(grant.revokedAt === null && grant.revision === 1).toBe(true);
      const contexts = await f.db.select().from(s.practiceContext);
      expect(contexts.length === 2 && contexts.every(row => row.revokedAt === null)).toBe(true);
      expect((await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "grant.revoke"))).length).toBe(0);
    });
    for (const [context, child] of [[a, f.students[0]], [b, f.students[1]]] as const) {
      expect((await f.practice.read(f.request("multi", context.handle), { mode: "child-practice", studentId: child.id })).context?.id === context.context.id).toBe(true);
    }
  } finally { await f.client.close(); }
});
