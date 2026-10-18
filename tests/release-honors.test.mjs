import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { RELEASE_BASE, RELEASE_FILES, sha, argumentsFor, canonical } from "../scripts/release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "../scripts/release-migrate-roster-support.mjs";
import { RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference } from "../scripts/release-migrate-recordings-support.mjs";
import { SOURCE_ASSIGNMENTS_BASE, SOURCE_ASSIGNMENTS_FILES, SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference } from "../scripts/release-migrate-source-assignments-support.mjs";
import { HONORS_BASE, HONORS_FILES, HONORS_CATALOG_SHA, HONORS_REFERENCE, HONORS_AFFECTED, honorsFunctionContract, honorsSourceDelta, honorsSourceContract, parseHonorsTarget, checkHonorsLedger, selectedHonorsReference, validateHonorsDelta, validateHonorsReference } from "../scripts/release-migrate-honors-support.mjs";
import { captureHonorsData, executeHonorsRelease, runHonorsRelease } from "../scripts/release-migrate-honors.mjs";
// Unit fixtures model the reviewed0022 release, independent of autocrlf checkout
// bytes and any later0023+ migration. Runtime source guards remain exact-byte.
const fixtureRelease="e774b9877121e586ef856d289e614f77bdda3280",candidate="a".repeat(40);
const isolation=await isolatedEnv();after(()=>isolation.cleanup());
const cache=new Map(),gitBytes=(...args)=>{
 const key=JSON.stringify(args);
 try{if(!cache.has(key))cache.set(key,execFileSync("git",args,{cwd:new URL("..",import.meta.url),env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"]}));return cache.get(key);}
 catch{throw Error("Reviewed honors test fixture unavailable; details withheld");}
};
const blob=(commit,path)=>gitBytes("show",commit+":"+path),read=path=>blob(fixtureRelease,path),json=path=>JSON.parse(read(path));
const folder="src/server/db/migrations",journal=JSON.parse(blob(HONORS_BASE,folder+"/meta/_journal.json"));
const tree=commit=>gitBytes("ls-tree","-r","--name-only",commit,"--",folder).toString("utf8").trim().split("\n");
const sql=blob(HONORS_BASE,folder+"/0022_honors_version.sql").toString("utf8");
function source(){
 const reference=json("tests/fixtures/portal/release-migrate-reference.json"),roster=json(ROSTER_REFERENCE),recordings=json(RECORDINGS_REFERENCE),citations=json(SOURCE_ASSIGNMENTS_REFERENCE);
 const migrations=Array.from({length:23},(_,index)=>({index,hash:sha(`synthetic-LF-${index}`),historicalAllowed:[sha(`synthetic-LF-${index}`)],createdAt:1000+index}));
 migrations[19].hash=roster.migrationSHA256;migrations[20].hash=recordings.migrationSHA256;migrations[21].hash=citations.migrationSHA256;migrations[22].hash=sha(sql);
 const s={migrations,reference,historicalFunctions:reference.historicalFunctions,studentAfter:validateRosterReference(roster,reference,migrations[19].hash),honorsSQL:sql,recheck(){}};
 s.recordingsAfter=validateRecordingsReference(recordings,s);s.sourceAssignmentsAfter=validateSourceAssignmentsReference(citations,s);
 s.honorsAfter=validateHonorsReference(json(HONORS_REFERENCE),s);return s;
}
function manifest(s){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require");url.username="release_owner";url.password="synthetic-password";return {version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((m,i)=>({id:i+1,hash:m.hash,createdAt:m.createdAt})),provenance:{sourceCommit:RELEASE_BASE,method:"owner-readonly",observedAt:"2026-10-18T00:00:00.000Z"}};}
const ledger=(s,length)=>s.migrations.slice(0,length).map((m,i)=>({id:i+1,hash:m.hash,created_at:String(m.createdAt)}));
function harness(o={}){
 const s=source(),target=parseHonorsTarget(manifest(s),s),events=[];let length=o.already?23:22,calls=0,ends=0,reads=0,rechecks=0;
 s.recheck=()=>{events.push("source");if(++rechecks===o.sourceAt)throw Error("Synthetic protected source");};
 const client=Object.assign(new EventEmitter(),{async connect(){events.push("connect");if(o.connect)throw Error("Synthetic private connect");},async end(){ends++;if(o.end)throw Error("Synthetic private close");},async query(text,args){events.push(text);if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:!o.locked}]};if(text.includes("pg_advisory_unlock"))return{rows:[{unlocked:!o.unlock}]};if(text.includes("drizzle.__drizzle_migrations"))return{rows:ledger(s,length)};if(text.includes("SELECT NOT EXISTS"))return{rows:[{clear:!o.nonempty}]};return{rows:[]};}});
 const checks={transport(){if(o.transport)throw 0;},async identity(){if(o.identity)throw 0;},async catalog(){return selectedHonorsReference(s,target,length);},verifyCatalog(a,b){assert.deepEqual(a,b);if(o.catalog||o.postCatalog&&length===23)throw 0;},async roles(){return o.postRoles&&length===23?["changed"]:["unchanged"];},async data(){reads++;if(o.idleError)client.emit("error",Error("Synthetic protected driver"));return[{name:"verse_source_assignment",count:2,digest:o.preData&&reads===2||o.postData&&length===23?"changed":"same"},{name:"student_recording",count:1,digest:"same"}];}};
 const migrate=async value=>{assert.equal(value,client);calls++;events.push("migrate");if(o.rollback)throw Error("Synthetic rollback acknowledgement");length=23;if(o.lostAck)throw Error("Synthetic lost committed acknowledgement");};
 return{s,target,client,checks,migrate,events,get calls(){return calls;},get ends(){return ends;},get length(){return length;},run(apply=true){return executeHonorsRelease(s,target,{apply,checks,connect:()=>client,migrate});}};
}
test("0022 source fails closed before protected target access; default is check-only and arguments are closed",async()=>{
 assert.equal(HONORS_CATALOG_SHA,"18db57f9825e7090085a38f4ccf8103c0a66c5aa998870fc2fa5fdb7179b69f6");assert.equal(argumentsFor(["--expected-commit",candidate,"--target","private.json"]).apply,false);let reads=0,connects=0;
 assert.deepEqual(await runHonorsRelease(["--expected-commit",candidate,"--target","private.json","--apply"],{source(){throw Error("Synthetic rejected source/reference");},readTarget(){reads++;},execution:{connect(){connects++;}}}),{ok:false,phase:"source",outcome:"not-started",apply:true});assert.equal(reads,0);assert.equal(connects,0);
 for(const args of [[],["--apply"],["--expected-commit",candidate,"--target","x","--retry"]])assert.equal((await runHonorsRelease(args)).phase,"arguments");
 const s=source();assert.throws(()=>validateHonorsReference({version:1,sourceCommit:HONORS_BASE,migrationSHA256:s.migrations[22].hash,before:{tables:[],functions:[],types:[]},after:{tables:[],functions:[],types:[]}},s));
});

test("accepted actual native reference is byte-pinned, merges all old catalog surfaces and rejects reference drift",()=>{
 const bytes=read(HONORS_REFERENCE),native=JSON.parse(bytes),s=source();
 assert.equal(sha(bytes),'0f3f96231d77b2c392c3ccf38a5d3a1ef69ec9bc08c9be40e91ee354dffb4379');
 assert.equal(sha(JSON.stringify(canonical(native.after))),HONORS_CATALOG_SHA);
 assert.ok(s.honorsAfter.tables.some(t=>t.name==='honors_version'));
 for(const old of s.sourceAssignmentsAfter.tables.filter(t=>!HONORS_AFFECTED.includes(t.name)))assert.deepEqual(s.honorsAfter.tables.find(t=>t.name===old.name),old);
 assert.ok(s.honorsAfter.tables.some(t=>t.name==='verse_source_assignment'));
 for(const mutate of [r=>r.after.tables.find(t=>t.name==='honors_version').force_rls=false,r=>r.after.functions[0].source+=' ',r=>r.before.tables[0].columns[0].type='text',r=>r.migrationSHA256=sha('changed'),r=>r.sourceCommit=candidate,r=>r.extra=true]){const changed=structuredClone(native);mutate(changed);assert.throws(()=>validateHonorsReference(changed,s));}
});
test("inherits exact direct TLS/channel binding/owner/runtime/provenance target contract without relaxation",()=>{
 const s=source(),good=manifest(s),target=parseHonorsTarget(good,s);assert.equal(target.connection.ssl.rejectUnauthorized,true);assert.equal(target.connection.ssl.servername,good.expected.hostname);assert.equal(target.connection.port,5432);
 for(const mutate of [v=>v.migrationUrl=v.migrationUrl.replace("ep-synthetic","ep-synthetic-pooler"),v=>v.migrationUrl=v.migrationUrl.replace("sslmode=require","sslmode=disable"),v=>v.expected.runtimeRole=v.expected.owner,v=>v.expected.ownerOid="0",v=>v.expected.serverMajor=16,v=>v.expected.tenantId="foreign",v=>v.expected.canonicalOrigin="https://foreign.invalid",v=>v.historicalPrefix.pop(),v=>v.historicalPrefix[0].hash=sha("foreign"),v=>v.provenance.method="guessed",v=>v.extra=true]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>parseHonorsTarget(bad,s));}
 const binding=structuredClone(good);binding.migrationUrl+="&channel_binding=require";assert.equal(parseHonorsTarget(binding,s).requireChannelBinding,true);
});
test("ledger accepts only exact22 baseline or exact23 result and rejects0023/future/hash/id/time drift",()=>{
 const s=source(),t=parseHonorsTarget(manifest(s),s);assert.equal(checkHonorsLedger(ledger(s,22),s,t).length,22);assert.equal(checkHonorsLedger(ledger(s,23),s,t).length,23);
 for(const rows of [ledger(s,21),[...ledger(s,23),{id:24}],ledger(s,23).map((r,i)=>i===22?{...r,hash:sha("other")}:r),ledger(s,23).map((r,i)=>i===22?{...r,id:22}:r),ledger(s,23).map((r,i)=>i===22?{...r,created_at:"1"}:r),ledger(s,22).map((r,i)=>i===21?{...r,hash:sha("prior changed")}:r)])assert.throws(()=>checkHonorsLedger(rows,s,t));
});
test("one-client check/apply/already states preserve lock/timeouts/listener cleanup and never auto replay",async()=>{
 for(const[o,apply,outcome,calls,length]of [[{},false,"checked",0,22],[{},true,"applied",1,23],[{already:true},true,"already-applied",0,23],[{already:true},false,"already-applied",0,23]]){const h=harness(o);assert.deepEqual(await h.run(apply),{ok:true,phase:"complete",outcome,apply,ledgerRows:length});assert.equal(h.calls,calls);assert.equal(h.ends,1);assert.equal(h.client.listenerCount("error"),0);assert.equal(h.events[0],"source");assert.ok(h.events.some(x=>x.includes("statement_timeout='12s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='15s'")));assert.ok(h.events.some(x=>x.includes("pg_try_advisory_lock")));assert.ok(h.events.some(x=>x.includes("pg_advisory_unlock")));}
});
test("source/transport/identity/lock/catalog/pre-data/socket failures prevent DDL and suppress private diagnostics",async()=>{
 for(const o of [{sourceAt:1},{sourceAt:2},{sourceAt:3},{connect:true},{transport:true},{identity:true},{locked:true},{catalog:true},{preData:true},{idleError:true}]){const h=harness(o),r=await h.run();assert.equal(r.ok,false);assert.equal(r.outcome,"not-started");assert.equal(h.calls,0);assert.equal(h.length,22);assert.equal(h.client.listenerCount("error"),0);assert.doesNotMatch(JSON.stringify(r),/Synthetic|protected|password|private|query/);}
});
test("rollback/lost COMMIT acknowledgements remain unknown; postcommit conflict never pretends rollback or retries",async()=>{
 for(const[o,outcome,length]of [[{rollback:true},"unknown",22],[{lostAck:true},"unknown",23],[{postData:true},"committed-verification-conflict",23],[{postRoles:true},"committed-verification-conflict",23],[{postCatalog:true},"committed-verification-conflict",23],[{nonempty:true},"committed-verification-conflict",23],[{sourceAt:4},"committed-verification-conflict",23],[{unlock:true},"applied",23],[{end:true},"applied",23]]){const h=harness(o),r=await h.run();assert.equal(r.ok,false);assert.equal(r.outcome,outcome);assert.equal(h.calls,1);assert.equal(h.length,length);assert.equal(h.ends,1);assert.equal(h.client.listenerCount("error"),0);}
 const h=harness({already:true,nonempty:true});assert.equal((await h.run()).ok,false);assert.equal(h.calls,0);
});
test("every old table and column, especially populated verse_source_assignment, is hashed; only honors is excluded",async()=>{
 const seen=[],client={async query(text){seen.push(text);return{rows:[{count:3,digest:"a".repeat(64)}]};}};
 assert.deepEqual((await captureHonorsData(client,["verse_source_assignment","student_recording","student","audit_event","honors_version"])).map(r=>r.name),["audit_event","student","student_recording","verse_source_assignment"]);assert.ok(seen.some(q=>q.includes('public."verse_source_assignment"')));assert.ok(seen.every(q=>!q.includes('public."honors_version"')));
});
test("historical CRLF function selection is unchanged but new0022 ledger hash is LF-only",()=>{
 const s=source(),t=parseHonorsTarget(manifest(s),s),lf=selectedHonorsReference(s,t,23),crlf=sha("synthetic CRLF history");s.migrations[2].historicalAllowed.push(crlf);t.prefix[2].hash=crlf;const selected=selectedHonorsReference(s,t,23);assert.deepEqual(selected.tables,lf.tables);assert.deepEqual(selected.types,lf.types);const rows=ledger(s,23);rows[2].hash=crlf;assert.equal(checkHonorsLedger(rows,s,t).length,23);rows[22].hash=crlf;assert.throws(()=>checkHonorsLedger(rows,s,t));
});

// This is a hand-built UNIT MODEL, never written to the release reference path.
function deltaModel(){
 const oldAudit=json(SOURCE_ASSIGNMENTS_REFERENCE).after.tables.find(t=>t.name==="audit_event").constraints.find(c=>c.name==="audit_action_known");
 const before={tables:HONORS_AFFECTED.map(name=>({name,triggers:[],constraints:name==="audit_event"?[oldAudit]:[],preserved:"synthetic old data-shape"})),functions:[],types:[]},after=structuredClone(before);
 const columns=[['id','uuid'],['tenant_id','text'],['student_id','uuid'],['assignment_id','uuid'],['version','integer'],['base_version','integer'],['previous_version','integer'],['form','jsonb'],['reviewed_context','jsonb'],['context_hash','text'],['actor_user_id','text'],['actor_membership_id','uuid'],['role_grant_id','uuid'],['guardian_id','uuid'],['role','portal_role'],['mode','context_mode'],['mutation_id','uuid'],['request_digest','text'],['created_at','timestamp with time zone']].map(([name,type],i)=>({name,type,position:i+1,not_null:!["assignment_id","previous_version","guardian_id"].includes(name),identity:"",generated:"",default_expression:name==="id"?"gen_random_uuid()":name==="created_at"?"now()":null}));
 const foreign=[['tenant_id_tenant_id','tenant',['tenant_id'],['id']],['previous','honors_version',['tenant_id','student_id','previous_version'],['tenant_id','student_id','version']],['student','student',['tenant_id','student_id'],['tenant_id','id']],['assignment','assignment',['tenant_id','assignment_id','student_id'],['tenant_id','id','student_id']],['actor','membership',['tenant_id','actor_membership_id','actor_user_id'],['tenant_id','id','user_id']],['grant','role_grant',['tenant_id','role_grant_id','actor_membership_id'],['tenant_id','id','membership_id']],['role','role_grant',['tenant_id','role_grant_id','role'],['tenant_id','id','role']],['guardian','guardian',['tenant_id','guardian_id','student_id','role_grant_id'],['tenant_id','id','student_id','parent_grant_id']]];
 const base={valid:true,enforced:true,deferrable:false,deferred:false},constraints=foreign.map(([name,target,keys,refs])=>({...base,name:`honors_version_${name}_fk`,type:"f",referenced_schema:"public",referenced_table:target,keys:keys.map(k=>columns.findIndex(c=>c.name===k)+1),definition:`FOREIGN KEY (${keys.join(", ")}) REFERENCES ${target}(${refs.join(", ")})`}));
 for(const[name,definition]of [['pkey','PRIMARY KEY (id)'],['stream_key','UNIQUE (tenant_id, student_id, version)'],['receipt_key','UNIQUE (tenant_id, student_id, mutation_id)']])constraints.push({...base,name:'honors_version_'+name,type:name==='pkey'?'p':'u',definition});
 for(const name of ['author','context','form','hashes','instant','mappings','versions'])constraints.push({...base,name:'honors_version_'+name,type:'c',definition:'CHECK (synthetic_unit_model)'});
 const triggers=[{arguments:"",columns:"",condition:null,constraint_name:null,deferrable:false,deferred:false,enabled:"O",function_name:"portal_immutable_audit",function_schema:"public",internal:false,name:"immutable_honors_version",type:27}];
 for(const[name,target]of foreign){const trigger={internal:true,enabled:"O",constraint_name:`honors_version_${name}_fk`};triggers.push({...trigger},{...trigger});if(target==='honors_version')triggers.push({...trigger},{...trigger});else after.tables.find(t=>t.name===target).triggers.push({...trigger},{...trigger});}
 after.tables.push({name:"honors_version",kind:"r",owner:"$OWNER",persistence:"p",rls:true,force_rls:true,options:null,replica_identity:"d",column_slots:19,check_count:7,columns,constraints,indexes:['pkey','receipt_key','stream_key'].map(name=>({name:'honors_version_'+name,unique:true,valid:true,ready:true,live:true,immediate:true})),triggers,columnGrants:[],grants:[{grantable:false,grantor:"$OWNER",privilege:"INSERT",role:"portal_runtime"},{grantable:false,grantor:"$OWNER",privilege:"SELECT",role:"portal_runtime"}],policies:[{check_expression:"tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)",command:"*",name:"tenant_isolation",permissive:true,roles:"{portal_runtime}",using_expression:"tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)"}]});after.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));
 after.tables.find(t=>t.name==='audit_event').constraints[0].definition=oldAudit.definition.replace(/::text\]\)\)$/,"::text, 'honors.set'::text]))");after.functions=honorsFunctionContract(sql);after.types=[{element:"honors_version",kind:"b",labels:"{}",name:"_honors_version",owner:"$OWNER"},{element:null,kind:"c",labels:"{}",name:"honors_version",owner:"$OWNER"}];return{before,after};
}
test("synthetic structural model allows only new honors authority/schema surface and exact audit extension",()=>{
 const model=deltaModel();assert.ok(validateHonorsDelta(model,sql));const table=m=>m.after.tables.find(t=>t.name==='honors_version');
 for(const mutate of [m=>m.after.tables.find(t=>t.name==='student').preserved='changed',m=>m.after.tables.push({name:'unapproved'}),m=>table(m).force_rls=false,m=>table(m).grants.push({role:'PUBLIC',privilege:'SELECT'}),m=>table(m).columnGrants.push({role:'PUBLIC'}),m=>table(m).triggers.find(t=>!t.internal).enabled='D',m=>table(m).constraints.find(c=>c.name==='honors_version_guardian_fk').definition='FOREIGN KEY (guardian_id) REFERENCES guardian(id)',m=>table(m).constraints.find(c=>c.name==='honors_version_receipt_key').definition='UNIQUE (tenant_id, student_id, actor_user_id, mutation_id)',m=>table(m).constraints.find(c=>c.name==='honors_version_actor_fk').keys=[12],m=>m.after.tables.find(t=>t.name==='guardian').triggers.pop(),m=>m.after.tables.find(t=>t.name==='audit_event').constraints[0].definition='CHECK (true)',m=>m.after.functions[0].source+=' ',m=>m.after.functions[0].security_definer=true,m=>m.after.functions[0].grants.push({role:'PUBLIC',privilege:'EXECUTE'}),m=>m.after.types[0].element='student']){const bad=structuredClone(model);mutate(bad);assert.throws(()=>validateHonorsDelta(bad,sql));}
 assert.throws(()=>honorsFunctionContract(sql.replace(/\n/g,'\r\n')));assert.throws(()=>honorsFunctionContract(sql.replace('portal_honors_keys','unreviewed_function')));
});

