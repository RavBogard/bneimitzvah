import { randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import * as schema from "../../src/server/db/index";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { RuntimeUnavailable } from "../../src/server/runtime/errors";
import { composeRuntime, createRuntimeScope } from "../../src/server/runtime/composition";
import { createPersistentReadingCache } from "../../src/server/data/reading-cache";
import { createHebcalReader, hebcalRequest, ReadingUnavailable } from "../../src/lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";

const env = () => {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login";
  database.password = randomBytes(24).toString("hex");
  database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-runtime", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
};
const clients: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map((f) => f.client.close())); });
async function safeUnavailable(action: () => unknown | Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof RuntimeUnavailable && error.message === "Service temporarily unavailable" && !("cause" in error); }
}
async function cacheDenied(action: () => Promise<unknown>) {
  try { await action(); return false; } catch (error) { return error instanceof ReadingUnavailable && error.code === "cache" && !("cause" in error); }
}

test("private configuration rejects aliases, environment contradictions, operator credentials and incomplete secrets without leaking inputs", async () => {
  const base = env();
  const invalid = [
    { BETTER_AUTH_URL: "https://bneimitzvah-random.vercel.app", PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production" },
    { BETTER_AUTH_URL: "http://localhost:3000", PORTAL_ENVIRONMENT: "production" },
    { NODE_ENV: "production" }, { VERCEL: "1" }, { VERCEL_ENV: "production" },
    { PORTAL_ENVIRONMENT: "test" }, { PORTAL_DEPLOYMENT: "" }, { BETTER_AUTH_URL: "http://localhost:3000/" },
    { BETTER_AUTH_URL: "http://user@localhost:3000" }, { BETTER_AUTH_URL: "http://localhost:3000/path" },
    { "BETTER_AUTH_SECRET": "short" }, { GOOGLE_CLIENT_ID: "partial" }, { "GOOGLE_CLIENT_SECRET": "partial" },
    { DATABASE_MIGRATION_URL: base.DATABASE_URL }, { BOOTSTRAP_OWNER_EMAIL: "synthetic@example.test" },
    { "DATABASE_URL": base.DATABASE_URL.replace("synthetic_login", "neondb_owner") },
    { "DATABASE_URL": base.DATABASE_URL + "&options=-crole%3Downer" },
    { "DATABASE_URL": base.DATABASE_URL + "&channel_binding=require" },
    { "DATABASE_URL": base.DATABASE_URL.replace("sslmode=require", "sslmode=disable") },
    { "RESEND_API_KEY": "" }, { RESEND_FROM: "Synthetic <synthetic@example.test>" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "https://bneimitzvah.centralreform.org" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "https://bneimitzvah.vercel.app" },
    { PORTAL_ENVIRONMENT: "preview", BETTER_AUTH_URL: "http://preview.example.test" },
  ];
  for (const change of invalid) expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, ...change }))).toBe(true);
  const production = loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL_ENV: "production", NODE_ENV: "production", BETTER_AUTH_URL: "https://bneimitzvah.centralreform.org" });
  expect(production.deployment).toEqual({ environment: "production", deployment: "production" });
  const preview = loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "preview", VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://one-exact-preview.example.test" });
  expect(preview.origin).toBe("https://one-exact-preview.example.test");
  expect(Object.isFrozen(preview)).toBe(true);
});

test("production selects exactly one configured CRC origin and rejects sibling aliases or preview reuse", async () => {
  const base = { ...env(), PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", VERCEL_ENV: "production", NODE_ENV: "production" };
  for (const origin of ["https://beitmitzvah.centralreform.org", "https://bneimitzvah.centralreform.org", "https://bneimitzvah.vercel.app"]) {
    expect(loadRuntimeConfig({ ...base, BETTER_AUTH_URL: origin }).origin === origin).toBe(true);
    expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, PORTAL_ENVIRONMENT: "preview", VERCEL_ENV: "preview", BETTER_AUTH_URL: origin }))).toBe(true);
  }
  for (const origin of ["https://barmitzvah.centralreform.org", "https://batmitzvah.centralreform.org", "https://bnaimitzvah.centralreform.org", "https://bneimitzvah-random.vercel.app", "https://sub.bneimitzvah.vercel.app", "https://bneimitzvah.vercel.app.evil.invalid",
    "https://bneimitzvah.vercel.app:443", "https://bneimitzvah.vercel.app/", "https://bneimitzvah.vercel.app/path", "http://bneimitzvah.vercel.app"]) {
    expect(await safeUnavailable(() => loadRuntimeConfig({ ...base, BETTER_AUTH_URL: origin }))).toBe(true);
  }
});

