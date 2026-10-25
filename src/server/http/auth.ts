import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { HttpRuntime } from "../runtime/composition";
import { AUTH_RATE_LIMIT_HEADER, SIGN_IN_CODE } from "../auth/factory";
import { mailbox } from "../runtime/config";
import { AccessDenied } from "../access/errors";
import { requireCookieMutation } from "./mutations";
import { readJsonBody } from "./body";
import { closedObject, uniqueQuery } from "./query";
import { appendSdkCookies, errorResponse, HttpBoundaryError, privateJson, privateRedirect, privateReturnRedirect } from "./responses";
import { returnAddress } from "../../lib/site/return-address";
import { GoogleChallengeLimited } from "./google-challenge";

const methods: Record<string, readonly string[]> = {
  "/api/auth/sign-in/magic-link": ["POST"], "/api/auth/sign-in/social": ["POST"], "/api/auth/sign-out": ["POST"],
  "/api/auth/email/confirm": ["POST"], "/api/auth/google/challenge": ["POST"], "/api/invitations/open": ["POST"],
  // Redirect-mode Google (Decided here, 2026-10-21): for browsers where the GIS popup fails.
  "/api/auth/google/redirect": ["POST"], "/api/auth/callback/google": ["GET"],
  // The typed sign-in code (1.5): the code only; the address comes from this device's sealed binding cookie.
  "/api/auth/sign-in/code": ["POST"],
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
// Where a failed Google return goes: back to the page the person started from, with a plain error.
// A small non-secret cookie scoped to the callback path remembers it (only these three values).
const GOOGLE_RETURN_COOKIE = "portal_google_return";
const googleFailurePaths = { connect: "/connect?google=failed", account: "/sign-in?intent=account&error=authentication", home: "/sign-in?error=authentication" } as const;
type GoogleStart = keyof typeof googleFailurePaths;
function requestCookies(request: Request): Map<string, string | null> {
  // A duplicated name is recorded as null and never trusted.
  const values = new Map<string, string | null>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const pair = part.trim(), equal = pair.indexOf("=");
    if (equal < 1) continue;
    const name = pair.slice(0, equal);
    values.set(name, values.has(name) ? null : pair.slice(equal + 1));
  }
  return values;
}
const returnCookie = (value: GoogleStart | "", secure: boolean) =>
  `${GOOGLE_RETURN_COOKIE}=${value}; Path=/api/auth/callback/google; HttpOnly; SameSite=Lax; Max-Age=${value ? 600 : 0}${secure ? "; Secure" : ""}`;
/** The fixed failure landing for a Google return; also used by the dispatcher when the runtime itself fails. */
export function googleCallbackFailure(request: Request): Response {
  const started = requestCookies(request).get(GOOGLE_RETURN_COOKIE);
  return privateRedirect(googleFailurePaths[started === "connect" || started === "account" ? started : "home"]);
}
/**
 * True only when this browser holds the SDK's own signed state cookie for exactly this state. The SDK
 * checks the same thing, but only after reading the stored state, and on failure it leaves that state
 * in place; checking first lets a return from the wrong browser consume the state instead.
 */
function stateBound(request: Request, origin: string, state: string, secret: string): boolean {
  const header = request.headers.get("cookie") ?? "", jar = requestCookies(request);
  // Any duplicated cookie name (for example one tossed from a sibling subdomain) counts as unbound.
  // This route skips the dispatcher's cookie check, so any odd header (oversized, control characters,
  // a nameless or malformed name, a duplicate) is refused here and still consumes the state.
  const pairs = header.split(";").map(part => part.trim()).filter(Boolean);
  if (Buffer.byteLength(header) > 16 * 1024 || /[\x00-\x1f\x7f]/.test(header) || [...jar.values()].includes(null)
    || pairs.some(pair => { const equal = pair.indexOf("="); return equal < 1 || !/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.test(pair.slice(0, equal)); })) return false;
  const raw = jar.get(`${origin.startsWith("https:") ? "__Secure-" : ""}better-auth.state`);
  if (!raw) return false;
  let value: string;
  try { value = decodeURIComponent(raw); } catch { return false; }
  const dot = value.lastIndexOf(".");
  if (dot < 1 || value.slice(0, dot) !== state) return false;
  const signature = Buffer.from(value.slice(dot + 1)), expected = Buffer.from(createHmac("sha256", secret).update(state).digest("base64"));
  return signature.length === expected.length && timingSafeEqual(signature, expected);
}
function sdkHeaders(request: Request, origin: string, bucket = ""): Headers {
  // Closed reconstruction: no caller IP/bucket/forwarded fields reach the SDK.
  const headers = new Headers();
  for (const key of ["host", "origin", "cookie", "user-agent", "accept", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  // The SDK rate-limits by this synthetic address. A Google return gets one bucket per state, so a
  // flood of returns can only exhaust its own state's budget, never everyone's.
  const namespace = createHash("sha256").update(`crc-portal:auth-bucket:v1:${origin}${bucket ? `:${bucket}` : ""}`).digest("hex").slice(0, 24);
  headers.set(AUTH_RATE_LIMIT_HEADER, `2001:0db8:${namespace.match(/.{4}/g)!.join(":")}`);
  return headers;
}
function sdkRequest(request: Request, body: Record<string, unknown>, origin: string, url: string = request.url, bucket = ""): Request {
  const headers = sdkHeaders(request, origin, bucket);
  headers.set("content-type", "application/json");
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body), signal: request.signal });
}
function cookies(projected: Response, sdk: Response, origin: string): Response {
  appendSdkCookies(projected.headers, sdk.headers, origin);
  return projected;
}
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
/**
 * Google's return to /api/auth/callback/google (MISSION amendment 2026-10-21: its code and state may
 * appear in Vercel request logs for this route only). The SDK checks the state (signed cookie and the
 * stored, single-use verification) and PKCE. Before that, a return without this browser's own signed
 * state cookie consumes the state and stops: a code read from a log can then never be replayed with
 * the cookie of whoever started that sign-in, and such returns never reach the SDK's rate limiter.
 */
