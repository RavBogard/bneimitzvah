import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {isolatedEnv} from "./helpers/isolatedEnv.mjs";
import {argumentsFor,RELEASE_BASE,RELEASE_FILES,sha,parseTarget,sourceContract} from "../scripts/release-migrate-support.mjs";
import {ROSTER_BASE,ROSTER_FILES,ROSTER_REFERENCE,rosterSourceContract,checkRosterLedger,selectedRosterReference,validateRosterReference} from "../scripts/release-migrate-roster-support.mjs";
import {runRosterRelease,executeRosterRelease} from "../scripts/release-migrate-roster.mjs";
const candidate="b".repeat(40);
function source(){return {migrations:Array.from({length:20},(_,index)=>({index,hash:sha(`LF${index}`),historicalAllowed:[sha(`LF${index}`)],createdAt:1000+index})),reference:{final:{tables:[{name:"student",value:"old"}],functions:[],types:[]}},studentAfter:{name:"student",value:"new"},recheck(){}};}
function manifest(s){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require");url.username="release_owner";url.password="synthetic-password";return {version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((row,i)=>({id:i+1,hash:row.hash,createdAt:row.createdAt})),provenance:{sourceCommit:RELEASE_BASE,method:"owner-readonly",observedAt:"2026-10-17T00:00:00.000Z"}};}
const ledger=(s,length)=>s.migrations.slice(0,length).map((row,i)=>({id:i+1,hash:row.hash,created_at:String(row.createdAt)}));
function harness(options={}){
  const s=source(),target=parseTarget(manifest(s),s);let length=options.already?20:19,migrations=0,ended=0,reads=0;
  const client=Object.assign(new EventEmitter(),{async connect(){},async end(){ended++;},async query(sql){
    if(sql.includes("pg_try_advisory_lock"))return {rows:[{locked:!options.locked}]};
    if(sql.includes("pg_advisory_unlock"))return {rows:[{unlocked:true}]};
    if(sql.includes("FROM drizzle.__drizzle_migrations"))return {rows:ledger(s,length)};
    if(sql.includes("SELECT NOT EXISTS"))return {rows:[{clear:!options.nonNull}]};
    return {rows:[]};}});
  const checks={transport(){if(options.transportFailure)throw new Error("Private transport");},async identity(){if(options.identityFailure)throw new Error("Private identity");},async catalog(){return {tables:length===20?[s.studentAfter]:s.reference.final.tables,functions:[],types:[]};},verifyCatalog(actual,expected){assert.deepEqual(actual,expected);},async roles(){return ["same"];},async data(){reads++;if(options.idleError)client.emit("error",new Error("Private idle failure"));return [{name:"student",count:1,digest:options.preflightChange && reads===2?"changed":options.postChange && length===20?"changed":"same"}];}};
  const migrate=async value=>{assert.equal(value,client);migrations++;if(options.migrateFailure)throw new Error("Private commit acknowledgement");length=20;};
  return {s,target,client,checks,migrate,get migrations(){return migrations;},get ended(){return ended;}};
}
const execute=(h,apply=true)=>executeRosterRelease(h.s,h.target,{apply,checks:h.checks,connect:()=>h.client,migrate:h.migrate});

test("0019 entrypoint defaults to check-only and rejects bad source before private target access",async()=>{
  assert.equal(argumentsFor(["--expected-commit",candidate,"--target","private.json"]).apply,false);
  let reads=0;
  const result=await runRosterRelease(["--expected-commit",candidate,"--target","private.json"],{source(){throw new Error("private source");},readTarget(){reads++;}});
  assert.deepEqual(result,{ok:false,phase:"source",outcome:"not-started",apply:false});assert.equal(reads,0);
});
test("0019 ledger accepts only exact nineteen baseline or its single twentieth row, preserving the old target contract",()=>{
  const s=source(),target=parseTarget(manifest(s),s);
  assert.equal(checkRosterLedger(ledger(s,19),s,target).length,19);assert.equal(checkRosterLedger(ledger(s,20),s,target).length,20);
  for(const rows of [ledger(s,15),[...ledger(s,20),{id:21}],ledger(s,20).map((row,i)=>i===19?{...row,hash:sha("other")}:row),ledger(s,19).map((row,i)=>i===16?{...row,created_at:"1"}:row),ledger(s,20).map((row,i)=>i===19?{...row,id:19}:row)])assert.throws(()=>checkRosterLedger(rows,s,target));
});
test("check-only, apply and idempotence use one client with fixed cleanup and no import action",async()=>{
  for(const[options,apply,outcome,count]of [[{},false,"checked",0],[{},true,"applied",1],[{already:true},true,"already-applied",0]]){
    const h=harness(options),result=await execute(h,apply);assert.equal(result.ok,true);assert.equal(result.outcome,outcome);assert.equal(result.ledgerRows,count===1 || options.already?20:19);assert.equal(h.migrations,count);assert.equal(h.ended,1);assert.equal(h.client.listenerCount("error"),0);
  }
});
test("lock, identity, transport, idle errors and changed preflight stop before migration without leaking diagnostics",async()=>{
  for(const options of [{locked:true},{identityFailure:true},{transportFailure:true},{idleError:true},{preflightChange:true}]){
    const h=harness(options),result=await execute(h);assert.equal(result.ok,false);assert.equal(result.outcome,"not-started");assert.equal(h.migrations,0);assert.equal(h.ended,1);assert.ok(!JSON.stringify(result).includes("Private"));
  }
});
test("lost migration acknowledgement stays unknown; changed rows or populated new columns stay committed conflicts",async()=>{
  for(const[options,outcome]of [[{migrateFailure:true},"unknown"],[{postChange:true},"committed-verification-conflict"],[{nonNull:true},"committed-verification-conflict"]]){
    const h=harness(options),result=await execute(h);assert.equal(result.ok,false);assert.equal(result.outcome,outcome);assert.equal(h.migrations,1);assert.equal(h.ended,1);
  }
});

test("pinned roster reference changes only three nullable student columns and three checks",()=>{
  const reference=JSON.parse(readFileSync(new URL("../"+ROSTER_REFERENCE,import.meta.url))),old=JSON.parse(readFileSync(new URL("./fixtures/portal/release-migrate-reference.json",import.meta.url)));
  const student=validateRosterReference(reference,old,reference.migrationSHA256);assert.equal(student.name,"student");
  for(const mutate of [r=>r.after.owner="PUBLIC",r=>r.after.columns[0].type="text",r=>r.after.columns.at(-1).not_null=true,r=>r.after.grants.push({role:"PUBLIC"}),r=>r.after.constraints.at(-1).enforced=false,r=>r.after.constraints.find(c=>c.name==="student_import_metadata_closed").definition="CHECK (import_metadata IS NULL OR true)",r=>r.sourceCommit=candidate,r=>r.extra=true]){
    const bad=structuredClone(reference);mutate(bad);assert.throws(()=>validateRosterReference(bad,old,reference.migrationSHA256));
  }
});
test("selected old historical encoding remains exact and all non-student catalog fields stay unchanged",()=>{
  const reference=JSON.parse(readFileSync(new URL("../"+ROSTER_REFERENCE,import.meta.url))),old=JSON.parse(readFileSync(new URL("./fixtures/portal/release-migrate-reference.json",import.meta.url)));
  const s=source();s.reference=old;s.studentAfter=validateRosterReference(reference,old,reference.migrationSHA256);
  const target=parseTarget(manifest(s),s),before=selectedRosterReference(s,target,19),after=selectedRosterReference(s,target,20);
  assert.deepEqual({...after,tables:before.tables},{...before});assert.deepEqual(after.tables.filter(t=>t.name!=="student"),before.tables.filter(t=>t.name!=="student"));
  assert.throws(()=>selectedRosterReference(s,target,21));
});
test("new source guard pins every prior migration and only the exact 0019 append; old operator is not widened",async()=>{
  const isolation=await isolatedEnv();
  try{
    const realGit=(...args)=>execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024});
    const folder="src/server/db/migrations",names=realGit("ls-tree","-r","--name-only",ROSTER_BASE,"--",folder).toString("utf8").trim().split("\n");
    const committed=new Map([...names,...RELEASE_FILES].map(path=>[path,realGit("show",`${ROSTER_BASE}:${path}`)]));
    for(const path of ROSTER_FILES)committed.set(path,readFileSync(new URL("../"+path,import.meta.url)));
    const fixture=()=>{
      const files=new Map(committed);let dirty=false,extra=false;
      const git=(...args)=>{
        if(args[0]==="rev-parse")return Buffer.from(candidate);
        if(args[0]==="merge-base")return Buffer.alloc(0);
        if(args[0]==="status")return Buffer.from(dirty?"?? private-name":"");
        if(args[0]==="ls-tree" && args[3]===candidate)return Buffer.from([...names,...(extra?[folder+"/0020_unreviewed.sql"]:[])].join("\n"));
        if(args[0]==="show" && args[1].startsWith(candidate+":"))return committed.get(args[1].slice(41));
        return realGit(...args);
      };
      return {files,git,read:path=>files.get(path),dirty(){dirty=true;},extra(){extra=true;}};
    };
    assert.equal(rosterSourceContract(candidate,fixture()).migrations.length,20);
    assert.throws(()=>sourceContract(candidate,fixture()),"old 0018 guard must reject the extended tree");
    for(const change of [f=>f.files.set(names.find(path=>path.endsWith("0002_tenant_security.sql")),Buffer.from("changed")),f=>f.files.set(RELEASE_FILES[0],Buffer.from("changed")),f=>f.files.set(ROSTER_FILES[0],Buffer.from("changed")),f=>f.dirty(),f=>f.extra()]){
      const f=fixture();change(f);assert.throws(()=>rosterSourceContract(candidate,f));
    }
    const f=fixture(),checked=rosterSourceContract(candidate,f);f.files.set(names[0],Buffer.from("changed"));assert.throws(()=>checked.recheck());
  }finally{await isolation.cleanup();}
});
