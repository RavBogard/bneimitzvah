import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import pg from "pg";
import {rosterReleaseFixture} from "../helpers/release-roster-fixture.mjs";
import {query} from "./disposable.mjs";
import {RELEASE_LOCK} from "../../scripts/release-migrate.mjs";
import {captureRosterData} from "../../scripts/release-migrate-roster.mjs";

test("configured 0019 operator checks then applies exactly one migration and preserves prior rows and ledger",{timeout:120000},async()=>{
  const f=await rosterReleaseFixture(),configured=new pg.Client(f.target.connection);
  try{
    await configured.connect();assert.equal((await query(configured,"SELECT current_schema() AS schema")).rows[0].schema,"public");await configured.end();
    const before=(await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows;
    const data=await captureRosterData(f.owner,f.source.reference.final.tables.map(table=>table.name));
    assert.deepEqual(await f.run(),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:19});
    assert.deepEqual((await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows,before);
    let operationCalls=0;
    assert.deepEqual(await f.run(true,async client=>{
      operationCalls++;assert.equal((await query(client,"SELECT current_schema() AS schema")).rows[0].schema,"public");await f.operation(client);
    }),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:20});
    assert.equal(operationCalls,1);
    assert.deepEqual((await query(f.owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows.slice(0,19),before);
    assert.deepEqual(await captureRosterData(f.owner,f.source.reference.final.tables.map(table=>table.name)),data);
    assert.deepEqual((await query(f.owner,"SELECT hebrew_name,second_parent_email,import_metadata FROM student")).rows,[{hebrew_name:null,second_parent_email:null,import_metadata:null}]);
    assert.deepEqual(await f.run(true),{ok:true,phase:"complete",outcome:"already-applied",apply:true,ledgerRows:20});
    await query(f.owner,"ALTER TABLE student DROP CONSTRAINT student_second_parent_bounded");
    const mutated=await f.run();assert.equal(mutated.ok,false);assert.equal(mutated.phase,"preflight");
  }finally{await configured.end().catch(()=>undefined);await f.close();}
});
test("exact attested CRLF history survives 19-to-20 and wrong historical attestation never reaches migration",{timeout:120000},async()=>{
  const f=await rosterReleaseFixture({crlfHistory:true});
  try{
    const hash=f.target.prefix[2].hash;f.target.prefix[2].hash=f.source.migrations[2].hash;
    const wrong=await f.run(true);assert.equal(wrong.ok,false);assert.equal(wrong.outcome,"not-started");assert.equal(wrong.phase,"preflight");
    assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count,19);
    f.target.prefix[2].hash=hash;
    assert.equal((await f.run()).outcome,"checked");assert.equal((await f.run(true)).outcome,"applied");assert.equal((await f.run(true)).outcome,"already-applied");
  }finally{await f.close();}
});
test("shared physical advisory lock and late SQL failure leave the old schema and nineteen ledger entries intact",{timeout:120000},async()=>{
  const f=await rosterReleaseFixture(),blocker=new pg.Client(f.connection);
  try{
    await blocker.connect();await query(blocker,"SELECT pg_advisory_lock($1,$2)",RELEASE_LOCK);
    const held=await f.run(true);assert.equal(held.ok,false);assert.equal(held.phase,"lock");
    await query(blocker,"SELECT pg_advisory_unlock($1,$2)",RELEASE_LOCK);await blocker.end();
    const path=join(f.folder,"0019_quiet_roster_intake.sql"),sql=await readFile(path,"utf8");
    await writeFile(path,sql+"\n--> statement-breakpoint\nSELECT 1/0;");
    const failed=await f.run(true);assert.equal(failed.ok,false);assert.equal(failed.outcome,"unknown");
    assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count,19);
    assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='student' AND column_name='hebrew_name'")).rows[0].count,0);
  }finally{await blocker.end().catch(()=>undefined);await f.close();}
});
test("real COMMIT lost acknowledgement and postcommit student writes require reconciliation without automatic replay",{timeout:120000},async t=>{
  for(const mode of ["lost-ack","old-row-write","new-column-write"]){await t.test(mode,async()=>{
    const f=await rosterReleaseFixture();let calls=0;
    try{
      const result=await f.run(true,async client=>{
        calls++;
        if(mode==="lost-ack"){
          const original=client.query.bind(client);client.query=async(...args)=>{const value=await original(...args);const text=typeof args[0]==="string"?args[0]:args[0]?.text;if(text?.trim().toLowerCase()==="commit")throw new Error("Synthetic lost commit acknowledgement");return value;};
          try{await f.operation(client);}finally{client.query=original;}
        }else{await f.operation(client);await query(client,mode==="old-row-write"?"UPDATE student SET first_name='Synthetic changed'":"UPDATE student SET hebrew_name='Synthetic changed'");}
      });
      assert.equal(result.ok,false);assert.equal(result.outcome,mode==="lost-ack"?"unknown":"committed-verification-conflict");assert.equal(calls,1);
      assert.equal((await query(f.owner,"SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count,20);
    }finally{await f.close();}
  });}
});
