import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { HttpRuntime } from "../../src/server/runtime/composition";

const origin = "https://synthetic.example.test";
const guest = () => new Request(origin + "/api/honoree/read", { method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"token":"synthetic-not-a-live-credential"}' });
const value = () => ({ ok: true, schemaVersion: 1, student: { firstName: "Invented", ceremonyDate: "2027-01-02" }, aliyah: { startVerse: "Genesis 1:1", endVerse: "Genesis 1:1" }, material: { version: "synthetic", before: [{ he: "Invented", en: "Invented" }], after: [{ he: "Invented", en: "Invented" }], credits: ["Synthetic test only"] }, expiresAt: new Date(Date.now() + 60000).toISOString() });

test("independent B2: runtime replacement or cloning cannot reuse private response provenance", async () => {
  // This intentionally substitutes the trusted material seam to isolate the
  // dispatcher boundary; no database, real token or material is involved.
  const readForTransport = vi.fn(async () => ({ dto: value(), remainingMs: 5000 }));
  const runtime = { origin, honoree: { readForTransport } } as unknown as HttpRuntime;
  for (const replace of [
    (response: Response) => response.clone(),
    async (response: Response) => new Response(await response.text(), { status: response.status, headers: response.headers }),
  ]) {
    const dispatch = createHttpDispatcher(async action => replace(await action(runtime)));
    const result = await dispatch(guest());
    expect(result.status).toBe(404); expect(await result.json()).toEqual({ error: "not-found" });
    expect(result.headers.get("X-Honoree-Remaining-Ms")).toBeNull(); expect(result.headers.get("set-cookie")).toBeNull();
  }
  const forged = createHttpDispatcher(async () => Response.json(value(), { headers: { "X-Honoree-Remaining-Ms": "5000" } }));
  const result = await forged(guest());
  expect(result.status).toBe(404); expect(await result.json()).toEqual({ error: "not-found" });
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(readForTransport).toHaveBeenCalledTimes(2);
});
