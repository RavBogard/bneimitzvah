import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import { createServiceLearningService } from "../../src/server/service-learning/service";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudentService } from "../../src/server/students/service";
import { createBindings } from "../../src/server/students/bindings";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import * as data from "../../src/server/service-learning/data";
import { DEFAULT_SERVICE_PARTS, defaultServiceUnitIds, parseServiceFeed } from "../../src/server/service-learning/feed";
import * as s from "../../src/server/db/index";
const opened: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
const secret = "synthetic-service-plan-review-secret-value";
async function fixture(options: { standard?: boolean; firstPage?: number | false } = {}) {
  const f = await accessFixture(); opened.push(f); const content = syntheticServiceCatalog("one", options);
  const catalogId = randomUUID();
  await f.owner(async () => {
    await f.db.update(s.student).set({ serviceSlot: "morning" });
    await f.db.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    const [reading] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: reading.id, ordinal: 1, verseRef: "Genesis 1:1" });
  });
  const practice = createPracticeService({ access: f.service }); let now = Date.now();
  const service = createServiceLearningService({ access: f.service, practice, signingSecret: secret, now: () => now });
  const mutation = (who: "admin" | "multi" | "learner" = "admin", origin = "http://localhost:3000") => ({ ...f.request(who, "http://localhost:3000", { origin }), method: "POST" });
  const selection = { mode: "admin" as const, studentId: f.students[0].id, expectedStudentRevision: 1, expectedPlanRevision: 0, catalogId, catalogIdentity: content.identity, selectedIds: [content.second, content.first] };
  async function prepare() { const result = await service.prepare(mutation(), selection); if (!result.ok) throw new Error("Synthetic service review unavailable"); return result; }
  async function save() { const review = await prepare(); const result = await service.confirm(mutation(), { mode: "admin", studentId: selection.studentId, binding: review.binding }); if (!result.ok) throw new Error("Synthetic service plan unavailable"); return result; }
  return { ...f, content, catalogId, practice, serviceLearning: service, mutation, selection, prepare, save, advance: () => { now += 6 * 60_000; } };
}
async function denied(operation: () => Promise<unknown>, status = 403) { try { await operation(); return false; } catch (e) { return e instanceof AccessDenied && e.status === status; } }
async function sqlCode(operation: () => PromiseLike<unknown>) { try { await operation(); return "accepted"; } catch (e) { const error = e as { code?: string; cause?: { code?: string } }; return error.cause?.code ?? error.code; } }

test("staff prepare/confirm uses source order, separate revisions and audit without scripture mutations", async () => {
  const f = await fixture(), before = await f.owner(() => f.db.select().from(s.assignment));
  expect(await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId })).toEqual({ state: "no-plan" });
  const available = await f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId });
  expect(available.state).toBe("available"); if (available.state === "available") expect(available.units.map(u => u.id)).toEqual([f.content.first, f.content.hidden, f.content.second]);
  const review = await f.prepare(); expect(review.selectedIds).toEqual([f.content.first, f.content.second]);
  expect(await f.owner(() => f.db.select().from(s.studentServicePlan))).toHaveLength(0);
  const saved = await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding });
  expect(saved).toMatchObject({ ok: true, revision: 1 });
  expect(await f.owner(() => f.db.select().from(s.assignment))).toEqual(before);
  expect(await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "service-plan.set")))).toHaveLength(1);
});

test("a student with no plan is offered the standard parts the feed provides; any saved plan, even a cleared one, is never preselected over", async () => {
  const f = await fixture({ standard: true }), staff = { mode: "admin" as const, studentId: f.selection.studentId };
  const fresh = await f.serviceLearning.catalog(f.mutation(), staff);
  // Morning: the two standard parts this feed has, in service order; the evening Sh'ma and the menu parts are not defaults.
  expect(fresh).toMatchObject({ state: "available", expectedPlanRevision: 0, defaults: [f.content.standard.vahavta, f.content.standard.torahBefore] });
  // Offering defaults writes nothing: the student still has no plan until staff confirm.
  expect(await f.owner(() => f.db.select().from(s.studentServicePlan))).toHaveLength(0);
  expect(await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId })).toEqual({ state: "no-plan" });
  // The tutor assigned to this student gets the same offer.
  expect(await f.serviceLearning.catalog(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId })).toMatchObject({ defaults: [f.content.standard.vahavta, f.content.standard.torahBefore] });
  await f.save();
  expect(await f.serviceLearning.catalog(f.mutation(), staff)).toMatchObject({ state: "available", expectedPlanRevision: 1, defaults: [] });
  // An explicitly cleared plan stays cleared.
  const cleared = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1, selectedIds: [] }); if (!cleared.ok) throw new Error("Synthetic clear unavailable");
  expect(await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: cleared.binding })).toMatchObject({ ok: true, cleared: true });
  expect(await f.serviceLearning.catalog(f.mutation(), staff)).toMatchObject({ expectedPlanRevision: 2, defaults: [] });
});

