import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { ADULT_HONORS_BASE, ADULT_HONORS_FILES, ADULT_HONORS_REFERENCE, ADULT_HONORS_CAPTURE_COMMIT, ADULT_HONORS_REFERENCE_SHA, ADULT_HONORS_CATALOG_SHA, adultHonorsSourceDelta, adultHonorsReferenceSource, adultHonorsSourceContract, expectedAdultHonorsCatalog, validateAdultHonorsDelta, validateAdultHonorsReference, parseAdultHonorsTarget, checkAdultHonorsLedger } from "../scripts/release-migrate-adult-honors-support.mjs";
import { executeAdultHonorsRelease, runAdultHonorsRelease, captureAdultHonorsData } from "../scripts/release-migrate-adult-honors.mjs";
import { canonical, sha } from "../scripts/release-migrate-support.mjs";
const isolation=await isolatedEnv(),cache=new Map();
function git(...args){const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024}));return Buffer.from(cache.get(key));}
test.after(()=>isolation.cleanup());
const folder="src/server/db/migrations",candidate="a".repeat(40),tree=ref=>git("ls-tree","-r","--name-only",ref,"--",folder).toString().trim().split("\n"),blob=(ref,path)=>git("show",ref+":"+path);
const sql=blob(ADULT_HONORS_BASE,folder+"/0024_adult_self_honors.sql").toString(),native=JSON.parse(readFileSync("tests/fixtures/portal/release-honoree-reference.json"));
function sourceFixture(){
 const files=new Map(),committed=new Map(),events=[];let dirty=false,future=false,ancestor=true,head=candidate;
 for(const path of tree(ADULT_HONORS_BASE))files.set(path,blob(ADULT_HONORS_BASE,path));
 for(const path of ADULT_HONORS_FILES)files.set(path,readFileSync(path));
 for(const[path,bytes]of files)committed.set(path,Buffer.from(bytes));
 const injected=(...args)=>{events.push(args);if(args[0]==="rev-parse")return Buffer.from(head);if(args[0]==="merge-base"){if(!ancestor)throw 0;return Buffer.from("");}if(args[0]==="status")return Buffer.from(dirty?"?? synthetic drift":"");if(args[0]==="ls-tree")return Buffer.from((args[3]===candidate?[...tree(ADULT_HONORS_BASE),...(future?[folder+"/0025_unreviewed.sql"]:[])]:tree(args[3])).join("\n"));if(args[0]==="show"){const colon=args[1].indexOf(":"),ref=args[1].slice(0,colon),path=args[1].slice(colon+1);return ref===candidate?committed.get(path)??blob(ADULT_HONORS_BASE,path):blob(ref,path);}throw Error("Unexpected synthetic Git command");};
 return{git:injected,read:path=>files.get(path)??blob(ADULT_HONORS_BASE,path),files,committed,events,dirty(){dirty=true;},future(){future=true;},ancestor(){ancestor=false;},head(){head="b".repeat(40);}};
}
function source(){const s=adultHonorsReferenceSource(candidate,sourceFixture());s.adultHonorsBefore=native.after;s.adultHonorsAfter=validateAdultHonorsDelta({before:native.after,after:expectedAdultHonorsCatalog(native.after,sql)},sql);return s;}
function target(s,mutate=()=>{}){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require&channel_binding=require");url.username="release_owner";url.password="synthetic-password";const value={version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((m,i)=>({id:i+1,hash:m.hash,createdAt:m.createdAt})),provenance:{sourceCommit:s.reference.sourceCommit,method:"owner-readonly",observedAt:"2026-10-20T00:00:00.000Z"}};mutate(value);return parseAdultHonorsTarget(value,s);}
const ledger=(s,n)=>s.migrations.slice(0,n).map((m,i)=>({id:i+1,hash:m.hash,created_at:String(m.createdAt)}));
function harness(o={}){
 const s=source(),t=target(s),events=[];let length=o.already?25:24,calls=0,reads=0,rechecks=0,nullReads=0,ends=0;
 s.recheck=()=>{events.push("source");if(++rechecks===o.sourceAt)throw 0;};
 const client=Object.assign(new EventEmitter(),{async connect(){events.push("connect");},async end(){ends++;if(o.end)throw 0;},async query(text){events.push(text);if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:!o.locked}]};if(text.includes("pg_advisory_unlock"))return{rows:[{unlocked:!o.unlock}]};if(text.includes("drizzle.__drizzle_migrations"))return{rows:ledger(s,length)};return{rows:[]};}});
 const checks={transport(){if(o.transport)throw 0;},async identity(){if(o.identity)throw 0;},async catalog(){return{tables:[{name:"honors_version"},{name:"honoree_material_release"}],functions:[],types:[]};},verifyCatalog(){if(o.catalog)throw 0;},async roles(){return o.roles&&length===25?["drift"]:["same"];},async data(){reads++;if(o.idle)client.emit("error",Error("Synthetic private driver"));return[{name:"honors_version",count:2,digest:o.data&&length===25?"drift":o.recheck&&reads===2?"drift":"same"},{name:"honoree_material_release",count:1,digest:"same"}];},async nullTransition(){nullReads++;return !o.nonNull;}};
 const migrate=async value=>{assert.equal(value,client);calls++;if(o.rollback)throw 0;length=25;if(o.lost)throw 0;};
 return{s,t,events,client,checks,migrate,get calls(){return calls;},get nullReads(){return nullReads;},get ends(){return ends;},run(apply=true){return executeAdultHonorsRelease(s,t,{apply,checks,connect:()=>client,migrate});}};
}
test("installed independently accepted native reference has exact byte/catalog/capture pins and complete source proof",()=>{
 const bytes=readFileSync(ADULT_HONORS_REFERENCE),reference=JSON.parse(bytes),before=JSON.stringify(reference);
 assert.match(ADULT_HONORS_CAPTURE_COMMIT,/^[a-f0-9]{40}$/);assert.match(ADULT_HONORS_REFERENCE_SHA,/^[a-f0-9]{64}$/);assert.match(ADULT_HONORS_CATALOG_SHA,/^[a-f0-9]{64}$/);
 assert.equal(reference.evidence,"owned-native-capture");assert.equal(reference.sourceCommit,ADULT_HONORS_CAPTURE_COMMIT);assert.equal(reference.migrationSHA256,sha(sql));
 assert.equal(sha(bytes),ADULT_HONORS_REFERENCE_SHA);assert.equal(bytes.includes(13),false);assert.equal(sha(JSON.stringify(canonical(reference.after))),ADULT_HONORS_CATALOG_SHA);
 assert.ok(blob(ADULT_HONORS_CAPTURE_COMMIT,folder+"/0024_adult_self_honors.sql").equals(Buffer.from(sql)));
 const fixture=sourceFixture(),s=adultHonorsSourceContract(candidate,fixture);assert.deepEqual(validateAdultHonorsReference(bytes,s),s.adultHonorsAfter);assert.deepEqual(s.adultHonorsBefore,reference.before);s.recheck();
 assert.equal(reference.before.tables.length,39);assert.equal(reference.after.tables.length,39);assert.equal(JSON.stringify(reference),before);
});
test("model/corrupt native references refuse before target read or connect with no bypass",async()=>{
 const installed=readFileSync(ADULT_HONORS_REFERENCE),crlf=Buffer.from(installed.toString("utf8").replace(/\n/g,"\r\n"));
 assert.deepEqual(JSON.parse(crlf),JSON.parse(installed));assert.notEqual(sha(crlf),ADULT_HONORS_REFERENCE_SHA);
 for(const value of [Buffer.from(JSON.stringify({version:1,evidence:"MODEL ONLY - structural fixture"})),Buffer.from(JSON.stringify({...native,sourceCommit:candidate})),Buffer.from("null"),crlf,Buffer.concat([installed,Buffer.from(" ")])]){
  const f=sourceFixture();f.files.set(ADULT_HONORS_REFERENCE,value);f.committed.set(ADULT_HONORS_REFERENCE,value);let reads=0,connects=0;
  assert.throws(()=>validateAdultHonorsReference(value,source()));
  const result=await runAdultHonorsRelease(["--expected-commit",candidate,"--target","synthetic.json"],{source:commit=>adultHonorsSourceContract(commit,f),readTarget(){reads++;},execution:{connect(){connects++;}}});
  assert.deepEqual(result,{ok:false,phase:"source",outcome:"not-started",apply:false});assert.equal(reads,0);assert.equal(connects,0);
 }
 for(const flag of ["--allow-model","--force","--retry"])assert.equal((await runAdultHonorsRelease(["--expected-commit",candidate,"--target","synthetic.json",flag])).phase,"arguments");
});
test("exact25 committed source and complete historical prefix are sealed with live rechecks",()=>{
 const f=sourceFixture(),s=adultHonorsSourceDelta(candidate,f);assert.equal(s.migrations.length,25);assert.equal(s.migrations[24].tag,"0024_adult_self_honors");assert.equal(s.migrations[24].hash,sha(sql));s.recheck();
 for(const mutate of [f=>f.dirty(),f=>f.future(),f=>f.ancestor(),f=>f.head(),f=>f.files.set(ADULT_HONORS_FILES[0],Buffer.from("drift")),f=>f.files.set("scripts/release-migrate-honoree.mjs",Buffer.from("drift")),f=>f.files.set(folder+"/0023_honoree_links.sql",Buffer.from("drift")),f=>{const path=folder+"/meta/_journal.json",j=JSON.parse(f.files.get(path));j.entries[0].when++;f.files.set(path,Buffer.from(JSON.stringify(j)));}]){const fixture=sourceFixture();mutate(fixture);assert.throws(()=>adultHonorsSourceDelta(candidate,fixture));}
 for(const path of [ADULT_HONORS_FILES[0],folder+"/meta/0024_snapshot.json"]){const live=sourceFixture(),sealed=adultHonorsSourceDelta(candidate,live);live.files.get(path)[0]^=1;assert.throws(()=>sealed.recheck());}
});
test("exact catalog model permits only3columns/3FK/12RI triggers/actor checks/kind predicate",()=>{
 const after=expectedAdultHonorsCatalog(native.after,sql);validateAdultHonorsDelta({before:native.after,after},sql);
 for(const mutate of [r=>r.types.pop(),r=>r.tables.find(t=>t.name==="student_identity").triggers.pop(),r=>r.tables.find(t=>t.name==="honors_version").columns.at(-1).not_null=true,r=>r.functions.find(f=>f.name==="portal_honoree_student_epoch").security_definer=true,r=>r.functions.find(f=>f.name==="portal_honoree_student_epoch").source+=" ",r=>r.tables.find(t=>t.name==="honoree_link").constraints.find(c=>c.name.endsWith("student_identity_fk")).referenced_keys[0]=1,r=>r.tables.find(t=>t.name==="honoree_material_release").grants=[]]){const changed=structuredClone(after);mutate(changed);assert.throws(()=>validateAdultHonorsDelta({before:native.after,after:changed},sql));}
 assert.equal(after.tables.find(t=>t.name==="student_identity").triggers.length-native.after.tables.find(t=>t.name==="student_identity").triggers.length,6);
});
test("data capture includes every old column and every other table including material/epochs",async()=>{
 const s=source(),queries=[],names=native.after.tables.map(t=>t.name),client={async query(q){queries.push(q);return{rows:[{count:2,digest:"0".repeat(64)}]};}};
 const data=await captureAdultHonorsData(client,names,s);assert.deepEqual(data.map(t=>t.name).sort(),names.sort());
 for(const name of ["honors_version","honoree_link","honoree_operation"]){const q=queries.find(q=>q.includes(`FROM public."${name}"`));for(const c of native.after.tables.find(t=>t.name===name).columns)assert.ok(q.includes(`"${c.name}"`));assert.ok(!q.includes("student_identity_id"));}
 assert.equal(queries.length,names.length);assert.ok(queries.every(q=>q.includes("LIMIT 100001")&&q.includes("string_agg")));
 await assert.rejects(()=>captureAdultHonorsData({async query(){return{rows:[{count:100001,digest:"0".repeat(64)}]};}},names,s));
});
test("exact ledger refuses duplicate/newer/mismatched migration and retains historical hashes",()=>{
 const s=source(),t=target(s);for(const n of [24,25])assert.equal(checkAdultHonorsLedger(ledger(s,n),s,t).length,n);
 for(const rows of [ledger(s,23),[...ledger(s,25),{id:26,hash:"0".repeat(64),created_at:"999"}]])assert.throws(()=>checkAdultHonorsLedger(rows,s,t));
 for(const mutate of [rows=>rows[24].hash="0".repeat(64),rows=>rows[24].id=rows[23].id,rows=>rows[24].created_at="1",rows=>rows[0].hash="0".repeat(64)]){const bad=ledger(s,25);mutate(bad);assert.throws(()=>checkAdultHonorsLedger(bad,s,t));}
});
test("target requires direct TLS/channel-binding exact owner/OID/runtime/major/tenant/origin contract",()=>{
 const s=source(),good=target(s);assert.equal(good.requireChannelBinding,true);assert.equal(good.connection.enableChannelBinding,true);assert.equal(good.connection.ssl.rejectUnauthorized,true);
 for(const mutate of [v=>v.expected.serverMajor=16,v=>v.expected.tenantId="other",v=>v.expected.ownerOid="0",v=>v.expected.runtimeRole="portal_runtime",v=>v.expected.owner=v.expected.runtimeRole,v=>v.expected.canonicalOrigin="https://example.test",v=>v.expected.hostname="other.neon.tech",v=>v.migrationUrl=v.migrationUrl.replace("&channel_binding=require",""),v=>v.migrationUrl+="&connect_timeout=1",v=>v.migrationUrl=v.migrationUrl.replace("ep-synthetic.","ep-synthetic-pooler.")]){
  assert.throws(()=>target(s,mutate));
 }
});
test("check/apply performs exact preapply preservation and bounded timeout/lock lifecycle",async()=>{
 const checked=harness();assert.deepEqual(await checked.run(false),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:24});assert.equal(checked.calls,0);
 const f=harness();assert.deepEqual(await f.run(),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:25});assert.equal(f.calls,1);assert.equal(f.nullReads,1);assert.equal(f.ends,1);
 assert.ok(f.events.some(q=>q.includes("statement_timeout='12s'")&&q.includes("lock_timeout='5s'")&&q.includes("idle_in_transaction_session_timeout='15s'")));assert.ok(f.events.some(q=>q.includes("pg_advisory_unlock")));
});
test("already applied certifies current state without migration or original NULL assumption",async()=>{
 const f=harness({already:true,nonNull:true});assert.deepEqual(await f.run(),{ok:true,phase:"complete",outcome:"already-applied-current-state-verified",apply:true,ledgerRows:25});assert.equal(f.calls,0);assert.equal(f.nullReads,0);
 const bad=harness({already:true,catalog:true});assert.equal((await bad.run()).outcome,"observed-applied-current-state-unverified");
});
test("source/transport/identity/catalog/lock/recheck refusals never attempt migration",async()=>{
 for(const o of [{sourceAt:1},{sourceAt:2},{transport:true},{identity:true},{catalog:true},{locked:true},{recheck:true}]){const f=harness(o);assert.equal((await f.run()).ok,false);assert.equal(f.calls,0);}
});
test("migration exceptions and lost acknowledgement stay unknown, with no automatic retry",async()=>{
 for(const o of [{rollback:true},{lost:true}]){const f=harness(o),result=await f.run();assert.equal(result.ok,false);assert.equal(result.outcome,"unknown");assert.equal(f.calls,1);}
});
test("postcommit data/role/NULL/source mismatches remain committed verification conflicts",async()=>{
 for(const o of [{data:true},{roles:true},{nonNull:true},{sourceAt:4}]){const f=harness(o),result=await f.run();assert.equal(result.ok,false);assert.equal(result.outcome,"committed-verification-conflict");assert.equal(f.calls,1);}
});
test("idle driver and cleanup failures are private failures without rollback or retry claims",async()=>{
 for(const o of [{idle:true},{unlock:true},{end:true}]){const f=harness(o),result=await f.run();assert.equal(result.ok,false);assert.equal(result.phase,"cleanup");assert.ok(!JSON.stringify(result).includes("private driver"));assert.ok(f.calls<=1);}
});
