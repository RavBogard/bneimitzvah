import { AUTH_RATE_LIMIT_HEADER } from "../../src/server/auth/factory";
import { randomBytes } from "node:crypto";
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
afterEach(async () => { await Promise.all(opened.splice(0).map((f) => f.client.close())); });
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
  return { runtime, sdk, dispatch, request, messages, config, origin };
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

test("actual HTTP magic-link flow generates real SDK session cookie and logout with no session/mail/token JSON for local and canonical HTTPS", async () => {
  for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app"]) {
    const f = await fixture(origin);
    const email = "http-recipient@example.test";
    const start = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email }));
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({ requested: true });
    expect(f.messages.length).toBe(1);
    const message = f.messages[0];
    const verified = await f.dispatch(new Request(message.url));
    expect(verified.status).toBe(303);
    expect(verified.headers.get("location")).toBe("/");
    const cookie = cookieOf(verified);
    expect(cookie.length > 0).toBe(true);
    expect(verified.headers.getSetCookie().some(value => value.startsWith(`${origin.startsWith("https:") ? "__Secure-" : ""}better-auth.session_token=`))).toBe(true);
    const proof = await f.runtime.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
    expect(!!proof && proof.user.emailVerified).toBe(true);
    const summary = await f.dispatch(f.request("/api/session", undefined, { cookie }));
    expect(summary.status).toBe(200);
    const summaryText = await summary.text();
    expect(!summaryText.includes(email) && !summaryText.includes(proof!.session.token) && !summaryText.includes(f.config.authSecret)).toBe(true);
    const out = await f.dispatch(f.request("/api/auth/sign-out", {}, { cookie, "X-Practice-Context": "ignored-for-logout" }));
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect(out.headers.getSetCookie().length > 0).toBe(true);
    expect(await f.runtime.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } }) === null).toBe(true);
    const replay = await f.dispatch(new Request(message.url));
    expect(replay.headers.get("location")).toBe("/sign-in?error=authentication");
    expect((await replay.text()).includes(message.url)).toBe(false);
  }
});

test("pending invite changes only fixed sign-in destination; invalid or missing cookie falls back without exposing its token", async () => {
  const f = await fixture();
  const token = randomBytes(32).toString("base64url");
  const landing = await f.dispatch(new Request(`${f.origin}/invitations/open?token=${token}`));
  expect(landing.status).toBe(303);
  expect(landing.headers.get("location")).toBe("/invitations/accept");
  const cookie = cookieOf(landing);
  const valid = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "pending@example.test" }, { cookie }));
  expect(valid.status).toBe(200);
  expect(new URL(f.messages.at(-1)!.url).searchParams.get("callbackURL")).toBe("/invitations/accept");
  expect(f.messages.at(-1)!.url.includes(token)).toBe(false);
  const verified = await f.dispatch(new Request(f.messages.at(-1)!.url));
  expect(verified.headers.get("location")).toBe("/invitations/accept");
  const fallbackHeaders: Record<string, string>[] = [{}, { cookie: "portal_pending_invitation=invalid" }];
  for (const headers of fallbackHeaders) {
    const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "fallback@example.test" }, headers));
    expect(response.status).toBe(200);
    expect(new URL(f.messages.at(-1)!.url).searchParams.get("callbackURL")).toBe("/");
  }
  expect(f.runtime.pendingInvitations.hasPendingForSignIn(new Request(`${f.origin}/api/auth/sign-in/social`, { method: "POST", headers: { cookie } }))).toBe(true);
  expect(f.runtime.pendingInvitations.hasPendingForSignIn(new Request(`${f.origin}/api/students`, { method: "POST", headers: { cookie } }))).toBe(false);
});

