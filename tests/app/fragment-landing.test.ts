import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { fragmentLanding } from "../../src/server/http/fragment-landing";

async function browser(fragment: string, kind: "email" | "invitation" = "email", brokenHistory = false) {
  const path = kind === "email" ? "/auth/email" : "/invitations/open";
  const response = fragmentLanding(new Request(`http://localhost:3000${path}`), kind);
  const html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const events = new Map<string, (event?: unknown) => unknown>(), buttonEvents = new Map<string, () => Promise<void>>();
  const button = { disabled: true, textContent: "", addEventListener: (name: string, action: () => Promise<void>) => buttonEvents.set(name, action) };
  const message = { textContent: "" }, location = { hash: fragment, search: "", pathname: path, replace: vi.fn() };
  const fetch = vi.fn(async (_url: string, _request: RequestInit) => Response.json({ ok: true, next: "/" }));
  const history = { replaceState: vi.fn(() => { if (brokenHistory) throw new Error("Synthetic history unavailable"); location.hash = ""; }) };
  const window = { addEventListener: (name: string, action: (event: unknown) => unknown) => events.set(name, action) };
  const document = { addEventListener: (name: string, action: () => unknown) => events.set(name, action), getElementById: (id: string) => id === "continue" ? button : message };
  runInNewContext(script, { location, history, document, window, fetch, setTimeout: () => 1, clearTimeout: () => {}, AbortController, TextDecoder });
  const activate = () => buttonEvents.get("click")!();
  return { response, html, script, events, button, message, location, history, fetch, window, activate };
}

test("first synchronous script clears history; only explicit button activation performs a body POST", async () => {
  const token = "A".repeat(32), f = await browser(`#token=${token}`);
  expect(f.history.replaceState).toHaveBeenCalledWith(null, "", "/auth/email");
  expect(f.location.hash).toBe(""); expect(f.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(f.window).includes(token) || f.html.includes(token)).toBe(false);
  f.events.get("DOMContentLoaded")!();
  expect(f.button.disabled).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
  await Promise.all([f.activate(), f.activate()]);
  expect(f.fetch.mock.calls.length).toBe(1);
  const [url, request] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/auth/email/confirm"); expect(url.includes(token)).toBe(false);
  expect(request.method).toBe("POST"); expect(request.redirect).toBe("error"); expect(request.credentials).toBe("same-origin");
  expect(JSON.parse(String(request.body))).toEqual({ token });
  expect(f.location.replace).toHaveBeenCalledWith("/");
});

test("malformed fragments, history failure, missing fragment and back-forward restoration never redeem", async () => {
  for (const fragment of ["", `#token=${"A".repeat(32)}&token=duplicate`, `#token=${"A".repeat(32)}&callbackURL=/`, "#token=%41", `#token=${"A".repeat(4000)}`]) {
    const f = await browser(fragment); f.events.get("DOMContentLoaded")!(); await f.activate();
    expect(f.button.disabled).toBe(true); expect(f.fetch).not.toHaveBeenCalled(); expect(f.location.hash).toBe("");
  }
  const broken = await browser(`#token=${"A".repeat(32)}`, "email", true);
  broken.events.get("DOMContentLoaded")!(); await broken.activate(); expect(broken.fetch).not.toHaveBeenCalled();
  const restored = await browser(`#token=${"A".repeat(32)}`); restored.events.get("DOMContentLoaded")!(); restored.events.get("pagehide")!(); restored.events.get("pageshow")!({ persisted: true });
  await restored.activate(); expect(restored.fetch).not.toHaveBeenCalled(); expect(restored.button.disabled).toBe(true);
});

test("invitation uses only staging POST, canonical token bits and isolated hashed CSP without third parties", async () => {
  const f = await browser(`#token=${"A".repeat(43)}`, "invitation"); f.events.get("DOMContentLoaded")!(); await f.activate();
  expect(f.fetch.mock.calls[0][0]).toBe("/api/invitations/open");
  const bad = await browser(`#token=${"A".repeat(42)}B`, "invitation"); bad.events.get("DOMContentLoaded")!(); await bad.activate(); expect(bad.fetch).not.toHaveBeenCalled();
  const csp = f.response.headers.get("content-security-policy");
  const style = f.html.match(/<style>([\s\S]*?)<\/style>/)![1];
  for (const content of [f.script, style]) expect(csp).toContain(`'sha256-${createHash("sha256").update(content).digest("base64")}'`);
  expect(csp).toContain("connect-src 'self'"); expect(csp).not.toMatch(/report|unsafe-inline/);
  expect(f.html).not.toMatch(/accounts\.google|src=|stylesheet|localStorage|sessionStorage|__NEXT/);
  expect(f.response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(f.response.headers.get("cache-control")).toBe("private, no-store");
});

test("landing requests never use legacy query converters, runtime/database or mutation methods", async () => {
  for (const kind of ["email", "invitation"] as const) {
    const path = kind === "email" ? "/auth/email" : "/invitations/open";
    expect(fragmentLanding(new Request(`http://localhost:3000${path}?token=synthetic`), kind).status).toBe(400);
    expect(fragmentLanding(new Request(`http://localhost:3000${path}`, { method: "POST" }), kind).status).toBe(405);
  }
});
