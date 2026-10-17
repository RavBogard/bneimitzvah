import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { disposableConfig, query } from "./disposable.mjs";

async function fixture() {
  const config=disposableConfig(),suffix=randomBytes(8).toString("hex"),database=`receipt_schema_${suffix}`,login=`receipt_runtime_${suffix}`,maintenance=`receipt_maint_${suffix}`,password=randomBytes(32).toString("hex");
  const anchor=new pg.Client(config),owner=new pg.Client({...config,database}),clients=[];let madeDatabase=false,madeRuntime=false,madeMaintenance=false;
  async function close(){await Promise.all(clients.map(c=>c.end().catch(()=>{})));await owner.end().catch(()=>{});if(madeDatabase)await query(anchor,`DROP DATABASE "${database}"`);if(madeRuntime)await query(anchor,`DROP ROLE "${login}"`);if(madeMaintenance)await query(anchor,`DROP ROLE "${maintenance}"`);await anchor.end();}
  try{
    await anchor.connect();await query(anchor,`CREATE DATABASE "${database}"`);madeDatabase=true;await owner.connect();
    await migrate(drizzle(owner),{migrationsFolder:"src/server/db/migrations"});
    for(const role of [login,maintenance]){await query(anchor,`CREATE ROLE "${role}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);if(role===login)madeRuntime=true;else madeMaintenance=true;}
    await query(anchor,`GRANT portal_runtime TO "${login}"`);
    await query(owner,`GRANT CONNECT ON DATABASE "${database}" TO "${maintenance}"`);await query(owner,`GRANT USAGE ON SCHEMA public TO "${maintenance}"`);
    await query(owner,`GRANT SELECT ON recording_receipt,recording_receipt_slot TO "${maintenance}"`);
    await query(owner,`GRANT UPDATE(state,revision,terminal_at,terminal_reason,logical_take_released) ON recording_receipt TO "${maintenance}"`);
    await query(owner,`GRANT UPDATE(state,revision,audio_liability_released) ON recording_receipt_slot TO "${maintenance}"`);
    for(const table of ["recording_receipt","recording_receipt_slot"])await query(owner,`CREATE POLICY synthetic_maintenance_scope ON ${table} TO "${maintenance}" USING(tenant_id='crc' AND session_user='${maintenance}') WITH CHECK(tenant_id='crc' AND session_user='${maintenance}')`);
    async function connect(kind="owner"){const c=new pg.Client({...config,database,...kind==="owner"?{}:{user:kind==="runtime"?login:maintenance,password}});await c.connect();clients.push(c);return c;}
    const runtime=await connect("runtime"),maint=await connect("maintenance");
    return {owner,runtime,maint,connect,close,login,maintenance};
  }catch(error){await close();throw error;}
}
async function tx(c,action){await query(c,"BEGIN");try{const value=await action();await query(c,"COMMIT");return value;}catch(error){await query(c,"ROLLBACK");throw error;}}
async function student(f){const id=randomUUID();await query(f.owner,"INSERT INTO student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES($1,'crc','Synthetic','NativeReceipt','9999-12-31','parent@example.test')",[id]);return id;}
async function head(c,studentId,bytes=46,overrides={}){
  const id=randomUUID(),asset=randomUUID(),values={id,tenant_id:"crc",student_id:studentId,request_id:randomUUID(),original_recording_id:randomUUID(),asset_id:asset,store_generation:"synthetic-v1",actor_user_id:"synthetic-user",auth_session_id:"synthetic-session",membership_id:randomUUID(),membership_authority_revision:1,role_grant_id:randomUUID(),role_grant_revision:1,mode:"student",relationship_id:randomUUID(),student_revision:1,session_expires_at:"9999-12-31T00:00:00Z",declared_bytes:bytes,slot_count:Math.ceil(bytes/1048576),state:"receiving",revision:1,retention_ceremony_date:"9999-12-31",...overrides};
  const keys=Object.keys(values);await query(c,`INSERT INTO recording_receipt(${keys.join(",")}) VALUES(${keys.map((_,i)=>"$"+(i+1)).join(",")})`,Object.values(values));return {id,asset,bytes,slots:Math.ceil(bytes/1048576)};
}
async function slot(c,h,i,overrides={}){const values={tenant_id:"crc",receipt_id:h.id,slot_index:i,object_key:`recordings/v1/${h.asset}/chunk-${String(i).padStart(2,"0")}`,expected_bytes:Math.min(1048576,h.bytes-i*1048576),state:"reserved",revision:1,...overrides},keys=Object.keys(values);await query(c,`INSERT INTO recording_receipt_slot(${keys.join(",")}) VALUES(${keys.map((_,n)=>"$"+(n+1)).join(",")})`,Object.values(values));}
async function receipt(f,studentId,bytes=46){return tx(f.owner,async()=>{const h=await head(f.owner,studentId,bytes);for(let i=0;i<h.slots;i++)await slot(f.owner,h,i);return h;});}
async function retire(c,h){await query(c,"UPDATE recording_receipt SET state='retiring',revision=revision+1,retiring_at=clock_timestamp() WHERE id=$1",[h.id]);await query(c,"UPDATE recording_receipt_slot SET state='retiring',revision=revision+1 WHERE receipt_id=$1",[h.id]);}
async function blocked(observer,waiting,blocker){const until=Date.now()+3000;while(Date.now()<until){const v=await query(observer,"SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS edge",[waiting.processID,blocker.processID]);if(v.rows[0].edge)return;await delay(10);}throw Error("Expected native lock edge not observed");}

// These direct-SQL tests prove schema facts only, not service quotas/commit
// permissions, runtime uploads or production maintenance authority.
test("0021 actual COMMIT completeness rejects missing/partial/NULL/forged slots and keeps native old rows",{timeout:30000},async()=>{
 const f=await fixture();try{
  const id=await student(f),before=(await query(f.owner,"SELECT * FROM student WHERE id=$1",[id])).rows;
  for(const bytes of [46,1048578,28800044]){const h=await receipt(f,id,bytes);assert.deepEqual((await query(f.owner,"SELECT count(*)::int AS n,sum(expected_bytes)::int AS bytes FROM recording_receipt_slot WHERE receipt_id=$1",[h.id])).rows,[{n:h.slots,bytes}]);}
  await assert.rejects(tx(f.owner,()=>head(f.owner,id)),{code:"23514"});
  await assert.rejects(tx(f.owner,async()=>{const h=await head(f.owner,id,1048578);await slot(f.owner,h,0);}),{code:"23514"});
  for(const change of [{expected_bytes:44},{slot_index:1},{ever_upload_opened:null},{audio_liability_released:null},{state:"prepared",body_sha256:"a".repeat(64),permit_etag:'"A"'}])await assert.rejects(tx(f.owner,async()=>{const h=await head(f.owner,id);await slot(f.owner,h,0,change);}));
  assert.deepEqual((await query(f.owner,"SELECT * FROM student WHERE id=$1",[id])).rows,before);
  assert.equal((await query(f.owner,"SELECT count(*)::int AS n FROM student_recording")).rows[0].n,0);assert.equal((await query(f.owner,"SELECT count(*)::int AS n FROM audit_event")).rows[0].n,0);
 }finally{await f.close();}
});

test("runtime forced-RLS/column grants cannot terminalize; a separate synthetic scope closes only the complete never-opened head",{timeout:30000},async()=>{
 const f=await fixture();try{
  const h=await receipt(f,await student(f),1048578);
  for(const table of ["recording_admission","recording_receipt","recording_receipt_slot"]){const flags=(await query(f.owner,"SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=$1",[table])).rows[0];assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true});}
  assert.equal((await query(f.runtime,"SELECT count(*)::int AS n FROM recording_receipt")).rows[0].n,0);
  await tx(f.runtime,async()=>{await query(f.runtime,"SELECT set_config('app.tenant_id','crc',true)");await query(f.runtime,"INSERT INTO recording_admission(tenant_id) VALUES('crc') ON CONFLICT DO NOTHING");await query(f.runtime,"SELECT * FROM recording_admission WHERE tenant_id='crc' FOR UPDATE");assert.equal((await query(f.runtime,"SELECT count(*)::int AS n FROM recording_receipt")).rows[0].n,1);});
  for(const sql of ["UPDATE recording_receipt SET logical_take_released=true WHERE id=$1","UPDATE recording_receipt SET terminal_reason='never-opened' WHERE id=$1","DELETE FROM recording_receipt WHERE id=$1"])await assert.rejects(query(f.runtime,sql,[h.id]),{code:"42501"});
  await tx(f.runtime,async()=>{await query(f.runtime,"SELECT set_config('app.tenant_id','crc',true)");await retire(f.runtime,h);});
  await assert.rejects(tx(f.maint,()=>query(f.maint,"UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1 AND slot_index=0",[h.id])),{code:"23514"});
  await tx(f.maint,async()=>{await query(f.maint,"UPDATE recording_receipt SET state='terminal',revision=3,terminal_at=clock_timestamp(),terminal_reason='never-opened',logical_take_released=true WHERE id=$1",[h.id]);await query(f.maint,"UPDATE recording_receipt_slot SET state='never-opened',revision=3,audio_liability_released=true WHERE receipt_id=$1",[h.id]);});
  await assert.rejects(query(f.maint,"UPDATE recording_receipt_slot SET ever_upload_opened=true WHERE receipt_id=$1",[h.id]),{code:"42501"});
  assert.deepEqual((await query(f.owner,"SELECT state,logical_take_released FROM recording_receipt WHERE id=$1",[h.id])).rows,[{state:"terminal",logical_take_released:true}]);
 }finally{await f.close();}
});

test("date waits for ALL0020 ledger locks before receipt locks and never takes the admission mutex",{timeout:30000},async()=>{
 const f=await fixture(),ledger=await f.connect(),mutex=await f.connect(),date=await f.connect(),observer=await f.connect();let pending;
 try{
  const id=await student(f),h=await receipt(f,id),recording=randomUUID();
  await query(f.owner,"INSERT INTO student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at) VALUES($1,'crc',$2,$3,$4,'audio/webm;codecs=opus',10,10,'private',1,clock_timestamp())",[recording,id,randomUUID(),"a".repeat(64)]);
  await query(mutex,"BEGIN");await query(mutex,"INSERT INTO recording_admission(tenant_id) VALUES('crc')");await query(mutex,"SELECT * FROM recording_admission WHERE tenant_id='crc' FOR UPDATE");
  await query(ledger,"BEGIN");await query(ledger,"SELECT * FROM student_recording WHERE id=$1 FOR UPDATE",[recording]);
  pending=query(date,"UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1",[id]);void pending.catch(()=>{});await blocked(observer,date,ledger);
  await query(observer,"BEGIN");await query(observer,"SELECT * FROM recording_receipt WHERE id=$1 FOR UPDATE NOWAIT",[h.id]);await query(observer,"ROLLBACK");
  await query(ledger,"COMMIT");await pending;pending=undefined;
  assert.deepEqual((await query(f.owner,"SELECT state,logical_take_released FROM recording_receipt WHERE id=$1",[h.id])).rows,[{state:"retiring",logical_take_released:false}]);
  assert.equal((await query(f.owner,"SELECT state FROM student_recording WHERE id=$1",[recording])).rows[0].state,"deleting");
  assert.equal((await query(f.owner,"SELECT sum(expected_bytes)::int AS bytes FROM recording_receipt_slot WHERE receipt_id=$1 AND NOT audio_liability_released",[h.id])).rows[0].bytes,46);
 }finally{await query(ledger,"ROLLBACK").catch(()=>{});await query(mutex,"ROLLBACK").catch(()=>{});await query(observer,"ROLLBACK").catch(()=>{});if(pending)await Promise.allSettled([pending]);await f.close();}
});

test("date uses fresh clock after receipt-row wait; future-past-future latch/rollback preserve charge and no audit",{timeout:30000},async()=>{
 const f=await fixture(),blocker=await f.connect(),date=await f.connect(),observer=await f.connect();let pending;
 try{
  const id=await student(f),h=await receipt(f,id);
  await query(blocker,"BEGIN");await query(blocker,"SELECT * FROM recording_receipt WHERE id=$1 FOR UPDATE",[h.id]);
  pending=query(date,"UPDATE student SET ceremony_date='2000-01-01',revision=revision+1 WHERE id=$1",[id]);void pending.catch(()=>{});await blocked(observer,date,blocker);
  const instant=(await query(blocker,"SELECT clock_timestamp() AS at")).rows[0].at;await query(blocker,"COMMIT");await pending;pending=undefined;
  assert.equal((await query(f.owner,"SELECT retention_latched_at >= $2::timestamptz AS fresh FROM recording_receipt WHERE id=$1",[h.id,instant])).rows[0].fresh,true);
  const before=(await query(f.owner,"SELECT * FROM recording_receipt WHERE id=$1",[h.id])).rows;
  await query(date,"BEGIN");await query(date,"UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1",[id]);await query(date,"ROLLBACK");assert.deepEqual((await query(f.owner,"SELECT * FROM recording_receipt WHERE id=$1",[h.id])).rows,before);
  await query(date,"UPDATE student SET ceremony_date='9999-12-30',revision=revision+1 WHERE id=$1",[id]);
  assert.deepEqual((await query(f.owner,"SELECT state,logical_take_released FROM recording_receipt WHERE id=$1",[h.id])).rows,[{state:"retiring",logical_take_released:false}]);
  assert.equal((await query(f.owner,"SELECT count(*)::int AS n FROM audit_event")).rows[0].n,0);
 }finally{await query(blocker,"ROLLBACK").catch(()=>{});await query(date,"ROLLBACK").catch(()=>{});if(pending)await Promise.allSettled([pending]);await f.close();}
});