test("actual Google initiation preserves PKCE/state cookies and fixed callbacks while malformed callbacks never contact provider", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Synthetic provider network forbidden"); });
  try {
    for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app"]) {
      const f = await fixture(origin);
      const start = await f.dispatch(f.request("/api/auth/sign-in/social", { provider: "google" }));
      expect(start.status).toBe(200);
      const projected = await start.json();
      expect(Object.keys(projected)).toEqual(["url"]);
      expect(start.headers.get("location")).toBeNull();
      const target = new URL(projected.url);
      expect(target.origin + target.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      expect(target.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
      expect(target.searchParams.get("code_challenge_method")).toBe("S256");
      expect(start.headers.getSetCookie().some(value => value.includes("better-auth.state="))).toBe(true);
      for (const path of ["/api/auth/callback/google?code=synthetic-code&state=invalid", "/api/auth/callback/google?error=denied&error_description=synthetic-private&state=invalid",
        "/api/auth/magic-link/verify?token=synthetic-private", `/api/auth/magic-link/verify?token=${"A".repeat(32)}&callbackURL=https%3A%2F%2Fforeign.example.test`]) {
        const response = await f.dispatch(f.request(path));
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe("/sign-in?error=authentication");
        expect((await response.text()).includes("synthetic-private")).toBe(false);
      }
    }
    expect(network.mock.calls.length).toBe(0);
  } finally { network.mockRestore(); }
});

test("actual host resolution precedes SDK/mail and input/mutation errors retain closed HTTP statuses inside runtime", async () => {
  const f = await fixture();
  for (const request of [new Request("http://foreign.example.test/api/auth/sign-in/magic-link", { method: "POST", headers: { origin: f.origin, "content-type": "application/json" }, body: "{}" }),
    f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { host: "foreign.example.test" }),
    f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { "x-forwarded-host": "foreign.example.test" })]) {
    expect((await f.dispatch(request)).status).toBe(404);
  }
  expect(f.sdk.mock.calls.length).toBe(0); expect(f.messages.length).toBe(0);
  const invalid: [Request, number][] = [
    [f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test", callbackURL: "https://foreign.example.test" }), 400],
    [f.request("/api/auth/sign-in/magic-link", { email: "a".repeat(17000) }), 413],
    [f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { origin: "https://foreign.example.test" }), 403],
    [f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { "sec-fetch-site": "cross-site" }), 403],
    [f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { "X-Practice-Context": "" }), 403],
    [f.request("/api/auth/sign-in/social", { provider: "google", idToken: { token: "forged" } }), 400],
    [f.request("/api/auth/sign-in/social", { provider: "other" }), 400],
    [f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }, { cookie: "better-auth.session_token=a; better-auth.session_token=b" }), 400],
  ];
  for (const [request, status] of invalid) {
    const response = await f.dispatch(request);
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.text()).includes("synthetic@example.test")).toBe(false);
  }
  expect(f.sdk.mock.calls.length).toBe(0);
});

test("unknown SDK paths/methods deny without configuration and runtime/SDK failure diagnostics never escape", async () => {
  let scopes = 0;
  const absent = createHttpDispatcher(async () => { scopes++; throw new RuntimeUnavailable(); });
  for (const path of ["/api/auth/get-session", "/api/auth/list-sessions", "/api/auth/sign-in/email", "/api/auth/callback/other", "/api/__test/latest-token"]) {
    expect((await absent(new Request(`http://localhost:3000${path}`))).status).toBe(404);
  }
  expect((await absent(new Request("http://localhost:3000/api/auth/sign-in/magic-link"))).status).toBe(405);
  expect(scopes).toBe(0);
  expect((await absent(new Request("http://localhost:3000/api/auth/sign-out", { method: "POST" }))).status).toBe(503);
  const f = await fixture(undefined, false);
  expect((await f.dispatch(f.request("/api/auth/sign-in/social", { provider: "google" }))).status).toBe(503);
  const marker = "synthetic-private-sdk-diagnostic";
  f.sdk.mockImplementation(async () => { throw new Error(marker, { cause: { email: "synthetic@example.test" } }); });
  const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }));
  expect(response.status).toBe(503);
  expect((await response.text()).includes(marker)).toBe(false);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    const actualMissing = createHttpDispatcher(createRuntimeScope(() => ({})));
    const denied = await actualMissing(f.request("/api/auth/sign-out", {}));
    expect(denied.status).toBe(503);
    expect((await denied.text()).includes(marker)).toBe(false);
    expect(log.mock.calls.every(args => !args.some(value => String(value).includes(marker)))).toBe(true);
  } finally { log.mockRestore(); }
});

