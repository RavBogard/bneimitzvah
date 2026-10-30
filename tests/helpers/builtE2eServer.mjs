import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { isolatedEnv } from "./isolatedEnv.mjs";

const DOTENV = [".env.production.local", ".env.local", ".env.production", ".env"];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function startBuiltE2eServer(projectRoot, port) {
  // Next loads these independently of process env. Inspect existence only;
  // never open operator configuration, including symlinks or directories.
  for (const filename of DOTENV) {
    try { await lstat(join(projectRoot, filename)); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw new Error("Production browser gate configuration check failed");
    }
    throw new Error("Production browser gate requires a clean checkout without dotenv files");
  }
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("Production browser gate port unavailable")));
    probe.listen({ host: "127.0.0.1", port, exclusive: true }, () => probe.close(resolve));
  });
  const isolation = await isolatedEnv({ NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CRC_COMPONENT_PAGE: "1",
    // The browser gate runs as CRC: its identity needs a positive signal, and this build is not a production deployment (PORTAL_ENVIRONMENT stays unset).
    BETTER_AUTH_URL: "https://beitmitzvah.centralreform.org" });
  let child;
  let closed = false;
  let failed = false;
  let close;
  const exited = new Promise(resolve => { close = resolve; });
  const awaitExit = async () => {
    let timer;
    try { await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 5_000); })]); }
    finally { clearTimeout(timer); }
  };
  const stop = async () => {
    if (!closed && child) {
      child.kill();
      await awaitExit();
      if (!closed) {
        child.kill("SIGKILL");
        await awaitExit();
      }
      if (!closed) throw new Error("Production browser gate process cleanup failed");
    }
    await isolation.cleanup();
  };
  try {
    child = spawn(process.execPath, [join(projectRoot, "node_modules", "next", "dist", "bin", "next"),
      "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: projectRoot, env: isolation.env, stdio: "ignore", windowsHide: true });
    child.once("error", () => { failed = true; });
    child.once("close", () => { closed = true; close(); });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (failed || closed) throw new Error("Production browser gate server failed to start");
      try {
        const response = await fetch(`http://127.0.0.1:${port}`, { redirect: "error", signal: AbortSignal.timeout(1_000) });
        await response.body?.cancel();
        if (response.status === 200 && !failed && !closed) return stop;
      } catch { /* Fixed polling: no framework or provider diagnostics retained. */ }
      await delay(100);
    }
    throw new Error("Production browser gate readiness timed out");
  } catch {
    await stop();
    throw new Error("Production browser gate server unavailable");
  }
}
