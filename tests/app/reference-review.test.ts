import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accessFixture } from "./access-fixture";
import { syntheticReferenceReview } from "../helpers/reference-review";
import { admitReviewBatch } from "../../src/server/data/reference-review";
import { createReferenceReviewService } from "../../src/server/reference-review/service";
import { handleReferenceReviewRequest } from "../../src/server/http/reference-review";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { HttpRuntime } from "../../src/server/runtime/composition";
import { REVIEW_CHECKS, REVIEW_LIMITS, ReviewUnavailable, buildReviewManifest, parseReviewManifest, reviewHash } from "../../src/server/reference-review/batch-contract";
import { loadReviewAudio, readVerifiedReviewBytes, reviewAudioPath } from "../../src/server/reference-review/batch-storage";
import * as s from "../../src/server/db/index";
import type { AccessTransaction } from "../../src/server/access/types";
import type { PgliteQueryResultHKT } from "drizzle-orm/pglite";

const fixtures: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await accessFixture(); fixtures.push(f); const data = syntheticReferenceReview();
  await f.owner(() => f.db.transaction(tx => admitReviewBatch(tx as unknown as AccessTransaction<PgliteQueryResultHKT>, { tenantId: "crc", id: data.batchId, reviewerUserId: f.identities.admin.id,
    manifestBytes: data.prepared.bytes, manifestSha256: data.prepared.sha256, expiresAt: new Date(Date.now() + 3600000) })));
  const get = vi.fn(data.get), service = createReferenceReviewService({ access: f.service, reviewer: { tenantId: "crc", userId: f.identities.admin.id }, get });
  const path = `/api/reference-review/batches/${data.batchId}`;
  function request(suffix = "", body?: unknown, who: "admin" | "multi" | "learner" = "admin", extra: Record<string, string> = {}) {
    const headers = { cookie: f.identities[who].cookie, ...(body === undefined ? {} : { origin: "http://localhost:3000", "content-type": "application/json" }), ...extra };
    return new Request(`http://localhost:3000${path}${suffix}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const call = async (suffix = "", body?: unknown, who: "admin" | "multi" | "learner" = "admin", extra: Record<string, string> = {}) => (await handleReferenceReviewRequest(request(suffix, body, who, extra), service))!;
  return { ...f, data, get, review: service, path, reviewRequest: request, call };
}

test("private review delivers only verified bytes, five separate durable checks and immutable history without release or timings", async () => {
  const f = await fixture();
  const list = await f.review.list(f.reviewRequest()); expect(list.batches).toHaveLength(1); expect(list.batches[0]).toMatchObject({ studentReady: false, timing: "unavailable" });
  const detail = await f.call(); expect(detail.status).toBe(200); expect(detail.headers.get("cache-control")).toBe("private, no-store");
  expect(await detail.json()).toMatchObject({ entries: [{ decision: null, text: [{ readingText: "א" }] }] });
  const audio = await f.call(`/media/${f.data.assetKey}`); expect(audio.status).toBe(200); expect(audio.headers.get("content-type")).toBe("audio/mpeg"); expect(new Uint8Array(await audio.arrayBuffer())).toEqual(f.data.media);
  expect(audio.headers.get("referrer-policy")).toBe("no-referrer"); expect(audio.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  const write = f.data.decision(); const accepted = await f.call(`/decisions/${f.data.assetKey}`, write); expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ ok: true, decision: { revision: 1, wholeClipAccepted: true, studentReady: false, timing: "unavailable", checks: f.data.checks } });
  expect((await f.call(`/decisions/${f.data.assetKey}`, write)).status).toBe(200);
  expect((await f.call(`/decisions/${f.data.assetKey}`, { ...write, checks: { ...write.checks, privacy: "hold" } })).status).toBe(409);
  expect((await f.call(`/decisions/${f.data.assetKey}`, f.data.decision())).status).toBe(409);
  const held = await f.call(`/decisions/${f.data.assetKey}`, { ...f.data.decision(), expectedRevision: 1, checks: { ...write.checks, privacy: "hold" } });
  expect(await held.json()).toMatchObject({ decision: { revision: 2, wholeClipAccepted: false } });
  const rows = await f.owner(() => f.db.select().from(s.referenceReviewDecision)); expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ manifestSha256: f.data.prepared.sha256, catalogSha256: f.data.plan.catalogSha256, identitySha256: f.data.plan.candidates[0].identitySha256, playbackSha256: reviewHash(f.data.media), playbackBytes: f.data.media.length, actorUserId: f.identities.admin.id });
  const projection = JSON.stringify(await (await f.call()).json()); expect(projection).not.toMatch(/actorUserId|actorSessionId|roleGrantId|private\.blob|prepared\//);
  expect(await f.owner(() => f.db.select().from(s.assignment))).toHaveLength(0);
});

test("only configured Daniel with a live admin/session/membership can touch the private getter", async () => {
  const f = await fixture();
  await f.owner(() => f.db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: f.multiMember.id, role: "admin" }));
  for (const who of ["multi", "learner"] as const) expect((await f.call("", undefined, who)).status).toBe(404);
  expect(f.get).not.toHaveBeenCalled();
  const disabled = createReferenceReviewService({ access: f.service, reviewer: undefined, get: f.get }); expect((await handleReferenceReviewRequest(f.reviewRequest(), disabled))!.status).toBe(503);
  const foreign = new Request(`http://localhost:3101${f.path}`, { headers: { cookie: f.identities.admin.cookie } }); expect((await handleReferenceReviewRequest(foreign, f.review))!.status).toBe(404);
  expect((await f.call("", undefined, "admin", { "X-Practice-Context": "synthetic" })).status).toBe(403);
  await f.owner(() => f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)));
  expect((await f.call()).status).toBe(404); expect(f.get).not.toHaveBeenCalled();
});

