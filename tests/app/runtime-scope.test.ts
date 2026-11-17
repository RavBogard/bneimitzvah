import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ pools: 0, closed: 0, failedRole: false, failedHost: false, failedClose: false, roleChecks: 0, hostChecks: 0,
  options: {} as Record<string, unknown>, event: undefined as undefined | ((error: unknown) => void) }));
vi.mock("@neondatabase/serverless", () => ({ Pool: class {
  constructor(options: Record<string, unknown>) { state.pools++; state.options = options; }
  on(event: string, handler: (error: unknown) => void) { if (event === "error") state.event = handler; }
  async end() { state.closed++; if (state.failedClose) throw new Error("synthetic-private-close-error"); }
} }));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => ({}) }));
vi.mock("../../src/server/db/runtime", () => ({ withTenantTransaction: async () => {
  state.roleChecks++;
  if (state.failedRole) throw new Error("synthetic-private-role-error");
} }));
vi.mock("../../src/server/tenancy/resolve", () => ({ resolveTenantHost: async () => {
  state.hostChecks++;
  if (state.failedHost) throw new Error("synthetic-private-directory-error");
  return { tenantId: "crc", origin: "http://localhost:3000" };
} }));
vi.mock("../../src/server/auth/factory", () => ({ createAuthStack: () => ({ api: {} }) }));
import { createRuntimeScope } from "../../src/server/runtime/composition";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { AccessDenied } from "../../src/server/access/errors";
import { errorResponse } from "../../src/server/http/responses";
import { setFailureSinkForTests } from "../../src/server/logging/failure";
import { randomBytes } from "node:crypto";

// Contract since 2026-11-17 ("Useful error logs"): an unexpected failure is written once as a server.failure line that
// names the site, the error class, its message (scrubbed) and stack; the client still gets only the fixed 503. The old
// assertion that no line carried any message is replaced by the assertions below on what must be present and what
// must never be: the database URL, its password, the auth secret, the mail key or a cookie.
test("request-scoped composition validates roles/mapping before use, logs unexpected failures once without secrets, and always closes its own pool", async () => {
  const logs: string[] = [], failures: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line) => logs.push(String(line)));
  const restore = setFailureSinkForTests(line => failures.push(line));
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
  const config = { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(32).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
  const scope = createRuntimeScope(() => config);
  let callbacks = 0;
  const action = async () => { callbacks++; state.event?.(new Error("synthetic-private-pool-error", { cause: { cookie: "synthetic-private-cookie" } })); return true; };
  // The thrown error the dispatcher sees: the fixed class and message, its cause non-enumerable, and the fixed 503.
  const fixed = async (error: unknown) => error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable"
    && !Object.keys(error).includes("cause") && errorResponse(error).status === 503 && await errorResponse(error).text() === JSON.stringify({ error: "unavailable" });
  const failsSafe = async () => {
    try { await scope(action); return false; }
    catch (error) { return fixed(error); }
  };
  const lastFailure = () => JSON.parse(failures.at(-1)!);
  try {
    expect(state.pools).toBe(0);
    state.failedRole = true;
    expect(await failsSafe()).toBe(true);
    expect(lastFailure()).toMatchObject({ event: "server.failure", site: "runtime/scope", status: 503, error: { name: "Error", message: "synthetic-private-role-error" } });
    expect(lastFailure().error.stack.length).toBeGreaterThan(0);
    expect(state.hostChecks).toBe(0);
    state.failedRole = false; state.failedHost = true;
    expect(await failsSafe()).toBe(true);
    expect(lastFailure().error.message).toBe("synthetic-private-directory-error");
    expect(callbacks).toBe(0);
    state.failedHost = false;
    const before = failures.length;
    expect(await scope(action)).toBe(true);
    expect(callbacks).toBe(1);
    // The pool error is written by class and message; its plain-object cause (with a cookie) is never serialized.
    expect(failures.length).toBe(before + 1);
    expect(lastFailure()).toMatchObject({ site: "runtime/pool-error", error: { message: "synthetic-private-pool-error", cause: { name: "non-error object" } } });
    let callbackSafe = false;
    try { await scope(async () => { throw new Error("synthetic-private-callback-error"); }); }
    catch (error) { callbackSafe = await fixed(error); }
    expect(callbackSafe).toBe(true);
    for (const status of [401, 403, 404] as const) {
      const count = failures.length;
      let denied = false;
      try { await scope(async () => { throw new AccessDenied(status); }); }
      catch (error) { denied = error instanceof AccessDenied && error.status === status; }
      expect(denied).toBe(true);
      expect(JSON.parse(logs.at(-1)!).event).toBe("request.complete");
      expect(JSON.parse(logs.at(-1)!).status).toBe(status);
      // An expected denial is not a failure.
      expect(failures.length).toBe(count);
    }
    for (const status of [503, "403", undefined, NaN, { private: "synthetic-private-status" }]) {
      let safe = false;
      try {
        await scope(async () => {
          const denial = new AccessDenied(403);
          Object.assign(denial, { status, message: "synthetic-private-diagnostic", cause: new Error("synthetic-private-cause") });
          throw denial;
        });
      } catch (error) { safe = await fixed(error); }
      expect(safe).toBe(true);
      expect(lastFailure()).toMatchObject({ site: "runtime/scope", status: 503, error: { name: "AccessDenied", cause: { name: "Error" } } });
      // A non-identifier status is never written.
      expect(failures.at(-1)).not.toContain("synthetic-private-status");
    }
    let accessorSafe = false;
    try {
      await scope(async () => {
        const denial = new AccessDenied(403);
        Object.defineProperty(denial, "status", { get() { throw new Error("synthetic-private-accessor"); } });
        throw denial;
      });
    } catch (error) { accessorSafe = await fixed(error); }
    expect(accessorSafe).toBe(true);
    state.failedClose = true;
    expect(await scope(async () => true)).toBe(true);
    expect(lastFailure()).toMatchObject({ site: "runtime/pool-close", error: { message: "synthetic-private-close-error" } });
    expect(state.closed).toBe(state.pools);
    expect(state.roleChecks).toBe(state.pools);
    expect(Number(state.options.connectionTimeoutMillis)).toBeGreaterThan(0);
    expect(Number(state.options.statement_timeout)).toBeGreaterThan(0);
    expect(Number(state.options.query_timeout)).toBeGreaterThan(0);
    expect(logs.length > 0).toBe(true);
    // The fixed-shape lines keep their closed shape and say nothing about an error.
    expect(logs.every((line) => !line.includes("synthetic-private") && !line.includes("postgresql") && !line.includes(config.BETTER_AUTH_SECRET))).toBe(true);
    expect(logs.every((line) => Object.keys(JSON.parse(line)).sort().join(",") === "event,requestId,status")).toBe(true);
    // Failure lines: never the database URL or its password, the auth secret, the mail key or the cookie.
    for (const line of failures) {
      for (const secret of [database.password, database.href, "synthetic_login", config.BETTER_AUTH_SECRET, config.RESEND_API_KEY, "synthetic-private-cookie", "synthetic-private-cause-cookie"])
        expect(line.includes(secret)).toBe(false);
      expect(Object.keys(JSON.parse(line)).sort().join(",")).toMatch(/^error,event,level,method,requestId,route,site(?:,status)?$/);
    }
  } finally { spy.mockRestore(); restore(); }
});
