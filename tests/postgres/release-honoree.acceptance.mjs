// MANUAL ONLY: not the ordinary *.integration.mjs glob. Requires an exact
// committed candidate plus independently installed actual native reference.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import pg from "pg";
import { honoreeReleaseFixture } from "../helpers/release-honoree-fixture.mjs";
import { executeHonoreeRelease,captureHonoreeData,captureHonoreeInitial } from "../../scripts/release-migrate-honoree.mjs";
import { captureRoles } from "../../scripts/release-migrate-catalog.mjs";
import { RELEASE_LOCK } from "../../scripts/release-migrate.mjs";
import { query } from "./disposable.mjs";
const count=async f=>(await query(f.owner,"SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n;
const absent=async f=>(await query(f.owner,"SELECT to_regclass('public.honoree_link') IS NULL absent")).rows[0].absent;
async function snapshot(f){const names=(await query(f.owner,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),data=await captureHonoreeData(f.owner,names);for(const [name,n]of [["honors_version",3],["student_recording",1],["verse_source_assignment",1]])assert.equal(data.find(t=>t.name===name)?.count,n);return{data,roles:await captureRoles(f.owner)};}

test("0023 exact source/real transport/runtime/catalog refusals stop before DDL and preserve populated legacy tables",{timeout:120000},async()=>{
 const f=await honoreeReleaseFixture({crlfHistory:true});try{
  const before=await snapshot(f);let calls=0;const forbidden=async()=>{calls++;};
  const transport=await executeHonoreeRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client(f.target.connection),migrate:forbidden});assert.equal(transport.ok,false);assert.equal(transport.phase,"connection");
  const runtime=await executeHonoreeRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client({...f.target.connection,user:f.target.expected.runtimeRole}),checks:{transport(){}},migrate:forbidden});assert.equal(runtime.ok,false);assert.equal(runtime.phase,"preflight");
  const bytes=await readFile(f.path);try{await writeFile(f.path,Buffer.concat([bytes,Buffer.from("\n-- synthetic fixture drift\n")]));assert.equal((await f.run(true,forbidden)).outcome,"not-started");}finally{await writeFile(f.path,bytes);}
  await query(f.owner,"GRANT UPDATE ON public.honors_version TO portal_runtime");const refused=await f.run(true,forbidden);assert.equal(refused.ok,false);assert.equal(refused.phase,"preflight");
  assert.equal(calls,0);assert.equal(await count(f),23);assert.equal(await absent(f),true);assert.deepEqual(await snapshot(f),before);
 }finally{await f.close();}
});

test("0023 check/advisory/apply/already preserve all legacy data/roles and prove exact3/1 zero backfill with empty capabilities",{timeout:120000},async()=>{
 const f=await honoreeReleaseFixture({crlfHistory:true});try{
  const before=await snapshot(f);let calls=0;const migrate=async client=>{calls++;await f.operation(client);};
  assert.deepEqual(await f.run(false,migrate),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:23});assert.equal(calls,0);
  assert.equal((await query(f.owner,"SELECT pg_try_advisory_lock($1,$2) locked",RELEASE_LOCK)).rows[0].locked,true);
  try{assert.equal((await f.run(true,migrate)).phase,"lock");assert.equal(calls,0);}finally{await query(f.owner,"SELECT pg_advisory_unlock($1,$2)",RELEASE_LOCK);}
  assert.deepEqual(await f.run(true,migrate),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:24});assert.equal(calls,1);assert.deepEqual(await snapshot(f),before);
  const initial=await captureHonoreeInitial(f.owner,24);assert.equal(initial.valid,true);assert.equal(initial.empty,true);assert.equal(initial.actual.reading.count,3);assert.equal(initial.actual.group.count,1);assert.deepEqual(initial.actual,initial.expected);
  for(const apply of [false,true])assert.deepEqual(await f.run(apply,migrate),{ok:true,phase:"complete",outcome:"already-applied",apply,ledgerRows:24});assert.equal(calls,1);
 }finally{await f.close();}
});

test("0023 actual transaction rollback/lost COMMIT acknowledgement remain unknown and are never replayed automatically",{timeout:120000},async()=>{
 const f=await honoreeReleaseFixture({crlfHistory:true});try{
  const before=await snapshot(f);let calls=0,ddl=false;
  const failed=await f.run(true,async client=>{calls++;await query(client,"BEGIN");try{for(const statement of f.source.honoreeSQL.split("--> statement-breakpoint"))if(statement.trim())await query(client,statement);ddl=true;await query(client,"UPDATE public.student SET hebrew_name='Synthetic rollback'");await query(client,"SELECT 1/0");}catch{await query(client,"ROLLBACK");throw Error("Synthetic transaction refusal");}});
  assert.equal(ddl,true);assert.equal(failed.outcome,"unknown");assert.equal(calls,1);assert.equal(await count(f),23);assert.equal(await absent(f),true);assert.deepEqual(await snapshot(f),before);
  const unknown=await f.run(true,async client=>{calls++;await f.operation(client);throw Error("Synthetic lost acknowledgement");});assert.equal(unknown.outcome,"unknown");assert.equal(calls,2);assert.equal(await count(f),24);assert.deepEqual(await snapshot(f),before);
  assert.equal((await f.run(false,async()=>{calls++;assert.fail("No replay");})).outcome,"already-applied");assert.equal(calls,2);
 }finally{await f.close();}
});

test("0023 postcommit legacy drift is a committed conflict; later mutation refuses initial-state certification without reset",{timeout:120000},async()=>{
 const f=await honoreeReleaseFixture({crlfHistory:true});try{
  let calls=0;const result=await f.run(true,async client=>{calls++;await f.operation(client);await query(client,"UPDATE public.student SET ceremony_date='2027-01-09' WHERE id=$1",[f.studentId]);});assert.equal(result.outcome,"committed-verification-conflict");assert.equal(calls,1);assert.equal(await count(f),24);
  const observed=await f.run(false,async()=>{calls++;assert.fail("No replay/reset");});assert.equal(observed.ok,false);assert.equal(observed.outcome,"observed-applied-initial-state-unverified");assert.equal(calls,1);
 }finally{await f.close();}
});

test("0023 later quiet new student creates no honoree row and honestly invalidates initial-window reconciliation",{timeout:120000},async()=>{
 const f=await honoreeReleaseFixture({crlfHistory:true});try{
  assert.equal((await f.run(true)).outcome,"applied");
  const fresh=(await query(f.owner,"INSERT INTO public.student(tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES('crc','Synthetic','Quiet new import','2027-01-02','quiet@example.test') RETURNING id")).rows[0].id;
  assert.equal((await query(f.owner,"SELECT count(*)::int n FROM public.honoree_reading_epoch WHERE student_id=$1",[fresh])).rows[0].n,0);
  assert.equal((await f.run(false,async()=>assert.fail("No migration replay"))).outcome,"observed-applied-initial-state-unverified");
 }finally{await f.close();}
});
