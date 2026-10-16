import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export const migrationsFolder = fileURLToPath(new URL("../src/server/db/migrations", import.meta.url));

// Explicitly invoked operator/CI tool, not an application import side effect.
// The caller supplies a direct migration-owner client. Runtime never imports it.
export async function migrateDatabase(client) {
  await migrate(drizzle(client, { logger: false }), { migrationsFolder });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    const value = process.env.DATABASE_MIGRATION_URL;
    if (!value) throw new Error("Missing migration configuration");
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname.includes("-pooler")) {
      throw new Error("A direct migration connection is required");
    }
    client = new pg.Client({ connectionString: value });
    await client.connect();
    await migrateDatabase(client);
    console.log("Database migrations completed");
  } catch {
    // Neither driver errors nor connection configuration are safe to print.
    console.error("Database migration failed; verify private configuration and database permissions");
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
