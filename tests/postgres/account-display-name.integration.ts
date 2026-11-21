import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { createAccountDisplayNameService } from "../../src/server/account-display-name/service";
import { accountDisplayName } from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { summarizePortalSession } from "../../src/server/portal/session-summary";
import { postgresAccessFixture } from "./access-fixture";

vi.mock("server-only", () => ({}));
const fixtures: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

it("keeps concurrent owner and admin edits, retries, and RLS scoped to one membership and congregation", async () => {
  const f = await postgresAccessFixture();
  fixtures.push(f);
  const sessionBindingSecret = "synthetic-account-display-name-session-binding";
  const a = createAccountDisplayNameService({ access: f.a, sessionBindingSecret });
  const b = createAccountDisplayNameService({ access: f.b, sessionBindingSecret });
  const request = async (who: "tutor" | "admin") => {
    const request = f.request(who);
    const summary = await f.a.withVerifiedIdentity(request, { intent: "read" }, (tx, identity) =>
      summarizePortalSession(tx, identity, identity.membership, sessionBindingSecret));
    request.headers.set("X-Session-Binding", summary.sessionBinding);
    request.headers.set("origin", "http://localhost:3000");
    return { ...request, method: "POST" };
  };
  const owner = await request("tutor"), admin = await request("admin");
  const membershipId = f.tutorGrant.membershipId;

  async function race(expectedRevision: number, names: [string, string]) {
    const results = await Promise.all([
      a.write(owner, { name: names[0], expectedRevision }),
      b.write(admin, { name: names[1], tutorGrantId: f.tutorGrant.id, expectedRevision }),
    ]);
    const winner = results.find(row => row.ok);
    expect(winner).toMatchObject({ revision: expectedRevision + 1 });
    expect(results.filter(row => !row.ok)).toEqual([{ ok: false, code: "changed" }]);
    expect(await a.read(owner, {})).toEqual(winner);
    expect(await a.write(owner, { name: names[0], expectedRevision })).toEqual({ ok: false, code: "changed" });
  }
  await race(0, ["First self", "First admin"]);
  await race(1, ["Second self", "Second admin"]);

  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(accountDisplayName))).toEqual([]);
  await expect(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(accountDisplayName)
    .values({ tenantId: "crc", membershipId, name: "Wrong tenant" }))).rejects.toThrow();
  await expect(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(accountDisplayName)
    .values({ tenantId: "other", membershipId, name: "Wrong membership" }))).rejects.toThrow();
  await expect(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.delete(accountDisplayName)
    .where(eq(accountDisplayName.membershipId, membershipId)))).rejects.toThrow();
  const flags = await f.owner.query("select relrowsecurity, relforcerowsecurity from pg_class where relname='account_display_name'");
  expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
});
