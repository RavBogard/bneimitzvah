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

async function readOrDenied(operation: () => Promise<unknown>) {
  try { return await operation(); } catch (error) { if (error instanceof AccessDenied) return { denied: error.status }; throw error; }
}

test("printed pages follow only the read student's own plan: siblings, a tutor and a linked learner never see another student's parts or pages", async () => {
  const f = await fixture(); await f.save();
  const sibling = f.students[1].id, { first, second } = syntheticServiceCatalog();
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, sibling)));
  const review = await f.service.prepare(f.request(), { ...f.selection, studentId: sibling, selectedIds: [second] });
  if (!review.ok) throw new Error("Independent synthetic sibling preparation missing");
  await f.service.confirm(f.request(), { mode: "admin", studentId: sibling, binding: review.binding });
  // The shared parent sees each child's own parts and pages, never the other's. Both share one catalog, so the
  // service start is the same; the per-part pages are what show the plans stay separate.
  const own = await f.service.metadata(f.accessRequest("multi"), { mode: "parent", studentId: f.selection.studentId });
  expect(own).toEqual(expect.objectContaining({ serviceStart: 1, units: [expect.objectContaining({ id: first, page: 1 })] }));
  expect(await f.service.metadata(f.accessRequest("multi"), { mode: "parent", studentId: sibling }))
    .toEqual(expect.objectContaining({ serviceStart: 1, units: [expect.objectContaining({ id: second, page: 3 })] }));
  // The learner linked to the first child, and the tutor assigned only to it, cannot read the sibling at all.
  expect(await readOrDenied(() => f.service.metadata(f.accessRequest("learner"), { mode: "student", studentId: sibling }))).toEqual({ denied: 404 });
  expect(await readOrDenied(() => f.service.metadata(f.accessRequest("multi"), { mode: "tutor", studentId: sibling }))).toEqual({ denied: 404 });
  // An unrelated student with no plan has no page fields.
  expect(await f.service.metadata(f.accessRequest("admin"), { mode: "admin", studentId: f.students[2].id })).toEqual({ state: "no-plan" });
});

test("printed pages never cross tenants: another tenant without a catalog gets no page fields, and with its own catalog gets only its own pages", async () => {
  const f = await fixture(); await f.save();
  const other = f.students[3].id, otherRequest = () => f.accessRequest("multi", "http://localhost:3101");
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, other)));
  // No siddur catalog in the other tenant: its student has no plan and no page fields, though CRC has both.
  expect(await f.service.metadata(otherRequest(), { mode: "student", studentId: other })).toEqual({ state: "no-plan" });
  // The other tenant gets its own catalog on distinct pages, and its own plan.
  const foreign = syntheticServiceCatalog("two", { firstPage: 40 }), foreignId = randomUUID();
  await f.owner(async () => {
    const [member] = await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
    await f.db.insert(s.serviceCatalog).values({ id: foreignId, tenantId: "other", identity: foreign.identity, feedBytes: foreign.feedBytes, provenanceBytes: foreign.provenanceBytes, pins: foreign.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "other", catalogId: foreignId, state: "active" });
    await f.db.insert(s.studentServicePlan).values({ tenantId: "other", studentId: other, catalogId: foreignId, catalogIdentity: foreign.identity,
      selectedIds: [foreign.first, foreign.second], reviewedDate: "2027-01-02", reviewedSlot: "morning", setByMembershipId: member.id });
  });
  expect(await f.service.metadata(otherRequest(), { mode: "student", studentId: other })).toEqual(expect.objectContaining({ state: "assigned", serviceStart: 40,
    units: [expect.objectContaining({ id: foreign.first, page: 40 }), expect.objectContaining({ id: foreign.second, page: 42 })] }));
  const ours = await f.service.metadata(f.accessRequest("learner"), { mode: "student", studentId: f.selection.studentId });
  expect(ours).toEqual(expect.objectContaining({ state: "assigned", serviceStart: 1, units: [expect.objectContaining({ id: f.selection.selectedIds[0], page: 1 })] }));
  expect(JSON.stringify(ours)).not.toMatch(/"page":4\d|"serviceStart":4\d/);
  // Neither tenant's readers can address the other tenant's student.
  for (const [request, studentId, mode] of [[f.accessRequest("learner"), other, "student"], [f.accessRequest("admin"), other, "admin"], [otherRequest(), f.selection.studentId, "student"]] as const)
    expect(await readOrDenied(() => f.service.metadata(request, { mode, studentId }))).toEqual({ denied: 404 });
  // Even a plan row forged to name CRC's catalog (the database's composite foreign key forbids storing one) fails closed
  // in the other tenant: its lifecycle is faked active, so the tenant-scoped catalog read is what refuses it.
  const crcCatalogId = f.selection.catalogId, forged = f.create({
    currentPlan: async (...args) => { const row = await data.currentPlan(...args); return row && row.tenantId === "other" ? { ...row, catalogId: crcCatalogId, catalogIdentity: f.selection.catalogIdentity } : row; },
    lifecycle: async (tx, tenantId, catalogId) => { const row = await data.lifecycle(tx, tenantId, catalogId === crcCatalogId && tenantId === "other" ? foreignId : catalogId); return row && catalogId === crcCatalogId ? { ...row, catalogId: crcCatalogId } : row; },
  });
  await expect(forged.metadata(otherRequest(), { mode: "student", studentId: other })).rejects.toBeInstanceOf(AccessUnavailable);
});
