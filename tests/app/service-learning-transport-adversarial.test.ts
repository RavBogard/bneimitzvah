import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { AccessDenied } from "../../src/server/access/errors";

const origin = "http://localhost:3000";
const id = "12345678-1234-4234-8234-123456789abc", identity = "a".repeat(64);
const path = `/api/students/${id}/service-plan`;
const prepare = { mode: "admin", expectedStudentRevision: 1, expectedPlanRevision: 0, catalogId: id, catalogIdentity: identity, selectedIds: [] };
const bodies = { catalog: { mode: "admin" }, prepare, confirm: { mode: "admin", binding: "v1.synthetic" }, unit: { mode: "student", planId: id, planRevision: 1, catalogIdentity: identity, unitId: "synthetic@bm-shacharit" } };
function fixture() {
  const methods = { metadata: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ state: "no-plan" })), catalog: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ state: "unavailable" })), prepare: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: false })), confirm: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ ok: false })), unit: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ state: "stale" })) };
  const dispatch = createHttpDispatcher(async action => action({ origin, resolveHost: async () => undefined, serviceLearning: methods } as unknown as HttpRuntime));
  const request = (suffix: string, body?: unknown, headers: Record<string, string> = {}) => new Request(origin + path + suffix, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { origin, "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { methods, dispatch, request };
}
async function response(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("set-cookie")).toBe(false);
  expect(response.headers.has("location")).toBe(false);
  return response.json();
}

test("independent staff boundary rejects every nonstaff mode and even an empty practice header", async () => {
  const f = fixture();
  for (const operation of ["catalog", "prepare", "confirm"] as const) {
    for (const mode of ["parent", "student", "child-practice", "Admin", "tutor ", null, 1]) {
      await response(await f.dispatch(f.request(`/${operation}`, { ...bodies[operation], mode })), 400);
    }
    for (const mode of ["admin", "tutor"]) for (const handle of ["", "synthetic"]) {
      await response(await f.dispatch(f.request(`/${operation}`, { ...bodies[operation], mode }, { "x-practice-context": handle })), 400);
    }
  }
  for (const call of Object.values(f.methods)) expect(call).not.toHaveBeenCalled();
});

test("independent query bypass probes reject encoded credential names and duplicate decoded keys", async () => {
  const f = fixture();
  for (const suffix of ["?mode=admin&%6dode=tutor", "?mode=admin&%63ontext=x", "?mode=admin&X_Practice_Context=x", "?mode=admin&authorization=x", "?mode=admin&mode%00=x", "?mode=admin&%zz=x", "?mode=admin&%ef%bf%bd=x"]) {
    expect(await response(await f.dispatch(f.request(suffix)), 400)).toEqual({ error: "invalid-request" });
  }
  expect(f.methods.metadata).not.toHaveBeenCalled();
});

test("independent body closure applies to every operation including prototype-shaped keys", async () => {
  const f = fixture();
  for (const operation of ["catalog", "prepare", "confirm", "unit"] as const) {
    for (const extra of ["tenantId", "studentId", "context", "handle", "authority", "constructor", "__proto__"]) {
      const body = Object.assign(Object.create(null), bodies[operation]);
      Object.defineProperty(body, extra, { value: "synthetic-private", enumerable: true });
      await response(await f.dispatch(f.request(`/${operation}`, body)), 400);
    }
    for (const body of [[], null, false, "synthetic", {}]) await response(await f.dispatch(f.request(`/${operation}`, body)), 400);
  }
  for (const call of Object.values(f.methods)) expect(call).not.toHaveBeenCalled();
});

test("independent errors keep every authority denial and hostile diagnostic private", async () => {
  const f = fixture();
  for (const [operation, call] of Object.entries(f.methods)) {
    for (const [error, status, diagnostic] of [[new AccessDenied(401), 401, "authentication-required"], [new AccessDenied(403), 403, "forbidden"], [new AccessDenied(404), 404, "not-found"], [new Error("synthetic-private"), 503, "unavailable"], [Object.defineProperty({}, "status", { get() { throw new Error("synthetic-private"); } }), 503, "unavailable"]] as const) {
      call.mockRejectedValueOnce(error);
      const request = operation === "metadata" ? f.request("?mode=admin") : f.request(`/${operation}`, bodies[operation as keyof typeof bodies]);
      expect(await response(await f.dispatch(request), status)).toEqual({ error: diagnostic });
    }
  }
});

test("independent response cap rejects oversized selected projection without reflecting its contents", async () => {
  const f = fixture();
  f.methods.catalog.mockResolvedValue({ state: "available", studentRevision: 1, ceremonyDate: "2027-01-02", serviceSlot: "morning", expectedPlanRevision: 0, catalogId: id, catalogIdentity: identity, lifecycleRevision: 1, units: [{ id: "synthetic@bm-shacharit", name: "synthetic-private".repeat(20_000), section: { idx: 0 } }] });
  expect(await response(await f.dispatch(f.request("/catalog", bodies.catalog)), 503)).toEqual({ error: "unavailable" });
});

test("independent output allowlists cover catalog, prepare and confirm and preserve exact expiry", async () => {
  const f = fixture(), hidden = { internal: "synthetic-private" };
  const context = { studentRevision: 1, ceremonyDate: "2027-01-02", serviceSlot: "morning", expectedPlanRevision: 0, catalogId: id, catalogIdentity: identity, lifecycleRevision: 1 };
  f.methods.catalog.mockResolvedValue({ state: "available", ...context, ...hidden, units: [{ id: "synthetic@bm-shacharit", name: "Synthetic", ...hidden, section: { idx: 0, he: "", en: null, ...hidden } }], defaults: ["synthetic@bm-shacharit"] });
  const catalog = await response(await f.dispatch(f.request("/catalog", bodies.catalog)), 200);
  expect(catalog.units).toEqual([{ id: "synthetic@bm-shacharit", name: "Synthetic", section: { idx: 0, he: "", en: null } }]);
  expect(catalog.defaults).toEqual(["synthetic@bm-shacharit"]); expect(Object.keys(catalog).sort()).toEqual(["catalogId", "catalogIdentity", "ceremonyDate", "defaults", "expectedPlanRevision", "lifecycleRevision", "serviceSlot", "state", "studentRevision", "units"]);
  f.methods.prepare.mockResolvedValue({ ok: true, binding: "v1.synthetic", expiresAt: 1_999_999_999_123, selectedIds: [], clearsPlan: true, review: { ...context, ...hidden }, ...hidden });
  const review = await response(await f.dispatch(f.request("/prepare", bodies.prepare)), 200);
  expect(review.expiresAt).toBe(1_999_999_999_123); expect(review.review).toEqual(context);
  f.methods.confirm.mockResolvedValue({ ok: true, planId: id, revision: 2, cleared: true, ...hidden });
  const receipt = await response(await f.dispatch(f.request("/confirm", bodies.confirm)), 200);
  expect(receipt).toEqual({ ok: true, planId: id, revision: 2, cleared: true });
  expect(JSON.stringify([catalog, review, receipt])).not.toContain("synthetic-private");
});
