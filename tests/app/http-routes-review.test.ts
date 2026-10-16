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
    const csv = "firstName,lastName,ceremonyDate,parentEmail,ownEmail\nSynthetic,Review,2027-01-02,review@example.test,";
    expect((await dispatch(f.request("/api/admin/students/import/confirm", { body: { csv, allowDuplicates: false, binding: prepared.binding } }))).status).toBe(403);
    expect((await dispatch(f.request(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } }))).status).toBe(200);
    expect((await dispatch(f.request(`${path}/confirm`, { body: { mode: "tutor", binding: prepared.binding } }))).status).toBe(409);
  } finally { await f.client.close(); }
});

test("review: real database OAuth state without its exact state cookie denies before provider traffic", async () => {
  const f = await portalRoutesFixture();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Unexpected synthetic provider call"); });
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime));
    const before = await f.owner(async () => (await f.db.select().from(s.session)).length);
    const start = await dispatch(f.request("/api/auth/sign-in/social", { body: { provider: "google" } }));
    expect(start.status).toBe(200);
    const target = new URL((await start.json()).url);
    const state = target.searchParams.get("state");
    expect(typeof state === "string" && state.length > 0).toBe(true);
    const realCookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    expect(realCookie.includes("better-auth.state=")).toBe(true);
    for (const cookie of ["", `better-auth.state=${randomBytes(32).toString("base64url")}`]) {
      const response = await dispatch(f.request(`/api/auth/callback/google?code=synthetic-code&state=${encodeURIComponent(state!)}`, { who: "anonymous", headers: { cookie } }));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/sign-in?error=authentication");
      expect((await response.text()).length).toBe(0);
    }
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
