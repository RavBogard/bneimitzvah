import { execFileSync } from "node:child_process";
import { readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isolatedEnv } from "./isolatedEnv.mjs";
import { rosterReleaseFixture } from "./release-roster-fixture.mjs";
import { query } from "../postgres/disposable.mjs";
import { sha } from "../../scripts/release-migrate-support.mjs";
import { RECORDINGS_BASE,RECORDINGS_REFERENCE,validateRecordingsReference } from "../../scripts/release-migrate-recordings-support.mjs";
import { executeRecordingsRelease } from "../../scripts/release-migrate-recordings.mjs";

export async function recordingsReleaseFixture(options={}){
  const f=await rosterReleaseFixture(options),isolation=await isolatedEnv();
  try{
    await f.operation(f.owner);
    // Already deployed 0019 fields may contain real data: no NULL assumption.
    const metadata={version:1,parent1Name:"Synthetic guardian",householdPhone:null,parent2Name:null,parashahLabel:"Synthetic label",tutorName:null,tutorMatch:null,adminNotes:"Synthetic notes"};
    await query(f.owner,"UPDATE public.student SET hebrew_name='Synthetic Hebrew',second_parent_email='second@example.test',import_metadata=$1",[metadata]);
    const git=(...args)=>execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024});
    const base="src/server/db/migrations",journal=JSON.parse(git("show",`${RECORDINGS_BASE}:${base}/meta/_journal.json`));
    const row=journal.entries[20],bytes=git("show",`${RECORDINGS_BASE}:${base}/${row.tag}.sql`);
    await writeFile(join(f.folder,row.tag+".sql"),bytes);
    await writeFile(join(f.folder,"meta/_journal.json"),JSON.stringify(journal));
    const source={...f.source,migrations:[...f.source.migrations,{index:20,tag:row.tag,hash:sha(bytes),createdAt:row.when,historicalAllowed:[sha(bytes)]}]};
    if(!options.generate){const extra=JSON.parse(await readFile(new URL("../../"+RECORDINGS_REFERENCE,import.meta.url),"utf8"));source.recordingsAfter=validateRecordingsReference(extra,source);}
    const run=(apply=false,custom,checks={})=>executeRecordingsRelease(source,f.target,{apply,connect:()=>new pg.Client(f.target.connection),checks:{transport(){},...checks},migrate:custom??f.operation});
    const close=async()=>{try{await f.close();}finally{await isolation.cleanup();}};
    return {...f,source,run,close};
  }catch{await f.close().catch(()=>undefined);await isolation.cleanup();throw new Error("Recording release disposable fixture failed; details withheld");}
}
