import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_BASE, ROOT, RELEASE_FILES, sha, same, canonical, closed, need, parseTarget, historicalFunctionContract } from "./release-migrate-support.mjs";
import { ROSTER_FILES, ROSTER_REFERENCE, validateRosterReference } from "./release-migrate-roster-support.mjs";
import { RECORDINGS_FILES, RECORDINGS_REFERENCE, validateRecordingsReference } from "./release-migrate-recordings-support.mjs";
import { SOURCE_ASSIGNMENTS_FILES, SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference } from "./release-migrate-source-assignments-support.mjs";
import { HONORS_BASE, HONORS_FILES, HONORS_REFERENCE, validateHonorsReference, checkHonorsLedger, selectedHonorsReference } from "./release-migrate-honors-support.mjs";
import { referenceCatalog } from "./release-migrate-catalog.mjs";

export const HONOREE_BASE="122a35f7fa4eea45c690d8be7f96bc80025ee5a2";
export const HONOREE_REFERENCE="tests/fixtures/portal/release-honoree-reference.json";
export const HONOREE_FILES=["scripts/release-migrate-honoree.mjs","scripts/release-migrate-honoree-support.mjs",HONOREE_REFERENCE,"tests/release-honoree.test.mjs","tests/helpers/release-honoree-fixture.mjs","tests/postgres/release-honoree.acceptance.mjs"];
// MODEL ONLY until root captures and an independent reviewer accepts actual metadata.
// Null pins intentionally prevent every production source contract/target access.
export const HONOREE_REFERENCE_SHA=null;
export const HONOREE_CATALOG_SHA=null;
export const HONOREE_TABLES=["honoree_group_epoch","honoree_link","honoree_material_release","honoree_operation","honoree_reading_epoch"];
export const HONOREE_AFFECTED=["assignment","assignment_verse","audit_event","guardian","honors_version","membership","role_grant","service_catalog","service_catalog_lifecycle","student","tenant"];
const equal=(a,b)=>same(canonical(a),canonical(b));
const order=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),"en"));
const hashPattern=/^[a-f0-9]{64}$/;
const names=value=>value.replaceAll('"','').split(',').map(s=>s.trim());

// Closed expectations for the immutable LF SQL, NOT captured native evidence.
// A future actual capture must match these deparsed expressions byte-for-byte;
// differences require review, never cast/parenthesis/whitespace normalization.
const HONOREE_SQL_SHA="97a98de198b52019b1ccde762d450e72ae6f5e54e675806d78d27a0d21c97059";
const checkDefinitions={
 honoree_group_epoch_positive:{keys:["epoch"],definition:"CHECK (epoch >= 0)"},
 honoree_group_start:{keys:["start_verse"],definition:"CHECK (length(start_verse) >= 1 AND length(start_verse) <= 80 AND start_verse ~ '^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$'::text)"},
 honoree_link_shape:{keys:["id","context_hash","token_hash","key_id","reading_epoch","group_epoch","honors_version","role","guardian_id"],definition:"CHECK (id ~ '^[A-Za-z0-9_-]{22}$'::text AND context_hash ~ '^[a-f0-9]{64}$'::text AND token_hash ~ '^[a-f0-9]{64}$'::text AND key_id = 'k1'::text AND reading_epoch >= 0 AND group_epoch >= 0 AND honors_version > 0 AND (role = 'parent'::portal_role AND guardian_id IS NOT NULL OR role = 'admin'::portal_role AND guardian_id IS NULL))"},
 honoree_link_instants:{keys:["issued_at","expires_at","revoked_at"],definition:"CHECK (isfinite(issued_at) AND isfinite(expires_at) AND expires_at > issued_at AND expires_at <= (issued_at + '2160:00:00'::interval) AND (revoked_at IS NULL OR isfinite(revoked_at) AND revoked_at >= issued_at))"},
 honoree_material_shape:{keys:["state","slot","projection_digest","catalog_identity","material_version","approval_basis","created_at"],definition:"CHECK ((state = ANY (ARRAY['active'::text, 'withdrawn'::text])) AND (slot = ANY (ARRAY['morning'::text, 'havdalah'::text])) AND projection_digest ~ '^[a-f0-9]{64}$'::text AND catalog_identity ~ '^[a-f0-9]{64}$'::text AND length(material_version) >= 1 AND length(material_version) <= 128 AND octet_length(approval_basis) >= 1 AND octet_length(approval_basis) <= 4096 AND isfinite(created_at))"},
 honoree_material_units:{keys:["before_id","slot","after_id"],definition:"CHECK (before_id = ('torah.blessing-before-the-torah-reading@'::text ||\nCASE\n    WHEN slot = 'morning'::text THEN 'bm-shacharit'::text\n    ELSE 'bm-maariv'::text\nEND) AND after_id = ('torah.blessing-following-the-torah-reading@'::text ||\nCASE\n    WHEN slot = 'morning'::text THEN 'bm-shacharit'::text\n    ELSE 'bm-maariv'::text\nEND))"},
 honoree_material_notices:{keys:["notices"],definition:"CHECK (portal_honoree_notices_valid(notices))"},
 honoree_operation_shape:{keys:["request_digest","operation","role","guardian_id","created_at"],definition:"CHECK (request_digest ~ '^[a-f0-9]{64}$'::text AND (operation = ANY (ARRAY['issue'::text, 'revoke'::text, 'reissue'::text])) AND (role = 'parent'::portal_role AND guardian_id IS NOT NULL OR role = 'admin'::portal_role AND guardian_id IS NULL) AND isfinite(created_at))"},
 honoree_reading_epoch_positive:{keys:["epoch"],definition:"CHECK (epoch >= 0)"}
};
const partialIndexes={
 honoree_link:{name:"honoree_link_one_current",keys:["tenant_id","student_id","start_verse"],predicate:"(revoked_at IS NULL)"},
 honoree_material_release:{name:"honoree_material_active_slot",keys:["tenant_id","slot"],predicate:"(state = 'active'::text)"}
};

