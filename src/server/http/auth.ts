import "server-only";
import { createHash } from "node:crypto";
import { AUTH_RATE_LIMIT_HEADER } from "../auth/factory";
import type { HttpRuntime } from "../runtime/composition";
import { RuntimeUnavailable } from "../runtime/errors";
import { AccessDenied } from "../access/errors";
import { mailbox } from "../runtime/config";
import { requireCookieMutation } from "./mutations";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { appendSdkCookies, errorResponse, HttpBoundaryError, privateJson, privateRedirect } from "./responses";

const methods: Record<string, readonly string[]> = {
  "/api/auth/sign-in/magic-link": ["POST"], "/api/auth/sign-in/social": ["POST"], "/api/auth/sign-out": ["POST"],
  "/api/auth/callback/google": ["GET"], "/api/auth/magic-link/verify": ["GET"], "/invitations/open": ["GET"],
};
export function authRouteMethods(pathname: string): readonly string[] | null {
  return Object.hasOwn(methods, pathname) ? methods[pathname] : null;
}
const successPaths = new Set(["/", "/invitations/accept"]);
function sdkHeaders(request: Request, origin: string): Headers {
  // No trusted ingress/IP contract exists yet. Reconstruct a closed header set
  // instead of relaying XFF/Forwarded, vendor IP fields or caller copies of the
  // internal bucket. Actual host/origin/cookies remain intact after dispatcher
  // host checks. Synthetic address is NOT an observed client/network identity.
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
function callbackResponse(sdk: Response, runtime: HttpRuntime): Response {
  let destination: "/" | "/invitations/accept" | "/sign-in?error=authentication" = "/sign-in?error=authentication";
  try {
    const location = sdk.headers.get("location");
    if (sdk.status >= 300 && sdk.status < 400 && location && location.length <= 2048) {
      const target = new URL(location, runtime.origin);
      if (target.origin === runtime.origin && !target.username && !target.password && !target.search && !target.hash && successPaths.has(target.pathname)) {
        destination = target.pathname as "/" | "/invitations/accept";
      }
    }
    return cookies(privateRedirect(destination), sdk, runtime.origin);
  } finally { discard(sdk); }
}
async function googleRedirect(sdk: Response, runtime: HttpRuntime): Promise<Response> {
  try {
    if (sdk.status === 429) return cookies(privateJson({ error: "rate-limited" }, 429), sdk, runtime.origin);
    if (!sdk.ok || !sdk.body) throw new RuntimeUnavailable();
    const body = await readJsonBody(new Request(`${runtime.origin}/internal-auth-response`, { method: "POST", headers: { "content-type": "application/json" },
      body: sdk.body, duplex: "half" } as RequestInit & { duplex: "half" }));
    const value = closedObject(body, ["url", "redirect"]);
    if (typeof value.url !== "string" || value.url.length > 4096 || value.redirect !== true) throw new RuntimeUnavailable();
    const url = new URL(value.url);
    if (url.href !== value.url || url.origin + url.pathname !== "https://accounts.google.com/o/oauth2/v2/auth" || url.username || url.password || url.hash) throw new RuntimeUnavailable();
    const allowed = ["response_type", "client_id", "redirect_uri", "scope", "state", "code_challenge", "code_challenge_method", "access_type", "prompt", "include_granted_scopes"];
    if ([...url.searchParams.keys()].some((key) => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      || url.searchParams.get("redirect_uri") !== `${runtime.origin}/api/auth/callback/google` || url.searchParams.get("response_type") !== "code"
      || url.searchParams.get("client_id") !== runtime.auth.options.socialProviders?.google?.clientId
      || url.searchParams.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{32,128}$/.test(url.searchParams.get("state") ?? "")
      || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "")
      || (url.searchParams.get("scope") ?? "").split(" ").sort().join(" ") !== "email openid profile") throw new RuntimeUnavailable();
    // This is a fetch POST API: a cross-origin303 would be followed by fetch
    // and fail CORS. The client explicitly navigates to this validated URL.
    return cookies(privateJson({ url: url.href }), sdk, runtime.origin);
  } catch { return errorResponse(undefined); }
  finally { discard(sdk); }
}

// Called only after the common dispatcher validates the actual incoming host.
export async function handleAuthRequest(request: Request, runtime: HttpRuntime): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const allowed = authRouteMethods(path);
  if (!allowed) return null;
  if (!allowed.includes(request.method)) throw new HttpBoundaryError(405);
  if (path === "/invitations/open") return runtime.pendingInvitations.exchange(request);
  if (path !== "/api/auth/sign-out" && request.headers.has("X-Practice-Context")) throw new AccessDenied(403);
  if (request.method === "POST") {
    uniqueQuery(request.url, []);
    requireCookieMutation(request, runtime.origin);
    const raw = await readJsonBody(request);
    if (path === "/api/auth/sign-out") {
      closedObject(raw, []);
      const sdk = await runtime.auth.handler(sdkRequest(request, {}, runtime.origin));
      try { return cookies(sdk.ok ? privateJson({ ok: true }) : sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : errorResponse(undefined), sdk, runtime.origin); }
      finally { discard(sdk); }
    }
    const callback = runtime.pendingInvitations.hasPendingForSignIn(request) ? "/invitations/accept" : "/";
    if (path === "/api/auth/sign-in/magic-link") {
      const body = closedObject(raw, ["email"]);
      if (!mailbox(body.email)) throw new HttpBoundaryError();
      const sdk = await runtime.auth.handler(sdkRequest(request, { email: body.email, callbackURL: callback, newUserCallbackURL: callback, errorCallbackURL: "/sign-in" }, runtime.origin));
      try {
        // Never expose SDK account existence/provider diagnostics. Valid email
        // requests have one acknowledgement shape; rate/service failures fixed.
        const response = sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : sdk.status >= 500 ? errorResponse(undefined) : privateJson({ requested: true });
        return cookies(response, sdk, runtime.origin);
      } finally { discard(sdk); }
    }
    const body = closedObject(raw, ["provider"]);
    if (body.provider !== "google") throw new HttpBoundaryError();
    if (!runtime.auth.options.socialProviders?.google) throw new RuntimeUnavailable();
    return googleRedirect(await runtime.auth.handler(sdkRequest(request, { provider: "google", callbackURL: callback, newUserCallbackURL: callback, errorCallbackURL: "/sign-in" }, runtime.origin)), runtime);
  }
  if (path === "/api/auth/magic-link/verify") {
    try {
      const query = uniqueQuery(request.url, ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"]);
      if (!/^[A-Za-z]{32}$/.test(query.get("token") ?? "")) throw 0;
      for (const key of ["callbackURL", "newUserCallbackURL"]) if (query.has(key) && !successPaths.has(query.get(key)!)) throw 0;
      if (query.has("errorCallbackURL") && query.get("errorCallbackURL") !== "/sign-in") throw 0;
      const url = new URL(path, runtime.origin);
      url.searchParams.set("token", query.get("token")!);
      url.searchParams.set("callbackURL", query.get("callbackURL") ?? "/");
      url.searchParams.set("newUserCallbackURL", query.get("newUserCallbackURL") ?? query.get("callbackURL") ?? "/");
      url.searchParams.set("errorCallbackURL", "/sign-in");
      return callbackResponse(await runtime.auth.handler(new Request(url, { headers: sdkHeaders(request, runtime.origin), signal: request.signal })), runtime);
    } catch { return privateRedirect("/sign-in?error=authentication"); }
  }
  try {
    const query = uniqueQuery(request.url, ["code", "state", "scope", "authuser", "prompt", "hd", "error", "error_description", "error_uri"]);
    if (!query.get("state") || (!query.get("code") && !query.get("error"))) throw 0;
    return callbackResponse(await runtime.auth.handler(new Request(request.url, { headers: sdkHeaders(request, runtime.origin), signal: request.signal })), runtime);
  } catch { return privateRedirect("/sign-in?error=authentication"); }
}
