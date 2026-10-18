import { afterEach, describe, expect, it, vi } from "vitest";
// Replace only the build-time marker; authentication and storage remain real.
vi.mock("server-only", () => ({}));
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { accessFixture } from "./access-fixture";
import { createAccessService } from "../../src/server/access/service";
import { AccessDenied } from "../../src/server/access/errors";

const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
async function fixture() {
  const f = await accessFixture();
  fixtures.push(f);
  // Same real adapter, secret and sessions; only this test composition enables
  // the actual library's bearer-to-session support. No application flag exists.
  const auth = betterAuth({ ...f.auth.options, plugins: [...f.auth.options.plugins, bearer()] });
  const service = createAccessService({ db: f.db, auth, deployment: { environment: "test", deployment: "suite" } });
  async function authorization(who: keyof typeof f.identities) {
    const proof = await f.auth.api.getSession({ headers: new Headers({ cookie: f.identities[who].cookie }), query: { disableRefresh: true } });
    if (!proof) throw new Error("Synthetic session setup failed");
    return `Bearer ${proof.session.token}`;
  }
  return { ...f, auth, service, authorization };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.client.close())); });
async function denied(action: () => Promise<unknown>, status: number) {
  try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; }
}

describe("browser cookie identity with a real bearer-capable SDK", () => {
  it("proves direct SDK bearer authentication but denies absent or invalid browser cookies", async () => {
    const f = await fixture();
    const authorization = await f.authorization("admin");
    for (const cookie of [undefined, "better-auth.session_token=invalid-synthetic-cookie"]) {
      const headers = new Headers({ authorization, forwarded: "for=synthetic;host=untrusted.example.test" });
      if (cookie) headers.set("cookie", cookie);
      const original = [...headers.entries()];
      const direct = await f.auth.api.getSession({ headers: new Headers(headers), query: { disableCookieCache: true, disableRefresh: true } });
      expect(direct?.user.id === f.identities.admin.id).toBe(true);
      expect(await denied(() => f.service.listStudents({ url: "http://localhost:3000/students", headers }, { mode: "admin" }), 401)).toBe(true);
      // Compare booleans so failures never print credential-bearing values.
      expect(JSON.stringify([...headers.entries()]) === JSON.stringify(original)).toBe(true);
    }
  });

  it("keeps the cookie's identity and role when another user's valid bearer is present", async () => {
    const f = await fixture();
    const authorization = await f.authorization("admin");
    const request = f.request("learner", "http://localhost:3000", { authorization });
    const originalCookie = request.headers.get("cookie");
    const direct = await f.auth.api.getSession({ headers: new Headers(request.headers), query: { disableCookieCache: true, disableRefresh: true } });
    expect(direct?.user.id === f.identities.admin.id).toBe(true);
    expect(await f.service.withStudentCapability(request, { mode: "student", studentId: f.students[0].id, capability: "read" }, async (_tx, actor) =>
      actor.userId === f.identities.learner.id && actor.authSessionId === f.identities.learner.sessionId)).toBe(true);
    expect(await denied(() => f.service.listStudents(request, { mode: "admin" }), 403)).toBe(true);
    expect(await denied(() => f.service.readStudent(request, { mode: "student", studentId: f.students[2].id }), 404)).toBe(true);
    expect(request.headers.get("cookie") === originalCookie && request.headers.get("authorization") === authorization).toBe(true);
    const adminRequest = f.request("admin", "http://localhost:3000", { authorization: await f.authorization("learner") });
    expect((await f.service.listStudents(adminRequest, { mode: "admin" })).length === 3).toBe(true);
  });

  it("retains exact host, tenant and assigned-role boundaries despite a privileged bearer", async () => {
    const f = await fixture();
    const authorization = await f.authorization("admin");
    const other = f.request("multi", "http://localhost:3101", { authorization });
    const visible = await f.service.listStudents(other, { mode: "student" });
    expect(visible.length === 1 && visible[0].id === f.students[3].id).toBe(true);
    expect(await denied(() => f.service.listStudents(other, { mode: "admin" }), 403)).toBe(true);
    expect(await denied(() => f.service.readStudent(other, { mode: "student", studentId: f.students[0].id }), 404)).toBe(true);
    expect(await denied(() => f.service.listStudents(f.request("multi", "https://unknown.example.test", { authorization }), { mode: "admin" }), 404)).toBe(true);
  });
});