test("transport rejects CSRF, body/query extras, guessed members, ranges and all unimplemented release/admission routes", async () => {
  const f = await fixture(), action = `/decisions/${f.data.assetKey}`, write = f.data.decision();
  expect((await f.call(action, write, "admin", { origin: "https://foreign.example.test" })).status).toBe(403);
  expect((await f.call(action, { ...write, studentReady: true })).status).toBe(400);
  expect((await f.call(action, { ...write, checks: { ...write.checks, phraseTiming: "pass" } })).status).toBe(400);
  expect((await f.call("?mode=admin")).status).toBe(400);
  expect((await f.call(`/media/${f.data.assetKey}`, undefined, "admin", { range: "bytes=0-5" })).status).toBe(400);
  expect((await f.call(`/media/fj_${"2".repeat(20)}`)).status).toBe(404);
  expect(await handleReferenceReviewRequest(f.reviewRequest("/release", {}), f.review)).toBeNull();
  expect(await handleReferenceReviewRequest(f.reviewRequest("/admit", {}), f.review)).toBeNull();
  expect(await f.owner(() => f.db.select().from(s.referenceReviewDecision))).toHaveLength(0);
});

for (const change of ["revoke", "role-revision", "membership-revision", "expiry"] as const) test(`authority change during audio fetch (${change}) prevents any delivery`, async () => {
  const f = await fixture();
  f.get.mockImplementation(async path => {
    if (path.endsWith(".mp3")) {
      if (change === "revoke") await f.review.revoke(f.reviewRequest("/revoke", {}), f.data.batchId, { generation: 1, manifestSha256: f.data.prepared.sha256 });
      else if (change === "role-revision") await f.owner(() => f.db.update(s.roleGrant).set({ revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)));
      else if (change === "membership-revision") await f.owner(() => f.db.update(s.membership).set({ authorityRevision: 2 }).where(eq(s.membership.id, f.adminMember.id)));
      else vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2 * 3600000);
    }
    return f.data.get(path);
  });
  const response = await f.call(`/media/${f.data.assetKey}`); expect([401, 404]).toContain(response.status); expect(response.headers.get("content-type")).toContain("application/json");
});

test("revoke during manifest fetch prevents a stale decision and keeps its history empty", async () => {
  const f = await fixture();
  f.get.mockImplementationOnce(async path => { await f.review.revoke(f.reviewRequest("/revoke", {}), f.data.batchId, { generation: 1, manifestSha256: f.data.prepared.sha256 }); return f.data.get(path); });
  expect((await f.call(`/decisions/${f.data.assetKey}`, f.data.decision())).status).toBe(404);
  expect(await f.owner(() => f.db.select().from(s.referenceReviewDecision))).toHaveLength(0);
  expect((await f.call()).status).toBe(404); expect((await f.review.list(f.reviewRequest())).batches).toEqual([]);
});