test("SDK response projection rejects unreviewed OAuth destinations and never forwards provider bodies, cookies into JSON or headers", async () => {
  const f = await fixture();
  const marker = "synthetic-private-provider-body";
  for (const result of [
    new Response(JSON.stringify({ url: "https://foreign.example.test/authorize", redirect: true }), { headers: { "x-provider-error": marker } }),
    new Response(JSON.stringify({ token: marker, user: { email: "synthetic@example.test" } })),
    new Response(JSON.stringify({ error: marker }), { status: 500, headers: { "x-provider-error": marker } }),
  ]) {
    f.sdk.mockImplementationOnce(async () => result);
    const response = await f.dispatch(f.request("/api/auth/sign-in/social", { provider: "google" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("x-provider-error")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect((await response.text()).includes(marker)).toBe(false);
  }
  f.sdk.mockImplementationOnce(async () => new Response(JSON.stringify({ token: marker, email: "synthetic@example.test" }), { status: 429, headers: { "x-provider-error": marker } }));
  const limited = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "synthetic@example.test" }));
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({ error: "rate-limited" });
});


test("untrusted IP header rotation cannot reset the shared origin magic-link budget or send more mail", async () => {
  const f = await fixture();
  for (let index = 0; index < 5; index++) {
    const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "shared-budget@example.test" }, { "x-forwarded-for": "192.0.2.20" }));
    expect(response.status === 200).toBe(true);
  }
  const variants: Record<string, string>[] = [
    { "x-forwarded-for": "192.0.2.20" }, { "x-forwarded-for": "192.0.2.21" },
    { "x-real-ip": "192.0.2.22" }, { "cf-connecting-ip": "192.0.2.23", "true-client-ip": "192.0.2.24" },
    { "x-client-ip": "192.0.2.25", "fastly-client-ip": "192.0.2.26" },
    { [AUTH_RATE_LIMIT_HEADER]: "192.0.2.27", "x-forwarded-for": "192.0.2.28" },
    { [AUTH_RATE_LIMIT_HEADER]: "2001:db8:ffff::1", "x-real-ip": "192.0.2.29" },
  ];
  for (const headers of variants) {
    // Distinct recipient is deliberately still limited: this is a shared
    // configured-origin bucket, not proven per-client or per-mailbox protection.
    const response = await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "another-budget@example.test" }, headers));
    expect(response.status === 429 && (await response.json()).error === "rate-limited").toBe(true);
  }
  expect(f.messages.length === 5).toBe(true);
  const requests = f.sdk.mock.calls.map(([request]) => request as Request);
  const buckets = new Set(requests.map(request => request.headers.get(AUTH_RATE_LIMIT_HEADER)));
  expect(buckets.size === 1 && requests.every(request => !request.headers.has("x-forwarded-for") && !request.headers.has("x-real-ip")
    && !request.headers.has("cf-connecting-ip") && !request.headers.has("true-client-ip") && !request.headers.has("x-client-ip") && !request.headers.has("fastly-client-ip"))).toBe(true);
  expect(f.runtime.auth.options.advanced?.ipAddress?.ipAddressHeaders?.join() === AUTH_RATE_LIMIT_HEADER
    && f.runtime.auth.options.advanced?.ipAddress?.ipv6Subnet === 128).toBe(true);
});