test("the default service parts come only from the feed's stable ids for the student's own service family", async () => {
  const { feedBytes, provenanceBytes, pins, standard } = syntheticServiceCatalog("one", { standard: true }), plain = syntheticServiceCatalog();
  const feed = parseServiceFeed(feedBytes, provenanceBytes, pins);
  expect(defaultServiceUnitIds(feed, "morning")).toEqual([standard.vahavta, standard.torahBefore]);
  expect(defaultServiceUnitIds(feed, "havdalah")).toEqual([standard.eveningShma]);
  expect(defaultServiceUnitIds(feed, "unknown")).toEqual([]);
  expect(defaultServiceUnitIds(parseServiceFeed(plain.feedBytes, plain.provenanceBytes, plain.pins), "morning")).toEqual([]);
  expect(DEFAULT_SERVICE_PARTS).toEqual(["torah.blessing-before-the-torah-reading", "torah.blessing-following-the-torah-reading", "torah.blessing-before-the-haftarah-reading", "torah.blessing-following-the-haftarah-reading", "shma.the-shma", "shma.vahavta"]);
});

test("selected material preserves credits/Unicode, excludes unrelated/front/companion content and PDF/transliteration coordinates", async () => {
  const f = await fixture(), saved = await f.save();
  for (const [who, mode] of [["admin", "admin"], ["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const) {
    const meta = await f.serviceLearning.metadata(f.request(who), { mode, studentId: f.selection.studentId });
    expect(meta.state).toBe("assigned"); if (meta.state === "assigned") expect(meta.units.map(u => u.id)).toEqual([f.content.first, f.content.second]);
    const result = await f.serviceLearning.unit(f.request(who), { mode, studentId: f.selection.studentId, planId: saved.planId, planRevision: saved.revision, catalogIdentity: f.content.identity, unitId: f.content.first });
    expect(result.state).toBe("assigned"); if (result.state !== "assigned") throw new Error("Synthetic assigned material missing");
    expect(result.material.unit.blocks[0].he).toBe("א֑ב\u200f"); expect(result.material.unit.blocks[1].role).toBe("original");
    expect(result.material.license.attribution).toBe("Synthetic CRC-only credit");
    expect(result.material.unit.blocks[1].footnote).toEqual([{ em: [{ t: "Synthetic note" }] }]);
    const json = JSON.stringify(result);
    for (const excluded of [f.content.hidden, "Unselected synthetic front", "omitted-synthetic", '"tr"', '"bare"', '"folio"', '"phys"', '"printedFolio"', '"folios"']) expect(json.includes(excluded)).toBe(false);
  }
  expect(await denied(() => f.serviceLearning.unit(f.request("learner"), { mode: "student", studentId: f.selection.studentId, planId: saved.planId, planRevision: 1, catalogIdentity: f.content.identity, unitId: f.content.hidden }), 404)).toBe(true);
});

test("metadata carries each assigned part's printed page and the service's first page from the pinned catalog, for every reader of the student", async () => {
  const f = await fixture({ firstPage: 5 }); await f.save();
  // Morning units sit on pages 5 (first), 6 (hidden) and 7 (second); the evening unit on 8.
  for (const [who, mode] of [["admin", "admin"], ["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const)
    expect(await f.serviceLearning.metadata(f.request(who), { mode, studentId: f.selection.studentId })).toMatchObject({ state: "assigned", serviceStart: 5,
      units: [{ id: f.content.first, page: 5 }, { id: f.content.second, page: 7 }] });
  const available = await f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId });
  expect(available.state === "available" && available.units.map(unit => [unit.id, unit.page])).toEqual([[f.content.first, 5], [f.content.hidden, 6], [f.content.second, 7]]);
  // An evening (Havdalah) plan starts at the evening service's own first page, not the morning's.
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "havdalah" }).where(eq(s.student.id, f.selection.studentId)));
  const evening = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1, selectedIds: [f.content.evening] }); if (!evening.ok) throw new Error("Synthetic evening review unavailable");
  await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: evening.binding });
  expect(await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId })).toMatchObject({ state: "assigned", serviceStart: 8, units: [{ id: f.content.evening, page: 8 }] });
});

