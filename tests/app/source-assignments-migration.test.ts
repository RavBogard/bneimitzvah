import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";
const citation = { id: "a", ref: "Invented 1", indexTitle: "Invented", category: "Commentary", labels: { en: null, he: null } };
test("0021 additive migration upgrades and replays, with generated snapshot limited to the new stream and audit action", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder,"meta/_journal.json"),"utf8")), entries = journal.entries.filter((e:{idx:number})=>e.idx<21), prior = join(isolation.home,"prior");
    await mkdir(join(prior,"meta"),{recursive:true}); await writeFile(join(prior,"meta/_journal.json"),JSON.stringify({...journal,entries}));
    for(const e of entries) await copyFile(join(folder,e.tag+".sql"),join(prior,e.tag+".sql"));
    const db=drizzle(client);await migrate(db,{migrationsFolder:prior});
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Source','2027-01-02','source@example.test')",[randomUUID()]);const before=(await client.query("select * from student")).rows;
    await migrate(db,{migrationsFolder:folder});await migrate(db,{migrationsFolder:folder});expect(priorColumns((await client.query("select * from student")).rows,before)).toEqual(before);
    expect((await client.query("select count(*)::int as n from verse_source_assignment")).rows).toEqual([{n:0}]);
    const previous=JSON.parse(await readFile(join(folder,"meta/0020_snapshot.json"),"utf8")),current=JSON.parse(await readFile(join(folder,"meta/0021_snapshot.json"),"utf8")), expected=structuredClone(previous.tables);
    expected["public.verse_source_assignment"]=current.tables["public.verse_source_assignment"];expected["public.audit_event"].checkConstraints.audit_action_known=current.tables["public.audit_event"].checkConstraints.audit_action_known;expect(current.prevId).toBe(previous.id);expect(current.tables).toEqual(expected);
    const valid=await client.query<{valid:boolean}>("select portal_source_citations_valid($1::jsonb) as valid",[JSON.stringify([citation])]);expect(valid.rows[0].valid).toBe(true);
    for(const bad of [[{...citation,text:"forbidden"}],[citation,citation],[{...citation,category:"<b>"}],[{...citation,labels:{en:null,he:null,extra:"x"}}],Array(33).fill(citation),[{...citation,indexTitle:"x".repeat(513)}]]) expect((await client.query<{valid:boolean}>("select portal_source_citations_valid($1::jsonb) as valid",[JSON.stringify(bad)])).rows[0].valid).toBe(false);
  }finally{await client.close();await isolation.cleanup();}
});
test("schema rejects missing predecessor, role/actor mismatch and all update/delete while granting only tenant-scoped SELECT/INSERT",async()=>{
 const f=await portalRoutesFixture();try{
 const row=await f.owner(async()=>{const [a]=await f.db.insert(s.assignment).values({tenantId:"crc",studentId:f.students[0].id,kind:"torah",basis:"custom",ref:"Genesis 1:1",status:"confirmed",setByMembershipId:f.adminMember.id}).returning();
 return {tenantId:"crc",studentId:f.students[0].id,assignmentId:a.id,assignmentRevision:1,verseRef:"Genesis 1:1",version:1,baseVersion:0,previousVersion:null,citations:[citation],actorUserId:f.identities.admin.id,actorMembershipId:f.adminMember.id,roleGrantId:f.adminGrant.id,role:"admin" as const,mode:"admin" as const,mutationId:randomUUID(),requestDigest:"a".repeat(64)};});
 await f.owner(async()=>{await f.db.insert(s.verseSourceAssignment).values(row);});
 for(const bad of [{...row,version:2,baseVersion:1,previousVersion:null},{...row,version:3,baseVersion:2,previousVersion:2},{...row,actorMembershipId:f.multiMember.id},{...row,mode:"parent" as const}])await expect(f.owner(async()=>{await f.db.insert(s.verseSourceAssignment).values({...bad,mutationId:randomUUID()});})).rejects.toBeDefined();
 await expect(f.client.exec("update verse_source_assignment set request_digest=request_digest")).rejects.toBeDefined();await expect(f.client.exec("delete from verse_source_assignment")).rejects.toBeDefined();
 const rights=await f.client.query<{sel:boolean;ins:boolean;upd:boolean;del:boolean;force:boolean;rls:boolean}>("select has_table_privilege('portal_runtime','verse_source_assignment','SELECT') sel,has_table_privilege('portal_runtime','verse_source_assignment','INSERT') ins,has_table_privilege('portal_runtime','verse_source_assignment','UPDATE') upd,has_table_privilege('portal_runtime','verse_source_assignment','DELETE') del,relforcerowsecurity force,relrowsecurity rls from pg_class where relname='verse_source_assignment'");expect(rights.rows).toEqual([{sel:true,ins:true,upd:false,del:false,force:true,rls:true}]);
 }finally{await f.client.close();}
});
