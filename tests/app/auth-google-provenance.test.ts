import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { eq } from "drizzle-orm";
import { authFixture } from "./auth-stack-helper";
import { session } from "../../src/server/db/auth-schema";

const opened: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(f => f.client.close())); });
async function fixture() {
  const f = await authFixture(); opened.push(f);
  // Expected failed INSERTs must not print driver SQL/parameters through the
  // SDK's separate error renderer. Assertions below still require real failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Only the configured remote provider verification/profile boundary is
  // stubbed. SDK control flow, hooks, Drizzle INSERTs and constraints are real.
  vi.stubGlobal("fetch", async () => { throw new Error("Unexpected network in synthetic provenance test"); });
  const now = Math.floor(Date.now() / 1000);
  const auth = betterAuth({ ...f.auth.options, socialProviders: { google: {
    clientId: "synthetic-client", clientSecret: randomBytes(32).toString("base64url"),
    verifyIdToken: async token => token === "synthetic-accepted-google",
    getUserInfo: async () => ({
      user: { name: "Synthetic Provenance", email: "provenance@example.test", emailVerified: true },
      data: { sub: "synthetic-provenance-subject", name: "Synthetic Provenance", email: "provenance@example.test", email_verified: true,
        iss: "https://accounts.google.com", aud: "synthetic-client", azp: "synthetic-client", exp: now + 300, iat: now,
        family_name: "Provenance", given_name: "Synthetic", picture: "" },
    }),
  } } });
  async function google(accepted = true, extra: Record<string, unknown> = {}) {
    return auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: accepted ? "synthetic-accepted-google" : "synthetic-rejected-google" }, ...extra }),
    }));
  }
  return { ...f, auth, google };
}
async function constraint(action: () => PromiseLike<unknown>) {
  try { await action(); return false; } catch (error) { const e = error as { code?: string; cause?: { code?: string } }; return (e.cause?.code ?? e.code) === "23514"; }
}

describe("immutable private Google session provenance", () => {
  it("inserts the marker in the original verified-flow session INSERT and keeps it out of SDK output", async () => {
    const f = await fixture();
    await f.client.exec(`CREATE TEMP TABLE synthetic_insert_audit (marker timestamp);
      CREATE FUNCTION synthetic_session_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        INSERT INTO synthetic_insert_audit VALUES (NEW.google_authenticated_at); RETURN NEW; END $$;
      CREATE TRIGGER synthetic_session_audit AFTER INSERT ON session FOR EACH ROW EXECUTE FUNCTION synthetic_session_audit()`);
    const before = Date.now(), response = await f.google();
    expect(response.status === 200).toBe(true);
    const stored = await f.db.select().from(session);
    expect(stored.length === 1 && stored[0].googleAuthenticatedAt instanceof Date).toBe(true);
    expect(stored[0].googleAuthenticatedAt!.getTime() >= before && stored[0].googleAuthenticatedAt!.getTime() <= Date.now()).toBe(true);
    const audited = await f.client.query<{ marker: Date | null }>("SELECT marker FROM synthetic_insert_audit");
    expect(audited.rows.length === 1 && audited.rows[0].marker !== null).toBe(true);
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const proof = await f.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true, disableCookieCache: true } });
    expect(!!proof && !Object.hasOwn(proof.session, "googleAuthenticatedAt")).toBe(true);
    expect(!JSON.stringify(await response.json()).includes("googleAuthenticatedAt")).toBe(true);
  });

  it("leaves rejected, magic-link, linked-account and direct injected creation unmarked", async () => {
    const f = await fixture();
    expect((await f.google(false)).status >= 400).toBe(true);
    expect((await f.db.select().from(session)).length === 0).toBe(true);
    expect((await f.google()).status === 200).toBe(true);
    await f.signIn("provenance@example.test"); // Google account exists; magic is still not Google.
    const current = await f.db.select().from(session);
    expect(current.length === 2 && current.filter(row => row.googleAuthenticatedAt === null).length === 1).toBe(true);
    const context = await f.auth.$context;
    await context.internalAdapter.createSession(current[0].userId, false, { googleAuthenticatedAt: new Date() });
    const direct = await f.db.select().from(session);
    expect(direct.length === 3 && direct.filter(row => row.googleAuthenticatedAt === null).length === 2).toBe(true);
    const input = f.auth.options.session?.additionalFields?.googleAuthenticatedAt;
    expect(input?.input === false && input.returned === false && input.type === "date").toBe(true);
  });

  it("discards caller marker values and computes a fresh marker only for the successful Google flow", async () => {
    const f = await fixture(), injected = "2000-01-01T00:00:00.000Z";
    expect((await f.google(true, { googleAuthenticatedAt: injected, google_authenticated_at: injected })).status === 200).toBe(true);
    const [row] = await f.db.select().from(session);
    expect(row.googleAuthenticatedAt instanceof Date && row.googleAuthenticatedAt.getUTCFullYear() !== 2000).toBe(true);
    const response = await f.request("/sign-in/magic-link", { email: "injected@example.test", googleAuthenticatedAt: injected, callbackURL: "/" });
    if (response.status === 200) {
      const delivered = f.delivered.at(-1)!;
      await f.auth.handler(new Request(delivered.url));
    }
    expect((await f.db.select().from(session)).filter(value => value.googleAuthenticatedAt !== null).length === 1).toBe(true);
  });

  it("rolls back a failing marked session INSERT without a session or marker residue", async () => {
    const f = await fixture();
    await f.client.exec(`CREATE FUNCTION synthetic_reject_marked() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.google_authenticated_at IS NOT NULL THEN RAISE EXCEPTION 'Synthetic marked insert refused' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$; CREATE TRIGGER synthetic_reject_marked BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION synthetic_reject_marked()`);
    expect((await f.google()).status >= 400).toBe(true);
    expect((await f.db.select().from(session)).length === 0).toBe(true);
  });

  it("rejects every marker change but permits normal updates, deletion and unmarked recreation", async () => {
    const f = await fixture(); await f.google();
    const [marked] = await f.db.select().from(session);
    await f.signIn("provenance@example.test");
    const unmarked = (await f.db.select().from(session)).find(row => row.googleAuthenticatedAt === null)!;
    for (const value of [null, new Date(marked.googleAuthenticatedAt!.getTime() + 1000)]) {
      expect(await constraint(() => f.db.update(session).set({ googleAuthenticatedAt: value }).where(eq(session.id, marked.id)))).toBe(true);
    }
    expect(await constraint(() => f.db.update(session).set({ googleAuthenticatedAt: new Date() }).where(eq(session.id, unmarked.id)))).toBe(true);
    await f.db.update(session).set({ googleAuthenticatedAt: marked.googleAuthenticatedAt, expiresAt: new Date(Date.now() + 60_000), userAgent: "synthetic-updated" }).where(eq(session.id, marked.id));
    expect((await f.db.select().from(session).where(eq(session.id, marked.id)))[0].userAgent === "synthetic-updated").toBe(true);
    await f.db.delete(session).where(eq(session.id, marked.id));
    await (await f.auth.$context).internalAdapter.createSession(marked.userId);
    expect((await f.db.select().from(session)).every(row => row.googleAuthenticatedAt === null)).toBe(true);
  });
});
