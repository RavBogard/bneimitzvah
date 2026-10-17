import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { recordingsReleaseFixture } from "../helpers/release-recordings-fixture.mjs";
import { query } from "./disposable.mjs";
import { RELEASE_LOCK } from "../../scripts/release-migrate.mjs";
import { captureRecordingsData } from "../../scripts/release-migrate-recordings.mjs";

test("configured0020 check/apply/idempotence preserves all0019 metadata and exact old ledger rows",{timeout:120000},async()=>{
  const f=await recordingsReleaseFixture(),configured=new pg.Client(f.target.connection);
  try{
    await configured.connect();assert.equal((await query(configured,"SELECT current_schema() AS schema")).rows[0].schema,"public");await configured.end();
    const before=(await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows;
    const names=f.source.reference.final.tables.map(table=>table.name),data=await captureRecordingsData(f.owner,names);
    assert.deepEqual(await f.run(),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:20});
    assert.deepEqual((await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows,before);
    let calls=0;assert.deepEqual(await f.run(true,async client=>{calls++;assert.equal((await query(client,"SELECT current_schema() AS schema")).rows[0].schema,"public");await f.operation(client);}),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:21});
    assert.equal(calls,1);assert.deepEqual((await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows.slice(0,20),before);
    assert.deepEqual(await captureRecordingsData(f.owner,names),data);
    assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM student WHERE hebrew_name IS NOT NULL AND second_parent_email IS NOT NULL AND import_metadata IS NOT NULL")).rows[0].count,1);
    assert.deepEqual(await f.run(true),{ok:true,phase:"complete",outcome:"already-applied",apply:true,ledgerRows:21});
    await query(f.owner,"ALTER TABLE student_recording NO FORCE ROW LEVEL SECURITY");
    assert.deepEqual(await f.run(),{ok:false,phase:"preflight",outcome:"not-started",apply:false});
  }finally{await configured.end().catch(()=>undefined);await f.close();}
});
test("attested historicalCRLF survives20-to21 and wrong attestation stops before apply",{timeout:120000},async()=>{
  const f=await recordingsReleaseFixture({crlfHistory:true});try{
    const hash=f.target.prefix[2].hash;f.target.prefix[2].hash=f.source.migrations[2].hash;
    const wrong=await f.run(true);assert.equal(wrong.ok,false);assert.equal(wrong.phase,"preflight");assert.equal(wrong.outcome,"not-started");
    f.target.prefix[2].hash=hash;assert.equal((await f.run()).outcome,"checked");assert.equal((await f.run(true)).outcome,"applied");assert.equal((await f.run(true)).outcome,"already-applied");
  }finally{await f.close();}
});
test("shared advisory lock and late SQL failure preserve twenty-entry schema atomically",{timeout:120000},async()=>{
  const f=await recordingsReleaseFixture(),blocker=new pg.Client(f.connection);try{
    await blocker.connect();await query(blocker,"SELECT pg_advisory_lock($1,$2)",RELEASE_LOCK);
    const held=await f.run(true);assert.equal(held.ok,false);assert.equal(held.phase,"lock");
    await query(blocker,"SELECT pg_advisory_unlock($1,$2)",RELEASE_LOCK);await blocker.end();
    const path=join(f.folder,"0020_student_recording_ledger.sql"),sql=await readFile(path,"utf8");await writeFile(path,sql+"\n--> statement-breakpoint\nSELECT 1/0;");
    const failed=await f.run(true);assert.equal(failed.ok,false);assert.equal(failed.outcome,"unknown");
    assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count,20);
    assert.equal((await query(f.owner,"SELECT to_regclass('public.student_recording') IS NULL AS absent")).rows[0].absent,true);
  }finally{await blocker.end().catch(()=>undefined);await f.close();}
});
test("lost commit acknowledgement and real postcommit drift require reconciliation without replay",{timeout:120000},async t=>{
  for(const mode of ["lost-ack","metadata-write","new-recording","grant-drift"]){await t.test(mode,async()=>{
    const f=await recordingsReleaseFixture();let calls=0;try{
      const result=await f.run(true,async client=>{
        calls++;
        if(mode==="lost-ack"){
          const original=client.query.bind(client);client.query=async(...args)=>{const value=await original(...args);const text=typeof args[0]==="string"?args[0]:args[0]?.text;if(text?.trim().toLowerCase()==="commit")throw new Error("Synthetic lost acknowledgement");return value;};
          try{await f.operation(client);}finally{client.query=original;}
        }else{
          await f.operation(client);
          if(mode==="metadata-write")await query(client,"UPDATE student SET import_metadata=jsonb_set(import_metadata,'{adminNotes}','\"Synthetic changed\"'::jsonb)");
          if(mode==="new-recording")await query(client,`INSERT INTO student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at)
            SELECT gen_random_uuid(),tenant_id,id,gen_random_uuid(),repeat('a',64),'audio/webm;codecs=opus',1,1,'private',1,clock_timestamp() FROM student LIMIT 1`);
          if(mode==="grant-drift")await query(client,"GRANT DELETE ON student_recording TO portal_runtime");
        }
      });
      assert.equal(result.ok,false);assert.equal(result.outcome,mode==="lost-ack"?"unknown":"committed-verification-conflict");assert.equal(calls,1);
      assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count,21);
    }finally{await f.close();}
  });}
});
