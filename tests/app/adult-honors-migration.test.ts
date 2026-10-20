import { expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { adultUpgradePrefix, seedLegacyAdultUpgrade, legacyAdultUpgradeSnapshot } from "../helpers/adult-honors-upgrade.mjs";

test("0024 upgrades populated parent/admin honors receipts links and epochs without rewriting or backfill", async () => {
  const iso = await isolatedEnv(), client = new PGlite();
  try {
    const future = Date.now() + 10 * 365 * 86400000;
    vi.spyOn(Date, "now").mockReturnValue(future);
    const prefix = await adultUpgradePrefix(iso.home), db = drizzle(client); await migrate(db, { migrationsFolder: prefix });
    const seeded = await seedLegacyAdultUpgrade(client); const before = await legacyAdultUpgradeSnapshot(client);
    expect(before.student.find(row => row.id === seeded.studentId)?.ceremony_date).toBe(new Date(future + 365 * 86400000).toISOString().slice(0, 10));
    expect(before.honors_version.length).toBe(2); expect(before.honoree_link.length).toBe(2); expect(before.honoree_operation.length).toBe(2);
    await migrate(db, { migrationsFolder: "src/server/db/migrations" }); await migrate(db, { migrationsFolder: "src/server/db/migrations" });
    expect(await legacyAdultUpgradeSnapshot(client)).toEqual(before);
    // Incumbent old-column parent/admin inserts still work after0024.
    await seedLegacyAdultUpgrade(client);
    expect((await legacyAdultUpgradeSnapshot(client)).honors_version.length).toBe(4);
    for (const table of ["honors_version", "honoree_link", "honoree_operation"]) {
      expect((await client.query<{ n: number }>(`select count(*)::int n from ${table} where student_identity_id is not null`)).rows[0].n).toBe(0);
    }
  } finally { vi.restoreAllMocks(); try { await client.close(); } finally { await iso.cleanup(); } }
});

test("0024 snapshot derives narrowly from0023 with exact identity FK and no other schema changes", async () => {
  const root = "src/server/db/migrations/meta/", old = JSON.parse(await readFile(root + "0023_snapshot.json", "utf8")), next = JSON.parse(await readFile(root + "0024_snapshot.json", "utf8"));
  expect(next.prevId).toBe(old.id); expect(next.id).not.toBe(old.id);
  const reverted = structuredClone(next); reverted.id = old.id; reverted.prevId = old.prevId;
  for (const table of ["honors_version", "honoree_link", "honoree_operation"]) {
    const t = reverted.tables["public." + table]; expect(t.columns.student_identity_id.notNull).toBe(false);
    expect(t.foreignKeys[table + "_student_identity_fk"].columnsTo).toEqual(["tenant_id", "id", "student_id", "role_grant_id"]);
    delete t.columns.student_identity_id; delete t.foreignKeys[table + "_student_identity_fk"];
    const check = table === "honors_version" ? "honors_version_author" : table + "_shape";
    expect(t.checkConstraints[check].value.includes("'student'")).toBe(true);
    t.checkConstraints[check] = old.tables["public." + table].checkConstraints[check];
  }
  expect(reverted).toEqual(old);
});