async function googleCallback(request: Request, runtime: HttpRuntime): Promise<Response> {
  const secure = runtime.origin.startsWith("https:");
  const started = requestCookies(request).has(GOOGLE_RETURN_COOKIE);
  const failed = () => { const response = googleCallbackFailure(request); if (started) response.headers.append("set-cookie", returnCookie("", secure)); return response; };
  // The state is read first, so every refusal below can consume it (the code may already be in a log).
  // The SDK mints 32 characters from this alphabet; IdP-initiated sign-in (no state) is not used.
  let incoming: URL | undefined;
  try { incoming = new URL(request.url); } catch { return failed(); }
  const states = incoming.searchParams.getAll("state");
  const state = states.length === 1 && /^[A-Za-z0-9_-]{32}$/.test(states[0]) ? states[0] : null;
  const refuse = async () => {
    // The pinned SDK's state identifier (better-auth 1.7.10, state.mjs getAuthStateVerificationIdentifier).
    if (state) try { await (await runtime.auth.$context).internalAdapter.deleteVerificationByIdentifier(`auth-state:${state}`); } catch { /* still refused */ }
    return failed();
  };
  try {
    if (!runtime.auth.options.socialProviders?.google || !state) return await refuse();
    const internal = new URL("/api/auth/callback/google", runtime.origin);
    for (const key of googleCallbackKeys) {
      const values = incoming.searchParams.getAll(key);
      if (values.length > 1 || values.some(value => value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value))) return await refuse();
      if (values.length) internal.searchParams.set(key, values[0]);
    }
    const context = await runtime.auth.$context;
    if (!stateBound(request, runtime.origin, state, context.secret)) return await refuse();
    const sdk = await runtime.auth.handler(new Request(internal, { headers: sdkHeaders(request, runtime.origin, `callback:${state}`), signal: request.signal }));
    try {
      const location = sdk.headers.get("location");
      if (sdk.status >= 300 && sdk.status < 400 && location && location.length <= 2048) {
        const target = new URL(location, runtime.origin);
        const fixed = !target.search && googleReturnPaths.has(target.pathname), back = fixed ? null : returnAddress(target.pathname + target.search);
        if (target.origin === runtime.origin && !target.username && !target.password && !target.hash && (fixed || back)) {
          // A return address (N20) was stored by the SDK in this sign-in's own single-use state; it is checked again here.
          const response = cookies(back ? privateReturnRedirect(back) : privateRedirect(target.pathname as GoogleReturn), sdk, runtime.origin);
          if (started) response.headers.append("set-cookie", returnCookie("", secure));
          return response;
        }
      }
      return failed();
    } finally { discard(sdk); }
  } catch { return refuse(); }
}
/** An optional `return` in a sign-in request body (N20): absent is none; present, it must be a return address `returnAddress` accepts. */
function requestedReturn(body: Record<string, unknown>): string | null {
  if (!Object.hasOwn(body, "return")) return null;
  const back = returnAddress(body.return);
  if (!back) throw new HttpBoundaryError();
  return back;
}
/**
 * Tries left on this address's outstanding code, after a wrong one. The SDK has already recreated the code with one
 * more try used (better-auth 1.7.10 email-otp: identifier `sign-in-otp-<email>`, value `<hmac>:<tries>`). With none
 * left, or no live code, the person is told to ask again, not to type a fourth time. This only reads: a spent row is
 * left for the SDK, which consumes it and refuses it as too many attempts, so a newer code issued meanwhile is never
 * removed here. Any doubt answers 0: a new email is the way back in.
 */
