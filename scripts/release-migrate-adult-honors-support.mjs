import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, RELEASE_BASE, RELEASE_FILES, need, same, sha, canonical, closed, historicalFunctionContract } from "./release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "./release-migrate-roster-support.mjs";
import { RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference } from "./release-migrate-recordings-support.mjs";
import { SOURCE_ASSIGNMENTS_FILES, SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference } from "./release-migrate-source-assignments-support.mjs";
import { HONORS_FILES, HONORS_REFERENCE, validateHonorsReference } from "./release-migrate-honors-support.mjs";
import { HONOREE_FILES, HONOREE_REFERENCE, validateHonoreeReference, selectedHonoreeReference, parseHonoreeTarget, checkHonoreeLedger } from "./release-migrate-honoree-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const ADULT_HONORS_BASE="19012047bf1c5df91906a7b756d91f6cf185b96c";
export const ADULT_HONORS_REFERENCE="tests/fixtures/portal/release-adult-honors-reference.json";
export const ADULT_HONORS_FILES=["scripts/release-migrate-adult-honors.mjs","scripts/release-migrate-adult-honors-support.mjs",ADULT_HONORS_REFERENCE,"tests/release-adult-honors.test.mjs","tests/helpers/release-adult-honors-fixture.mjs","tests/postgres/release-adult-honors.acceptance.mjs"];
// Root independently accepted the owned native capture at this exact committed
// preparation revision. No CLI flag, environment switch or model bypass exists.
export const ADULT_HONORS_CAPTURE_COMMIT="94ebeef8e24248d1cb792652c77c00110396e806";
export const ADULT_HONORS_REFERENCE_SHA="abb82e96e697e30933087317c8326d042b94b24af7bd3ea5accecf496b47781b";
export const ADULT_HONORS_CATALOG_SHA="c1a3f7e5631ad9b41d45c10d355d30aa650d9f9dda170bb3d5a99ed6f0760d87";
export const ADULT_HONORS_SQL_SHA="eafcb94d7825d00f061c008abef43154f6ff4dc8579c993fc66f8a9749f57906";
export const ADULT_HONORS_TABLES=["honors_version","honoree_link","honoree_operation"];
const folder="src/server/db/migrations",equal=(a,b)=>same(canonical(a),canonical(b));
const ordered=rows=>rows.sort((a,b)=>JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b)),"en"));
const hashPattern=/^[a-f0-9]{64}$/;

