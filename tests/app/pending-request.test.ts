import { describe, expect, it } from "vitest";
import { browserStores, forgetPendingRequest, PENDING_REQUEST_KEY, PENDING_REQUEST_TTL_MS, rememberPendingRequest, resolvePendingRequest, tabStores, type PendingStore } from "../../src/components/portal/pending-request";

// The consent page's ten-minute stored copy of the signed pending request (synthetic values only).
class MemoryStore implements PendingStore {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
class BlockedStore implements PendingStore {
  getItem(): string | null { throw new Error("blocked"); }
  setItem() { throw new Error("blocked"); }
  removeItem() { throw new Error("blocked"); }
}
const pending = "synthetic.pending-request_A1", other = "synthetic.other-request_B2", t0 = 1_800_000_000_000;
const stores = () => [new MemoryStore(), new MemoryStore()] as const;
const stored = (store: PendingStore) => JSON.parse(store.getItem(PENDING_REQUEST_KEY) ?? "null");

describe("consent page pending request", () => {
  it("keeps a fragment in this tab only and drops another request's origin copy", () => {
    const [tab, origin] = stores();
    rememberPendingRequest(other, [origin], t0 - 1000);
    expect(resolvePendingRequest(`#request=${pending}`, [tab, origin], t0, [tab])).toBe(pending);
    expect(stored(tab)).toEqual({ request: pending, storedAt: t0 });
    expect(origin.getItem(PENDING_REQUEST_KEY)).toBeNull();
  });
  it("falls back to a fresh stored copy only when the fragment is absent", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0, [tab]);
    // A reload, or a redirect-mode Google round trip, in this tab.
    expect(resolvePendingRequest("", [tab, origin], t0 + 60_000, [tab])).toBe(pending);
    // "Open in Chrome" from an Android Custom Tab, after Google failed and the page widened the copy.
    expect(resolvePendingRequest("", [new MemoryStore(), origin], t0 + 60_000)).toBeNull();
    rememberPendingRequest(pending, [tab, origin], t0 + 60_000);
    expect(resolvePendingRequest("", [new MemoryStore(), origin], t0 + 60_000 + PENDING_REQUEST_TTL_MS - 1)).toBe(pending);
    // A fragment always wins and replaces the older copies.
    expect(resolvePendingRequest(`#request=${other}`, [tab, origin], t0 + 120_000, [tab])).toBe(other);
    expect(resolvePendingRequest("", [tab, origin], t0 + 180_000, [tab])).toBe(other);
    expect(origin.getItem(PENDING_REQUEST_KEY)).toBeNull();
    // A malformed fragment never falls back to a stored copy.
    expect(resolvePendingRequest("#request=bad value", [tab, origin], t0 + 180_000, [tab])).toBeNull();
    expect(resolvePendingRequest("#other=x", [tab, origin], t0 + 180_000, [tab])).toBeNull();
  });
  it("prefers this tab's own copy over another tab's", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0, [tab]);
    rememberPendingRequest(other, [origin], t0 + 1000);
    expect(resolvePendingRequest("", [tab, origin], t0 + 2000, [tab])).toBe(pending);
  });
  it("ignores and removes a stale, future-dated or malformed copy", () => {
    const [tab, origin] = stores();
    rememberPendingRequest(pending, [tab, origin], t0);
    expect(resolvePendingRequest("", [tab, origin], t0 + PENDING_REQUEST_TTL_MS, [tab])).toBeNull();
    expect(tab.getItem(PENDING_REQUEST_KEY)).toBeNull(); expect(origin.getItem(PENDING_REQUEST_KEY)).toBeNull();
    rememberPendingRequest(pending, [tab], t0 + 10_000);
    expect(resolvePendingRequest("", [tab], t0, [tab])).toBeNull();
    for (const raw of ["not json", "[]", "null", JSON.stringify({ request: "bad value", storedAt: t0 }), JSON.stringify({ request: pending, storedAt: "soon" }), JSON.stringify({ request: pending })]) {
      tab.setItem(PENDING_REQUEST_KEY, raw);
      expect(resolvePendingRequest("", [tab], t0, [tab])).toBeNull(); expect(tab.getItem(PENDING_REQUEST_KEY)).toBeNull();
    }
    rememberPendingRequest("bad value", [tab], t0); expect(tab.getItem(PENDING_REQUEST_KEY)).toBeNull();
  });
  it("forgets every copy (Allow, Cancel, expired, sign-out)", () => {
    const [tab, origin] = stores();
    rememberPendingRequest(pending, [tab, origin], t0);
    forgetPendingRequest([tab, origin]);
    expect(tab.values.size + origin.values.size).toBe(0);
    expect(resolvePendingRequest("", [tab, origin], t0 + 1000, [tab])).toBeNull();
  });
  it("survives storage that throws", () => {
    const blocked = new BlockedStore(), origin = new MemoryStore();
    expect(resolvePendingRequest(`#request=${pending}`, [blocked, origin], t0, [blocked])).toBe(pending);
    rememberPendingRequest(pending, [blocked, origin], t0);
    expect(resolvePendingRequest("", [blocked, origin], t0 + 1000, [blocked])).toBe(pending);
    expect(() => forgetPendingRequest([blocked, origin])).not.toThrow();
    expect(resolvePendingRequest("", [blocked], t0, [blocked])).toBeNull();
  });
  it("reaches the browser stores even when one accessor throws", () => {
    const tab = new MemoryStore(), origin = new MemoryStore(), saved = ["sessionStorage", "localStorage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    try {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: tab });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: origin });
      expect(browserStores()).toEqual([tab, origin]); expect(tabStores()).toEqual([tab]);
      expect(resolvePendingRequest(`#request=${pending}`)).toBe(pending);
      expect(tab.values.size).toBe(1); expect(origin.values.size).toBe(0);
      expect(resolvePendingRequest("")).toBe(pending);
      forgetPendingRequest(); expect(tab.values.size + origin.values.size).toBe(0);
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
      expect(browserStores()).toEqual([origin]); expect(tabStores()).toEqual([]);
      expect(resolvePendingRequest(`#request=${pending}`)).toBe(pending);
    } finally {
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; }
    }
  });
});
