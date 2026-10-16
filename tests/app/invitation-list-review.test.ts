import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createAccessService } from "../../src/server/access/service";
import { createInvitationService } from "../../src/server/invitations/service";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import * as s from "../../src/server/db/index";

const id = (index: number) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
test("review: admin listing does not trust a genuine SDK proof after the active admin grant is revoked", async () => {
  const f = await portalRoutesFixture();
  try {
    let proofSeen = false, transported = false;
    const api = new Proxy(f.auth.api, { get(target, key, receiver) {
      if (key !== "getSession") return Reflect.get(target, key, receiver);
      return async (options: Parameters<typeof f.auth.api.getSession>[0]) => {
        const proof = await target.getSession(options);
        proofSeen = Boolean(proof);
        await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
        return proof;
      };
    } });
    const access = createAccessService({ db: f.db, auth: { api }, deployment: { environment: "test", deployment: "suite" } });
    const invitations = createInvitationService({ db: f.db, access, throttleSecret: randomBytes(48).toString("base64url"),
      transport: async () => { transported = true; throw new Error("Unexpected review transport"); } });
    const dispatch = createHttpDispatcher(async action => action({ ...f.runtime, invitations }));
    const response = await dispatch(f.request("/api/admin/invitations", { who: "admin" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(proofSeen && !transported).toBe(true);
    await f.owner(async () => { expect((await f.db.select().from(s.auditEvent)).length).toBe(0); });
  } finally { await f.client.close(); }
});

test("review: a malformed later invitation fails the whole requested page without a partial contact response or mutation", async () => {
  const f = await portalRoutesFixture();
  try {
    const now = Date.now();
    await f.owner(async () => {
      const common = { tenantId: "crc", role: "tutor" as const, email: "review-list@example.test", inviterMembershipId: f.adminMember.id,
        createdAt: new Date(now - 10_000), expiresAt: new Date(now + 60_000) };
      await f.db.insert(s.invite).values([
        { ...common, id: id(1), tokenHash: randomBytes(32).toString("hex") },
        // Valid legacy SQL shape, impossible successful redemption: expiry is exclusive.
        { ...common, id: id(2), tokenHash: randomBytes(32).toString("hex"), acceptedAt: common.expiresAt, acceptedMembershipId: f.multiMember.id },
      ]);
    });
    const snapshot = () => f.owner(async () => JSON.stringify({ invites: await f.db.select().from(s.invite).orderBy(s.invite.id), audit: await f.db.select().from(s.auditEvent) }));
    const before = await snapshot();
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const one = await dispatch(f.request("/api/admin/invitations?limit=1", { who: "admin" }));
    expect(one.status).toBe(200);
    const first = await one.json();
    expect(first.invitations.length === 1 && first.invitations[0].id === id(1)).toBe(true);
    for (const query of ["limit=2", `afterId=${id(1)}`]) {
      const unavailable = await dispatch(f.request(`/api/admin/invitations?${query}`, { who: "admin" }));
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "unavailable" });
      expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
      expect(unavailable.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(await snapshot() === before).toBe(true);
  } finally { await f.client.close(); }
});
