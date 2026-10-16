import { randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { createGoogleChallenges } from "../../src/server/http/google-challenge";
import { AccessDenied } from "../../src/server/access/errors";
import { verification } from "../../src/server/db/auth-schema";
import { deferred, postgresAccessFixture, settleRace, waitForEntry } from "./access-fixture";

type Fixture = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Fixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
async function fixture() { const f = await postgresAccessFixture(); opened.push(f); return f; }
const origin = "http://localhost:3000";
const request = (cookie = "") => new Request(`${origin}/api/auth/google/challenge`, { method: "POST", headers: { origin, ...(cookie ? { cookie } : {}) } });
const selectLock = (text: string) => text.includes('from "verification"') && text.includes("for update");

// This reuses the unchanged disposable loopback guard, generated test database
// and independent restricted LOGIN pools. Root alone starts/runs that harness.
test("two restricted physical backends contend on one Google challenge and exactly one receives its nonce", async () => {
  const f = await fixture(), secret = randomBytes(48).toString("base64url");
  const a = createGoogleChallenges({ db: f.aDb, origin, secret }), b = createGoogleChallenges({ db: f.bDb, origin, secret });
  const issued = await a.issue(request(), "/"), cookie = issued.cookie.split(";")[0];
  const entered = deferred(), release = deferred();
  const restore = await f.intercept("a", selectLock, async proceed => {
    const result = await proceed(); entered.resolve(); await release.promise; return result;
  });
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  try {
    first = a.consume(request(cookie), issued.body.challengeId, issued.body.csrfToken);
    void first.catch(() => undefined);
    await waitForEntry(entered.promise, first);
    second = b.consume(request(cookie), issued.body.challengeId, issued.body.csrfToken);
    void second.catch(() => undefined);
    await f.waitForLock(f.pidB, f.pidA); // Observed PG blocking edge, no timing guess.
    release.resolve();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter(row => row.status === "fulfilled").length === 1).toBe(true);
    const winner = outcomes.find(row => row.status === "fulfilled");
    expect(winner?.status === "fulfilled" && (winner.value as { nonce: string }).nonce === issued.body.nonce).toBe(true);
    const loser = outcomes.find(row => row.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason instanceof AccessDenied && loser.reason.status === 403).toBe(true);
    expect((await f.ownerDb.select({ id: verification.id }).from(verification).where(eq(verification.id, `portal-google:v1:${issued.body.challengeId}`))).length === 0).toBe(true);
  } finally {
    release.resolve(); await settleRace([first, second].filter((value): value is Promise<unknown> => value !== undefined)); restore();
  }
});

test("a blocked Google consumer rechecks expiry after its real PostgreSQL row-lock wait", async () => {
  const f = await fixture(), secret = randomBytes(48).toString("base64url");
  let current = Date.now();
  const a = createGoogleChallenges({ db: f.aDb, origin, secret, now: () => current });
  const b = createGoogleChallenges({ db: f.bDb, origin, secret, now: () => current });
  const issued = await a.issue(request(), "/"), cookie = issued.cookie.split(";")[0];
  const entered = deferred(), release = deferred();
  const blocker = f.aDb.transaction(async tx => {
    await tx.select({ id: verification.id }).from(verification).where(eq(verification.id, `portal-google:v1:${issued.body.challengeId}`)).for("update");
    entered.resolve(); await release.promise;
  });
  void blocker.catch(() => undefined);
  let consumer: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, blocker);
    current = issued.body.expiresAt - 1;
    consumer = b.consume(request(cookie), issued.body.challengeId, issued.body.csrfToken);
    void consumer.catch(() => undefined);
    await f.waitForLock(f.pidB, f.pidA);
    // Advance only after PostgreSQL proves the consumer is physically waiting.
    current = issued.body.expiresAt;
    release.resolve();
    const outcomes = await Promise.allSettled([blocker, consumer]);
    expect(outcomes[0].status === "fulfilled").toBe(true);
    const denied = outcomes[1];
    expect(denied.status === "rejected" && denied.reason instanceof AccessDenied && denied.reason.status === 403).toBe(true);
    expect((await f.ownerDb.select({ id: verification.id }).from(verification).where(eq(verification.id, `portal-google:v1:${issued.body.challengeId}`))).length === 1).toBe(true);
  } finally {
    release.resolve(); await settleRace([blocker, ...(consumer ? [consumer] : [])]);
  }
});
