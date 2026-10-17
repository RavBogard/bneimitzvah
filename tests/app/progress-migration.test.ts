import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0016 upgrades and replays without changing existing assignment revisions or verse identity and creates empty protected progress heads", async () => {
  const isolated = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const prior = join(isolated.home, "prior"), entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 16);
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.exec(`
      INSERT INTO "user" (id,name,email,email_verified) VALUES ('synthetic-upgrade','Synthetic Upgrade','upgrade@example.test',true);
      INSERT INTO membership (id,tenant_id,user_id) VALUES ('10000000-0000-4000-8000-000000000001','crc','synthetic-upgrade');
      INSERT INTO role_grant (tenant_id,membership_id,role) VALUES ('crc','10000000-0000-4000-8000-000000000001','admin');
      INSERT INTO student (id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ('10000000-0000-4000-8000-000000000002','crc','Synthetic','Existing','2027-01-02','parent@example.test');
      INSERT INTO assignment (id,tenant_id,student_id,kind,basis,ref,status,revision,set_by_membership_id) VALUES ('10000000-0000-4000-8000-000000000003','crc','10000000-0000-4000-8000-000000000002','torah','custom','Genesis 1:1','confirmed',7,'10000000-0000-4000-8000-000000000001');
      INSERT INTO assignment_verse (id,tenant_id,student_id,assignment_id,ordinal,verse_ref) VALUES ('10000000-0000-4000-8000-000000000004','crc','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',1,'Genesis 1:1');
    `);
    const query = "select a.id,a.revision,a.ref,v.id as verse_id,v.verse_ref,m.authority_revision from assignment a join assignment_verse v on v.assignment_id=a.id join membership m on m.id=a.set_by_membership_id";
    const before = (await client.query(query)).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect((await client.query(query)).rows).toEqual(before);
    for (const table of ["verse_self_check", "verse_assessment"]) expect((await client.query(`select count(*)::integer as count from ${table}`)).rows).toEqual([{ count: 0 }]);
    const policy = (await client.query<{ enabled: boolean; forced: boolean }>("select relrowsecurity as enabled,relforcerowsecurity as forced from pg_class where relname in ('verse_self_check','verse_assessment')")).rows;
    expect(policy).toHaveLength(2); expect(policy.every(row => row.enabled && row.forced)).toBe(true);
    expect((await client.query("select * from information_schema.table_privileges where grantee='PUBLIC' and table_name in ('verse_self_check','verse_assessment')")).rows).toHaveLength(0);
  } finally { await client.close(); await isolated.cleanup(); }
});
