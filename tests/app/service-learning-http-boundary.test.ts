import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { serviceLearningRouteMethods } from "../../src/server/http/service-learning";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { AccessDenied } from "../../src/server/access/errors";
const origin = "http://localhost:3000", student = "11111111-1111-4111-8111-111111111111", base = `/api/students/${student}/service-plan`;
const catalog = "22222222-2222-4222-8222-222222222222", hash = "a".repeat(64);
const draft = { mode: "admin", expectedStudentRevision: 1, expectedPlanRevision: 0, catalogId: catalog, catalogIdentity: hash, selectedIds: [] };
function fixture() {
  const serviceLearning = { metadata: vi.fn(async () => ({ state: "no-plan" })), catalog: vi.fn(async () => ({ state: "unavailable" })),
    prepare: vi.fn(async () => ({ ok: false, code: "stale-revision" })), confirm: vi.fn(async () => ({ ok: false, code: "stale-revision" })), unit: vi.fn(async () => ({ state: "stale" })) };
  const resolveHost = vi.fn(async () => undefined), scope = vi.fn(async (action: (r: HttpRuntime) => Promise<Response>) => action({ origin, serviceLearning, resolveHost } as unknown as HttpRuntime));
  const dispatch = createHttpDispatcher(scope);
  const request = (suffix: string, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") => new Request(origin + base + suffix, {
    method, headers: { ...(body === undefined ? {} : { "content-type": "application/json", origin }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { serviceLearning, resolveHost, scope, dispatch, request };
}
async function status(response: Response, expected: number) {
  expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("set-cookie")).toBe(false); expect(response.headers.has("location")).toBe(false); return response.json();
}
test("catchall classifies exactly five service endpoints and refuses wrong methods before runtime", async () => {
  const f = fixture();
  for (const suffix of ["", "/catalog", "/prepare", "/confirm", "/unit"]) {
    const expected = suffix ? "POST" : "GET";
    expect(serviceLearningRouteMethods(base + suffix)).toEqual([expected]);
    for (const method of ["GET", "POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"].filter(m => m !== expected)) {
      const response = await f.dispatch(f.request(suffix, undefined, {}, method)); await status(response, 405); expect(response.headers.get("allow")).toBe(expected);
    }
  }
  for (const suffix of ["/unknown", "/catalog/extra", "/", "/prepare/"]) await status(await f.dispatch(f.request(suffix)), 404);
  expect(f.scope).not.toHaveBeenCalled();
});
test("resolved host denial precedes body processing and service invocation", async () => {
  const f = fixture(); f.resolveHost.mockRejectedValue(new AccessDenied(404));
  await status(await f.dispatch(f.request("/prepare", draft)), 404); expect(f.serviceLearning.prepare).not.toHaveBeenCalled();
});
test("all POST operations reject missing/foreign Origin and cross-site fetch before domain calls", async () => {
  const f = fixture();
  for (const suffix of ["/catalog", "/prepare", "/confirm", "/unit"]) {
    for (const headers of ([{ origin: "https://foreign.example.test" }, { origin: origin + "/" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])) await status(await f.dispatch(f.request(suffix, {}, headers)), 403);
    const missing = f.request(suffix, {}); missing.headers.delete("origin"); await status(await f.dispatch(missing), 403);
  }
  for (const fn of Object.values(f.serviceLearning)) expect(fn).not.toHaveBeenCalled();
});
test("closed query/body fields and bounded scalar/selection types fail before domain calls", async () => {
  const f = fixture();
  for (const query of ["?mode=admin&mode=tutor", "?mode=admin&tenantId=crc", "?mode=admin&handle=synthetic", "?mode=admin#synthetic", "?mode=child-practice&context=synthetic", "?mode=unknown"]) await status(await f.dispatch(f.request(query)), 400);
  for (const suffix of ["/catalog", "/prepare", "/confirm", "/unit"]) await status(await f.dispatch(f.request(suffix + "?mode=admin", {})), 400);
  for (const field of ["url", "source", "tenantId", "handle", "context", "role", "authority", "cookies", "edition"]) await status(await f.dispatch(f.request("/prepare", { ...draft, [field]: "synthetic" })), 400);
  const mutants = [{ ...draft, expectedStudentRevision: 0 }, { ...draft, expectedPlanRevision: -1 }, { ...draft, expectedPlanRevision: "0" }, { ...draft, catalogId: "invalid" }, { ...draft, catalogIdentity: "x".repeat(64) }, { ...draft, selectedIds: ["same", "same"] }, { ...draft, selectedIds: Array(257).fill("unit") }, { ...draft, selectedIds: [null] }, { ...draft, selectedIds: ["x".repeat(129)] }, { ...draft, selectedIds: ["bad\nunit"] }];
  for (const body of mutants) await status(await f.dispatch(f.request("/prepare", body)), 400);
  for (const binding of ["", "v2.synthetic", "v1." + "x".repeat(48_000)]) await status(await f.dispatch(f.request("/confirm", { mode: "admin", binding })), 400);
  expect(f.serviceLearning.prepare).not.toHaveBeenCalled(); expect(f.serviceLearning.confirm).not.toHaveBeenCalled(); expect(f.serviceLearning.metadata).not.toHaveBeenCalled();
});
test("operation body limits, byte decoding, content encoding and media type remain strict", async () => {
  const f = fixture();
  for (const [suffix, limit] of [["/catalog", 16 * 1024], ["/unit", 16 * 1024], ["/prepare", 32 * 1024], ["/confirm", 64 * 1024]] as const) {
    await status(await f.dispatch(f.request(suffix, {}, { "content-length": String(limit + 1) })), 413);
    const body = " ".repeat(limit + 1);
    await status(await f.dispatch(new Request(origin + base + suffix, { method: "POST", headers: { origin, "content-type": "application/json" }, body })), 413);
  }
  for (const headers of ([{ "content-type": "text/plain" }, { "content-encoding": "gzip" }] as Record<string, string>[])) await status(await f.dispatch(f.request("/catalog", { mode: "admin" }, headers)), 415);
  await status(await f.dispatch(new Request(origin + base + "/catalog", { method: "POST", headers: { origin, "content-type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) })), 400);
  for (const fn of Object.values(f.serviceLearning)) expect(fn).not.toHaveBeenCalled();
});
test("all stale variants use fixed409 without any material or diagnostic reflection", async () => {
  const f = fixture(); f.serviceLearning.metadata.mockResolvedValue({ state: "stale", material: "synthetic-private" } as never);
  for (const [suffix, body] of [["?mode=admin", undefined], ["/prepare", draft], ["/confirm", { mode: "admin", binding: "v1.synthetic" }], ["/unit", { mode: "student", planId: catalog, planRevision: 1, catalogIdentity: hash, unitId: "synthetic" }]] as const) expect(await status(await f.dispatch(f.request(suffix, body)), 409)).toEqual({ ok: false, code: "stale-revision" });
  f.serviceLearning.catalog.mockRejectedValue(new Error("synthetic-private-diagnostic"));
  expect(await status(await f.dispatch(f.request("/catalog", { mode: "admin" })), 503)).toEqual({ error: "unavailable" });
});
test("HTTP projection drops unknown nested metadata and source coordinates while retaining supported material", async () => {
  const f = fixture(), hidden = { unexpected: "synthetic-private" };
  f.serviceLearning.unit.mockResolvedValue({ state: "assigned", ...hidden, plan: { id: catalog, revision: 1, needsReview: false, catalogId: catalog, catalogIdentity: hash, catalogState: "active", ...hidden }, material: {
    ...hidden, unit: { id: "synthetic", family: "bm-shacharit", name: "Synthetic", section: 0, caption: "", group: null, companionOf: "synthetic-hidden", folios: [99], printedFolio: 99, ...hidden,
      renderStructure: { kind: "short-sequence", rows: [1], head: 0, tail: 0, ...hidden }, renderSegments: { he: ["א"], en: ["Synthetic"], tr: ["hidden"], folios: [99], ...hidden }, sourceBoundaries: { en: [{ block: 0, endAfter: "Synthetic", ...hidden }], ...hidden },
      blocks: [{ type: "stanza", he: "א", en: [{ t: "Synthetic", ...hidden }], text: [{ strong: [{ t: "Synthetic", ...hidden }], ...hidden }], footnote: [{ em: [{ t: "Synthetic note", ...hidden }], ...hidden }], marks: [{ type: "Synthetic", label: "Synthetic", ...hidden }], bare: "hidden", tr: "hidden", folio: 99, phys: 99, ...hidden }] },
    section: { idx: 0, en: "Synthetic", opener: true, ...hidden }, license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic credit", ...hidden }, source: { catalogIdentity: hash, sourceGitSha: "synthetic", sourceBuiltAt: "synthetic", artifactCommit: "synthetic", artifactRunId: "1", ...hidden }, blockGranularity: "line" } } as never);
  const wire = await status(await f.dispatch(f.request("/unit", { mode: "student", planId: catalog, planRevision: 1, catalogIdentity: hash, unitId: "synthetic" })), 200);
  expect(wire.material.unit.caption).toBe(""); expect(wire.material.unit.renderSegments).toEqual({ he: ["א"], en: ["Synthetic"] });
  expect(wire.material.unit.blocks[0].footnote).toEqual([{ em: [{ t: "Synthetic note" }] }]); expect(wire.material.license.attribution).toBe("Synthetic credit");
  for (const field of ["synthetic-private", "synthetic-hidden", '"tr"', '"bare"', '"folio"', '"phys"', '"folios"', '"printedFolio"']) expect(JSON.stringify(wire)).not.toContain(field);
});
