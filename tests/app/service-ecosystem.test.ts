import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import * as s from "../../src/server/db/index";
import { createStudentService } from "../../src/server/students/service";
import { createServiceEcosystemService } from "../../src/server/service-ecosystem/service";
import { scheduleCeremony } from "../../src/server/service-ecosystem/scheduling";
import type { MusicBroker, MusicProjection, MusicResult } from "../../src/server/service-ecosystem/contract";
import { AccessDenied, AccessUnavailable } from "../../src/server/access/errors";
import { createServiceScheduler } from "../../src/server/service-ecosystem/scheduler";
import { syntheticServiceCatalog } from "../helpers/service-learning";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
async function fixture() {
  const f = await accessFixture(); open.push(f);
  let projection: MusicProjection = { setlistId: "synthetic-set", sourceRevision: "revision-1", localDate: "2027-01-02", ceremonyType: "morning", operatorLinks: { music: "https://music.example.test/setlists/synthetic-set" },
    rows: [{ rowId: "stable-part", order: 0, title: "Synthetic service part", prayerId: "synthetic-prayer", edition: "synthetic-edition", textIdentity: "text-1", arrangement: { songId: "synthetic-song", fileId: "synthetic-score" }, resources: [{ resourceId: "synthetic-resource", kind: "score", label: "Synthetic score" }] }] };
  let available = true, ambiguous = false;
  const linked = (): MusicResult => { if (!available) throw new AccessUnavailable(); return { version: 1, status: "linked", setlistId: projection.setlistId, sourceRevision: projection.sourceRevision, projection: structuredClone(projection) }; };
  const broker: MusicBroker = { ensure: vi.fn(async (input): Promise<MusicResult> => { if (!available) throw new AccessUnavailable(); if (ambiguous && !input.explicitSetlistId) return { version: 1, status: "ambiguous", candidates: [{ setlistId: "synthetic-set" }, { setlistId: "synthetic-other" }] }; return linked(); }),
    projection: vi.fn(async () => linked()), resource: vi.fn(async (_ceremony, _row, resourceId) => { if (!available) throw new AccessUnavailable(); return { resourceId, kind: "score" as const, url: "https://music.example.test/api/scoped/synthetic", expiresAt: new Date(Date.now() + 60000).toISOString() }; }) };
  const service = createServiceEcosystemService({ access: f.service, broker });
  const students = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), loadReading: async () => { throw new Error("Synthetic calendar unused"); }, afterSchedule: service.synchronize });
  const mutation = (who: "admin" | "multi" | "learner" = "admin", origin = "http://localhost:3000") => ({ ...f.request(who, "http://localhost:3000", { origin }), method: "POST" });
  const selection = { studentId: f.students[0].id, mode: "admin" as const };
  async function scheduled(index = 0) { await f.service.withStudentCapability(mutation(), { studentId: f.students[index].id, mode: "admin", capability: "set-service-plan" }, async (tx, actor) => {
    await tx.update(s.student).set({ ceremonyDate: "2027-01-02", serviceSlot: "morning" }).where(eq(s.student.id, f.students[index].id));
    await scheduleCeremony(tx, actor.tenantId, { id: f.students[index].id, ceremonyDate: "2027-01-02", serviceSlot: "morning" });
  }); }
  const assign = () => service.assign(mutation(), { ...selection, rowId: "stable-part", expectedRevision: 0, expectedStudentRevision:1,sourceRevision:projection.sourceRevision,leads: true, directions: "Synthetic student directions", privateFeedback: "Synthetic private feedback" });
  return { ...f, broker, ecosystem: service, studentsService: students, mutation, selection, scheduled, assign,
    unavailable: () => { available = false; }, restore: () => { available = true; }, ambiguous: () => { ambiguous = true; }, change: (next: Partial<MusicProjection>) => { projection = { ...projection, ...next }; }, projection: () => structuredClone(projection) };
}
async function denied(action: () => Promise<unknown>, status: number) { try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; } }

