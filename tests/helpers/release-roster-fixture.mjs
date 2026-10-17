import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile,writeFile,mkdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { isolatedEnv } from "./isolatedEnv.mjs";
import { disposableConfig,query } from "../postgres/disposable.mjs";
import { RELEASE_BASE,sha,need,parseTarget,historicalFunctionContract } from "../../scripts/release-migrate-support.mjs";
import { ROSTER_BASE,validateRosterReference } from "../../scripts/release-migrate-roster-support.mjs";
import { executeRosterRelease } from "../../scripts/release-migrate-roster.mjs";

export async function rosterReleaseFixture(options={}){
  const config=disposableConfig(),isolation=await isolatedEnv(),suffix=randomBytes(8).toString("hex"),database=`roster_release_${suffix}`,ownerRole=`roster_owner_${suffix}`,runtimeRole=`roster_runtime_${suffix}`,password=randomBytes(32).toString("hex");
  const anchor=new pg.Client(config);let owner,createdDb=false,createdOwner=false,createdRuntime=false;
  async function close(){
    await owner?.end().catch(()=>undefined);
    try{if(createdDb)await query(anchor,`DROP DATABASE "${database}"`);}
    finally{try{if(createdRuntime)await query(anchor,`DROP ROLE "${runtimeRole}"`);}finally{try{if(createdOwner)await query(anchor,`DROP ROLE "${ownerRole}"`);}finally{try{await anchor.end();}finally{await isolation.cleanup();}}}}
  }
  try{
    await anchor.connect();
    if(!(await query(anchor,"SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='portal_runtime') AS found")).rows[0].found){
      try{await query(anchor,"CREATE ROLE portal_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");}catch(error){if(error.code!=="42710")throw error;}
    }
    const group=(await query(anchor,"SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='portal_runtime'")).rows;
    need(group.length===1 && Object.values(group[0]).every(value=>value===false));
    await query(anchor,`CREATE ROLE "${ownerRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD '${password}'`);createdOwner=true;
    await query(anchor,`CREATE ROLE "${runtimeRole}" LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);createdRuntime=true;
    await query(anchor,`GRANT portal_runtime TO "${runtimeRole}"`);
    await query(anchor,`CREATE DATABASE "${database}" OWNER "${ownerRole}"`);createdDb=true;
    const connection={...config,database,user:ownerRole,password};owner=new pg.Client(connection);await owner.connect();
    const folder=join(isolation.home,"migrations");await mkdir(join(folder,"meta"),{recursive:true});
    const git=(...args)=>execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024});
    const base="src/server/db/migrations",journal=JSON.parse(git("show",`${ROSTER_BASE}:${base}/meta/_journal.json`));
    const migrations=[];
    for(const[index,row]of journal.entries.entries()){
      const bytes=git("show",`${ROSTER_BASE}:${base}/${row.tag}.sql`),crlf=Buffer.from(bytes.toString("utf8").replace(/\n/g,"\r\n"));
      await writeFile(join(folder,row.tag+".sql"),options.crlfHistory && index===2?crlf:bytes);
      migrations.push({index,tag:row.tag,hash:sha(bytes),createdAt:row.when,historicalAllowed:index<11 || index===13?[...new Set([sha(bytes),sha(crlf)])]:[sha(bytes)]});
    }
    await writeFile(join(folder,"meta/_journal.json"),JSON.stringify({...journal,entries:journal.entries.slice(0,19)}));
    await migrate(drizzle(owner,{logger:false}),{migrationsFolder:folder});
    await query(owner,"INSERT INTO public.student(tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES('crc','Synthetic','Roster release','2027-01-02','parent@example.test')");
    const reference=JSON.parse(await readFile(new URL("../fixtures/portal/release-migrate-reference.json",import.meta.url),"utf8"));
    const security=git("show",`${RELEASE_BASE}:${base}/0002_tenant_security.sql`).toString("utf8");
    const source={migrations,reference,historicalFunctions:historicalFunctionContract(reference,security,migrations[2]),recheck(){}};
    if(!options.generate){const extra=JSON.parse(await readFile(new URL("../fixtures/portal/release-roster-reference.json",import.meta.url),"utf8"));source.studentAfter=validateRosterReference(extra,reference,migrations[19].hash);}
    const prefix=(await query(owner,"SELECT id,hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id LIMIT 15")).rows.map(row=>({id:row.id,hash:row.hash,createdAt:Number(row.created_at)}));
    const identity=(await query(owner,"SELECT oid::text AS oid FROM pg_roles WHERE rolname=current_user")).rows[0];
    const major=Math.floor(Number((await query(owner,"SHOW server_version_num")).rows[0].server_version_num)/10000);
    const url=new URL("postgresql://ep-synthetic.neon.tech");url.username=ownerRole;url.password=password;url.pathname=`/${database}`;url.searchParams.set("sslmode","require");
    const parsed=parseTarget({version:1,migrationUrl:url.href,expected:{hostname:url.hostname,database,owner:ownerRole,ownerOid:identity.oid,runtimeRole,serverMajor:18,tenantId:"crc",canonicalOrigin:"https://beitmitzvah.centralreform.org"},historicalPrefix:prefix,provenance:{sourceCommit:RELEASE_BASE,method:"owner-readonly",observedAt:"2026-10-17T00:00:00.000Z"}},source);
    const target={...parsed,expected:{...parsed.expected,serverMajor:major},connection:{...parsed.connection,host:config.host,port:config.port,ssl:false}};
    await writeFile(join(folder,"meta/_journal.json"),JSON.stringify(journal));
    const operation=client=>migrate(drizzle(client,{logger:false}),{migrationsFolder:folder});
    const run=(apply=false,custom)=>executeRosterRelease(source,target,{apply,connect:()=>new pg.Client(target.connection),checks:{transport(){}},migrate:custom??operation});
    return {owner,connection,source,target,folder,run,operation,close};
  }catch{await close().catch(()=>undefined);throw new Error("Roster release disposable fixture failed; details withheld");}
}
