import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_BASE, ROOT, RELEASE_FILES, sha, same, canonical, closed, need, parseTarget, historicalFunctionContract } from "./release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "./release-migrate-roster-support.mjs";
import { RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference } from "./release-migrate-recordings-support.mjs";
import { SOURCE_ASSIGNMENTS_BASE, SOURCE_ASSIGNMENTS_FILES, SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference, checkSourceAssignmentsLedger, selectedSourceAssignmentsReference } from "./release-migrate-source-assignments-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const HONORS_BASE="513db5f8e2b5389bd0f3b62bfc3c49222dc4f980";
export const HONORS_REFERENCE="tests/fixtures/portal/release-honors-reference.json";
export const HONORS_FILES=["scripts/release-migrate-honors.mjs","scripts/release-migrate-honors-support.mjs",HONORS_REFERENCE];
// Actual owned native PG16 capture, independently reviewed before installation.
export const HONORS_CATALOG_SHA="18db57f9825e7090085a38f4ccf8103c0a66c5aa998870fc2fa5fdb7179b69f6";
const equal=(a,b)=>same(canonical(a),canonical(b));
const order=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),"en"));
export const HONORS_AFFECTED=["assignment","audit_event","guardian","membership","role_grant","student","tenant"];
const foreign={
  honors_version_tenant_id_tenant_id_fk:["tenant",["tenant_id"],["id"]],
  honors_version_previous_fk:["honors_version",["tenant_id","student_id","previous_version"],["tenant_id","student_id","version"]],
  honors_version_student_fk:["student",["tenant_id","student_id"],["tenant_id","id"]],
  honors_version_assignment_fk:["assignment",["tenant_id","assignment_id","student_id"],["tenant_id","id","student_id"]],
  honors_version_actor_fk:["membership",["tenant_id","actor_membership_id","actor_user_id"],["tenant_id","id","user_id"]],
  honors_version_grant_fk:["role_grant",["tenant_id","role_grant_id","actor_membership_id"],["tenant_id","id","membership_id"]],
  honors_version_role_fk:["role_grant",["tenant_id","role_grant_id","role"],["tenant_id","id","role"]],
  honors_version_guardian_fk:["guardian",["tenant_id","guardian_id","student_id","role_grant_id"],["tenant_id","id","student_id","parent_grant_id"]],
};
export function honorsFunctionContract(sql){
  need(typeof sql==="string"&&!sql.includes("\r"));
  const matches=[...sql.matchAll(/CREATE FUNCTION public\.(portal_honors_[a-z_]+)\(([^)]*)\) RETURNS (boolean|text) LANGUAGE (sql|plpgsql) IMMUTABLE AS \$\$([\s\S]*?)\$\$;/g)];
  need(equal(matches.map(m=>m[1]).sort(),["portal_honors_compact","portal_honors_context_valid","portal_honors_form_valid","portal_honors_keys","portal_honors_mappings_valid","portal_honors_person","portal_honors_text"]));
  return matches.map(m=>({name:m[1],arguments:m[2].replaceAll(",",", ").replaceAll(/ +/g," "),result:m[3],language:m[4],source:m[5],binary:null,owner:"$OWNER",security_definer:false,volatility:"i",strict:false,leakproof:false,parallel:"u",kind:"f",returns_set:false,config:null,
    grants:[{role:"portal_runtime",grantor:"$OWNER",privilege:"EXECUTE",grantable:false}]})).sort((a,b)=>a.name.localeCompare(b.name,"en"));
}
function honorsTable(table){
  need(table.name==="honors_version"&&table.kind==="r"&&table.owner==="$OWNER"&&table.persistence==="p"&&table.rls===true&&table.force_rls===true&&table.options===null&&table.replica_identity==="d"&&table.column_slots===19&&table.check_count===7);
  const columns=[['id','uuid'],['tenant_id','text'],['student_id','uuid'],['assignment_id','uuid'],['version','integer'],['base_version','integer'],['previous_version','integer'],['form','jsonb'],['reviewed_context','jsonb'],['context_hash','text'],['actor_user_id','text'],['actor_membership_id','uuid'],['role_grant_id','uuid'],['guardian_id','uuid'],['role','portal_role'],['mode','context_mode'],['mutation_id','uuid'],['request_digest','text'],['created_at','timestamp with time zone']];
  need(equal(table.columns.map(c=>[c.name,c.type]),columns));
  for(const [i,c]of table.columns.entries())need(c.position===i+1&&c.not_null===!["assignment_id","previous_version","guardian_id"].includes(c.name)&&c.identity===""&&c.generated===""&&c.default_expression===(c.name==="id"?"gen_random_uuid()":c.name==="created_at"?"now()":null));
  need(equal(table.grants,[{grantable:false,grantor:"$OWNER",privilege:"INSERT",role:"portal_runtime"},{grantable:false,grantor:"$OWNER",privilege:"SELECT",role:"portal_runtime"}])&&equal(table.columnGrants,[]));
  const expression="tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)";
  need(equal(table.policies,[{check_expression:expression,command:"*",name:"tenant_isolation",permissive:true,roles:"{portal_runtime}",using_expression:expression}]));
  const checks=["author","context","form","hashes","instant","mappings","versions"].map(name=>"honors_version_"+name);
  need(equal(table.constraints.map(c=>c.name).sort(),[...checks,...Object.keys(foreign),"honors_version_pkey","honors_version_receipt_key","honors_version_stream_key"].sort()));
  need(table.constraints.every(c=>c.valid===true&&c.enforced===true&&c.deferrable===false&&c.deferred===false));
  const constraint=name=>table.constraints.find(c=>c.name===name);
  for(const[name,[target,keys,refs]]of Object.entries(foreign)){const c=constraint(name);need(c.type==="f"&&c.referenced_schema==="public"&&c.referenced_table===target&&c.definition===`FOREIGN KEY (${keys.join(", ")}) REFERENCES ${target}(${refs.join(", ")})`&&equal(c.keys,keys.map(k=>columns.findIndex(([name])=>name===k)+1)));}
  need(constraint("honors_version_pkey").definition==="PRIMARY KEY (id)"&&constraint("honors_version_stream_key").definition==="UNIQUE (tenant_id, student_id, version)"&&constraint("honors_version_receipt_key").definition==="UNIQUE (tenant_id, student_id, mutation_id)");
  need(checks.every(name=>constraint(name).type==="c"&&constraint(name).definition.startsWith("CHECK (")&&constraint(name).definition!=="CHECK (true)"));
  need(table.indexes.length===3&&table.indexes.every(i=>i.unique&&i.valid&&i.ready&&i.live&&i.immediate)&&equal(table.indexes.map(i=>i.name).sort(),["honors_version_pkey","honors_version_receipt_key","honors_version_stream_key"]));
  const immutable=table.triggers.filter(t=>!t.internal);
  need(equal(immutable,[{arguments:"",columns:"",condition:null,constraint_name:null,deferrable:false,deferred:false,enabled:"O",function_name:"portal_immutable_audit",function_schema:"public",internal:false,name:"immutable_honors_version",type:27}]));
  const internal=table.triggers.filter(t=>t.internal);
  need(internal.length===18&&internal.every(t=>Object.hasOwn(foreign,t.constraint_name)&&t.enabled==="O"));
  for(const name of Object.keys(foreign))need(internal.filter(t=>t.constraint_name===name).length===(name==="honors_version_previous_fk"?4:2));
}
/** Structural delta only. Synthetic tests of this function are not a captured
 * reference, nor a substitute for the immutable native hash checked below. */
