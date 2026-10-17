import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0019 preserves legacy student rows and authority, replays safely and rejects open or malformed intake JSON",async()=>{
  const isolation=await isolatedEnv(),client=new PGlite();
  try{
    const folder="src/server/db/migrations",journal=JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8"));
    const entries=journal.entries.filter((entry:{idx:number})=>entry.idx<19),prior=join(isolation.home,"prior");
    await mkdir(join(prior,"meta"),{recursive:true});await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
    for(const entry of entries)await copyFile(join(folder,entry.tag+".sql"),join(prior,entry.tag+".sql"));
    const db=drizzle(client);await migrate(db,{migrationsFolder:prior});
    await client.query("insert into student (tenant_id,first_name,last_name,ceremony_date,parent_email) values ('crc','Synthetic','Existing','2027-01-02','parent@example.test')");
    const before=(await client.query("select id,tenant_id,first_name,last_name,ceremony_date,parent_email,own_email,student_kind,service_slot,revision,created_at,disabled_at from student")).rows;
    await migrate(db,{migrationsFolder:folder});await migrate(db,{migrationsFolder:folder});
    expect((await client.query("select id,tenant_id,first_name,last_name,ceremony_date,parent_email,own_email,student_kind,service_slot,revision,created_at,disabled_at from student")).rows).toEqual(before);
    expect((await client.query("select hebrew_name,second_parent_email,import_metadata from student")).rows).toEqual([{hebrew_name:null,second_parent_email:null,import_metadata:null}]);
    expect((await client.query("select relrowsecurity,relforcerowsecurity from pg_class where relname='student'")).rows).toEqual([{relrowsecurity:true,relforcerowsecurity:true}]);
    const metadata={version:1,parent1Name:null,householdPhone:null,parent2Name:null,parashahLabel:"Synthetic",tutorName:null,tutorMatch:null,adminNotes:"Synthetic note"};
    await client.query("update student set hebrew_name=$1,second_parent_email=$2,import_metadata=$3",["שֵׁם","second@example.test",metadata]);
    for(const bad of [[],{...metadata,extra:true},{...metadata,version:2},{...metadata,adminNotes:"x".repeat(4097)},{...metadata,tutorMatch:{status:"matched"}},{...metadata,tutorMatch:{status:"unmatched",grantId:"00000000-0000-0000-0000-000000000001"}},{...metadata,parent2Name:17}]){
      let code="";try{await client.query("update student set import_metadata=$1",[bad]);}catch(error){code=String((error as {code?:string}).code);}expect(code).toBe("23514");
    }
    for(const field of ["hebrew_name","second_parent_email"]){
      let code="";try{await client.query(`update student set ${field}=$1`,[" "]);}catch(error){code=String((error as {code?:string}).code);}expect(code).toBe("23514");
    }
    expect((await client.query("select (select count(*)::int from invite) as invites,(select count(*)::int from guardian) as guardians,(select count(*)::int from tutor_student) as tutors,(select count(*)::int from role_grant) as grants")).rows).toEqual([{invites:0,guardians:0,tutors:0,grants:0}]);
    const previous=JSON.parse(await readFile(join(folder,"meta/0018_snapshot.json"),"utf8")),current=JSON.parse(await readFile(join(folder,"meta/0019_snapshot.json"),"utf8"));
    expect(current.prevId).toBe(previous.id);
    const expected=structuredClone(previous.tables);expected["public.student"]=structuredClone(current.tables["public.student"]);
    expect(current.tables).toEqual(expected);
    const oldStudent=previous.tables["public.student"],newStudent=structuredClone(current.tables["public.student"]);
    for(const field of ["hebrew_name","second_parent_email","import_metadata"])delete newStudent.columns[field];
    for(const field of ["student_hebrew_name_bounded","student_second_parent_bounded","student_import_metadata_closed"])delete newStudent.checkConstraints[field];
    expect(newStudent).toEqual(oldStudent);
  }finally{await client.close();await isolation.cleanup();}
});
