import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { AccessTransaction } from "../../src/server/access/types";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { admitReviewBatch } from "../../src/server/data/reference-review";
import { createReferenceReviewService } from "../../src/server/reference-review/service";
import { REVIEW_CHECKS } from "../../src/server/reference-review/batch-contract";
import { syntheticReferenceReview } from "../helpers/reference-review";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";
import { query } from "./disposable.mjs";

type Base = Awaited<ReturnType<typeof postgresAccessFixture>>;
const opened: Base[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of opened.splice(0)) await f.close(); });
const safe = (work: Promise<unknown>) => work.catch(error => ({ denied: error instanceof AccessDenied ? error.status : 503 }));
async function sqlState(work: PromiseLike<unknown>) {
  try { await work; return "accepted"; } catch (error) {
    let current = error as { code?: unknown; cause?: unknown } | undefined;
    for (let i = 0; current && i < 4; i++, current = current.cause as typeof current) if (typeof current.code === "string" && /^[A-Z0-9]{5}$/.test(current.code)) return current.code;
    return "unknown";
  }
}
async function fixture() {
  const f = await postgresAccessFixture(); opened.push(f); const data = syntheticReferenceReview();
  await f.ownerDb.transaction(tx => admitReviewBatch(tx as unknown as AccessTransaction<NodePgQueryResultHKT>, { tenantId: "crc", id: data.batchId, reviewerUserId: f.admin.id,
    manifestBytes: data.prepared.bytes, manifestSha256: data.prepared.sha256, expiresAt: new Date(Date.now() + 3600000) }));
  const get = vi.fn(data.get), reviewer = { tenantId: "crc" as const, userId: f.admin.id };
  const reviewA = createReferenceReviewService({ access: f.a, reviewer, get }), reviewB = createReferenceReviewService({ access: f.b, reviewer, get });
  const mutation = () => ({ ...f.request("admin"), method: "POST", headers: new Headers({ cookie: f.admin.cookie, origin: "http://localhost:3000" }) });
  const revoke = { generation: 1, manifestSha256: data.prepared.sha256 };
  return { ...f, data, get, reviewA, reviewB, mutation, revoke };
}

test("measured PostgreSQL batch lock serializes simultaneous decisions and rejects the stale revision", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('insert into "reference_review_decision"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.reviewA.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision())); let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.reviewB.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision())); await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, decision: { revision: 1, studentReady: false } }); expect(await b).toEqual({ ok: false, error: "conflict" });
  expect(await f.ownerDb.select().from(s.referenceReviewDecision)).toHaveLength(1);
});

test("a revocation that owns the real batch lock beats a concurrent approval without appending evidence", async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  const stop = await f.intercept("a", text => text.startsWith('update "reference_review_batch"'), async proceed => { const result = await proceed(); entered.resolve(); await release.promise; return result; });
  const a = safe(f.reviewA.revoke(f.mutation(), f.data.batchId, f.revoke)); let b: Promise<unknown> | undefined;
  try {
    await waitForEntry(entered.promise, a);
    b = safe(f.reviewB.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision())); await f.waitForLock(f.pidB, f.pidA);
  } finally { release.resolve(); stop(); await Promise.all([a, b]); }
  expect(await a).toMatchObject({ ok: true, revoked: true, generation: 2 }); expect(await b).toEqual({ denied: 404 });
  expect(await f.ownerDb.select().from(s.referenceReviewDecision)).toEqual([]);
});

for (const action of ["decide", "media"] as const) test(`revocation while private bytes are being fetched prevents ${action}`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred();
  f.get.mockImplementationOnce(async path => { entered.resolve(); await release.promise; return f.data.get(path); });
  const a = safe(action === "decide" ? f.reviewA.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision()) : f.reviewA.media(f.request("admin"), f.data.batchId, f.data.assetKey));
  try { await waitForEntry(entered.promise, a); expect(await f.reviewB.revoke(f.mutation(), f.data.batchId, f.revoke)).toMatchObject({ revoked: true }); }
  finally { release.resolve(); await a; }
  expect(await a).toEqual({ denied: 404 }); expect(await f.ownerDb.select().from(s.referenceReviewDecision)).toEqual([]);
});

