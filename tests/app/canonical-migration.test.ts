import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

test("0011 upgrades an existing directory by one row and runner replay preserves rollback rows", async () => {
  const isolation = await isolatedEnv();
  const client = new PGlite();
  try {
    const folder = "src/server/db/migrations";
    const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 11).tag).toBe("0011_crc_beit_production_host");
    const before = { ...journal, entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 11) };
    const priorFolder = join(isolation.home, "prior-migrations");
    await mkdir(join(priorFolder, "meta"), { recursive: true });
    await writeFile(join(priorFolder, "meta/_journal.json"), JSON.stringify(before));
    for (const entry of before.entries) await copyFile(join(folder, entry.tag + ".sql"), join(priorFolder, entry.tag + ".sql"));
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: priorFolder });
    const directory = () => client.query<{ host: string; tenant_id: string; environment: string; deployment: string; origin: string }>("select host,tenant_id,environment,deployment,origin from tenant_host order by host");
    const original = (await directory()).rows;
    expect(original).toHaveLength(2);
    await migrate(db, { migrationsFolder: folder });
    const upgraded = (await directory()).rows;
    expect(upgraded.filter(row => row.host !== "beitmitzvah.centralreform.org")).toEqual(original);
    expect(upgraded.filter(row => row.host === "beitmitzvah.centralreform.org")).toEqual([{ host: "beitmitzvah.centralreform.org", tenant_id: "crc", environment: "production", deployment: "production", origin: "https://beitmitzvah.centralreform.org" }]);
    await migrate(db, { migrationsFolder: folder });
    expect((await directory()).rows).toEqual(upgraded);
    expect((await client.query("select count(*)::int as total from drizzle.__drizzle_migrations")).rows).toEqual([{ total: journal.entries.length }]);
  } finally { await client.close(); await isolation.cleanup(); }
});