/** SQL-derived structural contract, not a fabricated native reference. */
export function honoreeSQLContract(sql){
 need(typeof sql==="string"&&!sql.includes("\r")&&sha(sql)===HONOREE_SQL_SHA);
 const tables=[...sql.matchAll(/CREATE TABLE "(honoree_[a-z_]+)" \(([\s\S]*?)\n\);/g)].map(([,name,body])=>({name,
  columns:[...body.matchAll(/^\s*"([a-z_]+)" ([^,\n]+),?$/gm)].map(([,name,definition])=>({name,type:definition.replace(/ (PRIMARY KEY|DEFAULT|NOT NULL).*$/,"").replaceAll('"',''),notNull:/NOT NULL/.test(definition),defaultExpression:definition.match(/DEFAULT (.*?) NOT NULL/)?.[1]??null})),
  checks:[...body.matchAll(/CONSTRAINT "([a-z_]+)" CHECK/g)].map(m=>m[1]),
  uniques:[...body.matchAll(/CONSTRAINT "([a-z_]+)" UNIQUE\(([^)]+)\)/g)].map(m=>({name:m[1],keys:names(m[2])})),
  primary:[...body.matchAll(/^\s*"([a-z_]+)" [^\n]*PRIMARY KEY/gm)].map(m=>m[1])}));
 need(equal(tables.map(t=>t.name).sort(),HONOREE_TABLES));
 need(equal(tables.flatMap(t=>t.checks).sort(),Object.keys(checkDefinitions).sort()));
 for(const table of tables){
  table.checkDefinitions=table.checks.map(name=>({name,...checkDefinitions[name]}));
  const index=(name,keys,primary=false,predicate=null)=>({name,definition:`CREATE UNIQUE INDEX ${name} ON public.${table.name} USING btree (${keys.join(", ")})${predicate?` WHERE ${predicate}`:""}`,unique:true,primary,valid:true,ready:true,live:true,immediate:true});
  table.indexes=[...table.uniques.map(u=>index(u.name,u.keys)),...(table.primary.length?[index(table.name+"_pkey",table.primary,true)]:[])];
  const partial=partialIndexes[table.name];if(partial)table.indexes.push(index(partial.name,partial.keys,false,partial.predicate));
 }
 need(tables.reduce((n,t)=>n+t.indexes.length,0)===11);
 const foreign=[...sql.matchAll(/ALTER TABLE "([a-z_]+)" ADD CONSTRAINT "([a-z_]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "public"\."([a-z_]+)"\(([^)]+)\) ON DELETE no action ON UPDATE no action;/g)].map(m=>({table:m[1],name:m[2],keys:names(m[3]),target:m[4],refs:names(m[5])}));
 need(foreign.length===22);
 const triggers=[...sql.matchAll(/CREATE TRIGGER ([a-z_]+) (BEFORE|AFTER) (.*?) ON ([a-z_]+) FOR EACH ROW EXECUTE FUNCTION ([a-z_]+)\(\);/g)].map(([,name,timing,events,table,fn])=>({table,name,internal:false,constraint_name:null,type:1+(timing==="BEFORE"?2:0)+events.split(" OR ").reduce((n,e)=>n+({INSERT:4,DELETE:8,UPDATE:16}[e]??NaN),0),enabled:"O",columns:"",arguments:"",condition:null,function_schema:"public",function_name:fn,deferrable:false,deferred:false}));
 need(triggers.length===11&&triggers.every(t=>Number.isInteger(t.type)));
 const functions=[...sql.matchAll(/CREATE FUNCTION public\.(portal_honoree_[a-z_]+)\(([^)]*)\) RETURNS (boolean|trigger) LANGUAGE plpgsql( IMMUTABLE)? SET search_path=pg_catalog,public AS \$\$([\s\S]*?)\$\$;/g)].map(m=>({name:m[1],arguments:m[2],result:m[3],language:"plpgsql",source:m[5],binary:null,owner:"$OWNER",security_definer:false,volatility:m[4]?"i":"v",strict:false,leakproof:false,parallel:"u",kind:"f",returns_set:false,config:["search_path=pg_catalog, public"],grants:[{role:"portal_runtime",grantor:"$OWNER",privilege:"EXECUTE",grantable:false}]})).sort((a,b)=>a.name.localeCompare(b.name,"en"));
 need(functions.length===10);
 return {tables,foreign,triggers,functions};
}
function riTrigger(foreign,child,event){return {name:null,internal:true,constraint_name:foreign.name,type:event==="insert"?5:event==="delete"?9:17,enabled:"O",columns:"",arguments:"",condition:null,function_schema:"pg_catalog",function_name:child?"RI_FKey_check_"+(event==="insert"?"ins":"upd"):"RI_FKey_noaction_"+(event==="delete"?"del":"upd"),deferrable:false,deferred:false};}
function expectedTriggers(contract,table){
 const result=contract.triggers.filter(t=>t.table===table).map(({table,...t})=>t);
 for(const fk of contract.foreign){if(fk.table===table)result.push(riTrigger(fk,true,"insert"),riTrigger(fk,true,"update"));if(fk.target===table)result.push(riTrigger(fk,false,"delete"),riTrigger(fk,false,"update"));}
 return result;
}
function validateTable(table,definition,contract){
 need(table.kind==="r"&&table.owner==="$OWNER"&&table.persistence==="p"&&table.rls===true&&table.force_rls===true&&table.options===null&&table.replica_identity==="d"&&table.column_slots===definition.columns.length&&table.check_count===definition.checks.length);
 need(table.columns.length===definition.columns.length);
 for(const [i,c] of table.columns.entries()){
  const d=definition.columns[i];need(c.name===d.name&&c.type===d.type&&c.position===i+1&&c.not_null===d.notNull&&c.identity===""&&c.generated===""&&c.collation===(c.type==="text"?'pg_catalog.default':null));
  need(c.default_expression===d.defaultExpression);
 }
 const policy="tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)";
 need(equal(table.policies,[{name:"tenant_isolation",command:"*",permissive:true,roles:"{portal_runtime}",using_expression:policy,check_expression:policy}]));
 const grant=privilege=>({role:"portal_runtime",grantor:"$OWNER",privilege,grantable:false});
 const material=table.name==="honoree_material_release";
 need(equal(order([...table.grants]),order((material?["SELECT"]:["INSERT","SELECT"]).map(grant))));
 const column=table.name.endsWith("_epoch")?"epoch":table.name==="honoree_link"?"revoked_at":material?"id":null;
 need(equal(table.columnGrants,column?[{...grant("UPDATE"),column}]:[]));
 const foreign=contract.foreign.filter(f=>f.table===table.name),keys=[...definition.checks,...definition.uniques.map(u=>u.name),...foreign.map(f=>f.name),...(definition.primary.length?[table.name+"_pkey"]:[])].sort();
 need(equal(table.constraints.map(c=>c.name).sort(),keys));
 for(const c of table.constraints)need(c.valid===true&&c.enforced===true&&c.deferrable===false&&c.deferred===false&&c.no_inherit===(c.type!=="c")&&c.local===true&&c.inherited_count===0);
 const positions=keys=>keys.map(k=>{const i=definition.columns.findIndex(c=>c.name===k);need(i>=0);return i+1;});
 for(const fk of foreign){const c=table.constraints.find(c=>c.name===fk.name);need(c.type==="f"&&c.referenced_schema==="public"&&c.referenced_table===fk.target&&c.definition===`FOREIGN KEY (${fk.keys.join(", ")}) REFERENCES ${fk.target}(${fk.refs.join(", ")})`&&equal(c.keys,fk.keys.map(k=>definition.columns.findIndex(c=>c.name===k)+1)));}
 for(const c of table.constraints.filter(c=>c.type!=="f"))need(c.referenced_schema===null&&c.referenced_table===null&&c.referenced_keys===null);
 for(const unique of definition.uniques){const c=table.constraints.find(c=>c.name===unique.name);need(c.type==="u"&&c.definition===`UNIQUE (${unique.keys.join(", ")})`&&equal(c.keys,positions(unique.keys)));}
 for(const check of definition.checkDefinitions){const c=table.constraints.find(c=>c.name===check.name);need(c.type==="c"&&c.definition===check.definition&&equal(c.keys,positions(check.keys)));}
 if(definition.primary.length){const c=table.constraints.find(c=>c.name===table.name+"_pkey");need(c.type==="p"&&c.definition===`PRIMARY KEY (${definition.primary.join(", ")})`&&equal(c.keys,positions(definition.primary)));}
 need(equal(order([...table.indexes]),order([...definition.indexes])));
 need(equal(order([...table.triggers]),order(expectedTriggers(contract,table.name))));
}
/** Full before/after metadata must come from actual native capture. This
 * structural checker alone is never permission to install a model as evidence. */
