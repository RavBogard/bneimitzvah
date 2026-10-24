import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createMcpAuthService, type McpActor } from "../../src/server/mcp/service";
import { createMcpSavedReadings } from "../../src/server/saved/mcp";
import { deferred, postgresAccessFixture, settleRace, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

// Release 1.7 M4 on real PostgreSQL with the restricted runtime login: the MCP's saved readings bind the connection's own
// membership through the same forced owner_only policy as the cookie route, on two physical backends.
type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
const origin = "http://localhost:3000";
const safe = (operation: PromiseLike<unknown>) => Promise.resolve(operation).then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));

async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const secret = randomBytes(48).toString("base64url");
  const savedA = createMcpSavedReadings(createMcpAuthService({ db: f.aDb, access: f.a, secret }));
  const savedB = createMcpSavedReadings(createMcpAuthService({ db: f.bDb, access: f.b, secret }));
  /** A live connection row for one person, as consent would store it (written as the owner). */
  async function connection(user: string, role: "admin" | "tutor", unattended = false): Promise<McpActor> {
    const [member] = await f.ownerDb.select().from(s.membership).where(and(eq(s.membership.tenantId, "crc"), eq(s.membership.userId, user)));
    const [grant] = await f.ownerDb.select().from(s.roleGrant).where(and(eq(s.roleGrant.membershipId, member.id), eq(s.roleGrant.role, role)));
    const id = randomUUID(), at = Date.now();
    await f.ownerDb.insert(s.mcpConnection).values({ id, tenantId: "crc", userId: user, membershipId: member.id, roleGrantId: grant.id, role, roleGrantRevision: grant.revision,
      authorityRevision: member.authorityRevision, scope: "portal:read", unattended, clientName: "Claude", clientHash: createHash("sha256").update(id).digest("hex"),
      redirectUri: "https://claude.ai/api/mcp/auth_callback", createdAt: new Date(at), expiresAt: new Date(at + 24 * 3600_000) });
    // Only what the binding never trusts: withLive re-derives the person, role, grant and attendance from this row.
    return { tenantId: "crc", origin, connectionId: id, unattended: false, expiresAt: at + 3600_000 } as unknown as McpActor;
  }
  return { ...f, savedA, savedB, connection, signal: new AbortController().signal };
}

test("the connection's own person only: an admin's connection never lists, opens or revises a tutor's reading, and the policy holds on the runtime role", async () => {
  const f = await fixture();
  const admin = await f.connection(f.admin.id, "admin"), tutor = await f.connection(f.tutor.id, "tutor");
  const mine = await f.savedA.create(admin, f.signal, { name: "Admin reading", ranges: "Genesis 1:1-5", mutationId: randomUUID() });
  const theirs = await f.savedB.create(tutor, f.signal, { name: "Tutor reading", ranges: "Isaiah 40:1-3", mutationId: randomUUID() });
  if (!mine.ok || !theirs.ok) throw new Error("Synthetic create failed");
  expect((await f.savedA.list(admin, f.signal)).readings.map(row => row.id)).toEqual([mine.reading.id]);
  expect((await f.savedB.list(tutor, f.signal)).readings.map(row => row.id)).toEqual([theirs.reading.id]);
  expect(await safe(f.savedA.open(admin, f.signal, theirs.reading.id))).toEqual({ denied: 404 });
  expect(await safe(f.savedB.revise(admin, f.signal, { id: theirs.reading.id, revision: 1, name: "Taken" }))).toEqual({ denied: 404 });
  expect(await safe(f.savedA.open(tutor, f.signal, mine.reading.id))).toEqual({ denied: 404 });
  const rows = (await query<{ id: string; name: string; membership_id: string; revision: number }>(f.owner, "SELECT id, name, membership_id, revision FROM saved_reading ORDER BY name")).rows;
  expect(rows.map(row => [row.name, row.revision])).toEqual([["Admin reading", 1], ["Tutor reading", 1]]);
  expect(new Set(rows.map(row => row.membership_id)).size).toBe(2);
  // A scheduled routine's connection binds nothing, whatever the actor claims.
  const routine = await f.connection(f.admin.id, "admin", true);
  expect(await safe(f.savedA.list(routine, f.signal))).toEqual({ denied: 403 });
  // A revoked grant ends the connection's binding at once, though the tutor's parent grant would still open the cookie route.
  await query(f.owner, "UPDATE role_grant SET revoked_at = now() WHERE id = $1", [f.tutorGrant.id]);
  expect(await safe(f.savedB.list(tutor, f.signal))).toEqual({ denied: 401 });
});

test("two backends sending the same create at once: the owner's write lock makes the second a replay, and one row exists", async () => {
  const f = await fixture();
  const admin = await f.connection(f.admin.id, "admin"), body = { name: "Once", ranges: "Genesis 2:1-3", mutationId: randomUUID() };
  const entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.includes("pg_advisory_xact_lock"), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.savedA.create(admin, f.signal, body));
  let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.savedB.create(admin, f.signal, body));
    await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await settleRace([a, ...(b ? [b] : [])]); }
  const results = await Promise.all([a, b!]) as { ok?: boolean; replayed?: boolean; reading?: { id: string } }[];
  expect(results.map(row => row.ok)).toEqual([true, true]);
  expect(results.map(row => !!row.replayed)).toEqual([false, true]);
  expect(results[0].reading!.id).toBe(results[1].reading!.id);
  expect((await query(f.owner, "SELECT count(*)::int AS n FROM saved_reading WHERE name = 'Once'")).rows[0].n).toBe(1);
});