test("all SDK entry paths receive only server-selected IP identity while actual host/origin/session cookies survive", async () => {
  const f = await fixture();
  const spoofed = { host: "localhost:3000", "x-forwarded-host": "localhost:3000", "x-forwarded-proto": "http", "x-forwarded-port": "3000",
    "x-forwarded-for": "192.0.2.60", "x-real-ip": "192.0.2.61", "cf-connecting-ip": "192.0.2.62", [AUTH_RATE_LIMIT_HEADER]: "192.0.2.63",
    "x-vercel-forwarded-for": "192.0.2.64", "x-arbitrary-ip": "192.0.2.65", authorization: "synthetic-unsupported-bearer" };
  await f.dispatch(f.request("/api/auth/sign-in/magic-link", { email: "all-paths@example.test" }, spoofed));
  const verified = await f.dispatch(new Request(f.messages[0].url, { headers: spoofed }));
  expect(verified.status === 303).toBe(true);
  const cookie = cookieOf(verified);
  expect(cookie.includes("better-auth.session_token=")).toBe(true);
  const social = await f.dispatch(f.request("/api/auth/sign-in/social", { provider: "google" }, { ...spoofed, cookie }));
  expect(social.status === 200).toBe(true);
  const callback = await f.dispatch(new Request(`${f.origin}/api/auth/callback/google?code=synthetic&state=invalid`, { headers: { ...spoofed, cookie } }));
  expect(callback.status === 303).toBe(true);
  const logout = await f.dispatch(f.request("/api/auth/sign-out", {}, { ...spoofed, cookie }));
  expect(logout.status === 200).toBe(true);
  const requests = f.sdk.mock.calls.map(([request]) => request as Request);
  const bucket = requests[0].headers.get(AUTH_RATE_LIMIT_HEADER);
  expect(requests.length === 5 && bucket !== spoofed[AUTH_RATE_LIMIT_HEADER] && requests.every(request => request.headers.get(AUTH_RATE_LIMIT_HEADER) === bucket
    && request.headers.get("host") === "localhost:3000" && [...request.headers.keys()].every(key => !key.startsWith("x-forwarded-")
      && !["x-real-ip", "cf-connecting-ip", "authorization", "x-vercel-forwarded-for", "x-arbitrary-ip", "forwarded"].includes(key)))).toBe(true);
  const logoutRequest = requests.find(request => new URL(request.url).pathname === "/api/auth/sign-out");
  expect(logoutRequest?.headers.get("cookie") === cookie && logoutRequest.headers.get("origin") === f.origin).toBe(true);
});

test("production directory entries never become simultaneous accepted origins or compatible pending envelopes", async () => {
  const origins = ["https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app"];
  for (const selected of origins) {
    const f = await fixture(selected), other = origins.find(origin => origin !== selected)!;
    expect(JSON.stringify(f.runtime.auth.options.trustedOrigins) === JSON.stringify([selected])).toBe(true);
    expect((await f.runtime.resolveHost({ url: selected, headers: new Headers() })).tenantId === "crc").toBe(true);
    const denied = await f.dispatch(new Request(`${other}/api/auth/sign-in/magic-link`, { method: "POST",
      headers: { origin: other, "content-type": "application/json" }, body: JSON.stringify({ email: "origin-selection@example.test" }) }));
    expect(denied.status).toBe(503);
    expect(await denied.json()).toEqual({ error: "unavailable" });
    expect(f.sdk.mock.calls.length === 0 && f.messages.length === 0).toBe(true);
    const token = randomBytes(32).toString("base64url");
    const landing = f.runtime.pendingInvitations.exchange(new Request(`${selected}/invitations/open?token=${token}`));
    const sealed = landing.headers.getSetCookie()[0];
    expect(sealed.startsWith("__Host-portal_pending_invitation=") && sealed.includes("; Secure") && !sealed.includes("Domain=")).toBe(true);
    const cookie = sealed.split(";")[0];
    const otherPending = createPendingInvitations({ secret: f.config.authSecret, origin: other, environment: "production" });
    let incompatible = false;
    try { otherPending.read(new Request(`${other}/api/invitations/pending`, { headers: { cookie } })); } catch { incompatible = true; }
    expect(incompatible).toBe(true);
    expect(f.runtime.pendingInvitations.read(new Request(`${selected}/api/invitations/pending`, { headers: { cookie } })) === token).toBe(true);
  }
});
