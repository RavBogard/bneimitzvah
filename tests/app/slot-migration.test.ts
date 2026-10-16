import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0013 upgrades existing students to unknown, retains contacts/revisions and rejects null or unsupported slots on fresh/replayed migration", async()=>{
 const isolation=await isolatedEnv(),client=new PGlite();
 try{
  const folder="src/server/db/migrations",journal=JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8"));
  const entries=journal.entries.filter((entry:{idx:number})=>entry.idx<13),prior=join(isolation.home,"prior");
  await mkdir(join(prior,"meta"),{recursive:true});await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
  for(const entry of entries)await copyFile(join(folder,entry.tag+".sql"),join(prior,entry.tag+".sql"));
  const db=drizzle(client);await migrate(db,{migrationsFolder:prior});
  await client.query("insert into student (tenant_id,first_name,last_name,ceremony_date,parent_email) values ('crc','Synthetic','Existing','2027-01-02','parent@example.test')");
  await migrate(db,{migrationsFolder:folder});await migrate(db,{migrationsFolder:folder});
  expect((await client.query("select service_slot,student_kind,parent_email,revision from student")).rows).toEqual([{service_slot:"unknown",student_kind:"child",parent_email:"parent@example.test",revision:1}]);
  for(const slot of [null,"friday","", "Morning"]){
   let code="";try{await client.query("update student set service_slot=$1",[slot]);}catch(error){code=String((error as {code?:string}).code);}
   expect(code).toBe(slot===null?"23502":"23514");
  }
  for(const slot of ["morning","havdalah","unknown"])await client.query("update student set service_slot=$1",[slot]);
 }finally{await client.close();await isolation.cleanup();}
});
