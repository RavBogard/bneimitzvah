import { AUTH_RATE_LIMIT_HEADER } from "../../src/server/auth/factory";
import { createHash, randomBytes, createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { authFixture } from "./auth-stack-helper";
import * as schema from "../../src/server/db/index";
import { composeRuntime, createRuntimeScope, type HttpRuntime } from "../../src/server/runtime/composition";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createPendingInvitations } from "../../src/server/http/pending-invitations";

const opened: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(opened.splice(0).map((f) => f.client.close())); });
async function fixture(origin = "http://localhost:3000", google = true) {
  const f = await authFixture(); opened.push(f);
  const db = drizzle(f.client, { schema });
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
  const production = origin.startsWith("https:");
  const config = loadRuntimeConfig({ PORTAL_ENVIRONMENT: production ? "production" : "local", PORTAL_DEPLOYMENT: production ? "production" : "auth-http", BETTER_AUTH_URL: origin,
    "DATABASE_URL": database.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test",
    ...(google ? { GOOGLE_CLIENT_ID: "synthetic-client", "GOOGLE_CLIENT_SECRET": randomBytes(32).toString("hex") } : {}) });
  if (!production) await db.insert(schema.tenantHost).values({ host: new URL(origin).host, origin, tenantId: "crc", environment: "local", deployment: config.deployment.deployment });
  await f.client.exec("CREATE ROLE http_login LOGIN; GRANT portal_runtime TO http_login; SET SESSION AUTHORIZATION http_login; SET ROLE portal_runtime");
  const messages: { email: string; url: string }[] = [];
  const runtime = composeRuntime(config, db, async (endpoint, options) => {
    if (String(endpoint) !== "https://api.resend.com/emails") throw new Error("Unexpected synthetic provider");
    const payload = JSON.parse(String(options?.body));
    const link = String(payload.text).match(/https?:\/\/\S+/)?.[0];
    if (!link || !Array.isArray(payload.to)) throw new Error("Invalid synthetic mail capture");
    messages.push({ email: payload.to[0], url: link });
    return new Response("{}", { status: 200 });
  });
  const sdk = vi.spyOn(runtime.auth, "handler");
  const dispatch = createHttpDispatcher(async action => action(runtime as HttpRuntime));
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(origin + path, body === undefined ? { headers } : {
    method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { runtime, sdk, dispatch, request, messages, config, origin, db };
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

const tokenOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("token")!;
const fakeCredential = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.e30.AA`;
async function challenge(f: Awaited<ReturnType<typeof fixture>>, cookie = "") {
  const response = await f.dispatch(f.request("/api/auth/google/challenge", {}, cookie ? { cookie } : {}));
  expect(response.status).toBe(200);
  return { ...await response.json(), cookie: cookieOf(response) };
}
function googleTokens() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-http-key", alg: "RS256", use: "sig" };
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    if ((input instanceof Request ? input.url : String(input)) !== "https://www.googleapis.com/oauth2/v3/certs") throw new Error("Offline auth network refused");
    return Response.json({ keys: [key] });
  });
  return (nonce: string | undefined, overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: "synthetic-client", sub: "synthetic-http-subject", email: "http-identity@example.test", email_verified: true, name: "Synthetic learner", iat: now, exp: now + 300, nonce, ...overrides })).toString("base64url");
    const signing = `${header}.${payload}`;
    return `${signing}.${createSign("RSA-SHA256").update(signing).sign(privateKey).toString("base64url")}`;
  };
}

test("fragment mail bridges internally to real SDK sessions, replay fails and logout clears both cookies", async () => {
  for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app"]) {
    const f = await fixture(origin);
    const start = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "http-identity@example.test" }));
    expect(await start.json()).toEqual({ requested: true });
    const link = new URL(f.messages[0].url);
    expect(link.pathname).toBe("/auth/email"); expect(link.search).toBe(""); expect(link.hash).toMatch(/^#token=[A-Za-z]{32}$/);
    const confirmed = await f.dispatch(f.request("/api/auth/email/confirm", { token: tokenOf(link.href) }));
    expect(confirmed.status).toBe(200); expect(await confirmed.json()).toEqual({ ok: true, next: "/" });
    const cookie = cookieOf(confirmed);
    const proof = await f.runtime.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
    expect(proof?.user.emailVerified).toBe(true);
    const replay = await f.dispatch(f.request("/api/auth/email/confirm", { token: tokenOf(link.href) }));
    expect(replay.status).toBe(400); expect(await replay.json()).toEqual({ error: "authentication" });
    const summary = await f.dispatch(f.request("/api/session", undefined, { cookie }));
    const text = await summary.text();
    expect(text.includes("http-identity@example.test") || text.includes(proof!.session.token)).toBe(false);
    const out = await f.dispatch(f.request("/api/auth/sign-out", {}, { cookie, "X-Practice-Context": "ignored" }));
    expect(await out.json()).toEqual({ ok: true });
    expect(out.headers.getSetCookie().some(value => value.includes("portal_google_binding=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"))).toBe(true);
    expect(await f.runtime.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } })).toBeNull();
  }
});

test("body-only invitation staging chooses a fixed confirm/challenge destination and never accepts on GET", async () => {
  const f = await fixture(); const token = randomBytes(32).toString("base64url");
  expect((await f.dispatch(new Request(`${f.origin}/invitations/open?token=${token}`))).status).toBe(404);
  const staged = await f.dispatch(f.request("/api/invitations/open", { token }));
  expect(await staged.json()).toEqual({ ok: true, next: "/invitations/accept" });
  const cookie = cookieOf(staged);
  await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "pending@example.test" }, { cookie }));
  const confirmed = await f.dispatch(f.request("/api/auth/email/confirm", { token: tokenOf(f.messages[0].url) }, { cookie }));
  expect(await confirmed.json()).toEqual({ ok: true, next: "/invitations/accept" });
  const prepared = await challenge(f, cookie);
  f.sdk.mockImplementationOnce(async () => new Response('{"token":"synthetic-private"}', { status: 200 }));
  const social = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: fakeCredential, challengeId: prepared.challengeId, csrfToken: prepared.csrfToken }, { cookie: `${cookie}; ${prepared.cookie}` }));
  expect(await social.json()).toEqual({ ok: true, next: "/invitations/accept" });
  expect(f.sdk.mock.calls.length).toBe(3);
});

test("pinned Google cryptography uses server nonce and projects session JSON; replay and fresh-challenge reuse fail", async () => {
  const f = await fixture(); const token = googleTokens();
  const first = await challenge(f);
  const credential = token(first.nonce);
  const body = { credential, challengeId: first.challengeId, csrfToken: first.csrfToken };
  const response = await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie: first.cookie }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, next: "/" });
  const sessionCookie = cookieOf(response);
  expect(sessionCookie).toContain("better-auth.session_token=");
  expect((await f.db.select().from(schema.user)).length).toBe(1);
  const grants = await f.db.select().from(schema.membership); expect(grants.length).toBe(0);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie: first.cookie }))).status).toBe(403);
  const fresh = await challenge(f, first.cookie);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", { ...body, challengeId: fresh.challengeId, csrfToken: fresh.csrfToken }, { cookie: fresh.cookie }))).status).toBe(400);
  const late = await challenge(f, first.cookie);
  const logout = await f.dispatch(f.request("/api/auth/sign-out", {}, { cookie: `${sessionCookie}; ${first.cookie}` }));
  expect(logout.status).toBe(200);
  expect(logout.headers.getSetCookie().some(cookie => cookie.startsWith("portal_google_binding=;") && cookie.includes("Max-Age=0"))).toBe(true);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", { credential: token(late.nonce), challengeId: late.challengeId, csrfToken: late.csrfToken }))).status).toBe(403);
});

test("Google Account intent is closed and nonce-bound; invitation priority and default destinations remain fixed", async () => {
  const f = await fixture(), token = googleTokens();
  for (const body of [{ intent: "/account" }, { intent: "https://foreign.example.test" }, { intent: ["account"] }, { intent: null }, { next: "/account" }, { intent: "account", next: "/account" }]) expect((await f.dispatch(f.request("/api/auth/google/challenge", body))).status).toBe(400);
  expect(await f.db.select().from(schema.verification)).toHaveLength(0); expect(f.sdk).not.toHaveBeenCalled();
  const issued = await f.dispatch(f.request("/api/auth/google/challenge", { intent: "account" })); expect(issued.status).toBe(200);
  const value = await issued.json(), cookie = cookieOf(issued), body = { credential: token(value.nonce), challengeId: value.challengeId, csrfToken: value.csrfToken };
  const reply = await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie })); expect(reply.status).toBe(200); expect(await reply.json()).toEqual({ ok: true, next: "/account" });
  expect(await f.db.select().from(schema.membership)).toHaveLength(0);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie }))).status).toBe(403);
  const staged = await f.dispatch(f.request("/api/invitations/open", { token: randomBytes(32).toString("base64url") })), pending = cookieOf(staged);
  const prepared = await f.dispatch(f.request("/api/auth/google/challenge", { intent: "account" }, { cookie: pending })), selected = await prepared.json();
  const response = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: token(selected.nonce), challengeId: selected.challengeId, csrfToken: selected.csrfToken }, { cookie: `${pending}; ${cookieOf(prepared)}` }));
  expect(await response.json()).toEqual({ ok: true, next: "/invitations/accept" }); expect(await f.db.select().from(schema.membership)).toHaveLength(0);
  // An expired pending cookie cannot override a fresh fixed Account challenge.
  const oldPending = createPendingInvitations({ secret: f.config.authSecret, origin: f.origin, environment: "local", now: () => Date.now() - 600001 });
  const oldCookie = cookieOf(oldPending.exchange(f.request("/api/invitations/open", {}), randomBytes(32).toString("base64url")));
  const expired = await f.dispatch(f.request("/api/auth/google/challenge", { intent: "account" }, { cookie: oldCookie })), renewed = await expired.json(); expect(expired.status).toBe(200);
  const resolved = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: token(renewed.nonce), challengeId: renewed.challengeId, csrfToken: renewed.csrfToken }, { cookie: cookieOf(expired) }));
  expect(await resolved.json()).toEqual({ ok: true, next: "/account" }); expect(await f.db.select().from(schema.membership)).toHaveLength(0);
});

test("discarded hostile Forwarded cannot bypass real Google nonce/body verification, Origin or CSRF or reach SDK headers", async () => {
  const f = await fixture(), token = googleTokens();
  const forwarded = 'for="[2001:db8::1]:4711";host="foreign.example.test";proto=https, for=unknown;extension=synthetic-private';
  const prepared = await f.dispatch(f.request("/api/auth/google/challenge", {}, { forwarded }));
  expect(prepared.status).toBe(200);
  const issued = await prepared.json(), cookie = cookieOf(prepared);
  const body = { credential: token(issued.nonce), challengeId: issued.challengeId, csrfToken: issued.csrfToken };
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie, forwarded, origin: "https://foreign.example.test" }))).status).toBe(403);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", { ...body, csrfToken: randomBytes(32).toString("base64url") }, { cookie, forwarded }))).status).toBe(403);
  expect(f.sdk.mock.calls.length).toBe(0);
  const response = await f.dispatch(f.request("/api/auth/sign-in/social", body, { cookie, forwarded }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, next: "/" });
  expect(f.sdk.mock.calls.length).toBe(1);
  expect(f.sdk.mock.calls.every(([request]) => !(request as Request).headers.has("forwarded"))).toBe(true);
  const forged = await f.dispatch(new Request("http://foreign.example.test/api/auth/google/challenge", { method: "POST", headers: { origin: f.origin, "content-type": "application/json", forwarded }, body: "{}" }));
  expect(forged.status).toBe(404);
});

// Each case owns one migrated database and JWKS mock. Keeping all seven under
// one deadline retained fixtures and could let a timed-out body outlive cleanup.
test.each([
  { label: "missing nonce", override: { nonce: undefined } },
  { label: "mismatching nonce", override: { nonce: "attacker" } },
  { label: "wrong audience", override: { aud: "foreign-client" } },
  { label: "wrong issuer", override: { iss: "https://foreign.example.test" } },
  { label: "expired token", override: { exp: 1 } },
  { label: "unverified same-email linking", override: { email_verified: false } },
])("real verifier refuses $label without linking an account", async ({ override }) => {
  const f = await fixture(); const token = googleTokens();
  await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "http-identity@example.test" }));
  await f.dispatch(f.request("/api/auth/email/confirm", { token: tokenOf(f.messages[0].url) }));
  const issued = await challenge(f);
  const response = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: token(issued.nonce, override), challengeId: issued.challengeId, csrfToken: issued.csrfToken }, { cookie: issued.cookie }));
  expect(response.status).toBe(400);
  expect((await f.db.select().from(schema.account)).length).toBe(0);
});

test("real verifier refuses a bad signature", async () => {
  const f = await fixture(); const token = googleTokens(); const issued = await challenge(f);
  const valid = token(issued.nonce); const pieces = valid.split("."); pieces[2] = "A".repeat(pieces[2].length);
  const response = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: pieces.join("."), challengeId: issued.challengeId, csrfToken: issued.csrfToken }, { cookie: issued.cookie }));
  expect(response.status).toBe(400);
});

test("verified same-email magic then Google and Google then magic keep one identity without authority grants", async () => {
  for (const googleFirst of [false, true]) {
    const f = await fixture(); const token = googleTokens();
    const emailSignIn = async () => {
      await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "http-identity@example.test" }));
      expect((await f.dispatch(f.request("/api/auth/email/confirm", { token: tokenOf(f.messages[0].url) }))).status).toBe(200);
    };
    if (!googleFirst) await emailSignIn();
    const issued = await challenge(f);
    expect((await f.dispatch(f.request("/api/auth/sign-in/social", { credential: token(issued.nonce), challengeId: issued.challengeId, csrfToken: issued.csrfToken }, { cookie: issued.cookie }))).status).toBe(200);
    if (googleFirst) await emailSignIn();
    expect((await f.db.select().from(schema.user)).length).toBe(1);
    expect((await f.db.select().from(schema.account)).length).toBe(1);
    expect((await f.db.select().from(schema.membership)).length).toBe(0);
  }
});

test("challenge browser/CSRF/closed body/host boundaries precede SDK and whole-envelope size stays 16 KiB", async () => {
  const f = await fixture(); const issued = await challenge(f);
  const body = { credential: fakeCredential, challengeId: issued.challengeId, csrfToken: issued.csrfToken };
  for (const [request, status] of [
    [f.request("/api/auth/sign-in/social", body), 403],
    [f.request("/api/auth/sign-in/social", { ...body, csrfToken: randomBytes(32).toString("base64url") }, { cookie: issued.cookie }), 403],
    [f.request("/api/auth/sign-in/social", { ...body, nonce: issued.nonce }, { cookie: issued.cookie }), 400],
    [f.request("/api/auth/sign-in/social", { provider: "google", idToken: { token: fakeCredential } }), 400],
    [f.request("/api/auth/sign-in/social", { ...body, credential: "A".repeat(17000) }), 413],
    [f.request("/api/auth/google/challenge", {}, { origin: "https://foreign.example.test" }), 403],
    [f.request("/api/auth/google/challenge", {}, { "sec-fetch-site": "cross-site" }), 403],
    [f.request("/api/auth/google/challenge", {}, { "X-Practice-Context": "opaque" }), 403],
    [f.request("/api/auth/google/challenge?state=synthetic", {}), 400],
    [f.request("/api/auth/google/challenge", {}, { host: "foreign.example.test" }), 404],
    [f.request("/api/auth/google/challenge", {}, { cookie: `${issued.cookie}; ${issued.cookie}` }), 400],
  ] as [Request, number][]) expect((await f.dispatch(request)).status).toBe(status);
  expect(f.sdk.mock.calls.length).toBe(0);
  for (const path of ["/api/auth/magic-link/verify?token=synthetic", "/api/auth/get-session"]) expect((await f.dispatch(f.request(path))).status).toBe(404);
  // Google's redirect-mode return is routed, but an unknown state only ever lands on the sign-in error.
  const unknown = await f.dispatch(f.request("/api/auth/callback/google?code=synthetic&state=synthetic"));
  expect(unknown.status).toBe(303); expect(unknown.headers.get("location")).toBe("/sign-in?error=authentication"); expect(unknown.headers.getSetCookie()).toEqual([]);
  expect((await f.dispatch(f.request("/api/auth/email/confirm"))).status).toBe(405);
});

test("SDK response projection discards diagnostics, tokens and Locations and preserves only reviewed cookies", async () => {
  const f = await fixture(); const marker = "synthetic-private-sdk-value";
  for (const status of [200, 429, 500, 302]) {
    const issued = await challenge(f);
    const setCookie = "better-auth.session_token=synthetic-valid-cookie; Path=/; HttpOnly; SameSite=Lax; Max-Age=600";
    f.sdk.mockImplementationOnce(async () => new Response(JSON.stringify({ token: marker, user: { email: "private@example.test" } }), { status, headers: { "x-provider-error": marker, "set-cookie": setCookie, ...(status === 302 ? { location: `https://foreign.example.test/${marker}` } : {}) } }));
    const response = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: fakeCredential, challengeId: issued.challengeId, csrfToken: issued.csrfToken }, { cookie: issued.cookie }));
    expect(response.status).toBe(status === 200 ? 200 : status === 429 ? 429 : status === 500 ? 503 : 400);
    expect(response.headers.has("location") || response.headers.has("x-provider-error") || (await response.text()).includes(marker)).toBe(false);
    expect(response.headers.getSetCookie()).toEqual(status === 200 ? [setCookie] : []);
  }
  // Magic verification with a rejected Location must also discard a perfectly
  // shaped SDK session cookie, not merely hide its redirect/body.
  f.sdk.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: "https://foreign.example.test/", "set-cookie": "better-auth.session_token=synthetic-valid-cookie; Path=/; HttpOnly; SameSite=Lax; Max-Age=600" } }));
  const rejected = await f.dispatch(f.request("/api/auth/email/confirm", { token: "A".repeat(32) }));
  expect(rejected.status).toBe(400); expect(rejected.headers.getSetCookie()).toEqual([]);
  const issued = await challenge(f);
  f.sdk.mockImplementationOnce(async () => new Response("{}", { status: 200, headers: { location: "https://foreign.example.test/", "set-cookie": "better-auth.session_token=synthetic-valid-cookie; Path=/; HttpOnly; SameSite=Lax; Max-Age=600" } }));
  const unexpectedLocation = await f.dispatch(f.request("/api/auth/sign-in/social", { credential: fakeCredential, challengeId: issued.challengeId, csrfToken: issued.csrfToken }, { cookie: issued.cookie }));
  expect(unexpectedLocation.status).toBe(400); expect(unexpectedLocation.headers.getSetCookie()).toEqual([]);
  f.sdk.mockImplementationOnce(async () => new Response("{}", { status: 500, headers: { "set-cookie": "better-auth.session_token=synthetic-valid-cookie; Path=/; HttpOnly; SameSite=Lax; Max-Age=600" } }));
  const failedLogout = await f.dispatch(f.request("/api/auth/sign-out", {}));
  expect(failedLogout.status).toBe(503); expect(failedLogout.headers.getSetCookie()).toEqual([]);
});

