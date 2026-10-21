import {afterEach,expect,test,vi}from "vitest";
vi.mock("server-only",()=>({}));
import {eq}from "drizzle-orm";
import {postgresAccessFixture,deferred}from "./access-fixture";
import {scheduleCeremony}from "../../src/server/service-ecosystem/scheduling";
import {createServiceScheduler}from "../../src/server/service-ecosystem/scheduler";
import type {MusicBroker,MusicResult}from "../../src/server/service-ecosystem/contract";
import *as s from "../../src/server/db/index";
const open:Awaited<ReturnType<typeof postgresAccessFixture>>[]=[];
const mutation=(f:Awaited<ReturnType<typeof postgresAccessFixture>>)=>({...f.request("admin"),method:"POST",headers:new Headers({...Object.fromEntries(f.request("admin").headers),origin:"http://localhost:3000"})});
afterEach(async()=>{await Promise.all(open.splice(0).map(f=>f.close()));});
test("two PostgreSQL transactions moving joint students to the same date serialize agreement and queue the final schedule",async()=>{
  const f=await postgresAccessFixture();open.push(f);const {sibling}=await f.practice();
  for(const studentId of [f.student.id,sibling.id])await f.a.withStudentCapability(mutation(f),{mode:"admin",studentId,capability:"set-service-plan"},async(tx,actor)=>{
    await tx.update(s.student).set({ceremonyDate:"2027-01-02",serviceSlot:"morning"}).where(eq(s.student.id,studentId));await scheduleCeremony(tx,actor.tenantId,{id:studentId,ceremonyDate:"2027-01-02",serviceSlot:"morning"});});
  const gate=deferred(),both=deferred();let count=0;
  const edit=(access:typeof f.a,studentId:string)=>access.withStudentCapability(mutation(f),{mode:"admin",studentId,capability:"set-service-plan"},async(tx,actor)=>{
    await tx.update(s.student).set({ceremonyDate:"2027-02-06",serviceSlot:"morning",revision:2}).where(eq(s.student.id,studentId));if(++count===2)both.resolve();await gate.promise;
    await scheduleCeremony(tx,actor.tenantId,{id:studentId,ceremonyDate:"2027-02-06",serviceSlot:"morning"});});
  const edits=[edit(f.a,f.student.id),edit(f.b,sibling.id)];await both.promise;gate.resolve();await Promise.all(edits);
  const [ceremony]=await f.ownerDb.select().from(s.serviceCeremony);expect(ceremony).toMatchObject({scheduleConflict:false,requestedDate:"2027-02-06",scheduleRevision:2,state:"pending"});
});
test("independent PostgreSQL workers lease a ceremony once and an expired abandoned lease is recoverable",async()=>{
  const f=await postgresAccessFixture();open.push(f);
  await f.a.withStudentCapability(mutation(f),{mode:"admin",studentId:f.student.id,capability:"set-service-plan"},async(tx,actor)=>{await scheduleCeremony(tx,actor.tenantId,{id:f.student.id,ceremonyDate:"2027-01-02",serviceSlot:"morning"});});
  const gate=deferred(),entered=deferred();const result:MusicResult={version:1,status:"review_required"};
  const broker:MusicBroker={ensure:vi.fn(async()=>{entered.resolve();await gate.promise;return result;}),projection:async()=>result,resource:async()=>{throw new Error("Synthetic unused");}};
  const first=createServiceScheduler({db:f.aDb,broker}).run({maxJobs:1});await entered.promise;
  expect(await createServiceScheduler({db:f.bDb,broker}).run({maxJobs:1})).toEqual({attempted:0,completed:0});gate.resolve();expect(await first).toEqual({attempted:1,completed:1});expect(broker.ensure).toHaveBeenCalledTimes(1);
});
