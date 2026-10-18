// Independent synthetic fixtures against explicit disposable loopback PostgreSQL only.
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { createPracticeService } from "../../src/server/practice/service";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { discoverRelatedPage } from "../../src/server/study/sources/discovery";
import { AccessDenied } from "../../src/server/access/errors";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const fixtures: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
function safe<T>(value: PromiseLike<T>) { return Promise.resolve(value).then(result => result, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function sqlState(value: PromiseLike<unknown>) {
  try { await value; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let depth = 0; current && depth < 4; depth++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
async function ownerWait(f: Base, blocked: number, blocker: number) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { const result = await f.bDb.execute(sql`select ${blocker}::integer = any(pg_blocking_pids(${blocked}::integer)) as blocked`); if (result.rows[0]?.blocked === true) return; await delay(10); }
  throw new Error("Expected owned PostgreSQL blocking edge missing");
}
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1-2", status: "confirmed", setByMembershipId: member.id, proposalSnapshot: { confirmationDate: f.student.ceremonyDate, needsReview: false } }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` })));
  const data = parseRelatedMetadata([0, 1].map(n => ({ _id: `native-${n}`, sourceRef: `Invented Commentary ${n + 1}`, index_title: "Invented Work", category: "Commentary", anchorRef: "Genesis 1:1" })), "Genesis 1:1"), page = discoverRelatedPage(data, data.verse, { sourceOffset: 0 });
  if (page.status !== "ready") throw new Error("Synthetic metadata unavailable");
  const related = vi.fn(async () => data);
  const sourceA = createSourceAssignmentsService({ access: f.a, practice: createPracticeService({ access: f.a }), related });
  const sourceB = createSourceAssignmentsService({ access: f.b, practice: createPracticeService({ access: f.b }), related });
  const selection = { mode: "tutor" as const, studentId: f.student.id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 };
  const sourceRequest = (who: "admin" | "tutor" = "tutor") => { const request = f.request(who); request.headers.set("origin", "http://localhost:3000"); return { ...request, method: "POST" }; };
  const intent = (ids = ["native-0"], expectedVersion = 0) => ({ verseRef: data.verse, expectedVersion, mutationId: randomUUID(), sourceIds: [...ids], catalogHash: page.page.catalogHash });
  return { ...f, assignment, data, related, sourceA, sourceB, selection, sourceRequest, intent, rows: () => f.ownerDb.select().from(s.verseSourceAssignment) };
}

test("review actual lost COMMIT acknowledgement reconciles one immutable original receipt without another lookup or audit", async () => {
  const f = await fixture(), intent = f.intent(); let inserted = false;
  const stop = await f.intercept("a", text => { if (text.startsWith('insert into "verse_source_assignment"')) inserted = true; return inserted && /^commit$/i.test(text); }, async proceed => { await proceed(); throw new Error("Synthetic lost acknowledgement after actual COMMIT"); });
  try { expect(await safe(f.sourceA.replace(f.sourceRequest(), f.selection, intent))).toEqual({ denied: 503 }); } finally { stop(); }
  expect(await f.rows()).toHaveLength(1); const before = await f.ownerDb.select().from(s.auditEvent); f.related.mockClear();
  expect(await f.sourceB.receipt(f.sourceRequest(), f.selection, intent)).toMatchObject({ ok: true, outcome: "committed", committedVersion: 1, currentLatestVersion: 1 });
  expect(await f.sourceB.replace(f.sourceRequest(), f.selection, intent)).toMatchObject({ ok: true, replayed: true, committedVersion: 1 });
  expect(f.related).not.toHaveBeenCalled(); expect(await f.rows()).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent)).toEqual(before);
});

test("review pending original remains unconfirmed and an identical blocked retry commits once after original rollback", async () => {
  const f = await fixture(), intent = f.intent(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "verse_source_assignment"'), async proceed => { await proceed(); entered.resolve(); await release.promise; throw new Error("Synthetic rollback after inserted pending original"); });
  const original = safe(f.sourceA.replace(f.sourceRequest(), f.selection, intent)); let retry: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, original);
    expect(await f.sourceB.receipt(f.sourceRequest(), f.selection, intent)).toMatchObject({ ok: true, outcome: "unconfirmed" });
    retry = safe(f.sourceB.replace(f.sourceRequest(), f.selection, intent)); await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([original, retry]); }
  expect(await original).toEqual({ denied: 503 }); expect(await retry).toMatchObject({ ok: true, replayed: false, committedVersion: 1 });
  expect(await f.rows()).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent)).toHaveLength(1);
});

test("review an actual unique-key wait cannot turn expired tutor authority into a committed version", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), expiresAt = Date.now() + 60_000;
  await f.ownerDb.update(s.session).set({ expiresAt: new Date(expiresAt) }).where(eq(s.session.id, f.tutor.sessionId));
  const stop = await f.intercept("a", text => text.startsWith('insert into "verse_source_assignment"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const winner = safe(f.sourceA.replace(f.sourceRequest("admin"), { ...f.selection, mode: "admin" }, f.intent())); let expired: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try { await waitForEntry(entered.promise, winner); expired = safe(f.sourceB.replace(f.sourceRequest(), f.selection, f.intent(["native-1"]))); await f.waitForLock(f.pidB, f.pidA); const clock = vi.spyOn(Date, "now").mockReturnValue(expiresAt + 1); restore = () => clock.mockRestore(); }
  finally { release.resolve(); stop(); await Promise.all([winner, expired]); restore?.(); }
  expect(await winner).toMatchObject({ ok: true, committedVersion: 1 }); expect(await expired).toEqual({ denied: 401 }); expect(await f.rows()).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent)).toHaveLength(1);
});

