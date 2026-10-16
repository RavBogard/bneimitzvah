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
import { randomBytes } from "node:crypto";

test("request-scoped composition validates roles/mapping before use, sanitizes pool errors and always closes its own pool", async () => {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line) => logs.push(String(line)));
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
  const config = { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(32).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
  const scope = createRuntimeScope(() => config);
  let callbacks = 0;
  const action = async () => { callbacks++; state.event?.(new Error("synthetic-private-pool-error", { cause: { cookie: "synthetic-private-cookie" } })); return true; };
  const failsSafe = async () => {
    try { await scope(action); return false; }
    catch (error) { return error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable" && !("cause" in error); }
  };
  try {
    expect(state.pools).toBe(0);
    state.failedRole = true;
    expect(await failsSafe()).toBe(true);
    expect(state.hostChecks).toBe(0);
    state.failedRole = false; state.failedHost = true;
    expect(await failsSafe()).toBe(true);
    expect(callbacks).toBe(0);
    state.failedHost = false;
    expect(await scope(action)).toBe(true);
    expect(callbacks).toBe(1);
    let callbackSafe = false;
    try { await scope(async () => { throw new Error("synthetic-private-callback-error"); }); }
    catch (error) { callbackSafe = error instanceof RuntimeUnavailable && !("cause" in error); }
    expect(callbackSafe).toBe(true);
    for (const status of [401, 403, 404] as const) {
      let denied = false;
      try { await scope(async () => { throw new AccessDenied(status); }); }
      catch (error) { denied = error instanceof AccessDenied && error.status === status; }
      expect(denied).toBe(true);
      expect(JSON.parse(logs.at(-1)!).event).toBe("request.complete");
      expect(JSON.parse(logs.at(-1)!).status).toBe(status);
    }
    for (const status of [503, "403", undefined, NaN, { private: "synthetic-private-status" }]) {
      let safe = false;
      try {
        await scope(async () => {
          const denial = new AccessDenied(403);
          Object.assign(denial, { status, message: "synthetic-private-diagnostic", cause: new Error("synthetic-private-cause") });
          throw denial;
        });
      } catch (error) { safe = error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable" && !("cause" in error); }
      expect(safe).toBe(true);
      expect(JSON.parse(logs.at(-1)!).event).toBe("runtime.unavailable");
      expect(JSON.parse(logs.at(-1)!).status).toBe(503);
    }
    let accessorSafe = false;
    try {
      await scope(async () => {
        const denial = new AccessDenied(403);
        Object.defineProperty(denial, "status", { get() { throw new Error("synthetic-private-accessor"); } });
        throw denial;
      });
    } catch (error) { accessorSafe = error instanceof RuntimeUnavailable && !("cause" in error); }
    expect(accessorSafe).toBe(true);
    state.failedClose = true;
    expect(await scope(async () => true)).toBe(true);
    expect(state.closed).toBe(state.pools);
    expect(state.roleChecks).toBe(state.pools);
    expect(Number(state.options.connectionTimeoutMillis)).toBeGreaterThan(0);
    expect(Number(state.options.statement_timeout)).toBeGreaterThan(0);
    expect(Number(state.options.query_timeout)).toBeGreaterThan(0);
    expect(logs.length > 0).toBe(true);
    expect(logs.every((line) => !line.includes("synthetic-private") && !line.includes("postgresql") && !line.includes(config.BETTER_AUTH_SECRET))).toBe(true);
    expect(logs.every((line) => Object.keys(JSON.parse(line)).sort().join(",") === "event,requestId,status")).toBe(true);
  } finally { spy.mockRestore(); }
});
