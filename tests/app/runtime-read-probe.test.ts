import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { request as HttpsRequest, RequestOptions } from "node:https";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("node:https", async original => ({ ...await original<typeof import("node:https")>(), request: vi.fn(() => { throw Error("forbidden-network"); }) }));
import { request as defaultRequest } from "node:https";
import { createPrivateMediaTransport, createRuntimeReadAcceptance } from "../../src/server/media/private-transport";
import { MEDIA_IDENTITY } from "../../src/server/media/runtime-oidc";
import { RUNTIME_READ_PROBE as P, runRuntimeReadProbe, selectRuntimeReadProbe } from "../../src/server/media/runtime-read-probe";
import * as route from "../../src/app/api/internal/private-media-runtime-probe/route";

const run = "baaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", host = "bneimitzvah-abc123-ravbogards-projects.vercel.app", url = `https://${host}${P.route}`;
const key = "acceptance/d0386074-64c4-40cc-8ef0-f0ca895b599b/single-write/normal.bin", store = MEDIA_IDENTITY.storeId.slice(6), origin = `https://${store.toLowerCase()}.private.blob.vercel-storage.com`;
const marker = Uint8Array.from({ length: 33 }, (_, i) => (i * 5 + 193) % 256), tag = '"retired"';
const selected = () => ({ PRIVATE_MEDIA_RUNTIME_READ_PROBE_MODE: P.mode, PRIVATE_MEDIA_RUNTIME_READ_PROBE_STORE_ID: P.storeId, PRIVATE_MEDIA_RUNTIME_READ_PROBE_RUN_ID: run,
  VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", VERCEL_PROJECT_ID: P.projectId, VERCEL_DEPLOYMENT_ID: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa", VERCEL_URL: host });
const creds = () => ({ acquire: () => ({ token: "synthetic", assertFresh() {} }) });
type Answer = { body?: Uint8Array; metadata?: Record<string, unknown>; headers?: Record<string, string>; before?: () => void; after?: () => void; status?: number };
function wire(answers: Answer[] = [{}, {}]) {
  const calls: RequestOptions[] = []; let destroyed = 0;
  const request = ((options: RequestOptions, callback: (r: unknown) => void) => {
    const index = calls.length; calls.push(options);
    const req = Object.assign(new EventEmitter(), { destroy() { destroyed++; }, end() { queueMicrotask(() => {
      const answer = answers[index] ?? {}, body = answer.body ?? (index === 0 ? Buffer.from(JSON.stringify(answer.metadata ?? { url: `${origin}/${key}`, pathname: key, contentType: "application/octet-stream", size: 33, etag: tag })) : marker);
      const headers = answer.headers ?? { "content-length": String(body.length), "content-type": "application/octet-stream", etag: tag };
      const response = Object.assign(new EventEmitter(), { headers, rawHeaders: Object.entries(headers).flat(), statusCode: answer.status ?? 200, complete: true, socket: { encrypted: true, authorized: true }, destroy() { destroyed++; } });
      answer.before?.(); callback(response); response.emit("data", body); response.emit("end"); answer.after?.();
    }); } }); return req;
  }) as unknown as typeof HttpsRequest;
  return { request, calls, get destroyed() { return destroyed; } };
}
const scopeKey = Symbol.for("@vercel/request-context"); let previousScope: PropertyDescriptor | undefined, installed = false;
function context(value: () => string | undefined) {
  previousScope = Object.getOwnPropertyDescriptor(globalThis, scopeKey); installed = true;
  Object.defineProperty(globalThis, scopeKey, { configurable: true, value: { get: () => ({ headers: { "x-vercel-oidc-token": value() } }) } });
}
function jwt() { const p = MEDIA_IDENTITY, now = Math.floor(Date.now() / 1000); return [Buffer.from(JSON.stringify({ typ: "JWT", alg: "RS256", kid: "synthetic" })).toString("base64url"), Buffer.from(JSON.stringify({ owner: p.teamSlug, owner_id: p.teamId, project: p.projectName, project_id: p.projectId, environment: "production", sub: `owner:${p.teamSlug}:project:${p.projectName}:environment:production`, iss: `https://oidc.vercel.com/${p.teamSlug}`, aud: `https://vercel.com/${p.teamSlug}`, iat: now, nbf: now, exp: now + 300 })).toString("base64url"), Buffer.from("synthetic").toString("base64url")].join("."); }
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); if (installed) { if (previousScope) Object.defineProperty(globalThis, scopeKey, previousScope); else Reflect.deleteProperty(globalThis, scopeKey); installed = false; } });

