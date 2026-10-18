import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
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
      await db.insert(s.tenant).values(await source.db.select().from(s.tenant)).onConflictDoNothing();
      await db.insert(s.user).values(await source.db.select().from(s.user));
      await db.insert(s.membership).values(await source.db.select().from(s.membership));
      await db.insert(s.roleGrant).values(await source.db.select().from(s.roleGrant));
      await db.insert(s.student).values(await source.db.select().from(s.student));
      await db.insert(s.guardian).values(await source.db.select().from(s.guardian));
      await db.insert(s.assignment).values(await source.db.select().from(s.assignment));
      await db.insert(s.assignmentVerse).values(await source.db.select().from(s.assignmentVerse));
      await db.insert(s.honorsVersion).values(await source.db.select().from(s.honorsVersion));
    });
    const beforeStudents=await db.select().from(s.student), beforeHonors=await db.select().from(s.honorsVersion);
    await migrate(db,{migrationsFolder:folder}); await migrate(db,{migrationsFolder:folder});
    expect(await db.select().from(s.student)).toEqual(beforeStudents); expect(await db.select().from(s.honorsVersion)).toEqual(beforeHonors);
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
    expect(await f.db.select().from(s.honoreeLink)).toHaveLength(0);expect(await f.db.select().from(s.honoreeOperation)).toHaveLength(0);expect(await f.db.select().from(s.honoreeReadingEpoch)).toHaveLength(1);
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
