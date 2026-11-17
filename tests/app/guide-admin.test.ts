import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { guide } from "../helpers/study-guide-fixture";

// The admin's Guides page (gap A6). Synthetic prose and invented sources only. Asserts statuses, codes, row state and stable keys, never wording.
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const OVERVIEW = "/api/admin/guides", TEXT = "/api/admin/guides/text";
const WITHDRAW_DISCUSSION = "/api/admin/guides/discussions/withdraw", APPROVE = "/api/admin/guides/summaries/approve", WITHDRAW_SUMMARY = "/api/admin/guides/summaries/withdraw";
const REF = "Invented Commentary on Exodus 40:34:1";
const OUTLINE = Array.from({ length: 7 }, (_, i) => `Synthetic aliyah ${i + 1}: a short line.`);
const digest = "a".repeat(64);

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => {
    const response = await dispatch(f.request(path, options)); const text = await response.text();
    let body: unknown = null; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body: body as any, text }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const otherMember = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  const otherGrant = await f.owner(async () => (await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "admin" }).returning())[0]);
  const actor = (tenantId: "crc" | "other") => tenantId === "crc" ? { member: f.adminMember, grant: f.adminGrant } : { member: otherMember, grant: otherGrant };
  const seedGuide = (tenantId: "crc" | "other", readingKey: string, version: number, extra: Partial<typeof s.studyGuide.$inferInsert> = {}) => f.owner(async () => {
    const { member, grant } = actor(tenantId);
    await f.db.insert(s.studyGuide).values({ tenantId, kind: "torah", readingKey, version, baseVersion: version - 1, previousVersion: version === 1 ? null : version - 1, origin: "claude", reviewed: false, hold: false,
      body: guide(), actorUserId: member.userId, actorMembershipId: member.id, roleGrantId: grant.id, role: "admin", mode: "admin", channel: "mcp", mutationId: randomUUID(), requestDigest: digest, ...extra });
  });
  const seedDiscussion = (tenantId: "crc" | "other", slug: string) => f.owner(async () => {
    const { member } = actor(tenantId);
    await f.db.transaction(async tx => {
      const [d] = await tx.insert(s.curatedDiscussion).values({ tenantId, slug, title: `Synthetic ${slug}`, kind: "torah", status: "published", selectedBy: member.id, mutationId: randomUUID(), requestDigest: digest }).returning();
      await tx.insert(s.curatedDiscussionSource).values({ tenantId, discussionId: d.id, revision: 1, position: 1, ref: REF, anchorRef: "Exodus 40:34", edition: "Invented English Edition", selectedBy: member.id, selectedByName: "Rabbi Test" });
    });
  });
  const seedSummary = (tenantId: "crc" | "other", readingKey: string, revision: number, summary: string) => f.owner(async () => {
    await f.db.insert(s.portionSummary).values({ tenantId, readingKey, revision, status: "draft", summary, outline: OUTLINE, draftedBy: actor(tenantId).member.id, mutationId: randomUUID(), requestDigest: digest });
  });
  const credit = () => f.owner(async () => { await f.db.update(s.tenant).set({ summaryCredit: "Rabbi Synthetic" }).where(eq(s.tenant.id, "crc")); });
  const discussion = (tenantId: string, slug: string) => f.owner(async () => (await f.db.select({ status: s.curatedDiscussion.status, revision: s.curatedDiscussion.revision }).from(s.curatedDiscussion)
    .where(and(eq(s.curatedDiscussion.tenantId, tenantId), eq(s.curatedDiscussion.slug, slug))))[0]);
  const summaries = (tenantId: string) => f.owner(async () => (await f.db.select({ readingKey: s.portionSummary.readingKey, revision: s.portionSummary.revision, status: s.portionSummary.status })
    .from(s.portionSummary).where(eq(s.portionSummary.tenantId, tenantId))).sort((a, b) => a.revision - b.revision));
  const post = (path: string, body: unknown, who: "admin" | "multi" | "learner" | "anonymous" = "admin", origin?: string) =>
    send(path, { who, method: "POST", body, ...(origin ? { origin: origin.startsWith("http://localhost") ? origin : undefined, headers: { origin } } : {}) });
  return { ...f, send, post, seedGuide, seedDiscussion, seedSummary, credit, discussion, summaries };
}

