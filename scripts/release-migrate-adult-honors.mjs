import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argumentsFor, need, same } from "./release-migrate-support.mjs";
import { ADULT_HONORS_TABLES, adultHonorsSourceContract, parseAdultHonorsTarget, checkAdultHonorsLedger, selectedAdultHonorsReference } from "./release-migrate-adult-honors-support.mjs";
import { ReleaseClient, assertReleaseTransport, RELEASE_LOCK, verifyIdentity } from "./release-migrate.mjs";
import { captureCatalog, verifyCatalog, captureRoles, captureData } from "./release-migrate-catalog.mjs";

const ident=value=>{need(typeof value==="string"&&/^[a-z_][a-z0-9_]*$/.test(value));return `"${value}"`;};
/** Every old public table, and every old column on all three altered tables.
 * Only bounded aggregate counts and hashes leave PostgreSQL; never row bodies. */
export async function captureAdultHonorsData(client,names,source){
 need(Array.isArray(names)&&names.length<=128&&new Set(names).size===names.length);
 const changed=ADULT_HONORS_TABLES,ordinary=await captureData(client,names.filter(name=>!changed.includes(name))),rows=[...ordinary];
 for(const name of changed){
  need(names.includes(name));const old=source.adultHonorsBefore?.tables.find(t=>t.name===name);need(old&&old.columns.length>0&&old.columns.length<=64&&!old.columns.some(c=>c.name==="student_identity_id"));
  const columns=old.columns.map(c=>ident(c.name)).join(","),result=(await client.query(`WITH bounded AS (SELECT ${columns} FROM public.${ident(name)} LIMIT 100001), hashes AS
   (SELECT encode(sha256(convert_to(to_jsonb(bounded)::text,'UTF8')),'hex') value FROM bounded)
   SELECT count(*)::int count,encode(sha256(convert_to(COALESCE(string_agg(value,'' ORDER BY value),''),'UTF8')),'hex') digest FROM hashes`)).rows[0];
  need(Number.isInteger(result?.count)&&result.count<=100000&&/^[a-f0-9]{64}$/.test(result.digest));rows.push({name,...result});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name,"en"));
}
export async function captureAdultHonorsNullTransition(client){
 const sql=ADULT_HONORS_TABLES.map(name=>`NOT EXISTS(SELECT 1 FROM public.${ident(name)} WHERE student_identity_id IS NOT NULL)`).join(" AND ");return(await client.query(`SELECT ${sql} AS clear`)).rows[0]?.clear===true;
}
export async function adultHonorsSnapshot(client,source,target,checks,observedApplied=()=>{},verifyNullTransition=false){
 await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
 try{
  await client.query("SET LOCAL search_path=pg_catalog,public");await checks.identity(client,target);
  const ledger=checkAdultHonorsLedger((await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows,source,target);
  if(ledger.length===25)observedApplied();
  const catalog=await checks.catalog(client,target.expected.owner);checks.verifyCatalog(catalog,selectedAdultHonorsReference(source,target,ledger.length));
  const roles=await checks.roles(client),data=await checks.data(client,catalog.tables.map(t=>t.name),source);
  const nullTransition=verifyNullTransition?await checks.nullTransition(client):null;
  await client.query("ROLLBACK");return{ledger,catalog,roles,data,nullTransition};
 }catch{await client.query("ROLLBACK").catch(()=>undefined);throw Error("Adult honors release snapshot failed");}
}
/** Dedicated0023→0024 operation. Already-applied certifies the present ledger
 * and catalog only; it cannot reproduce the original preservation transition. */
export async function executeAdultHonorsRelease(source,target,options={}){
 const apply=options.apply===true,checks={transport:assertReleaseTransport,identity:verifyIdentity,catalog:captureCatalog,verifyCatalog,roles:captureRoles,data:captureAdultHonorsData,nullTransition:captureAdultHonorsNullTransition,...options.checks};
 let client,connected=false,locked=false,timer,expired=false,connectionFailed=false,phase="connection",outcome="not-started",result,migrationAttempted=false;
 const onError=()=>{connectionFailed=true;},healthy=()=>need(!expired&&!connectionFailed);
 try{
  source.recheck();client=await(options.connect??(()=>new ReleaseClient(target)))(target.connection);client.on("error",onError);
  timer=setTimeout(()=>{expired=true;void client.end().catch(()=>undefined);},90000);timer.unref?.();
  await client.connect();connected=true;healthy();checks.transport(client,target);
  await client.query("SET statement_timeout='12s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='15s'");
  phase="lock";need((await client.query("SELECT pg_catalog.pg_try_advisory_lock($1,$2) AS locked",RELEASE_LOCK)).rows[0]?.locked===true);locked=true;
  phase="preflight";const observedApplied=()=>{if(!migrationAttempted){phase="verification";outcome="observed-applied-current-state-unverified";}};
  const before=await adultHonorsSnapshot(client,source,target,checks,observedApplied);healthy();source.recheck();
  if(before.ledger.length===25){outcome="already-applied-current-state-verified";result={ok:true,phase:"complete",outcome,apply,ledgerRows:25};}
  else if(!apply){outcome="checked";result={ok:true,phase:"complete",outcome,apply,ledgerRows:24};}
  else{
   phase="recheck";const current=await adultHonorsSnapshot(client,source,target,checks);healthy();need(same(current,before));source.recheck();
   phase="migration";const migrate=options.migrate??(await import("./db-migrate.mjs")).migrateDatabase;
   healthy();migrationAttempted=true;outcome="unknown";await migrate(client);outcome="committed-verification-conflict";
   phase="verification";healthy();source.recheck();const after=await adultHonorsSnapshot(client,source,target,checks,()=>{},true);
   need(after.ledger.length===25&&same(after.ledger.slice(0,24),before.ledger)&&same(after.roles,before.roles)&&same(after.data,before.data)&&after.nullTransition===true);
   healthy();source.recheck();outcome="applied";result={ok:true,phase:"complete",outcome,apply,ledgerRows:25};
  }
 }catch{result={ok:false,phase,outcome,apply};}
 finally{
  clearTimeout(timer);let cleaned=true;
  if(connected&&locked){try{need((await client.query("SELECT pg_catalog.pg_advisory_unlock($1,$2) AS unlocked",RELEASE_LOCK)).rows[0]?.unlocked===true);}catch{cleaned=false;}}
  if(client){try{await client.end();}catch{cleaned=false;}client.removeListener("error",onError);}if(connectionFailed)cleaned=false;
  if(!cleaned)result={ok:false,phase:"cleanup",outcome,apply};
 }
 return Object.freeze(result);
}
export async function runAdultHonorsRelease(args,dependencies={}){
 let phase="arguments",apply=false;
 try{
  const input=argumentsFor(args);apply=input.apply;phase="source";
  const source=await(dependencies.source??adultHonorsSourceContract)(input.expectedCommit);phase="target";
  const read=dependencies.readTarget??(path=>{need(statSync(path).isFile()&&statSync(path).size<=16384);return JSON.parse(readFileSync(path,"utf8"));});
  const target=parseAdultHonorsTarget(await read(input.targetPath),source);return await executeAdultHonorsRelease(source,target,{...dependencies.execution,apply});
 }catch{return Object.freeze({ok:false,phase,outcome:"not-started",apply});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await runAdultHonorsRelease(process.argv.slice(2));process.stdout.write(`${JSON.stringify(result)}\n`);process.exitCode=result.ok?0:1;
}
