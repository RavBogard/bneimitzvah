import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sourceAssignmentsReleaseFixture } from "./release-source-assignments-fixture.mjs";
import { seedLegacyAdultUpgrade } from "./adult-honors-upgrade.mjs";
import { adultHonorsReferenceSource, adultHonorsSourceContract } from "../../scripts/release-migrate-adult-honors-support.mjs";
import { executeAdultHonorsRelease } from "../../scripts/release-migrate-adult-honors.mjs";
import { need, sha } from "../../scripts/release-migrate-support.mjs";

async function fixture(options,forReference){
 // Guard committed source and historical references before ANY disposable
 // configuration, connection, role/database creation or native side effect.
 const commit=options.expectedCommit??process.env.ADULT_HONORS_RELEASE_EXPECTED_COMMIT;
 const checked=(forReference?adultHonorsReferenceSource:adultHonorsSourceContract)(commit);
 const f=await sourceAssignmentsReleaseFixture(options);
 try{
  await f.operation(f.owner); // Exact0021 prefix, ledger22.
  const folder="src/server/db/migrations",full=checked.blobs.get(folder+"/meta/_journal.json"),journal=JSON.parse(full);
  for(const index of [22,23]){
   const row=checked.migrations[index];await writeFile(join(f.folder,row.tag+".sql"),checked.blobs.get(folder+"/"+row.tag+".sql"),{flag:"wx"});
   await writeFile(join(f.folder,"meta/_journal.json"),JSON.stringify({...journal,entries:journal.entries.slice(0,index+1)}));await f.operation(f.owner);
  }
  const seeded=await seedLegacyAdultUpgrade(f.owner);
  const next=checked.migrations[24];need(next.tag==="0024_adult_self_honors");const path=join(f.folder,next.tag+".sql");
  await writeFile(path,checked.blobs.get(folder+"/"+next.tag+".sql"),{flag:"wx"});await writeFile(join(f.folder,"meta/_journal.json"),full);
  const source={...checked,recheck(){checked.recheck();need(sha(readFileSync(path))===next.hash&&readFileSync(join(f.folder,"meta/_journal.json")).equals(full));}};
  const run=(apply=false,migrate=f.operation,checks={})=>executeAdultHonorsRelease(source,f.target,{apply,connect:()=>new pg.Client(f.target.connection),checks:{transport(){},...checks},migrate});
  return{...f,source,path,...seeded,run:forReference?undefined:run};
 }catch{await f.close().catch(()=>undefined);throw Error("Adult honors disposable release fixture failed; details withheld");}
}
export const adultHonorsReleaseFixture=(options={})=>fixture(options,false);
/** Root only: returns actual populated ledger24, no installed evidence and no
 * model-as-native label. Root captures catalog before/after f.operation(owner),
 * verifies bounded data/roles/null transition, saves private provenance, closes. */
export const adultHonorsReleaseReferenceFixture=(options={})=>fixture(options,true);
