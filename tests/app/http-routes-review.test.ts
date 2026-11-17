import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { portalRoutesFixture } from "./portal-routes-fixture";
import * as s from "../../src/server/db/index";

test("review: opaque reading review cannot cross a genuinely authorized role or replacement SDK session", async () => {
  const f = await portalRoutesFixture();
  try {
    await f.owner(async () => { await f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "admin" }); });
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const path = `/api/students/${f.students[0].id}/reading`;
    const preparedResponse = await dispatch(f.request(`${path}/prepare`, { body: { mode: "tutor", ranges: ["Genesis 1:1-2"] } }));
    expect(preparedResponse.status).toBe(200);
    const prepared = await preparedResponse.json();
    // Both modes are real live grants for this same user: this is not a missing-role denial.
    expect((await dispatch(f.request("/api/admin/students"))).status).toBe(200);
    expect((await dispatch(f.request(`${path}/confirm`, { body: { mode: "admin", binding: prepared.binding } }))).status).toBe(403);
    let newCookie = "";
    await f.owner(async () => { newCookie = (await f.signIn("multi@example.test")).cookie; });
    expect((await dispatch(f.request(`${path}?mode=tutor`, { headers: { cookie: newCookie } }))).status).toBe(200);
    expect((await dispatch(f.request(`${path}/confirm`, { headers: { cookie: newCookie }, body: { mode: "tutor", binding: prepared.binding } }))).status).toBe(403);
    // The CSV import's confirm route is gone (Daniel, 2026-11-17): it answers as any unknown route does.
    expect((await dispatch(f.request("/api/admin/students/import/confirm", { body: { binding: prepared.binding } }))).status).toBe(404);
    // So does the roster Sheet's "update now" (removed with the Sheet, 2026-11-17).
    expect((await dispatch(f.request("/api/admin/roster-sheet/sync", { body: {} }))).status).toBe(404);
    expect((await dispatch(f.request(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } }))).status).toBe(200);
    expect((await dispatch(f.request(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } }))).status).toBe(409);
  } finally { await f.client.close(); }
});

test("review: retired query OAuth and missing browser challenge deny before provider traffic", async () => {
  const f = await portalRoutesFixture();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected synthetic provider call"); });
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const before = await f.owner(async () => (await f.db.select().from(s.session)).length);
    const prepared = await dispatch(f.request("/api/auth/google/challenge", { who: "anonymous", body: {} }));
    expect(prepared.status).toBe(200);
    const challenge = await prepared.json();
    const credential = `${Buffer.from('{"alg":"RS256"}').toString("base64url")}.e30.AA`;
    for (const cookie of ["", `portal_google_binding=${randomBytes(32).toString("base64url")}`]) {
      const response = await dispatch(f.request("/api/auth/sign-in/social", { who: "anonymous", body: { credential, challengeId: challenge.challengeId, csrfToken: challenge.csrfToken }, headers: { cookie } }));
      expect(response.status).toBe(403);
      expect(response.headers.get("location")).toBeNull();
    }
    // Redirect-mode Google's return is routed; an unknown state never reaches Google or makes a session.
    const unknown = await dispatch(f.request("/api/auth/callback/google?code=synthetic&state=synthetic"));
    expect(unknown.status).toBe(303); expect(unknown.headers.get("location")).toBe("/sign-in?error=authentication");
    expect(network.mock.calls.length).toBe(0);
    expect(await f.owner(async () => (await f.db.select().from(s.session)).length === before)).toBe(true);
  } finally { network.mockRestore(); await f.client.close(); }
});
test("review: client-supplied forwarding addresses cannot rotate around the magic-link throttle", async () => {
  const f = await portalRoutesFixture();
  try {
    // Remove only fixture sign-in traffic so the test observes a clean five-request budget.
    await f.owner(async () => { await f.db.delete(s.rateLimit); });
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    for (let index = 0; index < 5; index++) {
      expect((await dispatch(f.request("/api/auth/sign-in/magic-link", { who: "anonymous", body: { email: "throttle-review@example.test" }, headers: { "x-forwarded-for": "192.0.2.20" } }))).status).toBe(200);
    }
    expect((await dispatch(f.request("/api/auth/sign-in/magic-link", { who: "anonymous", body: { email: "throttle-review@example.test" }, headers: { "x-forwarded-for": "192.0.2.20" } }))).status).toBe(429);
    expect((await dispatch(f.request("/api/auth/sign-in/magic-link", { who: "anonymous", body: { email: "throttle-review@example.test" }, headers: { "x-forwarded-for": "192.0.2.21" } }))).status).toBe(429);
  } finally { await f.client.close(); }
});
