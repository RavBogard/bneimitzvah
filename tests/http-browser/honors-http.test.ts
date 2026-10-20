import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import * as s from "../../src/server/db/index";
// Actual SDK cookies, HTTP dispatcher and restricted PostgreSQL; no browser UI,
// provider data, real family values, bearer issuance or external mail.
let fixture: Awaited<ReturnType<typeof browserFixture>>, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let adminCookie: string, parentCookie: string, studentCookie: string, savedIntent: Record<string, unknown>;
async function call(path: string, cookie = parentCookie, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") {
  try { return await fetch(BROWSER_ORIGIN + path, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { origin: BROWSER_ORIGIN, "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("Synthetic honors HTTP request failed; details withheld"); }
}
async function json(response: Response, status = 200) {
  expect(response.status).toBe(status); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.has("location")).toBe(false); expect(response.headers.has("set-cookie")).toBe(false); return response.json();
}
async function signIn(email: string) {
  const sent = await call("/api/auth/sign-in/magic-link", "", { email }); expect(sent.status).toBe(200); await sent.body?.cancel();
  const token = new URLSearchParams(new URL(fixture.takeMail(email)).hash.slice(1)).get("token"); if (!token) throw new Error("Synthetic sign-in proof missing");
  const result = await call("/api/auth/email/confirm", "", { token }); expect(result.status).toBe(200); const cookie = result.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await result.body?.cancel(); if (!cookie) throw new Error("Synthetic session missing"); return cookie;
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
    const [admin] = await fixture.ownerDb.select().from(s.membership).where(eq(s.membership.userId, fixture.admin.id));
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    const [reading] = await fixture.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: fixture.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", aliyahStarts: ["Genesis 1:2"], setByMembershipId: admin.id,
      proposalSnapshot: { confirmationDate: fixture.student.ceremonyDate, serviceSlot: "morning", slotProvenance: 1, needsReview: false } }).returning();
    await fixture.ownerDb.insert(s.assignmentVerse).values([1, 2].map(i => ({ tenantId: "crc", studentId: fixture.student.id, assignmentId: reading.id, ordinal: i, verseRef: `Genesis 1:${i}` })));
    const learner = await fixture.signIn("pg-student"), [member] = await fixture.ownerDb.insert(s.membership).values({ tenantId: "crc", userId: learner.id }).returning(), [grant] = await fixture.ownerDb.insert(s.roleGrant).values({ tenantId: "crc", membershipId: member.id, role: "student" }).returning();
    await fixture.ownerDb.insert(s.studentIdentity).values({ tenantId: "crc", studentId: fixture.student.id, roleGrantId: grant.id });
    stop = await startBrowserServer(fixture.withRuntime); adminCookie = await signIn("pg-admin@example.test"); parentCookie = await signIn("pg-tutor@example.test"); studentCookie = await signIn("pg-student@example.test");
  } catch { await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); throw new Error("Synthetic honors HTTP setup failed; details withheld"); }
}, 120000);
afterAll(async () => { await stop?.().catch(() => {}); await fixture?.close().catch(() => {}); restore?.(); }, 120000);

