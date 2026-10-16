import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Generation-only tooling stays outside the application's dependency graph.
// A separate cache is needed: npm exec can omit a locally installed ORM from its
// temporary package tree, leaving drizzle-kit's ESM imports unresolvable.
const root = fileURLToPath(new URL("../", import.meta.url));
const tooling = join(root, ".cache", "db-generation-0.31.11-orm-0.45.4");
const kit = join(tooling, "node_modules", "drizzle-kit", "bin.cjs");
const npmCli = process.env.npm_execpath;
const env = {};
for (const name of ["PATH", "Path", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "PROGRAMFILES"]) {
  if (process.env[name]) env[name] = process.env[name];
}
env.HOME = tooling;
env.USERPROFILE = tooling;

try {
  await mkdir(tooling, { recursive: true });
  if (!existsSync(kit)) {
    if (!npmCli) throw new Error("Use npm run db:generate");
    await writeFile(join(tooling, "package.json"), JSON.stringify({ private: true, dependencies: { "drizzle-kit": "0.31.11", "drizzle-orm": "0.45.4" } }));
    const install = spawnSync(process.execPath, [npmCli, "install", "--prefix", tooling, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry=https://registry.npmjs.org", "--userconfig", join(tooling, "no-user-npmrc")], { cwd: root, env, encoding: "utf8" });
    if (install.status !== 0) throw new Error("Generation tooling installation failed");
  }
  const generation = spawnSync(process.execPath, [kit, "generate"], { cwd: root, env, encoding: "utf8" });
  if (generation.status !== 0) throw new Error("Schema generation failed");
  process.stdout.write(generation.stdout);
} catch {
  console.error("Schema generation failed; inspect the pinned local generation tooling and configuration");
  process.exitCode = 1;
}
