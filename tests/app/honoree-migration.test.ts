import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import * as s from "../../src/server/db/index";
import { honoreeFixture } from "./honoree-fixture";
import { material } from "../../src/server/honoree/recipient-material";
import { randomBytes } from "node:crypto";
test("0023 backfills current committed nonempty groups, preserves existing data/history and replays safely", async () => {
  const isolation = await isolatedEnv(), client = new PGlite(), source = await honoreeFixture();
  try {
    await source.service.replace(source.req(),source.selected,await source.intent({...source.form,aliyot:[source.form.aliyot[1]]},1));
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8")), entries = journal.entries.filter((e:{idx:number})=>e.idx<23), prior = join(isolation.home,"prior");
    expect(journal.entries.find((e:{idx:number})=>e.idx===23)).toMatchObject({ idx:23, tag:"0023_honoree_links" });
    await mkdir(join(prior,"meta"),{recursive:true}); await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
    for(const entry of entries) await copyFile(join(folder,entry.tag+".sql"),join(prior,entry.tag+".sql"));
    const db=drizzle(client,{schema:s}); await migrate(db,{migrationsFolder:prior});
    await source.owner(async()=>{
      // This database is migrated only to 0023, before tenant.summary_credit (0056) exists.
      for (const row of await source.db.select().from(s.tenant)) await db.execute(sql`insert into tenant (id, name, product_name, enabled, customs) values (${row.id}, ${row.name}, ${row.productName}, ${row.enabled}, ${JSON.stringify(row.customs)}::jsonb) on conflict do nothing`);
      await db.insert(s.user).values(await source.db.select().from(s.user));
      await db.insert(s.membership).values(await source.db.select().from(s.membership));
      await db.insert(s.roleGrant).values(await source.db.select().from(s.roleGrant));
      // The baseline is0022: copy students through that table's own columns, not the newer Drizzle projection.
      await client.query("insert into student select * from jsonb_populate_recordset(null::student,$1::jsonb)", [JSON.stringify((await source.client.query<{ row: unknown }>("select to_jsonb(t) as row from student t")).rows.map(r => r.row))]);
      await db.insert(s.guardian).values(await source.db.select().from(s.guardian));
      await db.insert(s.assignment).values(await source.db.select().from(s.assignment));
      await db.insert(s.assignmentVerse).values(await source.db.select().from(s.assignmentVerse));
      // The baseline is0022: do not use a newer Drizzle insert projection that
      // names the0024 identity column before that migration has run.
      for (const row of await source.db.select().from(s.honorsVersion)) await client.query("insert into honors_version(id,tenant_id,student_id,assignment_id,version,base_version,previous_version,form,reviewed_context,context_hash,actor_user_id,actor_membership_id,role_grant_id,guardian_id,role,mode,mutation_id,request_digest,created_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)", [row.id,row.tenantId,row.studentId,row.assignmentId,row.version,row.baseVersion,row.previousVersion,JSON.stringify(row.form),JSON.stringify(row.reviewedContext),row.contextHash,row.actorUserId,row.actorMembershipId,row.roleGrantId,row.guardianId,row.role,row.mode,row.mutationId,row.requestDigest,row.createdAt]);
    });
    const studentRows=async()=>(await client.query<Record<string,unknown>>("select * from student order by id")).rows, beforeStudents=await studentRows(), beforeHonors=(await client.query("select to_jsonb(h)-'student_identity_id' row from honors_version h order by version")).rows;
    await migrate(db,{migrationsFolder:folder}); await migrate(db,{migrationsFolder:folder});
    expect(priorColumns(await studentRows(),beforeStudents)).toEqual(beforeStudents); expect((await client.query("select to_jsonb(h)-'student_identity_id' row from honors_version h order by version")).rows).toEqual(beforeHonors);
    expect(await db.select().from(s.honoreeReadingEpoch)).toHaveLength(beforeStudents.length);
    expect(await db.select().from(s.honoreeGroupEpoch)).toEqual(["Genesis 1:3"].map(startVerse=>({tenantId:"crc",studentId:source.selected.studentId,startVerse,epoch:0n})));
    expect(await db.select().from(s.honoreeMaterialRelease)).toHaveLength(0); expect(await db.select().from(s.honoreeLink)).toHaveLength(0);
    const previous=JSON.parse(await readFile(join(folder,"meta/0022_snapshot.json"),"utf8")), current=JSON.parse(await readFile(join(folder,"meta/0023_snapshot.json"),"utf8")), expected=structuredClone(previous.tables);
    for(const name of ["honoree_reading_epoch","honoree_group_epoch","honoree_material_release","honoree_link","honoree_operation"]) expected["public."+name]=current.tables["public."+name];
    expected["public.audit_event"].checkConstraints.audit_action_known=current.tables["public.audit_event"].checkConstraints.audit_action_known;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
  }finally{await source.client.close();await client.close();await isolation.cleanup();}
});
test("runtime has FORCE tenant RLS, monotonic column-only counters, immutable receipts and no rights approval",async()=>{
  const f=await honoreeFixture();
  try{
    await f.issue();
    const rights=await f.client.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean;del:boolean}>("select relname,relrowsecurity,relforcerowsecurity,has_table_privilege('portal_runtime',oid,'DELETE') del from pg_class where relname in ('honoree_reading_epoch','honoree_group_epoch','honoree_link','honoree_operation','honoree_material_release') order by relname");
    expect(rights.rows).toHaveLength(5);for(const row of rights.rows)expect(row).toMatchObject({relrowsecurity:true,relforcerowsecurity:true,del:false});
    expect((await f.client.query("select has_column_privilege('portal_runtime','honoree_reading_epoch','epoch','UPDATE') epoch,has_column_privilege('portal_runtime','honoree_reading_epoch','student_id','UPDATE') identity,has_table_privilege('portal_runtime','honoree_operation','UPDATE') receipt,has_table_privilege('portal_runtime','honoree_material_release','INSERT') approval,has_column_privilege('portal_runtime','honoree_material_release','state','UPDATE') lifecycle")).rows).toEqual([{epoch:true,identity:false,receipt:false,approval:false,lifecycle:false}]);
    await f.client.exec("set app.tenant_id='other'");
    expect(await f.db.select().from(s.honoreeLink)).toHaveLength(0);expect(await f.db.select().from(s.honoreeOperation)).toHaveLength(0);expect(await f.db.select().from(s.honoreeReadingEpoch)).toHaveLength(0);
    await expect(f.client.exec("insert into honoree_reading_epoch(tenant_id,student_id) select 'crc',id from student limit 1")).rejects.toBeDefined();
  }finally{await f.client.close();}
});
test("SQL and projection agree on credit controls; SQL refuses forged expiry/context/epochs and guardian attribution",async()=>{
  const f=await honoreeFixture();
  try{
    const issued=await f.issue(), [row]=await f.owner(()=>f.db.select().from(s.honoreeLink));
    for(const credit of ["Synthetic notice","Synthetic\nnotice","Synthetic\tnotice","Synthetic\u0085notice","Synthetic\u0001notice","Synthetic\u007fnotice"]){
      let accepted=true;try{material({version:"synthetic",before:[{he:"Synthetic",en:"Synthetic"}],after:[{he:"Synthetic",en:"Synthetic"}],credits:[credit]});}catch{accepted=false;}
      expect((await f.client.query<{valid:boolean}>("select portal_honoree_notices_valid($1::jsonb) valid",[JSON.stringify([credit])])).rows[0].valid).toBe(accepted);
    }
    await f.honoree.mutate(f.req(),f.selected,await f.honoreeIntent("revoke",issued.id));
    for(const change of [{expiresAt:new Date(row.expiresAt.getTime()+1000)},{contextHash:"0".repeat(64)},{readingEpoch:row.readingEpoch+1n},{groupEpoch:row.groupEpoch+1n},{guardianId:f.guardians[1].id}])
      await expect(f.owner(()=>f.db.insert(s.honoreeLink).values({...row,id:randomBytes(16).toString("base64url"),revokedAt:null,...change}))).rejects.toBeDefined();
  }finally{await f.client.close();}
});
