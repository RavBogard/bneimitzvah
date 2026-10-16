import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { accessFixture } from "./access-fixture";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { createPracticeService } from "../../src/server/practice/service";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import * as data from "../../src/server/service-learning/data";
import * as s from "../../src/server/db/index";

const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
const secret = "independent-synthetic-service-review-secret";
async function fixture() {
  const f = await accessFixture(); opened.push(f);
  const payload = syntheticServiceCatalog(), catalogId = randomUUID(), expires = Date.now() + 60_000;
  await f.owner(async () => {
    await f.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, f.students[0].id));
    await f.db.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.identities.admin.sessionId));
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: payload.identity,
      feedBytes: payload.feedBytes, provenanceBytes: payload.provenanceBytes, pins: payload.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
  });
  const practice = createPracticeService({ access: f.service });
  const create = (override: Partial<typeof data> = {}) => createServiceLearningService({ access: f.service, practice,
    signingSecret: secret, data: { ...data, ...override } });
  const service = create(), request = () => ({ ...f.request("admin", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, expectedStudentRevision: 1,
    expectedPlanRevision: 0, catalogId, catalogIdentity: payload.identity, selectedIds: [payload.first] };
  async function prepare() { const value = await service.prepare(request(), selection); if (!value.ok) throw new Error("Independent synthetic preparation missing"); return value; }
  async function save() { const review = await prepare(); const value = await service.confirm(request(), { mode: "admin", studentId: selection.studentId, binding: review.binding });
    if (!value.ok) throw new Error("Independent synthetic plan missing"); return value; }
  const expire = () => { vi.spyOn(Date, "now").mockReturnValue(expires + 1); };
  return { ...f, service, practice, create, request, accessRequest: f.request, selection, prepare, save, expire };
}
async function expired(operation: () => Promise<unknown>) {
  try { const result = await operation(); return result; }
  catch (error) { if (error instanceof AccessDenied) return { denied: error.status }; throw error; }
}

test("read expiry wins even when a final locked plan no longer matches the baseline", async () => {
  const f = await fixture(); await f.save();
  const service = f.create({ currentPlan: async (...args) => {
    const row = await data.currentPlan(...args);
    if (args[3] && row) { f.expire(); return { ...row, revision: row.revision + 1 }; }
    return row;
  } });
  expect(await expired(() => service.metadata(f.request(), { mode: "admin", studentId: f.selection.studentId }))).toEqual({ denied: 401 });
});

test("prepare expiry wins when an awaited lifecycle becomes ineligible", async () => {
  const f = await fixture();
  const service = f.create({ lifecycle: async (...args) => {
    const row = await data.lifecycle(...args); f.expire(); return row ? { ...row, state: "superseded" as const } : null;
  } });
  expect(await expired(() => service.prepare(f.request(), f.selection))).toEqual({ denied: 401 });
});

test("confirm expiry wins when awaited student context no longer matches the review", async () => {
  const f = await fixture(), review = await f.prepare();
  const service = f.create({ context: async (...args) => {
    const row = await data.context(...args); f.expire(); return row ? { serviceSlot: "havdalah" as const } : row;
  } });
  expect(await expired(() => service.confirm(f.request(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding }))).toEqual({ denied: 401 });
});

test("expiry after audit rolls the service plan and its audit back together", async () => {
  const f = await fixture(), review = await f.prepare();
  const service = f.create({ audit: async (...args) => { await data.audit(...args); f.expire(); } });
  expect(await expired(() => service.confirm(f.request(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding }))).toEqual({ denied: 401 });
  vi.restoreAllMocks();
  await f.owner(async () => {
    expect(await f.db.select().from(s.studentServicePlan)).toHaveLength(0);
    expect(await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "service-plan.set"))).toHaveLength(0);
  });
});

test("superseding the catalog cannot replace the text of an existing pinned plan", async () => {
  const f = await fixture(), saved = await f.save(), replacement = syntheticServiceCatalog("replacement"), replacementId = randomUUID();
  await f.owner(async () => {
    await f.db.update(s.serviceCatalogLifecycle).set({ state: "superseded", revision: 2 });
    await f.db.insert(s.serviceCatalog).values({ id: replacementId, tenantId: "crc", identity: replacement.identity,
      feedBytes: replacement.feedBytes, provenanceBytes: replacement.provenanceBytes, pins: replacement.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId: replacementId, state: "active" });
  });
  const result = await f.service.unit(f.request(), { mode: "admin", studentId: f.selection.studentId,
    planId: saved.planId, planRevision: 1, catalogIdentity: f.selection.catalogIdentity, unitId: f.selection.selectedIds[0] });
  expect(result.state).toBe("assigned");
  if (result.state === "assigned") expect(result.material.source.catalogIdentity).toBe(f.selection.catalogIdentity);
  expect(JSON.stringify(result)).not.toContain(replacement.identity);
});

test("catalog work cannot return delegated material after the selected child's practice context expires", async () => {
  const f = await fixture(), saved = await f.save();
  const parentMutation = { ...f.accessRequest("multi", "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" };
  const entered = await f.practice.enter(parentMutation, { studentId: f.selection.studentId });
  const service = f.create({ catalog: async (...args) => {
    const row = await data.catalog(...args); vi.spyOn(Date, "now").mockReturnValue(Date.parse(entered.context.expiresAt) + 1); return row;
  } });
  const request = f.accessRequest("multi", "http://localhost:3000", { "x-practice-context": entered.handle });
  expect(await expired(() => service.unit(request, { mode: "child-practice", studentId: f.selection.studentId,
    planId: saved.planId, planRevision: 1, catalogIdentity: f.selection.catalogIdentity, unitId: f.selection.selectedIds[0] }))).toEqual({ denied: 404 });
});

test.each(["query", "artifact"])("unknown %s read failures expose only the fixed unavailable error", async failure => {
  const f = await fixture(), saved = await f.save(), marker = "private-synthetic-marker";
  const service = f.create(failure === "query" ? { currentPlan: async () => { throw new Error(marker); } } : {
    catalog: async (...args) => {
      const row = await data.catalog(...args); return row ? { ...row, feedBytes: Buffer.from(marker) } : row;
    },
  });
  try {
    await service.unit(f.request(), { mode: "admin", studentId: f.selection.studentId, planId: saved.planId,
      planRevision: 1, catalogIdentity: f.selection.catalogIdentity, unitId: f.selection.selectedIds[0] });
    throw new Error("Unexpected synthetic acceptance");
  } catch (error) {
    expect(error).toBeInstanceOf(AccessUnavailable);
    expect(String(error)).toBe("AccessUnavailable: Access service unavailable");
    expect(error).not.toHaveProperty("cause"); expect(JSON.stringify(error)).not.toContain(marker);
  }
});