for (const expiry of ["session", "batch"] as const) test(`real batch lock wait rechecks wall-clock ${expiry} expiry`, async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), until = Date.now() + 60000;
  if (expiry === "session") await f.ownerDb.update(s.session).set({ expiresAt: new Date(until) }).where(eq(s.session.id, f.admin.sessionId));
  const ownerPid = (await query<{ pid: number }>(f.owner, "select pg_backend_pid() as pid")).rows[0].pid;
  const hold = safe(f.ownerDb.transaction(async tx => { await tx.execute(sql`select id from reference_review_batch where id=${f.data.batchId} for update`); entered.resolve(); await release.promise; }));
  let work: Promise<unknown> | undefined, restore: (() => void) | undefined;
  try {
    await waitForEntry(entered.promise, hold); work = safe(f.reviewA.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision()));
    await f.waitForLock(f.pidA, ownerPid); const clock = vi.spyOn(Date, "now").mockReturnValue(expiry === "session" ? until + 1 : until + 2 * 3600000); restore = () => clock.mockRestore();
  } finally { release.resolve(); await Promise.all([hold, work]); restore?.(); }
  expect(await work).toEqual({ denied: expiry === "session" ? 401 : 404 }); expect(f.get).not.toHaveBeenCalled();
  expect(await f.ownerDb.select().from(s.referenceReviewDecision)).toEqual([]);
});

test("native SQL proves RLS, runtime admission refusal, append-only records, immutable manifest and all-five JSON-null rejection", async () => {
  const f = await fixture(); expect(await f.reviewA.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision())).toMatchObject({ ok: true });
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.referenceReviewBatch))).toEqual([]);
  expect(await withTenantTransaction(f.aDb, { tenantId: "other" }, tx => tx.select().from(s.referenceReviewDecision))).toEqual([]);
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: randomUUID(), manifestSha256: "a".repeat(64), catalogSha256: "b".repeat(64), reviewerUserId: f.admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 60000) })))).toBe("42501");
  expect(await sqlState(withTenantTransaction(f.aDb, { tenantId: "crc" }, tx => tx.delete(s.referenceReviewDecision)))).toBe("42501");
  expect(await sqlState(f.ownerDb.update(s.referenceReviewDecision).set({ revision: 2 }))).toBe("P0001");
  expect(await sqlState(f.ownerDb.delete(s.referenceReviewDecision))).toBe("P0001");
  expect(await sqlState(f.ownerDb.update(s.referenceReviewBatch).set({ manifestSha256: "c".repeat(64) }))).toBe("P0001");
  const [row] = await f.ownerDb.select().from(s.referenceReviewDecision);
  for (const key of REVIEW_CHECKS) expect(await sqlState(f.ownerDb.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2, checks: { ...row.checks, [key]: null } as never }))).toBe("23514");
  await f.reviewB.revoke(f.mutation(), f.data.batchId, f.revoke);
  expect(await sqlState(f.ownerDb.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2 }))).toBe("P0001");
});

for (const example of ["audio-session", "audio-batch", "decision-session"] as const) test(`delayed actual COMMIT cannot return a response after ${example} expiry`, async () => {
  const f = await fixture(), until = Date.now() + 60000; let fetched = false, restore: (() => void) | undefined;
  if (example.endsWith("session")) await f.ownerDb.update(s.session).set({ expiresAt: new Date(until) }).where(eq(s.session.id, f.admin.sessionId));
  f.get.mockImplementation(async path => { if (example.startsWith("decision") || path.endsWith(".mp3")) fetched = true; return f.data.get(path); });
  const stop = await f.intercept("a", text => text.toLowerCase() === "commit", async proceed => {
    const result = await proceed();
    if (fetched) { const clock = vi.spyOn(Date, "now").mockReturnValue(example.endsWith("session") ? until + 1 : until + 2 * 3600000); restore = () => clock.mockRestore(); }
    return result;
  });
  let result: unknown;
  try { result = await safe(example.startsWith("audio") ? f.reviewA.media(f.request("admin"), f.data.batchId, f.data.assetKey) : f.reviewA.decide(f.mutation(), f.data.batchId, f.data.assetKey, f.data.decision())); }
  finally { stop(); restore?.(); }
  expect(result).toEqual({ denied: example.endsWith("session") ? 401 : 404 });
  expect(await f.ownerDb.select().from(s.referenceReviewDecision)).toHaveLength(example.startsWith("decision") ? 1 : 0);
});
