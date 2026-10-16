import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";

const clients: PGlite[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((value) => value.close())); });

async function fixture() {
  const client = new PGlite(); clients.push(client);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "src/server/db/migrations" });
  await db.insert(schema.tenant).values({ id: "other", name: "Synthetic congregation", productName: "Synthetic portal" });
  await db.insert(schema.user).values([
    { id: "actor-a", name: "Synthetic parent tutor", email: "actor-a@example.test" },
    { id: "actor-b", name: "Synthetic other", email: "actor-b@example.test" },
  ]);
  const [memberA] = await db.insert(schema.membership).values({ tenantId: "crc", userId: "actor-a" }).returning();
  const [memberB] = await db.insert(schema.membership).values({ tenantId: "other", userId: "actor-b" }).returning();
  const [parent] = await db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: memberA.id, role: "parent" }).returning();
  const [tutor] = await db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: memberA.id, role: "tutor" }).returning();
  const [otherParent] = await db.insert(schema.roleGrant).values({ tenantId: "other", membershipId: memberB.id, role: "parent" }).returning();
  const students = await db.insert(schema.student).values([
    { tenantId: "crc", firstName: "Synthetic", lastName: "Sibling A", ceremonyDate: "2027-01-02", parentEmail: "shared@example.test" },
    { tenantId: "crc", firstName: "Synthetic", lastName: "Sibling B", ceremonyDate: "2027-01-02", parentEmail: "shared@example.test" },
    { tenantId: "other", firstName: "Synthetic", lastName: "Other", ceremonyDate: "2027-01-02", parentEmail: "other@example.test" },
  ]).returning();
  const [guardian] = await db.insert(schema.guardian).values({ tenantId: "crc", studentId: students[0].id, parentGrantId: parent.id, linkProvenance: "synthetic-invite" }).returning();
  return { client, db, memberA, memberB, parent, tutor, otherParent, students, guardian };
}

// Expected constraint errors are reduced to SQLSTATE, keeping fixture contacts,
// hashes and statement parameters out of test failure output.
async function fails(operation: () => PromiseLike<unknown>, code = "23503") {
  try { await operation(); return false; }
  catch (error) {
    const outer = error as { code?: string; cause?: { code?: string } };
    return (outer.cause?.code ?? outer.code) === code;
  }
}

