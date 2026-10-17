import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_BASE, ROOT, RELEASE_FILES, sha, same, canonical, closed, need, parseTarget, checkLedger, historicalFunctionContract, selectedReference } from "./release-migrate-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const ROSTER_BASE = "add56e72cd83e8077519cc233161bd322b6e65e7";
export const ROSTER_REFERENCE = "tests/fixtures/portal/release-roster-reference.json";
export const ROSTER_FILES = ["scripts/release-migrate-roster.mjs", "scripts/release-migrate-roster-support.mjs", ROSTER_REFERENCE];
export const ROSTER_COLUMNS = ["hebrew_name", "second_parent_email", "import_metadata"];
export const ROSTER_CHECKS = ["student_hebrew_name_bounded", "student_second_parent_bounded", "student_import_metadata_closed"];
// Captured by applying only the pinned 0019 SQL to a fresh native PostgreSQL
// 0018 fixture. Pin every deparsed CHECK detail, beyond the structural allow-list.
export const ROSTER_STUDENT_SHA = "c271b09b5968d4f431ebc7454364e616e05337c75ac32e5aa11daf1c1926ffaf";
const equal = (a,b) => same(canonical(a),canonical(b));

// The complete old student record must hash to the independently reviewed
// 0018 catalog. Only three nullable columns and their three CHECKs may differ.
export function validateRosterReference(reference, oldReference, migrationHash) {
  closed(reference,["version","sourceCommit","migrationSHA256","before","after"]);
  need(reference.version===1 && reference.sourceCommit===ROSTER_BASE && reference.migrationSHA256===migrationHash);
  const {before,after}=reference;
  need(sha(JSON.stringify(canonical(after)))===ROSTER_STUDENT_SHA);
  const oldStudent=oldReference.final.tables.find(table=>table.name==="student");
  need(oldStudent && equal(referenceCatalog({tables:[before],functions:[],types:[]}).tables[0],oldStudent));
  const next=structuredClone(before), position=Math.max(...before.columns.map(column=>column.position));
  next.columns.push(...ROSTER_COLUMNS.map((name,index)=>({position:position+index+1,name,type:name==="import_metadata"?"jsonb":"text",not_null:false,identity:"",generated:"",collation:name==="import_metadata"?null:"pg_catalog.default",default_expression:null})));
  const added=after.constraints.filter(constraint=>ROSTER_CHECKS.includes(constraint.name));
  need(added.length===3 && new Set(added.map(constraint=>constraint.name)).size===3);
  for(const constraint of added){
    const index=ROSTER_CHECKS.indexOf(constraint.name);
    need(equal({...constraint,definition:null},{name:constraint.name,type:"c",definition:null,keys:[position+index+1],referenced_keys:null,deferrable:false,deferred:false,valid:true,enforced:true,no_inherit:false,local:true,inherited_count:0,referenced_schema:null,referenced_table:null}));
    need(typeof constraint.definition==="string" && constraint.definition.startsWith("CHECK (") && constraint.definition.includes(ROSTER_COLUMNS[index]));
  }
  next.constraints.push(...added);next.constraints.sort((a,b)=>a.name.localeCompare(b.name,"en"));
  next.column_slots+=3;next.check_count+=3;
  need(equal(next,after));
  return referenceCatalog({tables:[after],functions:[],types:[]}).tables[0];
}

export function rosterSourceContract(expectedCommit, options={}) {
  need(/^[a-f0-9]{40}$/.test(expectedCommit));
  const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
  const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))}));
  const text=(...args)=>git(...args).toString("utf8").trim();
  const check=()=>{
    need(text("rev-parse","HEAD")===expectedCommit);
    if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());
    git("merge-base","--is-ancestor",ROSTER_BASE,expectedCommit);
    need(text("status","--porcelain=v1","--untracked-files=all","--","src/server/db/migrations",...RELEASE_FILES,...ROSTER_FILES)==="");
  };
  check();
  const folder="src/server/db/migrations",names=text("ls-tree","-r","--name-only",ROSTER_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names,text("ls-tree","-r","--name-only",expectedCommit,"--",folder).split("\n").filter(Boolean)));
  const oldNames=text("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).split("\n").filter(Boolean);
  need(equal(names.filter(path=>!oldNames.includes(path)),[`${folder}/0019_quiet_roster_intake.sql`,`${folder}/meta/0019_snapshot.json`].sort()));
  const blobs=new Map();
  for(const path of names){
    const bytes=git("show",`${ROSTER_BASE}:${path}`);
    need(bytes.equals(git("show",`${expectedCommit}:${path}`)) && bytes.equals(read(path)));
    if(oldNames.includes(path) && !path.endsWith("/_journal.json"))need(bytes.equals(git("show",`${RELEASE_BASE}:${path}`)));
    blobs.set(path,bytes);
  }
  for(const path of RELEASE_FILES)need(git("show",`${ROSTER_BASE}:${path}`).equals(git("show",`${expectedCommit}:${path}`)) && git("show",`${expectedCommit}:${path}`).equals(read(path)));
  for(const path of ROSTER_FILES)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));
  const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`)),oldJournal=JSON.parse(git("show",`${RELEASE_BASE}:${folder}/meta/_journal.json`));
  need(journal.entries?.length===20 && equal({...journal,entries:journal.entries.slice(0,19)},oldJournal));
  need(journal.entries.every((row,index)=>row.idx===index && row.version==="7" && row.breakpoints===true && Number.isSafeInteger(row.when) && (!index || row.when>journal.entries[index-1].when)));
  need(journal.entries[19].tag==="0019_quiet_roster_intake");
  const migrations=journal.entries.map((entry,index)=>{
    const bytes=blobs.get(`${folder}/${entry.tag}.sql`);need(bytes && !bytes.includes(13));
    const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));
    return {index,tag:entry.tag,createdAt:entry.when,hash:lf,historicalAllowed:index<11 || index===13?[...new Set([lf,crlf])]:[lf]};
  });
  const reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json"));
  const oldProvenance=sha(Buffer.from(JSON.stringify(oldNames.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));
  need(reference.version===1 && reference.sourceCommit===RELEASE_BASE && reference.migrationsSHA256===oldProvenance);
  const historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
  const rosterReference=JSON.parse(read(ROSTER_REFERENCE));
  const studentAfter=validateRosterReference(rosterReference,reference,migrations[19].hash);
  const recheck=()=>{check();for(const[path,bytes]of blobs)need(bytes.equals(read(path)));for(const path of [...RELEASE_FILES,...ROSTER_FILES])need(git("show",`${expectedCommit}:${path}`).equals(read(path)));};
  return {expectedCommit,migrations,reference,historicalFunctions,studentAfter,recheck};
}

export const parseRosterTarget=(value,source)=>parseTarget(value,source);
export function checkRosterLedger(rows,source,target){
  need(Array.isArray(rows) && (rows.length===19 || rows.length===20));
  const prefix=checkLedger(rows.slice(0,19),source,target);
  if(rows.length===19)return prefix;
  const row=rows[19],last={id:Number(row.id),hash:row.hash,createdAt:Number(row.created_at)},migration=source.migrations[19];
  need(Number.isSafeInteger(last.id) && last.id>prefix[18].id && last.hash===migration.hash && last.createdAt===migration.createdAt);
  return [...prefix,last];
}
export function selectedRosterReference(source,target,length){
  need(length===19 || length===20);
  const previous=selectedReference(source,target,19);
  return length===19?previous:{...previous,tables:previous.tables.map(table=>table.name==="student"?source.studentAfter:table)};
}