test("all absent, partial, mixed and wrong native selection cannot import credentials or dispatch", async () => {
  const load = vi.fn(async () => { throw Error("must-not-load"); });
  const variants: Record<string, string | undefined>[] = [{}, { PRIVATE_MEDIA_RUNTIME_READ_PROBE_MODE: P.mode }, ...Object.keys(selected()).map(key => ({ ...selected(), [key]: undefined })), { ...selected(), VERCEL_ENV: "preview" }, { ...selected(), VERCEL_PROJECT_ID: "other" }, { ...selected(), VERCEL_DEPLOYMENT_ID: "other" }, { ...selected(), PRIVATE_MEDIA_SINGLE_WRITE_PROBE_MODE: "unused" }, { ...selected(), PRIVATE_MEDIA_RUNTIME_READ_PROBE_EXTRA: "unused" }];
  for (const env of variants) {
    // TARGET_ENV is optional but if present must be Production.
    if (Object.hasOwn(env, "VERCEL_TARGET_ENV") && env.VERCEL_TARGET_ENV === undefined && Object.keys(env).length === Object.keys(selected()).length) continue;
    const response = await runRuntimeReadProbe(new Request(url), { env, acceptance: load }); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(load).not.toHaveBeenCalled(); expect(defaultRequest).not.toHaveBeenCalled(); expect(selectRuntimeReadProbe(url, selected())).toBe(run);
});

test("normal/custom/branch/wrong generated hosts and request header overrides cannot select the route", async () => {
  const load = vi.fn(async () => { throw 0; });
  for (const address of [`https://beitmitzvah.centralreform.org${P.route}`, `https://bneimitzvah.vercel.app${P.route}`, `https://bneimitzvah-other-ravbogards-projects.vercel.app${P.route}`, `http://${host}${P.route}`, `https://${host}/other`]) {
    expect((await runRuntimeReadProbe(new Request(address, { headers: { "x-forwarded-host": host, "x-vercel-oidc-token": "forged" } }), { env: selected(), acceptance: load })).status).toBe(404);
  }
  expect(load).not.toHaveBeenCalled();
});

test("the fixed factory exposes no mutation/key capability and proves exactly metadata then identity marker bytes", async () => {
  const f = wire(), acceptance = createRuntimeReadAcceptance({ request: f.request, credentials: creds() });
  expect(Object.keys(acceptance)).toEqual(["verify"]); expect(await acceptance.verify()).toEqual({ ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: true } });
  expect(f.calls.map(r => [r.method, r.hostname, r.path])).toEqual([["GET", "vercel.com", `/api/blob?url=${encodeURIComponent(key)}`], ["GET", new URL(origin).hostname, `/${key}?cache=0`]]);
  expect(f.calls[1].headers).toMatchObject({ "If-Match": tag, "Accept-Encoding": "identity" });
});

test("changed metadata or missing current representation fails without key substitution or retry", async () => {
  const facts = { url: `${origin}/${key}`, pathname: key, contentType: "application/octet-stream", size: 31, etag: tag };
  for (const metadata of [facts, { ...facts, size: 33, pathname: "recordings/v1/other" }, { ...facts, size: 33, url: "https://example.test/other" }]) {
    const f = wire([{ metadata }]); const result = await createRuntimeReadAcceptance({ request: f.request, credentials: creds() }).verify(); expect(result.ok).toBe(false); expect(f.calls).toHaveLength(1);
  }
  const missing = wire([{}, { status: 404, body: Buffer.from("absent") }]); expect((await createRuntimeReadAcceptance({ request: missing.request, credentials: creds() }).verify()).ok).toBe(false); expect(missing.calls).toHaveLength(2);
});

test("C length/type/tag/encoding/hash controls remain mandatory in the acceptance body", async () => {
  const headers = { "content-length": "33", "content-type": "application/octet-stream", etag: tag };
  for (const answer of [{ headers: { ...headers, "content-encoding": "identity" } }, { headers: { ...headers, "content-length": "32" } }, { headers: { ...headers, etag: '"changed"' } }, { headers: { ...headers, "content-type": "audio/wav" } }, { body: Uint8Array.from(marker, n => n ^ 1) }]) {
    const f = wire([{}, answer]); const result = await createRuntimeReadAcceptance({ request: f.request, credentials: creds() }).verify(); expect(result).toMatchObject({ ok: false, phase: "body", checks: { metadata: true, exactBody: false } }); expect(f.calls).toHaveLength(2);
  }
});

