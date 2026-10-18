import { describe, expect, it, vi } from "vitest";
import type { BrowserContext, Route } from "playwright";
import { installReadingRouteGuard } from "../http-browser/reading-route-guard";

const origin = "http://127.0.0.1:3187";
async function fixture(close = async () => {}) {
  let handler!: (route: Route) => Promise<unknown>;
  const context = {
    route: vi.fn(async (_pattern: string, callback: typeof handler) => { handler = callback; }),
    close: vi.fn(close),
  };
  const guard = await installReadingRouteGuard(context as unknown as BrowserContext, origin);
  function route(url: string, action = async () => {}) {
    return { request: () => ({ url: () => url }), continue: vi.fn(action), abort: vi.fn(action) };
  }
  return { context, guard, route, handle: (value: ReturnType<typeof route>) => handler(value as unknown as Route) };
}
const closed = "Target page, context or browser has been closed";
describe("reading browser egress guard lifecycle", () => {
  it.each([
    [origin + "/reading", "continue"],
    ["https://outside.example.test/", "abort"],
    ["not a URL", "abort"],
  ])("selects exactly one terminal action for %s", async (url, action) => {
    const f = await fixture(), route = f.route(url);
    await f.handle(route);
    expect(route.continue).toHaveBeenCalledTimes(action === "continue" ? 1 : 0);
    expect(route.abort).toHaveBeenCalledTimes(action === "abort" ? 1 : 0);
    await f.guard.close();
  });
  it.each([origin + "/reading", "https://outside.example.test/"])("retains action failures without a second action for %s", async url => {
    const f = await fixture(), route = f.route(url, async () => { throw Error("private synthetic request detail"); });
    await f.handle(route);
    expect(route.continue.mock.calls.length + route.abort.mock.calls.length).toBe(1);
    const result = await f.guard.close().then(() => "unexpected success", error => error.message);
    expect(result).toMatch(/^Reading UI route (continue|abort) failed while active$/);
    expect(result.includes("private")).toBe(false);
  });
  it("does not accept a closed-target error during an active test", async () => {
    const f = await fixture(), route = f.route(origin, async () => { throw Error(`route.continue: ${closed}`); });
    await f.handle(route);
    await expect(f.guard.close()).rejects.toThrow("Reading UI route continue failed while active");
    expect(route.abort).not.toHaveBeenCalled();
  });
  it.each([closed, `route.continue: ${closed}`])("drains a pending known closure only after explicit teardown: %s", async message => {
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_resolve, fail) => { reject = fail; });
    const f = await fixture(), route = f.route(origin, () => held);
    const handled = f.handle(route);
    let settled = false;
    const closing = f.guard.close().then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    reject(Error(message)); await handled; await closing;
    expect(route.abort).not.toHaveBeenCalled();
    expect(f.context.route).toHaveBeenCalledTimes(1); // No unroute gap before close.
    await f.guard.close(); expect(f.context.close).toHaveBeenCalledTimes(1);
  });
  it("retains unexpected errors during teardown, including double-handling", async () => {
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_resolve, fail) => { reject = fail; });
    const f = await fixture(), route = f.route(origin, () => held), handled = f.handle(route);
    const closing = f.guard.close();
    reject(Error("route.abort: Route is already handled!")); await handled;
    await expect(closing).rejects.toThrow("Reading UI route continue failed while closing");
    expect(route.abort).not.toHaveBeenCalled();
  });
  it("retains context-close failure after draining routes", async () => {
    const f = await fixture(async () => { throw Error("private close detail"); });
    await expect(f.guard.close()).rejects.toThrow(/^Reading UI context close failed$/);
  });
});
