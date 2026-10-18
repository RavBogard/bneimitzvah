import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sourceAssignmentsReleaseFixture } from "./release-source-assignments-fixture.mjs";
import { honorsSourceContract } from "../../scripts/release-migrate-honors-support.mjs";
import { executeHonorsRelease } from "../../scripts/release-migrate-honors.mjs";
import { need, sha } from "../../scripts/release-migrate-support.mjs";

/** Guarded disposable loopback only. The real committed source contract runs
 * before fixture creation; only TLS transport is substituted for local PG. */
export async function honorsReleaseFixture(options={}) {
  const checked=honorsSourceContract(options.expectedCommit??process.env.HONORS_RELEASE_EXPECTED_COMMIT);
  const f=await sourceAssignmentsReleaseFixture(options);
  try {
    await f.operation(f.owner); // Exact approved ledger22 baseline.
    const base="src/server/db/migrations",journal=await readFile(base+"/meta/_journal.json"),row=JSON.parse(journal).entries[22];
    need(row.tag===checked.migrations[22].tag&&row.tag==="0022_honors_version");
    const path=join(f.folder,row.tag+".sql"),bytes=Buffer.from(checked.honorsSQL);
    await writeFile(path,bytes,{flag:"wx"});await writeFile(join(f.folder,"meta/_journal.json"),journal);
    const source={...checked,recheck(){checked.recheck();need(sha(readFileSync(path))===checked.migrations[22].hash&&readFileSync(join(f.folder,"meta/_journal.json")).equals(journal));}};
    const user="synthetic-honors-helper-"+randomUUID();
    await f.owner.query('INSERT INTO public."user"(id,name,email) VALUES($1,$2,$3)',[user,"Synthetic Release",user+"@example.test"]);
    const member=(await f.owner.query("INSERT INTO public.membership(tenant_id,user_id) VALUES('crc',$1) RETURNING id",[user])).rows[0].id;
    const grant=(await f.owner.query("INSERT INTO public.role_grant(tenant_id,membership_id,role) VALUES('crc',$1,'admin') RETURNING id",[member])).rows[0].id;
    const students=(await f.owner.query("SELECT id FROM public.student WHERE tenant_id='crc'")).rows;need(students.length===1);
    const assignment=(await f.owner.query("INSERT INTO public.assignment(tenant_id,student_id,kind,basis,ref,status,set_by_membership_id) VALUES('crc',$1,'torah','custom','Genesis 1:1','confirmed',$2) RETURNING id",[students[0].id,member])).rows[0].id;
    const citations=[{id:"synthetic_reference",ref:"Invented Work 1",indexTitle:"Invented Work",category:"Commentary",labels:{en:null,he:null}}];
    await f.owner.query("INSERT INTO public.verse_source_assignment(tenant_id,student_id,assignment_id,assignment_revision,verse_ref,version,base_version,citations,actor_user_id,actor_membership_id,role_grant_id,role,mode,mutation_id,request_digest) VALUES('crc',$1,$2,1,'Genesis 1:1',1,0,$3::jsonb,$4,$5,$6,'admin','admin',$7,$8)",[students[0].id,assignment,JSON.stringify(citations),user,member,grant,randomUUID(),sha("synthetic-source-helper")]);
    const run=(apply=false,migrate=f.operation,checks={})=>executeHonorsRelease(source,f.target,{apply,connect:()=>new pg.Client(f.target.connection),checks:{transport(){},...checks},migrate});
    return {...f,source,path,run};
  } catch {
    await f.close().catch(()=>undefined);throw Error("Honors release disposable fixture failed; details withheld");
  }
}
