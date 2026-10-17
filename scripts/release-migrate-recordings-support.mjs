import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_BASE, ROOT, RELEASE_FILES, sha, same, canonical, closed, need, parseTarget, historicalFunctionContract } from "./release-migrate-support.mjs";
import { ROSTER_BASE, ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference, checkRosterLedger, selectedRosterReference } from "./release-migrate-roster-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const RECORDINGS_BASE="f5b17215302f60ba18d385e97d2a014066636971";
export const RECORDINGS_REFERENCE="tests/fixtures/portal/release-recordings-reference.json";
export const RECORDINGS_FILES=["scripts/release-migrate-recordings.mjs","scripts/release-migrate-recordings-support.mjs",RECORDINGS_REFERENCE];
export const RECORDINGS_CATALOG_SHA="82ba6853c5c0bdacafcc699b318b1329a5e9a1ec0498d82bcfbae34c356fc6b0";
const equal=(a,b)=>same(canonical(a),canonical(b));
const order=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),"en"));

/** Exact native catalog plus a bounded, independently inspectable 0020 delta. */
export function validateRecordingsReference(reference,source){
  closed(reference,["version","sourceCommit","migrationSHA256","before","after"]);
  need(reference.version===1 && reference.sourceCommit===RECORDINGS_BASE && reference.migrationSHA256===source.migrations[20].hash);
  need(sha(JSON.stringify(canonical(reference.after)))===RECORDINGS_CATALOG_SHA);
  const previous=selectedRosterReference(source,{prefix:source.migrations.slice(0,15).map(row=>({hash:row.hash}))},20);
  need(equal(reference.before.tables.map(table=>table.name),["audit_event","student","tenant"]) && reference.before.functions.length===0 && reference.before.types.length===0);
  need(equal(referenceCatalog(reference.before).tables,previous.tables.filter(table=>["audit_event","student","tenant"].includes(table.name))));
  const {before,after}=reference,next=structuredClone(before);
  const addedTable=after.tables.filter(table=>!before.tables.some(old=>old.name===table.name));
  need(addedTable.length===1 && addedTable[0].name==="student_recording");next.tables.push(...addedTable);next.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  for(const name of ["student","tenant"]){
    const old=next.tables.find(table=>table.name===name),fresh=after.tables.find(table=>table.name===name);
    const added=fresh.triggers.filter(trigger=>!old.triggers.some(value=>equal(value,trigger)));
    const fk=name==="student"?"student_recording_student_fk":"student_recording_tenant_id_tenant_id_fk";
    need(added.filter(trigger=>trigger.internal && trigger.constraint_name===fk).length===2);
    need(added.length===(name==="student"?3:2));
    if(name==="student")need(added.some(trigger=>trigger.name==="recording_ceremony_retention" && !trigger.internal && trigger.function_name==="portal_recording_ceremony_change"));
    need(equal(order(structuredClone(old.triggers)),order(fresh.triggers.filter(trigger=>!added.includes(trigger)))));
    old.triggers=fresh.triggers;
  }
  const audit=next.tables.find(table=>table.name==="audit_event"),newAudit=after.tables.find(table=>table.name==="audit_event");
  const action=newAudit.constraints.filter(constraint=>constraint.name==="audit_action_known");need(action.length===1);
  audit.constraints=audit.constraints.map(constraint=>constraint.name==="audit_action_known"?action[0]:constraint);
  const addedFunctions=after.functions.filter(fn=>!before.functions.some(old=>equal(old,fn)));
  need(equal(addedFunctions.map(fn=>fn.name).sort(),["portal_recording_ceremony_change","portal_student_recording_transition"]));
  need(addedFunctions.every(fn=>fn.security_definer===false && equal(fn.config,["search_path=pg_catalog, public"])));
  next.functions.push(...addedFunctions);next.functions.sort((a,b)=>a.name.localeCompare(b.name,"en") || a.arguments.localeCompare(b.arguments,"en"));
  const addedTypes=after.types.filter(type=>!before.types.some(old=>equal(old,type)));
  need(equal(addedTypes.map(type=>type.name).sort(),["_student_recording","student_recording"]));
  next.types.push(...addedTypes);next.types.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  need(equal(next,after));
  const delta=referenceCatalog(after);
  return {...previous,tables:[...previous.tables.filter(old=>!delta.tables.some(table=>table.name===old.name)),...delta.tables].sort((a,b)=>a.name.localeCompare(b.name,"en")),
    functions:[...previous.functions,...delta.functions].sort((a,b)=>a.name.localeCompare(b.name,"en") || a.arguments.localeCompare(b.arguments,"en")),
    types:[...previous.types,...delta.types].sort((a,b)=>a.name.localeCompare(b.name,"en"))};
}

