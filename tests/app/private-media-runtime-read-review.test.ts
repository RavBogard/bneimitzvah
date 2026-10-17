import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { request as HttpsRequest, RequestOptions } from "node:https";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:https", async original => ({ ...await original<typeof import("node:https")>(), request: vi.fn(() => { throw Error("Blocked network"); }) }));
vi.mock("@vercel/oidc", () => ({ getContext: vi.fn(() => { throw Error("Unexpected context access"); }) }));
import { getContext } from "@vercel/oidc";
import { request as defaultRequest } from "node:https";
import { createRuntimeReadAcceptance, createPrivateMediaTransport } from "../../src/server/media/private-transport";
import { MEDIA_IDENTITY } from "../../src/server/media/runtime-oidc";
import { RUNTIME_READ_PROBE as P, runRuntimeReadProbe, selectRuntimeReadProbe } from "../../src/server/media/runtime-read-probe";
import * as route from "../../src/app/api/internal/private-media-runtime-probe/route";

const run = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", host = "bneimitzvah-review123-ravbogards-projects.vercel.app", url = `https://${host}${P.route}`;
const key = "acceptance/d0386074-64c4-40cc-8ef0-f0ca895b599b/single-write/normal.bin", store = MEDIA_IDENTITY.storeId.slice(6), origin = `https://${store.toLowerCase()}.private.blob.vercel-storage.com`;
const marker = Uint8Array.from({ length: 33 }, (_, i) => (i * 5 + 193) % 256), tag = '"review-retirement"';
const facts = () => ({ url: `${origin}/${key}`, pathname: key, size: 33, contentType: "application/octet-stream", etag: tag });
const selection = (): Record<string, string> => ({ PRIVATE_MEDIA_RUNTIME_READ_PROBE_MODE: P.mode, PRIVATE_MEDIA_RUNTIME_READ_PROBE_STORE_ID: P.storeId, PRIVATE_MEDIA_RUNTIME_READ_PROBE_RUN_ID: run,
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_ID: P.projectId, VERCEL_DEPLOYMENT_ID: "dpl_cccccccccccccccccccccccc", VERCEL_URL: host });
const credentials = () => ({ acquire: () => ({ token: "synthetic", assertFresh() {} }) });
const block = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Reply = { body?: Uint8Array; headers?: Record<string, string>; rawHeaders?: string[]; status?: number; tls?: boolean; complete?: boolean;
  before?: () => void; after?: () => void; emit?: (response: EventEmitter, bytes: Uint8Array) => void; throwingDestroy?: boolean };
function wire(replies: Reply[] = [{}, {}]) {
  const calls: RequestOptions[] = [], responses: EventEmitter[] = []; let destroyed = 0;
  const request = ((options: RequestOptions, callback: (response: unknown) => void) => {
    const index = calls.length; calls.push(options);
    return Object.assign(new EventEmitter(), { destroy() { destroyed++; }, end(bytes?: Uint8Array) {
      expect(bytes).toBeUndefined();
      queueMicrotask(() => {
        const reply = replies[index] ?? {}, body = reply.body ?? (index === 0 ? Buffer.from(JSON.stringify(facts())) : marker);
        const headers = reply.headers ?? { "content-length": String(body.length), "content-type": "application/octet-stream", etag: tag };
        const response = Object.assign(new EventEmitter(), { statusCode: reply.status ?? 200, headers, rawHeaders: reply.rawHeaders ?? Object.entries(headers).flat(), complete: reply.complete ?? true,
          socket: { encrypted: true, authorized: reply.tls ?? true }, destroy() { destroyed++; if (reply.throwingDestroy) throw Error("Synthetic cleanup detail"); } });
        responses.push(response); reply.before?.(); callback(response);
        if (reply.emit) reply.emit(response, body); else { response.emit("data", body); response.emit("end"); }
        reply.after?.();
      });
    } });
  }) as unknown as typeof HttpsRequest;
  return { request, calls, responses, get destroyed() { return destroyed; } };
}
function syntheticJwt() {
  const p = MEDIA_IDENTITY, now = Math.floor(Date.now() / 1000);
  return [{ typ: "JWT", alg: "RS256", kid: "synthetic" }, { owner: p.teamSlug, owner_id: p.teamId, project: p.projectName, project_id: p.projectId, environment: "production",
    sub: `owner:${p.teamSlug}:project:${p.projectName}:environment:production`, iss: `https://oidc.vercel.com/${p.teamSlug}`, aud: `https://vercel.com/${p.teamSlug}`, iat: now, nbf: now, exp: now + 300 }]
    .map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).concat(Buffer.from("synthetic").toString("base64url")).join(".");
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