export function adultHonorsSourceDelta(expectedCommit,options={}){
 need(/^[a-f0-9]{40}$/.test(expectedCommit));const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
 const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))}));
 const text=(...args)=>git(...args).toString("utf8").trim();
 const oldFiles=[...new Set([...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES,...SOURCE_ASSIGNMENTS_FILES,...HONORS_FILES,...HONOREE_FILES,"tests/release-honors.test.mjs","tests/helpers/release-honors-fixture.mjs","tests/postgres/release-honors.acceptance.mjs","tests/helpers/adult-honors-upgrade.mjs"])];
 const protectedFiles=[...new Set([...oldFiles,...ADULT_HONORS_FILES])];
 const check=()=>{need(text("rev-parse","HEAD")===expectedCommit);if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());git("merge-base","--is-ancestor",ADULT_HONORS_BASE,expectedCommit);need(text("status","--porcelain=v1","--untracked-files=all","--",folder,...protectedFiles)==="");};check();
 const tree=commit=>text("ls-tree","-r","--name-only",commit,"--",folder).split("\n").filter(Boolean),all=tree(ADULT_HONORS_BASE);need(equal(all,tree(expectedCommit)));
 const blobs=new Map(),protectedBlobs=new Map();
 for(const path of all){const bytes=Buffer.from(git("show",`${ADULT_HONORS_BASE}:${path}`));need(bytes.equals(git("show",`${expectedCommit}:${path}`))&&bytes.equals(read(path)));blobs.set(path,bytes);}
 for(const path of oldFiles){const bytes=Buffer.from(git("show",`${ADULT_HONORS_BASE}:${path}`));need(bytes.equals(git("show",`${expectedCommit}:${path}`))&&bytes.equals(read(path)));protectedBlobs.set(path,bytes);}
 for(const path of ADULT_HONORS_FILES){const bytes=Buffer.from(git("show",`${expectedCommit}:${path}`));need(bytes.equals(read(path)));protectedBlobs.set(path,bytes);}
 const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`));
 // Independently pin the actual0023 journal and entire SQL/snapshot tree.
 const oldCommit="122a35f7fa4eea45c690d8be7f96bc80025ee5a2",oldNames=tree(oldCommit),oldJournal=JSON.parse(git("show",`${oldCommit}:${folder}/meta/_journal.json`));
 need(journal.entries?.length===25&&equal({...journal,entries:journal.entries.slice(0,24)},oldJournal));
 need(equal(all.filter(path=>!oldNames.includes(path)),[`${folder}/0024_adult_self_honors.sql`,`${folder}/meta/0024_snapshot.json`].sort()));
 for(const path of oldNames)if(!path.endsWith("/_journal.json"))need(blobs.get(path)?.equals(git("show",`${oldCommit}:${path}`)));
 need(journal.entries.every((r,i)=>r.idx===i&&r.version==="7"&&r.breakpoints===true&&Number.isSafeInteger(r.when)&&(!i||r.when>journal.entries[i-1].when))&&journal.entries[24].tag==="0024_adult_self_honors");
 const migrations=journal.entries.map((r,index)=>{const bytes=blobs.get(`${folder}/${r.tag}.sql`);need(bytes&&!bytes.includes(13));const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));return{index,tag:r.tag,createdAt:r.when,hash:lf,historicalAllowed:index<11||index===13?[...new Set([lf,crlf])]:[lf]};});
 need(migrations[24].hash===ADULT_HONORS_SQL_SHA);
 const migrationBlobs=new Map([...blobs].map(([path,bytes])=>[path,Buffer.from(bytes)]));
 const recheck=()=>{check();for(const[p,b]of migrationBlobs)need(b.equals(read(p)));for(const[p,b]of protectedBlobs)need(b.equals(read(p)));};
 return{expectedCommit,migrations,blobs,read,git,recheck,honorsSQL:blobs.get(`${folder}/0022_honors_version.sql`).toString("utf8"),honoreeSQL:blobs.get(`${folder}/0023_honoree_links.sql`).toString("utf8"),adultHonorsSQL:blobs.get(`${folder}/0024_adult_self_honors.sql`).toString("utf8")};
}

/** Capture seam only: validates immutable committed preparation and every old
 * native reference. It never creates or installs adult native evidence. */
export function adultHonorsReferenceSource(commit,options={}){
 const source=adultHonorsSourceDelta(commit,options),{read,git,blobs,migrations}=source,reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json"));
 const names=git("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).toString("utf8").trim().split("\n");need(reference.version===1&&reference.sourceCommit===RELEASE_BASE&&reference.migrationsSHA256===sha(JSON.stringify(names.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));
 source.reference=reference;source.historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
 source.studentAfter=validateRosterReference(JSON.parse(read(ROSTER_REFERENCE)),reference,migrations[19].hash);source.recordingsAfter=validateRecordingsReference(JSON.parse(read(RECORDINGS_REFERENCE)),source);source.sourceAssignmentsAfter=validateSourceAssignmentsReference(JSON.parse(read(SOURCE_ASSIGNMENTS_REFERENCE)),source);source.honorsAfter=validateHonorsReference(JSON.parse(read(HONORS_REFERENCE)),source);source.honoreeAfter=validateHonoreeReference(read(HONOREE_REFERENCE),source);source.adultHonorsBefore=JSON.parse(read(HONOREE_REFERENCE)).after;return source;
}

const riTrigger=(constraint,child,event)=>({name:null,internal:true,constraint_name:constraint,type:event==="insert"?5:event==="delete"?9:17,enabled:"O",columns:"",arguments:"",condition:null,function_schema:"pg_catalog",function_name:child?"RI_FKey_check_"+(event==="insert"?"ins":"upd"):"RI_FKey_noaction_"+(event==="delete"?"del":"upd"),deferrable:false,deferred:false});
/** Exact structural model for reviewing a genuine capture. Never native proof. */
export function expectedAdultHonorsCatalog(before,sql){
 need(sha(sql)===ADULT_HONORS_SQL_SHA);const after=structuredClone(before),identity=after.tables.find(t=>t.name==="student_identity");need(identity);
 const checks={honors_version:"honors_version_author",honoree_link:"honoree_link_shape",honoree_operation:"honoree_operation_shape"};
 for(const name of ADULT_HONORS_TABLES){
  const t=after.tables.find(t=>t.name===name);need(t&&!t.columns.some(c=>c.name==="student_identity_id"));const position=t.columns.length+1;
  t.column_slots++;t.columns.push({position,name:"student_identity_id",type:"uuid",not_null:false,identity:"",generated:"",collation:null,default_expression:null});
  const c=t.constraints.find(c=>c.name===checks[name]);need(c);const actor=name==="honors_version"?"mode":"role",type=name==="honors_version"?"context_mode":"portal_role";
  const old=`${actor} = 'parent'::${type} AND guardian_id IS NOT NULL OR ${actor} = 'admin'::${type} AND guardian_id IS NULL`;
  const next=`${actor} = 'parent'::${type} AND guardian_id IS NOT NULL AND student_identity_id IS NULL OR ${actor} = 'admin'::${type} AND guardian_id IS NULL AND student_identity_id IS NULL OR ${actor} = 'student'::${type} AND guardian_id IS NULL AND student_identity_id IS NOT NULL`;
  need(c.definition.includes(old));c.definition=c.definition.replace(old,next);c.keys=name==="honoree_operation"?[...c.keys.slice(0,-1),position,c.keys.at(-1)]:[...c.keys,position];
  const fkName=name+"_student_identity_fk",col=key=>t.columns.find(c=>c.name===key).position;
  const fk={...t.constraints.find(c=>c.type==="f"),name:fkName,definition:"FOREIGN KEY (tenant_id, student_identity_id, student_id, role_grant_id) REFERENCES student_identity(tenant_id, id, student_id, role_grant_id)",keys:["tenant_id","student_identity_id","student_id","role_grant_id"].map(col),referenced_schema:"public",referenced_table:"student_identity",referenced_keys:[2,1,3,4]};
  need(fk.type==="f");t.constraints.push(fk);t.constraints.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  t.triggers.push(riTrigger(fkName,true,"insert"),riTrigger(fkName,true,"update"));identity.triggers.push(riTrigger(fkName,false,"delete"),riTrigger(fkName,false,"update"));
 }
 const fn=after.functions.find(f=>f.name==="portal_honoree_student_epoch"&&f.arguments==="");need(fn);const expected=sql.match(/AS \$\$([\s\S]*)\$\$;/)?.[1];need(expected);fn.source=expected;
 return after;
}
export function validateAdultHonorsDelta(value,sql){
 const expected=expectedAdultHonorsCatalog(value.before,sql),actual=structuredClone(value.after);
 for(const catalog of [expected,actual])for(const t of catalog.tables)t.triggers=ordered(t.triggers);
 need(equal(expected,actual));return referenceCatalog(value.after);
}
export function validateAdultHonorsReference(bytes,source){
 need(/^[a-f0-9]{40}$/.test(ADULT_HONORS_CAPTURE_COMMIT)&&hashPattern.test(ADULT_HONORS_REFERENCE_SHA)&&hashPattern.test(ADULT_HONORS_CATALOG_SHA));need(sha(bytes)===ADULT_HONORS_REFERENCE_SHA);
 const ref=JSON.parse(bytes);closed(ref,["version","evidence","sourceCommit","migrationSHA256","before","after"]);need(ref.version===1&&ref.evidence==="owned-native-capture"&&ref.sourceCommit===ADULT_HONORS_CAPTURE_COMMIT&&ref.migrationSHA256===source.migrations[24].hash);
 source.git("merge-base","--is-ancestor",ref.sourceCommit,source.expectedCommit);need(source.git("show",`${ref.sourceCommit}:${folder}/0024_adult_self_honors.sql`).equals(source.blobs.get(`${folder}/0024_adult_self_honors.sql`)));
 need(sha(JSON.stringify(canonical(ref.after)))===ADULT_HONORS_CATALOG_SHA);
 need(equal(referenceCatalog(ref.before),selectedHonoreeReference(source,{prefix:source.migrations.slice(0,15).map(m=>({hash:m.hash}))},24)));
 const after=validateAdultHonorsDelta(ref,source.adultHonorsSQL);source.adultHonorsBefore=ref.before;return after;
}
export function adultHonorsSourceContract(commit,options={}){const source=adultHonorsReferenceSource(commit,options);source.adultHonorsAfter=validateAdultHonorsReference(source.read(ADULT_HONORS_REFERENCE),source);return source;}
export const parseAdultHonorsTarget=parseHonoreeTarget;
export function checkAdultHonorsLedger(rows,source,target){need(Array.isArray(rows)&&(rows.length===24||rows.length===25));const prefix=checkHonoreeLedger(rows.slice(0,24),source,target);if(rows.length===24)return prefix;const r=rows[24],m=source.migrations[24],last={id:Number(r.id),hash:r.hash,createdAt:Number(r.created_at)};need(Number.isSafeInteger(last.id)&&last.id>prefix[23].id&&last.hash===m.hash&&last.createdAt===m.createdAt);return[...prefix,last];}
export function selectedAdultHonorsReference(source,target,length){need(length===24||length===25);const before=selectedHonoreeReference(source,target,24);return length===24?before:{...source.adultHonorsAfter,functions:source.adultHonorsAfter.functions.map(fn=>fn.name==="portal_honoree_student_epoch"?fn:before.functions.find(old=>old.name===fn.name&&old.arguments===fn.arguments)??fn)};}