describe("tenant schema and transaction boundary", () => {
  it("migrates a fresh database and a repeat runner without duplicate CRC or constraints", async () => {
    const f = await fixture();
    await migrate(f.db, { migrationsFolder: "src/server/db/migrations" });
    expect((await f.db.select().from(schema.tenant).where(eq(schema.tenant.id, "crc"))).length === 1).toBe(true);
    const state = await f.client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('student','membership','practice_context','audit_event')",
    );
    expect(state.rows.length === 4 && state.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const hosts = await f.db.select().from(schema.tenantHost);
    expect(hosts.length === 1 && hosts[0].host === "bneimitzvah.centralreform.org").toBe(true);
  });

  it("supports siblings and parent+tutor grants while rejecting duplicate active grants and changed authority", async () => {
    const f = await fixture();
    expect(f.students.filter((value) => value.tenantId === "crc").length === 2).toBe(true);
    expect(await fails(() => f.db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: f.memberA.id, role: "parent" }), "23505")).toBe(true);
    expect(await fails(() => f.db.update(schema.roleGrant).set({ role: "admin" }).where(eq(schema.roleGrant.id, f.parent.id)), "23514")).toBe(true);
    await f.db.update(schema.roleGrant).set({ revokedAt: new Date() }).where(eq(schema.roleGrant.id, f.parent.id));
    expect(await fails(() => f.db.update(schema.roleGrant).set({ revokedAt: null }).where(eq(schema.roleGrant.id, f.parent.id)), "23514")).toBe(true);
    await f.db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: f.memberA.id, role: "parent" });
    expect(await fails(() => f.db.update(schema.membership).set({ tenantId: "other" }).where(eq(schema.membership.id, f.memberA.id)), "23514")).toBe(true);
  });

  it("enforces tenant composites for memberships, guardians, tutors, identities and invitation targets", async () => {
    const f = await fixture();
    const operations = [
      () => f.db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: f.memberB.id, role: "parent" }),
      () => f.db.insert(schema.guardian).values({ tenantId: "crc", studentId: f.students[2].id, parentGrantId: f.parent.id, linkProvenance: "synthetic" }),
      () => f.db.insert(schema.guardian).values({ tenantId: "crc", studentId: f.students[1].id, parentGrantId: f.otherParent.id, linkProvenance: "synthetic" }),
      () => f.db.insert(schema.tutorStudent).values({ tenantId: "other", studentId: f.students[2].id, tutorGrantId: f.tutor.id }),
      () => f.db.insert(schema.studentIdentity).values({ tenantId: "crc", studentId: f.students[2].id, roleGrantId: f.parent.id }),
      () => f.db.insert(schema.invite).values({ tenantId: "crc", tokenHash: randomBytes(32).toString("hex"), email: "shared@example.test", role: "parent", studentId: f.students[2].id, inviterMembershipId: f.memberA.id, expiresAt: new Date(Date.now() + 72 * 3600_000) }),
    ];
    for (const operation of operations) expect(await fails(operation)).toBe(true);
  });

  it("requires the correct grant role for guardian, tutor and individual-student links", async () => {
    const f = await fixture();
    expect(await fails(() => f.db.insert(schema.guardian).values({ tenantId: "crc", studentId: f.students[1].id, parentGrantId: f.tutor.id, linkProvenance: "synthetic" }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.tutorStudent).values({ tenantId: "crc", studentId: f.students[1].id, tutorGrantId: f.parent.id }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.studentIdentity).values({ tenantId: "crc", studentId: f.students[1].id, roleGrantId: f.parent.id }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.roleGrant).values({ tenantId: "crc", membershipId: f.memberA.id, role: "student", isCantor: true }), "23514")).toBe(true);
  });

  it("binds context to actual session, actor, grant and exact guardian-child pair", async () => {
    const f = await fixture();
    await f.db.insert(schema.session).values([
      { id: "session-a", userId: "actor-a", token: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date() },
      { id: "session-b", userId: "actor-b", token: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 3600_000), updatedAt: new Date() },
    ]);
    const context = { tenantId: "crc", authSessionId: "session-a", actorUserId: "actor-a", actorMembershipId: f.memberA.id, roleGrantId: f.parent.id, role: "parent" as const, mode: "child-practice" as const, actingStudentId: f.students[0].id, guardianId: f.guardian.id, authorityRevision: 1, expiresAt: new Date(Date.now() + 60 * 60_000) };
    await f.db.insert(schema.practiceContext).values({ ...context, tokenHash: randomBytes(32).toString("hex") });
    expect(await fails(() => f.db.insert(schema.practiceContext).values({ ...context, authSessionId: "session-b", tokenHash: randomBytes(32).toString("hex") }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.practiceContext).values({ ...context, actingStudentId: f.students[1].id, tokenHash: randomBytes(32).toString("hex") }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.practiceContext).values({ ...context, guardianId: null, tokenHash: randomBytes(32).toString("hex") }), "23514")).toBe(true);
    expect(await fails(() => f.db.update(schema.practiceContext).set({ actingStudentId: f.students[1].id }), "23514")).toBe(true);
  });

  it("allows separate sibling invitations but prevents wrong shapes, expiry and authority rewrites", async () => {
    const f = await fixture();
    const input = { tenantId: "crc", email: "shared@example.test", role: "parent" as const, inviterMembershipId: f.memberA.id, expiresAt: new Date(Date.now() + 72 * 3600_000) };
    const [invitation] = await f.db.insert(schema.invite).values({ ...input, studentId: f.students[0].id, tokenHash: randomBytes(32).toString("hex") }).returning();
    await f.db.insert(schema.invite).values({ ...input, studentId: f.students[1].id, tokenHash: randomBytes(32).toString("hex") });
    expect(await fails(() => f.db.insert(schema.invite).values({ ...input, tokenHash: randomBytes(32).toString("hex") }), "23514")).toBe(true);
    expect(await fails(() => f.db.insert(schema.invite).values({ ...input, studentId: f.students[0].id, tokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() - 1_000) }), "23514")).toBe(true);
    expect(await fails(() => f.db.update(schema.invite).set({ email: "replacement@example.test" }).where(eq(schema.invite.id, invitation.id)), "23514")).toBe(true);
  });

  it("keeps assignment/student/author references in one tenant and verse sequence", async () => {
    const f = await fixture();
    const input = { tenantId: "crc", studentId: f.students[0].id, kind: "torah" as const, basis: "custom" as const, ref: "Genesis 1:1-1:2", setByMembershipId: f.memberA.id };
    const [assignment] = await f.db.insert(schema.assignment).values(input).returning();
    // Use a distinct current-reading kind so uniqueness cannot mask the
    // foreign author's composite tenant FK failure.
    expect(await fails(() => f.db.insert(schema.assignment).values({ ...input, kind: "haftarah", ref: "Isaiah 1:1-1:2", setByMembershipId: f.memberB.id }), "23503")).toBe(true);
    const verse = { tenantId: "crc", assignmentId: assignment.id, studentId: f.students[0].id, ordinal: 1, verseRef: "Genesis 1:1" };
    await f.db.insert(schema.assignmentVerse).values(verse);
    expect(await fails(() => f.db.insert(schema.assignmentVerse).values({ ...verse, studentId: f.students[1].id, ordinal: 2, verseRef: "Genesis 1:2" }))).toBe(true);
    expect(await fails(() => f.db.insert(schema.assignmentVerse).values({ ...verse, verseRef: "Genesis 1:2" }), "23505")).toBe(true);
    expect(await fails(() => f.db.insert(schema.assignmentVerse).values({ ...verse, ordinal: 2, verseRef: "1:2" }), "23514")).toBe(true);
  });

  it("keeps audit actors tenant-bound and audit evidence append only", async () => {
    const f = await fixture();
    const event = { tenantId: "crc", actorUserId: "actor-a", actorMembershipId: f.memberA.id, roleGrantId: f.parent.id, mode: "parent" as const, action: "context.enter", targetType: "student", targetId: f.students[0].id, requestId: crypto.randomUUID() };
    await f.db.insert(schema.auditEvent).values(event);
    expect(await fails(() => f.db.insert(schema.auditEvent).values({ ...event, actorMembershipId: f.memberB.id }))).toBe(true);
    expect(await fails(() => f.db.update(schema.auditEvent).set({ action: "context.exit" }), "23514")).toBe(true);
    expect(await fails(() => f.db.delete(schema.auditEvent), "23514")).toBe(true);
  });

  it("refuses owner runtime, scopes restricted-role transactions, and clears scope after rollback/reuse", async () => {
    const f = await fixture();
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async () => true)).rejects.toThrow("Restricted nonowner runtime role required");
    // PGlite has no network authentication. Emulate a restricted session here;
    // the separate real-Postgres integration proves an actual restricted LOGIN.
    await f.client.exec("CREATE ROLE synthetic_login LOGIN; GRANT portal_runtime TO synthetic_login; SET SESSION AUTHORIZATION synthetic_login; SET ROLE portal_runtime");
    const unscoped = await f.db.select().from(schema.student);
    expect(unscoped.length === 0).toBe(true);
    for (const tenantId of ["crc", "other", "crc"]) {
      const rows = await withTenantTransaction(f.db, { tenantId }, async (tx) => tx.select().from(schema.student));
      expect(rows.length === (tenantId === "crc" ? 2 : 1) && rows.every((row) => row.tenantId === tenantId)).toBe(true);
    }
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => {
      await tx.execute(sql`select 1`);
      throw new Error("Synthetic rollback");
    })).rejects.toThrow("Synthetic rollback");
    expect((await f.db.select().from(schema.student)).length === 0).toBe(true);
    expect(await fails(() => withTenantTransaction(f.db, { tenantId: "crc" }, async (tx) => tx.insert(schema.student).values({ tenantId: "other", firstName: "Synthetic", lastName: "Denied", ceremonyDate: "2027-01-02", parentEmail: "denied@example.test" })), "42501")).toBe(true);
  });

  it("refuses runtime membership in an owner role even when current role flags are restricted", async () => {
    const f = await fixture();
    await f.client.exec("CREATE ROLE synthetic_owner NOLOGIN; CREATE TABLE synthetic_owner_probe (id integer); ALTER TABLE synthetic_owner_probe OWNER TO synthetic_owner; GRANT synthetic_owner TO portal_runtime; CREATE ROLE synthetic_login LOGIN; GRANT portal_runtime TO synthetic_login; SET SESSION AUTHORIZATION synthetic_login; SET ROLE portal_runtime");
    let actionCalled = false;
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async () => { actionCalled = true; })).rejects.toThrow("Restricted nonowner runtime role required");
    expect(actionCalled).toBe(false);
  });

  it("refuses an owner authenticated session hidden behind SET ROLE", async () => {
    const f = await fixture();
    await f.client.exec("SET ROLE portal_runtime");
    await expect(withTenantTransaction(f.db, { tenantId: "crc" }, async () => true)).rejects.toThrow("Restricted nonowner runtime role required");
  });
});
