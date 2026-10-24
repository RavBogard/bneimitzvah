import { parseCatalog, parseServiceMetadata } from "../../src/components/portal/workspace/service-learning/api";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createBindings } from "../../src/server/students/bindings";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import * as s from "../../src/server/db/index";
const opened: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
const secret = "synthetic-service-http-review-secret-value";
async function fixture(seed = true) {
  const f = await portalRoutesFixture(); opened.push(f);
  const content = syntheticServiceCatalog(), catalogId = randomUUID(), studentId = f.students[0].id;
  if (seed) await f.owner(async () => {
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
  });
  const serviceLearning = createServiceLearningService({ access: f.service, practice: f.runtime.practice, signingSecret: secret });
  const runtime = { ...f.runtime, serviceLearning }, dispatch = createHttpDispatcher(async action => action(runtime));
  const base = `/api/students/${studentId}/service-plan`;
  const call = (suffix: string, options: Parameters<typeof f.request>[1] = {}) => dispatch(f.request(base + suffix, { who: "admin", ...options }));
  const selection = { mode: "admin", expectedStudentRevision: 1, expectedPlanRevision: 0, catalogId, catalogIdentity: content.identity, selectedIds: [content.second, content.first] };
  async function save() {
    const review = await json(await call("/prepare", { body: selection }));
    const result = await json(await call("/confirm", { body: { mode: "admin", binding: review.binding } }));
    return result as { planId: string; revision: number };
  }
  return { ...f, content, catalogId, studentId, serviceLearning, runtime, dispatch, base, call, selection, save };
}
function privateResponse(response: Response, status = 200) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("set-cookie")).toBe(false); expect(response.headers.has("location")).toBe(false);
}
async function json(response: Response, status = 200) { privateResponse(response, status); return response.json(); }

test("actual SDK staff review signs exact expiry and confirms independent selected-only plan", async () => {
  const f = await fixture(), external = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Synthetic external fetch prohibited"));
  const catalog = await json(await f.call("/catalog", { body: { mode: "admin" } }));
  expect(catalog).toMatchObject({ state: "available", studentRevision: 1, expectedPlanRevision: 0, ceremonyDate: "2027-01-02", serviceSlot: "morning", catalogId: f.catalogId, catalogIdentity: f.content.identity });
  expect(catalog.units.map((u: { id: string }) => u.id)).toEqual([f.content.first, f.content.hidden, f.content.second]);
  expect(catalog.units.map((u: { page?: number }) => u.page)).toEqual([1, 2, 3]);
  // The wire shape is the one the staff editor parses, standard-part defaults included (none in this synthetic feed).
  expect(catalog.defaults).toEqual([]); expect(parseCatalog(catalog)).toMatchObject({ state: "available", defaults: [] });
  const review = await json(await f.call("/prepare", { body: f.selection }));
  expect(Object.keys(review).sort()).toEqual(["ok", "binding", "expiresAt", "selectedIds", "clearsPlan", "review"].sort());
  expect(review.expiresAt).toBe(createBindings(secret, Date.now).verify(review.binding, "service-plan").expiresAt);
  expect(review.selectedIds).toEqual([f.content.first, f.content.second]);
  expect(review.review).toEqual({ studentRevision: 1, ceremonyDate: "2027-01-02", serviceSlot: "morning", catalogId: f.catalogId, catalogIdentity: f.content.identity, lifecycleRevision: 1, expectedPlanRevision: 0 });
  expect(await json(await f.call("?mode=student", { who: "learner" }))).toEqual({ state: "no-plan" });
  const saved = await json(await f.call("/confirm", { body: { mode: "admin", binding: review.binding } }));
  expect(Object.keys(saved).sort()).toEqual(["ok", "planId", "revision", "cleared"].sort()); expect(saved).toMatchObject({ ok: true, revision: 1, cleared: false });
  for (const [who, mode] of [["admin", "admin"], ["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const) {
    const meta = await json(await f.call(`?mode=${mode}`, { who })); expect(meta.units.map((u: { id: string }) => u.id)).toEqual([f.content.first, f.content.second]);
    // Each part's printed page and the service's first page reach the wire, and the portal's strict parser accepts them.
    expect(meta.units.map((u: { page?: number }) => u.page)).toEqual([1, 3]); expect(meta.serviceStart).toBe(1);
    expect(parseServiceMetadata(meta)).toMatchObject({ state: "assigned", serviceStart: 1, units: [{ page: 1 }, { page: 3 }] });
    const unit = await json(await f.call("/unit", { who, body: { mode, planId: saved.planId, planRevision: saved.revision, catalogIdentity: f.content.identity, unitId: f.content.first } }));
    expect(unit.material.unit.blocks[0].he).toBe("א֑ב\u200f");
    expect(unit.material.unit.blocks[0].en).toEqual([{ t: "Synthetic translation 0" }, { footnote: [{ t: "Synthetic credit" }] }]);
    expect(unit.material.unit.blocks[1]).toMatchObject({ role: "original", footnote: [{ em: [{ t: "Synthetic note" }] }] });
    expect(unit.material.license).toEqual({ spdx: "LicenseRef-Synthetic", attribution: "Synthetic CRC-only credit" });
    const wire = JSON.stringify(unit);
    for (const field of [f.content.hidden, "Unselected synthetic front", "omitted-synthetic", '"tr"', '"bare"', '"folio"', '"phys"', '"folios"', '"printedFolio"', '"feedBytes"', '"pins"']) expect(wire).not.toContain(field);
  }
  expect(external).not.toHaveBeenCalled();
});

test("actual SDK tenant/role/relationship authority and staff mutations cannot use practice headers", async () => {
  const f = await fixture();
  for (const operation of ["catalog", "prepare", "confirm"]) {
    const body = operation === "catalog" ? { mode: "student" } : operation === "prepare" ? { ...f.selection, mode: "student" } : { mode: "student", binding: "v1.synthetic" };
    await json(await f.call(`/${operation}`, { who: "learner", body }), 400);
    await json(await f.call(`/${operation}`, { body: { ...body, mode: "admin" }, handle: "synthetic-context" }), 400);
  }
  const tutor = await json(await f.call("/catalog", { who: "multi", body: { mode: "tutor" } })); expect(tutor.state).toBe("available");
  for (const [index, who, mode] of [[1, "multi", "tutor"], [2, "multi", "parent"], [3, "admin", "admin"]] as const) {
    const path = `/api/students/${f.students[index].id}/service-plan`;
    await json(await f.dispatch(f.request(`${path}?mode=${mode}`, { who })), 404);
    await json(await f.dispatch(f.request(`${path}/catalog`, { who, body: { mode } })), mode === "parent" ? 400 : 404);
  }
  await json(await f.call("?mode=admin", { who: "anonymous" }), 401);
  await json(await f.call("?mode=admin", { who: "recipient" }), 403);
  await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)));
  await json(await f.call("/catalog", { who: "multi", body: { mode: "tutor" } }), 404);
});