test("a catalog without printed pages sends no page and no service start, and no other state carries either", async () => {
  const f = await fixture({ firstPage: false });
  const none = await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId });
  expect(none).toEqual({ state: "no-plan" });
  await f.save();
  const meta = await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId }), json = JSON.stringify(meta);
  expect(meta.state).toBe("assigned"); expect(json).not.toContain('"page"'); expect(json).not.toContain("serviceStart");
  expect(JSON.stringify(await f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId }))).not.toContain('"page"');
  const cleared = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1, selectedIds: [] }); if (!cleared.ok) throw new Error("Synthetic clear unavailable");
  await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: cleared.binding });
  const after = JSON.stringify(await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId }));
  expect(after).toContain('"cleared"'); expect(after).not.toContain('"page"'); expect(after).not.toContain("serviceStart");
});

test("staff-only Origin capability, exact tenant/relationship and duplicate/foreign/slot/size boundaries fail closed", async () => {
  const f = await fixture();
  for (const [who, mode] of [["multi", "parent"], ["learner", "student"]] as const) expect(await denied(() => f.serviceLearning.prepare(f.mutation(who), { ...f.selection, mode }))).toBe(true);
  expect(await denied(() => f.serviceLearning.prepare(f.mutation("admin", "https://foreign.example.test"), f.selection))).toBe(true);
  expect(await denied(() => f.serviceLearning.prepare(f.mutation("multi"), { ...f.selection, mode: "tutor", studentId: f.students[1].id }), 404)).toBe(true);
  expect(await denied(() => f.serviceLearning.prepare(f.mutation(), { ...f.selection, studentId: f.students[3].id }), 404)).toBe(true);
  for (const selectedIds of [[f.content.first, f.content.first], [f.content.evening], ["missing@bm-shacharit"], Array(257).fill(f.content.first)])
    expect(await denied(() => f.serviceLearning.prepare(f.mutation(), { ...f.selection, selectedIds }))).toBe(true);
  await f.owner(() => f.db.update(s.student).set({ serviceSlot: "unknown" }).where(eq(s.student.id, f.selection.studentId)));
  expect(await f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId })).toEqual({ state: "unknown-slot" });
  expect(await denied(() => f.serviceLearning.prepare(f.mutation(), f.selection))).toBe(true);
});

test("plan CAS, strict review purpose/session/actor identity and expiry block replay or cross-purpose writes", async () => {
  const f = await fixture(), a = await f.prepare(), b = await f.prepare();
  expect((await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: a.binding })).ok).toBe(true);
  expect(await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: b.binding })).toEqual({ ok: false, code: "stale-revision" });
  expect(await denied(() => f.serviceLearning.confirm(f.mutation("multi"), { mode: "tutor", studentId: f.selection.studentId, binding: a.binding }))).toBe(true);
  const foreignPurpose = createBindings(secret, Date.now).sign({ purpose: "student-reading" });
  expect(await denied(() => f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: foreignPurpose }))).toBe(true);
  const next = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1 }); if (!next.ok) throw new Error("Synthetic review missing");
  f.advance(); expect(await denied(() => f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: next.binding }))).toBe(true);
});

test("explicit empty selection is cleared, retains reviewed catalog identity and returns no material even on later withdrawal", async () => {
  const f = await fixture(), review = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, selectedIds: [] }); if (!review.ok) throw new Error("Synthetic empty review missing");
  expect(review.clearsPlan).toBe(true);
  await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding });
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 }));
  const meta = await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId });
  expect(meta.state).toBe("cleared"); if (meta.state === "cleared") expect(meta.plan.catalogIdentity).toBe(f.content.identity);
  expect(JSON.stringify(meta)).not.toContain("Synthetic");
});

test("superseded plans remain readable; withdrawal immediately blocks metadata/material and an outstanding confirmation", async () => {
  const f = await fixture(), saved = await f.save();
  const review = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1 }); if (!review.ok) throw new Error("Synthetic review missing");
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "superseded", revision: 2 }));
  expect((await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId })).state).toBe("assigned");
  expect(await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding })).toEqual({ ok: false, code: "stale-revision" });
  await f.owner(() => f.db.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 3 }));
  expect((await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId })).state).toBe("withdrawn");
  const result = await f.serviceLearning.unit(f.request("learner"), { mode: "student", studentId: f.selection.studentId, planId: saved.planId, planRevision: 1, catalogIdentity: f.content.identity, unitId: f.content.first });
  expect(result.state).toBe("withdrawn"); expect(result).not.toHaveProperty("material");
});