test("rotated caller IP headers cannot reset SDK or challenge issuance budgets", async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index++) expect((await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "budget@example.test" }, { "x-forwarded-for": `192.0.2.${index}` }))).status).toBe(200);
  expect((await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "other@example.test" }, { [AUTH_RATE_LIMIT_HEADER]: "192.0.2.80" }))).status).toBe(429);
  const requests = f.sdk.mock.calls.map(([request]) => request as Request);
  expect(new Set(requests.map(request => request.headers.get(AUTH_RATE_LIMIT_HEADER))).size).toBe(1);
  expect(requests.every(request => !request.headers.has("x-forwarded-for"))).toBe(true);
  const issued = await challenge(f);
  for (let index = 0; index < 4; index++) await challenge(f, issued.cookie);
  expect((await f.dispatch(f.request("/api/auth/google/challenge", {}, { cookie: issued.cookie, "x-forwarded-for": "192.0.2.90" }))).status).toBe(429);
});

test("unknown routes reject without configuration; missing provider and private failures stay fixed", async () => {
  let scopes = 0; const absent = createHttpDispatcher(async () => { scopes++; throw new RuntimeUnavailable(); });
  for (const path of ["/api/auth/magic-link/verify?token=synthetic", "/api/auth/get-session"]) expect((await absent(new Request(`http://localhost:3000${path}`))).status).toBe(404);
  expect(scopes).toBe(0);
  const unavailable = await absent(new Request("http://localhost:3000/api/auth/callback/google?code=synthetic", { headers: { cookie: "portal_google_return=connect" } }));
  expect(unavailable.status).toBe(303); expect(unavailable.headers.get("location")).toBe("/connect?google=failed");
  const f = await fixture(undefined, false);
  expect((await f.dispatch(f.request("/api/auth/google/challenge", {}))).status).toBe(503);
  f.sdk.mockImplementationOnce(async () => { throw new Error("synthetic-private-diagnostic"); });
  const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "private@example.test" }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "unavailable" });
});

