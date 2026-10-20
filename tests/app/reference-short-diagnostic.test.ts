import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const native = vi.hoisted(() => ({ context: vi.fn(), get: vi.fn() }));
vi.mock("@vercel/oidc", () => ({ getContext: native.context }));
vi.mock("@vercel/blob", () => ({ get: native.get }));
import { createShortDiagnosticReporter } from "../../src/server/reference-audio/short-diagnostic";
import { createRuntimePublicShort, publicShortRequest } from "../../src/server/reference-audio/runtime-short";
import { publicOrigin } from "./reference-public-short-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); native.context.mockReset(); native.get.mockReset(); });

test("private records project only fixed stages and boolean predicates, with a finite per-module budget", () => {
  const records: Readonly<Record<string, unknown>>[] = [];
  const report = createShortDiagnosticReporter(record => records.push(record));
  const canary = "synthetic-private-canary";
  report("config-rejected", () => ({ release: false, origin: true, storeShape: canary, token: canary, url: canary, headers: { cookie: canary } }));
  for (let i = 0; i < 100; i++) report("config-rejected", () => ({ release: true }));
  report(canary as Parameters<typeof report>[0], () => ({ release: true }));
  report("function-reached", () => ({ release: false, token: canary }));
  expect(records).toEqual([
    { event: "reference-short-diagnostic/v1", stage: "config-rejected", release: false, origin: true },
    { event: "reference-short-diagnostic/v1", stage: "function-reached" },
  ]);
  expect(JSON.stringify(records)).not.toContain(canary);
  report("request-origin", () => ({ originMatches: true, canonicalURL: false, userinfoAbsent: true, queryAbsent: true, fragmentAbsent: true, url: canary }));
  report("request-host", () => ({ hostMatches: true, forwardedHostMatches: false, host: canary }));
  report("request-forwarding", () => ({ protocolMatches: true, portMatches: false, forwardedAbsent: true, forwarded: canary }));
  report("request-framing", () => ({ transferEncodingAbsent: false, contentLengthAbsentOrZero: true, contentLength: canary }));
  expect(records.slice(2)).toEqual([
    { event: "reference-short-diagnostic/v1", stage: "request-origin", originMatches: true, canonicalURL: false, userinfoAbsent: true, queryAbsent: true, fragmentAbsent: true },
    { event: "reference-short-diagnostic/v1", stage: "request-host", hostMatches: true, forwardedHostMatches: false },
    { event: "reference-short-diagnostic/v1", stage: "request-forwarding", protocolMatches: true, portMatches: false, forwardedAbsent: true },
    { event: "reference-short-diagnostic/v1", stage: "request-framing", transferEncodingAbsent: false, contentLengthAbsentOrZero: true },
  ]);
  expect(JSON.stringify(records)).not.toContain(canary);
  for (const stage of ["config-selected", "config-drift", "request-length", "request-origin", "request-path", "request-host", "request-forwarding", "request-framing", "request-invalid"] as const)
    for (let i = 0; i < 100; i++) report(stage);
  expect(records.length).toBeLessThanOrEqual(12);
  expect(new Set(records.map(r => r.stage)).size).toBe(records.length);
});

test("throwing diagnostic facts or sinks never escape or repeatedly invoke a failed sink", () => {
  const write = vi.fn(() => { throw Error("synthetic-private-canary"); });
  const report = createShortDiagnosticReporter(write);
  expect(() => report("config-rejected", () => { throw Error("synthetic-private-canary"); })).not.toThrow();
  expect(() => report("request-host")).not.toThrow();
  report("request-host");
  expect(write).toHaveBeenCalledTimes(1);
});

test("actual runtime config and request denials retain no-store statuses and zero native work even when logging throws", async () => {
  const emitted: Record<string, unknown>[] = [];
  vi.spyOn(console, "warn").mockImplementation(record => { emitted.push(JSON.parse(String(record))); throw Error("synthetic-private-canary"); });
  const source = publicOrigin + "/reference-audio/short-v1/" + "a".repeat(64) + ".mp3";
  const config = { REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE: "true", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
    BETTER_AUTH_URL: publicOrigin, REFERENCE_AUDIO_CATALOG_SHA256: "b".repeat(64), REFERENCE_AUDIO_SHORT_MANIFEST_SHA256: "c".repeat(64), BLOB_STORE_ID: "store_synthetic123" };
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
  vi.stubEnv("PORTAL_ENVIRONMENT", "synthetic-private-canary");
  const invalid = await publicShortRequest(new Request(source));
  expect(invalid.status).toBe(404);
  expect(invalid.headers.get("cache-control")).toBe("no-store");
  expect(emitted.map(record => record.stage)).toEqual(["config-rejected"]);
  vi.stubEnv("PORTAL_ENVIRONMENT", "production");
  const handler = createRuntimePublicShort(config);
  const deniedHeaders: HeadersInit[] = [{ host: "synthetic-private-canary" }, { forwarded: "synthetic-private-canary" }, { "content-length": "1" }];
  for (const headers of deniedHeaders) {
    const response = await publicShortRequest(new Request(source, { headers }));
    expect(response.status).toBe(404); expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  }
  expect((await handler(new Request(source, { method: "POST" }))).status).toBe(405);
  expect((await handler(new Request(source, { headers: { range: "bytes=0-15" } }))).status).toBe(416);
  expect(emitted.map(record => record.stage)).toEqual(["config-rejected", "request-host", "request-forwarding", "request-framing"]);
  expect(emitted[1]).toMatchObject({ hostMatches: false, forwardedHostMatches: true });
  expect(JSON.stringify(emitted)).not.toContain("synthetic-private-canary");
  expect(native.context).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled();
});
