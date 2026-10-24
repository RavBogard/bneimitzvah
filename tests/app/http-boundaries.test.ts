import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readJsonBody } from "../../src/server/http/body";
import { closedObject, uniqueQuery } from "../../src/server/http/query";
import { appendSdkCookies, errorResponse, HttpBoundaryError, privateJson, privateRedirect } from "../../src/server/http/responses";
import { AccessDenied } from "../../src/server/access/errors";
import { authFixture } from "./auth-stack-helper";
import { createAuthStack } from "../../src/server/auth/factory";
import * as authSchema from "../../src/server/db/auth-schema";
import { randomBytes } from "node:crypto";

const encoder = new TextEncoder();
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/synthetic", { method: "POST", headers: { "content-type": "application/json", ...headers },
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), duplex: "half" } as RequestInit & { duplex: "half" });
}
async function rejected(action: () => unknown | Promise<unknown>, status = 400) {
  try { await action(); return false; } catch (error) { return error instanceof HttpBoundaryError && error.status === status && error.message === "Request rejected" && !("cause" in error); }
}

test("JSON reader counts actual streamed UTF-8 bytes and permits only fixed bounded profiles", async () => {
  const bytes = encoder.encode(JSON.stringify({ label: "Synthetic é" }));
  const split = bytes.indexOf(0xc3) + 1;
  expect(await readJsonBody(streamed([bytes.subarray(0, split), bytes.subarray(split)]))).toEqual({ label: "Synthetic é" });
  const large = encoder.encode(JSON.stringify({ value: "a".repeat(17 * 1024) }));
  expect(await rejected(() => readJsonBody(streamed([large.subarray(0, 100), large.subarray(100)])), 413)).toBe(true);
  expect(await rejected(() => readJsonBody(streamed([large], { "content-length": "1" })), 413)).toBe(true);
  expect(await readJsonBody(streamed([large]), "binding")).toEqual({ value: "a".repeat(17 * 1024) });
  expect(await rejected(() => readJsonBody(streamed([encoder.encode("{}")], { "content-length": "3" })))).toBe(true);
  expect(await rejected(() => readJsonBody(streamed([]), "ordinary", 5001))).toBe(true);
});

test("unsupported encodings/media, malformed length/JSON/UTF-8 and private stream failures deny with fixed diagnostics", async () => {
  const unsupported: Record<string, string>[] = [{ "content-type": "text/plain" }, { "content-type": "application/json; charset=utf-16" }, { "content-encoding": "gzip" }];
  for (const headers of unsupported) {
    expect(await rejected(() => readJsonBody(streamed([], headers)), 415)).toBe(true);
  }
  for (const length of ["-1", "NaN", "1,2", "9007199254740992"]) expect(await rejected(() => readJsonBody(streamed([], { "content-length": length })))).toBe(true);
  expect(await rejected(() => readJsonBody(streamed([], { "content-length": "99999999" })), 413)).toBe(true);
  expect(await rejected(() => readJsonBody(streamed([encoder.encode("synthetic-private-not-json")])))).toBe(true);
  expect(await rejected(() => readJsonBody(streamed([new Uint8Array([0xff, 0xfe])])))).toBe(true);
  const failure = new HttpBoundaryError();
  Object.defineProperty(failure, "status", { get() { throw new Error("synthetic-private-source"); } });
  const request = new Request("http://localhost:3000/api/synthetic", { method: "POST", headers: { "content-type": "application/json" },
    body: new ReadableStream({ start(controller) { controller.error(failure); } }), duplex: "half" } as RequestInit & { duplex: "half" });
  expect(await rejected(() => readJsonBody(request))).toBe(true);
  const locked = streamed([encoder.encode("{}")]);
  const held = locked.body!.getReader();
  try { expect(await rejected(() => readJsonBody(locked))).toBe(true); }
  finally { held.releaseLock(); }
});

test("body deadlines and incoming abort remain bounded even when stream cancellation never settles", async () => {
  let cancelled = 0;
  const make = (signal?: AbortSignal) => new Request("http://localhost:3000/api/synthetic", { method: "POST", signal,
    headers: { "content-type": "application/json" }, body: new ReadableStream({ cancel() { cancelled++; return new Promise<void>(() => {}); } }), duplex: "half" } as RequestInit & { duplex: "half" });
  expect(await rejected(() => readJsonBody(make(), "ordinary", 5), 408)).toBe(true);
  const abort = new AbortController(); abort.abort(new Error("synthetic-private-abort"));
  expect(await rejected(() => readJsonBody(make(abort.signal), "ordinary", 5), 408)).toBe(true);
  expect(cancelled).toBe(2);
});

