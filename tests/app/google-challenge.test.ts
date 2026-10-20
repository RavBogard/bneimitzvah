import { randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import { eq, like } from "drizzle-orm";
import * as schema from "../../src/server/db/index";
import { createGoogleChallenges, GoogleChallengeLimited } from "../../src/server/http/google-challenge";
import { AccessDenied } from "../../src/server/access/errors";
import { authFixture } from "./auth-stack-helper";

const opened: Awaited<ReturnType<typeof authFixture>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); });
async function fixture(origin = "http://localhost:3000") {
  const base = await authFixture(); opened.push(base);
  const db = drizzle(base.client, { schema }); let time = Date.now();
  const secret = randomBytes(48).toString("base64url");
  const input = { db, origin, secret, now: () => time };
  const challenges = createGoogleChallenges(input);
  const request = (cookie = "") => new Request(`${origin}/api/auth/google/challenge`, { method: "POST", headers: { origin, ...(cookie ? { cookie } : {}) } });
  return { ...base, db, challenges, input, request, move: (delta: number) => { time += delta; } };
}
const cookieOf = (issued: { cookie: string }) => issued.cookie.split(";")[0];

test("fixed Account next stays bound and expires while arbitrary next refuses before storage", async () => {
  const f = await fixture();
  await expect(f.challenges.issue(f.request(), "https://foreign.example.test" as "/account")).rejects.toBeInstanceOf(AccessDenied);
  expect(await f.db.select().from(schema.verification)).toHaveLength(0);
  const valid = await f.challenges.issue(f.request(), "/account"), cookie = cookieOf(valid);
  await expect(f.challenges.consume(f.request(cookie), valid.body.challengeId, randomBytes(32).toString("base64url"))).rejects.toBeInstanceOf(AccessDenied);
  expect(await f.challenges.consume(f.request(cookie), valid.body.challengeId, valid.body.csrfToken)).toEqual({ nonce: valid.body.nonce, next: "/account" });
  const late = await f.challenges.issue(f.request(cookie), "/account"); f.move(300000);
  await expect(f.challenges.consume(f.request(cookie), late.body.challengeId, late.body.csrfToken)).rejects.toBeInstanceOf(AccessDenied);
});

test("challenge is browser/CSRF/origin bound, short lived and consumed once across repository instances", async () => {
  const f = await fixture(); const issued = await f.challenges.issue(f.request(), "/invitations/accept");
  const cookie = cookieOf(issued), { challengeId, csrfToken, nonce } = issued.body;
  expect(issued.cookie.includes("HttpOnly; SameSite=Lax; Max-Age=600") && !issued.cookie.includes("Domain=")).toBe(true);
  for (const [request, id, csrf] of [[f.request(), challengeId, csrfToken], [f.request(cookie), challengeId, randomBytes(32).toString("base64url")],
    [f.request(cookie), `magic-link:${challengeId}`, csrfToken], [f.request(`${cookie}; ${cookie}`), challengeId, csrfToken]]) {
    await expect(f.challenges.consume(request as Request, id, csrf)).rejects.toBeInstanceOf(AccessDenied);
  }
  const otherOrigin = createGoogleChallenges({ ...f.input, origin: "https://bneimitzvah.vercel.app" });
  await expect(otherOrigin.consume(f.request(cookie), challengeId, csrfToken)).rejects.toBeInstanceOf(AccessDenied);
  const other = createGoogleChallenges(f.input);
  const results = await Promise.allSettled([f.challenges.consume(f.request(cookie), challengeId, csrfToken), other.consume(f.request(cookie), challengeId, csrfToken)]);
  expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
  expect(results.find(row => row.status === "fulfilled")?.value).toEqual({ nonce, next: "/invitations/accept" });
  await expect(f.challenges.consume(f.request(cookie), challengeId, csrfToken)).rejects.toBeInstanceOf(AccessDenied);
});

