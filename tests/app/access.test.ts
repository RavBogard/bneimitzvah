import { afterEach, describe, expect, it, vi } from "vitest";
// Marker-only replacement is local to this test module. No application runtime
// flag or identity/header bypass is provided, including in production builds.
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createAccessService } from "../../src/server/access/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import type { ActiveMode } from "../../src/server/access/types";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
async function fixture() { const f = await accessFixture(); fixtures.push(f); return f; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });
it("projects own-adult honors only after the live student identity and locked kind check", async () => {
  const f = await fixture(), list = () => f.service.listStudents(f.request("learner"), { mode: "student" });
  expect((await list())[0].ownAdultHonors).toBe(false);
  await f.owner(() => f.db.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic-adult@example.test" }).where(eq(s.student.id, f.students[0].id)));
  const own = await list(); expect(own).toHaveLength(1); expect(own[0]).toMatchObject({ id: f.students[0].id, ownAdultHonors: true });
  expect(Object.keys(own[0]).sort()).toEqual(["id", "firstName", "lastName", "ceremonyDate", "rehearsal1", "rehearsal2", "serviceSlot", "revision", "ownAdultHonors"].sort());
  for (const [who, mode] of [["multi", "parent"], ["multi", "tutor"], ["admin", "admin"]] as const) expect((await f.service.listStudents(f.request(who), { mode })).every(row => row.ownAdultHonors === false)).toBe(true);
  const delegated = f.request("learner"); delegated.headers.set("X-Practice-Context", "synthetic"); expect(await denied(() => f.service.listStudents(delegated, { mode: "student" }), 403)).toBe(true);
  await f.owner(() => f.db.update(s.student).set({ studentKind: "child" }).where(eq(s.student.id, f.students[0].id))); expect((await list())[0].ownAdultHonors).toBe(false);
  await f.owner(() => f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id))); expect(await list()).toEqual([]);
});
async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}
async function constraint(action: () => PromiseLike<unknown>, code: string) {
  try { await action(); return false; } catch (error) { const e = error as { code?: string; cause?: { code?: string } }; return (e.cause?.code ?? e.code) === code; }
}

