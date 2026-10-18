import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argumentsFor, need, same } from "./release-migrate-support.mjs";
import { honorsSourceContract, parseHonorsTarget, checkHonorsLedger, selectedHonorsReference } from "./release-migrate-honors-support.mjs";
import { ReleaseClient, assertReleaseTransport, RELEASE_LOCK, verifyIdentity } from "./release-migrate.mjs";
import { captureCatalog, verifyCatalog, captureRoles, captureData } from "./release-migrate-catalog.mjs";

// Every existing table/column, including populated verse_source_assignment, participates.
// Only the newly created honors_version is excluded, and is proved empty.
export const captureHonorsData=(client,names)=>captureData(client,names.filter(name=>name!=="honors_version"));
export async function honorsSnapshot(client,source,target,checks={identity:verifyIdentity,catalog:captureCatalog,verifyCatalog,roles:captureRoles,data:captureHonorsData}){
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try{
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await checks.identity(client,target);
    const ledger=checkHonorsLedger((await client.query("SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows,source,target);
    const catalog=await checks.catalog(client,target.expected.owner);
    checks.verifyCatalog(catalog,selectedHonorsReference(source,target,ledger.length));
    const roles=await checks.roles(client),data=await checks.data(client,catalog.tables.map(table=>table.name));
    if(ledger.length===23)need((await client.query("SELECT NOT EXISTS(SELECT 1 FROM public.honors_version) AS clear")).rows[0]?.clear===true);
    await client.query("ROLLBACK");return {ledger,catalog,roles,data};
  }catch{await client.query("ROLLBACK").catch(()=>undefined);throw new Error("Honors release snapshot failed");}
}

/** Explicit 0022-only operator; every previous release operator is unchanged. */
export async function executeHonorsRelease(source,target,options={}){
  const apply=options.apply===true;
  const checks={transport:assertReleaseTransport,identity:verifyIdentity,catalog:captureCatalog,verifyCatalog,roles:captureRoles,data:captureHonorsData,...options.checks};
  let client,connected=false,locked=false,timer,expired=false,connectionFailed=false,phase="connection",outcome="not-started",result;
  const onError=()=>{connectionFailed=true;},healthy=()=>need(!expired && !connectionFailed);
  try{
    source.recheck();client=await(options.connect??(()=>new ReleaseClient(target)))(target.connection);
    client.on("error",onError);
    timer=setTimeout(()=>{expired=true;void client.end().catch(()=>undefined);},90000);timer.unref?.();
    await client.connect();connected=true;healthy();checks.transport(client,target);
    await client.query("SET statement_timeout='12s'; SET lock_timeout='5s'; SET idle_in_transaction_session_timeout='15s'");
    phase="lock";need((await client.query("SELECT pg_catalog.pg_try_advisory_lock($1,$2) AS locked",RELEASE_LOCK)).rows[0]?.locked===true);locked=true;
    phase="preflight";const before=await honorsSnapshot(client,source,target,checks);healthy();source.recheck();
    if(before.ledger.length===23){outcome="already-applied";result={ok:true,phase:"complete",outcome,apply,ledgerRows:23};}
    else if(!apply){outcome="checked";result={ok:true,phase:"complete",outcome,apply,ledgerRows:22};}
    else{
      phase="recheck";const current=await honorsSnapshot(client,source,target,checks);healthy();need(same(current,before));source.recheck();
      phase="migration";const migrate=options.migrate??(await import("./db-migrate.mjs")).migrateDatabase;
      healthy();outcome="unknown";await migrate(client);outcome="committed-verification-conflict";
      phase="verification";healthy();source.recheck();const after=await honorsSnapshot(client,source,target,checks);
      need(after.ledger.length===23 && same(after.ledger.slice(0,22),before.ledger) && same(after.roles,before.roles) && same(after.data,before.data));
      healthy();source.recheck();outcome="applied";result={ok:true,phase:"complete",outcome,apply,ledgerRows:23};
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
export async function runHonorsRelease(args,dependencies={}){
  let phase="arguments",apply=false;
  try{
    const input=argumentsFor(args);apply=input.apply;phase="source";
    const source=await(dependencies.source??honorsSourceContract)(input.expectedCommit);phase="target";
    const read=dependencies.readTarget??(path=>{need(statSync(path).isFile() && statSync(path).size<=16384);return JSON.parse(readFileSync(path,"utf8"));});
    const target=parseHonorsTarget(await read(input.targetPath),source);
    return await executeHonorsRelease(source,target,{...dependencies.execution,apply});
  }catch{return Object.freeze({ok:false,phase,outcome:"not-started",apply});}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await runHonorsRelease(process.argv.slice(2));process.stdout.write(`${JSON.stringify(result)}\n`);process.exitCode=result.ok?0:1;
}
