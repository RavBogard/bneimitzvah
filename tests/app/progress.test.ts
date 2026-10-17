import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";
import type { AccessTransaction } from "../../src/server/access/types";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { handleProgressRequest } from "../../src/server/http/progress";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { expandReadingRanges } from "../../src/lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import type { ProgressSelection } from "../../src/lib/progress/types";
import * as s from "../../src/server/db/index";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture(range = "Genesis 1:1-3") {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const refs = expandReadingRanges([range], "torah", TANAKH_VERSE_COUNTS);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: range, status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(refs.map((verseRef, index) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: index + 1, verseRef })));
    return row;
  });
  const selection: ProgressSelection = { mode: "student", studentId: f.students[0].id, kind: "torah", assignmentId: assignment.id, assignmentRevision: 1 };
  const { studentId: _studentId, ...binding } = selection, path = `/api/students/${selection.studentId}/progress`;
  const write = (state = "working", expectedVersion = 0, verseRef = refs[0]) => ({ ...binding, state, expectedVersion, verseRef });
  const call = (suffix = `?${new URLSearchParams(Object.entries(binding).map(([key, value]) => [key, String(value)]))}`, options: Parameters<typeof f.request>[1] = { who: "learner" }) => handleProgressRequest(f.request(`${path}${suffix}`, options), f.runtime);
  return { ...f, refs, assignment, selection, binding, path, write, progressCall: call };
}
async function sqlState(operation: PromiseLike<unknown>) {
  try { await operation; return "accepted"; } catch (error) {
    let value = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; value && depth < 4; depth++, value = value.cause as typeof value) if (typeof value.code === "string" && /^[A-Z0-9]{5}$/.test(value.code)) return value.code;
    return "unknown";
  }
}

test("progress HTTP projects current defaults and whole-assignment counts without materializing heads or audit events", async () => {
  const f = await fixture("Genesis 1:1-4:24"), before = await f.owner(() => f.db.select().from(s.auditEvent));
  const response = (await f.progressCall())!; expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const page = await response.json(); expect(page).toMatchObject({ ok: true, binding: f.selection, offset: 0, nextOffset: 100, totalVerses: f.refs.length,
    counts: { selfCheck: { unmarked: f.refs.length, working: 0, "got-it": 0 }, assessment: { "not-started": f.refs.length, working: 0, solid: 0 } } });
  expect(page.verses).toHaveLength(100); expect(page.verses[0]).toEqual({ verseRef: f.refs[0], selfCheck: { state: "unmarked", version: 0 }, assessment: { state: "not-started", version: 0 } });
  const next = await f.runtime.progress.page(f.request("/", { who: "learner" }), f.selection, 100); expect(next).toMatchObject({ ok: true, nextOffset: null, counts: page.counts });
  expect(await f.owner(() => f.db.select().from(s.verseSelfCheck))).toHaveLength(0); expect(await f.owner(() => f.db.select().from(s.verseAssessment))).toHaveLength(0); expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
  expect(JSON.stringify(page)).not.toMatch(/createdAt|updatedAt|actor|email|authorityBinding|handle/);
});

test("the dispatcher exposes independent progress writes with conflict responses and no changed-state audit for a no-op", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(async action => action(f.runtime));
  const request = (stream: string, body: unknown, who: "learner" | "multi" = "learner") => dispatch(f.request(`${f.path}/${stream}`, { who, body }));
  const first = await request("self-check", f.write("got-it")); expect(first.status).toBe(200); expect(await first.json()).toEqual({ ok: true, binding: f.selection, verseRef: f.refs[0], stream: "self-check", state: "got-it", version: 1 });
  const assessment = await request("assessment", { ...f.write("solid"), mode: "tutor" }, "multi"); expect(assessment.status).toBe(200);
  expect((await request("self-check", f.write("working"))).status).toBe(409);
  const before = await f.owner(() => f.db.select().from(s.auditEvent)); expect((await request("self-check", f.write("got-it", 1))).status).toBe(200); expect(await f.owner(() => f.db.select().from(s.auditEvent))).toEqual(before);
  const page = await (await f.progressCall())!.json(); expect(page.counts).toEqual({ selfCheck: { unmarked: 2, working: 0, "got-it": 1 }, assessment: { "not-started": 2, working: 0, solid: 1 } });
  expect(page.verses[0]).toMatchObject({ selfCheck: { state: "got-it", version: 1 }, assessment: { state: "solid", version: 1 } });
  expect(before.filter(row => row.action.startsWith("progress."))).toHaveLength(2);
});

