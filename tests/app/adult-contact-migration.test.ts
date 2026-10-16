import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0012 upgrades existing children and enforces contact null guards on fresh SQL writes and replay", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder="src/server/db/migrations", journal=JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8"));
    const entries=journal.entries.filter((entry:{idx:number})=>entry.idx<12), prior=join(isolation.home,"prior");
    await mkdir(join(prior,"meta"),{recursive:true}); await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
    for(const entry of entries)await copyFile(join(folder,entry.tag+".sql"),join(prior,entry.tag+".sql"));
    const db=drizzle(client); await migrate(db,{migrationsFolder:prior});
    await client.query("insert into student (tenant_id,first_name,last_name,ceremony_date,parent_email) values ('crc','Synthetic','Existing','2027-01-02','parent@example.test')");
    await migrate(db,{migrationsFolder:folder}); await migrate(db,{migrationsFolder:folder});
    expect((await client.query("select student_kind,parent_email,own_email,revision from student")).rows).toEqual([{student_kind:"child",parent_email:"parent@example.test",own_email:null,revision:1}]);
    const insert=(kind:unknown,parent:unknown,own:unknown)=>client.query("insert into student (tenant_id,first_name,last_name,ceremony_date,student_kind,parent_email,own_email) values ('crc','Synthetic','New','2027-01-02',$1,$2,$3)",[kind,parent,own]);
    for(const [kind,parent,own] of [["child",null,null],["child",null,"child@example.test"],["adult",null,null],["adult","parent@example.test",null],["adult",null," "],["adult"," ","adult@example.test"],["other","parent@example.test","adult@example.test"]]){
      let code="";try{await insert(kind,parent,own);}catch(error){code=String((error as {code?:string}).code);}
      expect(code).toBe("23514");
    }
    await insert("adult",null,"adult@example.test"); await insert("child","parent@example.test",null);
    expect((await client.query("select count(*)::int as total from student")).rows).toEqual([{total:3}]);
  } finally { await client.close(); await isolation.cleanup(); }
});
