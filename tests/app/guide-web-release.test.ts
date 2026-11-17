import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudyGuideService, type RabbiAuthority } from "../../src/server/study-guides/service";
import { membershipRabbiAuthority } from "../../src/server/study-guides/authority";
import { guide, note, theme } from "../helpers/study-guide-fixture";

// Release and hold on the web Guides page (Daniel 2026-11-17, migration 0058). Synthetic prose only. Asserts statuses, codes, versions,
// row state and what a reader is served, never wording. The web copies a stored version; it never writes guide text.
const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
const RELEASE = "/api/admin/guides/release", HOLD = "/api/admin/guides/hold";
const pekudei = { date: "2027-03-13", calendar: "diaspora", classification: "regular", haftarah: "I Kings 7:51-8:21",
  reading: { parashah: "Pekudei", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Exodus 38:21-40:38" }] } };
const FIRST = guide({ overview: "FIRST-RELEASE overview.", themes: [theme("cloud", { notes: [note("Exodus 40:34")] })] });
const HELD = guide({ overview: "HELD-DRAFT overview.", themes: [theme("cloud", { notes: [note("Exodus 40:35")] })] });

async function fixture() {
  const f = await portalRoutesFixture(); open.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const studentId = f.students[0].id;
  await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Exodus 40:34-35", status: "confirmed",
      setByMembershipId: f.adminMember.id, proposalSnapshot: { slotProvenance: 1, needsReview: false, source: pekudei } }).returning();
    await f.db.insert(s.assignmentVerse).values([34, 35].map((v, i) => ({ tenantId: "crc", studentId, assignmentId: row.id, ordinal: i + 1, verseRef: `Exodus 40:${v}` })));
  });
  const guides = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check: async ({ body }) => ({ ok: true as const, body }) });
  const mcp = membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id, channel: "mcp", mayReview: true,
    bound: { roleGrantId: f.adminGrant.id, roleGrantRevision: f.adminGrant.revision, authorityRevision: f.adminMember.authorityRevision } });
  // Version one, released through Claude: what readers see first.
  expect(await guides.setBaseGuide(mcp, { kind: "torah", readingKey: "pekudei", expectedVersion: 0, body: FIRST, origin: "claude", reviewed: false, hold: false, mutationId: randomUUID() })).toMatchObject({ ok: true, version: 1 });
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => {
    const response = await dispatch(f.request(path, options));
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const post = (path: string, body: unknown, who: "admin" | "multi" | "learner" | "anonymous" = "admin", extra: { origin?: string; headers?: Record<string, string> } = {}) =>
    send(path, { who, method: "POST", body, ...extra });
  /** What the student's study page is served: the reader-facing read (`studentGuide`). */
  const reader = async () => {
    const r = await send(`/api/students/${studentId}/study-guide?mode=student&kind=torah`, { who: "learner" });
    expect(r.status).toBe(200);
    return r.body.view?.base ? { version: r.body.view.base.version as number, overview: r.body.view.base.overview as string, reviewed: r.body.view.base.label.reviewed as boolean } : null;
  };
  const rows = () => f.owner(async () => f.db.select().from(s.studyGuide).where(and(eq(s.studyGuide.tenantId, "crc"), eq(s.studyGuide.readingKey, "pekudei"))).orderBy(asc(s.studyGuide.version)));
  const audits = (action: string) => f.owner(async () => (await f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.tenantId, "crc"), eq(s.auditEvent.action, action)))).length);
  const holdThroughClaude = async (expectedVersion: number) => expect(await guides.setBaseGuide(mcp, { kind: "torah", readingKey: "pekudei", expectedVersion, body: HELD, origin: "claude", reviewed: false, hold: true, mutationId: randomUUID() }))
    .toMatchObject({ ok: true, held: true });
  return { ...f, send, post, reader, rows, audits, guides, mcp, studentId, holdThroughClaude };
}
const at = (version: number) => ({ kind: "torah", readingKey: "pekudei", version });

