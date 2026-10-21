import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createMcpEndpoint } from "../../src/server/mcp/endpoint";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import type { HttpRuntime } from "../../src/server/runtime/composition";

const ORIGIN = "http://localhost:3000", CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });

async function fixture(enabled = true) {
  const f = await accessFixture(); opened.push(f);
  const deployment = { environment: "test" as const, deployment: "suite" };
  const mcp = enabled ? createMcpEndpoint({ db: f.db, access: f.service, practice: createPracticeService({ access: f.service }), secret: randomBytes(48).toString("base64url"),
    loadText: async () => { throw new Error("no network"); }, related: async () => { throw new Error("no network"); } }) : null;
  const runtime = { origin: ORIGIN, mcp, resolveHost: (request: Request) => resolveTenantHost(f.db, request, deployment) } as unknown as HttpRuntime;
  const dispatch = createHttpDispatcher(async action => action(runtime));
  /** Mark a fixture session as created by Google sign-in (the hook's job in production). */
  async function google(who: "admin" | "multi" | "learner") {
    await f.owner(async () => {
      await f.client.exec("ALTER TABLE session DISABLE TRIGGER immutable_session_google_authenticated_at");
      await f.db.update(s.session).set({ googleAuthenticatedAt: new Date() }).where(eq(s.session.id, f.identities[who].sessionId));
      await f.client.exec("ALTER TABLE session ENABLE TRIGGER immutable_session_google_authenticated_at");
    });
  }
  const get = (path: string, headers: Record<string, string> = {}) => dispatch(new Request(`${ORIGIN}${path}`, { headers }));
  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) => dispatch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const postForm = (path: string, body: Record<string, string>) => dispatch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
  const consent = (who: "admin" | "multi" | "learner", path: string, body: unknown) => postJson(path, body, { cookie: f.identities[who].cookie, origin: ORIGIN, "sec-fetch-site": "same-origin" });
  async function register() {
    const response = await postJson("/api/oauth/register", { client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    expect(response.status).toBe(201);
    return (await response.json()).client_id as string;
  }
  /** Run authorize → consent → token, returning the tokens. */
  async function connect(who: "admin" | "multi", options: { unattended?: boolean; scope?: string } = {}) {
    const clientId = await register(), verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: `${ORIGIN}/api/mcp`, ...(options.scope ? { scope: options.scope } : {}) });
    const authorized = await get(`/api/oauth/authorize?${query}`);
    expect(authorized.status).toBe(302);
    const location = authorized.headers.get("location")!;
    expect(location.startsWith(`${ORIGIN}/connect#request=`)).toBe(true);
    const pending = location.split("#request=")[1];
    const approved = await consent(who, "/api/oauth/consent/approve", { request: pending, unattended: options.unattended ?? false });
    const body = await approved.json();
    if (!body.redirect) return { error: body.error as string, clientId, verifier, pending };
    const back = new URL(body.redirect);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get("state")).toBe("s1");
    expect(back.searchParams.get("iss")).toBe(ORIGIN);
    const code = back.searchParams.get("code")!;
    const token = await postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier, resource: `${ORIGIN}/api/mcp` });
    expect(token.status).toBe(200);
    expect(token.headers.get("cache-control")).toContain("no-store");
    return { ...(await token.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number }, clientId, verifier, code };
  }
  let id = 0;
  const rpc = async (token: string, method: string, params: Record<string, unknown> = {}) => {
    const response = await postJson("/api/mcp", { jsonrpc: "2.0", id: ++id, method, params }, { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" });
    return { status: response.status, body: response.status === 200 ? await response.json() : null, headers: response.headers };
  };
  const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const { body } = await rpc(token, "tools/call", { name, arguments: args });
    const result = body.result as { content: { text: string }[]; isError?: boolean };
    return { isError: !!result.isError, text: result.content[0].text, json: () => JSON.parse(result.content[0].text) };
  };
  return { f, dispatch, google, get, postJson, postForm, consent, register, connect, rpc, call };
}

describe("portal MCP", () => {
  it("does not exist until enabled by configuration", async () => {
    const t = await fixture(false);
    expect((await t.get("/.well-known/oauth-protected-resource/api/mcp")).status).toBe(404);
    expect((await t.postJson("/api/mcp", { jsonrpc: "2.0", id: 1, method: "initialize" })).status).toBe(404);
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
  });

  it("registers only Claude's callbacks or a loopback", async () => {
    const t = await fixture();
    expect((await t.postJson("/api/oauth/register", { redirect_uris: ["https://evil.example/cb"] })).status).toBe(400);
    expect((await t.postJson("/api/oauth/register", { redirect_uris: ["http://127.0.0.1:5555/callback"] })).status).toBe(201);
    expect((await t.postJson("/api/oauth/register", { redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" })).status).toBe(400);
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
    await t.google("learner");
    const clientId = await t.register();
    const pending = new URL((await t.get(`/api/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: "a".repeat(43), code_challenge_method: "S256" })}`)).headers.get("location")!).hash.slice("#request=".length);
    const view = await (await t.consent("learner", "/api/oauth/consent/view", { request: pending })).json();
    expect(view.account).toMatchObject({ google: true, role: null });
    expect(JSON.stringify(view)).not.toContain("@");
    expect((await (await t.consent("learner", "/api/oauth/consent/approve", { request: pending, unattended: false })).json()).error).toBe("staff");
    // A cross-site POST to the consent endpoint is refused before anything happens.
    expect((await t.postJson("/api/oauth/consent/approve", { request: pending, unattended: false }, { cookie: t.f.identities.learner.cookie, origin: "https://evil.example" })).status).toBe(403);
  });

  it("gives the rabbi the study tools and the whole roster", async () => {
    const t = await fixture();
    await t.google("admin");
    const tokens = await t.connect("admin");
    expect(tokens.scope).toBe("portal:read portal:study");
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
    const approved = await (await t.consent("admin", "/api/oauth/consent/approve", { request: location.split("#request=")[1], unattended: false })).json();
    const code = new URL(approved.redirect).searchParams.get("code")!;
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: randomBytes(32).toString("base64url") })).status).toBe(400);
    expect((await t.postForm("/api/oauth/token", { grant_type: "authorization_code", code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier })).status).toBe(200);
  });
});
