import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { CALLBACK, ORIGIN, closeMcpFixtures, mcpFixture as fixture } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

/** Register a client and authorize it, as Claude does, returning the signed pending request the consent page holds. */
async function pendingRequest(t: Awaited<ReturnType<typeof fixture>>) {
  const clientId = await t.register(), verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const location = (await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s1" })}`)).headers.get("location")!;
  return { clientId, verifier, pending: location.split("#request=")[1] };
}
const connections = (t: Awaited<ReturnType<typeof fixture>>) => t.f.owner(() => t.f.db.select({ id: s.mcpConnection.id, revokedAt: s.mcpConnection.revokedAt }).from(s.mcpConnection));

describe("portal MCP", () => {
  it("does not exist until enabled by configuration", async () => {
    const t = await fixture(false);
    expect((await t.get("/.well-known/oauth-protected-resource/api/mcp")).status).toBe(404);
    expect((await t.postJson("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(404);
    // Not even the methods leak: a wrong method is a 404 too.
    expect((await t.get("/api/mcp")).status).toBe(404);
    expect((await t.get("/api/oauth/token")).status).toBe(404);
  });

  it("publishes discovery metadata and challenges a missing bearer", async () => {
    const t = await fixture();
    const resource = await (await t.get("/.well-known/oauth-protected-resource/api/mcp")).json();
    expect(resource).toMatchObject({ resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
    const server = await (await t.get("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({ issuer: ORIGIN, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
    const denied = await t.postJson("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
    expect(denied.headers.get("www-authenticate")).toContain('scope="portal:read portal:study portal:roster"');
    expect((await t.get("/api/mcp")).status).toBe(405);
  });

  it("registers only Claude's callbacks or a loopback", async () => {
    const t = await fixture();
    expect((await t.postJson("/api/oauth/register", { redirect_uris: ["https://evil.example/cb"] })).status).toBe(400);
    expect((await t.postJson("/api/oauth/register", { redirect_uris: ["http://127.0.0.1:5555/callback"] })).status).toBe(201);
    expect((await t.postJson("/api/oauth/register", { redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" })).status).toBe(400);
    // A client id too large to fit an authorize URL is refused at registration.
    expect((await t.postJson("/api/oauth/register", { redirect_uris: Array.from({ length: 10 }, (_, i) => `http://127.0.0.1:${5000 + i}/${"c".repeat(150)}`) })).status).toBe(400);
  });

  it("returns authorize errors to a verified redirect and refuses an unverified one", async () => {
    const t = await fixture();
    const clientId = await t.register();
    const bad = await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: "short", code_challenge_method: "S256", state: "x" })}`);
    expect(new URL(bad.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const foreign = await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://claude.com/api/mcp/auth_callback", code_challenge: "a".repeat(43), code_challenge_method: "S256" })}`);
    expect(foreign.status).toBe(400);
  });

  it("consents only from a Google-created staff session", async () => {
    const t = await fixture();
    expect((await t.connect("admin")).error).toBe("google");
    // A Google sign-in from twenty minutes ago is not fresh enough to consent.
    await t.google("admin", new Date(Date.now() - 20 * 60_000));
    expect((await t.connect("admin")).error).toBe("google");
    await t.google("learner");
    const clientId = await t.register();
    const pending = new URL((await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: "a".repeat(43), code_challenge_method: "S256" })}`)).headers.get("location")!).hash.slice("#request=".length);
    const view = await (await t.consent("learner", "/api/oauth/consent/view", { request: pending })).json();
    expect(view.account).toMatchObject({ google: true, role: null });
    expect(JSON.stringify(view)).not.toContain("@");
    expect((await (await t.allow("learner", pending)).json()).error).toBe("staff");
    // Allow acts only for the account the page showed.
    expect((await (await t.consent("learner", "/api/oauth/consent/approve", { request: pending, unattended: false, viewer: "forged" })).json()).error).toBe("account");
    // A cross-site POST to the consent endpoint is refused before anything happens.
    expect((await t.postJson("/api/oauth/consent/approve", { request: pending, unattended: false }, { cookie: t.f.identities.learner.cookie, origin: "https://evil.example" })).status).toBe(403);
  });

  it("gives the rabbi the study tools and the whole roster", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin");
    // Asking for nothing, an attended admin gets the full consent, roster included.
    expect(tokens.scope).toBe("portal:read portal:study portal:roster");
    const init = await t.rpc(tokens.access_token, "initialize", { protocolVersion: "2025-06-18" });
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.instructions).toContain("Never invent a citation");
    const names = (await t.rpc(tokens.access_token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(["list_students", "get_student", "get_study_voice", "save_guide", "publish_guide", "save_student_guide"]));
    const list = (await t.call(tokens.access_token, "list_students")).json();
    expect(list.students.map((x: { name: string }) => x.name).sort()).toEqual(["Synthetic Sibling A", "Synthetic Sibling B", "Synthetic Unrelated"]);
    const unrelated = t.f.students[2].id, foreign = t.f.students[3].id;
    expect((await t.call(tokens.access_token, "get_student", { studentId: unrelated })).json()).toMatchObject({ lastName: "Unrelated", readings: [] });
    expect((await t.call(tokens.access_token, "get_student", { studentId: foreign })).isError).toBe(true);
    const student = await t.call(tokens.access_token, "get_student", { studentId: unrelated });
    expect(student.text).not.toContain("@");
    expect((await t.call(tokens.access_token, "get_study_voice")).json()).toMatchObject({ template: true, version: 0 });
    const voice = (await t.call(tokens.access_token, "save_study_voice", { expectedVersion: 0, body: "# CRC voice\n\nWrite plainly.", mutationId: randomUUID() })).json();
    expect(voice).toMatchObject({ ok: true, version: 1 });
    // Attended: a reviewed save passes the review gate and stops only for the missing reading.
    const guide = { overview: "An overview.", themes: [] };
    expect((await t.call(tokens.access_token, "save_guide", { kind: "torah", readingKey: "bamidbar", expectedVersion: 0, body: guide, origin: "claude", reviewed: true, hold: false, mutationId: randomUUID() })).json()).toMatchObject({ ok: false, code: "no-reading" });
    expect((await t.call(tokens.access_token, "get_student", { studentId: unrelated, extra: 1 })).text).toContain("unknown argument extra");
  });

  it("never lets an unattended routine mark work reviewed", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin", { unattended: true });
    const result = (await t.call(tokens.access_token, "save_guide", { kind: "torah", readingKey: "bamidbar", expectedVersion: 0, body: { overview: "An overview.", themes: [] }, origin: "claude", reviewed: true, hold: false, mutationId: randomUUID() })).json();
    expect(result).toMatchObject({ ok: false, code: "review-not-permitted" });
    // Nor write words as the rabbi's own.
    const asRabbi = (await t.call(tokens.access_token, "save_guide", { kind: "torah", readingKey: "bamidbar", expectedVersion: 0, body: { overview: "An overview.", themes: [] }, origin: "rabbi", reviewed: false, hold: false, mutationId: randomUUID() })).json();
    expect(asRabbi).toMatchObject({ ok: false, code: "channel-not-permitted" });
  });

  it("limits a tutor to read tools and their own students", async () => {
    const t = await fixture();
    await t.google("multi");
    const tokens = await t.connect("multi", { scope: "portal:read portal:study" });
    expect(tokens.scope).toBe("portal:read");
    const names = (await t.rpc(tokens.access_token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(names.sort()).toEqual(["get_student", "list_students"]);
    expect((await t.call(tokens.access_token, "list_students")).json().students.map((x: { name: string }) => x.name)).toEqual(["Synthetic Sibling A"]);
    expect((await t.call(tokens.access_token, "get_student", { studentId: t.f.students[1].id })).isError).toBe(true);
    const hidden = await t.rpc(tokens.access_token, "tools/call", { name: "save_guide", arguments: {} });
    expect(hidden.body.error.code).toBe(-32602);
    // Revoking the tutor grant ends the connection at once.
    await t.f.owner(async () => { await t.f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, t.f.tutorGrant.id)); });
    expect((await t.rpc(tokens.access_token, "tools/list")).status).toBe(401);
  });

  it("checks PKCE, rotates refresh tokens and ends the connection on replay", async () => {
    const t = await fixture();
    await t.google("admin");
    const first = await t.connect("admin");
    // The code was used: replaying it ends the whole connection.
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code: first.code!, redirect_uri: CALLBACK, client_id: first.clientId, code_verifier: first.verifier })).status).toBe(400);
    expect((await t.rpc(first.access_token, "ping")).status).toBe(401);

    const second = await t.connect("admin");
    const rotated = await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: second.clientId });
    expect(rotated.status).toBe(200);
    const next = await rotated.json();
    expect(next.refresh_token).not.toBe(second.refresh_token);
    expect((await t.rpc(next.access_token, "ping")).status).toBe(200);
    // A refresh token from another client is refused.
    expect((await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: await t.register() })).status).toBe(400);
    // Replaying the old refresh token ends the connection, including the newest access token.
    expect((await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: second.refresh_token, client_id: second.clientId })).status).toBe(400);
    expect((await t.rpc(next.access_token, "ping")).status).toBe(401);

    const third = await t.connect("admin");
    await t.postForm("/api/oauth/revoke", { token: third.access_token });
    expect((await t.rpc(third.access_token, "ping")).status).toBe(401);
    // Only hashes are stored.
    const rows = await t.f.owner(() => t.f.db.select({ hash: s.mcpToken.tokenHash }).from(s.mcpToken));
    expect(rows.some(r => r.hash === third.access_token || r.hash === third.refresh_token)).toBe(false);
  });

  it("allows one pending request once: a second Allow, a later view or Cancel answer used and make or revoke nothing", async () => {
    const t = await fixture();
    await t.google("admin"); await t.google("multi");
    const { clientId, verifier, pending } = await pendingRequest(t);
    // Cancel before Allow still returns access_denied to Claude.
    const cancelled = await t.consent("admin", "/api/oauth/consent/deny", { request: pending });
    expect(new URL((await cancelled.json()).redirect).searchParams.get("error")).toBe("access_denied");
    const view = await (await t.consent("admin", "/api/oauth/consent/view", { request: pending })).json();
    const allow = () => t.consent("admin", "/api/oauth/consent/approve", { request: pending, unattended: false, viewer: view.account.viewer });
    // A double tap: both reach the server; exactly one makes a connection and a code.
    const [one, two] = await Promise.all([allow(), allow()]);
    const answers = [{ status: one.status, body: await one.json() }, { status: two.status, body: await two.json() }];
    const won = answers.filter(a => a.body.redirect), lost = answers.filter(a => !a.body.redirect);
    expect(won).toHaveLength(1); expect(lost).toEqual([{ status: 409, body: { error: "used" } }]);
    expect(await connections(t)).toHaveLength(1);
    // A replay later within the request's ten minutes, by the same or another staff member.
    expect(await allow().then(r => r.json())).toEqual({ error: "used" });
    // (The viewer binding is per account and session, so another request's view supplies it.)
    const multiViewer = (await (await t.consent("multi", "/api/oauth/consent/view", { request: (await pendingRequest(t)).pending })).json()).account.viewer;
    expect(await (await t.consent("multi", "/api/oauth/consent/approve", { request: pending, unattended: false, viewer: multiViewer })).json()).toEqual({ error: "used" });
    // The page reloaded or reached by Back shows "already allowed" rather than Allow again.
    const again = await t.consent("admin", "/api/oauth/consent/view", { request: pending });
    expect(again.status).toBe(409); expect(await again.json()).toEqual({ error: "used" });
    // Cancel after Allow neither revokes the connection silently nor sends Claude access_denied.
    const late = await t.consent("admin", "/api/oauth/consent/deny", { request: pending });
    expect(late.status).toBe(409); expect(await late.json()).toEqual({ error: "used" });
    const rows = await connections(t);
    expect(rows).toHaveLength(1); expect(rows[0].revokedAt).toBeNull();
    // The one code still works.
    const code = new URL(won[0].body.redirect).searchParams.get("code")!;
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier })).status).toBe(200);
    // A different pending request is a different connection.
    const other = await pendingRequest(t);
    expect((await (await t.allow("admin", other.pending)).json()).redirect).toBeTruthy();
    expect(await connections(t)).toHaveLength(2);
  });

  it("checks the Origin header on /api/mcp: absent, the portal's own or Claude's pass; any other is 403 before authentication", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin");
    const ping = (headers: Record<string, string>) => t.postJson("/api/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, { authorization: `Bearer ${tokens.access_token}`, ...headers });
    for (const origin of [undefined, ORIGIN, "https://claude.ai", "https://claude.com"]) expect((await ping(origin ? { origin } : {})).status).toBe(200);
    for (const origin of ["https://evil.example", "null", "http://localhost:3001", "https://claude.ai.evil.example", "http://claude.ai", "https://claude.ai/", `${ORIGIN}, https://evil.example`]) {
      const refused = await ping({ origin });
      expect(refused.status).toBe(403);
      expect((await refused.json()).error.code).toBe(-32000);
    }
    // Refused before the bearer is even read: no challenge, no hint whether a token is valid.
    const anonymous = await t.postJson("/api/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" });
    expect(anonymous.status).toBe(403); expect(anonymous.headers.get("www-authenticate")).toBeNull();
  });

  it("accepts the MCP-Protocol-Version values it speaks or a well-formed later one, assumes one when absent and refuses others with 400", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin");
    const send = (body: Record<string, unknown>, version?: string) => t.postJson("/api/mcp", { jsonrpc: "2.0", ...body },
      { authorization: `Bearer ${tokens.access_token}`, accept: "application/json, text/event-stream", ...(version === undefined ? {} : { "mcp-protocol-version": version }) });
    // Future-safe: a well-formed version newer than the newest supported one is handled as the newest.
    for (const version of [undefined, "2025-11-25", "2025-06-18", "2025-03-26", "2025-11-26", "2026-06-30", "2099-01-01"]) expect((await send({ id: 1, method: "tools/list" }, version)).status).toBe(200);
    // Malformed, older than the oldest supported, or an unknown date between supported ones.
    for (const version of ["2024-11-05", "2025-03-25", "2025-10-01", "2026-13-01", "2026-02-32", "2026-1-01", "20260101", "", "2025-06-18, 2025-03-26", "latest", "2099-01-01T00:00"]) {
      const refused = await send({ id: 1, method: "tools/list" }, version);
      expect(refused.status).toBe(400);
      expect((await refused.json()).error.message).toContain("MCP-Protocol-Version");
    }
    // A notification with an unsupported version is refused too.
    expect((await send({ method: "notifications/initialized" }, "2024-11-05")).status).toBe(400);
    expect((await send({ method: "notifications/initialized" }, "2025-06-18")).status).toBe(202);
    // initialize negotiates in the body, whatever header it carries; an unknown version gets the default.
    const init = await send({ id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, "2099-01-01");
    expect(init.status).toBe(200); expect((await init.json()).result.protocolVersion).toBe("2025-06-18");
    const current = await send({ id: 3, method: "initialize", params: { protocolVersion: "2025-11-25" } });
    expect((await current.json()).result.protocolVersion).toBe("2025-11-25");
  });

  it("logs one closed, non-secret line per /api/mcp request: origin class, version shape and method only", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin");
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    const send = (body: unknown, headers: Record<string, string>) => t.postJson("/api/mcp", body, headers);
    const bearer = { authorization: `Bearer ${tokens.access_token}` };
    const secretArgument = "synthetic-private-argument";
    await send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_student", arguments: { studentId: secretArgument } } }, { ...bearer, origin: "https://claude.ai", "mcp-protocol-version": "2025-06-18" });
    await send({ jsonrpc: "2.0", id: 2, method: "tools/list" }, bearer);
    await send({ jsonrpc: "2.0", id: 3, method: "ping" }, { ...bearer, origin: "https://evil.example/private-path", "mcp-protocol-version": "2099-01-01" });
    await send({ jsonrpc: "2.0", id: 4, method: "ping" }, { origin: ORIGIN, "mcp-protocol-version": "not a version" });
    await send({ jsonrpc: "2.0", id: 5, method: "custom/private-method-name" }, { ...bearer, "mcp-protocol-version": "2024-11-05" });
    await send({ jsonrpc: "2.0", method: "notifications/initialized" }, bearer);
    await send([{ jsonrpc: "2.0", id: 6, method: "ping" }], bearer);
    await t.postJson("/api/oauth/register", { client_name: "Claude", redirect_uris: [CALLBACK] });
    spy.mockRestore();
    const events = lines.filter(line => line.includes("mcp.request")).map(line => JSON.parse(line));
    expect(events).toEqual([
      { event: "mcp.request", originPresent: true, origin: "https://claude.ai", protocolVersion: "2025-06-18", method: "tools/call" },
      { event: "mcp.request", originPresent: false, origin: "absent", protocolVersion: "absent", method: "tools/list" },
      { event: "mcp.request", originPresent: true, origin: "other", protocolVersion: "2099-01-01", method: "unread" },
      { event: "mcp.request", originPresent: true, origin: ORIGIN, protocolVersion: "malformed", method: "unread" },
      { event: "mcp.request", originPresent: false, origin: "absent", protocolVersion: "2024-11-05", method: "other" },
      { event: "mcp.request", originPresent: false, origin: "absent", protocolVersion: "absent", method: "notifications/initialized" },
      { event: "mcp.request", originPresent: false, origin: "absent", protocolVersion: "absent", method: "batch" },
    ]);
    // Nothing else: no bearer, refresh token, argument, path, method name outside the list or client id.
    const all = lines.join("\n");
    for (const secret of [tokens.access_token, tokens.refresh_token, tokens.clientId, secretArgument, "private-path", "private-method-name", "Bearer"]) expect(all.includes(secret)).toBe(false);
    expect(lines.filter(line => line.includes("mcp.request")).every(line => Object.keys(JSON.parse(line)).sort().join() === "event,method,origin,originPresent,protocolVersion")).toBe(true);
  });

  it("never accepts an expired code, access token or refresh token", async () => {
    let clock = Date.now();
    const t = await fixture(true, () => clock);
    await t.google("admin");
    // A code older than five minutes is refused.
    const late = await pendingRequest(t);
    const approved = await (await t.allow("admin", late.pending)).json();
    const code = new URL(approved.redirect).searchParams.get("code")!;
    clock += 5 * 60_000 + 1000;
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: late.clientId, code_verifier: late.verifier })).status).toBe(400);
    clock = Date.now();
    const tokens = await t.connect("admin");
    expect((await t.rpc(tokens.access_token, "ping")).status).toBe(200);
    // An access token past its hour is a 401, though its row is still stored.
    clock += 3600_000 + 1000;
    expect((await t.rpc(tokens.access_token, "ping")).status).toBe(401);
    const rotated = await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(rotated.status).toBe(200);
    const next = await rotated.json();
    expect((await t.rpc(next.access_token, "ping")).status).toBe(200);
    // Past the connection's thirty days, the refresh token and every access token are refused.
    clock += 30 * 24 * 3600_000;
    expect((await t.rpc(next.access_token, "ping")).status).toBe(401);
    expect((await t.postForm("/api/oauth/token", { grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: tokens.clientId })).status).toBe(400);
    const stored = await t.f.owner(() => t.f.db.select({ hash: s.mcpToken.tokenHash, expiresAt: s.mcpToken.expiresAt }).from(s.mcpToken));
    expect(stored.every(row => row.expiresAt.getTime() < clock)).toBe(true);
  });

  it("refuses a wrong PKCE verifier without spending the code", async () => {
    const t = await fixture();
    await t.google("admin");
    const clientId = await t.register(), verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const location = (await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256" })}`)).headers.get("location")!;
    const approved = await (await t.allow("admin", location.split("#request=")[1])).json();
    const code = new URL(approved.redirect).searchParams.get("code")!;
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: randomBytes(32).toString("base64url") })).status).toBe(400);
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier })).status).toBe(200);
  });
});