test("expired/future/malformed challenge refuses without consumption of SDK or unrelated verification rows", async () => {
  const f = await fixture();
  await f.db.insert(schema.verification).values({ id: "sdk-synthetic", identifier: "magic-link:synthetic", value: "private-synthetic", expiresAt: new Date(Date.now() + 3_600_000) });
  const issued = await f.challenges.issue(f.request(), "/"); const cookie = cookieOf(issued);
  f.move(-1); await expect(f.challenges.consume(f.request(cookie), issued.body.challengeId, issued.body.csrfToken)).rejects.toBeInstanceOf(AccessDenied);
  f.move(300_001); await expect(f.challenges.consume(f.request(cookie), issued.body.challengeId, issued.body.csrfToken)).rejects.toBeInstanceOf(AccessDenied);
  const fresh = await f.challenges.issue(f.request(cookie), "/");
  expect((await f.db.select().from(schema.verification).where(eq(schema.verification.id, "sdk-synthetic")))).toHaveLength(1);
  await f.db.update(schema.verification).set({ value: '{"version":1,"nonce":"synthetic-private"}' }).where(eq(schema.verification.id, `portal-google:v1:${fresh.body.challengeId}`));
  await expect(f.challenges.consume(f.request(cookie), fresh.body.challengeId, fresh.body.csrfToken)).rejects.toMatchObject({ message: "Action not permitted" });
});

test("prefixed cleanup is bounded and SDK expiry cleanup preserves live challenges", async () => {
  const f = await fixture();
  const expired = new Date(Date.now() - 60_000);
  await f.db.insert(schema.verification).values(Array.from({ length: 103 }, (_, index) => ({ id: `portal-google:v1:expired-${index}`, identifier: "expired", value: "{}", expiresAt: expired })));
  await f.db.insert(schema.verification).values({ id: "unrelated-expired", identifier: "another:purpose", value: "{}", expiresAt: expired });
  const issued = await f.challenges.issue(f.request(), "/");
  expect(await f.db.select().from(schema.verification).where(like(schema.verification.id, "portal-google:v1:expired-%"))).toHaveLength(3);
  expect(await f.db.select().from(schema.verification).where(eq(schema.verification.id, "unrelated-expired"))).toHaveLength(1);
  // Trigger real pinned SDK findVerificationValue cleanup, with no successful login.
  await f.auth.handler(new Request("http://localhost:3000/api/auth/magic-link/verify?token=AbsentSyntheticToken"));
  expect(await f.challenges.consume(f.request(cookieOf(issued)), issued.body.challengeId, issued.body.csrfToken)).toMatchObject({ nonce: issued.body.nonce });
});

test("per-browser and origin budgets persist across instances and HTTPS cookie expiry is host-only", async () => {
  const f = await fixture("https://bneimitzvah.vercel.app");
  const first = await f.challenges.issue(f.request(), "/"); const cookie = cookieOf(first);
  expect(first.cookie.startsWith("__Host-portal_google_binding=") && first.cookie.endsWith("; Secure")).toBe(true);
  expect(f.challenges.clear()).toBe("__Host-portal_google_binding=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
  const second = createGoogleChallenges(f.input);
  for (let index = 0; index < 4; index++) await second.issue(f.request(cookie), "/");
  await expect(second.issue(f.request(cookie), "/")).rejects.toBeInstanceOf(GoogleChallengeLimited);
  for (let index = 0; index < 25; index++) await second.issue(f.request(), "/");
  await expect(f.challenges.issue(f.request(), "/")).rejects.toBeInstanceOf(GoogleChallengeLimited);
  const otherOrigin = createGoogleChallenges({ ...f.input, origin: "https://bneimitzvah.centralreform.org" });
  // Same physical database/secret and same minute; each exact origin has its
  // own global budget rather than inheriting the first origin's exhausted key.
  expect((await otherOrigin.issue(f.request(), "/")).body.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("expiry is checked again after the awaited lock boundary, without consuming an expired attempt", async () => {
  const f = await fixture(); const issued = await f.challenges.issue(f.request(), "/");
  let calls = 0;
  const crossing = createGoogleChallenges({ ...f.input, now: () => issued.body.expiresAt + (++calls === 1 ? -1 : 1) });
  await expect(crossing.consume(f.request(cookieOf(issued)), issued.body.challengeId, issued.body.csrfToken)).rejects.toBeInstanceOf(AccessDenied);
  expect(calls).toBe(2);
  expect(await f.db.select().from(schema.verification).where(eq(schema.verification.id, `portal-google:v1:${issued.body.challengeId}`))).toHaveLength(1);
});
