#!/usr/bin/env node
// Operator-only launcher. No owner input is forwarded to the restricted child.
import { readFile, lstat } from "node:fs/promises";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROBE_PHASES = Object.freeze(["configuration", "connection", "catalog", "role", "no-context", "empty-context", "crc-write", "wrong-context", "rollback-cleanup", "commit-cleanup", "parallel-context", "host", "close", "runner"]);
export function restrictedProbeInput(contents) {
  try {
    if (typeof contents !== "string" || Buffer.byteLength(contents) > 16384 || !contents.isWellFormed()) throw 0;
    const env = parseEnv(contents);
    if (Object.keys(env).length !== 1 || !Object.hasOwn(env, "PROVIDER_RUNTIME_DATABASE_URL")
      || [...contents.matchAll(/^\s*(?:export\s+)?PROVIDER_RUNTIME_DATABASE_URL\s*=/gm)].length !== 1) throw 0;
    const value = env.PROVIDER_RUNTIME_DATABASE_URL, url = new URL(value);
    if (value.trim() !== value || /[\s\u0000-\u001f\u007f]/u.test(value) || !["postgres:", "postgresql:"].includes(url.protocol)
      || decodeURIComponent(url.username) !== "portal_app" || !url.password || !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
      || !/^[a-zA-Z0-9.-]+\.neon\.tech$/.test(url.hostname) || url.hash || [...url.searchParams.keys()].some(key => key !== "sslmode")
      || url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.get("sslmode") !== "require") throw 0;
    return value;
  } catch { throw new Error("Provider probe failed (configuration); private details withheld"); }
}
export function restrictedChildEnvironment(ambient, databaseUrl) {
  const allowed = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"]);
  return { ...Object.fromEntries(Object.entries(ambient).filter(([key]) => allowed.has(key.toUpperCase()))),
    PROVIDER_RUNTIME_DATABASE_URL: databaseUrl, PROVIDER_RUNTIME_PROBE_RUN: "explicit-operator-run", NO_COLOR: "1" };
}
export function sanitizedProbeResult(output) {
  const matches = [...String(output).matchAll(/^PROVIDER_PROBE_RESULT:(\{"status":"(?:passed|failed)","phase":"[a-z-]+"\})\r?$/gm)];
  if (matches.length !== 1) return { status: "failed", phase: "runner" };
  const result = JSON.parse(matches[0][1]);
  return PROBE_PHASES.includes(result.phase) ? result : { status: "failed", phase: "runner" };
}
export async function runRestrictedProbe(argv, ambient = process.env) {
  let phase = "configuration";
  try {
    if (argv.length !== 3 || argv[0] !== "--env" || argv[2] !== "--run") throw 0;
    const file = resolve(argv[1]), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw 0;
    const databaseUrl = restrictedProbeInput(await readFile(file, "utf8"));
    const executable = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));
    const config = fileURLToPath(new URL("./vitest.operator.config.mts", import.meta.url));
    phase = "runner";
    const result = await new Promise((done) => {
      const child = spawn(process.execPath, [executable, "run", "--config", config], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)), env: restrictedChildEnvironment(ambient, databaseUrl),
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
      let output = "", length = 0, ended = false;
      const timer = setTimeout(() => child.kill(), 90000);
      const finish = value => { if (!ended) { ended = true; clearTimeout(timer); done(value); } };
      const collect = chunk => { length += chunk.length; if (length > 262144) { child.kill(); return; } output += chunk.toString(); };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      child.on("error", () => finish({ status: "failed", phase: "runner" }));
      child.on("close", code => { const safe = sanitizedProbeResult(output); finish(code === 0 || safe.status === "failed" ? safe : { status: "failed", phase: "runner" }); });
    });
    return result;
  } catch { return { status: "failed", phase }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runRestrictedProbe(process.argv.slice(2));
  console.log(`Provider WebSocket probe ${result.status} (${result.phase}); no private details emitted`);
  process.exitCode = result.status === "passed" ? 0 : 1;
}
