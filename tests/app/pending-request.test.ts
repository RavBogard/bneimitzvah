import { describe, expect, it } from "vitest";
import { browserStores, forgetPendingRequest, PENDING_REQUEST_KEY, PENDING_REQUEST_TTL_MS, resolvePendingRequest, type PendingStore } from "../../src/components/portal/pending-request";

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

describe("consent page pending request", () => {
  it("takes the fragment and stores it with its time in both stores", () => {
    const [tab, origin] = stores();
    expect(resolvePendingRequest(`#request=${pending}`, [tab, origin], t0)).toBe(pending);
    for (const store of [tab, origin]) expect(JSON.parse(store.getItem(PENDING_REQUEST_KEY)!)).toEqual({ request: pending, storedAt: t0 });
  });
  it("falls back to a fresh stored copy only when the fragment is absent", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0);
    expect(resolvePendingRequest("", [tab, origin], t0 + 60_000)).toBe(pending);
    // "Open in Chrome" from an Android Custom Tab: a new tab, the same origin storage.
    expect(resolvePendingRequest("", [new MemoryStore(), origin], t0 + PENDING_REQUEST_TTL_MS - 1)).toBe(pending);
    // A fragment always wins and replaces the older copy.
    expect(resolvePendingRequest(`#request=${other}`, [tab, origin], t0 + 120_000)).toBe(other);
    expect(resolvePendingRequest("", [new MemoryStore(), origin], t0 + 180_000)).toBe(other);
    // A malformed fragment never falls back to a stored copy.
    expect(resolvePendingRequest("#request=bad value", [tab, origin], t0 + 180_000)).toBeNull();
    expect(resolvePendingRequest("#other=x", [tab, origin], t0 + 180_000)).toBeNull();
  });
  it("prefers this tab's own copy over another tab's", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0);
    resolvePendingRequest(`#request=${other}`, [new MemoryStore(), origin], t0 + 1000);
    expect(resolvePendingRequest("", [tab, origin], t0 + 2000)).toBe(pending);
  });
  it("ignores and removes a stale, future-dated or malformed copy", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0);
    expect(resolvePendingRequest("", [tab, origin], t0 + PENDING_REQUEST_TTL_MS)).toBeNull();
    expect(tab.getItem(PENDING_REQUEST_KEY)).toBeNull(); expect(origin.getItem(PENDING_REQUEST_KEY)).toBeNull();
    resolvePendingRequest(`#request=${pending}`, [tab], t0 + 10_000);
    expect(resolvePendingRequest("", [tab], t0)).toBeNull();
    for (const raw of ["not json", "[]", "null", JSON.stringify({ request: "bad value", storedAt: t0 }), JSON.stringify({ request: pending, storedAt: "soon" }), JSON.stringify({ request: pending })]) {
      tab.setItem(PENDING_REQUEST_KEY, raw);
      expect(resolvePendingRequest("", [tab], t0)).toBeNull(); expect(tab.getItem(PENDING_REQUEST_KEY)).toBeNull();
    }
  });
  it("forgets every copy (Allow, Cancel, expired)", () => {
    const [tab, origin] = stores();
    resolvePendingRequest(`#request=${pending}`, [tab, origin], t0);
    forgetPendingRequest([tab, origin]);
    expect(tab.values.size + origin.values.size).toBe(0);
    expect(resolvePendingRequest("", [tab, origin], t0 + 1000)).toBeNull();
  });
  it("survives storage that throws, and absent storage", () => {
    const blocked = new BlockedStore(), origin = new MemoryStore();
    expect(resolvePendingRequest(`#request=${pending}`, [blocked, origin], t0)).toBe(pending);
    expect(resolvePendingRequest("", [blocked, origin], t0 + 1000)).toBe(pending);
    expect(() => forgetPendingRequest([blocked, origin])).not.toThrow();
    expect(resolvePendingRequest("", [blocked], t0)).toBeNull();
  });
  it("reaches the browser stores even when one accessor throws", () => {
    const origin = new MemoryStore(), saved = ["sessionStorage", "localStorage"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
    try {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: origin });
      expect(browserStores()).toEqual([origin]);
      expect(resolvePendingRequest(`#request=${pending}`)).toBe(pending);
      expect(resolvePendingRequest("")).toBe(pending);
      forgetPendingRequest(); expect(origin.values.size).toBe(0);
    } finally {
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; }
    }
  });
});