test("closed objects and unique query reject extra authority, accessor/prototype tricks and URL handles", async () => {
  expect(closedObject({ mode: "parent", limit: 10 }, ["mode"], ["limit"])).toEqual({ mode: "parent", limit: 10 });
  for (const value of [[], null, { mode: "admin", tenantId: "forged" }, Object.create({ mode: "admin" }), JSON.parse('{"mode":"admin","__proto__":{}}')]) {
    expect(await rejected(() => closedObject(value, ["mode"]))).toBe(true);
  }
  let touched = false;
  expect(await rejected(() => closedObject({ get mode() { touched = true; throw new Error("synthetic-private"); } }, ["mode"]))).toBe(true);
  expect(touched).toBe(false);
  expect(uniqueQuery("http://localhost:3000/api/synthetic?mode=parent&limit=10", ["mode", "limit"]).get("mode")).toBe("parent");
  for (const query of ["mode=parent&mode=admin", "mode=parent&%6dode=admin", "tenantId=forged", "handle=opaque", "X-Practice-Context=opaque", "context=opaque", "mode=%ZZ", "mode=%ff", "mode=%0a", "mode=parent#fragment"]) {
    expect(await rejected(() => uniqueQuery(`http://localhost:3000/api/synthetic?${query}`, ["mode", "handle", "X-Practice-Context", "context"]))).toBe(true);
  }
});

test("private response/errors use fixed headers and cannot serialize errors, accessors or diagnostic-bearing denials", async () => {
  const marker = "synthetic-private-http-diagnostic";
  const errors: unknown[] = [new Error(marker, { cause: { token: marker } }), Object.assign(new AccessDenied(403), { message: marker, cause: marker, providerResponse: marker })];
  const getter = new AccessDenied(403); Object.defineProperty(getter, "status", { get() { throw new Error(marker); } }); errors.push(getter);
  for (const error of errors) {
    const response = errorResponse(error);
    expect((await response.text()).includes(marker)).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  }
  expect(errorResponse(errors[1]).status).toBe(403);
  expect(errorResponse(getter).status).toBe(503);
  let touched = false;
  const value = Object.defineProperty({ ok: true }, "toJSON", { value() { touched = true; return { token: marker }; } });
  expect((await privateJson(value).text()).includes(marker)).toBe(false);
  expect(touched).toBe(false);
  expect(privateJson(new Error(marker) as never).status).toBe(503);
  expect(privateJson({ get token() { throw new Error(marker); } } as never).status).toBe(503);
  expect(privateRedirect("/invitations/accept").headers.get("location")).toBe("/invitations/accept");
  expect(privateRedirect("https://foreign.example.test" as never).status).toBe(503);
});

test("SDK adapter preserves separate session/state/deletion cookies including Expires commas, relaying no other headers", async () => {
  const source = new Headers({ location: "https://foreign.example.test", "x-provider-error": "synthetic-private-provider" });
  source.append("set-cookie", "__Secure-better-auth.session_token=synthetic.signed; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800");
  source.append("set-cookie", "__Secure-better-auth.oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0");
  const response = privateJson({ ok: true });
  appendSdkCookies(response.headers, source, "https://synthetic.example.test");
  expect(response.headers.getSetCookie().length).toBe(2);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-provider-error")).toBeNull();
  expect((await response.text()).includes("synthetic.signed")).toBe(false);
  for (const bad of ["__Secure-better-auth.session_token=x; Path=/; HttpOnly; SameSite=Lax", "__Secure-better-auth.session_token=x; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=example.test",
    "unreviewed=x; Path=/; HttpOnly; Secure; SameSite=Lax", "__Secure-better-auth.session_token=x, y=z; Path=/; HttpOnly; Secure; SameSite=Lax"]) {
    const target = new Headers(); const invalid = new Headers(); invalid.append("set-cookie", source.getSetCookie()[0]); invalid.append("set-cookie", bad);
    let safe = false;
    try { appendSdkCookies(target, invalid, "https://synthetic.example.test"); }
    catch (error) { safe = error instanceof Error && error.message === "Authentication response unavailable" && !("cause" in error); }
    expect(safe).toBe(true);
    expect(target.getSetCookie().length).toBe(0);
  }
});

test("actual pinned SDK Google initiation produces supported database-state cookies for local and production HTTPS without provider I/O", async () => {
  const f = await authFixture();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Provider I/O forbidden in synthetic test"); });
  try {
    for (const origin of ["http://localhost:3000", "https://bneimitzvah.centralreform.org"]) {
      const auth = createAuthStack(f.db, authSchema, { origin, secret: randomBytes(48).toString("base64url"), codeSecret: randomBytes(48).toString("base64url"),
        google: { clientId: "synthetic-client", clientSecret: randomBytes(32).toString("hex") },
        sendMagicLink: async () => { throw new Error("Unexpected synthetic mail"); } });
      const sdk = await auth.handler(new Request(`${origin}/api/auth/sign-in/social`, { method: "POST", headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" }) }));
      expect(sdk.status).toBe(200);
      const destination = new URL((await sdk.json()).url);
      expect(destination.origin + destination.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      const projected = privateJson({ ok: true });
      appendSdkCookies(projected.headers, sdk.headers, origin);
      const prefix = origin.startsWith("https:") ? "__Secure-" : "";
      expect(projected.headers.getSetCookie().some((cookie) => cookie.startsWith(`${prefix}better-auth.state=`))).toBe(true);
      expect(projected.headers.getSetCookie().length === sdk.headers.getSetCookie().length).toBe(true);
      expect(projected.headers.getSetCookie().every((cookie, index) => cookie === sdk.headers.getSetCookie()[index])).toBe(true);
    }
    expect(network.mock.calls.length).toBe(0);
  } finally { network.mockRestore(); await f.client.close(); }
});
