import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

// Release 1.7 M2 ("Change verses"): 0040 lets the runtime update a saved reading's ranges and verse count, and nothing else.
// Row security is unchanged (the forced owner_only policy from 0036); saved-migration.test.ts holds the owner-only behaviour.
const TAG = "0040_saved_reading_ranges";
const SAVED = ["saved_reading", "saved_verse_mark", "saved_verse_work", "starred_comment"];

test("0040 only grants UPDATE on saved_reading's ranges and verse_count, leaves every row, policy and other grant unchanged, and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const own = journal.entries.findIndex((e: { tag: string }) => e.tag === TAG);
    expect(journal.entries[own]).toMatchObject({ idx: 40, tag: TAG });
    expect(journal.entries[own].when).toBeGreaterThan(journal.entries.find((e: { tag: string }) => e.tag === "0039_public_page_views").when);
    const entries = journal.entries.slice(0, own), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });

    // A synthetic member with a reading, a note, a mark and a star, written as the table owner before the migration.
    const member = randomUUID();
    await client.query("insert into \"user\"(id,name,email,email_verified) values('ranges-existing','Synthetic',$1,true)", [["ranges-existing", "example.test"].join("@")]);
    await client.query("insert into membership(id,tenant_id,user_id) values($1,'crc','ranges-existing')", [member]);
    const { rows: [reading] } = await client.query<{ id: string }>("insert into saved_reading(tenant_id,membership_id,user_id,name,kind,ranges,verse_count) values('crc',$1,'ranges-existing','Synthetic','torah','Genesis 1:1-3',3) returning id", [member]);
    await client.query("insert into saved_verse_work(tenant_id,membership_id,saved_reading_id,verse_ref,stream,text,version) values('crc',$1,$2,'Genesis 1:3','note','Synthetic note',1)", [member, reading.id]);
    await client.query("insert into saved_verse_mark(tenant_id,membership_id,saved_reading_id,verse_ref,state,version) values('crc',$1,$2,'Genesis 1:3','working',1)", [member, reading.id]);
    await client.query("insert into starred_comment(tenant_id,membership_id,user_id,work,verse_ref,comment_index) values('crc',$1,'ranges-existing','rashi','Genesis 1:3',1)", [member]);

    const tables = [...SAVED, "membership", "role_grant", "audit_event", "tenant", "public_page_view_day"];
    const capture = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await client.query(`select * from ${t} order by 1`)).rows])));
    const policies = async () => (await client.query("select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies order by 1, 2")).rows;
    const tableGrants = async () => (await client.query("select table_name, grantee, privilege_type from information_schema.table_privileges where grantee in ('portal_runtime','PUBLIC') order by 1, 2, 3")).rows;
    const columnGrants = async () => (await client.query<{ table_name: string; column_name: string; privilege_type: string }>(
      "select table_name, column_name, privilege_type from information_schema.column_privileges where grantee in ('portal_runtime','PUBLIC') order by 1, 2, 3")).rows;
    const rls = async () => (await client.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relkind='r' and relnamespace = 'public'::regnamespace order by 1")).rows;
    const before = { rows: await capture(), policies: await policies(), tables: await tableGrants(), columns: await columnGrants(), rls: await rls() };
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(await capture()).toEqual(before.rows);
    expect(await policies()).toEqual(before.policies);
    expect(await tableGrants()).toEqual(before.tables);
    expect(await rls()).toEqual(before.rls);
    // Column grants: exactly the two new UPDATE columns on saved_reading, and nothing else anywhere.
    const added = (await columnGrants()).filter(row => !before.columns.some(old => old.table_name === row.table_name && old.column_name === row.column_name && old.privilege_type === row.privilege_type));
    expect(added).toEqual([{ table_name: "saved_reading", column_name: "ranges", privilege_type: "UPDATE" }, { table_name: "saved_reading", column_name: "verse_count", privilege_type: "UPDATE" }]);
    expect((await columnGrants()).length).toBe(before.columns.length + 2);
    const readingUpdate = (await columnGrants()).filter(row => row.table_name === "saved_reading" && row.privilege_type === "UPDATE").map(row => row.column_name);
    expect(readingUpdate).toEqual(["name", "ranges", "reading_date", "revision", "updated_at", "verse_count"]);
    expect((await client.query("select count(*)::int as n from information_schema.table_privileges where grantee='PUBLIC' and table_name = any($1)", [SAVED])).rows).toEqual([{ n: 0 }]);

    // The file is the one grant: no DDL, no widening elsewhere, no snapshot (the schema itself does not change).
    const text = await readFile(join(folder, `${TAG}.sql`), "utf8");
    expect(text).not.toContain("\r");
    expect(text).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
    const statements = text.split("--> statement-breakpoint").map(part => part.replace(/^--.*$/gm, "").trim()).filter(Boolean);
    expect(statements).toEqual(["GRANT UPDATE (ranges, verse_count) ON saved_reading TO portal_runtime;"]);
    expect(text).not.toContain("app.saved_owner");
    expect(statements.join("\n")).not.toMatch(/POLICY|ROW LEVEL SECURITY|REVOKE|DROP|ALTER|TRUNCATE|DELETE|INSERT|GRANT ALL/i);
    await expect(access(join(folder, "meta/0040_snapshot.json"))).rejects.toThrow();
  } finally { await client.close(); await isolation.cleanup(); }
});
