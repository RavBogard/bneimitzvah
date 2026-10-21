import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { priorColumns } from "../helpers/prior-columns";
import { adultUpgradePrefix, seedLegacyAdultUpgrade, legacyAdultUpgradeSnapshot } from "../helpers/adult-honors-upgrade.mjs";
import { postgresAccessFixture } from "./access-fixture";

test("native0023 to0024 preserves populated parent/admin history receipts links epochs and restricted added-column privileges", async () => {
  const iso = await isolatedEnv(); let f: Awaited<ReturnType<typeof postgresAccessFixture>> | undefined;
  try {
    const prefix = await adultUpgradePrefix(iso.home); f = await postgresAccessFixture({ migrationsFolder: prefix });
    await seedLegacyAdultUpgrade(f.owner); const before = await legacyAdultUpgradeSnapshot(f.owner);
    expect(before.honors_version.length).toBe(2); expect(before.honoree_link.length).toBe(2); expect(before.honoree_operation.length).toBe(2);
    await migrate(f.ownerDb, { migrationsFolder: "src/server/db/migrations" }); await migrate(f.ownerDb, { migrationsFolder: "src/server/db/migrations" });
    const after = await legacyAdultUpgradeSnapshot(f.owner);
    expect(Object.fromEntries(Object.entries(after).map(([table, rows]) => [table, priorColumns(rows, before[table])]))).toEqual(before);
    await seedLegacyAdultUpgrade(f.owner);
    expect((await legacyAdultUpgradeSnapshot(f.owner)).honors_version.length).toBe(4);
    for (const table of ["honors_version", "honoree_link", "honoree_operation"]) {
      const p = await f.aDb.execute(sql`select has_column_privilege(current_user,${table},'student_identity_id','SELECT') r,has_column_privilege(current_user,${table},'student_identity_id','INSERT') w,(select not rolsuper and not rolbypassrls from pg_roles where rolname=current_user) restricted`);
      expect(p.rows[0].restricted).toBe(true);
      expect(p.rows[0].r).toBe(true); expect(p.rows[0].w).toBe(true);
      expect((await f.owner.query(`select count(*)::int n from ${table} where student_identity_id is not null`)).rows[0].n).toBe(0);
    }
  } finally { try { if (f) await f.close(); } finally { await iso.cleanup(); } }
});