test("manual morning/Havdalah scheduling and quiet intake enqueue automatically, with no existing roster backfill", async () => {
  const f = await fixture();
  expect(await f.owner(() => f.db.select().from(s.studentCeremony))).toEqual([]);
  for (const serviceSlot of ["morning", "havdalah"] as const) await f.studentsService.create(f.mutation(), { mode: "admin", student: { firstName: "Synthetic", lastName: serviceSlot, ceremonyDate: "2027-02-06", serviceSlot, parentEmail: "synthetic@example.test" } });
  expect(f.broker.ensure).toHaveBeenCalledTimes(2);
  expect(vi.mocked(f.broker.ensure).mock.calls.map(([input]) => input.ceremonyType)).toEqual(["morning", "havdalah"]);
  const csv = "firstName,lastName,ceremonyDate,parentEmail,ownEmail,service_slot,parashah,tutor,parent1_name,household_phone,parent2_name,parent2_email,hebrew_name,notes\nSynthetic,Quiet,2027-03-06,synthetic@example.test,,havdalah,,,,,,,,";
  const review = await f.studentsService.previewImport(f.mutation(), { mode: "admin", csv, allowDuplicates: false });
  expect(review.canConfirm).toBe(true);
  expect((await f.studentsService.confirmImport(f.mutation(), { mode: "admin", csv, allowDuplicates: false, binding: review.binding! })).ok).toBe(true);
  expect(f.broker.ensure).toHaveBeenCalledTimes(3);
  expect(await f.owner(() => f.db.select().from(s.studentCeremony))).toHaveLength(3);
  expect(f.delivered).toHaveLength(3); // Only synthetic fixture sign-ins; intake sent no mail.
});

test("connector failure retains committed roster, durable key and retry; unknown/past schedules do not create", async () => {
  const f = await fixture(); f.unavailable();
  const created = await f.studentsService.create(f.mutation(), { mode: "admin", student: { firstName: "Synthetic", lastName: "Retry", ceremonyDate: "2027-04-03", serviceSlot: "morning", parentEmail: "synthetic@example.test" } });
  expect(await f.owner(() => f.db.select().from(s.student).where(eq(s.student.id, created.id)))).toHaveLength(1);
  expect((await f.owner(() => f.db.select().from(s.serviceCeremony)))[0].state).toBe("unavailable");
  f.restore(); await f.ecosystem.synchronize(f.mutation(), { mode: "admin", studentId: created.id });
  expect(vi.mocked(f.broker.ensure).mock.calls[0][0].idempotencyKey).toBe(vi.mocked(f.broker.ensure).mock.calls[1][0].idempotencyKey);
  for (const [ceremonyDate, serviceSlot] of [["2027-05-01", "unknown"], ["2020-01-04", "morning"]]) await f.studentsService.create(f.mutation(), { mode: "admin", student: { firstName: "Synthetic", lastName: "Incomplete", ceremonyDate, serviceSlot, parentEmail: "synthetic@example.test" } });
  expect(f.broker.ensure).toHaveBeenCalledTimes(2);
});

test("joint students share ceremony while assignments and progress remain individual; rescheduling preserves source link", async () => {
  const f = await fixture(); await f.scheduled(); await f.scheduled(1);
  const links = await f.owner(() => f.db.select().from(s.studentCeremony)); expect(new Set(links.map(l => l.ceremonyId)).size).toBe(1);
  await f.ecosystem.synchronize(f.mutation(), f.selection); await f.assign();
  expect(await f.ecosystem.progress(f.mutation("learner"), { ...f.selection, mode: "student", rowId: "stable-part", expectedRevision: 1, progress: "ready" })).toEqual({ ok: true });
  const other = await f.ecosystem.view(f.request("admin"), { ...f.selection, studentId: f.students[1].id });
  expect(other.state).toBe("linked"); if (other.state === "linked" && "parts" in other) expect(other.parts).toEqual([]);
  const student = (await f.owner(() => f.db.select().from(s.student).where(eq(s.student.id, f.selection.studentId))))[0];
  await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: student.id, expectedRevision: student.revision, student: { firstName: student.firstName, lastName: student.lastName, ceremonyDate: "2027-06-05", serviceSlot: "havdalah", studentKind: "child", parentEmail: "synthetic@example.test" } });
  const view = await f.ecosystem.view(f.request("learner"), { ...f.selection, mode: "student" });
  expect(view.state).toBe("linked"); if (view.state === "linked" && "parts" in view) { expect(view.ceremony.needsReconciliation).toBe(true); expect(view.parts[0].progress).toBe("ready"); }
  expect(f.broker.ensure).toHaveBeenCalledTimes(1);
});