async function seeded() {
  const f = await fixture();
  // pekudei: a reviewed visible version 1 with a held draft over it; vayera: a published Claude draft.
  await f.seedGuide("crc", "pekudei", 1, { origin: "rabbi", reviewed: true });
  await f.seedGuide("crc", "pekudei", 2, { hold: true, body: guide({ overview: "HELD-DRAFT overview, not yet released." }) });
  await f.seedGuide("crc", "vayera", 1);
  await f.seedDiscussion("crc", "why-this-verse");
  await f.seedSummary("crc", "vayera", 1, "A synthetic draft summary.");
  // Another congregation's content, which the crc admin must never see.
  await f.seedGuide("other", "noach", 1, { body: guide({ overview: "OTHER-TENANT-CANARY overview." }) });
  await f.seedDiscussion("other", "other-tenant-talk");
  await f.seedSummary("other", "noach", 1, "OTHER-TENANT-SUMMARY-CANARY");
  return f;
}

test("the admin's overview lists this congregation's guides, discussions and summaries with their states and reader addresses, and nothing of another congregation's", async () => {
  const f = await seeded();
  const r = await f.send(OVERVIEW, { who: "admin" });
  expect(r.status).toBe(200);
  const guides = Object.fromEntries(r.body.guides.map((g: { readingKey: string }) => [g.readingKey, g]));
  expect(Object.keys(guides).sort()).toEqual(["pekudei", "vayera"]);
  expect(guides.pekudei).toMatchObject({ kind: "torah", state: "held", current: { version: 2, origin: "claude", reviewed: false }, visible: { version: 1, origin: "rabbi", reviewed: true }, reading: { slug: "pekudei" } });
  expect(guides.pekudei.href).toMatch(/^\/read\?reading=pekudei&lens=study$/);
  expect(guides.vayera).toMatchObject({ state: "draft", current: { version: 1 } });
  expect(r.body.discussions).toEqual([expect.objectContaining({ slug: "why-this-verse", status: "published", revision: 1, sourceCount: 1, reading: expect.objectContaining({ slug: "pekudei" }) })]);
  expect(r.body.discussions[0].href).toMatch(/^\/read\?reading=pekudei/);
  expect(r.body.summaries).toEqual([expect.objectContaining({ reading: "vayera", revision: 1, status: "draft", href: null })]);
  for (const canary of ["OTHER-TENANT", "other-tenant-talk", "noach", "example.test", f.adminMember.id, f.adminGrant.id]) expect(r.text, canary).not.toContain(canary);
  // No guide body travels with the list; one version's text is its own read.
  expect(r.text).not.toContain("HELD-DRAFT");
});

test("the full text of one guide version is read only, and another congregation's guide is not found", async () => {
  const f = await seeded();
  const held = await f.send(`${TEXT}?kind=torah&readingKey=pekudei&version=2`, { who: "admin" });
  expect(held.status).toBe(200);
  expect(held.body.guide).toMatchObject({ kind: "torah", readingKey: "pekudei", version: 2, hold: true, label: { origin: "claude", reviewed: false } });
  expect(held.body.guide.body.overview).toContain("HELD-DRAFT");
  expect((await f.send(`${TEXT}?kind=torah&readingKey=noach&version=1`, { who: "admin" })).status).toBe(404);
  expect((await f.send(`${TEXT}?kind=torah&readingKey=pekudei&version=9`, { who: "admin" })).status).toBe(404);
  for (const query of ["kind=student&readingKey=pekudei&version=1", "kind=torah&readingKey=../x&version=1", "kind=torah&readingKey=pekudei&version=0", "kind=torah&readingKey=pekudei"])
    expect([400, 404], query).toContain((await f.send(`${TEXT}?${query}`, { who: "admin" })).status);
  // The page cannot write a guide: there is no such route, and a GET route refuses a POST.
  expect((await f.post(TEXT, {})).status).toBe(405);
  expect((await f.post("/api/admin/guides/publish", { kind: "torah", readingKey: "pekudei", version: 2 })).status).toBe(404);
});

test("a tutor or parent, a student and a signed-out caller are refused on every route, and nothing changes", async () => {
  const f = await seeded();
  const reads = [OVERVIEW, `${TEXT}?kind=torah&readingKey=pekudei&version=2`];
  const writes: [string, unknown][] = [[WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 1 }], [APPROVE, { reading: "vayera", revision: 1 }], [WITHDRAW_SUMMARY, { reading: "vayera", revision: 1 }]];
  await f.credit();
  for (const who of ["multi", "learner"] as const) {
    for (const path of reads) expect((await f.send(path, { who })).status, `${who} ${path}`).toBe(403);
    for (const [path, body] of writes) expect((await f.post(path, body, who)).status, `${who} ${path}`).toBe(403);
    // Malformed input is refused for authority first, not judged.
    for (const [path] of writes) expect((await f.post(path, { nonsense: true }, who)).status, `${who} ${path} malformed`).toBe(403);
  }
  for (const path of reads) expect((await f.send(path, { who: "anonymous" })).status, path).toBe(401);
  for (const [path, body] of writes) expect((await f.post(path, body, "anonymous")).status, path).toBe(401);
  // The other congregation's admin on its own host sees only its own content and cannot reach crc's.
  const elsewhere = await f.send(OVERVIEW, { who: "multi", origin: "http://localhost:3101" });
  expect(elsewhere.status).toBe(200);
  expect(elsewhere.body.guides.map((g: { readingKey: string }) => g.readingKey)).toEqual(["noach"]);
  expect(elsewhere.body.discussions.map((d: { slug: string }) => d.slug)).toEqual(["other-tenant-talk"]);
  expect((await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 1 }, "multi", "http://localhost:3101")).body).toMatchObject({ ok: false, code: "not-found" });
  // A cross-site post is refused even for the admin.
  expect((await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 1 }, "admin", "https://evil.example")).status).toBe(403);
  expect(await f.discussion("crc", "why-this-verse")).toEqual({ status: "published", revision: 1 });
  expect(await f.summaries("crc")).toEqual([{ readingKey: "vayera", revision: 1, status: "draft" }]);
});

