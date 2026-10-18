import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argumentsFor, need, same } from "./release-migrate-support.mjs";
import { honoreeSourceContract, parseHonoreeTarget, checkHonoreeLedger, selectedHonoreeReference } from "./release-migrate-honoree-support.mjs";
import { ReleaseClient, assertReleaseTransport, RELEASE_LOCK, verifyIdentity } from "./release-migrate.mjs";
import { captureCatalog, verifyCatalog, captureRoles, captureData } from "./release-migrate-catalog.mjs";

import { HONOREE_TABLES } from "./release-migrate-honoree-support.mjs";
// All old columns/data, including populated honors_version, stay in the proof.
export const captureHonoreeData=(client,names)=>captureData(client,names.filter(name=>!HONOREE_TABLES.includes(name)));
const digestQuery=selection=>`WITH bounded AS (${selection} LIMIT 100001), hashes AS
 (SELECT encode(sha256(convert_to(to_jsonb(bounded)::text,'UTF8')),'hex') value FROM bounded)
 SELECT count(*)::int count,encode(sha256(convert_to(COALESCE(string_agg(value,'' ORDER BY value),''),'UTF8')),'hex') digest FROM hashes`;
async function digestRows(client,selection){const row=(await client.query(digestQuery(selection))).rows[0];need(Number.isInteger(row?.count)&&row.count<=100000&&/^[a-f0-9]{64}$/.test(row.digest));return row;}
export async function captureHonoreeInitial(client,length){
 const expected={reading:await digestRows(client,"SELECT tenant_id,id AS student_id,0::bigint AS epoch FROM public.student"),group:await digestRows(client,`SELECT h.tenant_id,h.student_id,a->>'startVerse' AS start_verse,0::bigint AS epoch FROM public.honors_version h CROSS JOIN LATERAL jsonb_array_elements(h.form->'aliyot') a WHERE jsonb_array_length(a->'participants')>0 AND NOT EXISTS(SELECT 1 FROM public.honors_version newer WHERE newer.tenant_id=h.tenant_id AND newer.student_id=h.student_id AND newer.version>h.version)`)};
 if(length===23)return {expected,actual:null,empty:true,valid:true};
 const actual={reading:await digestRows(client,"SELECT tenant_id,student_id,epoch FROM public.honoree_reading_epoch"),group:await digestRows(client,"SELECT tenant_id,student_id,start_verse,epoch FROM public.honoree_group_epoch")};
 const empty=(await client.query("SELECT NOT EXISTS(SELECT 1 FROM public.honoree_link) AND NOT EXISTS(SELECT 1 FROM public.honoree_operation) AND NOT EXISTS(SELECT 1 FROM public.honoree_material_release) AS clear")).rows[0]?.clear===true;
 return {expected,actual,empty,valid:empty&&same(actual,expected)};
}
export async function honoreeSnapshot(client,source,target,checks={identity:verifyIdentity,catalog:captureCatalog,verifyCatalog,roles:captureRoles,data:captureHonoreeData,initial:captureHonoreeInitial},observedApplied=()=>{}){
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await checks.identity(client,target);
    const ledger=checkHonoreeLedger((await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows,source,target);
    const catalog=await checks.catalog(client,target.expected.owner);
    checks.verifyCatalog(catalog,selectedHonoreeReference(source,target,ledger.length));
    if(ledger.length===24)observedApplied();
    const roles=await checks.roles(client),data=await checks.data(client,catalog.tables.map(table=>table.name)),initial=await checks.initial(client,ledger.length);
    await client.query("ROLLBACK");return {ledger,catalog,roles,data,initial};
  }catch{await client.query("ROLLBACK").catch(()=>undefined);throw new Error("Honoree release snapshot failed");}
}