test("progress HTTP rejects nonclosed or unbounded inputs and wrong Origin before any write", async () => {
  const f = await fixture();
  for (const change of [{ extra: true }, { actorUserId: "untrusted" }, { tenantId: "other" }, { timestamp: 1 }, { state: "solid" }, { state: "__proto__" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483648 }, { assignmentRevision: "1" }, { kind: "service" }, { mode: "owner" }]) {
    expect((await f.progressCall("/self-check", { who: "learner", body: { ...f.write(), ...change } }))!.status).toBe(400);
  }
  expect((await f.progressCall("/self-check?token=untrusted", { who: "learner", body: f.write() }))!.status).toBe(400);
  expect((await f.progressCall("/self-check", { who: "learner", body: f.write(), headers: { origin: "https://foreign.example.test" } }))!.status).toBe(403);
  expect((await f.progressCall("/self-check", { who: "learner", body: f.write(), headers: { "content-type": "text/plain" } }))!.status).toBe(415);
  expect((await f.progressCall("/self-check", { who: "learner", body: { ...f.write(), state: "x".repeat(17_000) } }))!.status).toBe(413);
  const query = new URLSearchParams(Object.entries(f.binding).map(([key, value]) => [key, String(value)])).toString();
  for (const suffix of [`?${query}&mode=student`, `?${query}&unknown=1`, `?${query}&offset=1000`, `?${query}&offset=-1`, `?${query}&offset=1.5`]) expect((await f.progressCall(suffix))!.status).toBe(400);
  expect(await f.owner(() => f.db.select().from(s.verseSelfCheck))).toHaveLength(0);
});

test("unowned and wrong-method progress routes do not initialize runtime and owned responses stay sanitized", async () => {
  let starts = 0; const dispatch = createHttpDispatcher(async () => { starts++; throw new Error("Synthetic private diagnostic"); });
  for (const [method, path, status] of [["POST", "/api/students/synthetic/progress", 405], ["GET", "/api/students/synthetic/progress/self-check", 405], ["POST", "/api/students/synthetic/progress/history", 404]] as const) expect((await dispatch(new Request(`http://localhost:3000${path}`, { method }))).status).toBe(status);
  expect(starts).toBe(0);
  const denied = await dispatch(new Request("http://localhost:3000/api/students/synthetic/progress")); expect(denied.status).toBe(503); expect(await denied.json()).toEqual({ error: "unavailable" });
});

test("progress tables enforce tenant RLS, qualified assignment relationships, state/version checks and immutable identity", async () => {
  const f = await fixture(), within = <T>(action: (tx: AccessTransaction<PgliteQueryResultHKT>) => Promise<T>) => withTenantTransaction(f.db, { tenantId: "crc" }, action);
  const row = { tenantId: "crc", studentId: f.selection.studentId, assignmentId: f.assignment.id, verseRef: f.refs[0], state: "working", version: 1 };
  await within(tx => tx.insert(s.verseSelfCheck).values(row));
  expect(await withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.select().from(s.verseSelfCheck))).toHaveLength(0);
  expect(await sqlState(withTenantTransaction(f.db, { tenantId: "other" }, tx => tx.insert(s.verseAssessment).values({ ...row, state: "solid" })))).toBe("42501");
  expect(await sqlState(within(tx => tx.insert(s.verseAssessment).values({ ...row, studentId: f.students[1].id, state: "solid" })))).toBe("23503");
  expect(await sqlState(within(tx => tx.insert(s.verseAssessment).values({ ...row, state: "got-it" })))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.verseSelfCheck).set({ state: "got-it" }).where(eq(s.verseSelfCheck.assignmentId, f.assignment.id))))).toBe("23514");
  expect(await sqlState(within(tx => tx.update(s.verseSelfCheck).set({ verseRef: "Genesis 1:2" }).where(eq(s.verseSelfCheck.assignmentId, f.assignment.id))))).toBe("42501");
  await within(tx => tx.update(s.verseSelfCheck).set({ state: "unmarked", version: 2 }).where(eq(s.verseSelfCheck.assignmentId, f.assignment.id)));
  expect(await within(tx => tx.select({ state: s.verseSelfCheck.state, version: s.verseSelfCheck.version }).from(s.verseSelfCheck))).toEqual([{ state: "unmarked", version: 2 }]);
  const policies = await f.owner(() => f.db.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname in ('verse_self_check','verse_assessment')`));
  expect(policies.rows).toHaveLength(2); expect(policies.rows.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
});
