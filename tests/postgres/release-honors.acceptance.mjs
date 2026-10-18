import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import pg from "pg";
import { honorsReleaseFixture } from "../helpers/release-honors-fixture.mjs";
import { executeHonorsRelease,captureHonorsData } from "../../scripts/release-migrate-honors.mjs";
import { captureRoles } from "../../scripts/release-migrate-catalog.mjs";
import { RELEASE_LOCK } from "../../scripts/release-migrate.mjs";
import { query } from "./disposable.mjs";

const count=async f=>(await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count;
const absent=async f=>(await query(f.owner,"SELECT to_regclass('public.honors_version') IS NULL AS absent")).rows[0].absent;
async function snapshot(f) {
  const names=(await query(f.owner,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  assert.ok(names.includes("student_recording")&&names.includes("verse_source_assignment"));
  const data=await captureHonorsData(f.owner,names);assert.equal(data.find(t=>t.name==="verse_source_assignment").count,1);
  return {data,roles:await captureRoles(f.owner)};
}

test("0022 real transport/runtime/source/catalog refusal stops before DDL",{timeout:120000},async()=>{
  const f=await honorsReleaseFixture({crlfHistory:true});
  try {
    const before=await snapshot(f);let calls=0;const forbidden=async()=>{calls++;};
    const transport=await executeHonorsRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client(f.target.connection),migrate:forbidden});
    assert.equal(transport.ok,false);assert.equal(transport.phase,"connection");assert.equal(transport.outcome,"not-started");
    const role=await executeHonorsRelease(f.source,f.target,{apply:true,connect:()=>new pg.Client({...f.target.connection,user:f.target.expected.runtimeRole}),checks:{transport(){}},migrate:forbidden});
    assert.equal(role.ok,false);assert.equal(role.phase,"preflight");assert.equal(role.outcome,"not-started");
    const bytes=await readFile(f.path);
    try {
      await writeFile(f.path,Buffer.concat([bytes,Buffer.from("\n-- Synthetic private fixture drift\n")]));
      assert.deepEqual(await f.run(true,forbidden),{ok:false,phase:"connection",outcome:"not-started",apply:true});
    }finally{await writeFile(f.path,bytes);}
    await query(f.owner,"GRANT UPDATE ON public.verse_source_assignment TO portal_runtime");
    const catalog=await f.run(true,forbidden);assert.equal(catalog.ok,false);assert.equal(catalog.phase,"preflight");assert.equal(catalog.outcome,"not-started");
    assert.equal(calls,0);assert.equal(await count(f),22);assert.equal(await absent(f),true);assert.deepEqual(await snapshot(f),before);
  }finally{await f.close();}
});

test("0022 native check/advisory exclusion/apply/already preserve all old data/roles and leave honors empty",{timeout:120000},async()=>{
  const f=await honorsReleaseFixture({crlfHistory:true});
  try {
    const before=await snapshot(f);let calls=0;const migrate=async client=>{calls++;await f.operation(client);};
    assert.deepEqual(await f.run(false,migrate),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:22});assert.equal(calls,0);
    assert.equal((await query(f.owner,"SELECT pg_try_advisory_lock($1,$2) AS locked",RELEASE_LOCK)).rows[0].locked,true);
    try{assert.deepEqual(await f.run(true,migrate),{ok:false,phase:"lock",outcome:"not-started",apply:true});assert.equal(calls,0);}
    finally{assert.equal((await query(f.owner,"SELECT pg_advisory_unlock($1,$2) AS unlocked",RELEASE_LOCK)).rows[0].unlocked,true);}
    assert.deepEqual(await f.run(true,migrate),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:23});
    for(const apply of [false,true])assert.deepEqual(await f.run(apply,migrate),{ok:true,phase:"complete",outcome:"already-applied",apply,ledgerRows:23});
    assert.equal(calls,1);assert.equal(await count(f),23);assert.equal(await absent(f),false);assert.deepEqual(await snapshot(f),before);
    assert.equal((await query(f.owner,"SELECT NOT EXISTS(SELECT 1 FROM public.honors_version) AS clear")).rows[0].clear,true);
  }finally{await f.close();}
});

test("0022 actual transactional rollback and lost COMMIT acknowledgement stay unknown without replay",{timeout:120000},async()=>{
  const f=await honorsReleaseFixture({crlfHistory:true});
  try {
    const before=await snapshot(f);let calls=0,ddlCompleted=false,oldMutationRan=false;
    const rollback=await f.run(true,async client=>{
      calls++;await query(client,"BEGIN");
      try {
        for(const statement of f.source.honorsSQL.split("--> statement-breakpoint"))if(statement.trim())await query(client,statement);
        ddlCompleted=true;await query(client,"UPDATE public.student SET hebrew_name='Synthetic rollback'");oldMutationRan=true;
        await query(client,"SELECT 1/0");assert.fail("Deliberate database failure required");
      }catch{await query(client,"ROLLBACK");throw Error("Synthetic failed transaction acknowledgement");}
    });
    assert.deepEqual(rollback,{ok:false,phase:"migration",outcome:"unknown",apply:true});assert.equal(calls,1);assert.equal(ddlCompleted,true);assert.equal(oldMutationRan,true);
    assert.equal(await count(f),22);assert.equal(await absent(f),true);assert.deepEqual(await snapshot(f),before);
    const unknown=await f.run(true,async client=>{calls++;await f.operation(client);throw Error("Synthetic lost acknowledgement after COMMIT");});
    assert.deepEqual(unknown,{ok:false,phase:"migration",outcome:"unknown",apply:true});assert.equal(calls,2);assert.equal(await count(f),23);assert.equal(await absent(f),false);assert.deepEqual(await snapshot(f),before);
    assert.deepEqual(await f.run(false,async()=>{calls++;assert.fail("No automatic replay");}),{ok:true,phase:"complete",outcome:"already-applied",apply:false,ledgerRows:23});assert.equal(calls,2);
  }finally{await f.close();}
});

test("0022 postcommit old-row drift reports verification conflict and does not claim rollback or retry",{timeout:120000},async()=>{
  const f=await honorsReleaseFixture({crlfHistory:true});
  try {
    const before=await snapshot(f);let calls=0;
    const result=await f.run(true,async client=>{calls++;await f.operation(client);await query(client,"UPDATE public.student SET hebrew_name='Synthetic committed drift'");});
    assert.deepEqual(result,{ok:false,phase:"verification",outcome:"committed-verification-conflict",apply:true});assert.equal(calls,1);assert.equal(await count(f),23);assert.equal(await absent(f),false);
    const after=await snapshot(f);assert.deepEqual(after.roles,before.roles);assert.notEqual(after.data.find(t=>t.name==="student").digest,before.data.find(t=>t.name==="student").digest);
    assert.deepEqual(after.data.find(t=>t.name==="verse_source_assignment"),before.data.find(t=>t.name==="verse_source_assignment"));
    // A fresh read-only check identifies current schema/emptiness; it cannot
    // erase the earlier failure to preserve original rows.
    assert.deepEqual(await f.run(false,async()=>{calls++;assert.fail("No replay");}),{ok:true,phase:"complete",outcome:"already-applied",apply:false,ledgerRows:23});assert.equal(calls,1);
  }finally{await f.close();}
});
