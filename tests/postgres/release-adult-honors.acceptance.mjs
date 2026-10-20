// MANUAL ONLY, outside ordinary integration globs. Root selects an exact
// committed revision with independently installed native reference beforehand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { adultHonorsReleaseFixture } from "../helpers/release-adult-honors-fixture.mjs";
import { executeAdultHonorsRelease, captureAdultHonorsData, captureAdultHonorsNullTransition } from "../../scripts/release-migrate-adult-honors.mjs";
import { captureRoles } from "../../scripts/release-migrate-catalog.mjs";
import { RELEASE_LOCK } from "../../scripts/release-migrate.mjs";
import { query } from "./disposable.mjs";
const count=async f=>(await query(f.owner,"SELECT count(*)::int n FROM drizzle.__drizzle_migrations")).rows[0].n;
async function snapshot(f){const names=(await query(f.owner,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);return{data:await captureAdultHonorsData(f.owner,names,f.source),roles:await captureRoles(f.owner)};}
async function populated(f){for(const name of ["honors_version","honoree_link","honoree_operation"]){assert.equal((await query(f.owner,`SELECT count(*)::int n FROM public.${name} WHERE student_id=$1`,[f.studentId])).rows[0].n,2);}assert.ok((await query(f.owner,"SELECT count(*)::int n FROM public.honoree_material_release WHERE state='active'")).rows[0].n>0);}

test("adult0024 actual transport/runtime/catalog refusals preserve populated0023 before DDL",{timeout:120000},async()=>{
 const f=await adultHonorsReleaseFixture({crlfHistory:true});try{
  await populated(f);const before=await snapshot(f);let calls=0;const forbidden=async()=>{calls++;};
  const transport=await executeAdultHonorsRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client(f.target.connection),migrate:forbidden});assert.equal(transport.ok,false);assert.equal(transport.phase,"connection");
  const runtime=await executeAdultHonorsRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client({...f.target.connection,user:f.target.expected.runtimeRole}),checks:{transport(){}},migrate:forbidden});assert.equal(runtime.ok,false);assert.equal(runtime.phase,"preflight");
  await query(f.owner,"GRANT UPDATE ON public.honors_version TO portal_runtime");const refused=await f.run(true,forbidden);assert.equal(refused.ok,false);assert.equal(refused.phase,"preflight");
  assert.equal(calls,0);assert.equal(await count(f),24);assert.deepEqual((await snapshot(f)).data,before.data);
 }finally{await f.close();}
});
test("adult0024 check/advisory/apply preserves all rows roles material and epochs; NULL transition only at apply",{timeout:120000},async()=>{
 const f=await adultHonorsReleaseFixture({crlfHistory:true});try{
  await populated(f);const before=await snapshot(f);let calls=0;const migrate=async client=>{calls++;await f.operation(client);};
  assert.deepEqual(await f.run(false,migrate),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:24});assert.equal(calls,0);
  assert.equal((await query(f.owner,"SELECT pg_try_advisory_lock($1,$2) locked",RELEASE_LOCK)).rows[0].locked,true);
  try{assert.equal((await f.run(true,migrate)).phase,"lock");assert.equal(calls,0);}finally{await query(f.owner,"SELECT pg_advisory_unlock($1,$2)",RELEASE_LOCK);}
  assert.deepEqual(await f.run(true,migrate),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:25});assert.equal(calls,1);assert.deepEqual(await snapshot(f),before);assert.equal(await captureAdultHonorsNullTransition(f.owner),true);
  for(const table of ["honors_version","honoree_link","honoree_operation"]){const row=(await query(f.owner,"SELECT has_column_privilege($1,$2,'student_identity_id','SELECT') r,has_column_privilege($1,$2,'student_identity_id','INSERT') w",[f.target.expected.runtimeRole,table])).rows[0];assert.equal(row.r,true);assert.equal(row.w,true);}
  assert.equal((await f.run(false,migrate)).outcome,"already-applied-current-state-verified");assert.equal(calls,1);
 }finally{await f.close();}
});
test("adult0024 actual rollback and lost COMMIT acknowledgement remain unknown with no blind retry",{timeout:120000},async()=>{
 const f=await adultHonorsReleaseFixture({crlfHistory:true});try{
  const before=await snapshot(f);let calls=0,ddl=false;
  const failed=await f.run(true,async client=>{calls++;await query(client,"BEGIN");try{for(const statement of f.source.adultHonorsSQL.split("--> statement-breakpoint"))if(statement.trim())await query(client,statement);ddl=true;await query(client,"SELECT 1/0");}catch{await query(client,"ROLLBACK");throw Error("Synthetic transaction refusal");}});
  assert.equal(ddl,true);assert.equal(failed.outcome,"unknown");assert.equal(calls,1);assert.equal(await count(f),24);assert.deepEqual(await snapshot(f),before);
  const unknown=await f.run(true,async client=>{calls++;await f.operation(client);throw Error("Synthetic lost acknowledgement");});assert.equal(unknown.outcome,"unknown");assert.equal(calls,2);assert.equal(await count(f),25);assert.deepEqual(await snapshot(f),before);
  assert.equal((await f.run(false,async()=>assert.fail("No replay"))).outcome,"already-applied-current-state-verified");assert.equal(calls,2);
 }finally{await f.close();}
});
test("adult0024 postcommit old-row drift is a committed conflict; later check makes no transition claim",{timeout:120000},async()=>{
 const f=await adultHonorsReleaseFixture({crlfHistory:true});try{
  let calls=0;const result=await f.run(true,async client=>{calls++;await f.operation(client);await query(client,"UPDATE public.student SET hebrew_name='Synthetic after commit' WHERE id=$1",[f.studentId]);});
  assert.equal(result.ok,false);assert.equal(result.outcome,"committed-verification-conflict");assert.equal(calls,1);assert.equal(await count(f),25);
  assert.equal((await f.run(false,async()=>assert.fail("No replay/reset"))).outcome,"already-applied-current-state-verified");
 }finally{await f.close();}
});
test("adult0024 already-applied accepts legitimate later student attribution without assuming NULL",{timeout:120000},async()=>{
 const f=await adultHonorsReleaseFixture({crlfHistory:true});try{
  assert.equal((await f.run(true)).outcome,"applied");
  const user="synthetic-adult-release-"+randomUUID();await query(f.owner,'INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',[user,"Synthetic adult",user+"@example.test"]);
  const member=(await query(f.owner,"INSERT INTO public.membership(tenant_id,user_id) VALUES('crc',$1) RETURNING id",[user])).rows[0].id;
  const grant=(await query(f.owner,"INSERT INTO public.role_grant(tenant_id,membership_id,role) VALUES('crc',$1,'student') RETURNING id",[member])).rows[0].id;
  const identity=(await query(f.owner,"INSERT INTO public.student_identity(tenant_id,student_id,role_grant_id) VALUES('crc',$1,$2) RETURNING id",[f.studentId,grant])).rows[0].id;
  await query(f.owner,"UPDATE public.student SET student_kind='adult',own_email=$2 WHERE id=$1",[f.studentId,user+"@example.test"]);
  await query(f.owner,`INSERT INTO public.honors_version(tenant_id,student_id,assignment_id,version,base_version,previous_version,form,reviewed_context,context_hash,actor_user_id,actor_membership_id,role_grant_id,guardian_id,role,mode,mutation_id,request_digest,student_identity_id)
   SELECT tenant_id,student_id,assignment_id,version+1,version,version,form,reviewed_context,context_hash,$2,$3,$4,NULL,'student','student',$5,request_digest,$6 FROM public.honors_version WHERE student_id=$1 ORDER BY version DESC LIMIT 1`,[f.studentId,user,member,grant,randomUUID(),identity]);
  assert.equal(await captureAdultHonorsNullTransition(f.owner),false);
  assert.equal((await f.run(false,async()=>assert.fail("No replay"))).outcome,"already-applied-current-state-verified");
 }finally{await f.close();}
});
