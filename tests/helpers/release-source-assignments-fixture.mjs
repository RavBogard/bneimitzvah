import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { isolatedEnv } from "./isolatedEnv.mjs";
import { recordingsReleaseFixture } from "./release-recordings-fixture.mjs";
import { sha, need } from "../../scripts/release-migrate-support.mjs";
import { SOURCE_ASSIGNMENTS_BASE, SOURCE_ASSIGNMENTS_REFERENCE, validateSourceAssignmentsReference } from "../../scripts/release-migrate-source-assignments-support.mjs";
import { executeSourceAssignmentsRelease } from "../../scripts/release-migrate-source-assignments.mjs";

/** Only the existing guarded disposable loopback fixture may inject transport. */
export async function sourceAssignmentsReleaseFixture(options={}){
  const f=await recordingsReleaseFixture(options),isolation=await isolatedEnv();
  try{
    await f.operation(f.owner); // Establish exact historical 21-row baseline.
    const git=(...args)=>execFileSync("git",args,{env:isolation.env,windowsHide:true,maxBuffer:16*1024*1024});
    const base="src/server/db/migrations",journal=JSON.parse(git("show",`${SOURCE_ASSIGNMENTS_BASE}:${base}/meta/_journal.json`)),row=journal.entries[21];
    need(journal.entries.length===22 && row.tag==="0021_verse_source_assignments");
    const bytes=git("show",`${SOURCE_ASSIGNMENTS_BASE}:${base}/${row.tag}.sql`);need(!bytes.includes(13));
    await writeFile(join(f.folder,row.tag+".sql"),bytes);await writeFile(join(f.folder,"meta/_journal.json"),JSON.stringify(journal));
    const migration={index:21,tag:row.tag,hash:sha(bytes),createdAt:row.when,historicalAllowed:[sha(bytes)]};
    const source={...f.source,migrations:[...f.source.migrations,migration]};
    source.sourceAssignmentsAfter=validateSourceAssignmentsReference(JSON.parse(await readFile(new URL("../../"+SOURCE_ASSIGNMENTS_REFERENCE,import.meta.url),"utf8")),source);
    const run=(apply=false,custom,checks={})=>executeSourceAssignmentsRelease(source,f.target,{apply,connect:()=>new pg.Client(f.target.connection),checks:{transport(){},...checks},migrate:custom??f.operation});
    const close=async()=>{try{await f.close();}finally{await isolation.cleanup();}};
    return {...f,source,run,close};
  }catch{await f.close().catch(()=>undefined);await isolation.cleanup();throw new Error("Source assignments release disposable fixture failed; details withheld");}
}
