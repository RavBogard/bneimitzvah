import { describe, expect, it, vi } from "vitest";
const driver = vi.hoisted(() => ({ constructs: 0, closes: 0, privateError: "synthetic private connection diagnostic" }));
vi.mock("server-only", () => ({}));
vi.mock("@neondatabase/serverless", () => ({ Pool: class {
  constructor() { driver.constructs++; }
  on() {}
  async connect() { throw new Error(driver.privateError); }
  async end() { driver.closes++; }
} }));
import { PgDialect } from "drizzle-orm/pg-core";
import { restrictedProbeInput, restrictedChildEnvironment, sanitizedProbeResult } from "../../scripts/provider-bootstrap/probe-neon-ws.mjs";
import { deniedInsert, neonRuntimeProbe, ProbeFailure, requirePhysicalCleanup } from "../../scripts/provider-bootstrap/neon-ws";

const syntheticUrl = new URL("postgresql://ep-synthetic.neon.tech/neondb?sslmode=require");
syntheticUrl.username = "portal_app";
syntheticUrl.password = "synthetic-password";
const url = syntheticUrl.href;
describe("private restricted probe input boundary", () => {
  it("accepts only the dedicated restricted-login key and the existing runtime URL contract", () => {
    expect(restrictedProbeInput(`PROVIDER_RUNTIME_DATABASE_URL="${url}"\n`)).toBe(url);
    for (const text of ["", `DATABASE_URL=${url}`, `DATABASE_MIGRATION_URL=${url}`, `PROVIDER_RUNTIME_DATABASE_URL=${url}\nDATABASE_MIGRATION_URL=synthetic`,
      `PROVIDER_RUNTIME_DATABASE_URL=${url.replace("portal_app", "neondb_owner")}`, `PROVIDER_RUNTIME_DATABASE_URL=${url.replace("portal_app", "other_owner")}`,
      `PROVIDER_RUNTIME_DATABASE_URL=${url}&channel_binding=require`, `PROVIDER_RUNTIME_DATABASE_URL=${url.replace("require", "disable")}`,
      `PROVIDER_RUNTIME_DATABASE_URL=${url.replace("neon.tech", "example.test")}`, `PROVIDER_RUNTIME_DATABASE_URL="${url}#synthetic"`, " ".repeat(16385)]) {
      expect(() => restrictedProbeInput(text)).toThrow("Provider probe failed (configuration); private details withheld");
    }
  });
  it("does not forward owner aliases, account secrets, hooks or the private file path into the child", () => {
    const result = restrictedChildEnvironment({ PATH: "synthetic-path", DATABASE_MIGRATION_URL: "synthetic-owner", "DATABASE_URL": "synthetic-owner",
      PGPASSWORD: "synthetic-owner", PGHOST: "synthetic-host", POSTGRES_URL: "synthetic-owner", "RESEND_API_KEY": "synthetic-mail",
      "GOOGLE_CLIENT_SECRET": "synthetic-google", "BETTER_AUTH_SECRET": "synthetic-auth", NODE_OPTIONS: "synthetic-hook", PROVIDER_PROBE_ENV_FILE: "synthetic-private-path" }, url);
    expect(Object.keys(result).sort()).toEqual(["NO_COLOR", "PATH", "PROVIDER_RUNTIME_DATABASE_URL", "PROVIDER_RUNTIME_PROBE_RUN"]);
    expect(result.PROVIDER_RUNTIME_DATABASE_URL).toBe(url);
  });
  it("retains only one closed status/phase record and discards all surrounding diagnostics", () => {
    expect(sanitizedProbeResult('synthetic private diagnostic\nPROVIDER_PROBE_RESULT:{"status":"failed","phase":"role"}\n')).toEqual({ status: "failed", phase: "role" });
    for (const text of ["synthetic private diagnostic", 'PROVIDER_PROBE_RESULT:{"status":"failed","phase":"private-secret"}',
      'PROVIDER_PROBE_RESULT:{"status":"passed","phase":"close","private":"synthetic"}',
      'PROVIDER_PROBE_RESULT:{"status":"passed","phase":"close"}\nPROVIDER_PROBE_RESULT:{"status":"passed","phase":"close"}']) expect(sanitizedProbeResult(text)).toEqual({ status: "failed", phase: "runner" });
  });
});

it("rejects invalid input before constructing a pool and sanitizes/cleans a driver failure", async () => {
  driver.constructs = 0; driver.closes = 0;
  await expect(neonRuntimeProbe("synthetic-private-invalid")).rejects.toMatchObject({ phase: "configuration" });
  expect(driver.constructs).toBe(0);
  let caught: unknown;
  try { await neonRuntimeProbe(url); } catch (error) { caught = error; }
  expect(caught instanceof ProbeFailure).toBe(true);
  expect((caught as ProbeFailure).message).toBe("Provider probe failed (connection); private details withheld");
  expect(Object.hasOwn(caught as object, "cause")).toBe(false);
  expect(driver.constructs).toBe(1); expect(driver.closes).toBe(1);
});

it("requires an actual RLS SQLSTATE and rolls back the denial savepoint after success or failure", async () => {
  const dialect = new PgDialect();
  for (const category of ["rls", "network", "unexpected-success"]) {
    const calls: string[] = [];
    const tx = { execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const text = dialect.sqlToQuery(query).sql; calls.push(text.split(" ")[0]);
      if (text.startsWith("insert") && category !== "unexpected-success") throw Object.assign(new Error("synthetic private row diagnostic"), { cause: { code: category === "rls" ? "42501" : "08006" } });
      return { rows: [] };
    } } as unknown as Parameters<typeof deniedInsert>[0];
    if (category === "rls") await deniedInsert(tx, "wrong-context");
    else await expect(deniedInsert(tx, "wrong-context")).rejects.toMatchObject({ phase: "wrong-context" });
    expect(calls).toEqual(["savepoint", "insert", "rollback", "release"]);
  }
});

it("cannot infer cleanup from identical outside samples when the transaction used another backend", () => {
  for (const phase of ["commit-cleanup", "rollback-cleanup"] as const) {
    expect(() => requirePhysicalCleanup({ pid: 41, clear: true }, 41, { pid: 41, clear: true }, phase)).not.toThrow();
    for (const [before, inside, after] of [
      [{ pid: 41, clear: true }, 42, { pid: 41, clear: true }],
      [{ pid: 41, clear: true }, 41, { pid: 42, clear: true }],
      [{ pid: 41, clear: false }, 41, { pid: 41, clear: true }],
      [{ pid: 41, clear: true }, 41, { pid: 41, clear: false }],
      [{ pid: 41, clear: true }, NaN, { pid: 41, clear: true }],
      [{ pid: 0, clear: true }, 0, { pid: 0, clear: true }],
    ] as const) expect(() => requirePhysicalCleanup(before, inside, after, phase)).toThrow(`Provider probe failed (${phase}); private details withheld`);
  }
});