test("date/slot edits atomically preserve IDs, mark review, bump independent plan revision, and invalidate prepared reviews/text baselines", async () => {
  const f = await fixture(), saved = await f.save(), old = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: 1 }); if (!old.ok) throw new Error("Synthetic review missing");
  const students = createStudentService({ access: f.service, signingSecret: secret, loadReading: async () => { throw new Error("No calendar fetch"); } });
  await students.edit(f.mutation(), { mode: "admin", studentId: f.selection.studentId, expectedRevision: 1, student: { firstName: "Synthetic", lastName: "Sibling A", ceremonyDate: "2027-01-09", serviceSlot: "havdalah", parentEmail: "shared@example.test" } });
  const meta = await f.serviceLearning.metadata(f.request("learner"), { mode: "student", studentId: f.selection.studentId });
  expect(meta.state).toBe("assigned"); if (meta.state === "assigned") { expect(meta.plan).toMatchObject({ revision: 2, needsReview: true }); expect(meta.units.map(u => u.id)).toEqual([f.content.first, f.content.second]); }
  expect(await f.serviceLearning.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: old.binding })).toEqual({ ok: false, code: "stale-revision" });
  expect(await f.serviceLearning.unit(f.request("learner"), { mode: "student", studentId: f.selection.studentId, planId: saved.planId, planRevision: 1, catalogIdentity: f.content.identity, unitId: f.content.first })).toEqual({ state: "stale" });
});

test("database constraints enforce selection bounds, catalog tenant identity, one active generation and positive lifecycle revisions", async () => {
  const f = await fixture(); await f.save();
  const commands = [sql`update student_service_plan set selected_ids=ARRAY[NULL]::text[]`, sql`update student_service_plan set selected_ids=array_fill('sample.first@bm-shacharit',ARRAY[257])`,
    sql`update student_service_plan set selected_ids=ARRAY[ARRAY['sample.first@bm-shacharit']]`, sql`update student_service_plan set revision=0`, sql`update student_service_plan set reviewed_slot='unknown'`,
    sql`update student_service_plan set catalog_identity=${"f".repeat(64)}`, sql`update student_service_plan set student_id=${f.students[3].id}`,
    sql`update service_catalog_lifecycle set revision=0`, sql`update service_catalog_lifecycle set state='withdrawn'`];
  for (const command of commands) expect(await sqlCode(() => f.owner(() => f.db.execute(command)))).not.toBe("accepted");
  const second = syntheticServiceCatalog("second");
  await f.owner(async () => {
    const [catalog] = await f.db.insert(s.serviceCatalog).values({ tenantId: "crc", identity: second.identity, feedBytes: second.feedBytes, provenanceBytes: second.provenanceBytes, pins: second.pins }).returning();
    expect(await sqlCode(() => f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId: catalog.id, state: "active" }))).toBe("23505");
  });
});

test("malformed immutable catalog pins fail closed instead of falling back to another generation", async () => {
  const f = await fixture(), bad = syntheticServiceCatalog("corrupt");
  await f.owner(async () => {
    await f.db.update(s.serviceCatalogLifecycle).set({ state: "superseded", revision: 2 });
    const [catalog] = await f.db.insert(s.serviceCatalog).values({ tenantId: "crc", identity: bad.identity, feedBytes: bad.feedBytes, provenanceBytes: bad.provenanceBytes, pins: { ...bad.pins, feedSha256: "0".repeat(64) } }).returning();
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId: catalog.id, state: "active" });
  });
  await expect(f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId })).rejects.toBeInstanceOf(AccessUnavailable);
});

