import { copyFile,mkdir,readFile,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect,test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
test("0014 preserves existing assignments as unrecorded and enforces nullable Torah-only bounded native arrays on upgrade/reapply",async()=>{
  const isolated=await isolatedEnv(),client=new PGlite();
  try{
    const folder="src/server/db/migrations",journal=JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8")),prior=join(isolated.home,"prior");
    const entries=journal.entries.filter((entry:{idx:number})=>entry.idx<14);await mkdir(join(prior,"meta"),{recursive:true});await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
    for(const entry of entries)await copyFile(join(folder,entry.tag+".sql"),join(prior,entry.tag+".sql"));
    const db=drizzle(client);await migrate(db,{migrationsFolder:prior});
    await client.query(`insert into "user" (id,name,email,email_verified) values ('synthetic-aliyah-migration','Synthetic','migration@example.test',true)`);
    await client.query(`insert into membership (tenant_id,user_id) values ('crc','synthetic-aliyah-migration')`);
    await client.query(`insert into student (tenant_id,first_name,last_name,ceremony_date,parent_email) values ('crc','Synthetic','Migration','2027-01-02','parent@example.test')`);
    await client.query(`insert into assignment (tenant_id,student_id,kind,basis,ref,status,set_by_membership_id) select 'crc',student.id,'torah','custom','Genesis 1:1-3','confirmed',membership.id from student cross join membership`);
    const before=(await client.query("select id,ref,revision,proposal_snapshot from assignment")).rows;
    await migrate(db,{migrationsFolder:folder});await migrate(db,{migrationsFolder:folder});
    expect((await client.query("select id,ref,revision,proposal_snapshot from assignment")).rows).toEqual(before);
    expect((await client.query("select aliyah_starts from assignment")).rows).toEqual([{aliyah_starts:null}]);
    await client.query("update assignment set aliyah_starts=ARRAY[]::text[]");expect((await client.query("select aliyah_starts from assignment")).rows).toEqual([{aliyah_starts:[]}]);
    await client.query("update assignment set aliyah_starts=ARRAY['Genesis 1:2']::text[]");
    for(const statement of ["update assignment set kind='haftarah'","update assignment set aliyah_starts=ARRAY[NULL]::text[]","update assignment set aliyah_starts=ARRAY[['Genesis 1:2']]::text[]","update assignment set aliyah_starts=array_fill('Genesis 1:2'::text,ARRAY[1000])","update assignment set aliyah_starts='[0:0]={\"Genesis 1:2\"}'::text[]"]){
      let rejected=false;try{await client.query(statement);}catch{rejected=true;}expect(rejected).toBe(true);
    }
    await client.query("update assignment set aliyah_starts=null,kind='haftarah'");
    const fresh=new PGlite();try{await migrate(drizzle(fresh),{migrationsFolder:folder});expect((await fresh.query("select data_type,udt_name,is_nullable,column_default from information_schema.columns where table_name='assignment' and column_name='aliyah_starts'")).rows).toEqual([{data_type:"ARRAY",udt_name:"_text",is_nullable:"YES",column_default:null}]);}finally{await fresh.close();}
  }finally{await client.close();await isolated.cleanup();}
});
