import "server-only";
import { AccessDenied } from "../access/errors";

export type BoundaryStatus = 400 | 404 | 405 | 408 | 413 | 415;
const messages = { 400: "invalid-request", 401: "authentication-required", 403: "forbidden", 404: "not-found", 405: "method-not-allowed",
  408: "request-timeout", 409: "conflict", 413: "request-too-large", 415: "unsupported-media-type", 429: "rate-limited", 503: "unavailable" } as const;
export class HttpBoundaryError extends Error {
  constructor(readonly status: BoundaryStatus = 400) { super("Request rejected"); this.name = "HttpBoundaryError"; }
}
export function privateHeaders() {
  return new Headers({ "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
}
export function errorResponse(error: unknown): Response {
  let status: keyof typeof messages = 503;
  try {
    const candidate = error instanceof AccessDenied || error instanceof HttpBoundaryError ? error.status : undefined;
    if (error instanceof AccessDenied && (candidate === 401 || candidate === 403 || candidate === 404)) status = candidate;
    else if (error instanceof HttpBoundaryError && (candidate === 400 || candidate === 404 || candidate === 405 || candidate === 408 || candidate === 413 || candidate === 415)) status = candidate;
  } catch { /* Do not expose hostile accessors or diagnostic objects. */ }
  const headers = privateHeaders(); headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: messages[status] }), { status, headers });
}
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export function privateJson(value: JsonValue, status: 200 | 201 | 400 | 409 | 429 = 200): Response {
  try {
    if (![200, 201, 400, 409, 429].includes(status)) throw 0;
    const seen = new Set<object>();
    const copy = (item: unknown, depth: number): JsonValue => {
      if (depth > 16) throw 0;
      if (item === null || typeof item === "string" || typeof item === "boolean") return item;
      if (typeof item === "number" && Number.isFinite(item)) return item;
      if (typeof item !== "object" || !item || seen.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw 0;
      if (Array.isArray(item) && item.length > 5000) throw 0;
      seen.add(item);
      const result: { [key: string]: JsonValue } | JsonValue[] = Array.isArray(item) ? [] : Object.create(null);
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
        if (!Object.hasOwn(descriptor, "value")) throw 0;
        if (Array.isArray(item) && key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key)) throw 0;
        if (descriptor.enumerable) Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
      }
      seen.delete(item);
      return result;
    };
    const serialized = JSON.stringify(copy(value, 0));
    if (Buffer.byteLength(serialized) > 2 * 1024 * 1024) throw 0;
    const headers = privateHeaders(); headers.set("content-type", "application/json; charset=utf-8");
    return new Response(serialized, { status, headers });
  } catch { return errorResponse(undefined); }
}
const localDestinations = new Set(["/", "/sign-in", "/invitations/accept"]);
export function privateRedirect(destination: "/" | "/sign-in" | "/invitations/accept"): Response {
  if (!localDestinations.has(destination)) return errorResponse(undefined);
  const headers = privateHeaders(); headers.set("location", destination);
  return new Response(null, { status: 303, headers });
}

// This copies only reviewed SDK cookie headers into an already projected portal
// response. It never relays SDK JSON, diagnostics, Location or other headers.
// Node24 getSetCookie() preserves Expires commas and separate Set-Cookie fields.
export function appendSdkCookies(target: Headers, source: Headers, origin: string): void {
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !["https:", "http:"].includes(url.protocol)) throw 0;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw 0;
    const secure = url.protocol === "https:";
    const cookies = source.getSetCookie();
    if (cookies.length > 20 || cookies.reduce((size, cookie) => size + Buffer.byteLength(cookie), 0) > 32 * 1024) throw 0;
    const names = new Set<string>();
    for (const cookie of cookies) {
      if (cookie.length > 4096 || /[\x00-\x1f\x7f]/.test(cookie)) throw 0;
      const [pair, ...parts] = cookie.split(";");
      const equal = pair.indexOf("="); const name = pair.slice(0, equal); const value = pair.slice(equal + 1);
      const prefix = secure ? "__Secure-better-auth." : "better-auth.";
      if (equal < 1 || !name.startsWith(prefix) || !/^(?:session_token|state|oauth_state|dont_remember|(?:session_data|account_data)(?:\.[0-9]{1,2})?)$/.test(name.slice(prefix.length))
        || names.has(name) || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value)) throw 0;
      names.add(name);
      const attributes = new Map<string, string>();
      for (const part of parts) {
        const trimmed = part.trim(); const separator = trimmed.indexOf("=");
        const key = (separator < 0 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
        const attr = separator < 0 ? "" : trimmed.slice(separator + 1);
        if (attributes.has(key) || !["path", "httponly", "samesite", "secure", "max-age", "expires"].includes(key)) throw 0;
        attributes.set(key, attr);
      }
      if (attributes.get("path") !== "/" || attributes.get("httponly") !== "" || attributes.get("samesite")?.toLowerCase() !== "lax"
        || attributes.has("secure") !== secure || (secure && attributes.get("secure") !== "")) throw 0;
      const maxAge = attributes.get("max-age");
      if (maxAge !== undefined && (!/^-?\d{1,8}$/.test(maxAge) || Number(maxAge) > 604800)) throw 0;
      const expires = attributes.get("expires");
      if (expires !== undefined && (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(expires) || !Number.isFinite(Date.parse(expires)))) throw 0;
    }
    for (const cookie of cookies) target.append("set-cookie", cookie);
  } catch { throw new Error("Authentication response unavailable"); }
}
