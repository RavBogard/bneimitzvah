import { spawn, type ChildProcess } from "node:child_process";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { chromium, type Browser } from "playwright";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Actual built Next, no database or provider configuration. Every network
// connection stays on loopback; public hostnames are synthetic request metadata.
const loopback = "http://127.0.0.1:3192", canonical = "https://beitmitzvah.centralreform.org";
const aliases = ["barmitzvah.centralreform.org", "batmitzvah.centralreform.org", "bnaimitzvah.centralreform.org", "bneimitzvah.centralreform.org", "bneimitzvah.vercel.app", "torah.centralreform.org"];
let child: ChildProcess | undefined, browser: Browser | undefined, cleanup: (() => Promise<void>) | undefined;
let cleanupBrowser: (() => Promise<void>) | undefined;
function headers(host: string, extra: Record<string, string> = {}) {
  return { host, "x-forwarded-host": host, "x-forwarded-proto": "https", "x-forwarded-port": "443", ...extra };
}
// Node24 fetch ignores a caller-supplied Host. Use raw loopback HTTP so these
// tests exercise the same wire Host that Playwright's API transport preserves.
function exchange(path: string, host: string, method = "GET", extra: Record<string, string> = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: 3192, path, method, headers: headers(host, extra) }, response => {
      const projected = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const item of value) projected.append(key, item);
        else if (value !== undefined) projected.set(key, value);
      }
      response.resume();
      response.on("end", () => resolve(new Response(null, { status: response.statusCode!, headers: projected })));
      response.on("error", () => reject(new Error("Synthetic loopback response failed")));
    });
    request.setTimeout(10_000, () => request.destroy(new Error("Synthetic loopback request timed out")));
    request.on("error", () => reject(new Error("Synthetic loopback request failed")));
    request.end(method === "POST" ? "synthetic-unread-body" : undefined);
  });
}
async function start(configuredOrigin: string) {
  const isolation = await isolatedEnv({ NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: configuredOrigin });
  cleanup = isolation.cleanup;
  child = spawn(process.execPath, [join(process.cwd(), "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3192"],
    { cwd: process.cwd(), env: isolation.env, stdio: "ignore" });
  const deadline = Date.now() + 30_000;
  while (true) {
    if (child.exitCode !== null) throw new Error("Canonical navigation server exited before readiness");
    try { const response = await fetch(loopback, { redirect: "manual", signal: AbortSignal.timeout(1_000) }); await response.body?.cancel(); break; }
    catch { if (Date.now() >= deadline) throw new Error("Canonical navigation server readiness timed out"); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function stop() {
  if (child) { child.kill(); await new Promise<void>(resolve => { if (child?.exitCode !== null) resolve(); else child?.once("exit", () => resolve()); }); child = undefined; }
  await cleanup?.(); cleanup = undefined;
}
beforeAll(async () => {
  await start(canonical);
  const isolation = await isolatedEnv(); cleanupBrowser = isolation.cleanup;
  browser = await chromium.launch({ headless: true, env: isolation.env });
});
afterAll(async () => {
  await browser?.close();
  await cleanupBrowser?.();
  await stop();
});

test("built alias pages drop path/query with a private fixed redirect while APIs, mutations and hostile frames never redirect", async () => {
  for (const host of aliases) {
    for (const method of ["GET", "HEAD"]) {
      const response = await exchange("/auth/email/?token=synthetic-private", host, method);
      expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(canonical + "/#home");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.has("set-cookie")).toBe(false); await response.body?.cancel();
    }
    for (const [path, method] of [["/api/session?token=synthetic-private", "GET"], ["/api/auth/google/challenge", "POST"], ["/auth/email", "POST"]]) {
      const response = await exchange(path, host, method);
      expect(response.status).toBe(404); expect(response.headers.has("location")).toBe(false);
      expect(response.headers.has("set-cookie")).toBe(false); await response.body?.cancel();
    }
  }
  for (const extra of [{ origin: "https://foreign.example.test" }, { "x-forwarded-host": "beitmitzvah.centralreform.org" }, { "x-forwarded-proto": "http" }, { "x-forwarded-port": "80" }] as Record<string, string>[]) {
    const response = await exchange("/account?code=synthetic-private", aliases[0], "GET", extra);
    expect(response.status).toBe(404); expect(response.headers.has("location")).toBe(false); expect(response.headers.has("set-cookie")).toBe(false); await response.body?.cancel();
  }
  const unknown = await exchange("/account?state=synthetic-private", "foreign.example.test");
  expect(unknown.headers.has("location")).toBe(false); expect(unknown.headers.has("set-cookie")).toBe(false); await unknown.body?.cancel();
});

test("real browser follows the built redirect with no query or inherited token fragment", async () => {
  const context = await browser!.newContext({ serviceWorkers: "block", acceptDownloads: false });
  const tab = await context.newPage();
  const session = await context.newCDPSession(tab);
  let closed = false, failed = false;
  try {
    const canonicalRequests: string[] = [], canonicalPaused: string[] = [], canonicalNavigations: string[] = [], aliasNavigations: string[] = [];
    const canonicalDocumentPauses: string[] = [], aliasDocumentPauses: string[] = [], foreignRequests: string[] = [];
    const { frameTree } = await session.send("Page.getFrameTree");
    context.on("request", request => {
      const url = new URL(request.url());
      if (url.origin === canonical) canonicalRequests.push(url.href);
      else if (url.protocol !== "https:" || !aliases.includes(url.hostname)) foreignRequests.push(url.href);
      if (request.isNavigationRequest() && request.frame() === tab.mainFrame()) {
        if (url.origin === canonical) canonicalNavigations.push(url.href);
        else aliasNavigations.push(url.href);
      }
    });
    // Playwright route handlers skip subsequent redirect hops. CDP's Request
    // stage explicitly pauses every hop (pinned protocol requestPaused docs).
    // Never continue a public request: fulfill from loopback/synthetic HTML or
    // fail it. No redirect can escape through a real public network fallback.
    session.on("Fetch.requestPaused", (event: { requestId: string; frameId: string; resourceType: string; request: { url: string; method: string } }) => {
      void (async () => {
        const url = new URL(event.request.url);
        const document = event.resourceType === "Document" && event.frameId === frameTree.frame.id;
        if (url.origin === canonical) {
          canonicalPaused.push(url.href);
          if (document) canonicalDocumentPauses.push(url.href);
          if (document && url.pathname === "/" && !url.search) {
            await session.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
              responseHeaders: [{ name: "content-type", value: "text/html" }], body: Buffer.from("<p>Canonical synthetic landing</p>").toString("base64") });
            return;
          }
        } else if (url.protocol === "https:" && aliases.includes(url.host)) {
          if (document) aliasDocumentPauses.push(url.href);
          const response = await exchange(url.pathname + url.search, url.host, event.request.method);
          const responseHeaders = [...response.headers].filter(([name]) => !["connection", "transfer-encoding", "content-length", "keep-alive"].includes(name)).map(([name, value]) => ({ name, value }));
          await session.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: response.status, responseHeaders });
          return;
        }
        await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" });
      })().catch(() => {
        if (!closed) failed = true;
        void session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      });
    });
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    for (const host of aliases) {
      await tab.goto(`https://${host}/invitations/open/?token=synthetic-private#token=synthetic-fragment`);
      const destination = new URL(tab.url());
      expect(destination.origin + destination.pathname).toBe(canonical + "/");
      expect(destination.search).toBe(""); expect(destination.hash).toBe("#home");
      expect(tab.url()).not.toContain("synthetic-private"); expect(tab.url()).not.toContain("synthetic-fragment");
    }
    const expectedAliases = aliases.map(host => `https://${host}/invitations/open/?token=synthetic-private`);
    const expectedCanonical = aliases.map(() => canonical + "/");
    expect(aliasNavigations).toEqual(expectedAliases); expect(aliasDocumentPauses).toEqual(expectedAliases);
    expect(canonicalNavigations).toEqual(expectedCanonical); expect(canonicalDocumentPauses).toEqual(expectedCanonical);
    expect(canonicalRequests.length).toBeGreaterThanOrEqual(aliases.length);
    expect(canonicalRequests.every(value => canonicalPaused.includes(value))).toBe(true);
    for (const value of [...canonicalRequests, ...canonicalPaused]) {
      expect(new URL(value).search).toBe("");
      expect(value).not.toContain("synthetic-private"); expect(value).not.toContain("synthetic-fragment");
    }
    expect(foreignRequests).toEqual([]); expect(failed).toBe(false);
    expect(await context.cookies()).toEqual([]);
  } finally { closed = true; await context.close(); }
});

