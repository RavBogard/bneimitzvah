import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { HttpRuntimeScope } from "../../src/server/http/dispatch";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";

vi.mock("server-only", () => ({}));

it("runs Next development without changing the production build or project tsconfig", async () => {
  assertBrowserStartupAllowed();
  const cwd = process.cwd();
  const tsconfig = join(cwd, "tsconfig.json"), buildId = join(cwd, ".next", "BUILD_ID");
  const beforeTsconfig = await readFile(tsconfig), beforeBuild = await readFile(buildId);
  const logs = join(cwd, ".local-logs");
  const beforeProjects = (await readdir(logs)).filter(name => name.startsWith("http-browser-project-"));
  const unusedRuntime: HttpRuntimeScope = async () => { throw new Error("Unexpected runtime access"); };
  const close = await startBrowserServer(unusedRuntime);
  try {
    const duringProjects = (await readdir(logs)).filter(name => name.startsWith("http-browser-project-"));
    const created = duringProjects.filter(name => !beforeProjects.includes(name));
    expect(created.length === 1 && (await stat(join(logs, created[0], ".next", "dev"))).isDirectory()).toBe(true);
    const response = await fetch(BROWSER_ORIGIN, { redirect: "error" });
    expect(response.status === 200).toBe(true);
    await response.body?.cancel();
  } finally { await close(); }
  const afterProjects = (await readdir(logs)).filter(name => name.startsWith("http-browser-project-"));
  expect(Buffer.compare(beforeTsconfig, await readFile(tsconfig)) === 0
    && Buffer.compare(beforeBuild, await readFile(buildId)) === 0
    && beforeProjects.join() === afterProjects.join()).toBe(true);
}, 120_000);