test("release a held draft and hold it again from the web: readers see the released copy, then go back to the release before it; Claude reads the same", async () => {
  const f = await fixture();
  await f.holdThroughClaude(1);
  expect(await f.reader()).toMatchObject({ version: 1, overview: expect.stringContaining("FIRST-RELEASE") });
  // A draft held through Claude is not one the rabbi held on the web.
  expect(await f.guides.getBaseGuide(f.mcp, { kind: "torah", readingKey: "pekudei" })).toMatchObject({ held: { version: 2 }, heldFromWeb: false });
  const publishes = await f.audits("study-guide.publish"), sets = await f.audits("study-guide.set");

  const released = await f.post(RELEASE, at(2));
  expect(released.status).toBe(200);
  expect(released.body).toMatchObject({ ok: true, version: 3, held: false });
  expect(await f.reader()).toMatchObject({ version: 3, overview: expect.stringContaining("HELD-DRAFT"), reviewed: false });
  let all = await f.rows();
  // The new row is a copy of version 2, as stored: same text and labels, the web channel, never reviewed by the copy.
  expect(all[2]).toMatchObject({ version: 3, channel: "web", copyOfVersion: 2, hold: false, origin: all[1].origin, reviewed: all[1].reviewed, actorMembershipId: f.adminMember.id });
  expect(all[2].body).toEqual(all[1].body);
  expect(await f.audits("study-guide.publish")).toBe(publishes + 1);
  // MCP parity: get_guide reads it as released.
  expect(await f.guides.getBaseGuide(f.mcp, { kind: "torah", readingKey: "pekudei" })).toMatchObject({ currentVersion: 3, visible: { version: 3 }, held: null });
  const listed = (await f.send("/api/admin/guides", { who: "admin" })).body.guides[0];
  expect(listed).toMatchObject({ state: "draft", current: { version: 3 }, visible: { version: 3 }, afterHold: { version: 1 } });

  const held = await f.post(HOLD, at(3));
  expect(held.status).toBe(200);
  expect(held.body).toMatchObject({ ok: true, version: 4, held: true });
  expect(await f.reader()).toMatchObject({ version: 1, overview: expect.stringContaining("FIRST-RELEASE") });
  all = await f.rows();
  expect(all[3]).toMatchObject({ version: 4, channel: "web", copyOfVersion: 3, hold: true, reviewed: false });
  expect(all[3].body).toEqual(all[2].body);
  expect(await f.audits("study-guide.set")).toBe(sets + 1);
  // MCP parity: get_guide reads it as held, with version 1 in front of readers; publish_guide releases it again.
  expect(await f.guides.getBaseGuide(f.mcp, { kind: "torah", readingKey: "pekudei" })).toMatchObject({ currentVersion: 4, visible: { version: 1 }, held: { version: 4, hold: true }, heldFromWeb: true });
  // list_guide_work and the guide catalog say so too, so Claude does not take it for a draft awaiting publish_guide.
  const work = (await f.guides.guideWork(f.mcp)).work.find(w => w.readingKey === "pekudei");
  expect(work?.base).toMatchObject({ currentVersion: 4, visibleVersion: 1, heldDraft: true, heldFromWeb: true });
  const entry = (await f.guides.guideCatalog(f.mcp)).entries.find(e => e.kind === "torah" && e.readingKey === "pekudei");
  expect(entry?.base).toMatchObject({ status: "held-draft", version: 4, visibleVersion: 1, heldFromWeb: true });
  expect((await f.send("/api/admin/guides", { who: "admin" })).body.guides[0]).toMatchObject({ state: "held", current: { version: 4 }, visible: { version: 1 } });
  expect(await f.guides.publishBaseGuide(f.mcp, { ...at(4), mutationId: randomUUID() })).toMatchObject({ ok: true, version: 5 });
  expect(await f.reader()).toMatchObject({ version: 5, overview: expect.stringContaining("HELD-DRAFT") });
  expect(await f.guides.getBaseGuide(f.mcp, { kind: "torah", readingKey: "pekudei" })).toMatchObject({ held: null, heldFromWeb: false });
});

test("holding the only release leaves readers with no guide; releasing it brings it back", async () => {
  const f = await fixture();
  expect((await f.send("/api/admin/guides", { who: "admin" })).body.guides[0]).toMatchObject({ afterHold: null });
  expect((await f.post(HOLD, at(1))).body).toMatchObject({ ok: true, version: 2, held: true });
  expect(await f.reader()).toBeNull();
  expect(await f.guides.getBaseGuide(f.mcp, { kind: "torah", readingKey: "pekudei" })).toMatchObject({ visible: null, held: { version: 2 } });
  expect((await f.post(RELEASE, at(2))).body).toMatchObject({ ok: true, version: 3, held: false });
  expect(await f.reader()).toMatchObject({ version: 3, overview: expect.stringContaining("FIRST-RELEASE") });
});

test("a stale version is a conflict, and releasing what is not held or holding what is held is refused; nothing is written", async () => {
  const f = await fixture();
  for (const [path, body, code] of [[RELEASE, at(1), "not-held"], [HOLD, at(2), "conflict"], [RELEASE, at(0), "conflict"]] as const) {
    const r = await f.post(path, body);
    expect(r.status, `${path} ${body.version}`).toBe(409); expect(r.body).toMatchObject({ ok: false, code });
  }
  await f.holdThroughClaude(1);
  for (const [path, body, code] of [[HOLD, at(2), "not-released"], [RELEASE, at(1), "conflict"], [HOLD, at(1), "conflict"]] as const) {
    const r = await f.post(path, body);
    expect(r.status, `${path} ${body.version}`).toBe(409); expect(r.body).toMatchObject({ ok: false, code });
  }
  expect((await f.rows()).map(r => r.version)).toEqual([1, 2]);
  // A reading with no guide at all, and another congregation's reading, are conflicts too.
  expect((await f.post(RELEASE, { ...at(1), readingKey: "vayera" })).body).toMatchObject({ ok: false, code: "conflict" });
});

