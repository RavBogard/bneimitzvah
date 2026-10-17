import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import children from "node:child_process";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@vercel/oidc", async importOriginal => ({ ...await importOriginal<typeof import("@vercel/oidc")>(),
  getVercelOidcToken: vi.fn(() => { throw Error("forbidden-refresh"); }),
  getVercelOidcTokenSync: vi.fn(() => { throw Error("forbidden-environment-fallback"); }),
  getVercelToken: vi.fn(() => { throw Error("forbidden-mint"); }),
}));
import * as oidc from "@vercel/oidc";
import { createRuntimeMediaOidc, MEDIA_IDENTITY as p } from "../../src/server/media/runtime-oidc";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const instant = 1800000000000, scopeKey = Symbol.for("@vercel/request-context");
function token(change: Record<string, unknown> = {}, header: unknown = { typ: "JWT", alg: "RS256", kid: "review" }) {
  const c = { owner: p.teamSlug, owner_id: p.teamId, project: p.projectName, project_id: p.projectId, environment: "production", sub: `owner:${p.teamSlug}:project:${p.projectName}:environment:production`, iss: `https://oidc.vercel.com/${p.teamSlug}`, aud: `https://vercel.com/${p.teamSlug}`, iat: instant / 1000, nbf: instant / 1000, exp: instant / 1000 + 60, ...change };
  return [Buffer.from(JSON.stringify(header)).toString("base64url"), Buffer.from(JSON.stringify(c)).toString("base64url"), Buffer.from("review").toString("base64url")].join(".");
}
const restoreScope = (previous: PropertyDescriptor | undefined) => { if (previous) Object.defineProperty(globalThis, scopeKey, previous); else Reflect.deleteProperty(globalThis, scopeKey); };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

test("real public getContext preserves concurrent async request scopes and never caches another request's token", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, scopeKey), storage = new AsyncLocalStorage<{ headers: Record<string, string> }>();
  Object.defineProperty(globalThis, scopeKey, { configurable: true, value: { get: () => storage.getStore() } });
  try {
    const credentials = createRuntimeMediaOidc({ now: () => instant }), one = token(), two = token({ exp: instant / 1000 + 61 });
    const results = await Promise.all([one, two].map(value => storage.run({ headers: { "x-vercel-oidc-token": value } }, async () => {
      const acquired = credentials.acquire(); await Promise.resolve(); acquired.assertFresh(); expect(credentials.acquire().token).toBe(value); return acquired;
    })));
    expect(results[0].token).toBe(one); expect(results[1].token).toBe(two); expect(() => results[0].assertFresh()).toThrow(/^media-credential-unavailable$/);
    vi.stubEnv("VERCEL_OIDC_TOKEN", one); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "unused");
    expect(() => credentials.acquire()).toThrow(/^media-credential-unavailable$/);
    for (const method of [oidc.getVercelOidcToken, oidc.getVercelOidcTokenSync, oidc.getVercelToken]) expect(method).not.toHaveBeenCalled();
  } finally { storage.disable(); restoreScope(previous); }
});

test("context acquisition performs no credential file/process work and hostile context exceptions are closed", async () => {
  const isolated = await isolatedEnv();
  const reads = vi.spyOn(fs, "readFileSync").mockImplementation(() => { throw Error("forbidden-file"); }), spawn = vi.spyOn(children, "spawn").mockImplementation(() => { throw Error("forbidden-child"); });
  let acquired: ReturnType<ReturnType<typeof createRuntimeMediaOidc>["acquire"]> | undefined;
  let failed: unknown;
  try {
    acquired = createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": token() } }), now: () => instant }).acquire(); acquired.assertFresh();
    try { createRuntimeMediaOidc({ context: () => { throw Error("private-input-detail"); } }).acquire(); } catch (error) { failed = error; }
  } finally { reads.mockRestore(); spawn.mockRestore(); await isolated.cleanup(); }
  // A process is never launched: the negative spy throws before any native
  // spawn. Retain the same credential-free fixture discipline as child tests.
  expect(Object.hasOwn(isolated.env, "VERCEL_OIDC_TOKEN")).toBe(false); expect(Object.hasOwn(isolated.env, "BLOB_READ_WRITE_TOKEN")).toBe(false);
  expect(acquired?.token).toBe(token()); expect(failed).toBeInstanceOf(Error); expect((failed as Error).message).toBe("media-credential-unavailable");
  expect(vi.mocked(oidc.getVercelOidcToken)).not.toHaveBeenCalled();
});

test("canonical JWT parsing, runtime profile and safe millisecond timestamp bounds fail closed", () => {
  const valid = token(), pieces = valid.split(".");
  const mutations = ["", valid + "=", `${pieces[0]}.${pieces[1]}.A`, `${Buffer.from([0xff]).toString("base64url")}.${pieces[1]}.${pieces[2]}`, token({}, []), token({ aud: [`https://vercel.com/${p.teamSlug}`] }), token({ project_id: [p.projectId] }), token({ environment: "development" }), token({ custom_environment_id: null }), token({ iat: instant / 1000 + 1 }), token({ nbf: instant / 1000 + 1 }), token({ exp: instant / 1000 + 14 }), token({ iat: instant / 1000 - 7201 }), token({ exp: Number.MAX_SAFE_INTEGER }), "x".repeat(16385)];
  for (const value of mutations) {
    let error: unknown; try { createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": value } }), now: () => instant }).acquire(); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("media-credential-unavailable");
  }
  for (const now of [NaN, Infinity, -Infinity]) expect(() => createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": valid } }), now: () => now }).acquire()).toThrow(/^media-credential-unavailable$/);
});

test("a credential cannot survive expired or changed context and freshness never performs renewal", async () => {
  let now = instant, value = token({ exp: instant / 1000 + 15 });
  const acquire = createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": value } }), now: () => now }), credential = acquire.acquire();
  await Promise.resolve(); now += 14999; expect(() => credential.assertFresh()).not.toThrow();
  expect(() => acquire.acquire()).toThrow(/^media-credential-unavailable$/);
  now++; expect(() => credential.assertFresh()).toThrow(/^media-credential-unavailable$/);
  now = instant; value = token({ exp: instant / 1000 + 61 }); expect(() => credential.assertFresh()).toThrow(/^media-credential-unavailable$/);
  expect(oidc.getVercelOidcToken).not.toHaveBeenCalled(); expect(oidc.getVercelOidcTokenSync).not.toHaveBeenCalled(); expect(oidc.getVercelToken).not.toHaveBeenCalled();
});
