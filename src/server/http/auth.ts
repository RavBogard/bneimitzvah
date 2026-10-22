import "server-only";
import { createHash } from "node:crypto";
import type { HttpRuntime } from "../runtime/composition";
import { AUTH_RATE_LIMIT_HEADER } from "../auth/factory";
import { mailbox } from "../runtime/config";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation } from "./mutations";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { appendSdkCookies, errorResponse, HttpBoundaryError, privateJson, privateRedirect } from "./responses";
import { GoogleChallengeLimited } from "./google-challenge";

const methods: Record<string, readonly string[]> = {
  "/api/auth/sign-in/magic-link": ["POST"], "/api/auth/sign-in/social": ["POST"], "/api/auth/sign-out": ["POST"],
  "/api/auth/email/confirm": ["POST"], "/api/auth/google/challenge": ["POST"], "/api/invitations/open": ["POST"],
  // Redirect-mode Google (Decided here, 2026-10-21): for browsers where the GIS popup fails.
  "/api/auth/google/redirect": ["POST"], "/api/auth/callback/google": ["GET"],
};
export function authRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(methods, pathname) ? methods[pathname] : null;
}
const successPaths = new Set(["/", "/invitations/accept", "/account"]);
// Where a redirect-mode Google sign-in may land. The SDK's own Location is never relayed.
type GoogleReturn = "/" | "/invitations/accept" | "/account" | "/connect";
const googleReturnPaths = new Set<string>(["/", "/invitations/accept", "/account", "/connect"]);
const GOOGLE_AUTHORIZATION = "https://accounts.google.com/o/oauth2/v2/auth";
// The only callback parameters the SDK reads; Google's others (scope, authuser, hd, prompt) are dropped.
const googleCallbackKeys = ["code", "state", "error", "error_description", "iss"] as const;
function sdkHeaders(request: Request, origin: string): Headers {
  // Closed reconstruction: no caller IP/bucket/forwarded fields reach the SDK.
  const headers = new Headers();
  for (const key of ["host", "origin", "cookie", "user-agent", "accept", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  const namespace = createHash("sha256").update(`crc-portal:auth-bucket:v1:${origin}`).digest("hex").slice(0, 24);
  headers.set(AUTH_RATE_LIMIT_HEADER, `2001:0db8:${namespace.match(/.{4}/g)!.join(":")}`);
  return headers;
}
function sdkRequest(request: Request, body: Record<string, unknown>, origin: string, url: string = request.url): Request {
  const headers = sdkHeaders(request, origin);
  headers.set("content-type", "application/json");
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), signal: request.signal });
}
function cookies(projected: Response, sdk: Response, origin: string): Response {
  appendSdkCookies(projected.headers, sdk.headers, origin);
  return projected;
}
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
/** Google's return to /api/auth/callback/google: the SDK checks state (signed cookie and stored verification) and PKCE. */
async function googleCallback(request: Request, runtime: HttpRuntime): Promise<Response> {
  const failed = () => privateRedirect("/sign-in?error=authentication");
  if (!runtime.auth.options.socialProviders?.google) return failed();
  const incoming = new URL(request.url), internal = new URL("/api/auth/callback/google", runtime.origin);
  for (const key of googleCallbackKeys) {
    const values = incoming.searchParams.getAll(key);
    if (values.length > 1 || values.some(value => value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value))) return failed();
    if (values.length) internal.searchParams.set(key, values[0]);
  }
  const sdk = await runtime.auth.handler(new Request(internal, { headers: sdkHeaders(request, runtime.origin), signal: request.signal }));
  try {
    const location = sdk.headers.get("location");
    if (sdk.status >= 300 && sdk.status < 400 && location && location.length <= 2048) {
      const target = new URL(location, runtime.origin);
      if (target.origin === runtime.origin && !target.username && !target.password && !target.search && !target.hash && googleReturnPaths.has(target.pathname)) {
        return cookies(privateRedirect(target.pathname as GoogleReturn), sdk, runtime.origin);
      }
    }
    return failed();
  } finally { discard(sdk); }
}
const failure = () => privateJson({ error: "authentication" }, 400);
function magicResponse(sdk: Response, runtime: HttpRuntime): Response {
  try {
    if (sdk.status === 429) return privateJson({ error: "rate-limited" }, 429);
    const location = sdk.headers.get("location");
    if (sdk.status >= 300 && sdk.status < 400 && location && location.length <= 2048) {
      const target = new URL(location, runtime.origin);
      if (target.origin === runtime.origin && !target.username && !target.password && !target.search && !target.hash && successPaths.has(target.pathname)) {
        return cookies(privateJson({ ok: true, next: target.pathname }), sdk, runtime.origin);
      }
    }
    return failure();
  } finally { discard(sdk); }
}
function credentialValid(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 12 * 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const header = value.split(".")[0];
    if (header.length > 2048 || Buffer.from(header, "base64url").toString("base64url") !== header) return false;
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    return !!parsed && typeof parsed === "object" && parsed.alg === "RS256";
  } catch { return false; }
}

