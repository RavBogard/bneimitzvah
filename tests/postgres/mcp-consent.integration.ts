import { createHash, randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createMcpAuthService } from "../../src/server/mcp/service";
import { deferred, postgresAccessFixture, settleRace, waitForEntry } from "./access-fixture";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Fixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
const origin = "http://localhost:3000", resolved = { tenantId: "crc", origin }, CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const consent = (cookie: string, path: string) => new Request(`${origin}${path}`, { method: "POST", headers: { origin, cookie, "sec-fetch-site": "same-origin" } });
const insertsConnection = (text: string) => text.includes('insert into "mcp_connection"');

// One pending consent request makes at most one connection (MCP-DECIDED, 2026-10-22): the connection id is
// derived from the signed request, so a second Allow on another physical backend waits on the first's
// uncommitted row and then inserts nothing.
test("two restricted physical backends allow one pending MCP request at once and exactly one connection and code exist", async () => {
  const f = await postgresAccessFixture(); opened.push(f);
  const secret = randomBytes(48).toString("base64url");
  const a = createMcpAuthService({ db: f.aDb, access: f.a, secret }), b = createMcpAuthService({ db: f.bDb, access: f.b, secret });
  // The session-create hook's Google marker, set as the owner (the column is otherwise immutable).
  await f.owner.query("ALTER TABLE session DISABLE TRIGGER immutable_session_google_authenticated_at");
  await f.ownerDb.update(s.session).set({ googleAuthenticatedAt: new Date() }).where(eq(s.session.id, f.admin.sessionId));
  await f.owner.query("ALTER TABLE session ENABLE TRIGGER immutable_session_google_authenticated_at");
  const registered = a.register({ client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
  const clientId = "body" in registered ? String(registered.body.client_id) : "";
  const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
  const authorized = a.authorize(new URL(`${origin}/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s1" })}`), resolved);
  const pending = "redirect" in authorized ? authorized.redirect.split("#request=")[1] : "";
  expect(pending.startsWith("mr.")).toBe(true);
  const view = await a.describe(consent(f.admin.cookie, "/api/oauth/consent/view"), pending, resolved);
  const viewer = typeof view === "object" && view.account ? view.account.viewer : "";
  expect(viewer.length > 0).toBe(true);

  const entered = deferred(), release = deferred();
  const restore = await f.intercept("a", insertsConnection, async proceed => {
    const result = await proceed(); entered.resolve(); await release.promise; return result;
  });
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  try {
    first = a.approve(consent(f.admin.cookie, "/api/oauth/consent/approve"), pending, false, viewer);
    void first.catch(() => undefined);
    await waitForEntry(entered.promise, first);
    second = b.approve(consent(f.admin.cookie, "/api/oauth/consent/approve"), pending, false, viewer);
    void second.catch(() => undefined);
    await f.waitForLock(f.pidB, f.pidA); // Observed PG blocking edge, no timing guess.
    release.resolve();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.every(row => row.status === "fulfilled")).toBe(true);
    const values = outcomes.map(row => row.status === "fulfilled" ? row.value as { ok: boolean; reason?: string; redirect?: string } : null);
    expect(values.filter(value => value?.ok).length).toBe(1);
    expect(values.filter(value => value && !value.ok && value.reason === "used").length).toBe(1);
    expect((await f.ownerDb.select({ id: s.mcpConnection.id }).from(s.mcpConnection)).length).toBe(1);
    expect((await f.ownerDb.select({ hash: s.mcpToken.tokenHash }).from(s.mcpToken).where(eq(s.mcpToken.kind, "code"))).length).toBe(1);
    // Afterwards the page and Cancel both answer "used"; nothing is revoked.
    expect(await b.describe(consent(f.admin.cookie, "/api/oauth/consent/view"), pending, resolved)).toBe("used");
    expect(await b.deny(pending, resolved)).toEqual({ error: "used" });
    const [row] = await f.ownerDb.select({ revokedAt: s.mcpConnection.revokedAt }).from(s.mcpConnection);
    expect(row.revokedAt).toBeNull();
  } finally {
    release.resolve(); await settleRace([first, second].filter((value): value is Promise<unknown> => value !== undefined)); restore();
  }
});