it("actual SDK guardian saves draft groups and two tutor-derived aliyot; receipt is stable, globally unique and private", async () => {
  const path = `/api/students/${fixture.student.id}/honors`, baseline = await json(await call(path + "?mode=parent"));
  expect(baseline.currentContext.spans).toEqual([{ startVerse: "Genesis 1:1", endVerse: "Genesis 1:1" }, { startVerse: "Genesis 1:2", endVerse: "Genesis 1:2" }]);
  const person = () => ({ id: randomUUID(), englishName: "Synthetic Honoree" });
  savedIntent = { mode: "parent", expectedVersion: 0, mutationId: randomUUID(), contextHash: baseline.currentContext.hash, form: { schemaVersion: 1, openingArk: [person(), person(), person()], generationToGeneration: [{ ...person(), relationship: null }], undressingTorah: [], redressingTorah: [], closingArk: [person()],
    aliyot: [{ startVerse: "Genesis 1:2", participants: [{ ...person(), hebrewName: null, parent1HebrewName: null, parent2HebrewName: null, relationship: null }] }], parentalBlessing: { participation: "yes", delivery: null } } };
  expect(await json(await call(path, parentCookie, savedIntent))).toMatchObject({ ok: true, committedVersion: 1, needsReview: false });
  expect(await json(await call(path + "/receipt", parentCookie, savedIntent))).toMatchObject({ outcome: "committed", committedVersion: 1 });
  expect(await json(await call(path + "/receipt", adminCookie, { ...savedIntent, mode: "admin" }), 409)).toEqual({ ok: false, code: "conflict" });
  expect(await json(await call(path, adminCookie, { ...savedIntent, mode: "admin", expectedVersion: 1 }), 409)).toEqual({ ok: false, code: "conflict" });
  expect(await fixture.ownerDb.select().from(s.honorsVersion)).toHaveLength(1);
  await fixture.ownerDb.update(s.student).set({ ceremonyDate: "2027-02-06" }).where(eq(s.student.id, fixture.student.id));
  expect(await json(await call(path + "/receipt", parentCookie, savedIntent))).toMatchObject({ committedVersion: 1, needsReview: true });
  expect(await json(await call(path, parentCookie, { ...savedIntent, mutationId: randomUUID(), expectedVersion: 1 }), 409)).toEqual({ ok: false, code: "stale-context" });
});

it("actual parent and own-adult exceptions reject child delegated tutor and foreign access and follow live revocation", async () => {
  const path = `/api/students/${fixture.student.id}/honors`;
  const entered = await json(await call("/api/practice/enter", parentCookie, { studentId: fixture.student.id }), 201);
  await json(await call(path + "?mode=parent", parentCookie, undefined, { "X-Practice-Context": entered.handle }), 403);
  await json(await call(path + "?mode=admin", adminCookie, undefined, { "X-Practice-Context": entered.handle }), 403);
  await fixture.ownerDb.update(s.guardian).set({ practiceEnabled: false }).where(eq(s.guardian.studentId, fixture.student.id));
  expect((await json(await call(path + "?mode=parent"))).currentVersion).toBe(1);
  await json(await call(path + "?mode=tutor"), 403); await json(await call(path + "?mode=student", studentCookie), 403);
  await fixture.ownerDb.update(s.student).set({ studentKind: "adult", ownEmail: "synthetic@example.test" }).where(eq(s.student.id, fixture.student.id));
  expect((await json(await call(path + "?mode=student", studentCookie))).currentVersion).toBe(1);
  const list = await json(await call("/api/students?mode=student", studentCookie));
  expect(list.students).toHaveLength(1); expect(list.students[0]).toMatchObject({ id: fixture.student.id, ownAdultHonors: true });
  await json(await call(`/api/students/${fixture.otherStudent.id}/honors?mode=student`, studentCookie), 404);
  await json(await call(path + "?mode=student", studentCookie, undefined, { "X-Practice-Context": entered.handle }), 403);
  await json(await call(`/api/students/${fixture.otherStudent.id}/honors?mode=admin`, adminCookie), 404);
  await json(await call(path, parentCookie, savedIntent, { origin: "https://foreign.invalid" }), 403);
  await json(await call(path + "?mode=parent&mode=admin"), 400); await json(await call(path, parentCookie, undefined, {}, "DELETE"), 405);
  await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date() }).where(eq(s.guardian.studentId, fixture.student.id));
  await json(await call(path + "/receipt", parentCookie, savedIntent), 404);
  await fixture.ownerDb.update(s.session).set({ expiresAt: new Date(0) }).where(eq(s.session.userId, fixture.admin.id));
  await json(await call(path + "?mode=admin", adminCookie), 401);
});
