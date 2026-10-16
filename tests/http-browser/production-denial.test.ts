import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";

const origin = "http://127.0.0.1:3188";
let child: ChildProcess | undefined;
let releaseHome: (() => Promise<void>) | undefined;

async function waitForStart() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error("Production denial server exited before readiness");
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1_000) })).status > 0) return; }
    catch { /* Fixed polling; no URL or provider diagnostic retained. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Production denial server did not become ready");
}

async function walk(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(?:js|mjs|json)$/.test(entry.name)) result.push(path);
  }
  return result;
}

afterAll(async () => {
  if (child) {
    child.kill();
    await new Promise<void>(resolve => { if (child?.exitCode !== null) resolve(); else child?.once("exit", () => resolve()); });
  }
  await releaseHome?.();
});

describe("actual built Next wrappers have no browser-test authority", () => {
  it("keeps test bootstrap out of the production server bundle", async () => {
    const files = await walk(join(process.cwd(), ".next", "server"));
    expect(files.length > 0).toBe(true);
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(!source.includes("tests/http-browser") && !source.includes("HTTP_BROWSER_TEST") && !source.includes("takeMail")).toBe(true);
    }
  });

  it("rejects test flags, identity headers and capture routes with no providers", async () => {
    const isolation = await isolatedEnv({ NODE_ENV: "production", HTTP_BROWSER_TEST: "1", NEXT_TELEMETRY_DISABLED: "1",
      PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "http-browser", BETTER_AUTH_URL: origin });
    releaseHome = isolation.cleanup;
    child = spawn(process.execPath, [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", "3188"],
      { cwd: process.cwd(), env: isolation.env, stdio: "ignore" });
    await waitForStart();
    for (const path of ["/api/test/capture", "/api/test/session", "/api/auth/test-identity", "/invitations/test-helper"]) {
      const response = await fetch(new URL(path, origin), { headers: { "x-test-user": "synthetic-admin", "x-test-mode": "student" }, redirect: "manual" });
      expect(response.status === 404).toBe(true);
      await response.body?.cancel();
    }
    for (const path of ["/api/session", "/api/students?mode=student"]) {
      const response = await fetch(new URL(path, origin), { headers: { "x-test-user": "synthetic-admin", "x-portal-auth-bucket": "synthetic", "x-test-mode": "student" }, redirect: "manual" });
      const body = await response.text();
      expect(response.status === 503 && response.headers.get("cache-control") === "private, no-store"
        && response.headers.get("referrer-policy") === "no-referrer" && body === '{"error":"unavailable"}').toBe(true);
    }
    const unknown = await fetch(new URL("/api/session/student", origin), { headers: { "x-test-user": "synthetic-admin" }, redirect: "manual" });
    expect(unknown.status === 404).toBe(true);
    await unknown.body?.cancel();
  }, 45_000);
});
