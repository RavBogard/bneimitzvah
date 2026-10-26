import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { workerOrigins, workerPolicy } from "./policy";
import { selectedCanonicalOrigin } from "../navigation/canonical";
import { SHELL_PAGES } from "./shell";

/**
 * The environment the worker is built for: the deploy's commit, A's rollback flag (§3.1), and the origins it may run on (1.9 N24:
 * the selected canonical origin alone in production, so the alias's /sw.js is the tombstone; both where none is selected).
 */
export function workerEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return { build: sha && /^[a-f0-9]{7,40}$/.test(sha) ? sha : "dev", enabled: env.PORTAL_OFFLINE_ENABLED !== "false", origins: workerOrigins(selectedCanonicalOrigin(env)) };
}
/** /sw.js: the policy as a frozen constant, then the worker body from src/offline/service-worker.js. */
export async function workerSource(input: { build: string; enabled: boolean; origins?: readonly string[] }, root = process.cwd()): Promise<string> {
  const body = await readFile(join(root, "src", "offline", "service-worker.js"), "utf8");
  const policy = workerPolicy({ ...input, shellPages: SHELL_PAGES });
  return `"use strict";\nconst POLICY = Object.freeze(${JSON.stringify(policy)});\n${body}`;
}
