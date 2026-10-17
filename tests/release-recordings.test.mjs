import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { RELEASE_BASE,RELEASE_FILES,sha,parseTarget,argumentsFor,sourceContract } from "../scripts/release-migrate-support.mjs";
import { ROSTER_FILES,ROSTER_REFERENCE,validateRosterReference,rosterSourceContract } from "../scripts/release-migrate-roster-support.mjs";
import { RECORDINGS_BASE,RECORDINGS_FILES,RECORDINGS_REFERENCE,recordingsSourceContract,checkRecordingsLedger,selectedRecordingsReference,validateRecordingsReference } from "../scripts/release-migrate-recordings-support.mjs";
import { executeRecordingsRelease,runRecordingsRelease } from "../scripts/release-migrate-recordings.mjs";
const candidate="a".repeat(40),json=path=>JSON.parse(readFileSync(new URL("../"+path,import.meta.url)));
function source(){
  const extra=json(RECORDINGS_REFERENCE),old=json("tests/fixtures/portal/release-migrate-reference.json"),roster=json(ROSTER_REFERENCE);
  const migrations=Array.from({length:21},(_,index)=>({index,hash:sha(`LF${index}`),historicalAllowed:[sha(`LF${index}`)],createdAt:1000+index}));
  migrations[19].hash=roster.migrationSHA256;migrations[20].hash=extra.migrationSHA256;
  const s={migrations,reference:old,historicalFunctions:old.historicalFunctions,studentAfter:validateRosterReference(roster,old,roster.migrationSHA256),recheck(){}};
  s.recordingsAfter=validateRecordingsReference(extra,s);return s;
}
function manifest(s){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require");url.username="release_owner";url.password="synthetic-password";return {version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((row,i)=>({id:i+1,hash:row.hash,createdAt:row.createdAt})),provenance:{sourceCommit:RELEASE_BASE,method:"owner-readonly",observedAt:"2026-10-17T00:00:00.000Z"}};}
const ledger=(s,length)=>s.migrations.slice(0,length).map((row,i)=>({id:i+1,hash:row.hash,created_at:String(row.createdAt)}));
function harness(options={}){
  const s=source(),target=parseTarget(manifest(s),s);let length=options.already?21:20,calls=0,ended=0,reads=0;
  const client=Object.assign(new EventEmitter(),{async connect(){},async end(){ended++;},async query(sql){
    if(sql.includes("pg_try_advisory_lock"))return {rows:[{locked:!options.locked}]};
    if(sql.includes("pg_advisory_unlock"))return {rows:[{unlocked:!options.cleanupFailure}]};
    if(sql.includes("FROM drizzle.__drizzle_migrations"))return {rows:ledger(s,length)};
    if(sql.includes("SELECT NOT EXISTS"))return {rows:[{clear:!options.nonEmpty}]};return {rows:[]};}});
  const checks={transport(){if(options.transportFailure)throw 0;},async identity(){if(options.identityFailure)throw 0;},async catalog(){return selectedRecordingsReference(s,target,length);},verifyCatalog(actual,expected){assert.deepEqual(actual,expected);},async roles(){return ["same"];},async data(){reads++;if(options.idleError)client.emit("error",new Error("Synthetic private failure"));return [{name:"student",count:1,digest:options.preChange && reads===2 || options.postChange && length===21?"changed":"same"}];}};
  const migrate=async value=>{assert.equal(value,client);calls++;if(options.migrateFailure)throw new Error("Synthetic lost acknowledgement");length=21;};
  return {s,target,client,checks,migrate,get calls(){return calls;},get ended(){return ended;}};
}
const execute=(h,apply=true)=>executeRecordingsRelease(h.s,h.target,{apply,checks:h.checks,connect:()=>h.client,migrate:h.migrate});

test("0020 defaults to check-only and source refusal precedes protected target access",async()=>{
  assert.equal(argumentsFor(["--expected-commit",candidate,"--target","private.json"]).apply,false);let reads=0;
  assert.deepEqual(await runRecordingsRelease(["--expected-commit",candidate,"--target","private.json"],{source(){throw 0;},readTarget(){reads++;}}),{ok:false,phase:"source",outcome:"not-started",apply:false});assert.equal(reads,0);
});
test("0020 accepts only exact20 baseline or21 result using unchanged protected target V1",()=>{
  const s=source(),target=parseTarget(manifest(s),s);
  assert.equal(checkRecordingsLedger(ledger(s,20),s,target).length,20);assert.equal(checkRecordingsLedger(ledger(s,21),s,target).length,21);
  for(const rows of [ledger(s,19),[...ledger(s,21),{id:22}],ledger(s,21).map((row,i)=>i===20?{...row,hash:sha("other")}:row),ledger(s,20).map((row,i)=>i===19?{...row,created_at:"1"}:row),ledger(s,21).map((row,i)=>i===20?{...row,id:20}:row)])assert.throws(()=>checkRecordingsLedger(rows,s,target));
});
test("single-client check, apply and idempotence leave no listener or automatic replay",async()=>{
  for(const[options,apply,outcome,calls]of [[{},false,"checked",0],[{},true,"applied",1],[{already:true},true,"already-applied",0]]){
    const h=harness(options),result=await execute(h,apply);assert.equal(result.ok,true);assert.equal(result.outcome,outcome);assert.equal(h.calls,calls);assert.equal(h.ended,1);assert.equal(h.client.listenerCount("error"),0);
  }
});
test("transport, identity, lock, idle-client errors and changed snapshots stop before migration",async()=>{
  for(const options of [{locked:true},{identityFailure:true},{transportFailure:true},{idleError:true},{preChange:true}]){
    const h=harness(options),result=await execute(h);assert.equal(result.ok,false);assert.equal(result.outcome,"not-started");assert.equal(h.calls,0);assert.equal(h.ended,1);assert.ok(!JSON.stringify(result).includes("Synthetic"));
  }
});
test("unknown commit, changed old rows, nonempty recording table and cleanup errors stay closed",async()=>{
  for(const[options,outcome]of [[{migrateFailure:true},"unknown"],[{postChange:true},"committed-verification-conflict"],[{nonEmpty:true},"committed-verification-conflict"],[{cleanupFailure:true},"applied"]]){
    const h=harness(options),result=await execute(h);assert.equal(result.ok,false);assert.equal(result.outcome,outcome);assert.equal(h.calls,1);assert.equal(h.ended,1);
  }
  const already=harness({already:true,nonEmpty:true});assert.equal((await execute(already)).ok,false);assert.equal(already.calls,0);
});
test("exact reference permits only reviewed0020 additions; all catalog fields remain pinned",()=>{
  const s=source(),reference=json(RECORDINGS_REFERENCE);assert.ok(validateRecordingsReference(reference,s));
  for(const mutate of [r=>r.after.tables.find(t=>t.name==="student_recording").force_rls=false,r=>r.after.functions[0].security_definer=true,r=>r.after.tables[0].constraints[0].definition="CHECK (true)",r=>r.after.types[0].owner="PUBLIC",r=>r.migrationSHA256=sha("other"),r=>r.extra=true]){const bad=structuredClone(reference);mutate(bad);assert.throws(()=>validateRecordingsReference(bad,s));}
});
test("exclusive attested historicalCRLF changes only expected old function hashes after0020",()=>{
  const s=source();s.migrations[2].historicalAllowed.push(sha("CRLF2"));const target=parseTarget(manifest(s),s),lf=selectedRecordingsReference(s,target,21);
  target.prefix[2].hash=s.migrations[2].historicalAllowed[1];const crlf=selectedRecordingsReference(s,target,21);
  assert.deepEqual(crlf.tables,lf.tables);assert.deepEqual(crlf.types,lf.types);
  const changed=crlf.functions.filter((fn,i)=>fn.sha256!==lf.functions[i].sha256);assert.deepEqual(changed.map(fn=>fn.name),["portal_immutable_audit","portal_immutable_columns"]);
  target.prefix[2].hash=sha("unattested");assert.throws(()=>selectedRecordingsReference(s,target,21));assert.throws(()=>selectedRecordingsReference(s,target,22));
});
test("exactGit0020 source pin preserves historical operators and rejects future, dirty and changed bytes",async()=>{
  const isolation=await isolatedEnv();try{
    const realGit=(...args)=>execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024});
    const folder="src/server/db/migrations",names=realGit("ls-tree","-r","--name-only",RECORDINGS_BASE,"--",folder).toString("utf8").trim().split("\n");
    const committed=new Map([...names,...RELEASE_FILES,...ROSTER_FILES].map(path=>[path,realGit("show",`${RECORDINGS_BASE}:${path}`)]));
    for(const path of RECORDINGS_FILES)committed.set(path,readFileSync(new URL("../"+path,import.meta.url)));
    const fixture=()=>{const files=new Map(committed);let dirty=false,extra=false;
      const git=(...args)=>{if(args[0]==="rev-parse")return Buffer.from(candidate);if(args[0]==="merge-base")return Buffer.alloc(0);if(args[0]==="status")return Buffer.from(dirty?"?? changed":"");
        if(args[0]==="ls-tree" && args[3]===candidate)return Buffer.from([...names,...(extra?[folder+"/0021_unreviewed.sql"]:[])].join("\n"));
        if(args[0]==="show" && args[1].startsWith(candidate+":"))return committed.get(args[1].slice(41));return realGit(...args);};
      return {files,git,read:path=>files.get(path),dirty(){dirty=true;},extra(){extra=true;}};};
    assert.equal(recordingsSourceContract(candidate,fixture()).migrations.length,21);
    assert.throws(()=>sourceContract(candidate,fixture()));assert.throws(()=>rosterSourceContract(candidate,fixture()));
    for(const change of [f=>f.files.set(names[0],Buffer.from("changed")),f=>f.files.set(RELEASE_FILES[0],Buffer.from("changed")),f=>f.files.set(ROSTER_FILES[0],Buffer.from("changed")),f=>f.files.set(RECORDINGS_FILES[0],Buffer.from("changed")),f=>f.dirty(),f=>f.extra()]){const f=fixture();change(f);assert.throws(()=>recordingsSourceContract(candidate,f));}
    const f=fixture(),checked=recordingsSourceContract(candidate,f);f.files.set(names[0],Buffer.from("changed"));assert.throws(()=>checked.recheck());
  }finally{await isolation.cleanup();}
});