test("same current platform context is required after metadata, before GET and at final settlement", async () => {
  let valid = true; const credentials = { acquire: () => ({ token: "synthetic", assertFresh() { if (!valid) throw Error("private-detail"); } }) };
  const f = wire([{ after: () => { valid = false; } }]); expect((await createRuntimeReadAcceptance({ request: f.request, credentials }).verify()).ok).toBe(false); expect(f.calls).toHaveLength(1);
  valid = true; const late = wire([{}, { after: () => { valid = false; } }]); expect((await createRuntimeReadAcceptance({ request: late.request, credentials }).verify()).ok).toBe(false); expect(late.calls).toHaveLength(2);
});

test("a shared parent deadline includes lazy import and prevents late import from starting any proof", async () => {
  let resolve!: (factory: ReturnType<typeof createRuntimeReadAcceptance>) => void; const verify = vi.fn(async () => ({ ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: true } }) as const);
  const response = await runRuntimeReadProbe(new Request(url), { env: selected(), budgetMs: 5, acceptance: () => new Promise(done => { resolve = done; }) });
  expect(await response.json()).toMatchObject({ ok: false, phase: "deadline", outcome: "failed" }); resolve({ verify }); await Promise.resolve(); expect(verify).not.toHaveBeenCalled();
});

test("the full metadata/GET sequence cannot restart its twenty-second budget", async () => {
  const start = performance.now(); let clock = start; vi.spyOn(performance, "now").mockImplementation(() => clock);
  const f = wire([{ before: () => { clock += 4000; } }, { before: () => { clock += 2000; } }]);
  const response = await runRuntimeReadProbe(new Request(url), { env: selected(), acceptance: async () => { clock += 15000; return createRuntimeReadAcceptance({ request: f.request, credentials: creds() }); } });
  expect(await response.json()).toMatchObject({ ok: false, phase: "deadline", outcome: "failed" }); expect(f.calls).toHaveLength(2);
});

test("actual framework methods keep every nonGET and disabled GET before credential acquisition", async () => {
  let tokenReads = 0; context(() => { tokenReads++; throw Error("must-not-read-context"); });
  const { autoImplementMethods } = createRequire(import.meta.url)("next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js");
  const methods = autoImplementMethods(route);
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await methods[method](new Request(url, { method })); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  expect((await route.GET(new Request(url, { method: "HEAD" }))).status).toBe(404); expect((await route.GET(new Request(url))).status).toBe(404);
  expect(tokenReads).toBe(0); expect(defaultRequest).not.toHaveBeenCalled();
});

test("actual GET ignores application credential/config headers and returns only closed proof facts", async () => {
  for (const [key, value] of Object.entries(selected())) vi.stubEnv(key, value);
  const f = wire(), nativeToken = jwt(); vi.mocked(defaultRequest).mockImplementation(f.request); context(() => nativeToken);
  const response = await route.GET(new Request(url + "?key=other", { headers: { "x-vercel-oidc-token": "forged", "x-private-store": "other" } }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ schema: P.schema, mode: P.mode, run, ok: true, phase: "complete", outcome: "observed", checks: { contextProfile: true, metadata: true, exactBody: true } });
  expect(f.calls).toHaveLength(2); expect(f.calls.every(call => call.method === "GET")).toBe(true);
});

test("aborted requests cannot start a proof or advance from metadata to private body", async () => {
  const controller = new AbortController(), load = vi.fn(async () => { throw 0; }); controller.abort();
  const disabled = await runRuntimeReadProbe(new Request(url, { signal: controller.signal }), { env: selected(), acceptance: load }); expect((await disabled.json()).ok).toBe(false); expect(load).not.toHaveBeenCalled();
  const later = new AbortController(), f = wire([{ after: () => later.abort() }]);
  const response = await runRuntimeReadProbe(new Request(url, { signal: later.signal }), { env: selected(), acceptance: async () => createRuntimeReadAcceptance({ request: f.request, credentials: creds() }) });
  expect((await response.json()).ok).toBe(false); expect(f.calls).toHaveLength(1); expect(f.destroyed).toBeGreaterThan(0);
});

test("malformed/throwing internal results never reflect input-derived strings or private errors", async () => {
  for (const verify of [async () => { throw Error("private-detail"); }, async () => ({ ok: true, phase: "private-detail", checks: {} }), async () => ({ ok: true, phase: "complete", checks: { contextProfile: true, metadata: true, exactBody: "private-detail" } })]) {
    const response = await runRuntimeReadProbe(new Request(url), { env: selected(), acceptance: async () => ({ verify }) as never }); const body = await response.text(); expect(body).not.toContain("private-detail"); expect(JSON.parse(body).ok).toBe(false);
  }
});
