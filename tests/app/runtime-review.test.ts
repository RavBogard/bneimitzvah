import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
// Only the driver/startup boundary is replaced; this test exercises the real
// runtime error/log boundary without contacting a provider or reading secrets.
vi.mock("@neondatabase/serverless", () => ({ Pool: class { on() {} async end() {} } }));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => ({}) }));
vi.mock("../../src/server/db/runtime", () => ({ withTenantTransaction: async () => undefined }));
vi.mock("../../src/server/tenancy/resolve", () => ({ resolveTenantHost: async () => ({ tenantId: "crc", origin: "http://localhost:3000" }) }));
vi.mock("../../src/server/auth/factory", () => ({ createAuthStack: () => ({ api: {} }) }));
import { createRuntimeScope } from "../../src/server/runtime/composition";
import { AccessDenied } from "../../src/server/access/errors";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";

test("runtime preserves denial status without retaining callback-added private diagnostics", async () => {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login";
  database.password = randomBytes(32).toString("hex");
  database.searchParams.set("sslmode", "require");
  const env = { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "review", BETTER_AUTH_URL: "http://localhost:3000",
    "DATABASE_URL": database.href, "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"),
    "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "review@example.test" };
  const scope = createRuntimeScope(() => env);
  const privateMarker = "synthetic-private-review-diagnostic";
  const logs: string[] = [];
  const spy = vi.spyOn(console, "info").mockImplementation((line) => logs.push(String(line)));
  try {
    let caught: unknown;
    try {
      await scope(async () => {
        const error = new AccessDenied(403);
        error.message = privateMarker;
        error.name = privateMarker;
        error.stack = privateMarker;
        Object.assign(error, { cause: new Error(privateMarker), providerResponse: privateMarker });
        throw error;
      });
    } catch (error) { caught = error; }
    const denial = caught as Error & { status?: number };
    expect(denial instanceof AccessDenied && denial.status === 403).toBe(true);
    expect(denial.message === "Action not permitted").toBe(true);
    expect(denial.name === "AccessDenied").toBe(true);
    expect(!("cause" in denial) && !("providerResponse" in denial)).toBe(true);
    expect(!String(denial.stack).includes(privateMarker)).toBe(true);
    let malformed: unknown;
    try {
      await scope(async () => {
        const error = new AccessDenied(403);
        Object.assign(error, { status: 503, cause: new Error(privateMarker), providerResponse: privateMarker });
        throw error;
      });
    } catch (error) { malformed = error; }
    expect(malformed instanceof RuntimeUnavailable && malformed.message === "Service temporarily unavailable" && !("cause" in malformed)).toBe(true);
    expect(logs.length > 0 && logs.every((line) => !line.includes(privateMarker))).toBe(true);
  } finally { spy.mockRestore(); }
});