function googleTokenEndpoint() {
  const seen: URLSearchParams[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if ((input instanceof Request ? input.url : String(input)) !== "https://oauth2.googleapis.com/token") throw new Error("Offline auth network refused");
    seen.push(new URLSearchParams(input instanceof Request ? await input.text() : String(init?.body ?? "")));
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    return Response.json({ access_token: "synthetic-access", token_type: "Bearer", expires_in: 3600, scope: "openid email profile",
      id_token: `${part({ alg: "RS256" })}.${part({ iss: "https://accounts.google.com", aud: "synthetic-client", sub: "synthetic-redirect-subject", email: "redirect-identity@example.test", email_verified: true, name: "Synthetic redirect", iat: now, exp: now + 300 })}.AA` });
  });
  return seen;
}
async function startGoogle(f: Awaited<ReturnType<typeof fixture>>, body: Record<string, unknown>) {
  await f.db.delete(schema.rateLimit);
  const started = await f.dispatch(f.request("/api/auth/google/redirect", body));
  expect(started.status).toBe(200);
  const value = await started.json(); expect(Object.keys(value)).toEqual(["url"]);
  const google = new URL(value.url);
  return { google, state: google.searchParams.get("state")!, cookie: cookieOf(started), setCookies: started.headers.getSetCookie() };
}
const callbackPath = (state: string, extra = "") => `/api/auth/callback/google?code=synthetic-code&state=${encodeURIComponent(state)}${extra}`;