async function codeTriesLeft(runtime: HttpRuntime, email: string): Promise<number> {
  const identifier = `sign-in-otp-${email}`;
  try {
    const context = await runtime.auth.$context;
    const row = await context.internalAdapter.findVerificationValue(identifier);
    const tries = row && row.expiresAt > new Date() && typeof row.value === "string" ? Number(row.value.slice(row.value.lastIndexOf(":") + 1)) : NaN;
    const left = Number.isSafeInteger(tries) && tries >= 0 ? SIGN_IN_CODE.attempts - tries : 0;
    return Math.max(left, 0);
  } catch { return 0; }
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
    const body = closedObject(raw, ["email"], ["return"]);
    if (!mailbox(body.email)) throw new HttpBoundaryError();
    const back = requestedReturn(body);
    const sdk = await runtime.auth.handler(sdkRequest(request, { email: body.email, callbackURL: callback, newUserCallbackURL: callback, errorCallbackURL: "/sign-in" }, runtime.origin));
    try {
      const response = sdk.status === 429 ? privateJson({ error: "rate-limited" }, 429) : sdk.status >= 500 ? errorResponse(undefined) : privateJson({ requested: true });
      if (sdk.status !== 200 || sdk.headers.has("location")) return response;
      // The same answer for every address: the email went out with a code, and this device may type it.
      // Where the code sends the person back to is sealed with the address; the link in the email keeps its fixed landing.
      response.headers.append("set-cookie", runtime.signInCodes.issue(body.email, back));
      return cookies(response, sdk, runtime.origin);
    } finally { discard(sdk); }
  }
  if (path === "/api/auth/sign-in/code") {
    const body = closedObject(raw, ["code"]);
    if (typeof body.code !== "string" || !/^\d{6}$/.test(body.code)) throw new HttpBoundaryError();
    // 409: this device has no usable code (none asked for here, tampered, or past its 5 minutes). Ask again.
    const expired = () => { const response = privateJson({ error: "expired" }, 409); response.headers.append("set-cookie", runtime.signInCodes.clear()); return response; };
    const bound = runtime.signInCodes.read(request);
    if (!bound) return expired();
    // 9 failed tries for this address within the hour: every code is refused, right or wrong, until the hour passes,
    // with the same answer as an expired code. The link in the email still works.
    if (await runtime.signInCodeCap.guessesSpent(bound.email)) return expired();
    const sdk = await runtime.auth.handler(sdkRequest(request, { email: bound.email, otp: body.code }, runtime.origin,
      new URL("/api/auth/sign-in/email-otp", runtime.origin).href, `code:${bound.bucket}`));
    try {
      if (sdk.status === 429) return privateJson({ error: "rate-limited" }, 429);
      if (sdk.status === 200 && !sdk.headers.has("location")) {
        // A pending invitation still wins; otherwise the sealed return address, if this device asked for one.
        const response = cookies(privateJson({ ok: true, next: callback === "/" && bound.back ? bound.back : callback }), sdk, runtime.origin);
        response.headers.append("set-cookie", runtime.signInCodes.clear());
        return response;
      }
      if (sdk.status !== 400 && sdk.status !== 403) return errorResponse(undefined);
      let reason: unknown;
      try { const text = await sdk.text(); reason = text.length <= 4096 ? (JSON.parse(text) as { code?: unknown }).code : undefined; } catch { reason = undefined; }
      // A wrong code keeps this device's binding while the code has tries left (the code counts them, not the
      // binding); a spent, used or expired code does not.
      if (reason === "INVALID_OTP") {
        await runtime.signInCodeCap.recordGuess(bound.email);
        return await codeTriesLeft(runtime, bound.email) > 0 && !await runtime.signInCodeCap.guessesSpent(bound.email) ? privateJson({ error: "code" }, 400) : expired();
      }
      return reason === "OTP_EXPIRED" || reason === "TOO_MANY_ATTEMPTS" ? expired() : errorResponse(undefined);
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
    const body = closedObject(raw, [], ["next", "return"]);
    if (Object.hasOwn(body, "next") && body.next !== "connect" && body.next !== "account") throw new HttpBoundaryError();
    // A fixed destination word or a return address (N20), never both.
    if (Object.hasOwn(body, "next") && Object.hasOwn(body, "return")) throw new HttpBoundaryError();
    const back = requestedReturn(body);
    if (!runtime.auth.options.socialProviders?.google) return errorResponse(undefined);
    let budget: string;
    try { budget = await runtime.googleChallenges.limit(request); }
    catch (error) { if (error instanceof GoogleChallengeLimited) return privateJson({ error: "rate-limited" }, 429); throw error; }
    // The SDK keeps the destination in this sign-in's stored state (single use, bound to its signed state cookie and PKCE),
    // so it cannot be changed on the way back from Google; the return is checked again when the SDK names it.
    const next: string = body.next === "connect" ? "/connect" : callback === "/invitations/accept" ? callback : body.next === "account" ? "/account" : back ?? "/";
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
      response.headers.append("set-cookie", returnCookie(next === "/connect" ? "connect" : next === "/account" ? "account" : "home", runtime.origin.startsWith("https:")));
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