test("review actual Next dispatch with enabled selection cannot turn HEAD or any other method into context/provider I/O", async () => {
  for (const [key, value] of Object.entries(selection())) vi.stubEnv(key, value);
  const { autoImplementMethods } = createRequire(import.meta.url)("next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js");
  const methods = autoImplementMethods(route);
  for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
    const response = await methods[method](new Request(url, { method, headers: { "x-vercel-oidc-token": "forged", authorization: "unused" } }));
    expect(response.status).toBe(404); expect(await response.text()).toBe(""); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await route.GET(new Request(url, { method }))).status).toBe(404);
  }
  expect(getContext).not.toHaveBeenCalled(); expect(defaultRequest).not.toHaveBeenCalled();
});

test("review selection rejects inherited, mixed and nonProduction metadata before lazy loading, regardless of request headers", async () => {
  const load = vi.fn(async () => { throw Error("No credential import allowed"); });
  const variants = [Object.create(selection()), ...["development", "preview"].map(VERCEL_ENV => ({ ...selection(), VERCEL_ENV })),
    ...["PRIVATE_MEDIA_OIDC_PROBE_RUN_ID", "PRIVATE_MEDIA_OBJECT_PROBE_MODE", "PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE", "PRIVATE_MEDIA_RUNTIME_READ_PROBE_OTHER"].map(key => ({ ...selection(), [key]: "unused" })),
    { ...selection(), VERCEL_URL: "bneimitzvah.vercel.app" }, { ...selection(), VERCEL_PROJECT_ID: "other" }, { ...selection(), VERCEL_DEPLOYMENT_ID: "" }, { ...selection(), VERCEL_TARGET_ENV: "development" }];
  for (const env of variants) {
    expect(selectRuntimeReadProbe(url, env)).toBeNull();
    expect((await runRuntimeReadProbe(new Request(url, { headers: { host, "x-forwarded-host": host, "x-vercel-oidc-token": "forged" } }), { env, acceptance: load })).status).toBe(404);
  }
  expect(load).not.toHaveBeenCalled(); expect(getContext).not.toHaveBeenCalled(); expect(defaultRequest).not.toHaveBeenCalled();
});

test("review real route uses only current context, fixed metadata and exact conditional identity body; no bytes/tag/config escape", async () => {
  for (const [key, value] of Object.entries(selection())) vi.stubEnv(key, value);
  const token = syntheticJwt(), f = wire(); vi.mocked(getContext).mockReturnValue({ headers: { "x-vercel-oidc-token": token } }); vi.mocked(defaultRequest).mockImplementation(f.request);
  const response = await route.GET(new Request(`${url}?url=https://example.test/other&token=unused`, { headers: { authorization: "unused", "x-vercel-oidc-token": "forged", "x-forwarded-host": "other" } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ schema: P.schema, mode: P.mode, run, ok: true, phase: "complete", outcome: "observed", checks: { contextProfile: true, metadata: true, exactBody: true } });
  expect(f.calls.map(c => [c.method, c.hostname, c.path])).toEqual([["GET", "vercel.com", `/api/blob?url=${encodeURIComponent(key)}`], ["GET", new URL(origin).hostname, `/${key}?cache=0`]]);
  expect((f.calls[1].headers as Record<string, string>)["If-Match"] === tag).toBe(true); expect((f.calls[1].headers as Record<string, string>)["Accept-Encoding"] === "identity").toBe(true);
  expect(f.calls.every(c => (c.headers as Record<string, string>).authorization === `Bearer ${token}`)).toBe(true);
  expect(Object.keys(createRuntimeReadAcceptance())).toEqual(["verify"]);
  const normal = createPrivateMediaTransport({ storeGeneration: "review-v1", request: f.request, credentials: credentials() });
  expect((await normal.metadata(undefined as never)).ok).toBe(false); expect(f.calls).toHaveLength(2);
});

test("review fixed factory rejects metadata coercion, changed key and weak tag before direct bytes", async () => {
  for (const metadata of [{ ...facts(), url: [facts().url] }, { ...facts(), pathname: key + "/other" }, { ...facts(), etag: 'W/"weak"' }, { ...facts(), size: 31 }]) {
    const f = wire([{ body: Buffer.from(JSON.stringify(metadata)) }]);
    expect(await createRuntimeReadAcceptance({ request: f.request, credentials: credentials() }).verify()).toMatchObject({ ok: false, phase: "metadata", checks: { contextProfile: true, metadata: false, exactBody: false } });
    expect(f.calls).toHaveLength(1);
  }
});

test("review retained C full EOF, duplicate length, encoding, hash and empty-progress limits stay active on the fixed path", async () => {
  const headers = { "content-length": "33", "content-type": "application/octet-stream", etag: tag };
  const variants: Reply[] = [{ complete: false }, { body: Uint8Array.from(marker, n => n ^ 1) }, { body: new Uint8Array(34), headers },
    { headers: { ...headers, "content-encoding": "identity" } }, { headers, rawHeaders: [...Object.entries(headers).flat(), "Content-Length", "33"] },
    { headers, emit(response) { for (let i = 0; i < 65; i++) response.emit("data", Buffer.alloc(0)); response.emit("end"); } }];
  for (const answer of variants) {
    const f = wire([{}, answer]); const result = await createRuntimeReadAcceptance({ request: f.request, credentials: credentials() }).verify();
    expect(result).toEqual({ ok: false, phase: "body", checks: { contextProfile: true, metadata: true, exactBody: false } }); expect(f.calls).toHaveLength(2); expect(f.destroyed).toBeGreaterThan(0);
  }
});

test("review an absolute shared budget fences synchronously starved import and verify; late settlement cannot overwrite a deadline", async () => {
  let verifies = 0;
  const response = await runRuntimeReadProbe(new Request(url), { env: selection(), budgetMs: 3, acceptance: async () => { block(15); return { verify: async () => { verifies++; return { ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: true } }; } }; } });
  expect((await response.json()).phase).toBe("deadline"); expect(verifies).toBe(0);
  let finish!: (value: Awaited<ReturnType<ReturnType<typeof createRuntimeReadAcceptance>["verify"]>>) => void, signal: AbortSignal | undefined;
  const late = runRuntimeReadProbe(new Request(url), { env: selection(), budgetMs: 5, acceptance: async () => ({ verify: options => { signal = options?.signal; return new Promise(resolve => { finish = resolve; }); } }) });
  const result = await late; const before = await result.text(); expect(JSON.parse(before)).toMatchObject({ ok: false, phase: "deadline", outcome: "failed" }); expect(signal?.aborted).toBe(true);
  finish({ ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: true } }); await sleep(5); expect(JSON.parse(before).ok).toBe(false);
});