export function recordingsSourceContract(expectedCommit,options={}){
  need(/^[a-f0-9]{40}$/.test(expectedCommit));
  const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
  const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))}));
  const text=(...args)=>git(...args).toString("utf8").trim(),protectedFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES];
  const check=()=>{
    need(text("rev-parse","HEAD")===expectedCommit);
    if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());
    git("merge-base","--is-ancestor",RECORDINGS_BASE,expectedCommit);
    need(text("status","--porcelain=v1","--untracked-files=all","--","src/server/db/migrations",...protectedFiles)==="");
  };check();
  const folder="src/server/db/migrations",names=text("ls-tree","-r","--name-only",RECORDINGS_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names,text("ls-tree","-r","--name-only",expectedCommit,"--",folder).split("\n").filter(Boolean)));
  const priorNames=text("ls-tree","-r","--name-only",ROSTER_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names.filter(path=>!priorNames.includes(path)),[`${folder}/0020_student_recording_ledger.sql`,`${folder}/meta/0020_snapshot.json`].sort()));
  const blobs=new Map();for(const path of names){
    const bytes=git("show",`${RECORDINGS_BASE}:${path}`);
    need(bytes.equals(git("show",`${expectedCommit}:${path}`)) && bytes.equals(read(path)));
    if(priorNames.includes(path) && !path.endsWith("/_journal.json"))need(bytes.equals(git("show",`${ROSTER_BASE}:${path}`)));
    blobs.set(path,bytes);
  }
  for(const path of [...RELEASE_FILES,...ROSTER_FILES])need(git("show",`${RECORDINGS_BASE}:${path}`).equals(git("show",`${expectedCommit}:${path}`)) && git("show",`${expectedCommit}:${path}`).equals(read(path)));
  for(const path of RECORDINGS_FILES)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));
  const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`)),priorJournal=JSON.parse(git("show",`${ROSTER_BASE}:${folder}/meta/_journal.json`));
  need(journal.entries?.length===21 && equal({...journal,entries:journal.entries.slice(0,20)},priorJournal));
  need(journal.entries.every((row,index)=>row.idx===index && row.version==="7" && row.breakpoints===true && Number.isSafeInteger(row.when) && (!index || row.when>journal.entries[index-1].when)) && journal.entries[20].tag==="0020_student_recording_ledger");
  const migrations=journal.entries.map((row,index)=>{
    const bytes=blobs.get(`${folder}/${row.tag}.sql`);need(bytes && !bytes.includes(13));
    const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));
    return {index,tag:row.tag,createdAt:row.when,hash:lf,historicalAllowed:index<11 || index===13?[...new Set([lf,crlf])]:[lf]};
  });
  const reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json"));
  const oldNames=text("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).split("\n").filter(Boolean);
  const oldProvenance=sha(Buffer.from(JSON.stringify(oldNames.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));
  need(reference.version===1 && reference.sourceCommit===RELEASE_BASE && reference.migrationsSHA256===oldProvenance);
  const historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
  const studentAfter=validateRosterReference(JSON.parse(read(ROSTER_REFERENCE)),reference,migrations[19].hash);
  const source={expectedCommit,migrations,reference,historicalFunctions,studentAfter};
  const recordingsReference=JSON.parse(read(RECORDINGS_REFERENCE));source.recordingsAfter=validateRecordingsReference(recordingsReference,source);
  const recheck=()=>{check();for(const[path,bytes]of blobs)need(bytes.equals(read(path)));for(const path of protectedFiles)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));};
  return {...source,recheck};
}
export const parseRecordingsTarget=(value,source)=>parseTarget(value,source);
export function checkRecordingsLedger(rows,source,target){
  need(Array.isArray(rows) && (rows.length===20 || rows.length===21));
  const prefix=checkRosterLedger(rows.slice(0,20),source,target);if(rows.length===20)return prefix;
  const row=rows[20],last={id:Number(row.id),hash:row.hash,createdAt:Number(row.created_at)},migration=source.migrations[20];
  need(Number.isSafeInteger(last.id) && last.id>prefix[19].id && last.hash===migration.hash && last.createdAt===migration.createdAt);return [...prefix,last];
}
export function selectedRecordingsReference(source,target,length){
  need(length===20 || length===21);const before=selectedRosterReference(source,target,20);if(length===20)return before;
  // Reuse exclusive attested historical-function selection; never change actual SQL.
  return {...source.recordingsAfter,functions:source.recordingsAfter.functions.map(fn=>before.functions.find(old=>old.name===fn.name && old.arguments===fn.arguments)??fn)};
}
