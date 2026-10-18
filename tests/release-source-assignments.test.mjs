import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { RELEASE_BASE, RELEASE_FILES, sha, parseTarget, argumentsFor } from "../scripts/release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "../scripts/release-migrate-roster-support.mjs";
import { RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference, selectedRecordingsReference, recordingsSourceContract } from "../scripts/release-migrate-recordings-support.mjs";
import { SOURCE_ASSIGNMENTS_BASE, SOURCE_ASSIGNMENTS_FILES, SOURCE_ASSIGNMENTS_REFERENCE, sourceAssignmentsSourceContract, checkSourceAssignmentsLedger, selectedSourceAssignmentsReference, validateSourceAssignmentsReference } from "../scripts/release-migrate-source-assignments-support.mjs";
import { captureSourceAssignmentsData, executeSourceAssignmentsRelease, runSourceAssignmentsRelease } from "../scripts/release-migrate-source-assignments.mjs";
const candidate="a".repeat(40),json=path=>JSON.parse(readFileSync(new URL("../"+path,import.meta.url)));
function source(){
  const extra=json(SOURCE_ASSIGNMENTS_REFERENCE),recordings=json(RECORDINGS_REFERENCE),old=json("tests/fixtures/portal/release-migrate-reference.json"),roster=json(ROSTER_REFERENCE);
  const migrations=Array.from({length:22},(_,index)=>({index,hash:sha(`LF${index}`),historicalAllowed:[sha(`LF${index}`)],createdAt:1000+index}));
  migrations[19].hash=roster.migrationSHA256;migrations[20].hash=recordings.migrationSHA256;migrations[21].hash=extra.migrationSHA256;
  const s={migrations,reference:old,historicalFunctions:old.historicalFunctions,studentAfter:validateRosterReference(roster,old,roster.migrationSHA256),recheck(){}};
  s.recordingsAfter=validateRecordingsReference(recordings,s);s.sourceAssignmentsAfter=validateSourceAssignmentsReference(extra,s);return s;
}
function manifest(s){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require");url.username="release_owner";url.password="synthetic-password";return {version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((row,i)=>({id:i+1,hash:row.hash,createdAt:row.createdAt})),provenance:{sourceCommit:RELEASE_BASE,method:"owner-readonly",observedAt:"2026-10-17T00:00:00.000Z"}};}
const ledger=(s,length)=>s.migrations.slice(0,length).map((row,i)=>({id:i+1,hash:row.hash,created_at:String(row.createdAt)}));
function harness(options={}){
 const s=source(),target=parseTarget(manifest(s),s),events=[];let length=options.already?22:21,calls=0,ended=0,reads=0,rechecks=0;
 s.recheck=()=>{events.push("source");if(options.sourceFailure || options.lateSource && ++rechecks===3)throw new Error("Synthetic private source");};
 const client=Object.assign(new EventEmitter(),{async connect(){events.push("connect");if(options.connectFailure)throw new Error("Synthetic private connect");},async end(){ended++;if(options.endFailure)throw 0;},async query(sql){events.push(sql);
  if(sql.includes("pg_try_advisory_lock"))return {rows:[{locked:!options.locked}]};if(sql.includes("pg_advisory_unlock"))return {rows:[{unlocked:!options.cleanupFailure}]};
  if(sql.includes("FROM drizzle.__drizzle_migrations"))return {rows:ledger(s,length)};if(sql.includes("SELECT NOT EXISTS"))return {rows:[{clear:!options.nonEmpty}]};return {rows:[]};}});
 const checks={transport(){if(options.transportFailure)throw 0;},async identity(){if(options.identityFailure)throw 0;},async catalog(){return selectedSourceAssignmentsReference(s,target,length);},verifyCatalog(actual,expected){assert.deepEqual(actual,expected);if(options.catalogFailure)throw 0;},async roles(){return options.postRoleChange&&length===22?["changed"]:["same"];},async data(){reads++;if(options.idleError)client.emit("error",new Error("Synthetic private client"));return [{name:"student_recording",count:1,digest:options.preChange&&reads===2||options.postChange&&length===22?"changed":"same"}];}};
 const migrate=async value=>{events.push("migrate");assert.equal(value,client);calls++;if(options.migrateFailure)throw new Error("Synthetic lost acknowledgement");length=22;};
 return {s,target,client,checks,migrate,events,get calls(){return calls;},get ended(){return ended;}};
}
const execute=(h,apply=true)=>executeSourceAssignmentsRelease(h.s,h.target,{apply,checks:h.checks,connect:()=>h.client,migrate:h.migrate});
test("0021 is check-only by default and refuses source before opening protected target",async()=>{
 assert.equal(argumentsFor(["--expected-commit",candidate,"--target","private.json"]).apply,false);let reads=0;
 assert.deepEqual(await runSourceAssignmentsRelease(["--expected-commit",candidate,"--target","private.json"],{source(){throw 0;},readTarget(){reads++;}}),{ok:false,phase:"source",outcome:"not-started",apply:false});assert.equal(reads,0);
 for(const args of [[],["--apply"],["--expected-commit",candidate,"--target","x","--retry"]])assert.equal((await runSourceAssignmentsRelease(args)).phase,"arguments");
});
test("only exact21 baseline or exact22 result can be selected, never a future or changed row",()=>{
 const s=source(),target=parseTarget(manifest(s),s);assert.equal(checkSourceAssignmentsLedger(ledger(s,21),s,target).length,21);assert.equal(checkSourceAssignmentsLedger(ledger(s,22),s,target).length,22);
 for(const rows of [ledger(s,20),[...ledger(s,22),{id:23}],ledger(s,22).map((r,i)=>i===21?{...r,hash:sha("other")}:r),ledger(s,22).map((r,i)=>i===21?{...r,id:21}:r),ledger(s,21).map((r,i)=>i===20?{...r,created_at:"1"}:r)])assert.throws(()=>checkSourceAssignmentsLedger(rows,s,target));
});
test("one client check/apply/already-applied never automatically replays or leaks listeners",async()=>{
 for(const[options,apply,outcome,calls,rows]of [[{},false,"checked",0,21],[{},true,"applied",1,22],[{already:true},true,"already-applied",0,22]]){const h=harness(options),r=await execute(h,apply);assert.deepEqual(r,{ok:true,phase:"complete",outcome,apply,ledgerRows:rows});assert.equal(h.calls,calls);assert.equal(h.ended,1);assert.equal(h.client.listenerCount("error"),0);assert.equal(h.events[0],"source");}
});
test("transport, identity, advisory lock, source and changed preflight snapshots refuse before DDL",async()=>{
 for(const options of [{sourceFailure:true},{lateSource:true},{locked:true},{identityFailure:true},{transportFailure:true},{catalogFailure:true},{idleError:true},{preChange:true},{connectFailure:true}]){const h=harness(options),r=await execute(h);assert.equal(r.ok,false);assert.equal(r.outcome,"not-started");assert.equal(h.calls,0);assert.ok(!JSON.stringify(r).includes("Synthetic"));assert.equal(h.client.listenerCount("error"),0);}
});
test("unknown acknowledgement, postcommit catalog/data/role and nonempty new table are held distinctly",async()=>{
 for(const[options,outcome]of [[{migrateFailure:true},"unknown"],[{postChange:true},"committed-verification-conflict"],[{postRoleChange:true},"committed-verification-conflict"],[{nonEmpty:true},"committed-verification-conflict"],[{cleanupFailure:true},"applied"],[{endFailure:true},"applied"]]){const h=harness(options),r=await execute(h);assert.equal(r.ok,false);assert.equal(r.outcome,outcome);assert.equal(h.calls,1);assert.equal(h.ended,1);assert.equal(h.client.listenerCount("error"),0);}
 const already=harness({already:true,nonEmpty:true});assert.equal((await execute(already)).ok,false);assert.equal(already.calls,0);
});
test("data protection includes populated student recordings and all existing tables, excluding ONLY the empty new table",async()=>{
 const seen=[];const client={async query(sql){seen.push(sql);return {rows:[{count:1,digest:"a".repeat(64)}]};}};
 const rows=await captureSourceAssignmentsData(client,["student","student_recording","verse_source_assignment"]);assert.deepEqual(rows.map(r=>r.name),["student","student_recording"]);assert.ok(seen.some(sql=>sql.includes('public."student_recording"')));assert.ok(seen.every(sql=>!sql.includes('public."verse_source_assignment"')));
});
test("native after-hash and precise FK/audit/function/rowtype delta never widen old catalog fields",()=>{
 const s=source(),reference=json(SOURCE_ASSIGNMENTS_REFERENCE);assert.ok(validateSourceAssignmentsReference(reference,s));
 for(const mutate of [r=>r.after.tables.find(t=>t.name==="verse_source_assignment").force_rls=false,r=>r.after.tables.find(t=>t.name==="student").triggers.pop(),r=>r.before.tables.find(t=>t.name==="assignment").constraints.pop(),r=>r.after.functions[0].security_definer=true,r=>r.after.functions[0].source+=" ",r=>r.after.types[0].owner="PUBLIC",r=>r.migrationSHA256=sha("other"),r=>r.extra=true]){const bad=structuredClone(reference);mutate(bad);assert.throws(()=>validateSourceAssignmentsReference(bad,s));}
});
test("exclusive historical CRLF attestation changes only expected old functions and never new0021 helpers",()=>{
 const s=source();s.migrations[2].historicalAllowed.push(sha("CRLF2"));const target=parseTarget(manifest(s),s),lf=selectedSourceAssignmentsReference(s,target,22);target.prefix[2].hash=s.migrations[2].historicalAllowed[1];const crlf=selectedSourceAssignmentsReference(s,target,22);
 assert.deepEqual(crlf.tables,lf.tables);assert.deepEqual(crlf.types,lf.types);assert.deepEqual(crlf.functions.filter((fn,i)=>fn.sha256!==lf.functions[i].sha256).map(fn=>fn.name),["portal_immutable_audit","portal_immutable_columns"]);
 for(const name of ["portal_source_citations_valid","portal_source_plain"])assert.deepEqual(crlf.functions.find(fn=>fn.name===name),lf.functions.find(fn=>fn.name===name));
 target.prefix[2].hash=sha("unattested");assert.throws(()=>selectedSourceAssignmentsReference(s,target,22));assert.throws(()=>selectedSourceAssignmentsReference(s,target,23));
});
test("new Git source contract pins fullcoretree/oldhelpers/ownHEAD and refuses dirty, future or changed bytes",async()=>{
 const isolation=await isolatedEnv();try{
  const cache=new Map(),realGit=(...args)=>{const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024}));return cache.get(key);};
  const folder="src/server/db/migrations",names=realGit("ls-tree","-r","--name-only",SOURCE_ASSIGNMENTS_BASE,"--",folder).toString("utf8").trim().split("\n"),oldFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES];
  const committed=new Map([...names,...oldFiles].map(path=>[path,realGit("show",`${SOURCE_ASSIGNMENTS_BASE}:${path}`)]));for(const path of SOURCE_ASSIGNMENTS_FILES)committed.set(path,readFileSync(new URL("../"+path,import.meta.url)));
  const fixture=()=>{const files=new Map(committed);let dirty=false,extra=false;const git=(...args)=>{if(args[0]==="rev-parse")return Buffer.from(candidate);if(args[0]==="merge-base")return Buffer.alloc(0);if(args[0]==="status")return Buffer.from(dirty?"?? changed":"");if(args[0]==="ls-tree"&&args[3]===candidate)return Buffer.from([...names,...(extra?[folder+"/0022_unreviewed.sql"]:[])].join("\n"));if(args[0]==="show"&&args[1].startsWith(candidate+":"))return committed.get(args[1].slice(41));return realGit(...args);};return {files,git,read:path=>files.get(path),dirty(){dirty=true;},extra(){extra=true;}};};
  assert.equal(sourceAssignmentsSourceContract(candidate,fixture()).migrations.length,22);assert.throws(()=>recordingsSourceContract(candidate,fixture()));
  for(const change of [f=>f.files.set(names[0],Buffer.from("changed")),f=>f.files.set(oldFiles[0],Buffer.from("changed")),f=>f.files.set(SOURCE_ASSIGNMENTS_FILES[0],Buffer.from("changed")),f=>f.files.set(folder+"/0021_verse_source_assignments.sql",Buffer.from("changed")),f=>f.dirty(),f=>f.extra()]){const f=fixture();change(f);assert.throws(()=>sourceAssignmentsSourceContract(candidate,f));}
  const f=fixture(),checked=sourceAssignmentsSourceContract(candidate,f);f.files.set(names[0],Buffer.from("changed"));assert.throws(()=>checked.recheck());
 }finally{await isolation.cleanup();}
});