describe("exact host and database-live access", () => {
  it("maps only normalized exact host/origin/environment/deployment tuples", async () => {
    const f = await fixture();
    const mapping = await resolveTenantHost(f.db, f.request("admin", "http://LOCALHOST:3000", { host: "LOCALHOST:3000", "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http" }), { environment: "test", deployment: "suite" });
    expect(mapping.tenantId === "crc").toBe(true);
    const production = await resolveTenantHost(f.db, f.request("admin", "https://bneimitzvah.centralreform.org"), { environment: "production", deployment: "production" });
    expect(production.origin === "https://bneimitzvah.centralreform.org").toBe(true);
    const preview = await resolveTenantHost(f.db, f.request("admin", "https://preview-a.example.test"), { environment: "preview", deployment: "preview-a" });
    expect(preview.tenantId === "crc").toBe(true);
    for (const scope of [{ environment: "test" as const, deployment: "wrong" }, { environment: "production" as const, deployment: "suite" }]) {
      expect(await denied(() => resolveTenantHost(f.db, f.request("admin"), scope), 404)).toBe(true);
    }
  });

  it("denies unknown, alias, malformed and forged forwarded hosts without fallback", async () => {
    const f = await fixture();
    const invalid = [
      f.request("admin", "https://unknown.example.test"), f.request("admin", "https://bneimitzvah.vercel.app"),
      f.request("admin", "https://preview-b.example.test"), f.request("admin", "http://localhost:99999"),
      f.request("admin", "http://localhost.:3000"), f.request("admin", "http://user@localhost:3000"),
      f.request("admin", "http://%6cocalhost:3000"), f.request("admin", "http://localhost:3001"),
      f.request("admin", "http://localhost:3000", { host: "localhost:3101" }),
      f.request("admin", "http://localhost:3000", { host: "" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-host": "localhost:3101" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-host": "localhost:3000,localhost:3101" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-host": "" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-proto": "https" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-port": "3101" }),
      f.request("admin", "http://localhost:3101", { host: "localhost:3000", forwarded: "host=localhost:3000" }),
    ];
    for (const request of invalid) expect(await denied(() => f.service.listStudents(request, { mode: "admin" }), 404)).toBe(true);
  });

  it("discards RFC Forwarded before real SDK identity lookup while preserving cookies and exact-tenant grants", async () => {
    const f = await fixture();
    let lookups = 0;
    const api = new Proxy(f.auth.api, { get(target, key, receiver) {
      if (key !== "getSession") return Reflect.get(target, key, receiver);
      return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
        lookups++;
        if (!options) throw new Error("Synthetic identity lookup requires options");
        const headers = new Headers(options.headers);
        expect(headers.has("forwarded")).toBe(false);
        expect(headers.get("cookie")).toBe(f.identities.admin.cookie);
        expect(options.query).toEqual({ disableCookieCache: true, disableRefresh: true });
        return target.getSession(options);
      };
    } });
    const service = createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } });
    const metadata = "host=localhost:3101;proto=https, for=unknown;extension=synthetic-private";
    const input = f.request("admin", "http://localhost:3000", { Forwarded: metadata });
    const rows = await service.listStudents(input, { mode: "admin" });
    expect(rows.map(row => row.id).sort()).toEqual(f.students.slice(0, 3).map(row => row.id).sort());
    expect(input.headers.get("forwarded")).toBe(metadata);
    expect(lookups).toBe(1);
    for (const request of [
      f.request("admin", "https://unknown.example.test", { forwarded: "host=localhost:3000" }),
      f.request("admin", "http://localhost:3000", { "x-forwarded-host": "localhost:3101", forwarded: "host=localhost:3000" }),
    ]) expect(await denied(() => service.listStudents(request, { mode: "admin" }), 404)).toBe(true);
    expect(lookups).toBe(1);
  });

  it("enforces four roles, parent+tutor mode separation and scoped rosters", async () => {
    const f = await fixture();
    const matrix: ["admin" | "multi" | "learner", ActiveMode, number[]][] = [
      ["admin", "admin", [0, 1, 2]], ["multi", "parent", [0, 1]], ["multi", "tutor", [0]], ["learner", "student", [0]],
    ];
    for (const [who, mode, visible] of matrix) {
      const rows = await f.service.listStudents(f.request(who), { mode });
      expect(rows.length === visible.length && rows.every((row) => visible.some((index) => f.students[index].id === row.id))).toBe(true);
      for (let index = 0; index < f.students.length; index++) {
        if (visible.includes(index)) expect((await f.service.readStudent(f.request(who), { mode, studentId: f.students[index].id })).id === f.students[index].id).toBe(true);
        else expect(await denied(() => f.service.readStudent(f.request(who), { mode, studentId: f.students[index].id }), 404)).toBe(true);
      }
    }
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "admin" }), 403)).toBe(true);
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "child-practice" as ActiveMode }), 403)).toBe(true);
  });

  it("allows reading writes only for assigned tutor/admin and no parent union authority", async () => {
    const f = await fixture();
    for (const mode of ["parent", "student"] as const) {
      const who = mode === "parent" ? "multi" : "learner";
      let called = false;
      expect(await denied(() => f.service.withStudentCapability(f.request(who), { mode, studentId: f.students[0].id, capability: "set-reading" }, async () => { called = true; }), 403)).toBe(true);
      expect(called).toBe(false);
    }
    expect(await f.service.withStudentCapability(f.request("multi"), { mode: "tutor", studentId: f.students[0].id, capability: "set-reading" }, async () => true)).toBe(true);
    expect(await denied(() => f.service.withStudentCapability(f.request("multi"), { mode: "tutor", studentId: f.students[1].id, capability: "set-reading" }, async () => true), 404)).toBe(true);
    for (const capability of ["manage-students", "manage-invites", "manage-relationships", "manage-defaults"] as const) {
      expect(await f.service.withAdminCapability(f.request("admin"), { mode: "admin", capability }, async () => true)).toBe(true);
      expect(await denied(() => f.service.withAdminCapability(f.request("multi"), { mode: "tutor", capability }, async () => true), 403)).toBe(true);
    }
  });

  it("binds the same global identity to this host's grants, never the other tenant's mode", async () => {
    const f = await fixture();
    const request = f.request("multi", "http://localhost:3101");
    const ownOtherTenant = await f.service.listStudents(request, { mode: "student" });
    expect(ownOtherTenant.length === 1 && ownOtherTenant.every((row) => row.id === f.students[3].id)).toBe(true);
    expect(await denied(() => f.service.listStudents(request, { mode: "parent" }), 403)).toBe(true);
    expect(await denied(() => f.service.readStudent(request, { mode: "student", studentId: f.students[0].id }), 404)).toBe(true);
    for (const studentId of [f.students[3].id, crypto.randomUUID(), "malformed"]) expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "parent", studentId }), 404)).toBe(true);
  });

  it("uses actual signed cookies and live session/user checks, ignoring actor headers", async () => {
    const f = await fixture();
    expect(await denied(() => f.service.listStudents({ url: "http://localhost:3000/students", headers: new Headers({ "x-user-id": f.identities.admin.id, "x-test-user": "admin" }) }, { mode: "admin" }), 401)).toBe(true);
    const tampered = f.request("admin"); tampered.headers.set("cookie", `${tampered.headers.get("cookie")}tampered`);
    expect(await denied(() => f.service.listStudents(tampered, { mode: "admin" }), 401)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.admin.id)); });
    expect(await denied(() => f.service.listStudents(f.request("admin"), { mode: "admin" }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, f.identities.admin.id)); await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    expect(await denied(() => f.service.listStudents(f.request("admin"), { mode: "admin" }), 401)).toBe(true);
  });

  it("rechecks revoked links/grants and disabled membership/student/tenant every call", async () => {
    const f = await fixture();
    await f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id });
    await f.owner(async () => { await f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id)); await f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)); await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)); });
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[0].id }), 404)).toBe(true);
    expect((await f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[1].id })).id === f.students[1].id).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "tutor", studentId: f.students[0].id }), 404)).toBe(true);
    expect(await denied(() => f.service.readStudent(f.request("learner"), { mode: "student", studentId: f.students[0].id }), 404)).toBe(true);
    await f.owner(async () => { await f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, f.students[1].id)); });
    expect(await denied(() => f.service.readStudent(f.request("multi"), { mode: "parent", studentId: f.students[1].id }), 404)).toBe(true);
    await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.parentGrant.id)); });
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "parent" }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.membership).set({ disabledAt: new Date() }).where(eq(s.membership.id, f.adminMember.id)); });
    expect(await denied(() => f.service.listStudents(f.request("admin"), { mode: "admin" }), 403)).toBe(true);
    await f.owner(async () => { await f.db.update(s.tenant).set({ enabled: false }).where(eq(s.tenant.id, "crc")); });
    expect(await denied(() => f.service.listStudents(f.request("learner"), { mode: "student" }), 404)).toBe(true);
  });

  it("denies a revoked real session and enforces freshness on authority capabilities", async () => {
    const f = await fixture();
    await f.owner(async () => { await f.db.update(s.session).set({ createdAt: new Date(Date.now() - 16 * 60_000) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    expect(await denied(() => f.service.withAdminCapability(f.request("admin"), { mode: "admin", capability: "manage-relationships" }, async () => true), 403)).toBe(true);
    expect(await denied(() => f.service.withAdminCapability(f.request("admin"), { mode: "admin", capability: "manage-invites" }, async () => true), 403)).toBe(true);
    expect((await f.service.listStudents(f.request("admin"), { mode: "admin" })).length === 3).toBe(true);
    await f.auth.api.signOut({ headers: new Headers({ cookie: f.identities.multi.cookie }) });
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "parent" }), 401)).toBe(true);
  });

  it("rechecks live identity after the real auth adapter returned a valid session proof", async () => {
    const f = await fixture();
    let sawRealProof = false;
    let expireSession = true;
    // Instrument the public composition boundary, not Better Auth internals:
    // read the real signed-cookie proof, mutate the actual DB, return that same
    // now-stale proof. No user/session is fabricated by this test.
    const api = new Proxy(f.auth.api, {
      get(target, property, receiver) {
        if (property !== "getSession") return Reflect.get(target, property, receiver);
        return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
          const proof = await target.getSession(options);
          sawRealProof = Boolean(proof);
          await f.owner(async () => {
            if (expireSession) await f.db.update(s.session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.session.id, f.identities.admin.sessionId));
            else await f.db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, f.identities.admin.id));
          });
          return proof;
        };
      },
    });
    const service = createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } });
    expect(await denied(() => service.listStudents(f.request("admin"), { mode: "admin" }), 401)).toBe(true);
    expect(sawRealProof).toBe(true);
    await f.owner(async () => { await f.db.update(s.session).set({ expiresAt: new Date(Date.now() + 3600_000) }).where(eq(s.session.id, f.identities.admin.sessionId)); });
    expireSession = false;
    expect(await denied(() => service.listStudents(f.request("admin"), { mode: "admin" }), 403)).toBe(true);
    expect(sawRealProof).toBe(true);
  });

  it("runs scoped writes and audit in one restricted transaction, rolling back callback failures", async () => {
    const f = await fixture();
    let sawScope = false;
    let completedWrites = false;
    try {
      await f.service.withStudentCapability(f.request("multi"), { mode: "tutor", studentId: f.students[0].id, capability: "set-reading" }, async (tx, actor) => {
        const result = await tx.execute<{ tenant_id: string; actor_role: string }>(sql`select current_setting('app.tenant_id',true) tenant_id,current_user actor_role`);
        sawScope = result.rows[0].tenant_id === "crc" && result.rows[0].actor_role === "portal_runtime";
        await tx.insert(s.assignment).values({ tenantId: actor.tenantId, studentId: actor.studentId, kind: "torah", basis: "custom", ref: "Genesis 1:1", setByMembershipId: actor.membershipId });
        await tx.insert(s.auditEvent).values({ tenantId: actor.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId, roleGrantId: actor.roleGrantId, mode: actor.mode, action: "reading.set", targetType: "student", targetId: actor.studentId, requestId: crypto.randomUUID() });
        completedWrites = true;
        throw new Error("Synthetic callback failure");
      });
    } catch (error) { expect(error instanceof AccessUnavailable).toBe(true); }
    expect(sawScope).toBe(true);
    expect(completedWrites).toBe(true);
    await f.owner(async () => { expect((await f.db.select().from(s.assignment)).length === 0).toBe(true); expect((await f.db.select().from(s.auditEvent)).length === 0).toBe(true); });
  });

  it("grants only tenant customs updates needed for row locking, never enabled/id/host changes", async () => {
    const f = await fixture();
    await withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => { await tx.select().from(s.tenant).where(eq(s.tenant.id, "crc")).for("share"); await tx.update(s.tenant).set({ customs: { synthetic: true } }).where(eq(s.tenant.id, "crc")); });
    for (const change of [{ enabled: false }, { id: "changed" }]) expect(await constraint(() => withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => tx.update(s.tenant).set(change).where(eq(s.tenant.id, "crc"))), "42501")).toBe(true);
    expect(await constraint(() => f.db.update(s.tenantHost).set({ host: "attacker.example.test" }), "42501")).toBe(true);
    const rows = await withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => tx.update(s.tenant).set({ customs: { denied: true } }).where(eq(s.tenant.id, "other")).returning());
    expect(rows.length === 0).toBe(true);
  });

  it("rejects broad predefined role membership and malformed pagination without privileged fallback", async () => {
    const f = await fixture();
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "parent", limit: 101 }), 403)).toBe(true);
    expect(await denied(() => f.service.listStudents(f.request("multi"), { mode: "parent", afterId: "invalid" }), 403)).toBe(true);
    const page = await f.service.listStudents(f.request("multi"), { mode: "parent", limit: 1 });
    const next = await f.service.listStudents(f.request("multi"), { mode: "parent", afterId: page[0].id, limit: 1 });
    expect(page.length === 1 && next.length === 1 && page[0].id !== next[0].id).toBe(true);
    await f.owner(async () => { await f.client.exec("GRANT pg_write_all_data TO access_login"); });
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async () => true)).rejects.toThrow("Restricted nonowner runtime role required");
    await f.client.exec("SET ROLE pg_write_all_data");
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async () => true)).rejects.toThrow("Restricted nonowner runtime role required");
    await f.client.exec("SET ROLE portal_runtime");
    // A fresh service instance does not change the database credential check.
    const service = createAccessService({ db: f.db, auth: f.auth, deployment: { environment: "test", deployment: "suite" } });
    try { await service.listStudents(f.request("admin"), { mode: "admin" }); expect(false).toBe(true); }
    catch (error) { expect(error instanceof AccessUnavailable).toBe(true); }
  });
});