function sourceTrees(){
 assert.equal(journal.entries.length,23);
 const names=tree(HONORS_BASE),previousNames=tree(SOURCE_ASSIGNMENTS_BASE),oldFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES,...SOURCE_ASSIGNMENTS_FILES];
 const committed=new Map([...names,...oldFiles].map(p=>[p,blob(HONORS_BASE,p)]));for(const p of HONORS_FILES)committed.set(p,read(p));
 const historical=new Map(previousNames.map(p=>[p,blob(SOURCE_ASSIGNMENTS_BASE,p)]));
 const files=new Map(committed),events=[];let dirty=false,future=false,ancestor=true,head=candidate;
 const git=(...args)=>{events.push(args);if(args[0]==='rev-parse')return Buffer.from(head);if(args[0]==='merge-base'){assert.deepEqual(args,['merge-base','--is-ancestor',HONORS_BASE,candidate]);if(!ancestor)throw 0;return Buffer.alloc(0);}if(args[0]==='status')return Buffer.from(dirty?'?? synthetic changed':'');if(args[0]==='ls-tree'){const rows=args[3]===SOURCE_ASSIGNMENTS_BASE?previousNames:[...names,...(args[3]===candidate&&future?[folder+'/0023_unreviewed.sql']:[])];return Buffer.from(rows.join('\n'));}if(args[0]==='show'){const ref=args[1].slice(0,40),path=args[1].slice(41),bytes=(ref===SOURCE_ASSIGNMENTS_BASE?historical:committed).get(path);if(!bytes)throw Error('Synthetic absent source');return bytes;}throw Error('Unexpected synthetic Git command');};
 return{git,read:p=>files.get(p),files,committed,historical,events,dirty(){dirty=true;},future(){future=true;},ancestor(){ancestor=false;},head(){head='b'.repeat(40);}};
}
test("injected source-delta contract pins exact reviewed descendant/HEAD, immutable history/journal, clean protected paths, excludes0023",()=>{
 const f=sourceTrees(),s=honorsSourceDelta(candidate,f);assert.equal(s.migrations.length,23);assert.equal(s.migrations[22].hash,sha(sql));assert.ok(f.events.some(args=>args[0]==='status'&&args.includes(HONORS_REFERENCE)&&args.includes('src/server/db/migrations')));assert.equal(s.migrations[22].historicalAllowed.length,1);
 for(const change of [f=>f.dirty(),f=>f.future(),f=>f.ancestor(),f=>f.head(),f=>f.files.set(RELEASE_FILES[0],Buffer.from('changed')),f=>f.files.set(HONORS_FILES[0],Buffer.from('changed')),f=>f.files.set('src/server/db/migrations/0022_honors_version.sql',Buffer.from('changed')),f=>f.historical.set('src/server/db/migrations/'+journal.entries[0].tag+'.sql',Buffer.from('changed')),f=>{const j=JSON.parse(f.committed.get('src/server/db/migrations/meta/_journal.json'));j.entries[0].when++;f.committed.set('src/server/db/migrations/meta/_journal.json',Buffer.from(JSON.stringify(j)));f.files.set('src/server/db/migrations/meta/_journal.json',Buffer.from(JSON.stringify(j)));}]){const fixture=sourceTrees();change(fixture);assert.throws(()=>honorsSourceDelta(candidate,fixture));}
 f.files.set(HONORS_FILES[1],Buffer.from('changed later'));assert.throws(()=>s.recheck());
});

