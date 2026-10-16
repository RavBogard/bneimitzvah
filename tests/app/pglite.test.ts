import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";

// A real in-process PostgreSQL transaction proves the offline test runtime works.
// This is infrastructure coverage, not the future application's tenant schema.
test("PGlite enforces constraints and rolls back a transaction without a server", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE foundation_probe (id integer PRIMARY KEY, label text NOT NULL)");
    await db.query("INSERT INTO foundation_probe VALUES ($1, $2)", [1, "synthetic"]);
    await expect(db.query("INSERT INTO foundation_probe VALUES ($1, $2)", [1, "duplicate"])).rejects.toThrow();
    await db.exec("BEGIN; INSERT INTO foundation_probe VALUES (2, 'temporary'); ROLLBACK;");
    const result = await db.query<{ id: number; label: string }>("SELECT * FROM foundation_probe ORDER BY id");
    expect(result.rows).toEqual([{ id: 1, label: "synthetic" }]);
  } finally {
    await db.close();
  }
});