export function validateHonoreeDelta(value,sql){
 closed(value,["before","after"]);const {before,after}=value,contract=honoreeSQLContract(sql),next=structuredClone(before);
 need(before.tables.every(t=>!HONOREE_TABLES.includes(t.name)));
 const added=after.tables.filter(t=>HONOREE_TABLES.includes(t.name));need(equal(added.map(t=>t.name).sort(),HONOREE_TABLES));
 for(const table of added)validateTable(table,contract.tables.find(t=>t.name===table.name),contract);
 for(const old of next.tables){const fresh=after.tables.find(t=>t.name===old.name);need(fresh);old.triggers=order([...old.triggers,...expectedTriggers(contract,old.name)]);
  if(old.name==="audit_event"){
   const constraint=old.constraints.find(c=>c.name==="audit_action_known"),freshConstraint=fresh.constraints.find(c=>c.name===constraint?.name);need(constraint&&freshConstraint&&constraint.definition.endsWith("::text]))"));
   const definition=constraint.definition.replace(/::text\]\)\)$/, "::text, 'honoree.issue'::text, 'honoree.revoke'::text, 'honoree.reissue'::text]))");need(definition!==constraint.definition);Object.assign(constraint,{definition});
  }
  need(equal(old,fresh));
 }
 next.tables.push(...added);next.tables.sort((a,b)=>a.name.localeCompare(b.name,"en"));
 const functions=after.functions.filter(f=>!before.functions.some(old=>old.name===f.name&&old.arguments===f.arguments));need(equal(functions,contract.functions));next.functions.push(...functions);next.functions.sort((a,b)=>a.name.localeCompare(b.name,"en")||a.arguments.localeCompare(b.arguments,"en"));
 const types=HONOREE_TABLES.flatMap(name=>[{name,kind:"c",owner:"$OWNER",element:null,labels:"{}"},{name:"_"+name,kind:"b",owner:"$OWNER",element:name,labels:"{}"}]);next.types.push(...types);next.types.sort((a,b)=>a.name.localeCompare(b.name,"en"));
 need(equal(next,after));return referenceCatalog(after);
}