test("immutable LF fixtures survive simulated CRLF checkouts while runtime raw-byte guards still refuse them",()=>{
 const crlf=bytes=>Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n"));
 const native=json(HONORS_REFERENCE),s=source(),checkoutSQL=crlf(Buffer.from(sql)),checkoutReference=crlf(read(HONORS_REFERENCE));
 assert.equal(Buffer.from(sql).includes(13),false);assert.equal(read(HONORS_REFERENCE).includes(13),false);
 assert.notEqual(sha(checkoutSQL),native.migrationSHA256);
 assert.notEqual(sha(checkoutReference),"0f3f96231d77b2c392c3ccf38a5d3a1ef69ec9bc08c9be40e91ee354dffb4379");
 // Reproduce the old source() checkout-hash failure, without altering real files.
 const oldCheckoutSource={...s,migrations:s.migrations.map((m,i)=>i===22?{...m,hash:sha(checkoutSQL)}:m)};
 assert.throws(()=>validateHonorsReference(native,oldCheckoutSource));
 assert.deepEqual(validateHonorsReference(native,s),s.honorsAfter);
 for(const[path,bytes]of [[folder+"/0022_honors_version.sql",checkoutSQL],[HONORS_REFERENCE,checkoutReference]]){
  const f=sourceTrees();f.files.set(path,bytes);assert.throws(()=>honorsSourceDelta(candidate,f));
 }
 assert.equal(honorsSourceDelta(candidate,sourceTrees()).migrations.length,23);
});

test("historical0022 fixture is independent of current HEAD or later migration directory contents",()=>{
 const baseline=sourceTrees(),fixed=honorsSourceDelta(candidate,baseline);
 assert.equal(fixed.migrations.length,23);assert.equal(fixed.migrations[22].tag,"0022_honors_version");
 assert.deepEqual([...baseline.committed.keys()].filter(p=>p.startsWith(folder+"/")),tree(HONORS_BASE));
 assert.deepEqual([...baseline.historical.keys()],tree(SOURCE_ASSIGNMENTS_BASE));
 const future=sourceTrees();future.future();assert.throws(()=>honorsSourceDelta(candidate,future));
 // Every real Git read uses an immutable object ID. HEAD/dirty/future behavior
 // belongs only to the injected operator model, never to fixture extraction.
 for(const key of cache.keys()){
  const args=JSON.parse(key);
  if(args[0]==="show")assert.ok([HONORS_BASE,SOURCE_ASSIGNMENTS_BASE,fixtureRelease].includes(args[1].slice(0,40)));
  else{assert.equal(args[0],"ls-tree");assert.ok([HONORS_BASE,SOURCE_ASSIGNMENTS_BASE].includes(args[3]));}
 }
});