test("review actual reading UPDATE waits for the writing transaction; returning verse starts empty and old UUID never adopts a new stream", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), intent = f.intent();
  const stop = await f.intercept("a", text => text.startsWith('insert into "verse_source_assignment"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const save = safe(f.sourceA.replace(f.sourceRequest(), f.selection, intent)); let replacement: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, save); const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
    replacement = safe(f.ownerDb.transaction(async tx => { await tx.update(s.assignment).set({ revision: 2, ref: "Genesis 1:2" }).where(eq(s.assignment.id, f.assignment.id)); await tx.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id)); await tx.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.student.id, assignmentId: f.assignment.id, ordinal: 1, verseRef: "Genesis 1:2" }); return { changed: true }; }));
    await ownerWait(f, ownerPid, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([save, replacement]); }
  expect(await save).toMatchObject({ ok: true }); expect(await replacement).toEqual({ changed: true });
  expect(await f.sourceB.receipt(f.sourceRequest(), f.selection, intent)).toEqual({ ok: false, code: "stale-revision" });
  await f.ownerDb.transaction(async tx => { await tx.update(s.assignment).set({ revision: 3, ref: "Genesis 1:1-2" }).where(eq(s.assignment.id, f.assignment.id)); await tx.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id)); await tx.insert(s.assignmentVerse).values([1, 2].map(n => ({ tenantId: "crc", studentId: f.student.id, assignmentId: f.assignment.id, ordinal: n, verseRef: `Genesis 1:${n}` }))); });
  const current = { ...f.selection, assignmentRevision: 3 };
  expect(await f.sourceB.read(f.sourceRequest(), current, intent.verseRef)).toMatchObject({ ok: true, currentVersion: 0, citations: [] });
  expect(await f.sourceB.replace(f.sourceRequest(), current, intent)).toEqual({ ok: false, code: "conflict" });
  expect(await f.sourceB.replace(f.sourceRequest(), current, { ...intent, mutationId: randomUUID() })).toMatchObject({ ok: true, committedVersion: 1 });
  expect((await f.rows()).map(row => row.assignmentRevision).sort()).toEqual([1, 3]);
});

test("review audit failure itself rolls back the version and receipt and permits only exact same-intent retry", async () => {
  const f = await fixture(), intent = f.intent(), stop = await f.intercept("a", text => text.startsWith('insert into "audit_event"'), async () => { throw new Error("Synthetic audit unavailable"); });
  try { expect(await safe(f.sourceA.replace(f.sourceRequest(), f.selection, intent))).toEqual({ denied: 503 }); } finally { stop(); }
  expect(await f.rows()).toEqual([]); expect(await f.sourceB.receipt(f.sourceRequest(), f.selection, intent)).toMatchObject({ ok: true, outcome: "unconfirmed" });
  expect(await f.sourceB.replace(f.sourceRequest(), f.selection, intent)).toMatchObject({ ok: true, committedVersion: 1 });
  expect(await f.sourceB.replace(f.sourceRequest(), f.selection, { ...intent, expectedVersion: 1, sourceIds: ["native-1"] })).toEqual({ ok: false, code: "conflict" });
  expect(await f.rows()).toHaveLength(1); expect(await f.ownerDb.select().from(s.auditEvent)).toHaveLength(1);
});

test("review SQL enforces full-stream uniqueness, cross-stream UUID uniqueness, composite FKs, RLS and append-only runtime privilege", async () => {
  const f = await fixture(); await f.sourceA.replace(f.sourceRequest(), f.selection, f.intent()); const [row] = await f.rows(), { id: _id, ...values } = row;
  const next = { ...values, version: 2, baseVersion: 1, previousVersion: 1, mutationId: randomUUID() };
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, studentId: f.otherStudent.id }))).toBe("23503");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, actorUserId: f.admin.id }))).toBe("23503");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, baseVersion: 0 }))).toBe("23514");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, previousVersion: null }))).toBe("23514");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, version: 3, baseVersion: 2, previousVersion: 2 }))).toBe("23503");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, version: 1, baseVersion: 0, previousVersion: null }))).toBe("23505");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...values, verseRef: "Genesis 1:2" }))).toBe("23505");
  expect(await sqlState(f.ownerDb.insert(s.verseSourceAssignment).values({ ...next, citations: Array(33).fill(values.citations[0]) }))).toBe("23514");
  expect(await sqlState(f.ownerDb.update(s.verseSourceAssignment).set({ requestDigest: "a".repeat(64) }))).toBe("23514");
  expect(await sqlState(f.ownerDb.delete(s.verseSourceAssignment))).toBe("23514");
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.verseSourceAssignment))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.insert(s.verseSourceAssignment).values(next)))).toBe("42501");
  const facts = await f.ownerDb.execute(sql`select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where oid='verse_source_assignment'::regclass`);
  expect(facts.rows[0]).toEqual({ rls: true, forced: true });
  const grants = await f.ownerDb.execute(sql`select has_table_privilege('portal_runtime','verse_source_assignment','SELECT') as read, has_table_privilege('portal_runtime','verse_source_assignment','INSERT') as append, has_table_privilege('portal_runtime','verse_source_assignment','UPDATE') as update, has_table_privilege('portal_runtime','verse_source_assignment','DELETE') as delete`);
  expect(grants.rows[0]).toEqual({ read: true, append: true, update: false, delete: false });
});
