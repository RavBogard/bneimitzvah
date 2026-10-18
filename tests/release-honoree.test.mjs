import { test,after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isolatedEnv } from "./helpers/isolatedEnv.mjs";
import { sha,canonical } from "../scripts/release-migrate-support.mjs";
import { HONORS_BASE } from "../scripts/release-migrate-honors-support.mjs";
import { HONOREE_BASE,HONOREE_FILES,HONOREE_REFERENCE,HONOREE_REFERENCE_SHA,HONOREE_CATALOG_SHA,HONOREE_TABLES,HONOREE_AFFECTED,honoreeSQLContract,honoreeSourceDelta,honoreeReferenceSource,honoreeSourceContract,validateHonoreeDelta,validateHonoreeReference,parseHonoreeTarget,checkHonoreeLedger } from "../scripts/release-migrate-honoree-support.mjs";
import { executeHonoreeRelease,runHonoreeRelease,captureHonoreeData,captureHonoreeInitial } from "../scripts/release-migrate-honoree.mjs";
const isolation=await isolatedEnv();after(()=>isolation.cleanup());
const cache=new Map(),git=(...args)=>{const key=JSON.stringify(args);try{if(!cache.has(key))cache.set(key,execFileSync("git",args,{cwd:new URL("..",import.meta.url),env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"]}));return cache.get(key);}catch{throw Error("Immutable honoree fixture unavailable; details withheld");}};
const blob=(ref,path)=>git("show",ref+":"+path),folder="src/server/db/migrations",candidate="a".repeat(40),tree=ref=>git("ls-tree","-r","--name-only",ref,"--",folder).toString("utf8").trim().split("\n"),sql=blob(HONOREE_BASE,folder+"/0023_honoree_links.sql").toString("utf8");
function sourceFixture(){
 const names=tree(HONOREE_BASE),files=new Map(names.map(p=>[p,blob(HONOREE_BASE,p)])),committed=new Map(files),events=[];let dirty=false,future=false,ancestor=true,head=candidate;
 // New files are virtual candidate blobs, not mutable checkout fixtures or files
 // incorrectly expected to exist in the older immutable B3 commit.
 for(const path of HONOREE_FILES){const bytes=Buffer.from("Synthetic candidate file: "+path);files.set(path,bytes);committed.set(path,bytes);}
 const nativeBytes=readFileSync(new URL("../"+HONOREE_REFERENCE,import.meta.url));files.set(HONOREE_REFERENCE,nativeBytes);committed.set(HONOREE_REFERENCE,nativeBytes);
 const overrides=new Map();
 const injected=(...args)=>{events.push(args);if(args[0]==="rev-parse")return Buffer.from(head);if(args[0]==="merge-base"){if(!ancestor)throw 0;return Buffer.alloc(0);}if(args[0]==="status")return Buffer.from(dirty?"?? synthetic drift":"");if(args[0]==="ls-tree")return Buffer.from((args[3]===candidate?[...names,...(future?[folder+"/0024_unreviewed.sql"]:[])]:tree(args[3])).join("\n"));if(args[0]==="show"){const ref=args[1].slice(0,40),path=args[1].slice(41);if(overrides.has(args[1]))return overrides.get(args[1]);if(ref===candidate)return committed.get(path)??blob(HONOREE_BASE,path);return blob(ref,path);}throw Error("Unexpected synthetic source command");};
 return {git:injected,read:path=>files.get(path)??blob(HONOREE_BASE,path),files,committed,overrides,events,dirty(){dirty=true;},future(){future=true;},ancestor(){ancestor=false;},head(){head="b".repeat(40);}};
}
const source=()=>{const s=honoreeReferenceSource(candidate,sourceFixture());s.honoreeAfter=s.honorsAfter;return s;};
function target(s){const url=new URL("postgresql://ep-synthetic.neon.tech/synthetic?sslmode=require&channel_binding=require");url.username="release_owner";url.password="synthetic-password";return parseHonoreeTarget({version:1,migrationUrl:url.href,expected:{hostname:"ep-synthetic.neon.tech",database:"synthetic",owner:"release_owner",ownerOid:"501",runtimeRole:"release_runtime",serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:s.migrations.slice(0,15).map((m,i)=>({id:i+1,hash:m.hash,createdAt:m.createdAt})),provenance:{sourceCommit:s.reference.sourceCommit,method:"owner-readonly",observedAt:"2026-10-18T00:00:00.000Z"}},s);}
const ledger=(s,n)=>s.migrations.slice(0,n).map((m,i)=>({id:i+1,hash:m.hash,created_at:String(m.createdAt)}));
function harness(o={}){
 const s=source(),t=target(s),events=[];let length=o.already?24:23,calls=0,reads=0,rechecks=0,ends=0;
 s.recheck=()=>{events.push("source");if(++rechecks===o.sourceAt)throw 0;};
 const client=Object.assign(new EventEmitter(),{async connect(){events.push("connect");},async end(){ends++;if(o.end)throw 0;},async query(text){events.push(text);if(text.includes("pg_try_advisory_lock"))return{rows:[{locked:!o.locked}]};if(text.includes("pg_advisory_unlock"))return{rows:[{unlocked:!o.unlock}]};if(text.includes("drizzle.__drizzle_migrations"))return{rows:ledger(s,length)};return{rows:[]};}});
 const checks={transport(){if(o.transport)throw 0;},async identity(){if(o.identity)throw 0;},async catalog(){return{tables:[{name:"honors_version"},{name:"student_recording"},{name:"verse_source_assignment"}],functions:[],types:[]};},verifyCatalog(){if(o.catalog)throw 0;},async roles(){return o.roles&&length===24?["drift"]:["same"];},async data(){reads++;if(o.idle)client.emit("error",Error("Synthetic private driver"));return[{name:"honors_version",count:3,digest:o.data&&length===24?"drift":"same"},{name:"student_recording",count:1,digest:"same"},{name:"verse_source_assignment",count:1,digest:"same"}];},async initial(){if(o.initialThrow)throw 0;return {expected:{reading:{count:3,digest:"r"},group:{count:1,digest:"g"}},actual:length===24?{}:null,empty:!o.capability,valid:!o.initial&&!o.capability};}};
 const migrate=async value=>{assert.equal(value,client);calls++;if(o.rollback)throw 0;length=24;if(o.lost)throw 0;};
 return{s,t,client,checks,migrate,events,get calls(){return calls;},get ends(){return ends;},get length(){return length;},run(apply=true){return executeHonoreeRelease(s,t,{apply,checks,connect:()=>client,migrate});}};
}

test("installed owned native reference has exact byte/catalog pins and satisfies the complete source contract",()=>{
 assert.match(HONOREE_REFERENCE_SHA,/^[a-f0-9]{64}$/);assert.match(HONOREE_CATALOG_SHA,/^[a-f0-9]{64}$/);
 const bytes=readFileSync(new URL("../"+HONOREE_REFERENCE,import.meta.url)),reference=JSON.parse(bytes);
 assert.equal(reference.evidence,"owned-native-capture");assert.equal(reference.sourceCommit,HONOREE_BASE);assert.equal(reference.migrationSHA256,sha(sql));
 assert.equal(sha(bytes),HONOREE_REFERENCE_SHA);assert.equal(sha(JSON.stringify(canonical(reference.after))),HONOREE_CATALOG_SHA);
 const before=JSON.stringify(reference),s=honoreeSourceContract(candidate,sourceFixture());
 assert.deepEqual(validateHonoreeReference(bytes,s),s.honoreeAfter);
 for(const name of HONOREE_TABLES)assert.ok(s.honoreeAfter.tables.some(t=>t.name===name));
 assert.equal(JSON.stringify(reference),before);s.recheck();
});

test("corrupted and MODEL ONLY references fail before target access despite internally matching candidate source bytes; no override",async()=>{
 const nativeBytes=readFileSync(new URL("../"+HONOREE_REFERENCE,import.meta.url)),native=JSON.parse(nativeBytes);
 const modeled={version:1,evidence:"MODEL ONLY - synthetic structural fixture",sourceCommit:HONOREE_BASE,migrationSHA256:sha(sql),before:null,after:null};
 const corrupted=structuredClone(native);corrupted.evidence="MODEL ONLY - cannot become accepted native evidence";
 const changedAfter=structuredClone(native);changedAfter.after={tables:[],functions:[],types:[]};
 const badReferences=[Buffer.concat([nativeBytes,Buffer.from(" ")]),Buffer.from(JSON.stringify(modeled)),Buffer.from(JSON.stringify(corrupted)),Buffer.from(JSON.stringify(changedAfter))];
 for(const bytes of badReferences){
  const f=sourceFixture();f.files.set(HONOREE_REFERENCE,bytes);f.committed.set(HONOREE_REFERENCE,bytes);
  const checked=honoreeReferenceSource(candidate,f);assert.throws(()=>validateHonoreeReference(bytes,checked));
  let reads=0,connects=0;
  const result=await runHonoreeRelease(["--expected-commit",candidate,"--target","synthetic.json"],{source:commit=>honoreeSourceContract(commit,f),readTarget(){reads++;},execution:{connect(){connects++;}}});
  assert.deepEqual(result,{ok:false,phase:"source",outcome:"not-started",apply:false});assert.equal(reads,0);assert.equal(connects,0);
 }
 for(const flag of ["--allow-model","--retry","--force"]){assert.equal((await runHonoreeRelease(["--expected-commit",candidate,"--target","synthetic.json",flag])).phase,"arguments");}
});

test("exact immutable24-source contract protects old operators/history/journal, new six files, LF bytes and future0024 refusal",()=>{
 const f=sourceFixture(),s=honoreeSourceDelta(candidate,f);assert.equal(s.migrations.length,24);assert.equal(s.migrations[23].hash,sha(sql));assert.equal(s.migrations[23].historicalAllowed.length,1);assert.equal(s.migrations[2].historicalAllowed.length,2);
 for(const change of [f=>f.dirty(),f=>f.future(),f=>f.ancestor(),f=>f.head(),f=>f.files.set(HONOREE_FILES[0],Buffer.from("drift")),f=>f.files.set("scripts/release-migrate-honors.mjs",Buffer.from("drift")),f=>f.files.set(folder+"/0023_honoree_links.sql",Buffer.from(sql.replace(/\n/g,"\r\n"))),f=>f.overrides.set(HONORS_BASE+":"+folder+"/0022_honors_version.sql",Buffer.from("changed history")),f=>{const p=folder+"/meta/_journal.json",j=JSON.parse(f.files.get(p));j.entries[0].when++;const b=Buffer.from(JSON.stringify(j));f.files.set(p,b);f.committed.set(p,b);}]){const bad=sourceFixture();change(bad);assert.throws(()=>honoreeSourceDelta(candidate,bad));}
 f.files.set(HONOREE_FILES[1],Buffer.from("late drift"));assert.throws(()=>s.recheck());
 for(const args of cache.keys())assert.ok(!JSON.parse(args).some(v=>v==="HEAD"));
});

test("source-guard-only capture composition retains every historical native reference without pretending new evidence",()=>{
 const s=source();assert.equal(s.migrations.length,24);assert.ok(s.honorsAfter.tables.some(t=>t.name==="honors_version"));assert.ok(s.honorsAfter.tables.some(t=>t.name==="student_recording"));assert.ok(s.honorsAfter.tables.some(t=>t.name==="verse_source_assignment"));assert.equal(honoreeSQLContract(s.honoreeSQL).foreign.length,22);
 const t=target(s);assert.equal(t.requireChannelBinding,true);
 const invalid={version:1};assert.throws(()=>parseHonoreeTarget(invalid,s));
 const rows=ledger(s,24);assert.equal(checkHonoreeLedger(rows,s,t).length,24);
 for(const bad of [rows.slice(0,22),[...rows,{...rows[23],id:25}],rows.map((r,i)=>i===23?{...r,hash:sha(sql.replace(/\n/g,"\r\n"))}:r)])assert.throws(()=>checkHonoreeLedger(bad,s,t));
 const allowed=ledger(s,23);allowed[2].hash=s.migrations[2].historicalAllowed[1];const crlfTarget={...t,prefix:t.prefix.map((r,i)=>i===2?{...r,hash:allowed[2].hash}:r)};assert.equal(checkHonoreeLedger(allowed,s,crlfTarget).length,23);
});

test("SQL-derived table/function/trigger/FK contract is exact and rejects absent/non-LF declarations",()=>{
 const c=honoreeSQLContract(sql);assert.deepEqual(c.tables.map(t=>t.name).sort(),HONOREE_TABLES);assert.equal(c.functions.length,10);assert.equal(c.triggers.length,11);assert.equal(c.foreign.length,22);assert.equal(c.tables.reduce((n,t)=>n+t.checks.length,0),9);
 assert.equal(c.triggers.find(t=>t.name==="honoree_student_epoch").type,17);assert.match(c.functions.find(f=>f.name==="portal_honoree_assignment_epoch").source,/ON CONFLICT/);
 assert.throws(()=>honoreeSQLContract(sql.replace(/\n/g,"\r\n")));assert.throws(()=>honoreeSQLContract(sql.replace("CREATE FUNCTION public.portal_honoree_epoch_guard","CREATE FUNCTION public.unreviewed")));
 assert.throws(()=>validateHonoreeDelta({before:{tables:[],functions:[],types:[]},after:{tables:[],functions:[],types:[]}},sql));
});

test("modeled check/apply/already use one client and never migrate check-only or already applied",async()=>{
 const f=harness();assert.deepEqual(await f.run(false),{ok:true,phase:"complete",outcome:"checked",apply:false,ledgerRows:23});assert.equal(f.calls,0);
 assert.deepEqual(await f.run(true),{ok:true,phase:"complete",outcome:"applied",apply:true,ledgerRows:24});assert.equal(f.calls,1);
 assert.deepEqual(await f.run(true),{ok:true,phase:"complete",outcome:"already-applied",apply:true,ledgerRows:24});assert.equal(f.calls,1);
 assert.ok(f.events.some(x=>x.includes?.("REPEATABLE READ READ ONLY")));assert.equal(f.ends,3);
});

test("observed ledger24/catalog success is retained when initial-state validation or cleanup fails",async()=>{
 for(const options of [{already:true,initial:true},{already:true,capability:true},{already:true,initialThrow:true},{already:true,initial:true,unlock:true},{already:true,initial:true,end:true}]){
  const f=harness(options),result=await f.run();assert.equal(result.ok,false);assert.equal(result.outcome,"observed-applied-initial-state-unverified");assert.equal(result.phase,options.unlock||options.end?"cleanup":"verification");assert.equal(f.calls,0);
 }
 const unverified=harness({already:true,catalog:true});assert.equal((await unverified.run()).outcome,"not-started");assert.equal(unverified.calls,0);
});

test("unknown COMMIT, preflight refusal and postcommit conflicts never replay or claim rollback",async()=>{
 for(const options of [{transport:true},{identity:true},{catalog:true},{locked:true},{sourceAt:1}]){const f=harness(options),result=await f.run();assert.equal(result.ok,false);assert.equal(result.outcome,"not-started");assert.equal(f.calls,0);}
 for(const options of [{rollback:true},{lost:true}]){const f=harness(options),result=await f.run();assert.equal(result.outcome,"unknown");assert.equal(f.calls,1);}
 for(const options of [{data:true},{roles:true},{initial:true},{capability:true}]){const f=harness(options),result=await f.run();assert.equal(result.outcome,"committed-verification-conflict");assert.equal(f.calls,1);}
 const idle=harness({already:true,initial:true,idle:true});assert.equal((await idle.run()).outcome,"observed-applied-initial-state-unverified");
});

test("old-data capture includes populated honors, sources and recordings and excludes only the5 new tables",async()=>{
 const statements=[],client={async query(text){statements.push(text);return{rows:[{count:1,digest:"a".repeat(64)}]};}};
 const rows=await captureHonoreeData(client,[...HONOREE_TABLES,"honors_version","student_recording","verse_source_assignment"]);assert.deepEqual(rows.map(r=>r.name),["honors_version","student_recording","verse_source_assignment"]);assert.ok(statements.every(q=>q.includes("to_jsonb(bounded)")));
});

test("derived backfill SQL uses all students and latest nonempty groups, zero epoch and exact count/digest equality",async()=>{
 const statements=[],client={async query(text){statements.push(text);return{rows:[text.includes("NOT EXISTS(SELECT 1 FROM public.honoree_link)")?{clear:true}:{count:3,digest:"a".repeat(64)}]};}};
 const initial=await captureHonoreeInitial(client,24);assert.equal(initial.valid,true);assert.equal(initial.empty,true);
 assert.ok(statements.some(q=>q.includes("id AS student_id,0::bigint AS epoch FROM public.student")&&!q.includes("disabled_at")));
 assert.ok(statements.some(q=>q.includes("newer.version>h.version")&&q.includes("jsonb_array_length(a->'participants')>0")&&q.includes("0::bigint AS epoch")));
 let calls=0;const drift={async query(text){calls++;return{rows:[text.includes(" AS clear")?{clear:true}:{count:3,digest:(calls===3?"b":"a").repeat(64)}]};}};assert.equal((await captureHonoreeInitial(drift,24)).valid,false);
});


// MODEL ONLY: closed SQL-bound expected definitions are not actual server
// capture, and cannot pass the separate native byte/hash gate.
function deltaModel(){
 const c=honoreeSQLContract(sql),before={tables:HONOREE_AFFECTED.map(name=>({name,triggers:[],constraints:name==="audit_event"?[{name:"audit_action_known",definition:"CHECK (action = ANY (ARRAY['honors.set'::text]))"}]:[]})),functions:[],types:[]},after=structuredClone(before);
 const grant=privilege=>({role:"portal_runtime",grantor:"$OWNER",privilege,grantable:false});
 const triggers=table=>{const rows=c.triggers.filter(t=>t.table===table).map(({table,...t})=>t);for(const fk of c.foreign)for(const [owner,fn,type]of [[fk.table,"RI_FKey_check_ins",5],[fk.table,"RI_FKey_check_upd",17],[fk.target,"RI_FKey_noaction_del",9],[fk.target,"RI_FKey_noaction_upd",17]])if(owner===table)rows.push({name:null,internal:true,constraint_name:fk.name,type,enabled:"O",columns:"",arguments:"",condition:null,function_schema:"pg_catalog",function_name:fn,deferrable:false,deferred:false});return rows;};
 for(const t of after.tables){t.triggers=triggers(t.name).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),"en"));if(t.name==="audit_event")t.constraints[0].definition="CHECK (action = ANY (ARRAY['honors.set'::text, 'honoree.issue'::text, 'honoree.revoke'::text, 'honoree.reissue'::text]))";}
 for(const d of c.tables){
  const columns=d.columns.map((v,i)=>({name:v.name,type:v.type,position:i+1,not_null:v.notNull,identity:"",generated:"",collation:v.type==="text"?"pg_catalog.default":null,default_expression:v.defaultExpression}));
  const base={valid:true,enforced:true,deferrable:false,deferred:false,no_inherit:false,local:true,inherited_count:0,referenced_schema:null,referenced_table:null,referenced_keys:null};
  const positions=keys=>keys.map(k=>d.columns.findIndex(v=>v.name===k)+1);
  const constraints=[...d.checkDefinitions.map(check=>({...base,name:check.name,type:"c",definition:check.definition,keys:positions(check.keys)})),...d.uniques.map(u=>({...base,name:u.name,type:"u",no_inherit:true,keys:positions(u.keys),definition:`UNIQUE (${u.keys.join(", ")})`})),...c.foreign.filter(f=>f.table===d.name).map(f=>({...base,name:f.name,type:"f",no_inherit:true,referenced_schema:"public",referenced_table:f.target,keys:positions(f.keys),definition:`FOREIGN KEY (${f.keys.join(", ")}) REFERENCES ${f.target}(${f.refs.join(", ")})`}))];
  if(d.primary.length)constraints.push({...base,name:d.name+"_pkey",type:"p",no_inherit:true,keys:positions(d.primary),definition:"PRIMARY KEY (id)"});
  const indexes=structuredClone(d.indexes);
  const material=d.name==="honoree_material_release",column=d.name.endsWith("_epoch")?"epoch":d.name==="honoree_link"?"revoked_at":material?"id":null,policy="tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)";
  after.tables.push({name:d.name,kind:"r",owner:"$OWNER",persistence:"p",rls:true,force_rls:true,options:null,replica_identity:"d",column_slots:columns.length,check_count:d.checks.length,columns,constraints,indexes,triggers:triggers(d.name),grants:(material?["SELECT"]:["INSERT","SELECT"]).map(grant),columnGrants:column?[{...grant("UPDATE"),column}]:[],policies:[{name:"tenant_isolation",command:"*",permissive:true,roles:"{portal_runtime}",using_expression:policy,check_expression:policy}]});
 }
 after.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));after.functions=c.functions;after.types=HONOREE_TABLES.flatMap(name=>[{name,kind:"c",owner:"$OWNER",element:null,labels:"{}"},{name:"_"+name,kind:"b",owner:"$OWNER",element:name,labels:"{}"}]).sort((a,b)=>a.name.localeCompare(b.name,"en"));return {before,after};
}

test("MODEL ONLY structural delta permits exact new surfaces and rejects authority/schema/old-data-contract drift",()=>{
 const model=deltaModel();assert.ok(validateHonoreeDelta(model,sql));const table=m=>m.after.tables.find(t=>t.name==="honoree_link");
 for(const mutate of [m=>table(m).force_rls=false,m=>table(m).columns[0].type="uuid",m=>table(m).grants.push({role:"PUBLIC",privilege:"SELECT"}),m=>table(m).columnGrants[0].column="token_hash",m=>table(m).constraints.find(c=>c.name==="honoree_link_guardian_fk").definition="FOREIGN KEY (guardian_id) REFERENCES guardian(id)",m=>table(m).constraints.find(c=>c.name==="honoree_link_honors_fk").keys=[2],m=>table(m).triggers.pop(),m=>table(m).indexes.pop(),m=>m.after.tables.find(t=>t.name==="student").triggers.pop(),m=>m.after.tables.find(t=>t.name==="audit_event").constraints[0].definition="CHECK (true)",m=>m.after.functions[0].security_definer=true,m=>m.after.functions[0].source+=" ",m=>m.after.types[0].element="student",m=>m.after.tables.push({name:"unexpected"})]){const bad=structuredClone(model);mutate(bad);assert.throws(()=>validateHonoreeDelta(bad,sql));}
 assert.throws(()=>validateHonoreeReference(Buffer.from(JSON.stringify({version:1,evidence:"owned-native-capture",sourceCommit:HONOREE_BASE,migrationSHA256:sha(sql),...model})),source()));
});

test("closed nine CHECKs and eleven indexes reject the independent probes and predicate/key/flag substitutions",()=>{
 const model=deltaModel(),table=(m,name)=>m.after.tables.find(t=>t.name===name);
 const reject=mutate=>{const bad=structuredClone(model);mutate(bad);assert.throws(()=>validateHonoreeDelta(bad,sql));};
 // Exact independently demonstrated acceptance gaps, now denied.
 reject(m=>table(m,"honoree_link").constraints.find(c=>c.name==="honoree_link_shape").definition="CHECK (false)");
 reject(m=>table(m,"honoree_link").indexes.find(i=>i.name==="honoree_link_one_current").definition="CREATE UNIQUE INDEX honoree_link_one_current ON public.honoree_link USING btree (token_hash) WHERE false");
 const contract=honoreeSQLContract(sql);
 assert.equal(contract.tables.reduce((n,t)=>n+t.checkDefinitions.length,0),9);
 assert.equal(contract.tables.reduce((n,t)=>n+t.indexes.length,0),11);
 for(const d of contract.tables){
  for(const check of d.checkDefinitions){
   for(const replacement of ["CHECK (true)","CHECK (false)",check.definition+" "])
    reject(m=>table(m,d.name).constraints.find(c=>c.name===check.name).definition=replacement);
   reject(m=>table(m,d.name).constraints.find(c=>c.name===check.name).keys=[]);
  }
  for(const index of d.indexes){
   reject(m=>table(m,d.name).indexes.find(i=>i.name===index.name).definition+= " WHERE false");
   reject(m=>table(m,d.name).indexes.find(i=>i.name===index.name).definition=index.definition.replace(/USING btree \([^)]*\)/,"USING btree (id DESC NULLS FIRST)"));
   for(const flag of ["unique","primary","valid","ready","live","immediate"])
    reject(m=>{const i=table(m,d.name).indexes.find(i=>i.name===index.name);i[flag]=!i[flag];});
  }
  for(const c of model.after.tables.find(t=>t.name===d.name).constraints.filter(c=>c.type!=="f")){
   reject(m=>table(m,d.name).constraints.find(v=>v.name===c.name).keys=[999]);
   reject(m=>table(m,d.name).constraints.find(v=>v.name===c.name).type=c.type==="c"?"u":"c");
   reject(m=>table(m,d.name).constraints.find(v=>v.name===c.name).no_inherit=!c.no_inherit);
   for(const flag of ["valid","enforced","deferrable","deferred","local"])
    reject(m=>{const v=table(m,d.name).constraints.find(v=>v.name===c.name);v[flag]=!v[flag];});
  }
 }
 reject(m=>table(m,"honoree_link").indexes.find(i=>i.name==="honoree_link_one_current").definition="CREATE UNIQUE INDEX honoree_link_one_current ON public.honoree_link USING btree (tenant_id, student_id, start_verse)");
 reject(m=>table(m,"honoree_material_release").indexes.find(i=>i.name==="honoree_material_active_slot").definition="CREATE UNIQUE INDEX honoree_material_active_slot ON public.honoree_material_release USING btree (tenant_id, slot) WHERE (state = 'withdrawn'::text)");
 assert.throws(()=>honoreeSQLContract(sql.replace('"key_id"=\'k1\'','"key_id"=\'k2\'')));
 assert.throws(()=>honoreeSQLContract(sql.replace('"revoked_at" is null','"revoked_at" is not null')));
});