export function honoreeSourceDelta(expectedCommit,options={}){
 need(/^[a-f0-9]{40}$/.test(expectedCommit));const root=options.root??ROOT,read=options.read??(path=>readFileSync(resolve(root,path)));
 const git=options.git??((...args)=>execFileSync("git",["-c","core.fsmonitor=false",...args],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,stdio:["ignore","pipe","pipe"],env:Object.fromEntries(["SystemRoot","WINDIR","PATH","PATHEXT","TEMP","TMP"].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))}));
 const text=(...args)=>git(...args).toString("utf8").trim();
 const oldFiles=[...RELEASE_FILES,...ROSTER_FILES,...RECORDINGS_FILES,...SOURCE_ASSIGNMENTS_FILES,...HONORS_FILES,"tests/release-honors.test.mjs","tests/helpers/release-honors-fixture.mjs","tests/postgres/release-honors.acceptance.mjs"];
 const protectedFiles=[...new Set([...oldFiles,...HONOREE_FILES])];
 const check=()=>{need(text("rev-parse","HEAD")===expectedCommit);if(!options.git)need(realpathSync(text("rev-parse","--show-toplevel")).toLowerCase()===realpathSync(root).toLowerCase());git("merge-base","--is-ancestor",HONOREE_BASE,expectedCommit);need(text("status","--porcelain=v1","--untracked-files=all","--","src/server/db/migrations",...protectedFiles)==="");};check();
 const folder="src/server/db/migrations",tree=commit=>text("ls-tree","-r","--name-only",commit,"--",folder).split("\n").filter(Boolean),all=tree(HONOREE_BASE),prior=tree(HONORS_BASE);
 need(equal(all,tree(expectedCommit))&&equal(all.filter(p=>!prior.includes(p)),[`${folder}/0023_honoree_links.sql`,`${folder}/meta/0023_snapshot.json`].sort())&&prior.every(p=>all.includes(p)));
 const blobs=new Map();for(const path of all){const bytes=git("show",`${HONOREE_BASE}:${path}`);need(bytes.equals(git("show",`${expectedCommit}:${path}`))&&bytes.equals(read(path)));if(prior.includes(path)&&!path.endsWith("/_journal.json"))need(bytes.equals(git("show",`${HONORS_BASE}:${path}`)));blobs.set(path,bytes);}
 for(const path of oldFiles)need(git("show",`${HONOREE_BASE}:${path}`).equals(git("show",`${expectedCommit}:${path}`))&&git("show",`${expectedCommit}:${path}`).equals(read(path)));
 for(const path of HONOREE_FILES)need(git("show",`${expectedCommit}:${path}`).equals(read(path)));
 const journal=JSON.parse(blobs.get(`${folder}/meta/_journal.json`)),oldJournal=JSON.parse(git("show",`${HONORS_BASE}:${folder}/meta/_journal.json`));
 need(journal.entries?.length===24&&equal({...journal,entries:journal.entries.slice(0,23)},oldJournal)&&journal.entries.every((r,i)=>r.idx===i&&r.version==="7"&&r.breakpoints===true&&Number.isSafeInteger(r.when)&&(!i||r.when>journal.entries[i-1].when))&&journal.entries[23].tag==="0023_honoree_links");
 const migrations=journal.entries.map((r,index)=>{const bytes=blobs.get(`${folder}/${r.tag}.sql`);need(bytes&&!bytes.includes(13));const lf=sha(bytes),crlf=sha(Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n")));return {index,tag:r.tag,createdAt:r.when,hash:lf,historicalAllowed:index<11||index===13?[...new Set([lf,crlf])]:[lf]};});
 const recheck=()=>{check();for(const[p,b]of blobs)need(b.equals(read(p)));for(const p of protectedFiles)need(git("show",`${expectedCommit}:${p}`).equals(read(p)));};
 return {expectedCommit,migrations,blobs,read,git,recheck,honorsSQL:blobs.get(`${folder}/0022_honors_version.sql`).toString("utf8"),honoreeSQL:blobs.get(`${folder}/0023_honoree_links.sql`).toString("utf8")};
}
/** Reference-capture seam validates committed source and all historical native
 * references, but cannot create a production-ready honoree reference itself. */
export function honoreeReferenceSource(expectedCommit,options={}){
 const source=honoreeSourceDelta(expectedCommit,options),{read,git,blobs,migrations}=source,folder="src/server/db/migrations",reference=JSON.parse(read("tests/fixtures/portal/release-migrate-reference.json"));
 const oldNames=git("ls-tree","-r","--name-only",RELEASE_BASE,"--",folder).toString("utf8").trim().split("\n");need(reference.version===1&&reference.sourceCommit===RELEASE_BASE&&reference.migrationsSHA256===sha(JSON.stringify(oldNames.map(path=>[path,sha(git("show",`${RELEASE_BASE}:${path}`))]))));
 source.reference=reference;source.historicalFunctions=historicalFunctionContract(reference,blobs.get(`${folder}/${migrations[2].tag}.sql`).toString("utf8"),migrations[2]);
 source.studentAfter=validateRosterReference(JSON.parse(read(ROSTER_REFERENCE)),reference,migrations[19].hash);source.recordingsAfter=validateRecordingsReference(JSON.parse(read(RECORDINGS_REFERENCE)),source);source.sourceAssignmentsAfter=validateSourceAssignmentsReference(JSON.parse(read(SOURCE_ASSIGNMENTS_REFERENCE)),source);source.honorsAfter=validateHonorsReference(JSON.parse(read(HONORS_REFERENCE)),source);honoreeSQLContract(source.honoreeSQL);return source;
}
export function validateHonoreeReference(bytes,source){
 need(typeof HONOREE_REFERENCE_SHA==="string"&&hashPattern.test(HONOREE_REFERENCE_SHA)&&typeof HONOREE_CATALOG_SHA==="string"&&hashPattern.test(HONOREE_CATALOG_SHA));need(sha(bytes)===HONOREE_REFERENCE_SHA);
 const reference=JSON.parse(bytes);closed(reference,["version","evidence","sourceCommit","migrationSHA256","before","after"]);need(reference.version===1&&reference.evidence==="owned-native-capture"&&reference.sourceCommit===HONOREE_BASE&&reference.migrationSHA256===source.migrations[23].hash);
 need(sha(JSON.stringify(canonical(reference.after)))===HONOREE_CATALOG_SHA);
 const previous=selectedHonorsReference(source,{prefix:source.migrations.slice(0,15).map(m=>({hash:m.hash}))},23);need(equal(referenceCatalog(reference.before),previous));
 return validateHonoreeDelta({before:reference.before,after:reference.after},source.honoreeSQL);
}
export function honoreeSourceContract(commit,options={}){const source=honoreeReferenceSource(commit,options);source.honoreeAfter=validateHonoreeReference(source.read(HONOREE_REFERENCE),source);return source;}
export function parseHonoreeTarget(value,source){const target=parseTarget(value,source);need(target.requireChannelBinding===true);return target;}
export function checkHonoreeLedger(rows,source,target){need(Array.isArray(rows)&&(rows.length===23||rows.length===24));const prefix=checkHonorsLedger(rows.slice(0,23),source,target);if(rows.length===23)return prefix;const row=rows[23],last={id:Number(row.id),hash:row.hash,createdAt:Number(row.created_at)},m=source.migrations[23];need(Number.isSafeInteger(last.id)&&last.id>prefix[22].id&&last.hash===m.hash&&last.createdAt===m.createdAt);return [...prefix,last];}
export function selectedHonoreeReference(source,target,length){need(length===23||length===24);const before=selectedHonorsReference(source,target,23);return length===23?before:{...source.honoreeAfter,functions:source.honoreeAfter.functions.map(fn=>before.functions.find(old=>old.name===fn.name&&old.arguments===fn.arguments)??fn)};}