export function validateHonorsDelta(value,sql){
  closed(value,["before","after"]);const {before,after}=value;
  need(equal(before.tables.map(t=>t.name),HONORS_AFFECTED)&&before.functions.length===0&&before.types.length===0);
  const next=structuredClone(before),added=after.tables.filter(t=>!before.tables.some(old=>old.name===t.name));
  need(added.length===1);honorsTable(added[0]);next.tables.push(...added);next.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  for(const name of HONORS_AFFECTED.filter(n=>n!=="audit_event")){
    const old=next.tables.find(t=>t.name===name),fresh=after.tables.find(t=>t.name===name),names=Object.entries(foreign).filter(([,v])=>v[0]===name).map(([key])=>key);
    const extra=fresh.triggers.filter(trigger=>!old.triggers.some(value=>equal(value,trigger)));
    need(extra.length===names.length*2&&extra.every(t=>t.internal&&t.enabled==="O"&&names.includes(t.constraint_name)));
    for(const fk of names)need(extra.filter(t=>t.constraint_name===fk).length===2);
    need(equal(order(structuredClone(old.triggers)),order(fresh.triggers.filter(t=>!extra.includes(t)))));old.triggers=fresh.triggers;
  }
  const audit=next.tables.find(t=>t.name==="audit_event"),freshAudit=after.tables.find(t=>t.name==="audit_event"),action=audit.constraints.filter(c=>c.name==="audit_action_known"),freshAction=freshAudit.constraints.filter(c=>c.name==="audit_action_known");
  need(action.length===1&&freshAction.length===1&&action[0].definition.endsWith("::text]))")&&!action[0].definition.includes("'honors.set'"));
  need(equal({...action[0],definition:action[0].definition.replace(/::text\]\)\)$/,"::text, 'honors.set'::text]))")},freshAction[0]));
  audit.constraints=audit.constraints.map(c=>c.name==="audit_action_known"?freshAction[0]:c);
  need(equal(after.functions,honorsFunctionContract(sql)));next.functions.push(...after.functions);
  need(equal(after.types,[{element:"honors_version",kind:"b",labels:"{}",name:"_honors_version",owner:"$OWNER"},{element:null,kind:"c",labels:"{}",name:"honors_version",owner:"$OWNER"}]));next.types.push(...after.types);
  need(equal(next,after));return referenceCatalog(after);
}
export function validateHonorsReference(reference,source){
  closed(reference,["version","sourceCommit","migrationSHA256","before","after"]);
  need(reference.version===1&&reference.sourceCommit===HONORS_BASE&&reference.migrationSHA256===source.migrations[22].hash);
  need(typeof HONORS_CATALOG_SHA==="string"&&/^[a-f0-9]{64}$/.test(HONORS_CATALOG_SHA)&&sha(JSON.stringify(canonical(reference.after)))===HONORS_CATALOG_SHA);
  const previous=selectedSourceAssignmentsReference(source,{prefix:source.migrations.slice(0,15).map(row=>({hash:row.hash}))},22);
  need(equal(referenceCatalog(reference.before).tables,previous.tables.filter(t=>HONORS_AFFECTED.includes(t.name))));
  const delta=validateHonorsDelta({before:reference.before,after:reference.after},source.honorsSQL);
  return {...previous,tables:[...previous.tables.filter(old=>!delta.tables.some(t=>t.name===old.name)),...delta.tables].sort((a,b)=>a.name.localeCompare(b.name,"en")),functions:[...previous.functions,...delta.functions].sort((a,b)=>a.name.localeCompare(b.name,"en")||a.arguments.localeCompare(b.arguments,"en")),types:[...previous.types,...delta.types].sort((a,b)=>a.name.localeCompare(b.name,"en"))};
}