for (const example of ["audio-session", "audio-batch", "audio-abort", "list-batch", "decision-session"] as const) test(`final transport barrier covers delayed runtime cleanup (${example})`, async () => {
  const f = await fixture(), until = Date.now() + 60000, controller = new AbortController();
  if (example.endsWith("session")) await f.owner(() => f.db.update(s.session).set({ expiresAt: new Date(until) }).where(eq(s.session.id, f.identities.admin.sessionId)));
  const runtime = { referenceReview: f.review, resolveHost: async () => undefined } as unknown as HttpRuntime;
  const dispatch = createHttpDispatcher(async action => { const response = await action(runtime); await Promise.resolve(); if (example === "audio-abort") controller.abort(); else vi.spyOn(Date, "now").mockReturnValue(example.endsWith("session") ? until + 1 : until + 2 * 3600000); return response; });
  const request = example.startsWith("audio") ? f.reviewRequest(`/media/${f.data.assetKey}`) : example.startsWith("decision") ? f.reviewRequest(`/decisions/${f.data.assetKey}`, f.data.decision())
    : new Request("http://localhost:3000/api/reference-review/batches", { headers: { cookie: f.identities.admin.cookie } });
  const response = await dispatch(new Request(request, { signal: controller.signal }));
  expect(response.status).toBe(example === "list-batch" ? 200 : example.endsWith("session") ? 401 : 404);
  expect(response.headers.get("content-type")).toContain("application/json"); expect(response.headers.get("cache-control")).toBe("private, no-store");
  if (example === "list-batch") expect(await response.json()).toEqual({ ok: true, batches: [] });
  if (example.startsWith("decision")) expect(await f.owner(() => f.db.select().from(s.referenceReviewDecision))).toHaveLength(1);
});

test("migration enforces append-only decisions, immutable binding controls, no runtime admission and strict checklist values", async () => {
  const f = await fixture(); await f.call(`/decisions/${f.data.assetKey}`, f.data.decision());
  await expect(f.owner(() => f.db.update(s.referenceReviewDecision).set({ revision: 3 }))).rejects.toThrow();
  await expect(f.owner(() => f.db.delete(s.referenceReviewDecision))).rejects.toThrow();
  await expect(f.owner(() => f.db.update(s.referenceReviewBatch).set({ manifestSha256: "b".repeat(64) }))).rejects.toThrow();
  await expect(f.db.insert(s.referenceReviewBatch).values({ tenantId: "crc", id: randomUUID(), manifestSha256: "a".repeat(64), catalogSha256: "b".repeat(64), reviewerUserId: f.identities.admin.id, entryCount: 1, expiresAt: new Date(Date.now() + 60000) })).rejects.toThrow();
  const [row] = await f.owner(() => f.db.select().from(s.referenceReviewDecision));
  for (const key of REVIEW_CHECKS) await expect(f.owner(() => f.db.insert(s.referenceReviewDecision).values({ ...row, requestId: randomUUID(), revision: 2, checks: { ...row.checks, [key]: null } as never }))).rejects.toThrow();
  const flags = await f.owner(() => f.db.execute(sql`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('reference_review_batch','reference_review_decision')`));
  expect(flags.rows).toHaveLength(2); expect(flags.rows.every(row => row.relrowsecurity === true && row.relforcerowsecurity === true)).toBe(true);
});

test("manifest and body readers reject substitutions, declared limits and unavailable source classes", async () => {
  const f = syntheticReferenceReview(), entry = f.prepared.manifest.entries[0];
  const changed = structuredClone(f.prepared.manifest) as unknown as { entries: { identitySha256: string; playback: { bytes: number } }[]; studentReady: boolean };
  changed.entries[0].identitySha256 = "a".repeat(64); const bytes = new TextEncoder().encode(JSON.stringify(changed)); expect(() => parseReviewManifest(bytes, reviewHash(bytes))).toThrow(ReviewUnavailable);
  expect(() => parseReviewManifest(f.prepared.bytes, "b".repeat(64))).toThrow(ReviewUnavailable);
  for (const readingText of ["<script>", "א\u0000", "א\u202e", "א\u2066", "\ud800"]) expect(() => buildReviewManifest(f.plan, [{ assetKey: f.assetKey, text: [{ ref: "Genesis 1:1", readingText }] }])).toThrow();
  const over = structuredClone(f.plan); (over.candidates[0] as unknown as { disposition: string }).disposition = "held"; expect(() => buildReviewManifest(over, [{ assetKey: f.assetKey, text: [{ ref: "Genesis 1:1", readingText: "א" }] }])).toThrow();
  const truncated = async () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(f.media.slice(1)); c.close(); } });
  await expect(loadReviewAudio(truncated, entry)).rejects.toThrow(ReviewUnavailable);
  const overlong = async () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(f.media.length + 1)); c.close(); } });
  await expect(loadReviewAudio(overlong, entry)).rejects.toThrow(ReviewUnavailable);
  const empty = async () => new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 65; i++) c.enqueue(new Uint8Array()); c.close(); } });
  await expect(readVerifiedReviewBytes(empty, reviewAudioPath(entry.playback.sha256), entry.playback.sha256, 64)).rejects.toThrow(ReviewUnavailable);
  await expect(readVerifiedReviewBytes(f.get, "unused", entry.playback.sha256, REVIEW_LIMITS.audioBytes + 1)).rejects.toThrow(ReviewUnavailable);
});
