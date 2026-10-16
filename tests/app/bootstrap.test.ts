import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { authFixture } from "./auth-stack-helper";
import { bootstrapOwner } from "../../scripts/bootstrap-owner.mjs";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof authFixture>>[] = [];
async function fixture() {
  const f = await authFixture(); fixtures.push(f);
  await f.signIn("private-owner@example.test");
  const db = drizzle(f.client, { schema: s });
  return { ...f, db };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });

describe("private owner bootstrap", () => {
  it("uses a private verified existing identity, creates CRCadmin+audit once and is idempotent", async () => {
    const f = await fixture();
    expect((await bootstrapOwner(f.client, { email: " PRIVATE-OWNER@example.test ", confirm: true })).status === "configured").toBe(true);
    expect((await bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).status === "already-configured").toBe(true);
    const members = await f.db.select().from(s.membership);
    const grants = await f.db.select().from(s.roleGrant);
    const audits = await f.db.select().from(s.auditEvent);
    expect(members.length === 1 && members[0].tenantId === "crc" && grants.length === 1 && grants[0].role === "admin").toBe(true);
    expect(audits.length === 1 && audits[0].targetType === "owner-bootstrap" && audits[0].action === "grant.issue").toBe(true);
    const role = await f.client.query<{ role: string }>("select current_user as role");
    expect(role.rows[0].role === "postgres").toBe(true);
  });

  it("refuses absent/unverified identity, missing confirmation and disabled/revoked authority", async () => {
    const f = await fixture();
    await expect(bootstrapOwner(f.client, { email: "absent@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: false })).rejects.toThrow("Owner bootstrap failed");
    await f.db.update(s.user).set({ emailVerified: false });
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    await f.db.update(s.user).set({ emailVerified: true });
    const [user] = await f.db.select().from(s.user);
    const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: user.id, disabledAt: new Date() }).returning();
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    await f.db.update(s.membership).set({ disabledAt: null }).where(eq(s.membership.id, member.id));
    await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "admin", revokedAt: new Date() });
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    expect((await f.db.select().from(s.auditEvent)).length === 0).toBe(true);
  });

  it("does not bootstrap another identity or allow a normal runtime client", async () => {
    const f = await fixture();
    await bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true });
    await f.signIn("second@example.test");
    await expect(bootstrapOwner(f.client, { email: "second@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    expect((await f.db.select().from(s.membership)).length === 1).toBe(true);
    await f.client.exec("CREATE ROLE bootstrap_runtime LOGIN; GRANT portal_runtime TO bootstrap_runtime; SET SESSION AUTHORIZATION bootstrap_runtime; SET ROLE portal_runtime");
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
  });

  it("keeps the initial private owner binding after revocation and rejects a different identity", async () => {
    const f = await fixture();
    await bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true });
    await f.db.update(s.roleGrant).set({ revokedAt: new Date() });
    await f.signIn("different-owner@example.test");
    await expect(bootstrapOwner(f.client, { email: "different-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    expect((await f.db.select().from(s.membership)).length === 1).toBe(true);
    expect((await f.db.select().from(s.auditEvent)).length === 1).toBe(true);
  });

  it("rejects unbound active and revoked admin history without adopting or replacing that identity", async () => {
    const f = await fixture();
    const [user] = await f.db.select().from(s.user);
    const [member] = await f.db.insert(s.membership).values({ tenantId: "crc", userId: user.id }).returning();
    await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "admin" });
    await expect(bootstrapOwner(f.client, { email: "private-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    expect((await f.db.select().from(s.auditEvent)).length === 0).toBe(true);
    await f.db.update(s.roleGrant).set({ revokedAt: new Date() });
    await f.signIn("different-owner@example.test");
    await expect(bootstrapOwner(f.client, { email: "different-owner@example.test", confirm: true })).rejects.toThrow("Owner bootstrap failed");
    expect((await f.db.select().from(s.membership)).length === 1 && (await f.db.select().from(s.roleGrant)).length === 1).toBe(true);
    expect((await f.db.select().from(s.auditEvent)).length === 0).toBe(true);
  });

  it("prints fixed CLI errors without private identity and inherits no real credentials", async () => {
    const isolated = await isolatedEnv({ BOOTSTRAP_OWNER_EMAIL: "private-fixture@example.test" });
    try {
      const result = spawnSync(process.execPath, ["scripts/bootstrap-owner.mjs", "--confirm"], { env: isolated.env, encoding: "utf8" });
      expect(result.status === 1 && result.stdout === "" && !result.stderr.includes("@") && result.stderr.includes("Owner bootstrap failed")).toBe(true);
    } finally { await isolated.cleanup(); }
  });
});
