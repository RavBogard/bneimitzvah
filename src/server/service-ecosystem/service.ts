import "server-only";
import { and, eq, inArray, sql,ne,isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, ActiveMode,StudentActor } from "../access/types";
import type {PracticeActor}from "../practice/types";
import type {createPracticeService}from "../practice/service";
import type {StudentView}from "../data/students";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { digest } from "../students/bindings";
import { identifier, revision } from "../students/validation";
import * as s from "../db/index";
import type { MusicBroker, MusicProjection, MusicRow } from "./contract";
import { verifyCeremonyMaterialMapping } from "../service-learning/service";
import { ensureIntent } from "./intent";
import { scheduleCeremony } from "./scheduling";
import { lessonForUnit, tenantFile } from "../../lib/service-course/path";
import { lessonById, lessonOpen } from "../../lib/service-course/course";

type Selection = { studentId: string; mode: ActiveMode|"child-practice" };
const bounded = (value: unknown, max: number, empty = true) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new AccessDenied(403);
  return value.trim();
};
export const resourceIdentity = (row: MusicRow) => digest([row.prayerId,row.momentId, row.biblicalRef, row.edition, row.textIdentity, row.catalogUnitId, row.liturgyRef, row.arrangement, row.resources]);
const stale = () => ({ ok: false as const, code: "stale-revision" as const });
type ServicePart = typeof s.studentServicePart.$inferSelect;
function partLesson(tenantId: string, projection: MusicProjection, part: ServicePart, row: MusicRow | undefined, availableCatalogs: ReadonlySet<string>) {
  if (!row || !part.leads || resourceIdentity(row) !== part.resourceIdentity || part.catalogId && !availableCatalogs.has(part.catalogId)) return null;
  const tenant = tenantFile(tenantId), unit = part.catalogUnitId ?? row.catalogUnitId;
  if (!unit?.endsWith(projection.ceremonyType === "havdalah" ? "@bm-maariv" : "@bm-shacharit")) return null;
  const id = tenant && unit ? lessonForUnit(tenant, unit) : null, lesson = id ? lessonById(id) : null;
  if (!tenant || !lesson || !lessonOpen(lesson, undefined, tenant)) return null;
  const key = digest(["service-part-lesson/v1", part.id, part.ceremonyId, row.rowId, projection.sourceRevision,
    projection.ceremonyType, part.resourceIdentity, part.catalogId, part.catalogIdentity, unit, lesson.id]);
  return { id: lesson.id, key, finished: part.lessonFinishedFor === key };
}
export function createServiceEcosystemService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>;practice?:ReturnType<typeof createPracticeService<Q>>;broker: MusicBroker; studentAudioRelease?: boolean;dispatchScheduled?:()=>void|Promise<void> }) {
  const withStudent = <T>(request: AccessRequest, selection: Selection, staff: boolean, action:(tx:AccessTransaction<Q>,actor:StudentActor|PracticeActor,student:StudentView)=>Promise<T>, practiceWrite = false):Promise<T> => {
    identifier(selection.studentId);
    const capability = practiceWrite ? "practice-write" : "read";
    if(selection.mode==="child-practice"){
      if(staff || !input.practice)throw new AccessDenied(403);
      return input.practice.withPracticeCapability<T>(request,{...selection,mode:"child-practice",capability},async(tx,actor,student)=>{if(actor.tenantId!=="crc")throw new AccessDenied(404);return action(tx,actor,student);});
    }
    return input.access.withStudentCapability<T>(request, { studentId:selection.studentId,mode:selection.mode,capability: staff ? "set-service-plan" : capability }, async (tx, actor, student) => {
      // The dedicated source credential is bound to CRC, never to arbitrary tenant membership.
      if (actor.tenantId !== "crc") throw new AccessDenied(404);
      return action(tx, actor, student);
    });
  };
  async function current(tx: AccessTransaction<Q>, tenantId: string, studentId: string,lockLink=false) {
    const query=tx.select({ link: s.studentCeremony, ceremony: s.serviceCeremony }).from(s.studentCeremony)
      .innerJoin(s.serviceCeremony, and(eq(s.serviceCeremony.tenantId, s.studentCeremony.tenantId), eq(s.serviceCeremony.id, s.studentCeremony.ceremonyId)))
      .where(and(eq(s.studentCeremony.tenantId, tenantId), eq(s.studentCeremony.studentId, studentId)));
    const [value]=await(lockLink?query.for("update",{of:s.studentCeremony}):query);
    return value ?? null;
  }
  async function availableCatalogs(tx: AccessTransaction<Q>, tenantId: string, parts: readonly ServicePart[]) {
    const ids = [...new Set(parts.flatMap(part => part.catalogId ? [part.catalogId] : []))];
    if (!ids.length) return new Set<string>();
    const rows = await tx.select({ id: s.serviceCatalogLifecycle.catalogId }).from(s.serviceCatalogLifecycle)
      .where(and(eq(s.serviceCatalogLifecycle.tenantId, tenantId), inArray(s.serviceCatalogLifecycle.catalogId, ids), ne(s.serviceCatalogLifecycle.state, "withdrawn"))).for("share");
    return new Set(rows.map(row => row.id));
  }
  async function synchronize(request: CookieMutationRequest, selection: Selection & { explicitSetlistId?: string }) {
    const baseline = await withStudent(request, selection, true, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId);
      if(selection.explicitSetlistId!==undefined){
        const chosen=bounded(selection.explicitSetlistId,128,false);
        if(!value || chosen===value.ceremony.excludedSetlistId || value.ceremony.setlistId && value.ceremony.setlistId!==chosen || !value.ceremony.setlistId && !value.ceremony.candidates.includes(chosen))throw new AccessDenied(403);
        if(!value.ceremony.setlistId && value.ceremony.selectedSetlistId!==chosen){
          const [updated]=await tx.update(s.serviceCeremony).set({selectedSetlistId:chosen,state:"pending",nextAttemptAt:new Date(),scheduleRevision:sql`${s.serviceCeremony.scheduleRevision}+1`,revision:sql`${s.serviceCeremony.revision}+1`}).where(and(eq(s.serviceCeremony.tenantId,actor.tenantId),eq(s.serviceCeremony.id,value.ceremony.id),eq(s.serviceCeremony.revision,value.ceremony.revision))).returning();
          if(!updated)throw new AccessUnavailable();return {...value,ceremony:updated};
        }
      }
      return value;
    });
    if (!baseline) return { ok: true as const, state: "unscheduled" as const };
    let result;
    try {
      result = baseline.ceremony.scheduleConflict && (!baseline.ceremony.originalConnectionPending || Boolean(baseline.ceremony.setlistId))
        ? await input.broker.projection(baseline.ceremony.id)
        : await input.broker.ensure(ensureIntent(baseline.ceremony,selection.explicitSetlistId));
    } catch { result = null; }
    return withStudent(request, selection, true, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId);
      if (!value || value.ceremony.id !== baseline.ceremony.id || value.ceremony.revision !== baseline.ceremony.revision) return stale();
      const state = result?.status ?? "unavailable";
      if (result && result.status !== "ambiguous" && result.setlistId && baseline.ceremony.setlistId && result.setlistId !== baseline.ceremony.setlistId) throw new AccessUnavailable();
      if(result && result.status!=="ambiguous" && result.setlistId && result.setlistId===value.ceremony.excludedSetlistId)throw new AccessUnavailable();
      const [saved] = await tx.update(s.serviceCeremony).set({ state,
        ...(result&&result.status!=="ambiguous"&&result.setlistId?{originalConnectionPending:false}:{}),
        ...(result && result.status !== "ambiguous" && result.setlistId ? { setlistId: result.setlistId, projection: result.projection ?? null } : { projection: null }),
        candidates: result?.status === "ambiguous" ? result.candidates.map(c => c.setlistId) : [], revision: sql`${s.serviceCeremony.revision} + 1`,
      }).where(and(eq(s.serviceCeremony.tenantId, actor.tenantId), eq(s.serviceCeremony.id, value.ceremony.id), eq(s.serviceCeremony.revision, baseline.ceremony.revision))).returning();
      return saved ? { ok: true as const, state } : stale();
    });
  }
  async function loadLive(request: AccessRequest, selection: Selection) {
    const baseline = await withStudent(request, selection, false, async (tx, actor) => current(tx, actor.tenantId, selection.studentId));
    if (!baseline || !baseline.ceremony.setlistId) return { baseline, projection: null, state: "unavailable" as const };
    let projection: MusicProjection | null = null;
    let state: "linked" | "review_required" | "unavailable" = "unavailable";
    try {
      const live = await input.broker.projection(baseline.ceremony.id);
      if (live.status !== "ambiguous" && live.setlistId === baseline.ceremony.setlistId) { projection = live.projection ?? null; state = live.status; }
    } catch { /* A revoked/unavailable source never falls back to a cached projection. */ }
    return { baseline, projection, state };
  }
  async function view(request: AccessRequest, selection: Selection) {
    const live = await loadLive(request, selection);
    return withStudent(request, selection, false, async (tx, actor, student) => {
      const value = await current(tx, actor.tenantId, selection.studentId);
      if (!value) return { state: "unscheduled" as const };
      if (!live.baseline || value.ceremony.id !== live.baseline.ceremony.id || value.ceremony.revision !== live.baseline.ceremony.revision) return { state: "stale" as const };
      const staff = actor.mode === "admin" || actor.mode === "tutor";
      const [schedule]=await tx.select({slot:s.student.serviceSlot}).from(s.student).where(and(eq(s.student.tenantId,actor.tenantId),eq(s.student.id,student.id)));
      const matches=live.projection?.localDate===student.ceremonyDate && live.projection?.ceremonyType===schedule.slot;
      const previous=await tx.select().from(s.studentServicePart).where(and(eq(s.studentServicePart.tenantId,actor.tenantId),eq(s.studentServicePart.studentId,selection.studentId),ne(s.studentServicePart.ceremonyId,value.ceremony.id)));
      const previousWork=previous.map(part=>({id:part.id,progress:part.progress,directions:part.directions,...(staff?{privateFeedback:part.privateFeedback}:{})}));
      const base = { ceremony: { id: value.ceremony.id,revision:value.ceremony.revision,date: student.ceremonyDate, type: schedule.slot,
        connectedDate: live.projection?.localDate ?? value.ceremony.localDate, needsReconciliation: value.link.needsReconciliation && !matches,scheduleConflict:value.ceremony.scheduleConflict },
        previousWork,...(staff ? {setlistId:value.ceremony.setlistId,candidates: value.ceremony.candidates, retry: { attempts: value.ceremony.attempts, nextAttemptAt: value.ceremony.nextAttemptAt.toISOString() } } : {}) };
      if (!live.projection) return { ...base, state: value.ceremony.setlistId ? "unavailable" as const : value.ceremony.state };
      if (live.state === "review_required") return { ...base, state: "review_required" as const, ...(staff ? { operatorLinks: live.projection.operatorLinks } : {}) };
      const assigned = await tx.select().from(s.studentServicePart).where(and(eq(s.studentServicePart.tenantId, actor.tenantId), eq(s.studentServicePart.studentId, selection.studentId), eq(s.studentServicePart.ceremonyId, value.ceremony.id)));
      const requests = await tx.select().from(s.servicePartRequest).where(and(eq(s.servicePartRequest.tenantId, actor.tenantId), eq(s.servicePartRequest.studentId, selection.studentId), eq(s.servicePartRequest.ceremonyId, value.ceremony.id)));
      const projection = live.projection;
      const learning = (actor.mode === "student" || actor.mode === "child-practice") && matches && !value.ceremony.scheduleConflict;
      const catalogs = learning ? await availableCatalogs(tx, actor.tenantId, assigned) : new Set<string>();
      const parts = assigned.map(part => { const row = projection.rows.find(row => row.rowId === part.rowId); return {
        rowId: part.rowId, leads: part.leads, directions: part.directions, progress: part.progress, revision: part.revision,
        catalogId:part.catalogId,catalogIdentity:part.catalogIdentity,catalogUnitId:part.catalogUnitId,
        ...(staff || actor.mode === "student" ? { privateFeedback: part.privateFeedback } : {}),
        resourceNeedsReview: !row || resourceIdentity(row) !== part.resourceIdentity, unresolved: !row,
        ...(learning ? { lesson: partLesson(actor.tenantId, projection, part, row, catalogs) } : {}),
      }; });
      return { ...base, state: "linked" as const, sourceRevision: projection.sourceRevision,
        rows: [...projection.rows].sort((a, b) => a.order - b.order).map(row => ({ rowId: row.rowId, title: row.title, order: row.order, prayerId: row.prayerId, biblicalRef: row.biblicalRef, edition: row.edition,
          catalogUnitId: assigned.find(part=>part.rowId===row.rowId && part.resourceIdentity===resourceIdentity(row))?.catalogUnitId ?? undefined, liturgyRef: row.liturgyRef, sharedDirections: row.sharedDirections,
          resources: row.resources.filter(r => r.kind !== "audio" || staff || input.studentAudioRelease), arrangementResolved: Boolean(row.arrangement?.songId || row.arrangement?.fileId) })),
        parts,requests: requests.map(r => ({ id: r.id, rowId: r.rowId, message: r.message, response: r.response, state: r.state, revision: r.revision })),
        ...(staff ? { operatorLinks: projection.operatorLinks } : {}),
      };
    });
  }
  async function lesson(request: CookieMutationRequest, selection: Selection & { rowId: string; key: string; lessonId: string; complete: boolean }) {
    if (selection.mode !== "student" && selection.mode !== "child-practice" || !/^[0-9a-f]{64}$/.test(selection.key)) throw new AccessDenied(403);
    const rowId = bounded(selection.rowId, 128, false);
    const live = await loadLive(request, selection);
    return withStudent(request, selection, false, async (tx, actor, student) => {
      requireCookieMutation(request, actor.origin);
      const currentService = await current(tx, actor.tenantId, student.id, selection.complete);
      const projection = live.projection;
      if (!currentService || live.state !== "linked" || !projection || currentService.ceremony.id !== live.baseline?.ceremony.id
        || currentService.ceremony.revision !== live.baseline.ceremony.revision || currentService.ceremony.scheduleConflict
        || projection.localDate !== student.ceremonyDate || projection.ceremonyType !== student.serviceSlot) return stale();
      const where = and(eq(s.studentServicePart.tenantId, actor.tenantId), eq(s.studentServicePart.studentId, student.id),
        eq(s.studentServicePart.ceremonyId, currentService.ceremony.id), eq(s.studentServicePart.rowId, rowId));
      const query = tx.select().from(s.studentServicePart).where(where);
      const [part] = await (selection.complete ? query.for("update") : query.for("share"));
      const row = projection.rows.find(row => row.rowId === rowId);
      if (!part) return stale();
      const target = partLesson(actor.tenantId, projection, part, row, await availableCatalogs(tx, actor.tenantId, [part]));
      if (!target || target.id !== selection.lessonId || target.key !== selection.key) return stale();
      if (selection.complete && !target.finished) await tx.update(s.studentServicePart).set({ lessonFinishedFor: target.key }).where(where);
      return { ok: true as const, slot: projection.ceremonyType };
    }, selection.complete);
  }
  async function assign(request: CookieMutationRequest, selection: Selection & { rowId: string; expectedRevision: number; expectedStudentRevision:number; sourceRevision:string; leads: boolean; directions: string; privateFeedback: string; material?:{catalogId:string;catalogIdentity:string;unitId:string}|null }) {
    const rowId = bounded(selection.rowId, 128, false), expected = selection.expectedRevision;
    if (!Number.isSafeInteger(expected) || expected < 0 || typeof selection.leads !== "boolean") throw new AccessDenied(403);
    const directions = bounded(selection.directions, 4000), privateFeedback = bounded(selection.privateFeedback, 4000);
    const live = await loadLive(request, selection);
    return withStudent(request, selection, true, async (tx, actor, student) => {
      const value = await current(tx, actor.tenantId, selection.studentId), row = live.projection?.rows.find(row => row.rowId === rowId);
      if (!value || !row || value.ceremony.id !== live.baseline?.ceremony.id) throw new AccessUnavailable();
      if(student.revision!==revision(selection.expectedStudentRevision) || live.projection!.sourceRevision!==bounded(selection.sourceRevision,256,false))return stale();
      if(selection.material){identifier(selection.material.catalogId);bounded(selection.material.catalogIdentity,64,false);bounded(selection.material.unitId,128,false);await verifyCeremonyMaterialMapping(tx,actor.tenantId,value.ceremony.ceremonyType,selection.material);}
      const values = { leads: selection.leads, directions, privateFeedback, resourceIdentity: resourceIdentity(row),
        ...(selection.material===undefined ? {} : {catalogId:selection.material?.catalogId??null,catalogIdentity:selection.material?.catalogIdentity??null,catalogUnitId:selection.material?.unitId??null}) };
      const where = and(eq(s.studentServicePart.tenantId, actor.tenantId), eq(s.studentServicePart.studentId, selection.studentId), eq(s.studentServicePart.ceremonyId, value.ceremony.id), eq(s.studentServicePart.rowId, rowId));
      const [saved] = expected === 0 ? await tx.insert(s.studentServicePart).values({ ...values, tenantId: actor.tenantId, studentId: selection.studentId, ceremonyId: value.ceremony.id, rowId }).onConflictDoNothing().returning()
        : await tx.update(s.studentServicePart).set({ ...values, revision: expected + 1,
          ...(!selection.leads ? { lessonFinishedFor: null } : {}) }).where(and(where, eq(s.studentServicePart.revision, expected))).returning();
      return saved ? { ok: true as const } : stale();
    });
  }
  async function progress(request: CookieMutationRequest, selection: Selection & { rowId: string; expectedRevision: number; progress: "not-started" | "practicing" | "ready" }) {
    const rowId = bounded(selection.rowId, 128, false), expected = revision(selection.expectedRevision);
    if (!["not-started", "practicing", "ready"].includes(selection.progress)) throw new AccessDenied(403);
    return withStudent(request, selection, false, async (tx, actor) => {
      requireCookieMutation(request, actor.origin); if (actor.mode !== "student") throw new AccessDenied(403);
      const value = await current(tx, actor.tenantId, selection.studentId); if (!value) throw new AccessDenied(404);
      const [saved] = await tx.update(s.studentServicePart).set({ progress: selection.progress, revision: expected + 1 }).where(and(eq(s.studentServicePart.tenantId, actor.tenantId), eq(s.studentServicePart.studentId, selection.studentId), eq(s.studentServicePart.ceremonyId, value.ceremony.id), eq(s.studentServicePart.rowId, rowId), eq(s.studentServicePart.revision, expected))).returning();
      return saved ? { ok: true as const } : stale();
    });
  }
  async function requestChange(request: CookieMutationRequest, selection: Selection & { rowId: string; message: string }) {
    const rowId = bounded(selection.rowId, 128, false), message = bounded(selection.message, 2000, false);
    const live = await loadLive(request, selection);
    return withStudent(request, selection, false, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      if (actor.mode !== "student" && actor.mode !== "parent" && actor.mode!=="child-practice") throw new AccessDenied(403);
      const value = await current(tx, actor.tenantId, selection.studentId);
      const row = live.projection?.rows.find(row => row.rowId === rowId);
      if (!value || !row || value.ceremony.id !== live.baseline?.ceremony.id) throw new AccessUnavailable();
      const [saved] = await tx.insert(s.servicePartRequest).values({ tenantId: actor.tenantId, studentId: selection.studentId, ceremonyId: value.ceremony.id, rowId, message, sourceRevision: live.projection!.sourceRevision,
        requestedResourceIdentity: resourceIdentity(row) }).returning();
      return { ok: true as const, id: saved.id };
    });
  }
  async function respond(request: CookieMutationRequest, selection: Selection & { requestId: string; expectedRevision: number; state: "accepted" | "declined"; response: string }) {
    const requestId = identifier(selection.requestId), expected = revision(selection.expectedRevision), response = bounded(selection.response, 2000);
    if (selection.state !== "accepted" && selection.state !== "declined") throw new AccessDenied(403);
    // Staff changes music in the authorized source editor. Acceptance requires a fresh source reread.
    const live = selection.state === "accepted" ? await loadLive(request, selection) : null;
    return withStudent(request, selection, true, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId); if (!value) throw new AccessDenied(404);
      const where = and(eq(s.servicePartRequest.tenantId, actor.tenantId), eq(s.servicePartRequest.studentId, selection.studentId), eq(s.servicePartRequest.ceremonyId, value.ceremony.id), eq(s.servicePartRequest.id, requestId));
      const [pending] = await tx.select().from(s.servicePartRequest).where(where);
      if (!pending || pending.state !== "pending" || pending.revision !== expected) return stale();
      if (selection.state === "accepted") {
        const row = live?.projection?.rows.find(row => row.rowId === pending.rowId);
        if (!row || live!.projection!.sourceRevision === pending.sourceRevision || resourceIdentity(row) === pending.requestedResourceIdentity) return { ok: false as const, code: "source-change-required" as const };
      }
      const [saved] = await tx.update(s.servicePartRequest).set({ response, state: selection.state, revision: expected + 1 }).where(and(where, eq(s.servicePartRequest.revision, expected), eq(s.servicePartRequest.state, "pending"))).returning();
      return saved ? { ok: true as const } : stale();
    });
  }
  async function resource(request: CookieMutationRequest, selection: Selection & { rowId: string; resourceId: string }) {
    const rowId = bounded(selection.rowId, 128, false), resourceId = bounded(selection.resourceId, 128, false);
    const live = await loadLive(request, selection), row = live.projection?.rows.find(row => row.rowId === rowId);
    if (!row?.resources.some(r => r.resourceId === resourceId) || !live.baseline) throw new AccessUnavailable();
    if (row.resources.find(r => r.resourceId === resourceId)?.kind === "audio" && selection.mode !== "admin" && selection.mode !== "tutor" && !input.studentAudioRelease) throw new AccessUnavailable();
    const result = await input.broker.resource(live.baseline.ceremony.id, rowId, resourceId);
    // A resource can be reapproved between projection and ticket issuance. Check the final grant too.
    if(result.kind!==row.resources.find(r=>r.resourceId===resourceId)!.kind || result.kind==="audio" && selection.mode!=="admin" && selection.mode!=="tutor" && !input.studentAudioRelease)throw new AccessUnavailable();
    return withStudent(request, selection, false, async (tx, actor) => {
      requireCookieMutation(request, actor.origin);
      const value = await current(tx, actor.tenantId, selection.studentId);
      if (!value || value.ceremony.id !== live.baseline!.ceremony.id) throw new AccessUnavailable();
      return result;
    });
  }
  async function materialMapping(request: AccessRequest, selection: Selection & { rowId: string }) {
    const rowId = bounded(selection.rowId, 128, false), live = await loadLive(request, selection);
    return withStudent(request, selection, false, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId), row = live.projection?.rows.find(row => row.rowId === rowId);
      if (!value || !row || value.ceremony.id !== live.baseline?.ceremony.id || live.state !== "linked") throw new AccessUnavailable();
      const [part]=await tx.select().from(s.studentServicePart).where(and(eq(s.studentServicePart.tenantId,actor.tenantId),eq(s.studentServicePart.studentId,selection.studentId),eq(s.studentServicePart.ceremonyId,value.ceremony.id),eq(s.studentServicePart.rowId,rowId)));
      if(!part?.catalogId || !part.catalogIdentity || !part.catalogUnitId || part.resourceIdentity!==resourceIdentity(row))throw new AccessUnavailable();
      return { unitId: part.catalogUnitId, ceremonyType: value.ceremony.ceremonyType,catalogId:part.catalogId,catalogIdentity:part.catalogIdentity };
    });
  }
  async function separate(request:CookieMutationRequest,selection:Selection&{expectedCeremonyRevision:number}){
    const expected=revision(selection.expectedCeremonyRevision);
    const result=await withStudent(request,selection,true,async(tx,actor,student)=>{
      const value=await current(tx,actor.tenantId,selection.studentId,true);
      if(value){const [locked]=await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId,actor.tenantId),eq(s.serviceCeremony.id,value.ceremony.id))).for("update");value.ceremony=locked;}
      if(!value || !value.ceremony.scheduleConflict || value.ceremony.revision!==expected)return stale();
      if(!value.ceremony.setlistId)throw new AccessUnavailable();
      const [schedule]=await tx.select({slot:s.student.serviceSlot}).from(s.student).where(and(eq(s.student.tenantId,actor.tenantId),eq(s.student.id,student.id)));
      if(schedule.slot==="unknown")throw new AccessDenied(403);
      // The explicit separation is local to this student. Previous work remains on its original ceremony.
      const id=randomUUID();const [target]=await tx.insert(s.serviceCeremony).values({id,tenantId:actor.tenantId,excludedSetlistId:value.ceremony.setlistId,scheduleKey:`separate-${id}`,localDate:student.ceremonyDate,ceremonyType:schedule.slot,requestedDate:student.ceremonyDate,requestedType:schedule.slot}).returning();
      await tx.update(s.studentCeremony).set({ceremonyId:target.id,needsReconciliation:false}).where(and(eq(s.studentCeremony.tenantId,actor.tenantId),eq(s.studentCeremony.studentId,student.id),eq(s.studentCeremony.ceremonyId,value.ceremony.id)));
      const [remaining]=await tx.select({id:s.student.id,ceremonyDate:s.student.ceremonyDate,serviceSlot:s.student.serviceSlot}).from(s.studentCeremony).innerJoin(s.student,and(eq(s.student.tenantId,s.studentCeremony.tenantId),eq(s.student.id,s.studentCeremony.studentId))).where(and(eq(s.studentCeremony.tenantId,actor.tenantId),eq(s.studentCeremony.ceremonyId,value.ceremony.id),isNull(s.student.disabledAt))).limit(1);
      if(remaining)await scheduleCeremony(tx,actor.tenantId,remaining);
      return {ok:true as const};
    });
    if(result.ok)try{await input.dispatchScheduled?.();}catch{/* Daily drain retains queued work. */}
    return result;
  }
  async function resolveOriginal(request:CookieMutationRequest,selection:Selection&{expectedCeremonyRevision:number}){
    const expected=revision(selection.expectedCeremonyRevision);
    const result=await withStudent(request,selection,true,async(tx,actor)=>{
      const value=await current(tx,actor.tenantId,selection.studentId,true);
      if(!value || !value.ceremony.scheduleConflict || value.ceremony.setlistId || value.ceremony.revision!==expected)return stale();
      const [saved]=await tx.update(s.serviceCeremony).set({requestedDate:value.ceremony.localDate,requestedType:value.ceremony.ceremonyType,originalConnectionPending:true,
        scheduleRevision:sql`${s.serviceCeremony.scheduleRevision}+1`,revision:sql`${s.serviceCeremony.revision}+1`,state:"pending",nextAttemptAt:new Date()}).where(and(eq(s.serviceCeremony.tenantId,actor.tenantId),eq(s.serviceCeremony.id,value.ceremony.id),eq(s.serviceCeremony.revision,expected))).returning();
      return saved?{ok:true as const}:stale();
    });
    if(result.ok)try{await input.dispatchScheduled?.();}catch{/* Original intent remains queued for the daily drain. */}
    return result;
  }
  return Object.freeze({ synchronize, view, lesson, assign, progress, requestChange, respond, resource, materialMapping,separate,resolveOriginal });
}
