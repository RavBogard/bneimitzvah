import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_BASE, ROOT, RELEASE_FILES, sha, same, canonical, closed, need, parseTarget, historicalFunctionContract } from "./release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "./release-migrate-roster-support.mjs";
import { RECORDINGS_BASE, RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference, checkRecordingsLedger, selectedRecordingsReference } from "./release-migrate-recordings-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const SOURCE_ASSIGNMENTS_BASE="f9de7c425436f7e0e31b9b292301a99dafe598b0";
export const SOURCE_ASSIGNMENTS_REFERENCE="tests/fixtures/portal/release-source-assignments-reference.json";
export const SOURCE_ASSIGNMENTS_FILES=["scripts/release-migrate-source-assignments.mjs","scripts/release-migrate-source-assignments-support.mjs",SOURCE_ASSIGNMENTS_REFERENCE];
export const SOURCE_ASSIGNMENTS_CATALOG_SHA="3d04b6f37a069edc30c2845268c4a99fc738f0b03e10e63cf10e1641ff72f0f3";
const equal=(a,b)=>same(canonical(a),canonical(b));
const order=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),"en"));
const affected=["assignment","audit_event","membership","role_grant","student","tenant"];

/** A fixed native-LF reference and only the reviewed 0021 structural delta. */
export function validateSourceAssignmentsReference(reference,source){
  closed(reference,["version","sourceCommit","migrationSHA256","before","after"]);
  need(reference.version===1 && reference.sourceCommit===SOURCE_ASSIGNMENTS_BASE && reference.migrationSHA256===source.migrations[21].hash);
  need(sha(JSON.stringify(canonical(reference.after)))===SOURCE_ASSIGNMENTS_CATALOG_SHA);
  const previous=selectedRecordingsReference(source,{prefix:source.migrations.slice(0,15).map(row=>({hash:row.hash}))},21);
  need(equal(reference.before.tables.map(table=>table.name),affected) && reference.before.functions.length===0 && reference.before.types.length===0);
  need(equal(referenceCatalog(reference.before).tables,previous.tables.filter(table=>affected.includes(table.name))));
  const {before,after}=reference,next=structuredClone(before);
  const added=after.tables.filter(table=>!before.tables.some(old=>old.name===table.name));
  need(added.length===1 && added[0].name==="verse_source_assignment");next.tables.push(...added);next.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  const fks={assignment:["verse_source_assignment_reading_fk"],membership:["verse_source_assignment_actor_fk"],role_grant:["verse_source_assignment_grant_fk","verse_source_assignment_role_fk"],student:["verse_source_assignment_student_fk"],tenant:["verse_source_assignment_tenant_id_tenant_id_fk"]};
  for(const[name,names]of Object.entries(fks)){
    const old=next.tables.find(table=>table.name===name),fresh=after.tables.find(table=>table.name===name);
    const extra=fresh.triggers.filter(trigger=>!old.triggers.some(value=>equal(value,trigger)));
    need(extra.length===names.length*2 && extra.every(trigger=>trigger.internal && names.includes(trigger.constraint_name)));
    for(const fk of names)need(extra.filter(trigger=>trigger.constraint_name===fk).length===2);
    need(equal(order(structuredClone(old.triggers)),order(fresh.triggers.filter(trigger=>!extra.includes(trigger)))));old.triggers=fresh.triggers;
  }
  const audit=next.tables.find(table=>table.name==="audit_event"),freshAudit=after.tables.find(table=>table.name==="audit_event");
  const action=freshAudit.constraints.filter(constraint=>constraint.name==="audit_action_known");need(action.length===1);
  audit.constraints=audit.constraints.map(constraint=>constraint.name==="audit_action_known"?action[0]:constraint);
  need(equal(after.functions.map(fn=>fn.name),["portal_source_citations_valid","portal_source_plain"]));
  need(after.functions.every(fn=>fn.security_definer===false && equal(fn.config,["search_path=pg_catalog, public"])));
  next.functions.push(...after.functions);
  need(equal(after.types.map(type=>type.name),["_verse_source_assignment","verse_source_assignment"]));next.types.push(...after.types);
  need(equal(next,after));
  const delta=referenceCatalog(after);
  return {...previous,tables:[...previous.tables.filter(old=>!delta.tables.some(table=>table.name===old.name)),...delta.tables].sort((a,b)=>a.name.localeCompare(b.name,"en")),
    functions:[...previous.functions,...delta.functions].sort((a,b)=>a.name.localeCompare(b.name,"en")||a.arguments.localeCompare(b.arguments,"en")),
    types:[...previous.types,...delta.types].sort((a,b)=>a.name.localeCompare(b.name,"en"))};
}