test("ambiguity requires explicit staff choice and retries preserve durable ceremony identity", async () => {
  const f = await fixture(); await f.scheduled(); f.ambiguous();
  expect(await f.ecosystem.synchronize(f.mutation(), f.selection)).toEqual({ ok: true, state: "ambiguous" });
  expect(await denied(() => f.ecosystem.synchronize(f.mutation("multi"), { ...f.selection, mode: "parent", explicitSetlistId: "synthetic-set" }), 403)).toBe(true);
  expect(await denied(() => f.ecosystem.synchronize(f.mutation(), { ...f.selection, explicitSetlistId: "unlisted" }), 403)).toBe(true);
  expect(await f.ecosystem.synchronize(f.mutation(), { ...f.selection, explicitSetlistId: "synthetic-set" })).toEqual({ ok: true, state: "linked" });
  expect(vi.mocked(f.broker.ensure).mock.calls[0][0].ceremonyId).toBe(vi.mocked(f.broker.ensure).mock.calls[1][0].ceremonyId);
});

test("guardian projection hides private feedback, foreign/unrelated and wrong-origin mutations fail closed", async () => {
  const f = await fixture(); await f.scheduled(); await f.ecosystem.synchronize(f.mutation(), f.selection); await f.assign();
  const guardian = await f.ecosystem.view(f.request("multi"), { ...f.selection, mode: "parent" });
  expect(JSON.stringify(guardian)).not.toContain("private feedback"); expect(JSON.stringify(guardian)).not.toContain("operatorLinks");
  expect(await denied(() => f.ecosystem.view(f.request("multi"), { ...f.selection, mode: "parent", studentId: f.students[2].id }), 404)).toBe(true);
  expect(await denied(() => f.ecosystem.view(f.request("admin"), { ...f.selection, studentId: f.students[3].id }), 404)).toBe(true);
  expect(await denied(() => f.ecosystem.requestChange(f.mutation("multi", "https://foreign.example.test"), { ...f.selection, mode: "parent", rowId: "stable-part", message: "Synthetic request" }), 403)).toBe(true);
  expect(await denied(() => f.ecosystem.progress(f.mutation("multi"), { ...f.selection, mode: "parent", rowId: "stable-part", expectedRevision: 1, progress: "ready" }), 403)).toBe(true);
  await f.owner(() => f.db.execute(sql`update guardian set revoked_at=now(),revision=revision+1 where student_id=${f.selection.studentId}`));
  expect(await denied(() => f.ecosystem.view(f.request("multi"), { ...f.selection, mode: "parent" }), 404)).toBe(true);
});

test("reorder preserves progress; changed identities flag resources and deleted rows retain unresolved work", async () => {
  const f = await fixture(); await f.scheduled(); await f.ecosystem.synchronize(f.mutation(), f.selection); await f.assign();
  await f.ecosystem.progress(f.mutation("learner"), { ...f.selection, mode: "student", rowId: "stable-part", expectedRevision: 1, progress: "ready" });
  f.change({ sourceRevision: "revision-2", rows: f.projection().rows.map(row => ({ ...row, order: 3 })) });
  let view = await f.ecosystem.view(f.request("learner"), { ...f.selection, mode: "student" });
  if (!("parts" in view)) throw new Error("Synthetic linked view missing");
  expect(view.parts[0]).toMatchObject({ progress: "ready", resourceNeedsReview: false });
  f.change({ sourceRevision: "revision-3", rows: f.projection().rows.map(row => ({ ...row, edition: "synthetic-revised-edition" })) });
  view = await f.ecosystem.view(f.request("learner"), { ...f.selection, mode: "student" });
  if (!("parts" in view)) throw new Error("Synthetic linked view missing"); expect(view.parts[0].resourceNeedsReview).toBe(true);
  f.change({ sourceRevision: "revision-4", rows: [] });
  view = await f.ecosystem.view(f.request("learner"), { ...f.selection, mode: "student" });
  if (!("parts" in view)) throw new Error("Synthetic linked view missing"); expect(view.parts[0]).toMatchObject({ progress: "ready", unresolved: true });
});

