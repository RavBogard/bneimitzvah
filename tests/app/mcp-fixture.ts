import { createHash, randomBytes } from "node:crypto";
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createMcpEndpoint } from "../../src/server/mcp/endpoint";
import { createClaudeConnectionsService } from "../../src/server/connections/service";
import { createMavenLinkService } from "../../src/server/students/maven-links";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { resolveTenantHost } from "../../src/server/tenancy/resolve";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import type { RelatedSourceCatalog } from "../../src/server/study/sources/metadata";
import type { Calendar, Snapshot } from "../../src/lib/readings/proposals";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { SourceTextUnavailable, type PinnedSourceReader } from "../../src/server/study/source-text";

// The portal MCP driven end to end through the HTTP dispatcher: register, Google-confirmed consent,
// token exchange and JSON-RPC tool calls. Callers mock server-only and close fixtures after each test.

export const ORIGIN = "http://localhost:3000", CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const opened: { client: { close(): Promise<void> } }[] = [];
export const closeMcpFixtures = async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); };

/** A synthetic Hebcal calendar: one regular Shabbat whatever the date (no network). */
export const syntheticReading = async (date: string, calendar: Calendar): Promise<{ snapshot: Snapshot; fetchedAt: number }> => ({ fetchedAt: Date.now(), snapshot: { date: parseCeremonyDate(date), calendar, classification: "regular",
  reading: { parashah: "Synthetic", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1, ref: "Genesis 1:1-3" }, { n: 2, ref: "Genesis 1:4-6" }, { n: "M", ref: "Genesis 1:5-6" }],
    triennial: { year: 1, aliyot: [{ n: 1, ref: "Genesis 1:1-3" }] } }, haftarah: "Isaiah 1:1-3" } });

/** `now` is the MCP clock (Date.now when omitted), for plan-token expiry; `related` and `loadReading` stand in for Sefaria and Hebcal. */
export async function mcpFixture(enabled = true, now?: () => number, outside: { related?: (ref: string, signal: AbortSignal) => Promise<RelatedSourceCatalog>; loadReading?: typeof syntheticReading; pinnedSource?: PinnedSourceReader } = {}) {
  const f = await accessFixture(); opened.push(f);
  const deployment = { environment: "test" as const, deployment: "suite" };
  // The portal's invitation email, captured: invite_tutor sends through it and a test reads what would have gone out.
  const mail: { email: string; url: string; role: string }[] = [];
  const transport = async (message: { email: string; url: string; role: string }) => { mail.push({ email: message.email, url: message.url, role: message.role }); };
  const mcp = enabled ? createMcpEndpoint({ db: f.db, access: f.service, practice: createPracticeService({ access: f.service }), secret: randomBytes(48).toString("base64url"),
    loadText: async () => { throw new Error("no network"); }, related: outside.related ?? (async () => { throw new Error("no network"); }), loadReading: outside.loadReading ?? syntheticReading, now,
    pinnedSource: outside.pinnedSource ?? (async () => { throw new SourceTextUnavailable("upstream"); }),
    invitations: { transport, throttleSecret: randomBytes(48).toString("base64url") } }) : null;
  // The staff Claude connections page and the roster's Maven link (release 1.1) share this dispatcher, so a test can end a
  // connection from the portal and watch its bearer stop working.
  const runtime = { origin: ORIGIN, mcp, resolveHost: (request: Request) => resolveTenantHost(f.db, request, deployment),
    claudeConnections: createClaudeConnectionsService({ access: f.service, now }), mavenLinks: createMavenLinkService({ access: f.service, now }) } as unknown as HttpRuntime;
  const dispatch = createHttpDispatcher(async action => action(runtime));
  /** Mark a fixture session as created by Google sign-in (the hook's job in production). */
  async function google(who: "admin" | "multi" | "learner", at = new Date()) {
    await f.owner(async () => {
      await f.client.exec("ALTER TABLE session DISABLE TRIGGER immutable_session_google_authenticated_at");
      await f.db.update(s.session).set({ googleAuthenticatedAt: at }).where(eq(s.session.id, f.identities[who].sessionId));
      await f.client.exec("ALTER TABLE session ENABLE TRIGGER immutable_session_google_authenticated_at");
    });
  }
  const get = (path: string, headers: Record<string, string> = {}) => dispatch(new Request(`${ORIGIN}${path}`, { headers }));
  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) => dispatch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  const postForm = (path: string, body: Record<string, string>) => dispatch(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() }));
  const consent = (who: "admin" | "multi" | "learner", path: string, body: unknown) => postJson(path, body, { cookie: f.identities[who].cookie, origin: ORIGIN, "sec-fetch-site": "same-origin" });
  /** What the consent page does: read the view (its viewer binding), then Allow. */
  async function allow(who: "admin" | "multi" | "learner", pending: string, unattended = false) {
    const view = await (await consent(who, "/api/oauth/consent/view", { request: pending })).json();
    return consent(who, "/api/oauth/consent/approve", { request: pending, unattended, viewer: view.account?.viewer ?? "" });
  }
  async function register() {
    const response = await postJson("/api/oauth/register", { client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    expect(response.status).toBe(201);
    return (await response.json()).client_id as string;
  }
  /** Run authorize → consent → token, returning the tokens. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function connect(who: "admin" | "multi", options: { unattended?: boolean; scope?: string } = {}): Promise<Record<string, any>> {
    const clientId = await register(), verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const query = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: `${ORIGIN}/api/mcp`, ...(options.scope ? { scope: options.scope } : {}) });
    const authorized = await get(`/api/oauth/authorize?${query}`);
    expect(authorized.status).toBe(302);
    const location = authorized.headers.get("location")!;
    expect(location.startsWith(`${ORIGIN}/connect#request=`)).toBe(true);
    const pending = location.split("#request=")[1];
    const approved = await allow(who, pending, options.unattended ?? false);
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
  return { f, dispatch, google, get, postJson, postForm, consent, allow, register, connect, rpc, call, mail };
}