export function sourceAssignmentsSourceContract(expectedCommit,options={}){
  need(/^[a-f0-9]{40}$/.test(expectedCommit));
  const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
  const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))}));
  const text=(...args)=>git(...args).toString("utf8").trim(),oldFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES],protectedFiles=[...oldFiles,...SOURCE_ASSIGNMENTS_FILES];
  const check=()=>{need(text("rev-parse","HEAD")===expectedCommit);
    if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());
    git("merge-base","--is-ancestor",SOURCE_ASSIGNMENTS_BASE,expectedCommit);
    need(text("status","--porcelain=v1","--untracked-files=all","--","src/server/db/migrations",...protectedFiles)==="");};check();
  const folder="src/server/db/migrations",names=text("ls-tree","-r","--name-only",SOURCE_ASSIGNMENTS_BASE,"--",folder).split("\n").filter(Boolean),priorNames=text("ls-tree","-r","--name-only",RECORDINGS_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names,text("ls-tree","-r","--name-only",expectedCommit,"--",folder).split("\n").filter(Boolean)));
  need(equal(names.filter(path=>!priorNames.includes(path)),[`${folder}/0021_verse_source_assignments.sql`,`${folder}/meta/0021_snapshot.json`].sort()));
  const blobs=new Map();for(const path of names){const bytes=git("show",`${SOURCE_ASSIGNMENTS_BASE}:${path}`);
    need(bytes.equals(git("show",`${expectedCommit}:${path}`)) && bytes.equals(read(path)));
    if(priorNames.includes(path)&&!path.endsWith("/_journal.json"))need(bytes.equals(git("show",`${RECORDINGS_BASE}:${path}`)));blobs.set(path,bytes);}
  for(const path of oldFiles)need(git("show",`${SOURCE_ASSIGNMENTS_BASE}:${path}`).equals(git("show",`${expectedCommit}:${path}`))&&git("show",`${expectedCommit}:${path}`).equals(read(path)));
  for(const path of SOURCE_ASSIGNMENTS_FILES)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));
  const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`)),prior=JSON.parse(git("show",`${RECORDINGS_BASE}:${folder}/meta/_journal.json`));
  need(journal.entries?.length===22&&equal({...journal,entries:journal.entries.slice(0,21)},prior));
  need(journal.entries.every((row,index)=>row.idx===index&&row.version==="7"&&row.breakpoints===true&&Number.isSafeInteger(row.when)&&(!index||row.when>journal.entries[index-1].when))&&journal.entries[21].tag==="0021_verse_source_assignments");
  const migrations=journal.entries.map((row,index)=>{const bytes=blobs.get(`${folder}/${row.tag}.sql`);need(bytes&&!bytes.includes(13));const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));
    return {index,tag:row.tag,createdAt:row.when,hash:lf,historicalAllowed:index<11||index===13?[...new Set([lf,crlf])]:[lf]};});
  const reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json")),oldNames=text("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).split("\n").filter(Boolean);
  const provenance=sha(Buffer.from(JSON.stringify(oldNames.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));
  need(reference.version===1&&reference.sourceCommit===RELEASE_BASE&&reference.migrationsSHA256===provenance);
  const historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
  const studentAfter=validateRosterReference(JSON.parse(read(ROSTER_REFERENCE)),reference,migrations[19].hash),source={expectedCommit,migrations,reference,historicalFunctions,studentAfter};
  source.recordingsAfter=validateRecordingsReference(JSON.parse(read(RECORDINGS_REFERENCE)),source);
  source.sourceAssignmentsAfter=validateSourceAssignmentsReference(JSON.parse(read(SOURCE_ASSIGNMENTS_REFERENCE)),source);
  const recheck=()=>{check();for(const[path,bytes]of blobs)need(bytes.equals(read(path)));for(const path of protectedFiles)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));};
  return {...source,recheck};
}
export const parseSourceAssignmentsTarget=(value,source)=>parseTarget(value,source);
export function checkSourceAssignmentsLedger(rows,source,target){
  need(Array.isArray(rows)&&(rows.length===21||rows.length===22));const prefix=checkRecordingsLedger(rows.slice(0,21),source,target);if(rows.length===21)return prefix;
  const row=rows[21],last={id:Number(row.id),hash:row.hash,createdAt:Number(row.created_at)},migration=source.migrations[21];
  need(Number.isSafeInteger(last.id)&&last.id>prefix[20].id&&last.hash===migration.hash&&last.createdAt===migration.createdAt);return [...prefix,last];
}
export function selectedSourceAssignmentsReference(source,target,length){
  need(length===21||length===22);const before=selectedRecordingsReference(source,target,21);if(length===21)return before;
  return {...source.sourceAssignmentsAfter,functions:source.sourceAssignmentsAfter.functions.map(fn=>before.functions.find(old=>old.name===fn.name&&old.arguments===fn.arguments)??fn)};
}