test("date-slot changes after catalog loading reject a first-plan draft and refresh an authoritative review summary", async () => {
  const f = await fixture(), old = await f.serviceLearning.catalog(f.mutation(), { mode: "admin", studentId: f.selection.studentId });
  expect(old.state).toBe("available");
  const students = createStudentService({ access: f.service, signingSecret: secret, loadReading: async () => { throw new Error("No synthetic calendar fetch"); } });
  await students.edit(f.mutation(), { mode: "admin", studentId: f.selection.studentId, expectedRevision: 1, student: { firstName: "Synthetic", lastName: "Sibling A", ceremonyDate: "2027-01-09", serviceSlot: "havdalah", parentEmail: "shared@example.test" } });
  expect(await f.serviceLearning.prepare(f.mutation(), f.selection)).toEqual({ ok: false, code: "stale-revision" });
  expect(await f.owner(() => f.db.select().from(s.studentServicePlan))).toHaveLength(0);
  const next = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedStudentRevision: 2, selectedIds: [f.content.evening] });
  expect(next.ok).toBe(true); if (!next.ok) throw new Error("Synthetic refreshed review missing");
  expect(next.review).toEqual({ studentRevision: 2, ceremonyDate: "2027-01-09", serviceSlot: "havdalah", catalogId: f.catalogId,
    catalogIdentity: f.content.identity, lifecycleRevision: 1, expectedPlanRevision: 0 });
});

test("linked-child read parity rechecks handle/guardian state and clears after revocation", async () => {
  const f = await fixture(); await f.save();
  const entered = await f.practice.enter(f.mutation("multi"), { studentId: f.selection.studentId });
  const request = f.request("multi", "http://localhost:3000", { "x-practice-context": entered.handle });
  expect((await f.serviceLearning.metadata(request, { mode: "child-practice", studentId: f.selection.studentId })).state).toBe("assigned");
  await f.owner(() => f.db.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.id, f.guardians[0].id)));
  expect(await denied(() => f.serviceLearning.metadata(request, { mode: "child-practice", studentId: f.selection.studentId }), 404)).toBe(true);
});

test("catalog content is immutable/SELECT-only, lifecycle grants permit SHARE but no mutation, and tenant RLS denies other catalogs", async () => {
  const f = await fixture();
  await withTenantTransaction(f.db, { tenantId: "crc" }, async tx => { expect(await data.lifecycle(tx, "crc", f.catalogId)).not.toBeNull(); });
  const commands = [sql`update service_catalog set identity=identity`, sql`delete from service_catalog`, sql`insert into service_catalog select * from service_catalog`,
    sql`update service_catalog_lifecycle set id=${randomUUID()}`, sql`update service_catalog_lifecycle set state='withdrawn'`, sql`update service_catalog_lifecycle set revision=2`, sql`delete from service_catalog_lifecycle`, sql`insert into service_catalog_lifecycle select * from service_catalog_lifecycle`];
  for (const command of commands) expect(await sqlCode(() => withTenantTransaction(f.db, { tenantId: "crc" }, tx => tx.execute(command)))).not.toBe("accepted");
  await withTenantTransaction(f.db, { tenantId: "other" }, async tx => { expect(await data.lifecycle(tx, "crc", f.catalogId)).toBeNull(); expect(await data.catalog(tx, "crc", f.catalogId)).toBeNull(); });
  expect(await sqlCode(() => f.owner(() => f.db.update(s.serviceCatalog).set({ identity: "2".repeat(64) })))) .toBe("23514");
});

test("fresh session expiry after final lock/work rejects read/prepare/confirm and rolls back persistence/audit", async () => {
  const f = await fixture(), saved = await f.save(), expires = Date.now() + 60_000;
  await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(expires) }).where(eq(s.session.id, f.identities.admin.sessionId)));
  const service = createServiceLearningService({ access: f.service, practice: f.practice, signingSecret: secret, data: { ...data, currentPlan: async (...args) => {
    const value = await data.currentPlan(...args); if (args[3]) vi.spyOn(Date, "now").mockReturnValue(expires + 1); return value;
  } } });
  expect(await denied(() => service.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: saved.revision }), 401)).toBe(true);
  vi.restoreAllMocks();
  expect(await denied(() => service.metadata(f.request("admin"), { mode: "admin", studentId: f.selection.studentId }), 401)).toBe(true);
  vi.restoreAllMocks();
  const review = await f.serviceLearning.prepare(f.mutation(), { ...f.selection, expectedPlanRevision: saved.revision }); if (!review.ok) throw new Error("Synthetic review missing");
  expect(await denied(() => service.confirm(f.mutation(), { mode: "admin", studentId: f.selection.studentId, binding: review.binding }), 401)).toBe(true);
  vi.restoreAllMocks();
  await f.owner(async () => { expect((await f.db.select().from(s.studentServicePlan))[0].revision).toBe(1); expect(await f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "service-plan.set"))).toHaveLength(1); });
});
