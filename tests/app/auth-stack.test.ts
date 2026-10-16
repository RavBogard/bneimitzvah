import { createSign, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { generateDrizzleSchema } from "auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import * as schema from "../../src/server/db/auth-schema";
import { authFixture } from "./auth-stack-helper";

const fixtures: Awaited<ReturnType<typeof authFixture>>[] = [];
async function fixture() { const value = await authFixture(); fixtures.push(value); return value; }
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(fixtures.splice(0).map((value) => value.client.close())); });

// Only the remote Google JWKS boundary is replaced. Better Auth's public handler,
// Google provider, signature/issuer/audience verification, account linking and DB
// adapter are real. No library internal is mocked and no real network is allowed.
function googleTokens() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" };
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== "https://www.googleapis.com/oauth2/v3/certs") throw new Error("Unexpected network in offline auth test");
    return Response.json({ keys: [key] });
  });
  return (email: string, verified: boolean, overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: key.kid })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://accounts.google.com", aud: "synthetic-client", sub: `subject-${email}`,
      email, email_verified: verified, name: "Synthetic learner", iat: now, exp: now + 300, ...overrides,
    })).toString("base64url");
    const signingInput = `${header}.${payload}`;
    return `${signingInput}.${createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url")}`;
  };
}

describe("pinned Better Auth / Drizzle / PGlite compatibility", () => {
  it("generates the configured PostgreSQL auth schema using the pinned official generator", async () => {
    const { auth, db } = await fixture();
    // CLI's DBAdapter type is invariant in its option type; instantiate through
    // the adapter's public BetterAuthOptions interface rather than cast internals.
    const adapter = drizzleAdapter(db, { provider: "pg", schema, transaction: true })(auth.options);
    const generated = await generateDrizzleSchema({ adapter, options: auth.options });
    expect(/pgTable\(\s*"rate_limit"/.test(generated.code ?? "")).toBe(true);
    expect(/pgTable\(\s*"verification"/.test(generated.code ?? "")).toBe(true);
    expect((generated.schemaProblems?.length ?? 0) === 0).toBe(true);
  });

  it("hashes magic links, verifies the email, consumes once, and persists/revokes real sessions", async () => {
    const f = await fixture();
    await f.request("/sign-in/magic-link", { email: "learner@example.test", callbackURL: "/" });
    const message = f.delivered.at(-1)!;
    const verification = await f.db.select().from(schema.verification);
    expect(verification.length === 1 && !JSON.stringify(verification).includes(message.token)).toBe(true);
    const redemption = await f.auth.handler(new Request(message.url));
    expect(redemption.status === 302).toBe(true);
    const cookie = redemption.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const current = await f.auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(Boolean(current?.user.emailVerified)).toBe(true);
    expect((await f.db.select().from(schema.session)).length === 1).toBe(true);
    const replay = await f.auth.handler(new Request(message.url));
    expect(Boolean(replay.headers.get("location")?.includes("INVALID_TOKEN"))).toBe(true);
    const logout = await f.request("/sign-out", {}, cookie);
    expect(logout.status === 200).toBe(true);
    expect((await f.auth.api.getSession({ headers: new Headers({ cookie }) })) === null).toBe(true);
  });

  it("rejects expired magic links and concurrent replay with at most one session", async () => {
    const f = await fixture();
    await f.request("/sign-in/magic-link", { email: "expired@example.test" });
    const expired = f.delivered.at(-1)!;
    await f.db.update(schema.verification).set({ expiresAt: new Date(Date.now() - 1_000) });
    const response = await f.auth.handler(new Request(expired.url));
    expect(Boolean(response.headers.get("location")?.includes("error="))).toBe(true);
    await f.request("/sign-in/magic-link", { email: "racing@example.test" });
    const racing = f.delivered.at(-1)!;
    const responses = await Promise.all([1, 2].map(() => f.auth.handler(new Request(racing.url))));
    expect(responses.filter((value) => !value.headers.get("location")?.includes("error=")).length === 1).toBe(true);
    expect((await f.db.select().from(schema.session)).length === 1).toBe(true);
  });

  it("links verified same-email Google after magic link without creating a second user", async () => {
    const f = await fixture();
    const token = googleTokens();
    await f.signIn("same@example.test");
    const response = await f.request("/sign-in/social", { provider: "google", idToken: { token: token("same@example.test", true) } });
    expect(response.status === 200).toBe(true);
    expect((await f.db.select().from(schema.user)).length === 1).toBe(true);
    expect((await f.db.select().from(schema.account)).length === 1).toBe(true);
  });

  it("keeps one verified user when Google precedes magic link", async () => {
    const f = await fixture();
    const token = googleTokens();
    const response = await f.request("/sign-in/social", { provider: "google", idToken: { token: token("google-first@example.test", true) } });
    expect(response.status === 200).toBe(true);
    const signedIn = await f.signIn("google-first@example.test");
    expect(signedIn.response.status === 302).toBe(true);
    expect((await f.db.select().from(schema.user)).length === 1).toBe(true);
    expect((await f.db.select().from(schema.user))[0].emailVerified).toBe(true);
  });

  it("denies unverified Google linking and wrong audience/issuer tokens", async () => {
    const f = await fixture();
    const token = googleTokens();
    await f.signIn("protected@example.test");
    for (const candidate of [
      token("protected@example.test", false),
      token("protected@example.test", true, { aud: "wrong-client" }),
      token("protected@example.test", true, { iss: "https://invalid.example.test" }),
    ]) {
      const response = await f.request("/sign-in/social", { provider: "google", idToken: { token: candidate } });
      expect(response.status >= 400).toBe(true);
    }
    expect((await f.db.select().from(schema.account)).length === 0).toBe(true);
  });

  it("enforces database-backed rate limits through the public HTTP handler", async () => {
    const f = await fixture();
    const responses = [];
    for (let index = 0; index < 6; index++) responses.push(await f.request("/sign-in/magic-link", { email: `limited-${index}@example.test` }));
    expect(responses.at(-1)?.status === 429).toBe(true);
    expect((await f.db.select().from(schema.rateLimit)).length > 0).toBe(true);
    expect(f.delivered.length === 5).toBe(true);
  });

  it("enforces freshAge on the real session endpoint and disables identity email changes/passwords", async () => {
    const f = await fixture();
    const { cookie } = await f.signIn("fresh@example.test");
    expect((await f.request("/list-sessions", undefined, cookie)).status === 200).toBe(true);
    await f.db.update(schema.session).set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) });
    expect((await f.request("/list-sessions", undefined, cookie)).status === 403).toBe(true);
    expect((await f.request("/change-email", { newEmail: "other@example.test" }, cookie)).status >= 400).toBe(true);
    expect((await f.request("/sign-up/email", { email: "password@example.test", password: "synthetic-value", name: "Synthetic" })).status >= 400).toBe(true);
  });

  it("runs awaited interactive transactions and rolls back adapter transactions", async () => {
    const f = await fixture();
    await f.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', 'crc', true)`);
      const result = await tx.execute<{ value: string }>(sql`select current_setting('app.tenant_id', true) as value`);
      expect(result.rows[0].value === "crc").toBe(true);
    });
    const context = await f.auth.$context;
    await expect(context.adapter.transaction(async (adapter) => {
      await adapter.create({ model: "user", data: { name: "Synthetic", email: "rollback@example.test", emailVerified: true, createdAt: new Date(), updatedAt: new Date() } });
      throw new Error("Synthetic rollback");
    })).rejects.toThrow("Synthetic rollback");
    expect((await f.db.select().from(schema.user).where(eq(schema.user.email, "rollback@example.test"))).length === 0).toBe(true);
  });
});