test("musical request stays pending until fresh authorized source change succeeds; revoked resources never use cache", async () => {
  const f = await fixture(); await f.scheduled(); await f.ecosystem.synchronize(f.mutation(), f.selection); await f.assign();
  const asked = await f.ecosystem.requestChange(f.mutation("multi"), { ...f.selection, mode: "parent", rowId: "stable-part", message: "Synthetic arrangement request" });
  const selection = { ...f.selection, requestId: asked.id, expectedRevision: 1, state: "accepted" as const, response: "Synthetic staff response" };
  expect(await f.ecosystem.respond(f.mutation(), selection)).toEqual({ ok: false, code: "source-change-required" });
  f.unavailable(); expect(await f.ecosystem.respond(f.mutation(), selection)).toEqual({ ok: false, code: "source-change-required" });
  expect((await f.ecosystem.view(f.request("learner"), { ...f.selection, mode: "student" })).state).toBe("unavailable");
  await expect(f.ecosystem.resource(f.mutation("learner"), { ...f.selection, mode: "student", rowId: "stable-part", resourceId: "synthetic-resource" })).rejects.toBeInstanceOf(AccessUnavailable);
  f.restore(); f.change({ sourceRevision: "revision-2", rows: f.projection().rows.map(row => ({ ...row, arrangement: { songId: "synthetic-new-song" } })) });
  expect(await f.ecosystem.respond(f.mutation(), selection)).toEqual({ ok: true });
});

test("bulk intake returns after one background dispatch without awaiting the connector and deduplicates joint ceremonies",async()=>{
  const f=await fixture(),dispatch=vi.fn();
  const students=createStudentService({access:f.service,signingSecret:randomBytes(48).toString("base64url"),loadReading:async()=>{throw new Error("Synthetic unused calendar");},dispatchScheduled:dispatch});
  const csv="firstName,lastName,ceremonyDate,parentEmail,ownEmail,service_slot,parashah,tutor,parent1_name,household_phone,parent2_name,parent2_email,hebrew_name,notes\n"+Array.from({length:80},(_,i)=>`Synthetic,Bulk${i},2027-08-07,synthetic@example.test,,morning,,,,,,,,`).join("\n");
  const preview=await students.previewImport(f.mutation(),{mode:"admin",csv,allowDuplicates:false});
  const saved=await students.confirmImport(f.mutation(),{mode:"admin",csv,allowDuplicates:false,binding:preview.binding!});
  expect(saved.ok).toBe(true);expect(dispatch).toHaveBeenCalledTimes(1);expect(f.broker.ensure).not.toHaveBeenCalled();
  expect(await f.owner(()=>f.db.select().from(s.serviceCeremony))).toHaveLength(1);
  expect(await f.owner(()=>f.db.select().from(s.studentCeremony))).toHaveLength(80);
});

test("concurrent drain leases prevent duplicate dispatch, source failure backs off, and expired leases recover",async()=>{
  const f=await fixture();await f.scheduled();let time=Date.now();
  let entered!:()=>void,release!:()=>void;
  const entry=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(f.broker.ensure).mockImplementationOnce(async()=>{entered();await barrier;return {version:1,status:"linked",setlistId:f.projection().setlistId,sourceRevision:f.projection().sourceRevision,projection:f.projection()};});
  const scheduler=createServiceScheduler({db:f.db,broker:f.broker,now:()=>time});
  const first=scheduler.run({maxJobs:1});await entry;
  expect(await scheduler.run({maxJobs:1})).toEqual({attempted:0,completed:0});release();expect(await first).toEqual({attempted:1,completed:1});
  expect(f.broker.ensure).toHaveBeenCalledTimes(1);
  f.unavailable();await f.owner(()=>f.db.update(s.serviceCeremony).set({state:"unavailable",leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(time)}));
  expect(await scheduler.run({maxJobs:1})).toEqual({attempted:1,completed:1});
  expect(await scheduler.run({maxJobs:1})).toEqual({attempted:0,completed:0});
  f.restore();time+=5*60000;
  await f.owner(()=>f.db.update(s.serviceCeremony).set({leaseToken:"00000000-0000-4000-8000-000000000001",leaseUntil:new Date(time-1)}));
  expect(await scheduler.run({maxJobs:1})).toEqual({attempted:1,completed:1});
});

