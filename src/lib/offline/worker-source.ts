import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { workerPolicy } from "./policy";
import { SHELL_PAGES } from "./shell";

/** The environment the worker is built for: the deploy's commit, and A's rollback flag (§3.1). */
export function workerEnvironment(env: Readonly<Record<string, string | undefined>>) {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return { build: sha && /^[a-f0-9]{7,40}$/.test(sha) ? sha : "dev", enabled: env.PORTAL_OFFLINE_ENABLED !== "false" };
}
/** /sw.js: the policy as a frozen constant, then the worker body from src/offline/service-worker.js. */
export async function workerSource(input: { build: string; enabled: boolean }, root = process.cwd()): Promise<string> {
  const body = await readFile(join(root, "src", "offline", "service-worker.js"), "utf8");
  const policy = workerPolicy({ ...input, shellPages: SHELL_PAGES });
  return `"use strict";\nconst POLICY = Object.freeze(${JSON.stringify(policy)});\n${body}`;
}