test("actual SDK linked-child reads require exact live header; no context is accepted in body/query", async () => {
  const f = await fixture(), saved = await f.save();
  await f.owner(() => f.db.update(s.guardian).set({ practiceEnabled: true }).where(eq(s.guardian.id, f.guardians[0].id)));
  const entered = await f.runtime.practice.enter(f.request("/api/practice/enter", { body: { studentId: f.studentId } }), { studentId: f.studentId });
  expect((await json(await f.call("?mode=child-practice", { who: "multi", handle: entered.handle }))).state).toBe("assigned");
  const unit = { mode: "child-practice", planId: saved.planId, planRevision: saved.revision, catalogIdentity: f.content.identity, unitId: f.content.first };
  expect((await json(await f.call("/unit", { who: "multi", handle: entered.handle, body: unit }))).state).toBe("assigned");
  await json(await f.call("?mode=child-practice", { who: "multi" }), 404);
  await json(await f.call("?mode=student", { who: "learner", handle: entered.handle }), 403);
  await json(await f.call("/unit", { who: "multi", body: { ...unit, context: entered.handle } }), 400);
  await json(await f.call(`?mode=child-practice&handle=synthetic`, { who: "multi", handle: entered.handle }), 400);
  await f.owner(() => f.db.update(s.guardian).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.guardian.id, f.guardians[0].id)));
  await json(await f.call("/unit", { who: "multi", handle: entered.handle, body: unit }), 404);
});

test("stale409, withdrawal and explicit clear never return former material", async () => {
  const f = await fixture(), saved = await f.save();
  const unit = { mode: "student", planId: saved.planId, planRevision: saved.revision, catalogIdentity: f.content.identity, unitId: f.content.first };
  expect(await json(await f.call("/unit", { who: "learner", body: { ...unit, planRevision: 2 } }), 409)).toEqual({ ok: false, code: "stale-revision" });
  expect(await json(await f.call("/prepare", { body: f.selection }), 409)).toEqual({ ok: false, code: "stale-revision" });
  await json(await f.call("/unit", { who: "learner", body: { ...unit, unitId: f.content.hidden } }), 404);
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }));
  const withdrawn = await json(await f.call("/unit", { who: "learner", body: unit })); expect(withdrawn.state).toBe("withdrawn"); expect(Object.keys(withdrawn).sort()).toEqual(["plan", "state"]);
  expect((await json(await f.call("?mode=student", { who: "learner" }))).state).toBe("withdrawn");
});

test("empty catalog and unknown slot are explicit availability states", async () => {
  const f = await fixture(false);
  expect(await json(await f.call("?mode=admin"))).toEqual({ state: "no-plan" });
  expect(await json(await f.call("/catalog", { body: { mode: "admin" } }))).toEqual({ state: "unavailable" });
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, f.studentId)));
  expect(await json(await f.call("/catalog", { body: { mode: "admin" } }))).toEqual({ state: "unknown-slot" });
});


test("explicit empty selection confirms a cleared plan with no assigned material", async () => {
  const f = await fixture();
  const review = await json(await f.call("/prepare", { body: { ...f.selection, selectedIds: [] } }));
  expect(review.clearsPlan).toBe(true); expect(review.selectedIds).toEqual([]);
  const saved = await json(await f.call("/confirm", { body: { mode: "admin", binding: review.binding } }));
  expect(saved).toMatchObject({ ok: true, revision: 1, cleared: true });
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }));
  const meta = await json(await f.call("?mode=student", { who: "learner" }));
  expect(meta.state).toBe("cleared"); expect(Object.keys(meta).sort()).toEqual(["plan", "state"]); expect(meta.plan.catalogIdentity).toBe(f.content.identity);
  await json(await f.call("/unit", { who: "learner", body: { mode: "student", planId: saved.planId, planRevision: 1, catalogIdentity: f.content.identity, unitId: f.content.first } }), 404);
});
