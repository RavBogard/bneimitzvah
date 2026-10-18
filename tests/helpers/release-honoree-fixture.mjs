import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sourceAssignmentsReleaseFixture } from "./release-source-assignments-fixture.mjs";
import { honoreeSourceContract, honoreeReferenceSource } from "../../scripts/release-migrate-honoree-support.mjs";
import { executeHonoreeRelease } from "../../scripts/release-migrate-honoree.mjs";
import { need, sha } from "../../scripts/release-migrate-support.mjs";

async function createFixture(options,forReference){
 // Always before disposableConfig/connection/database/role creation. No model
 // bypass exists in the release CLI; reference preparation is fixture-only.
 const expectedCommit=options.expectedCommit??process.env.HONOREE_RELEASE_EXPECTED_COMMIT;
 const checked=(forReference?honoreeReferenceSource:honoreeSourceContract)(expectedCommit);
 const f=await sourceAssignmentsReleaseFixture(options);
 try{
  await f.operation(f.owner); // Exact immutable0021 -> ledger22.
  const folder="src/server/db/migrations",full=checked.blobs.get(folder+"/meta/_journal.json"),journal=JSON.parse(full),honors=checked.migrations[22],next=checked.migrations[23];
  need(journal.entries.length===24&&honors.tag==="0022_honors_version"&&next.tag==="0023_honoree_links");
  await writeFile(join(f.folder,honors.tag+".sql"),checked.blobs.get(folder+"/"+honors.tag+".sql"),{flag:"wx"});
  await writeFile(join(f.folder,"meta/_journal.json"),JSON.stringify({...journal,entries:journal.entries.slice(0,23)}));await f.operation(f.owner);
  const student=(await f.owner.query("SELECT id FROM public.student WHERE tenant_id='crc'")).rows;need(student.length===1);
  const studentId=student[0].id,user="synthetic-honoree-release-"+randomUUID();
  await f.owner.query('INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',[user,"Synthetic Release",user+"@example.test"]);
  const member=(await f.owner.query("INSERT INTO public.membership(tenant_id,user_id) VALUES('crc',$1) RETURNING id",[user])).rows[0].id;
  const grant=(await f.owner.query("INSERT INTO public.role_grant(tenant_id,membership_id,role) VALUES('crc',$1,'admin') RETURNING id",[member])).rows[0].id;
  const assignment=(await f.owner.query("INSERT INTO public.assignment(tenant_id,student_id,kind,basis,ref,status,set_by_membership_id) VALUES('crc',$1,'torah','custom','Genesis 1:1-3','confirmed',$2) RETURNING id",[studentId,member])).rows[0].id;
  await f.owner.query("INSERT INTO public.assignment_verse(tenant_id,assignment_id,student_id,ordinal,verse_ref) SELECT 'crc',$1,$2,n,'Genesis 1:'||n FROM generate_series(1,3)n",[assignment,studentId]);
  const context={schemaVersion:1,tenantId:"crc",studentId,ceremonyDate:"2027-01-02",serviceSlot:"morning",torah:{id:assignment,revision:1,ref:"Genesis 1:1-3",basis:"custom",confirmation:{confirmationDate:"2027-01-02",serviceSlot:"morning",slotProvenance:1,needsReview:false},verses:["Genesis 1:1","Genesis 1:2","Genesis 1:3"],cuts:["Genesis 1:2","Genesis 1:3"]}};
  const empty=()=>({schemaVersion:1,openingArk:[],generationToGeneration:[],undressingTorah:[],redressingTorah:[],closingArk:[],aliyot:[],parentalBlessing:{participation:null,delivery:null}});
  const group=(startVerse,nonempty=true)=>({startVerse,participants:nonempty?[{id:randomUUID(),englishName:"Synthetic Release Person",hebrewName:null,parent1HebrewName:null,parent2HebrewName:null,relationship:null}]:[]});
  const append=async(id,version,form,reviewed,assignmentId)=>f.owner.query("INSERT INTO public.honors_version(tenant_id,student_id,assignment_id,version,base_version,previous_version,form,reviewed_context,context_hash,actor_user_id,actor_membership_id,role_grant_id,role,mode,mutation_id,request_digest) VALUES('crc',$1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,'admin','admin',$12,$13)",[id,assignmentId,version,version-1,version===1?null:version-1,JSON.stringify(form),JSON.stringify(reviewed),sha(JSON.stringify(reviewed)),user,member,grant,randomUUID(),sha("synthetic-honoree-fixture-"+randomUUID())]);
  await append(studentId,1,{...empty(),aliyot:[group("Genesis 1:1"),group("Genesis 1:2")]},context,assignment);
  await append(studentId,2,{...empty(),aliyot:[group("Genesis 1:2"),group("Genesis 1:3",false)]},context,assignment);
  const extra=(await f.owner.query("INSERT INTO public.student(tenant_id,first_name,last_name,ceremony_date,parent_email,disabled_at) VALUES('crc','Synthetic','Disabled unassigned','2027-01-02','disabled@example.test',now()),('crc','Synthetic','Empty honors','2027-01-02','empty@example.test',NULL) RETURNING id")).rows;
  await append(extra[1].id,1,empty(),{...context,studentId:extra[1].id,torah:null},null);
  const citations=[{id:"synthetic_reference",ref:"Invented Work 1",indexTitle:"Invented Work",category:"Commentary",labels:{en:null,he:null}}];
  await f.owner.query("INSERT INTO public.verse_source_assignment(tenant_id,student_id,assignment_id,assignment_revision,verse_ref,version,base_version,citations,actor_user_id,actor_membership_id,role_grant_id,role,mode,mutation_id,request_digest) VALUES('crc',$1,$2,1,'Genesis 1:1',1,0,$3::jsonb,$4,$5,$6,'admin','admin',$7,$8)",[studentId,assignment,JSON.stringify(citations),user,member,grant,randomUUID(),sha("synthetic-honoree-source")]);
  await f.owner.query("INSERT INTO public.student_recording(id,tenant_id,student_id,asset_id,content_sha256,media_type,byte_length,duration_ms,state,revision,created_at) VALUES($1,'crc',$2,$3,$4,'audio/webm;codecs=opus',1,1,'private',1,now())",[randomUUID(),studentId,randomUUID(),sha("synthetic-metadata-only-no-recording-body")]);
  const path=join(f.folder,next.tag+".sql");await writeFile(path,checked.blobs.get(folder+"/"+next.tag+".sql"),{flag:"wx"});await writeFile(join(f.folder,"meta/_journal.json"),full);
  const source={...checked,recheck(){checked.recheck();need(sha(readFileSync(path))===next.hash&&readFileSync(join(f.folder,"meta/_journal.json")).equals(full));}};
  const run=(apply=false,migrate=f.operation,checks={})=>executeHonoreeRelease(source,f.target,{apply,connect:()=>new pg.Client(f.target.connection),checks:{transport(){},...checks},migrate});
  // Parent loopback fixture substitutes PG major/transport only, never the real
  // operator catalog/source/data/identity/role rules. Production still requires18.
  return {...f,source,path,...(!forReference?{run}:{run:undefined}),studentId,expectedBackfillCounts:{reading:3,group:1}};
 }catch{await f.close().catch(()=>undefined);throw Error("Honoree release disposable fixture failed; details withheld");}
}
export const honoreeReleaseFixture=(options={})=>createFixture(options,false);
/** Root capture only; still exact committed-source/historical-reference guarded.
 * This routine returns a ledger23 populated fixture, not installed evidence.
 * Capture before/after with captureCatalog while applying f.operation(f.owner),
 * compare captureHonoreeData/roles and captureHonoreeInitial, then close(). */
export const honoreeReleaseReferenceFixture=(options={})=>createFixture(options,true);
