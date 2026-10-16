import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0015 fresh/upgrade/reapply preserves scripture/authority state and creates forced tenant-private empty service tables", async () => {
  const isolated = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    const prior = join(isolated.home, "prior"), entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 15);
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await copyFile(join(folder, entry.tag + ".sql"), join(prior, entry.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    const before = (await client.query("select id,name,product_name,enabled,customs from tenant order by id")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect((await client.query("select id,name,product_name,enabled,customs from tenant order by id")).rows).toEqual(before);
    const rows = (await client.query<{ name: string; enabled: boolean; forced: boolean }>("select relname as name,relrowsecurity as enabled,relforcerowsecurity as forced from pg_class where relname in ('service_catalog','service_catalog_lifecycle','student_service_plan') order by relname")).rows;
    expect(rows).toHaveLength(3); expect(rows.every(row => row.enabled && row.forced)).toBe(true);
    expect((await client.query("select count(*)::integer as count from service_catalog")).rows).toEqual([{ count: 0 }]);
    expect((await client.query("select count(*)::integer as count from student_service_plan")).rows).toEqual([{ count: 0 }]);
    expect((await client.query("select data_type,udt_name from information_schema.columns where table_name='service_catalog' and column_name='feed_bytes'")).rows).toEqual([{ data_type: "bytea", udt_name: "bytea" }]);
    const fresh = new PGlite(); try { await migrate(drizzle(fresh), { migrationsFolder: folder });
      expect((await fresh.query("select count(*)::integer as count from service_catalog_lifecycle")).rows).toEqual([{ count: 0 }]);
    } finally { await fresh.close(); }
  } finally { await client.close(); await isolated.cleanup(); }
});