test("withdrawing a discussion runs the MCP's withdraw: a stale revision is a conflict, and the crc admin cannot withdraw another congregation's", async () => {
  const f = await seeded();
  const stale = await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 7 });
  expect(stale.status).toBe(409); expect(stale.body).toMatchObject({ ok: false, code: "conflict" });
  expect(await f.discussion("crc", "why-this-verse")).toEqual({ status: "published", revision: 1 });
  const done = await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 1 });
  expect(done.status).toBe(200); expect(done.body).toMatchObject({ ok: true, slug: "why-this-verse", revision: 2, status: "withdrawn" });
  expect(await f.discussion("crc", "why-this-verse")).toEqual({ status: "withdrawn", revision: 2 });
  expect((await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse", revision: 2 })).body).toMatchObject({ ok: false, code: "withdrawn" });
  expect((await f.post(WITHDRAW_DISCUSSION, { slug: "other-tenant-talk", revision: 1 })).body).toMatchObject({ ok: false, code: "not-found" });
  expect(await f.discussion("other", "other-tenant-talk")).toEqual({ status: "published", revision: 1 });
  // A withdrawn discussion stays listed, with no reader address.
  const listed = (await f.send(OVERVIEW, { who: "admin" })).body.discussions[0];
  expect(listed).toMatchObject({ slug: "why-this-verse", status: "withdrawn", href: null });
  expect((await f.post(WITHDRAW_DISCUSSION, { slug: "why-this-verse" })).status).toBe(400);
});

test("approving and withdrawing a portion summary run the MCP's own functions: one approved at a time, a stale revision refused, another congregation's untouched", async () => {
  const f = await seeded();
  expect((await f.post(APPROVE, { reading: "vayera", revision: 1 })).body).toMatchObject({ ok: false, code: "no-credit" });
  await f.credit();
  const approved = await f.post(APPROVE, { reading: "vayera", revision: 1 });
  expect(approved.status).toBe(200); expect(approved.body).toMatchObject({ ok: true, reading: "vayera", revision: 1, status: "approved", credit: "Rabbi Synthetic" });
  // Approving it again is refused: it is no longer a draft.
  expect((await f.post(APPROVE, { reading: "vayera", revision: 1 })).body).toMatchObject({ ok: false, code: "not-draft" });
  await f.seedSummary("crc", "vayera", 2, "A second synthetic draft.");
  expect((await f.post(APPROVE, { reading: "vayera", revision: 2 })).status).toBe(200);
  expect(await f.summaries("crc")).toEqual([{ readingKey: "vayera", revision: 1, status: "withdrawn" }, { readingKey: "vayera", revision: 2, status: "approved" }]);
  const listed = (await f.send(OVERVIEW, { who: "admin" })).body.summaries.find((x: { revision: number }) => x.revision === 2);
  expect(listed.href).toMatch(/^\/read\?reading=vayera&lens=study$/);
  expect((await f.post(WITHDRAW_SUMMARY, { reading: "vayera", revision: 9 })).body).toMatchObject({ ok: false, code: "not-found" });
  expect((await f.post(WITHDRAW_SUMMARY, { reading: "vayera", revision: 2 })).body).toMatchObject({ ok: true, status: "withdrawn", wasApproved: true });
  expect((await f.post(WITHDRAW_SUMMARY, { reading: "vayera", revision: 2 })).body).toMatchObject({ ok: false, code: "withdrawn" });
  expect((await f.post(WITHDRAW_SUMMARY, { reading: "noach", revision: 1 })).body).toMatchObject({ ok: false, code: "not-found" });
  expect(await f.summaries("other")).toEqual([{ readingKey: "noach", revision: 1, status: "draft" }]);
  expect((await f.post(APPROVE, { reading: "vayera", revision: 2, extra: 1 })).status).toBe(400);
});
