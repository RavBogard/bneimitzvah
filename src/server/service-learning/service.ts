import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, ActiveMode, StudentActor } from "../access/types";
import type { StudentView } from "../data/students";
import type { createPracticeService } from "../practice/service";
import type { PracticeActor } from "../practice/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { actorBinding } from "../students/service";
import { createBindings, digest } from "../students/bindings";
import { identifier } from "../students/validation";
import { parseServiceFeed, serviceUnitsForSlot, SERVICE_FEED_LIMITS, type ServiceFeed, type ServiceUnit as FeedUnit } from "./feed";
import type { ServiceUnit, ServiceUnitMaterial, ServiceSectionHeading } from "../../lib/service-learning/types";
import * as stored from "./data";

type Mode = ActiveMode | "child-practice";
type ReadSelection = { mode: Mode; studentId: string };
type Plan = NonNullable<Awaited<ReturnType<typeof stored.currentPlan>>>;
type Lifecycle = NonNullable<Awaited<ReturnType<typeof stored.lifecycle>>>;
const stale = () => ({ ok: false as const, code: "stale-revision" as const });
const positive = (value: unknown, zero = false) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (zero ? 0 : 1) || value > 2_147_483_646) throw new AccessDenied(403);
  return value;
};
const identity = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new AccessDenied(403); return value; };
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > SERVICE_FEED_LIMITS.units || value.some(x => typeof x !== "string" || !x.length || x.length > 128) ||
    new Set(value).size !== value.length || Buffer.byteLength(JSON.stringify(value)) > 16_384) throw new AccessDenied(403);
  return [...value];
}
function live(actor: StudentActor | PracticeActor) {
  const now = Date.now();
  if (!Number.isSafeInteger(actor.authSessionExpiresAt) || actor.authSessionExpiresAt <= now) throw new AccessDenied(401);
  if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= now) throw new AccessDenied(404);
}
function canonical(feed: ServiceFeed, selected: string[], slot: "morning" | "havdalah"): string[] {
  const allowed = serviceUnitsForSlot(feed, slot), requested = new Set(selected);
  if (selected.some(id => !allowed.some(unit => unit.id === id))) throw new AccessDenied(403);
  return allowed.filter(unit => requested.has(unit.id)).map(unit => unit.id);
}
function section(feed: ServiceFeed, index: number): ServiceSectionHeading {
  const row = feed.sections.find(value => value.idx === index); if (!row) throw new AccessUnavailable();
  return { idx: index, ...(Object.hasOwn(row, "en") ? { en: row.en as string | null } : {}),
    ...(Object.hasOwn(row, "he") ? { he: row.he as string | null } : {}), ...(Object.hasOwn(row, "opener") ? { opener: row.opener as boolean } : {}) };
}
function material(feed: ServiceFeed, value: FeedUnit): ServiceUnitMaterial {
  const { blocks, folios: _folios, printedFolio: _printed, companionOf: _companion, companionRole: _role, renderSegments, ...unit } = value;
  const projected: ServiceUnit = { ...unit, blocks: blocks.map(value => {
    const { bare: _bare, folio: _folio, phys: _phys, ...block } = value; return block;
  }), ...(renderSegments ? { renderSegments: { he: renderSegments.he, en: renderSegments.en } } : {}) };
  return { unit: projected, section: section(feed, value.section), license: { ...feed.license },
    source: { catalogIdentity: feed.identity, sourceGitSha: feed.source.gitSha, sourceBuiltAt: feed.source.builtAt,
      artifactCommit: feed.artifact.commit, artifactRunId: feed.artifact.runId },
    ...(feed.blockGranularity ? { blockGranularity: feed.blockGranularity } : {}) };
}
const bounded = <T>(value: T): T => { if (Buffer.byteLength(JSON.stringify(value)) > 256 * 1024) throw new AccessUnavailable(); return value; };
const summary = (feed: ServiceFeed, unit: FeedUnit) => ({ id: unit.id, name: unit.name,
  ...(unit.caption !== undefined ? { caption: unit.caption } : {}), section: section(feed, unit.section) });

