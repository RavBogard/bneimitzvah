import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createClaudeConnectionsService } from "../../src/server/connections/service";
import { claudeConnectionsRouteMethods } from "../../src/server/http/claude-connections";
import { ORIGIN, closeMcpFixtures, mcpFixture } from "./mcp-fixture";

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await closeMcpFixtures(); });

const OTHER = "http://localhost:3101";
type Who = "admin" | "multi" | "learner";

async function setup() {
  const t = await mcpFixture();
  await t.google("admin"); await t.google("multi");
  const admin = await t.connect("admin"), tutor = await t.connect("multi");
  const rows = () => t.f.owner(() => t.f.db.select().from(s.mcpConnection).orderBy(s.mcpConnection.createdAt));
  const [adminRow, tutorRow] = await rows();
  const list = (who: Who, headers: Record<string, string> = {}) => t.dispatch(new Request(`${ORIGIN}/api/staff/claude-connections`, { headers: { cookie: t.f.identities[who].cookie, ...headers } }));
  const revoke = (who: Who, connectionId: unknown, headers: Record<string, string> = {}) => t.postJson("/api/staff/claude-connections/revoke", { connectionId },
    { cookie: t.f.identities[who].cookie, origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers });
  const audits = () => t.f.owner(() => t.f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "mcp-connection.revoke")));
  const usable = async (token: string) => (await t.rpc(token, "tools/list")).status === 200;
  const refresh = async (connection: Record<string, string>) => (await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: connection.refresh_token, client_id: connection.clientId })).status;
  return { t, admin, tutor, adminRow, tutorRow, rows, list, revoke, audits, usable, refresh };
}