test("scheduled drain requires a distinct server credential and rejects cookie or query authority",async()=>{
  const f=await fixture(),secret=randomBytes(48).toString("base64url"),scheduler=createServiceScheduler({db:f.db,broker:f.broker,cronSecret:secret});
  const request=(headers:Record<string,string>)=>({url:"http://localhost:3000/api/internal/service-ecosystem/drain",headers:new Headers(headers)});
  expect(await denied(()=>scheduler.drain(request({})),401)).toBe(true);
  expect(await denied(()=>scheduler.drain(request({authorization:`Bearer ${secret}`,cookie:"synthetic=forbidden"})),403)).toBe(true);
  expect(await scheduler.drain(request({authorization:`Bearer ${secret}`}))).toEqual({attempted:0,completed:0});
});

test("staff map a stable music row to an exact approved catalog unit; arbitrary/fuzzy IDs and stale revisions fail",async()=>{
  const f=await fixture();await f.scheduled();await f.ecosystem.synchronize(f.mutation(),f.selection);
  const content=syntheticServiceCatalog(),catalogId="00000000-0000-4000-8000-000000000025";
  await f.owner(async()=>{await f.db.insert(s.serviceCatalog).values({id:catalogId,tenantId:"crc",identity:content.identity,feedBytes:content.feedBytes,provenanceBytes:content.provenanceBytes,pins:content.pins});await f.db.insert(s.serviceCatalogLifecycle).values({tenantId:"crc",catalogId,state:"active"});});
  const selection={...f.selection,rowId:"stable-part",expectedRevision:0,expectedStudentRevision:1,sourceRevision:"revision-1",leads:true,directions:"Synthetic mapped text",privateFeedback:"",material:{catalogId,catalogIdentity:content.identity,unitId:content.first}};
  await expect(f.ecosystem.assign(f.mutation(),{...selection,material:{...selection.material,unitId:"invented-fuzzy-title"}})).rejects.toBeInstanceOf(AccessUnavailable);
  expect(await f.ecosystem.assign(f.mutation(),{...selection,sourceRevision:"stale-source"})).toEqual({ok:false,code:"stale-revision"});
  expect(await f.ecosystem.assign(f.mutation(),selection)).toEqual({ok:true});
  expect(await f.ecosystem.materialMapping(f.request("learner"),{...f.selection,mode:"student",rowId:"stable-part"})).toMatchObject({unitId:content.first,catalogId,catalogIdentity:content.identity});
  await f.owner(()=>f.db.update(s.serviceCatalogLifecycle).set({state:"withdrawn",revision:2}));
  const {createServiceLearningService}=await import("../../src/server/service-learning/service"),{createPracticeService}=await import("../../src/server/practice/service");
  const materials=createServiceLearningService({access:f.service,practice:createPracticeService({access:f.service}),signingSecret:randomBytes(48).toString("base64url"),resolveCeremonyUnit:f.ecosystem.materialMapping});
  await expect(materials.ceremonyUnit(f.request("learner"),{...f.selection,mode:"student",rowId:"stable-part"})).rejects.toBeInstanceOf(AccessUnavailable);
});

test("the reference listening hold also blocks source-projected audio for students and guardians",async()=>{
  const f=await fixture();await f.scheduled();await f.ecosystem.synchronize(f.mutation(),f.selection);
  f.change({rows:f.projection().rows.map(row=>({...row,resources:[...row.resources,{resourceId:"synthetic-audio",kind:"audio",label:"Synthetic held audio"}]}))});
  const student=await f.ecosystem.view(f.request("learner"),{...f.selection,mode:"student"});expect(JSON.stringify(student)).not.toContain("synthetic-audio");
  await expect(f.ecosystem.resource(f.mutation("learner"),{...f.selection,mode:"student",rowId:"stable-part",resourceId:"synthetic-audio"})).rejects.toBeInstanceOf(AccessUnavailable);
  expect(f.broker.resource).not.toHaveBeenCalled();
});

test("a score grant reapproved as audio between projection and ticket issuance cannot bypass the listening hold",async()=>{
  const f=await fixture();await f.scheduled();await f.ecosystem.synchronize(f.mutation(),f.selection);
  vi.mocked(f.broker.resource).mockResolvedValue({resourceId:"synthetic-resource",kind:"audio",url:"https://music.example.test/api/scoped/synthetic",expiresAt:new Date(Date.now()+60000).toISOString()});
  for(const [who,mode]of [["learner","student"],["multi","parent"]]as const)await expect(f.ecosystem.resource(f.mutation(who),{...f.selection,mode,rowId:"stable-part",resourceId:"synthetic-resource"})).rejects.toBeInstanceOf(AccessUnavailable);
});