test("redirect-mode Google: closed destinations, same-origin POST, Google's URL only, and a fixed landing after state and PKCE", async () => {
  for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org"]) {
    const f = await fixture(origin), exchanged = googleTokenEndpoint(), secure = origin.startsWith("https:");
    // The body names only a destination word; anything else is refused before the SDK.
    for (const body of [{ next: "/connect" }, { next: "https://foreign.example.test" }, { next: ["connect"] }, { next: null }, { callbackURL: "https://foreign.example.test" }, { next: "connect", callbackURL: "/" }, { next: "connect", errorCallbackURL: "https://foreign.example.test" }])
      expect((await f.dispatch(f.request("/api/auth/google/redirect", body))).status).toBe(400);
    for (const [request, status] of [
      [f.request("/api/auth/google/redirect", {}, { origin: "https://foreign.example.test" }), 403],
      [f.request("/api/auth/google/redirect", {}, { "sec-fetch-site": "cross-site" }), 403],
      [f.request("/api/auth/google/redirect", {}, { "X-Practice-Context": "opaque" }), 403],
      [f.request("/api/auth/google/redirect?next=connect", {}), 400],
      [f.request("/api/auth/google/redirect"), 405],
      [f.request("/api/auth/callback/google", {}), 405],
    ] as [Request, number][]) expect((await f.dispatch(request)).status).toBe(status);
    expect(f.sdk.mock.calls.length).toBe(0);
    for (const [body, landing, failure] of [[{}, "/", "/sign-in?error=authentication"], [{ next: "account" }, "/account", "/sign-in?intent=account&error=authentication"], [{ next: "connect" }, "/connect", "/connect?google=failed"]] as const) {
      const first = await startGoogle(f, body);
      expect(first.google.origin + first.google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(first.google.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
      expect(first.google.searchParams.get("code_challenge_method")).toBe("S256");
      expect(first.cookie).toMatch(new RegExp(`(^|; )${secure ? "__Secure-" : ""}better-auth\\.state=`));
      const remembered = first.setCookies.find(value => value.startsWith("portal_google_return="))!;
      expect(remembered).toMatch(/; Path=\/api\/auth\/callback\/google; HttpOnly; SameSite=Lax; Max-Age=600/); expect(remembered.includes("; Secure")).toBe(secure);
      // A return in a browser without this state cookie (the code may sit in a log) consumes the state:
      // the starter's own cookie can no longer complete it, and Google's token endpoint is never called.
      const before = exchanged.length, calls = f.sdk.mock.calls.length;
      const foreign = await f.dispatch(f.request(callbackPath(first.state)));
      expect(foreign.status).toBe(303); expect(foreign.headers.get("location")).toBe("/sign-in?error=authentication"); expect(foreign.headers.getSetCookie()).toEqual([]);
      expect(f.sdk.mock.calls.length).toBe(calls);
      const replay = await f.dispatch(f.request(callbackPath(first.state), undefined, { cookie: first.cookie }));
      expect(replay.headers.get("location")).toBe(failure); expect(exchanged.length).toBe(before);
      const second = await startGoogle(f, body);
      const back = await f.dispatch(f.request(callbackPath(second.state, "&scope=openid%20email%20profile&authuser=0&prompt=consent"), undefined, { cookie: second.cookie }));
      expect(back.status).toBe(303); expect(back.headers.get("location")).toBe(landing);
      expect(createHash("sha256").update(exchanged.at(-1)?.get("code_verifier") ?? "").digest("base64url")).toBe(second.google.searchParams.get("code_challenge"));
      expect(back.headers.getSetCookie().some(value => value.startsWith("portal_google_return=;") && value.includes("Max-Age=0"))).toBe(true);
      expect((await f.dispatch(f.request("/api/session", undefined, { cookie: cookieOf(back) }))).status).toBe(200);
      // The state is single use.
      expect((await f.dispatch(f.request(callbackPath(second.state), undefined, { cookie: second.cookie }))).headers.get("location")).toBe(failure);
    }
    // Google's refusal goes back to where the person started; malformed, duplicated or unsigned state never reaches the SDK.
    const denied = await startGoogle(f, { next: "connect" });
    expect((await f.dispatch(f.request(`/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(denied.state)}`, undefined, { cookie: denied.cookie }))).headers.get("location")).toBe("/connect?google=failed");
    const calls = f.sdk.mock.calls.length;
    for (const path of ["/api/auth/callback/google?code=a&code=b&state=s", "/api/auth/callback/google?code=synthetic", "/api/auth/callback/google?code=synthetic&state=short", `/api/auth/callback/google?code=synthetic&state=${"A".repeat(32)}`])
      expect((await f.dispatch(f.request(path, undefined, { cookie: denied.cookie }))).headers.get("location")).toBe("/connect?google=failed");
    const forged = await startGoogle(f, { next: "connect" }), stateCookie = forged.cookie.split("; ").find(value => value.includes("better-auth.state="))!;
    expect(f.sdk.mock.calls.length).toBe(calls + 1); // the forged start itself
    const tampered = stateCookie.replace(/=(.*)$/, () => `=${encodeURIComponent(`${forged.state}.${"A".repeat(43)}=`)}`);
    expect((await f.dispatch(f.request(callbackPath(forged.state), undefined, { cookie: tampered }))).headers.get("location")).toBe("/sign-in?error=authentication");
    expect(f.sdk.mock.calls.length).toBe(calls + 1);
    // Any SDK Location off the fixed list, or an SDK failure, lands on the plain error with no cookies.
    for (const location of ["https://foreign.example.test/connect", "//foreign.example.test/", "/connect?next=https://foreign.example.test", "/workspace/admin", `${origin}/connect#x`]) {
      const started = await startGoogle(f, { next: "connect" });
      f.sdk.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location, "set-cookie": `${secure ? "__Secure-" : ""}better-auth.session_token=synthetic; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}` } }));
      const projected = await f.dispatch(f.request(callbackPath(started.state), undefined, { cookie: started.cookie }));
      expect(projected.headers.get("location")).toBe("/connect?google=failed");
      expect(projected.headers.getSetCookie().some(value => value.includes("session_token"))).toBe(false);
    }
    const thrown = await startGoogle(f, { next: "account" });
    f.sdk.mockImplementationOnce(async () => { throw new Error("synthetic-private-diagnostic"); });
    const failed = await f.dispatch(f.request(callbackPath(thrown.state), undefined, { cookie: thrown.cookie }));
    expect(failed.status).toBe(303); expect(failed.headers.get("location")).toBe("/sign-in?intent=account&error=authentication");
    // Only Google's authorization endpoint is ever handed to the browser.
    for (const url of ["https://foreign.example.test/o/oauth2/v2/auth?state=x", "https://accounts.google.com.foreign.example.test/o/oauth2/v2/auth?x=1", "https://accounts.google.com/o/oauth2/other?x=1", "javascript:alert(1)"]) {
      await f.db.delete(schema.rateLimit);
      f.sdk.mockImplementationOnce(async () => Response.json({ url, redirect: false }));
      const refused = await f.dispatch(f.request("/api/auth/google/redirect", {}));
      expect(refused.status).toBe(503); expect(refused.headers.getSetCookie().some(value => value.includes("better-auth."))).toBe(false);
    }
    vi.unstubAllGlobals();
  }
});