describe("Claude connections page", () => {
  it("lists a tutor's own connections only and every staff connection for an admin, with names and plain-word access but no address or internal id", async () => {
    const { t, adminRow, tutorRow, list } = await setup();
    await t.f.owner(async () => { await t.f.db.update(s.user).set({ name: "Synthetic Tutor Name" }).where(eq(s.user.id, t.f.identities.multi.id)); });
    const mine = await list("multi"), tutorView = (await mine.json()).view;
    expect(mine.status).toBe(200); expect(mine.headers.get("cache-control")).toContain("no-store");
    expect(tutorView).toEqual({ role: "tutor", truncated: false, connections: [{ id: tutorRow.id, client: "Claude", role: "tutor", access: ["read"], routine: false,
      approvedAt: tutorRow.createdAt.toISOString(), expiresAt: tutorRow.expiresAt.toISOString(), mine: true, staffName: null }] });
    const adminView = (await (await list("admin")).json()).view;
    expect(adminView.role).toBe("admin");
    expect(adminView.connections.map((c: { id: string; mine: boolean; staffName: string | null; access: string[] }) => [c.id, c.mine, c.staffName, c.access]))
      .toEqual([[tutorRow.id, false, "Synthetic Tutor Name", ["read"]], [adminRow.id, true, null, ["read", "study", "roster"]]]);
    // A display name that is an address is never sent.
    await t.f.owner(async () => { await t.f.db.update(s.user).set({ name: ["someone", "example.test"].join("@") }).where(eq(s.user.id, t.f.identities.multi.id)); });
    const text = await (await list("admin")).text();
    expect(text).toContain("A staff member");
    for (const sentinel of ["@", t.f.identities.multi.id, t.f.identities.admin.id, t.f.multiMember.id, t.f.adminMember.id, t.f.tutorGrant.id, "client_hash", "redirect", "auth_callback"]) expect(text).not.toContain(sentinel);
  });

  it("refuses parents, students, anonymous callers and a practice context, and owns exactly its routes", async () => {
    const { t, list, adminRow, revoke, rows } = await setup();
    expect((await list("learner")).status).toBe(403);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/staff/claude-connections`))).status).toBe(401);
    expect((await list("admin", { "x-practice-context": "x" })).status).toBe(403);
    expect((await revoke("learner", adminRow.id)).status).toBe(403);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/staff/claude-connections?x=1`, { headers: { cookie: t.f.identities.admin.cookie } }))).status).toBe(400);
    expect((await t.dispatch(new Request(`${ORIGIN}/api/staff/claude-connections/revoke`, { headers: { cookie: t.f.identities.admin.cookie } }))).status).toBe(405);
    expect(claudeConnectionsRouteMethods("/api/staff/claude-connections")).toEqual(["GET"]);
    expect(claudeConnectionsRouteMethods("/api/staff/claude-connections/revoke")).toEqual(["POST"]);
    // A cross-site or originless post is refused before anything is read.
    expect((await revoke("admin", adminRow.id, { origin: "https://evil.example" })).status).toBe(403);
    expect((await revoke("admin", adminRow.id, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await revoke("admin", { id: adminRow.id })).status).toBe(404);
    expect((await t.postJson("/api/staff/claude-connections/revoke", { connectionId: adminRow.id, extra: 1 }, { cookie: t.f.identities.admin.cookie, origin: ORIGIN })).status).toBe(400);
    expect((await rows()).every(row => row.revokedAt === null)).toBe(true);
  });

  it("ends a tutor's own connection: its access token and refresh token stop working at once, and the revoke is audited once", async () => {
    const { t, tutor, admin, tutorRow, revoke, audits, usable, refresh, rows } = await setup();
    expect(await usable(tutor.access_token)).toBe(true);
    // A tutor cannot end someone else's connection; it looks like a missing one.
    const adminConnection = (await rows()).find(row => row.role === "admin")!;
    expect((await revoke("multi", adminConnection.id)).status).toBe(404);
    expect(await usable(admin.access_token)).toBe(true);
    const ended = await revoke("multi", tutorRow.id);
    expect(ended.status).toBe(200); expect(await ended.json()).toEqual({ ok: true, ended: true });
    expect((await t.rpc(tutor.access_token, "tools/list")).status).toBe(401);
    expect(await refresh(tutor)).toBe(400);
    expect(await usable(admin.access_token)).toBe(true);
    const [audit] = await audits();
    expect(audit).toMatchObject({ tenantId: "crc", actorUserId: t.f.identities.multi.id, actorMembershipId: t.f.multiMember.id, roleGrantId: t.f.tutorGrant.id, mode: "tutor", targetType: "mcp_connection", targetId: tutorRow.id });
    // Ending it again changes nothing and writes no second audit row.
    expect(await (await revoke("multi", tutorRow.id)).json()).toEqual({ ok: true, ended: false });
    expect(await audits()).toHaveLength(1);
    // The database still refuses to un-revoke it, even for the owner.
    await expect(t.f.owner(() => t.f.db.update(s.mcpConnection).set({ revokedAt: null }).where(eq(s.mcpConnection.id, tutorRow.id)))).rejects.toBeDefined();
  });

  it("lets an admin end another staff member's connection, audited as the admin", async () => {
    const { t, tutor, tutorRow, revoke, audits, usable, list } = await setup();
    expect((await revoke("admin", tutorRow.id)).status).toBe(200);
    expect(await usable(tutor.access_token)).toBe(false);
    expect((await audits())[0]).toMatchObject({ actorUserId: t.f.identities.admin.id, roleGrantId: t.f.adminGrant.id, mode: "admin", targetId: tutorRow.id });
    expect((await (await list("multi")).json()).view.connections).toEqual([]);
  });

  it("needs a sign-in from the last 15 minutes to end a connection, like the portal's other access changes, while the list stays readable", async () => {
    const { tutor, tutorRow, list, revoke, usable, rows } = await setup();
    vi.setSystemTime(new Date(Date.now() + 16 * 60_000));
    expect((await list("admin")).status).toBe(200);
    expect((await revoke("admin", tutorRow.id)).status).toBe(403);
    expect((await revoke("multi", tutorRow.id)).status).toBe(403);
    vi.useRealTimers();
    expect(await usable(tutor.access_token)).toBe(true);
    expect((await rows()).every(row => row.revokedAt === null)).toBe(true);
  });

  it("never reaches another congregation's connection, from either side", async () => {
    const { t, tutorRow, revoke, rows } = await setup();
    // A staff grant and a live connection in the other congregation for the same person.
    const otherGrant = randomUUID(), otherConnection = randomUUID();
    const [otherMember] = await t.f.owner(() => t.f.db.select().from(s.membership).where(and(eq(s.membership.tenantId, "other"), eq(s.membership.userId, t.f.identities.multi.id))));
    await t.f.owner(async () => {
      await t.f.db.insert(s.roleGrant).values({ id: otherGrant, tenantId: "other", membershipId: otherMember.id, role: "tutor" });
      await t.f.db.insert(s.mcpConnection).values({ id: otherConnection, tenantId: "other", userId: t.f.identities.multi.id, membershipId: otherMember.id, roleGrantId: otherGrant, role: "tutor",
        roleGrantRevision: 1, authorityRevision: 1, scope: "portal:read", unattended: false, clientName: "Claude", clientHash: createHash("sha256").update("x").digest("hex"),
        redirectUri: "https://claude.ai/api/mcp/auth_callback", expiresAt: new Date(Date.now() + 86_400_000) });
    });
    // The crc admin cannot end it: the same answer as a missing connection.
    expect((await revoke("admin", otherConnection)).status).toBe(404);
    // Signed in at the other congregation's host, the tutor sees only that congregation's connection and cannot end a crc one.
    const service = createClaudeConnectionsService({ access: t.f.service });
    const at = (method: string) => ({ url: `${OTHER}/api/staff/claude-connections`, method, headers: new Headers({ cookie: t.f.identities.multi.cookie, origin: OTHER, "sec-fetch-site": "same-origin" }) });
    expect((await service.list(at("GET"))).connections.map(c => c.id)).toEqual([otherConnection]);
    await expect(service.revoke(at("POST"), tutorRow.id)).rejects.toMatchObject({ status: 404 });
    expect((await rows()).every(row => row.revokedAt === null)).toBe(true);
    expect(await service.revoke(at("POST"), otherConnection)).toEqual({ ok: true, ended: true });
  });
});