test("a tutor or parent, a student, a signed-out caller, a revoked admin, another congregation's admin and a cross-site post are refused on both routes", async () => {
  const f = await fixture();
  await f.holdThroughClaude(1);
  const writes = [[RELEASE, at(2)], [HOLD, at(1)]] as const;
  for (const [path, body] of writes) {
    for (const who of ["multi", "learner"] as const) {
      expect((await f.post(path, body, who)).status, `${who} ${path}`).toBe(403);
      // Refused for authority before the body is judged.
      expect((await f.post(path, { nonsense: true }, who)).status, `${who} ${path} malformed`).toBe(403);
    }
    expect((await f.post(path, body, "anonymous")).status, path).toBe(401);
    expect((await f.post(path, body, "admin", { headers: { origin: "https://evil.example" } })).status, `${path} cross-site`).toBe(403);
    expect((await f.post(path, body, "admin", { headers: { origin: "http://localhost:3101" } })).status, `${path} other origin`).toBe(403);
  }
  // Another congregation's admin, on its own host, reaches only its own congregation, where there is no such guide.
  const otherMember = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  await f.owner(async () => { await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "admin" }); });
  for (const [path, body] of writes) expect((await f.post(path, body, "multi", { origin: "http://localhost:3101", headers: { origin: "http://localhost:3101" } })).body, `other ${path}`).toMatchObject({ ok: false, code: "conflict" });
  // A revoked admin grant.
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  for (const [path, body] of writes) expect((await f.post(path, body)).status, `revoked ${path}`).toBe(403);
  expect((await f.rows()).map(r => [r.version, r.channel])).toEqual([[1, "mcp"], [2, "mcp"]]);
});

test("the web cannot write guide text: a smuggled body is refused at the route, the service refuses a web save, and the database refuses a web row that differs", async () => {
  const f = await fixture();
  await f.holdThroughClaude(1);
  // At the route: only kind, readingKey and version are accepted.
  for (const path of [RELEASE, HOLD]) {
    for (const extra of [{ body: HELD }, { overview: "SMUGGLED" }, { reviewed: true }, { hold: false }, { origin: "rabbi" }, { mutationId: randomUUID() }])
      expect((await f.post(path, { ...at(2), ...extra })).status, `${path} ${Object.keys(extra)[0]}`).toBe(400);
  }
  // At the service: a web-channel authority cannot save a guide's text.
  const web: RabbiAuthority<never> = { run: action => f.mcp.run((tx, writer, live) => action(tx as never, Object.freeze({ ...writer, channel: "web" as const, mayReview: false }), live)) };
  expect(await f.guides.setBaseGuide(web as never, { kind: "torah", readingKey: "pekudei", expectedVersion: 2, body: guide({ overview: "SMUGGLED" }), origin: "rabbi", reviewed: true, hold: false, mutationId: randomUUID() }))
    .toMatchObject({ ok: false, code: "channel-not-permitted" });
  expect(await f.guides.holdBaseGuide(f.mcp, { ...at(1), mutationId: randomUUID() })).toMatchObject({ ok: false, code: "channel-not-permitted" });

  // At the database: every web row but an import must copy the version before it, exactly, and release or hold it.
  const [v2] = (await f.rows()).slice(1);
  const insert = (extra: Partial<typeof s.studyGuide.$inferInsert>) => f.owner(async () => f.db.insert(s.studyGuide).values({ tenantId: "crc", kind: "torah", readingKey: "pekudei",
    version: 3, baseVersion: 2, previousVersion: 2, origin: v2.origin, reviewed: v2.reviewed, hold: false, body: v2.body, actorUserId: f.adminMember.userId, actorMembershipId: f.adminMember.id,
    roleGrantId: f.adminGrant.id, role: "admin", mode: "admin", channel: "web", mutationId: randomUUID(), requestDigest: "a".repeat(64), copyOfVersion: 2, ...extra }));
  for (const [label, extra] of [
    ["new text", { body: guide({ overview: "SMUGGLED" }) }], ["an added theme", { body: { ...v2.body, themes: [...v2.body.themes, theme("extra")] } }],
    ["marked reviewed", { reviewed: true }], ["relabeled", { origin: "rabbi" }], ["no copy", { copyOfVersion: null }], ["copy of an older version", { copyOfVersion: 1 }],
    ["neither release nor hold", { hold: true }], ["an import key smuggled in", { importCredit: "Rabbi Synthetic", importKey: "b".repeat(64) }],
    ["a copy on the MCP channel", { channel: "mcp" }],
  ] as const) await expect(insert(extra as Partial<typeof s.studyGuide.$inferInsert>), label).rejects.toThrow();
  expect((await f.rows()).map(r => r.version)).toEqual([1, 2]);
  // The exact copy is the one row the web may add.
  await insert({});
  expect(await f.reader()).toMatchObject({ version: 3, overview: expect.stringContaining("HELD-DRAFT") });
});