test("adding canonical directory data never creates an auth-origin union and switching back restores exact stable selection", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const origins = ["https://beitmitzvah.centralreform.org", "https://bneimitzvah.vercel.app", "https://bneimitzvah.centralreform.org"];
  for (const selected of [origins[1], origins[0], origins[1]]) {
    const config = loadRuntimeConfig({ ...env(), PORTAL_ENVIRONMENT: "production", PORTAL_DEPLOYMENT: "production", BETTER_AUTH_URL: selected });
    const runtime = composeRuntime(config, db, async () => { throw new Error("No external requests permitted"); });
    expect(runtime.auth.options.trustedOrigins).toEqual([selected]);
    expect(runtime.auth.options.baseURL).toBe(selected);
    expect((await runtime.resolveHost({ url: selected, headers: new Headers({ host: new URL(selected).host }) })).origin).toBe(selected);
    for (const other of origins.filter(origin => origin !== selected)) {
      expect(await safeUnavailable(() => runtime.resolveHost({ url: other, headers: new Headers({ host: new URL(other).host }) }))).toBe(true);
    }
  }
});

test("runtime scope remains lazy and missing configuration fails closed before callback/network", async () => {
  let reads = 0, calls = 0;
  const scope = createRuntimeScope(() => { reads++; return {}; });
  expect(reads).toBe(0);
  const spy = vi.spyOn(console, "info").mockImplementation(() => {});
  try { expect(await safeUnavailable(() => scope(async () => { calls++; }))).toBe(true); }
  finally { spy.mockRestore(); }
  expect(reads).toBe(1);
  expect(calls).toBe(0);
});

test("composed real auth stack sends only synthetic mail to injected transport and exact deployment host mapping remains authoritative", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const config = loadRuntimeConfig(env());
  await db.insert(schema.tenantHost).values({ host: "localhost:3000", origin: config.origin, tenantId: "crc", environment: "local", deployment: config.deployment.deployment });
  let mailCalls = 0;
  const runtime = composeRuntime(config, db, async (url, options) => {
    if (String(url) !== "https://api.resend.com/emails") throw new Error("Unexpected test provider");
    const payload = JSON.parse(String(options?.body));
    if (typeof payload.text !== "string" || !payload.text.includes("/auth/email#token=")) throw new Error("Invalid synthetic message");
    mailCalls++;
    return new Response("{}", { status: 200 });
  });
  expect((await runtime.resolveHost({ url: config.origin, headers: new Headers() })).tenantId).toBe("crc");
  await runtime.auth.api.signInMagicLink({ body: { email: "runtime-recipient@example.test", callbackURL: "/" }, headers: new Headers({ origin: config.origin }) });
  expect(mailCalls).toBe(1);
  expect(typeof runtime.invitations.issue).toBe("function");
  expect(typeof runtime.students.prepareReading).toBe("function");
  expect(typeof runtime.practice.enter).toBe("function");
  const mismatched = composeRuntime({ ...config, deployment: { environment: "local", deployment: "foreign" } }, db, async () => { throw 0; });
  let denied = false;
  try { await mismatched.resolveHost({ url: config.origin, headers: new Headers() }); } catch { denied = true; }
  expect(denied).toBe(true);
});

test("persistent nonpersonal reading cache round-trips normalized metadata and rejects transplanted binding, invalid ranges and hidden personal fields", async () => {
  const f = await authFixture(); clients.push(f);
  const db = drizzle(f.client, { schema });
  const cache = createPersistentReadingCache(db);
  const time = Date.now();
  const request = hebcalRequest("2027-01-02");
  let calls = 0;
  const read = createHebcalReader({ cache, verseCounts: TANAKH_VERSE_COUNTS, now: () => time, fetch: async () => {
    calls++; return new Response(JSON.stringify({ items: [{ date: request.date, name: { en: "Synthetic" }, fullkriyah: { "1": { k: "Genesis", b: "1:31", e: "2:2", v: 3 } } }] }), { headers: { "content-type": "application/json" } });
  } });
  expect((await read(request.date)).source).toBe("upstream");
  expect((await read(request.date)).source).toBe("cache");
  expect(calls).toBe(1);
  const entry = (await cache.get(request.cacheKey))!;
  const clone = () => JSON.parse(JSON.stringify(entry));
  for (const payload of [
    { binding: { version: 1, date: request.date, calendar: "israel" }, items: [] },
    { binding: { version: 1, date: "2027-01-03", calendar: "diaspora" }, items: [] },
    { ...(entry.payload as object), email: "synthetic@example.test" },
    { binding: { version: 1, date: request.date, calendar: "diaspora" }, items: [{ date: request.date, name: { en: "Synthetic" }, type: "shabbat", fullkriyah: { "1": { k: "Genesis", b: "1:31", e: "2:9999" } } }] },
  ]) expect(await cacheDenied(() => cache.set(request.cacheKey, { ...clone(), payload }))).toBe(true);
  expect(await cacheDenied(() => cache.set("personal:synthetic@example.test", entry))).toBe(true);
  await db.update(schema.hebcalCache).set({ parameters: { calendar: "israel" } }).where(eq(schema.hebcalCache.requestKey, request.cacheKey));
  expect(await cacheDenied(() => cache.get(request.cacheKey))).toBe(true);
  await db.update(schema.hebcalCache).set({ parameters: { calendar: "diaspora" }, payload: { binding: { version: 1, date: "2027-01-03", calendar: "diaspora" }, items: [] } }).where(eq(schema.hebcalCache.requestKey, request.cacheKey));
  expect(await cacheDenied(() => cache.get(request.cacheKey))).toBe(true);
});
