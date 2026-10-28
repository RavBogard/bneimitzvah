// A PGlite database with every migration applied, cloned from one snapshot that the Vitest globalSetup builds once per run.
// The snapshot lives in the OS temp directory (never the repo), keyed by a hash of the migrations folder, so it is rebuilt
// whenever a migration changes. If the snapshot is missing (a file run outside the global setup), the helper migrates in place.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

export const MIGRATIONS_FOLDER = "src/server/db/migrations";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

export function snapshotPath(folder = MIGRATIONS_FOLDER): string {
  const hash = createHash("sha256");
  hash.update(String(JSON.parse(readFileSync("node_modules/@electric-sql/pglite/package.json", "utf8")).version));
  for (const file of walk(folder).sort()) hash.update(path.relative(folder, file).replaceAll("\\", "/")).update(readFileSync(file));
  return path.join(tmpdir(), `crc-pglite-${hash.digest("hex").slice(0, 24)}.tar.gz`);
}

export async function buildSnapshot(folder = MIGRATIONS_FOLDER): Promise<string> {
  const target = snapshotPath(folder);
  if (existsSync(target)) return target;
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
    const dump = await client.dumpDataDir("gzip");
    mkdirSync(path.dirname(target), { recursive: true });
    const partial = `${target}.${process.pid}.tmp`;
    writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
    renameSync(partial, target);
  } finally { await client.close(); }
  return target;
}

/** A fresh, fully migrated, private PGlite. Same schema as `new PGlite()` plus `migrate(...)`. */
export async function migratedPglite(): Promise<PGlite> {
  const source = snapshotPath();
  if (existsSync(source)) {
    const client = new PGlite({ loadDataDir: new File([readFileSync(source)], "pglite-snapshot.tar.gz", { type: "application/gzip" }) });
    await client.waitReady;
    return client;
  }
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  return client;
}