test("exact trigger comparison accepts persisted mixed property orders and trigger-array permutations without mutating capture",()=>{
 const model=deltaModel(),student=model.after.tables.find(t=>t.name==="student");
 const existing={...student.triggers.find(t=>!t.internal),name:"synthetic_existing_guard",function_name:"portal_immutable_audit",type:27};
 model.before.tables.find(t=>t.name==="student").triggers.push(structuredClone(existing));student.triggers.push(structuredClone(existing));
 const variants=[model,canonical(model),JSON.parse(JSON.stringify(canonical(model)))];
 const mixed=structuredClone(model);
 for(const catalog of [mixed.before,mixed.after])for(const table of catalog.tables){
  table.triggers=table.triggers.reverse().map((t,i)=>i%2?canonical(t):Object.fromEntries(Object.entries(t).reverse()));
 }
 variants.push(mixed);
 for(const variant of variants){const original=JSON.stringify(variant);assert.ok(validateHonoreeDelta(variant,sql));assert.equal(JSON.stringify(variant),original,"native input and captured sequences must remain unchanged");}
});

test("trigger permutation acceptance retains exact user/RI/baseline records and multiplicity plus exact grants",()=>{
 const model=canonical(deltaModel()),table=(m,name)=>m.after.tables.find(t=>t.name===name);
 const baseline={...table(model,"student").triggers.find(t=>!t.internal),name:"synthetic_baseline_guard",function_name:"portal_immutable_audit",type:27};
 model.before.tables.find(t=>t.name==="student").triggers.push(structuredClone(baseline));table(model,"student").triggers.push(structuredClone(baseline));
 for(const name of ["honoree_link","student"]){
  for(const internal of [true,false]){
   const original=table(model,name).triggers.find(t=>name==="student"&&!internal?t.name==="synthetic_baseline_guard":t.internal===internal);assert.ok(original);
   for(const kind of ["missing","duplicate","changed"]){
    const bad=structuredClone(model),rows=table(bad,name).triggers,index=rows.findIndex(t=>JSON.stringify(t)===JSON.stringify(original));
    if(kind==="missing")rows.splice(index,1);else if(kind==="duplicate")rows.push(structuredClone(original));else rows[index].enabled="D";
    rows.reverse();assert.throws(()=>validateHonoreeDelta(bad,sql),name+" "+internal+" "+kind);
   }
  }
 }
 for(const mutate of [m=>table(m,"honoree_link").grants.push(structuredClone(table(m,"honoree_link").grants[0])),m=>table(m,"honoree_link").grants[0].grantable=true,m=>table(m,"honoree_link").triggers[0].arguments="00",m=>table(m,"honoree_link").triggers[0].condition="false"]){const bad=structuredClone(model);mutate(bad);assert.throws(()=>validateHonoreeDelta(bad,sql));}
});
