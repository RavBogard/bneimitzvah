import "server-only";
import { and, eq, sql,ne,isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction, ActiveMode } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import { requireCookieMutation, type CookieMutationRequest } from "../http/mutations";
import { digest } from "../students/bindings";
import { identifier, revision } from "../students/validation";
import * as s from "../db/index";
import type { MusicBroker, MusicProjection, MusicRow } from "./contract";
import { verifyCeremonyMaterialMapping } from "../service-learning/service";
import { ensureIntent } from "./intent";
import { scheduleCeremony } from "./scheduling";

type Selection = { studentId: string; mode: ActiveMode };
const bounded = (value: unknown, max: number, empty = true) => {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new AccessDenied(403);
  return value.trim();
};
export const resourceIdentity = (row: MusicRow) => digest([row.prayerId,row.momentId, row.biblicalRef, row.edition, row.textIdentity, row.catalogUnitId, row.liturgyRef, row.arrangement, row.resources]);
const stale = () => ({ ok: false as const, code: "stale-revision" as const });
export function createServiceEcosystemService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; broker: MusicBroker; studentAudioRelease?: boolean;dispatchScheduled?:()=>void }) {
  const withStudent = <T>(request: AccessRequest, selection: Selection, staff: boolean, action: Parameters<typeof input.access.withStudentCapability<T>>[2]) => {
    identifier(selection.studentId);
    return input.access.withStudentCapability(request, { ...selection, capability: staff ? "set-service-plan" : "read" }, async (tx, actor, student) => {
      // The dedicated source credential is bound to CRC, never to arbitrary tenant membership.
      if (actor.tenantId !== "crc") throw new AccessDenied(404);
      return action(tx, actor, student);
    });
  };
  async function current(tx: AccessTransaction<Q>, tenantId: string, studentId: string) {
    const [value] = await tx.select({ link: s.studentCeremony, ceremony: s.serviceCeremony }).from(s.studentCeremony)
      .innerJoin(s.serviceCeremony, and(eq(s.serviceCeremony.tenantId, s.studentCeremony.tenantId), eq(s.serviceCeremony.id, s.studentCeremony.ceremonyId)))
      .where(and(eq(s.studentCeremony.tenantId, tenantId), eq(s.studentCeremony.studentId, studentId)));
    return value ?? null;
  }
  async function synchronize(request: CookieMutationRequest, selection: Selection & { explicitSetlistId?: string }) {
    const baseline = await withStudent(request, selection, true, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId);
      if (selection.explicitSetlistId !== undefined && (!value || !value.ceremony.candidates.includes(bounded(selection.explicitSetlistId, 128, false)))) throw new AccessDenied(403);
      return value;
    });
    if (!baseline) return { ok: true as const, state: "unscheduled" as const };
    let result;
    try {
      result = baseline.ceremony.scheduleConflict
        ? await input.broker.projection(baseline.ceremony.id)
        : await input.broker.ensure(ensureIntent(baseline.ceremony,selection.explicitSetlistId));
    } catch { result = null; }
    return withStudent(request, selection, true, async (tx, actor) => {
      const value = await current(tx, actor.tenantId, selection.studentId);
      if (!value || value.ceremony.id !== baseline.ceremony.id || value.ceremony.revision !== baseline.ceremony.revision) return stale();
      const state = result?.status ?? "unavailable";
      if (result && result.status !== "ambiguous" && result.setlistId && baseline.ceremony.setlistId && result.setlistId !== baseline.ceremony.setlistId) throw new AccessUnavailable();
      const [saved] = await tx.update(s.serviceCeremony).set({ state,
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
      const base = { ceremony: { id: value.ceremony.id,revision:value.ceremony.revision,date: student.ceremonyDate, type: schedule.slot,
        connectedDate: live.projection?.localDate ?? value.ceremony.localDate, needsReconciliation: value.link.needsReconciliation && !matches,scheduleConflict:value.ceremony.scheduleConflict },
        ...(staff ? {setlistId:value.ceremony.setlistId,candidates: value.ceremony.candidates, retry: { attempts: value.ceremony.attempts, nextAttemptAt: value.ceremony.nextAttemptAt.toISOString() } } : {}) };
      if (!live.projection) return { ...base, state: value.ceremony.setlistId ? "unavailable" as const : value.ceremony.state };
      if (live.state === "review_required") return { ...base, state: "review_required" as const, ...(staff ? { operatorLinks: live.projection.operatorLinks } : {}) };
      const assigned = await tx.select().from(s.studentServicePart).where(and(eq(s.studentServicePart.tenantId, actor.tenantId), eq(s.studentServicePart.studentId, selection.studentId), eq(s.studentServicePart.ceremonyId, value.ceremony.id)));
      const requests = await tx.select().from(s.servicePartRequest).where(and(eq(s.servicePartRequest.tenantId, actor.tenantId), eq(s.servicePartRequest.studentId, selection.studentId), eq(s.servicePartRequest.ceremonyId, value.ceremony.id)));
      const previousWork=await tx.select({id:s.studentServicePart.id,progress:s.studentServicePart.progress}).from(s.studentServicePart).where(and(eq(s.studentServicePart.tenantId,actor.tenantId),eq(s.studentServicePart.studentId,selection.studentId),ne(s.studentServicePart.ceremonyId,value.ceremony.id)));
      const projection = live.projection;
      const parts = assigned.map(part => { const row = projection.rows.find(row => row.rowId === part.rowId); return {
        rowId: part.rowId, leads: part.leads, directions: part.directions, progress: part.progress, revision: part.revision,
        catalogId:part.catalogId,catalogIdentity:part.catalogIdentity,catalogUnitId:part.catalogUnitId,
        ...(staff || actor.mode === "student" ? { privateFeedback: part.privateFeedback } : {}),
        resourceNeedsReview: !row || resourceIdentity(row) !== part.resourceIdentity, unresolved: !row,
      }; });
      return { ...base, state: "linked" as const, sourceRevision: projection.sourceRevision,
        rows: projection.rows.map(row => ({ rowId: row.rowId, title: row.title, order: row.order, prayerId: row.prayerId, biblicalRef: row.biblicalRef, edition: row.edition,
          catalogUnitId: assigned.find(part=>part.rowId===row.rowId && part.resourceIdentity===resourceIdentity(row))?.catalogUnitId ?? undefined, liturgyRef: row.liturgyRef, sharedDirections: row.sharedDirections,
          resources: row.resources.filter(r => r.kind !== "audio" || staff || input.studentAudioRelease), arrangementResolved: Boolean(row.arrangement?.songId || row.arrangement?.fileId) })),
        parts,previousWork,requests: requests.map(r => ({ id: r.id, rowId: r.rowId, message: r.message, response: r.response, state: r.state, revision: r.revision })),
        ...(staff ? { operatorLinks: projection.operatorLinks } : {}),
      };
    });
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
        : await tx.update(s.studentServicePart).set({ ...values, revision: expected + 1 }).where(and(where, eq(s.studentServicePart.revision, expected))).returning();
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
      if (actor.mode !== "student" && actor.mode !== "parent") throw new AccessDenied(403);
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
      const value=await current(tx,actor.tenantId,selection.studentId);
      if(!value || !value.ceremony.scheduleConflict || value.ceremony.revision!==expected)return stale();
      const [schedule]=await tx.select({slot:s.student.serviceSlot}).from(s.student).where(and(eq(s.student.tenantId,actor.tenantId),eq(s.student.id,student.id)));
      if(schedule.slot==="unknown")throw new AccessDenied(403);
      const key=`${student.ceremonyDate}-${schedule.slot}`;
      // The explicit separation is local to this student. Previous work remains on its original ceremony.
      let [target]=await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId,actor.tenantId),eq(s.serviceCeremony.scheduleKey,key)));
      if(!target || target.id===value.ceremony.id){const id=randomUUID();[target]=await tx.insert(s.serviceCeremony).values({id,tenantId:actor.tenantId,scheduleKey:target?`separate-${id}`:key,localDate:student.ceremonyDate,ceremonyType:schedule.slot,requestedDate:student.ceremonyDate,requestedType:schedule.slot}).onConflictDoNothing().returning();
        if(!target)[target]=await tx.select().from(s.serviceCeremony).where(and(eq(s.serviceCeremony.tenantId,actor.tenantId),eq(s.serviceCeremony.scheduleKey,key)));}
      await tx.update(s.studentCeremony).set({ceremonyId:target.id,needsReconciliation:false}).where(and(eq(s.studentCeremony.tenantId,actor.tenantId),eq(s.studentCeremony.studentId,student.id),eq(s.studentCeremony.ceremonyId,value.ceremony.id)));
      const [remaining]=await tx.select({id:s.student.id,ceremonyDate:s.student.ceremonyDate,serviceSlot:s.student.serviceSlot}).from(s.studentCeremony).innerJoin(s.student,and(eq(s.student.tenantId,s.studentCeremony.tenantId),eq(s.student.id,s.studentCeremony.studentId))).where(and(eq(s.studentCeremony.tenantId,actor.tenantId),eq(s.studentCeremony.ceremonyId,value.ceremony.id),isNull(s.student.disabledAt))).limit(1);
      if(remaining)await scheduleCeremony(tx,actor.tenantId,remaining);
      return {ok:true as const};
    });
    if(result.ok)try{input.dispatchScheduled?.();}catch{/* Daily drain retains queued work. */}
    return result;
  }
  return Object.freeze({ synchronize, view, assign, progress, requestChange, respond, resource, materialMapping,separate });
}