test("pinned Next malformed origin-form normalization stays same-origin before alias gate", async () => {
  for (const method of ["GET", "POST"]) {
    const response = await exchange("/auth//email?token=synthetic-private", aliases[0], method);
    expect(response.status).toBe(308); expect(response.headers.has("set-cookie")).toBe(false);
    const location = response.headers.get("location")!;
    expect(location.startsWith("/") && !location.startsWith("//")).toBe(true);
    expect(new URL(location, `https://${aliases[0]}`).origin).toBe(`https://${aliases[0]}`);
    expect(new URL(location, loopback).search).toBe("?token=synthetic-private");
    await response.body?.cancel();
    const next = await exchange(location, aliases[0], method);
    expect(next.status).toBe(method === "GET" ? 303 : 404);
    expect(next.headers.get("location")).toBe(method === "GET" ? canonical + "/#home" : null);
    expect(next.headers.has("set-cookie")).toBe(false); await next.body?.cancel();
  }
});

test("runtime rollback to stable origin leaves clean stable pages and preactivation alias pages unredirected", async () => {
  await stop(); await start("https://bneimitzvah.vercel.app");
  for (const host of aliases) {
    const response = await exchange("/account", host);
    expect(response.status).toBe(200); expect(response.headers.has("location")).toBe(false);
    expect(response.headers.has("set-cookie")).toBe(false); await response.body?.cancel();
  }
  // Missing provider configuration still fails closed; this proves the alias
  // proxy did not manufacture API success or apply its post-cutover404 gate.
  const api = await exchange("/api/session", "bneimitzvah.vercel.app");
  expect(api.status).toBe(503); expect(api.headers.has("location")).toBe(false);
  expect(api.headers.has("set-cookie")).toBe(false); await api.body?.cancel();
});
