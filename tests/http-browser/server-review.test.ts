import { connect } from "node:net";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertBrowserStartupAllowed, BROWSER_PORT, startBrowserServer } from "./server";

it("review: denied deployment/startup environments never allocate a private project or enter runtime", async () => {
  const logs = join(process.cwd(), ".local-logs");
  const before = (await readdir(logs)).filter(name => name.startsWith("http-browser-project-")).sort();
  let runtimeEntries = 0;
  const allowed: Record<string, string | undefined> = { HTTP_BROWSER_TEST: "1", NODE_ENV: "test", VERCEL: undefined, VERCEL_ENV: undefined,
    CI_DEPLOYMENT: undefined, DEPLOYMENT_ID: undefined };
  try {
    for (const [key, value] of Object.entries(allowed)) vi.stubEnv(key, value);
    expect(() => assertBrowserStartupAllowed()).not.toThrow();
    for (const [key, value] of [["HTTP_BROWSER_TEST", undefined], ["NODE_ENV", "production"], ["VERCEL", "1"], ["VERCEL_ENV", "preview"],
      ["CI_DEPLOYMENT", "synthetic"], ["DEPLOYMENT_ID", "synthetic"]] as const) {
      vi.stubEnv(key, value);
      let denied = false;
      try { await startBrowserServer(async () => { runtimeEntries++; throw new Error("Unexpected review runtime"); }); }
      catch (error) { denied = error instanceof Error && error.message === "Isolated browser server startup denied" && !("cause" in error); }
      expect(denied).toBe(true);
      vi.stubEnv(key, allowed[key]);
    }
    expect(runtimeEntries).toBe(0);
    const after = (await readdir(logs)).filter(name => name.startsWith("http-browser-project-")).sort();
    expect(before.join() === after.join()).toBe(true);
  } finally { vi.unstubAllEnvs(); }
});

async function rawStatus(target: string, headers: string[]) {
  return new Promise<number>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: BROWSER_PORT });
    let prefix = "";
    const fail = () => { socket.destroy(); reject(new Error("Review raw HTTP exchange failed")); };
    socket.setTimeout(5000, fail);
    socket.once("error", fail);
    socket.on("data", chunk => { if (prefix.length < 4096) prefix += chunk.toString("ascii").slice(0, 4096 - prefix.length); });
    socket.once("connect", () => { socket.write(`GET ${target} HTTP/1.1\r\n${headers.join("\r\n")}\r\nConnection: close\r\n\r\n`); });
    socket.once("end", () => {
      socket.destroy();
      const match = /^HTTP\/1\.1 ([0-9]{3}) /.exec(prefix);
      if (!match) reject(new Error("Review raw HTTP status missing")); else resolve(Number(match[1]));
    });
  });
}

it("review: wrong raw Host, duplicate authority headers and ambiguous paths deny before runtime scope", async () => {
  let runtimeEntries = 0;
  const close = await startBrowserServer(async () => { runtimeEntries++; throw new Error("Review-only runtime unavailable"); });
  try {
    const host = `Host: 127.0.0.1:${BROWSER_PORT}`;
    expect(await rawStatus("/api/session", [host])).toBe(503);
    expect(runtimeEntries).toBe(1); // Positive control proves the socket reaches the real dispatcher.
    const invalid: [string, string[]][] = [
      ["/api/session", ["Host: foreign.example.test"]],
      ["/api/session", [host, host.toLowerCase()]],
      ["/api/session", [host, "Cookie: synthetic=a", "Cookie: synthetic=b"]],
      ["/api/session", [host, "Origin: http://127.0.0.1:3187", "Origin: http://foreign.example.test"]],
      ["/api/session", [host, "X-Practice-Context: synthetic-a", "x-practice-context: synthetic-b"]],
      ["/api/session", [host, "Content-Type: application/json", "Content-Type: text/plain"]],
      ["/api/session", [host, "Content-Length: 0", "Transfer-Encoding: chunked"]],
      ["http://foreign.example.test/api/session", [host]],
      ["//foreign.example.test/api/session", [host]],
      ["/api/%2e%2e/session", [host]],
      ["/api/session#synthetic", [host]],
    ];
    for (const [target, headers] of invalid) expect(await rawStatus(target, headers)).toBe(400);
    expect(runtimeEntries).toBe(1);
  } finally { await close(); }
}, 120_000);