/** Explicit0023-only operator. MODEL ONLY reference blocks the real CLI until root installation. */
export async function executeHonoreeRelease(source,target,options={}){
  const apply=options.apply===true;
  const checks={transport:assertReleaseTransport,identity:verifyIdentity,catalog:captureCatalog,verifyCatalog,roles:captureRoles,data:captureHonoreeData,initial:captureHonoreeInitial,...options.checks};
  let client,connected=false,locked=false,timer,expired=false,connectionFailed=false,phase="connection",outcome="not-started",result,migrationAttempted=false;
  const onError=()=>{connectionFailed=true;},healthy=()=>need(!expired && !connectionFailed);
  try{
    source.recheck();client=await(options.connect??(()=>new ReleaseClient(target)))(target.connection);
    client.on("error",onError);
    timer=setTimeout(()=>{expired=true;void client.end().catch(()=>undefined);},90000);timer.unref?.();
    await client.connect();connected=true;healthy();checks.transport(client,target);
    await client.query("SET statement_timeout='12s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='15s'");
    phase="lock";need((await client.query("SELECT pg_catalog.pg_try_advisory_lock($1,$2) AS locked",RELEASE_LOCK)).rows[0]?.locked===true);locked=true;
    phase="preflight";const observedApplied=()=>{if(!migrationAttempted){phase="verification";outcome="observed-applied-initial-state-unverified";}};
    const before=await honoreeSnapshot(client,source,target,checks,observedApplied);healthy();source.recheck();
    if(before.ledger.length===24){need(before.initial.valid===true);outcome="already-applied";result={ok:true,phase:"complete",outcome,apply,ledgerRows:24};}
    else if(!apply){outcome="checked";result={ok:true,phase:"complete",outcome,apply,ledgerRows:23};}
    else{
      phase="recheck";const current=await honoreeSnapshot(client,source,target,checks);healthy();need(same(current,before));source.recheck();
      phase="migration";const migrate=options.migrate??(await import("./db-migrate.mjs")).migrateDatabase;
      healthy();migrationAttempted=true;outcome="unknown";await migrate(client);outcome="committed-verification-conflict";
      phase="verification";healthy();source.recheck();const after=await honoreeSnapshot(client,source,target,checks);
      need(after.ledger.length===24 && same(after.ledger.slice(0,23),before.ledger) && same(after.roles,before.roles) && same(after.data,before.data) && after.initial.valid===true && same(after.initial.expected,before.initial.expected));
      healthy();source.recheck();outcome="applied";result={ok:true,phase:"complete",outcome,apply,ledgerRows:24};
    }
  }catch{result={ok:false,phase,outcome,apply};}
  finally{
    clearTimeout(timer);let cleaned=true;
    if(connected && locked){try{need((await client.query("SELECT pg_catalog.pg_advisory_unlock($1,$2) AS unlocked",RELEASE_LOCK)).rows[0]?.unlocked===true);}catch{cleaned=false;}}
    if(client){try{await client.end();}catch{cleaned=false;}client.removeListener("error",onError);}
    if(connectionFailed)cleaned=false;
    if(!cleaned)result={ok:false,phase:"cleanup",outcome,apply};
  }
  return Object.freeze(result);
}
export async function runHonoreeRelease(args,dependencies={}){
  let phase="arguments",apply=false;
  try{
    const input=argumentsFor(args);apply=input.apply;phase="source";
    const source=await(dependencies.source??honoreeSourceContract)(input.expectedCommit);phase="target";
    const read=dependencies.readTarget??(path=>{need(statSync(path).isFile() && statSync(path).size<=16384);return JSON.parse(readFileSync(path,"utf8"));});
    const target=parseHonoreeTarget(await read(input.targetPath),source);
    return await executeHonoreeRelease(source,target,{...dependencies.execution,apply});
  }catch{return Object.freeze({ok:false,phase,outcome:"not-started",apply});}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runHonoreeRelease(process.argv.slice(2));process.stdout.write(`${JSON.stringify(result)}\n`);process.exitCode=result.ok?0:1;
}
