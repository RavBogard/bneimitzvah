import { randomBytes } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { authFixture } from "./auth-stack-helper";
import * as schema from "../../src/server/db/index";
import { builtServices, composeRuntime, sharedSefariaReaders, type HttpRuntime } from "../../src/server/runtime/composition";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { createHttpDispatcher } from "../../src/server/http/dispatch";

/**
 * The composition builds a service only when a handler first asks for it in a request (2026-11-17). A simple signed-in
 * read builds a handful, and the next request builds its own: no request-scoped instance outlives its request.
 */
test("a signed-in read builds only what it uses, and a second request reuses no request-scoped service", async () => {
  const f = await authFixture();
  try {
    let queries = 0, counting = false;
    const db = drizzle(f.client, { schema, logger: { logQuery: () => { if (counting) queries++; } } });
    const origin = "http://localhost:3000";
    const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic"); database.username = "synthetic_login"; database.password = randomBytes(32).toString("hex"); database.searchParams.set("sslmode", "require");
    const config = loadRuntimeConfig({ PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "lazy-services", BETTER_AUTH_URL: origin, "DATABASE_URL": database.href,
      "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" });
    await db.insert(schema.tenantHost).values({ host: "localhost:3000", origin, tenantId: "crc", environment: "local", deployment: "lazy-services" });
    await f.client.exec("CREATE ROLE lazy_login LOGIN; GRANT portal_runtime TO lazy_login; SET SESSION AUTHORIZATION lazy_login; SET ROLE portal_runtime");
    const links: string[] = [];
    const fetcher = (async (_: unknown, options?: RequestInit) => {
      links.push(String(JSON.parse(String(options?.body)).text).match(/https?:\/\/\S+/)![0]);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    // The production scope without its Neon pool: the role audit, a fresh composition, the configured host, then the action.
    const runtimes: HttpRuntime[] = [];
    const dispatch = createHttpDispatcher(async action => {
      await withTenantTransaction(db, { tenantId: "crc" }, async () => undefined);
      const runtime = composeRuntime(config, db, fetcher);
      runtimes.push(runtime);
      await runtime.resolveHost({ url: config.origin, headers: new Headers() }, "configured");
      return action(runtime);
    });
    const post = (path: string, body: unknown) => new Request(origin + path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await dispatch(post("/api/auth/sign-in/magic-link", { email: "lazy-services@example.test" }))).status).toBe(200);
    const confirmed = await dispatch(post("/api/auth/email/confirm", { token: new URLSearchParams(new URL(links[0]).hash.slice(1)).get("token") }));
    expect(confirmed.status).toBe(200);
    const cookie = confirmed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");

    runtimes.length = 0; counting = true;
    expect((await dispatch(new Request(`${origin}/api/session`, { headers: { cookie } }))).status).toBe(200);
    counting = false;
    const [first] = runtimes, built = builtServices(first);
    expect(built).toContain("access");
    expect(built).toContain("portal");
    expect(built.length).toBeLessThanOrEqual(8);
    for (const unused of ["mcp", "students", "accounts", "studyGuides", "invitations", "serviceEcosystem", "loadText"]) expect(built).not.toContain(unused);
    // The measured cost of this read: two role audits, one host lookup (was three), the session and identity reads. A regression shows here.
    expect(queries).toBeLessThanOrEqual(11);

    expect((await dispatch(new Request(`${origin}/api/session`, { headers: { cookie } }))).status).toBe(200);
    const second = runtimes[1], builtSecond = builtServices(second);
    expect(builtSecond).toEqual(built);
    expect(second === first).toBe(false);
    for (const name of built as readonly ("auth" | "access" | "practice" | "portal" | "saved" | "progress")[]) expect(second[name] === first[name], name).toBe(false);
    // Within one request, a service is built once.
    expect(first.access === first.access).toBe(true);
    // The pure Sefaria readers are the only ones kept for the server instance.
    expect(sharedSefariaReaders(fetcher)).toBe(sharedSefariaReaders(fetcher));
  } finally { await f.client.close(); }
});