test("redirect-mode Google spends the popup challenge budget, keeps each return in its own SDK bucket, and needs a configured provider", async () => {
  const f = await fixture(); googleTokenEndpoint();
  const first = await f.dispatch(f.request("/api/auth/google/redirect", {}));
  const browser = first.headers.getSetCookie().map(value => value.split(";")[0]).find(value => value.startsWith("portal_google_binding="))!;
  expect(browser).toBeTruthy();
  for (let index = 0; index < 4; index++) await f.dispatch(f.request("/api/auth/google/challenge", {}, { cookie: browser }));
  expect((await f.dispatch(f.request("/api/auth/google/redirect", {}, { cookie: browser }))).status).toBe(429);
  // Each signed return uses a bucket derived from its own state, never the shared sign-in bucket.
  const a = await startGoogle(f, {}), b = await startGoogle(f, {});
  const start = (f.sdk.mock.calls.at(-1)![0] as Request).headers.get(AUTH_RATE_LIMIT_HEADER);
  await f.dispatch(f.request(callbackPath(a.state), undefined, { cookie: a.cookie }));
  const bucketA = (f.sdk.mock.calls.at(-1)![0] as Request).headers.get(AUTH_RATE_LIMIT_HEADER);
  await f.dispatch(f.request(callbackPath(b.state), undefined, { cookie: b.cookie }));
  const bucketB = (f.sdk.mock.calls.at(-1)![0] as Request).headers.get(AUTH_RATE_LIMIT_HEADER);
  expect(new Set([start, bucketA, bucketB]).size).toBe(3);
  // A victim holding their own signed state cookie for another sign-in, or a tossed duplicate cookie,
  // still consumes the attacker's state; Google's long scope echo is accepted on this route.
  const exchanged = googleTokenEndpoint();
  for (const extra of ["other-state", "duplicate", "malformed"] as const) {
    const attacker = await startGoogle(f, {}), victim = await startGoogle(f, {});
    const cookie = extra === "other-state" ? victim.cookie : extra === "duplicate" ? `${victim.cookie}; portal_google_return=home; portal_google_return=connect`
      : `${attacker.cookie}; x(y=1; =nameless`;
    expect((await f.dispatch(f.request(callbackPath(attacker.state), undefined, { cookie }))).headers.get("location")).toBe("/sign-in?error=authentication");
    const before = exchanged.length;
    expect((await f.dispatch(f.request(callbackPath(attacker.state), undefined, { cookie: attacker.cookie }))).headers.get("location")).toBe("/sign-in?error=authentication");
    expect(exchanged.length).toBe(before);
  }
  const long = await startGoogle(f, {}), scope = encodeURIComponent(Array.from({ length: 60 }, (_, index) => `https://www.googleapis.com/auth/synthetic.scope${index}`).join(" "));
  const echoed = await f.dispatch(f.request(callbackPath(long.state, `&scope=${scope}`), undefined, { cookie: long.cookie }));
  expect(echoed.headers.get("location")).toBe("/");
  const absent = await fixture(undefined, false);
  expect((await absent.dispatch(absent.request("/api/auth/google/redirect", {}))).status).toBe(503);
  const back = await absent.dispatch(absent.request("/api/auth/callback/google?code=synthetic&state=synthetic"));
  expect(back.headers.get("location")).toBe("/sign-in?error=authentication");
});
