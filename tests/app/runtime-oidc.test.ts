import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createRuntimeMediaOidc, MEDIA_IDENTITY as p } from "../../src/server/media/runtime-oidc";

const instant = 1800000000000;
function jwt(change: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const claims = { owner: p.teamSlug, owner_id: p.teamId, project: p.projectName, project_id: p.projectId, environment: "production", sub: `owner:${p.teamSlug}:project:${p.projectName}:environment:production`, iss: `https://oidc.vercel.com/${p.teamSlug}`, aud: `https://vercel.com/${p.teamSlug}`, iat: instant / 1000, nbf: instant / 1000, exp: instant / 1000 + 60, ...change };
  return [Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256", kid: "synthetic", ...header })).toString("base64url"), Buffer.from(JSON.stringify(claims)).toString("base64url"), Buffer.from("synthetic").toString("base64url")].join(".");
}
afterEach(() => { vi.unstubAllEnvs(); });

test("runtime context only: missing headers never use environment credentials or refresh", () => {
  vi.stubEnv("VERCEL_OIDC_TOKEN", "unused"); vi.stubEnv("BLOB_READ_WRITE_TOKEN", "unused");
  for (const context of [() => ({}), () => ({ headers: {} }), () => ({ headers: { "x-vercel-oidc-token": "" } })]) expect(() => createRuntimeMediaOidc({ context, now: () => instant }).acquire()).toThrow("media-credential-unavailable");
});

test("default public getContext reads the platform request scope, not an application Request header", () => {
  const key = Symbol.for("@vercel/request-context"), previous = Object.getOwnPropertyDescriptor(globalThis, key), token = jwt();
  try {
    Object.defineProperty(globalThis, key, { configurable: true, value: { get: () => ({ headers: { "x-vercel-oidc-token": token } }) } });
    expect(createRuntimeMediaOidc({ now: () => instant }).acquire().token).toBe(token);
  } finally { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); }
});

test("runtime validates exact non-build profile and rejects every wrong identity/time field", () => {
  const mutations = [{ owner: "other" }, { owner_id: "other" }, { project: "other" }, { project_id: "other" }, { environment: "preview" }, { custom_environment_id: "other" }, { sub: "other" }, { iss: "https://example.test" }, { aud: ["https://vercel.com/" + p.teamSlug] }, { iat: -1 }, { nbf: instant / 1000 + 1 }, { exp: instant / 1000 + 14 }, { iat: instant / 1000 - 7200, exp: instant / 1000 + 60 }, { exp: "later" }];
  for (const change of mutations) expect(() => createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": jwt(change) } }), now: () => instant }).acquire()).toThrow("media-credential-unavailable");
  for (const change of [{ typ: "other" }, { alg: "none" }, { kid: "" }]) expect(() => createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": jwt({}, change) } }), now: () => instant }).acquire()).toThrow("media-credential-unavailable");
});

test("fifteen-second initial lifetime is exact in milliseconds; freshness does not demand another fifteen", () => {
  let now = instant, token = jwt({ exp: instant / 1000 + 15 });
  const acquire = createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": token } }), now: () => now });
  const credential = acquire.acquire(); now += 14999; expect(() => credential.assertFresh()).not.toThrow();
  expect(() => acquire.acquire()).toThrow("media-credential-unavailable"); now++; expect(() => credential.assertFresh()).toThrow("media-credential-unavailable");
  now = instant + 1; token = jwt({ exp: instant / 1000 + 15 }); expect(() => acquire.acquire()).toThrow("media-credential-unavailable");
});

test("credentials are per operation and a changed current token cannot validate an earlier operation", () => {
  let token = jwt(); const acquire = createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": token } }), now: () => instant });
  const first = acquire.acquire(); token = jwt({ exp: instant / 1000 + 61 }); const second = acquire.acquire();
  expect(first.token).not.toBe(second.token); expect(() => first.assertFresh()).toThrow("media-credential-unavailable"); expect(() => second.assertFresh()).not.toThrow();
});

test("hostile context/parser exceptions never escape as private diagnostic text", () => {
  expect(() => createRuntimeMediaOidc({ context: () => { throw Error("synthetic-private-detail"); } }).acquire()).toThrow(/^media-credential-unavailable$/);
  for (const token of ["a.b.c", jwt() + "=", "x".repeat(16385)]) expect(() => createRuntimeMediaOidc({ context: () => ({ headers: { "x-vercel-oidc-token": token } }) }).acquire()).toThrow(/^media-credential-unavailable$/);
});