// Only called after dispatcher resolves the actual exact incoming host.
export async function handleAuthRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const allowed = authRouteMethods(path);
  if (!allowed) return null;
  if (!allowed.includes(request.method)) throw new HttpBoundaryError(405);
  if (path !== "/api/auth/sign-out" && request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
  // A top-level cross-site navigation back from Google, not a portal mutation.
  if (path === "/api/auth/callback/google") return googleCallback(request, runtime);
  uniqueQuery(request.url, []);
  requireCookieMutation(request, runtime.origin);
  const raw = await readJsonBody(request); // Entire envelope stays within 16 KiB.
  if (path === "/api/invitations/open") {
    const body = closedObject(raw, ["token"]);
    return runtime.pendingInvitations.exchange(request, body.token);
  }
  if (path === "/api/auth/sign-out") {
    closedObject(raw, []);
    const sdk = await runtime.auth.handler(sdkRequest(request, {}, runtime.origin));
    try {
      const accepted = sdk.status === 200 && !sdk.headers.has("location");
      const response = accepted ? cookies(privateJson({ ok: true }), sdk, runtime.origin) : sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : errorResponse(undefined);
      if (accepted) response.headers.append("set-cookie", runtime.googleChallenges.clear());
      return response;
    } finally { discard(sdk); }
  }
  const callback = runtime.pendingInvitations.hasPendingForSignIn(request) ? "/invitations/accept" : "/";
  if (path === "/api/auth/sign-in/magic-link") {
    const body = closedObject(raw, ["email"]);
    if (!mailbox(body.email)) throw new HttpBoundaryError();
    const sdk = await runtime.auth.handler(sdkRequest(request, { email: body.email, callbackURL: callback, newUserCallbackURL: callback, errorCallbackURL: "/sign-in" }, runtime.origin));
    try {
      const response = sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : sdk.status >= 500 ? errorResponse(undefined) : privateJson({ requested: true });
      return sdk.status === 200 && !sdk.headers.has("location") ? cookies(response, sdk, runtime.origin) : response;
    } finally { discard(sdk); }
  }
  if (path === "/api/auth/email/confirm") {
    const body = closedObject(raw, ["token"]);
    if (typeof body.token !== "string" || !/^[A-Za-z]{32}$/.test(body.token)) throw new HttpBoundaryError();
    // Credential-bearing URL exists only inside this process. Never fetch it.
    const internal = new URL("/api/auth/magic-link/verify", runtime.origin);
    internal.searchParams.set("token", body.token);
    internal.searchParams.set("callbackURL", callback);
    internal.searchParams.set("newUserCallbackURL", callback);
    internal.searchParams.set("errorCallbackURL", "/sign-in");
    return magicResponse(await runtime.auth.handler(new Request(internal, { headers: sdkHeaders(request, runtime.origin), signal: request.signal })), runtime);
  }
  if (path === "/api/auth/google/challenge") {
    const body = closedObject(raw, [], ["intent"]);
    if (Object.hasOwn(body, "intent") && body.intent !== "account") throw new HttpBoundaryError();
    const clientId = runtime.auth.options.socialProviders?.google?.clientId;
    if (typeof clientId !== "string" || !clientId) return errorResponse(undefined);
    try {
      const issued = await runtime.googleChallenges.issue(request, callback === "/invitations/accept" ? callback : body.intent === "account" ? "/account" : "/");
      const response = privateJson({ ...issued.body, clientId });
      response.headers.append("set-cookie", issued.cookie);
      return response;
    } catch (error) {
      if (error instanceof GoogleChallengeLimited) return privateJson({ error: "rate-limited" }, 429);
      throw error;
    }
  }
  if (path === "/api/auth/google/redirect") {
    const body = closedObject(raw, [], ["next"]);
    if (Object.hasOwn(body, "next") && body.next !== "connect" && body.next !== "account") throw new HttpBoundaryError();
    if (!runtime.auth.options.socialProviders?.google) return errorResponse(undefined);
    let budget: string;
    try { budget = await runtime.googleChallenges.limit(request); }
    catch (error) { if (error instanceof GoogleChallengeLimited) return privateJson({ error: "rate-limited" }, 429); throw error; }
    const next: GoogleReturn = body.next === "connect" ? "/connect" : callback === "/invitations/accept" ? callback : body.next === "account" ? "/account" : "/";
    const sdk = await runtime.auth.handler(sdkRequest(request, { provider: "google", callbackURL: next, newUserCallbackURL: next, errorCallbackURL: "/sign-in", disableRedirect: true },
      runtime.origin, new URL("/api/auth/sign-in/social", runtime.origin).href));
    try {
      if (sdk.status === 429) return privateJson({ error: "rate-limited" }, 429);
      if (sdk.status !== 200 || sdk.headers.has("location")) return sdk.status >= 500 ? errorResponse(undefined) : failure();
      const value: unknown = await sdk.json();
      const url = value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string" ? (value as { url: string }).url : "";
      if (url.length > 4096 || !url.startsWith(`${GOOGLE_AUTHORIZATION}?`)) return errorResponse(undefined);
      const target = new URL(url);
      if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth" || target.username || target.password || target.hash) return errorResponse(undefined);
      const response = cookies(privateJson({ url: target.href }), sdk, runtime.origin);
      response.headers.append("set-cookie", budget);
      return response;
    } finally { discard(sdk); }
  }
  const body = closedObject(raw, ["credential", "challengeId", "csrfToken"]);
  if (!credentialValid(body.credential)) throw new HttpBoundaryError();
  if (!runtime.auth.options.socialProviders?.google) return errorResponse(undefined);
  const challenge = await runtime.googleChallenges.consume(request, body.challengeId, body.csrfToken);
  const sdk = await runtime.auth.handler(sdkRequest(request, { provider: "google", idToken: { token: body.credential, nonce: challenge.nonce }, callbackURL: challenge.next }, runtime.origin));
  try {
    const response = sdk.status === 200 && !sdk.headers.has("location") ? privateJson({ ok: true, next: challenge.next })
      : sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : sdk.status >= 500 ? errorResponse(undefined) : failure();
    return sdk.status === 200 && !sdk.headers.has("location") ? cookies(response, sdk, runtime.origin) : response;
  } finally { discard(sdk); }
}
