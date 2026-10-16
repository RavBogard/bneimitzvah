import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { browserFixture } from "./fixture";
import { assertBrowserStartupAllowed, BROWSER_ORIGIN, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { syntheticServiceCatalog } from "../helpers/service-learning";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

// HTTP-only integration target: actual loopback dispatcher, SDK sessions and
// restricted PostgreSQL runtime. No Chromium, external feed or provider calls.
let fixture: Awaited<ReturnType<typeof browserFixture>>, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
let catalogId: string, content: ReturnType<typeof syntheticServiceCatalog>, adminCookie: string, tutorCookie: string;
async function call(path: string, cookie = adminCookie, body?: unknown, headers: Record<string, string> = {}, method = body === undefined ? "GET" : "POST") {
  try {
    return await fetch(BROWSER_ORIGIN + path, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { origin: BROWSER_ORIGIN, "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error("Synthetic service HTTP request failed; private details withheld"); }
}
async function json(response: Response, expected = 200) {
  expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("location")).toBe(false); expect(response.headers.has("set-cookie")).toBe(false);
  return response.json();
}
async function signIn(email: string) {
  const sent = await call("/api/auth/sign-in/magic-link", "", { email }); expect(sent.status).toBe(200); await sent.body?.cancel();
  const token = new URLSearchParams(new URL(fixture.takeMail(email)).hash.slice(1)).get("token");
  if (!token) throw new Error("Synthetic sign-in confirmation missing");
  const confirmed = await call("/api/auth/email/confirm", "", { token }); expect(confirmed.status).toBe(200);
  const cookie = confirmed.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; "); await confirmed.body?.cancel();
  if (!cookie) throw new Error("Synthetic sign-in session missing"); return cookie;
}
beforeAll(async () => {
  try {
    assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); content = syntheticServiceCatalog("http"); catalogId = randomUUID();
    await fixture.ownerDb.update(s.student).set({ serviceSlot: "morning" }).where(eq(s.student.id, fixture.student.id));
    await fixture.ownerDb.insert(s.serviceCatalog).values({ id: catalogId, tenantId: "crc", identity: content.identity, feedBytes: content.feedBytes, provenanceBytes: content.provenanceBytes, pins: content.pins });
    await fixture.ownerDb.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId, state: "active" });
    stop = await startBrowserServer(fixture.withRuntime);
    // Reuse these two real SDK sessions; do not weaken/reset the mail limiter.
    adminCookie = await signIn("pg-admin@example.test"); tutorCookie = await signIn("pg-tutor@example.test");
  } catch { await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Service HTTP setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("serves actual SDK staff review and selected-only content with Origin, practice, tenant and withdrawal fences", async () => {
  const base = `/api/students/${fixture.student.id}/service-plan`;
  const catalog = await json(await call(base + "/catalog", adminCookie, { mode: "admin" }));
  expect(catalog).toMatchObject({ state: "available", serviceSlot: "morning", expectedPlanRevision: 0 });
  expect((await json(await call(base + "/catalog", tutorCookie, { mode: "tutor" }))).state).toBe("available");
  expect((await json(await call(base + "?mode=parent", tutorCookie))).state).toBe("no-plan");
  const selection = { mode: "admin", expectedStudentRevision: catalog.studentRevision, expectedPlanRevision: catalog.expectedPlanRevision, catalogId, catalogIdentity: content.identity, selectedIds: [content.second, content.first] };
  for (const [suffix, body] of [["/catalog", { mode: "admin" }], ["/prepare", selection], ["/confirm", { mode: "admin", binding: "v1.synthetic" }], ["/unit", {}]] as const)
    await json(await call(base + suffix, adminCookie, body, { origin: "https://foreign.example.test" }), 403);
  await json(await call(base + "/prepare", adminCookie, { ...selection, source: "https://foreign.example.test" }), 400);
  await json(await call(base + "/prepare?mode=admin", adminCookie, selection), 400);
  await json(await call(base + "/catalog", adminCookie, { mode: "admin", padding: "x".repeat(16 * 1024) }), 413);
  const method = await call(base + "/prepare", adminCookie); await json(method, 405); expect(method.headers.get("allow")).toBe("POST");
  const review = await json(await call(base + "/prepare", adminCookie, selection));
  expect(review.selectedIds).toEqual([content.first, content.second]); expect(Number.isSafeInteger(review.expiresAt)).toBe(true);
  expect(await json(await call(base + "?mode=parent", tutorCookie))).toEqual({ state: "no-plan" });
  await json(await call(base + "/confirm", tutorCookie, { mode: "parent", binding: review.binding }), 400);
  const saved = await json(await call(base + "/confirm", adminCookie, { mode: "admin", binding: review.binding }));
  expect(saved).toMatchObject({ ok: true, revision: 1, cleared: false });
  const unitBody = { mode: "parent", planId: saved.planId, planRevision: saved.revision, catalogIdentity: content.identity, unitId: content.first };
  const parent = await json(await call(base + "/unit", tutorCookie, unitBody)); expect(parent.state).toBe("assigned");
  expect(parent.material.unit.blocks[0].he).toBe("א֑ב\u200f"); expect(parent.material.license.attribution).toBe("Synthetic CRC-only credit");
  for (const forbidden of [content.hidden, "Unselected synthetic front", "omitted-synthetic", '"tr"', '"bare"', '"folio"', '"phys"', '"printedFolio"', '"feedBytes"', '"pins"']) expect(JSON.stringify(parent)).not.toContain(forbidden);
  const metadata = await json(await call(base + "?mode=parent", tutorCookie)); expect(metadata.units.map((u: { id: string }) => u.id)).toEqual([content.first, content.second]);
  await json(await call(base + "/unit", tutorCookie, { ...unitBody, unitId: content.hidden }), 404);
  await json(await call(`/api/students/${fixture.otherStudent.id}/service-plan?mode=admin`), 404);
  await json(await call(base + "?mode=child-practice", tutorCookie), 404);
  await fixture.ownerDb.update(s.guardian).set({ practiceEnabled: true }).where(eq(s.guardian.studentId, fixture.student.id));
  const entered = await json(await call("/api/practice/enter", tutorCookie, { studentId: fixture.student.id }), 201);
  const practiceHeader = { "X-Practice-Context": entered.handle };
  expect((await json(await call(base + "?mode=child-practice", tutorCookie, undefined, practiceHeader))).state).toBe("assigned");
  expect((await json(await call(base + "/unit", tutorCookie, { ...unitBody, mode: "child-practice" }, practiceHeader))).state).toBe("assigned");
  await json(await call(base + "/catalog", tutorCookie, { mode: "tutor" }, practiceHeader), 400);
  await json(await call(base + "/unit", tutorCookie, { ...unitBody, mode: "child-practice", handle: entered.handle }), 400);
  await json(await call(base + "/unit", tutorCookie, { ...unitBody, planRevision: 2 }), 409);
  const pending = await json(await call(base + "/prepare", adminCookie, { ...selection, expectedPlanRevision: 1 }));
  await fixture.ownerDb.update(s.serviceCatalogLifecycle).set({ state: "withdrawn", revision: 2 });
  const withdrawn = await json(await call(base + "/unit", tutorCookie, unitBody)); expect(withdrawn.state).toBe("withdrawn"); expect(Object.keys(withdrawn).sort()).toEqual(["plan", "state"]);
  expect(await json(await call(base + "/confirm", adminCookie, { mode: "admin", binding: pending.binding }), 409)).toEqual({ ok: false, code: "stale-revision" });
  await fixture.ownerDb.update(s.guardian).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.guardian.studentId, fixture.student.id));
  await json(await call(base + "?mode=child-practice", tutorCookie, undefined, practiceHeader), 404);
});
