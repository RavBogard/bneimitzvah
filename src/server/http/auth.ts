import "server-only";
import { createHash } from "node:crypto";
import type { HttpRuntime } from "../runtime/composition";
import { AUTH_RATE_LIMIT_HEADER } from "../auth/factory";
import { mailbox } from "../runtime/config";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation } from "./mutations";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { appendSdkCookies, errorResponse, HttpBoundaryError, privateJson } from "./responses";
import { GoogleChallengeLimited } from "./google-challenge";

const methods: Record<string, readonly string[]> = {
  "/api/auth/sign-in/magic-link": ["POST"], "/api/auth/sign-in/social": ["POST"], "/api/auth/sign-out": ["POST"],
  "/api/auth/email/confirm": ["POST"], "/api/auth/google/challenge": ["POST"], "/api/invitations/open": ["POST"],
};
export function authRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(methods, pathname) ? methods[pathname] : null;
}
const successPaths = new Set(["/", "/invitations/accept"]);
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
function sdkRequest(request: Request, body: Record<string, unknown>, origin: string): Request {
  const headers = sdkHeaders(request, origin);
  headers.set("content-type", "application/json");
  return new Request(request.url, { method: "POST", headers, body: JSON.stringify(body), signal: request.signal });
}
function cookies(projected: Response, sdk: Response, origin: string): Response {
  appendSdkCookies(projected.headers, sdk.headers, origin);
  return projected;
}
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
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
    closedObject(raw, []);
    const clientId = runtime.auth.options.socialProviders?.google?.clientId;
    if (typeof clientId !== "string" || !clientId) return errorResponse(undefined);
    try {
      const issued = await runtime.googleChallenges.issue(request, callback);
      const response = privateJson({ ...issued.body, clientId });
      response.headers.append("set-cookie", issued.cookie);
      return response;
    } catch (error) {
      if (error instanceof GoogleChallengeLimited) return privateJson({ error: "rate-limited" }, 429);
      throw error;
    }
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