test("review raw factory shares the parent deadline and cannot proceed after initial idle starvation or context invalidation", async () => {
  const stalled = wire([{ before: () => block(15) }]);
  expect((await createRuntimeReadAcceptance({ request: stalled.request, credentials: credentials(), idleMs: 3 }).verify()).ok).toBe(false); expect(stalled.calls).toHaveLength(1);
  const parent = wire([{ before: () => block(15) }]);
  expect((await createRuntimeReadAcceptance({ request: parent.request, credentials: credentials() }).verify({ deadline: performance.now() + 3 })).ok).toBe(false); expect(parent.calls).toHaveLength(1);
  let current = true; const scoped = { acquire: () => ({ token: "synthetic", assertFresh() { if (!current) throw Error("Synthetic credential detail"); } }) };
  for (const stage of [0, 1]) {
    current = true; const replies: Reply[] = [{}, {}]; replies[stage].after = () => { current = false; };
    const f = wire(replies), result = await createRuntimeReadAcceptance({ request: f.request, credentials: scoped }).verify(); expect(result.ok).toBe(false); expect(result.checks.exactBody).toBe(false); expect(f.calls).toHaveLength(stage + 1);
  }
});

test("review rejected response owns repeated late errors and throwing teardown; route exposes fixed facts only", async () => {
  const sentinel = "synthetic-provider-private-detail", f = wire([{ headers: { "content-length": "8193" }, throwingDestroy: true }]);
  const response = await runRuntimeReadProbe(new Request(url), { env: selection(), acceptance: async () => createRuntimeReadAcceptance({ request: f.request, credentials: credentials() }) });
  const text = await response.text(); expect(text.includes(sentinel)).toBe(false); expect(JSON.parse(text)).toMatchObject({ ok: false, phase: "metadata", outcome: "failed", checks: { contextProfile: true, metadata: false, exactBody: false } });
  for (let i = 0; i < 3; i++) expect(() => f.responses[0].emit("error", Error(sentinel))).not.toThrow();
  expect(f.calls).toHaveLength(1); expect(f.destroyed).toBeGreaterThan(0); expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("review internal result accessors, symbols, mismatched success and hostile exceptions cannot leak or manufacture permission", async () => {
  let getters = 0;
  const accessor = Object.defineProperty({ ok: true, phase: "complete" }, "checks", { enumerable: true, get() { getters++; throw Error("Synthetic private detail"); } });
  const good = { ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: true } };
  for (const value of [accessor, { ...good, [Symbol("extra")]: true }, { ...good, checks: { ...good.checks, extra: "Synthetic private detail" } }, { ...good, phase: "metadata" }]) {
    const response = await runRuntimeReadProbe(new Request(url), { env: selection(), acceptance: async () => ({ verify: async () => value as never }) });
    const text = await response.text(); expect(JSON.parse(text).ok).toBe(false); expect(text.includes("Synthetic private detail")).toBe(false); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(getters).toBe(0);
});
