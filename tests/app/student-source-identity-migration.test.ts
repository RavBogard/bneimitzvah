import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";

const TAG = "0030_student_source_identity";

test("0030 adds only student_source_identity, leaves existing students unchanged and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === TAG);
    expect(entry).toMatchObject({ idx: 30 });
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < entry.idx), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02','existing@example.test')", [randomUUID()]);
    const before = (await client.query("select * from student")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect(priorColumns((await client.query("select * from student")).rows, before)).toEqual(before);
    expect((await client.query("select count(*)::int as n from student_source_identity")).rows).toEqual([{ n: 0 }]);
    const previous = JSON.parse(await readFile(join(folder, `meta/${String(entry.idx - 1).padStart(4, "0")}_snapshot.json`), "utf8"));
    const current = JSON.parse(await readFile(join(folder, `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`), "utf8"));
    const expected = structuredClone(previous.tables);
    expected["public.student_source_identity"] = current.tables["public.student_source_identity"];
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    expect(Object.keys(current.tables["public.student_source_identity"].uniqueConstraints).sort()).toEqual(["student_source_identity_record_key", "student_source_identity_student_key"]);
    // Row security and the runtime's insert-only rights are hand-written beside the generated DDL.
    const sql = await readFile(join(folder, `${TAG}.sql`), "utf8");
    for (const line of ["ALTER TABLE student_source_identity FORCE ROW LEVEL SECURITY;", "REVOKE ALL ON student_source_identity FROM portal_runtime;",
      "GRANT SELECT, INSERT ON student_source_identity TO portal_runtime;", "CREATE POLICY tenant_isolation ON student_source_identity TO portal_runtime"]) expect(sql).toContain(line);
    expect(sql).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*student_source_identity/);
    const policy = await client.query<{ qual: string; with_check: string; roles: string[] }>("select qual, with_check, roles::text[] as roles from pg_policies where tablename='student_source_identity'");
    expect(policy.rows).toEqual([{ qual: "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))", with_check: "(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text))", roles: ["portal_runtime"] }]);
  } finally { await client.close(); await isolation.cleanup(); }
});