/** Inspect exact Git/source bytes before any protected target is read. The
 * reviewed helper commit must itself be HEAD and descend from HONORS_BASE. */
export function honorsSourceDelta(expectedCommit,options={}){
  need(/^[a-f0-9]{40}$/.test(expectedCommit));const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
  const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))}));
  const text=(...args)=>git(...args).toString("utf8").trim(),oldFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES,...SOURCE_ASSIGNMENTS_FILES],protectedFiles=[...oldFiles,...HONORS_FILES];
  const check=()=>{need(text("rev-parse","HEAD")===expectedCommit);if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());git("merge-base","--is-ancestor",HONORS_BASE,expectedCommit);need(text("status","--porcelain=v1","--untracked-files=all","--","src/server/db/migrations",...protectedFiles)==="");};check();
  const folder="src/server/db/migrations",names=text("ls-tree","-r","--name-only",HONORS_BASE,"--",folder).split("\n").filter(Boolean),priorNames=text("ls-tree","-r","--name-only",SOURCE_ASSIGNMENTS_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names,text("ls-tree","-r","--name-only",expectedCommit,"--",folder).split("\n").filter(Boolean))&&equal(names.filter(p=>!priorNames.includes(p)),[`${folder}/0022_honors_version.sql`,`${folder}/meta/0022_snapshot.json`].sort())&&priorNames.every(p=>names.includes(p)));
  const blobs=new Map();for(const path of names){const bytes=git("show",`${HONORS_BASE}:${path}`);need(bytes.equals(git("show",`${expectedCommit}:${path}`))&&bytes.equals(read(path)));if(priorNames.includes(path)&&!path.endsWith("/_journal.json"))need(bytes.equals(git("show",`${SOURCE_ASSIGNMENTS_BASE}:${path}`)));blobs.set(path,bytes);}
  for(const path of oldFiles)need(git("show",`${HONORS_BASE}:${path}`).equals(git("show",`${expectedCommit}:${path}`))&&git("show",`${expectedCommit}:${path}`).equals(read(path)));
  for(const path of HONORS_FILES)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));
  const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`)),prior=JSON.parse(git("show",`${SOURCE_ASSIGNMENTS_BASE}:${folder}/meta/_journal.json`));
  need(journal.entries?.length===23&&equal({...journal,entries:journal.entries.slice(0,22)},prior)&&journal.entries.every((row,index)=>row.idx===index&&row.version==="7"&&row.breakpoints===true&&Number.isSafeInteger(row.when)&&(!index||row.when>journal.entries[index-1].when))&&journal.entries[22].tag==="0022_honors_version");
  const migrations=journal.entries.map((row,index)=>{const bytes=blobs.get(`${folder}/${row.tag}.sql`);need(bytes&&!bytes.includes(13));const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));return {index,tag:row.tag,createdAt:row.when,hash:lf,historicalAllowed:index<11||index===13?[...new Set([lf,crlf])]:[lf]};});
  const recheck=()=>{check();for(const[path,bytes]of blobs)need(bytes.equals(read(path)));for(const path of protectedFiles)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));};
  return {expectedCommit,migrations,blobs,read,git,recheck,honorsSQL:blobs.get(`${folder}/0022_honors_version.sql`).toString("utf8")};
}
export function honorsSourceContract(expectedCommit,options={}){
  const source=honorsSourceDelta(expectedCommit,options),{git,read,blobs,migrations}=source,folder="src/server/db/migrations";
  const reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json")),oldNames=git("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).toString("utf8").trim().split("\n").filter(Boolean);
  const provenance=sha(Buffer.from(JSON.stringify(oldNames.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));need(reference.version===1&&reference.sourceCommit===RELEASE_BASE&&reference.migrationsSHA256===provenance);
  source.reference=reference;source.historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
  source.studentAfter=validateRosterReference(JSON.parse(read(ROSTER_REFERENCE)),reference,migrations[19].hash);source.recordingsAfter=validateRecordingsReference(JSON.parse(read(RECORDINGS_REFERENCE)),source);source.sourceAssignmentsAfter=validateSourceAssignmentsReference(JSON.parse(read(SOURCE_ASSIGNMENTS_REFERENCE)),source);
  source.honorsAfter=validateHonorsReference(JSON.parse(read(HONORS_REFERENCE)),source);return source;
}
export const parseHonorsTarget=(value,source)=>parseTarget(value,source);
export function checkHonorsLedger(rows,source,target){need(Array.isArray(rows)&&(rows.length===22||rows.length===23));const prefix=checkSourceAssignmentsLedger(rows.slice(0,22),source,target);if(rows.length===22)return prefix;const row=rows[22],last={id:Number(row.id),hash:row.hash,createdAt:Number(row.created_at)},migration=source.migrations[22];need(Number.isSafeInteger(last.id)&&last.id>prefix[21].id&&last.hash===migration.hash&&last.createdAt===migration.createdAt);return [...prefix,last];}
export function selectedHonorsReference(source,target,length){need(length===22||length===23);const before=selectedSourceAssignmentsReference(source,target,22);if(length===22)return before;return {...source.honorsAfter,functions:source.honorsAfter.functions.map(fn=>before.functions.find(old=>old.name===fn.name&&old.arguments===fn.arguments)??fn)};}
