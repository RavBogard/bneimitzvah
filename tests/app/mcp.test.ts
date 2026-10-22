import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { CALLBACK, ORIGIN, closeMcpFixtures, mcpFixture as fixture } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

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