export function createServiceLearningService<Q extends PgQueryResultHKT>(input: {
  access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>;
  signingSecret: string; now?: () => number; data?: typeof stored;
}) {
  const data = input.data ?? stored, bindings = createBindings(input.signingSecret, input.now ?? Date.now);
  async function feed(tx: AccessTransaction<Q>, tenantId: string, catalogId: string) {
    const row = await data.catalog(tx, tenantId, catalogId); if (!row) throw new AccessUnavailable();
    try {
      const parsed = parseServiceFeed(row.feedBytes, row.provenanceBytes, row.pins);
      if (parsed.identity !== row.identity) throw new AccessUnavailable();
      return parsed;
    } catch { throw new AccessUnavailable(); }
  }
  const withRead = <T>(request: AccessRequest, selection: ReadSelection, action: (tx: AccessTransaction<Q>, actor: StudentActor | PracticeActor, student: StudentView) => Promise<T>) => {
    identifier(selection.studentId);
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { ...selection, mode: "child-practice", capability: "read" }, action)
      : input.access.withStudentCapability(request, { ...selection, mode: selection.mode, capability: "read" }, action);
  };
  async function readPlan(tx: AccessTransaction<Q>, actor: StudentActor | PracticeActor, student: StudentView) {
    const baseline = await data.currentPlan(tx, actor.tenantId, student.id);
    if (!baseline) { live(actor); return null; }
    // Lifecycle precedes plan locks for every read/write. Re-read after locking to
    // reject a concurrent plan replacement rather than mix generations.
    const lifecycle = await data.lifecycle(tx, actor.tenantId, baseline.catalogId);
    if (!lifecycle) throw new AccessUnavailable();
    const plan = await data.currentPlan(tx, actor.tenantId, student.id, "share");
    live(actor);
    if (!plan || plan.id !== baseline.id || plan.revision !== baseline.revision || plan.catalogId !== baseline.catalogId) return { stale: true as const };
    const context = await data.context(tx, actor.tenantId, student.id); if (!context) throw new AccessDenied(404);
    const selected = ids(plan.selectedIds), needsReview = plan.needsReview || student.ceremonyDate !== plan.reviewedDate || context.serviceSlot !== plan.reviewedSlot;
    live(actor); return { plan, lifecycle, selected, needsReview };
  }
  const planView = (value: { plan: Plan; lifecycle: Lifecycle; needsReview: boolean }) => ({ id: value.plan.id, revision: value.plan.revision,
    needsReview: value.needsReview, catalogId: value.plan.catalogId, catalogIdentity: value.plan.catalogIdentity, catalogState: value.lifecycle.state });
  async function metadata(request: AccessRequest, selection: ReadSelection) {
    return withRead(request, selection, async (tx, actor, student) => {
      const value = await readPlan(tx, actor, student);
      if (!value) return { state: "no-plan" as const };
      if ("stale" in value) return { state: "stale" as const };
      const plan = planView(value);
      if (!value.selected.length) { live(actor); return { state: "cleared" as const, plan }; }
      if (value.lifecycle.state === "withdrawn") { live(actor); return { state: "withdrawn" as const, plan }; }
      const loaded = await feed(tx, actor.tenantId, value.plan.catalogId);
      const selected = canonical(loaded, value.selected, value.plan.reviewedSlot);
      if (loaded.identity !== value.plan.catalogIdentity || digest(selected) !== digest(value.selected)) throw new AccessUnavailable();
      const units = selected.map(id => summary(loaded, loaded.units.find(unit => unit.id === id)!));
      const result = bounded({ state: "assigned" as const, plan, units }); live(actor); return result;
    });
  }
  async function unit(request: AccessRequest, selection: ReadSelection & { planId: string; planRevision: number; catalogIdentity: string; unitId: string }) {
    identifier(selection.planId); positive(selection.planRevision); identity(selection.catalogIdentity); const [unitId] = ids([selection.unitId]);
    return withRead(request, selection, async (tx, actor, student) => {
      const value = await readPlan(tx, actor, student); if (!value) throw new AccessDenied(404);
      if ("stale" in value) return { state: "stale" as const };
      if (value.plan.id !== selection.planId || value.plan.revision !== selection.planRevision || value.plan.catalogIdentity !== selection.catalogIdentity) { live(actor); return { state: "stale" as const }; }
      if (!value.selected.includes(unitId)) throw new AccessDenied(404);
      if (value.lifecycle.state === "withdrawn") { live(actor); return { state: "withdrawn" as const, plan: planView(value) }; }
      const loaded = await feed(tx, actor.tenantId, value.plan.catalogId);
      const selected = canonical(loaded, value.selected, value.plan.reviewedSlot);
      if (loaded.identity !== value.plan.catalogIdentity || digest(selected) !== digest(value.selected)) throw new AccessUnavailable();
      const result = bounded({ state: "assigned" as const, plan: planView(value), material: material(loaded, loaded.units.find(unit => unit.id === unitId)!) });
      live(actor); return result;
    });
  }
  async function catalog(request: CookieMutationRequest, selection: { mode: ActiveMode; studentId: string }) {
    const studentId = identifier(selection.studentId);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId, capability: "set-service-plan" }, async (tx, actor, student) => {
      const context = await data.context(tx, actor.tenantId, studentId); if (!context) throw new AccessDenied(404);
      if (context.serviceSlot === "unknown") { live(actor); return { state: "unknown-slot" as const }; }
      const lifecycle = await data.lifecycle(tx, actor.tenantId); if (!lifecycle || lifecycle.state !== "active") { live(actor); return { state: "unavailable" as const }; }
      const loaded = await feed(tx, actor.tenantId, lifecycle.catalogId), plan = await data.currentPlan(tx, actor.tenantId, studentId, "share");
      const result = bounded({ state: "available" as const, studentRevision: student.revision, ceremonyDate: student.ceremonyDate, serviceSlot: context.serviceSlot,
        expectedPlanRevision: plan?.revision ?? 0, catalogId: lifecycle.catalogId, catalogIdentity: loaded.identity, lifecycleRevision: lifecycle.revision,
        units: serviceUnitsForSlot(loaded, context.serviceSlot).map(unit => summary(loaded, unit)) });
      live(actor); return result;
    });
  }
  async function prepare(request: CookieMutationRequest, selection: { mode: ActiveMode; studentId: string; expectedStudentRevision: number; expectedPlanRevision: number; catalogId: string; catalogIdentity: string; selectedIds: string[] }) {
    const studentId = identifier(selection.studentId), catalogId = identifier(selection.catalogId), expectedStudent = positive(selection.expectedStudentRevision), expected = positive(selection.expectedPlanRevision, true), catalogIdentity = identity(selection.catalogIdentity), selected = ids(selection.selectedIds);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId, capability: "set-service-plan" }, async (tx, actor, student) => {
      requireCookieMutation(request, actor.origin);
      const checkedStale = () => { live(actor); return stale(); };
      if (student.revision !== expectedStudent) return checkedStale();
      const context = await data.context(tx, actor.tenantId, studentId); if (!context) throw new AccessDenied(404);
      if (context.serviceSlot === "unknown") throw new AccessDenied(403);
      const lifecycle = await data.lifecycle(tx, actor.tenantId, catalogId);
      if (!lifecycle || lifecycle.state !== "active") return checkedStale();
      const current = await data.currentPlan(tx, actor.tenantId, studentId, "share");
      if ((current?.revision ?? 0) !== expected) return checkedStale();
      const loaded = await feed(tx, actor.tenantId, catalogId); if (loaded.identity !== catalogIdentity) return checkedStale();
      const selectionIds = canonical(loaded, selected, context.serviceSlot);
      live(actor);
      const binding = bindings.sign({ purpose: "service-plan", actor: actorBinding(actor), studentId, studentRevision: student.revision,
        date: student.ceremonyDate, slot: context.serviceSlot, planId: current?.id ?? null, planRevision: expected,
        catalogId, catalogIdentity, lifecycleRevision: lifecycle.revision, selectedIds: selectionIds, selectionDigest: digest(selectionIds) });
      const expiresAt = bindings.verify(binding, "service-plan").expiresAt;
      if (typeof expiresAt !== "number") throw new AccessDenied(403);
      live(actor);
      return { ok: true as const, binding, expiresAt, selectedIds: selectionIds, clearsPlan: !selectionIds.length,
        review: { studentRevision: student.revision, ceremonyDate: student.ceremonyDate, serviceSlot: context.serviceSlot,
          catalogId, catalogIdentity, lifecycleRevision: lifecycle.revision, expectedPlanRevision: expected } };
    });
  }
  async function confirm(request: CookieMutationRequest, selection: { mode: ActiveMode; studentId: string; binding: string }) {
    const studentId = identifier(selection.studentId), claim = bindings.verify(selection.binding, "service-plan");
    if (claim.studentId !== studentId) throw new AccessDenied(403);
    const catalogId = identifier(claim.catalogId), catalogIdentity = identity(claim.catalogIdentity), selected = ids(claim.selectedIds), expected = positive(claim.planRevision, true);
    if (claim.selectionDigest !== digest(selected)) throw new AccessDenied(403);
    return input.access.withStudentCapability(request, { mode: selection.mode, studentId, capability: "set-service-plan" }, async (tx, actor, student) => {
      requireCookieMutation(request, actor.origin);
      if (digest(claim.actor) !== digest(actorBinding(actor))) throw new AccessDenied(403);
      const assertLive = () => { live(actor); if (digest(bindings.verify(selection.binding, "service-plan")) !== digest(claim)) throw new AccessDenied(403); };
      const checkedStale = () => { assertLive(); return stale(); };
      const context = await data.context(tx, actor.tenantId, studentId); if (!context) throw new AccessDenied(404);
      if (context.serviceSlot === "unknown" || claim.slot !== context.serviceSlot || claim.date !== student.ceremonyDate || claim.studentRevision !== student.revision) return checkedStale();
      const lifecycle = await data.lifecycle(tx, actor.tenantId, catalogId);
      if (!lifecycle || lifecycle.state !== "active" || lifecycle.revision !== claim.lifecycleRevision) return checkedStale();
      const current = await data.currentPlan(tx, actor.tenantId, studentId, "update");
      assertLive();
      if ((current?.revision ?? 0) !== expected || (current?.id ?? null) !== claim.planId) return checkedStale();
      const loaded = await feed(tx, actor.tenantId, catalogId);
      if (loaded.identity !== catalogIdentity || digest(canonical(loaded, selected, context.serviceSlot)) !== claim.selectionDigest) return checkedStale();
      assertLive();
      const result = await data.persist(tx, actor, studentId, expected, { catalogId, catalogIdentity, selectedIds: selected, reviewedDate: student.ceremonyDate, reviewedSlot: context.serviceSlot });
      if (!result) return checkedStale();
      await data.audit(tx, actor, studentId, result.id); assertLive();
      return { ok: true as const, planId: result.id, revision: result.revision, cleared: !selected.length };
    });
  }
  return Object.freeze({ catalog, prepare, confirm, metadata, unit });
}
