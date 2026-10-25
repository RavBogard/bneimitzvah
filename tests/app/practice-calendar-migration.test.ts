import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

test("0018 upgrades and replays without altering lesson heads or existing student authority, and exposes only protected empty practice tables", async () => {
  const isolated = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const prior = join(isolated.home, "prior"), entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 18);
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.exec(`
      INSERT INTO "user" (id,name,email,email_verified) VALUES ('synthetic-practice-upgrade','Synthetic Upgrade','upgrade@example.test',true);
      INSERT INTO membership (id,tenant_id,user_id) VALUES ('10000000-0000-4000-8000-000000000001','crc','synthetic-practice-upgrade');
      INSERT INTO role_grant (tenant_id,membership_id,role) VALUES ('crc','10000000-0000-4000-8000-000000000001','admin');
      INSERT INTO student (id,tenant_id,first_name,last_name,ceremony_date,parent_email) VALUES ('10000000-0000-4000-8000-000000000002','crc','Synthetic','Existing','9999-12-31','parent@example.test');
      INSERT INTO lesson_log (tenant_id,student_id,entry_id,creator_membership_id,creator_user_id,lesson_date,summary,version) VALUES ('crc','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','synthetic-practice-upgrade','2026-10-16','Synthetic preserved lesson',1);
    `);
    const query = "select l.*,m.authority_revision,s.ceremony_date from lesson_log l join membership m on m.id=l.creator_membership_id join student s on s.id=l.student_id";
    const before = (await client.query(query)).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    // Later additive columns (0047 before_next) are nullable; every value 0018 found is unchanged.
    expect(priorColumns((await client.query(query)).rows, before)).toEqual(before);
    for (const table of ["practice_day", "practice_event"]) {
      expect((await client.query(`select count(*)::integer as count from ${table}`)).rows).toEqual([{ count: 0 }]);
      expect((await client.query("select relrowsecurity,relforcerowsecurity from pg_class where relname=$1", [table])).rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect((await client.query("select * from information_schema.table_privileges where grantee='PUBLIC' and table_name=$1", [table])).rows).toHaveLength(0);
      expect((await client.query("select privilege_type from information_schema.table_privileges where grantee='portal_runtime' and table_name=$1 order by privilege_type", [table])).rows).toEqual(["DELETE", "INSERT", "SELECT"].map(privilege_type => ({ privilege_type })));
    }
    expect((await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and table_name='practice_day' and privilege_type='UPDATE'")).rows).toEqual([{ column_name: "practice_day" }]);
    expect((await client.query("select column_name from information_schema.column_privileges where grantee='portal_runtime' and table_name='practice_event' and privilege_type='UPDATE'")).rows).toHaveLength(0);
    expect((await client.query("select portal_practice_anniversary_due('9999-12-31','10000-12-31 05:59:59.999+00') as before,portal_practice_anniversary_due('9999-12-31','10000-12-31 06:00:00+00') as after")).rows).toEqual([{ before: false, after: true }]);
    expect((await client.query("select prosecdef from pg_proc where proname='portal_practice_ceremony_change'")).rows).toEqual([{ prosecdef: false }]);
  } finally { await client.close(); await isolated.cleanup(); }
});
