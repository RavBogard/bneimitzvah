import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { parseShareFile, SHARE_SCHEMA } from "../../src/server/guide-share/format";
import { validateGuideBody } from "../../src/server/study-guides/validation";
import { guide, note, theme } from "../helpers/study-guide-fixture";

// Guide sharing (plan ruling 11, 2026-10-30). Synthetic prose and synthetic sources only. Behaviour is asserted by status, row state and
// test ids, never by wording.
const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const EXPORT = "/api/admin/guide-share/export", PREVIEW = "/api/admin/guide-share/preview", IMPORT = "/api/admin/guide-share/import";
const OTHER = "http://localhost:3101";
const REF = "Invented Commentary on Exodus 40:34:1";
const OUTLINE = Array.from({ length: 7 }, (_, i) => `Synthetic aliyah ${i + 1}: a short line.`);
const digest = "a".repeat(64);

async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => {
    const response = await dispatch(f.request(path, options)); const text = await response.text();
    let body: unknown = null; try { body = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body: body as any, text, headers: response.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  // This portal's own catalog: one commentary the verse really has, under a link id the exporting portal knows nothing about.
  f.setRelated(async (ref) => ({ schema: "study-related-metadata/v1" as const, verse: ref, receivedRows: ref === "Exodus 40:34" ? 1 : 0, heldCount: 0, duplicateCount: 0,
    entries: ref === "Exodus 40:34" ? [{ id: "importer-link-77", ref: REF, indexTitle: "Invented Commentary", category: "Commentary", labels: { en: "Invented Commentary", he: null } }] : [] }));
  // The "other" congregation gets its own admin, so an import can be run there.
  const otherMember = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  await f.owner(async () => { await f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "admin" }); });
  const seed = (tenantId: "crc" | "other", kind: "torah" | "haftarah", readingKey: string, extra: Partial<typeof s.studyGuide.$inferInsert> = {}) => f.owner(async () => {
    const grant = tenantId === "crc" ? f.adminGrant : (await f.db.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, "other"), eq(s.roleGrant.role, "admin"))))[0];
    const member = tenantId === "crc" ? f.adminMember : otherMember;
    const version = extra.version ?? 1;
    const [row] = await f.db.insert(s.studyGuide).values({ tenantId, kind, readingKey, version, baseVersion: version - 1, previousVersion: version === 1 ? null : version - 1, origin: "rabbi", reviewed: true, hold: false,
      body: guide(), actorUserId: member.userId, actorMembershipId: member.id, roleGrantId: grant.id, role: "admin", mode: "admin", channel: "mcp", mutationId: randomUUID(), requestDigest: digest, ...extra }).returning();
    return row;
  });
  const guides = (tenantId: string) => f.owner(async () => f.db.select().from(s.studyGuide).where(eq(s.studyGuide.tenantId, tenantId)));
  const audits = () => f.owner(async () => (await f.db.select().from(s.auditEvent)).filter(a => a.action === "study-guide.import"));
  const exported = async () => { const r = await send(EXPORT, { who: "admin" }); expect(r.status).toBe(200); return r; };
  const post = (path: string, file: unknown, who: "admin" | "multi" | "learner" = "multi", origin = OTHER) =>
    send(path, { who, origin, method: "POST", headers: { origin }, body: { file } });
  return { ...f, send, seed, guides, audits, exported, post };
}
const fileOf = (extra: Record<string, unknown> = {}) => ({ schema: SHARE_SCHEMA, exportedAt: "2026-10-30T12:00:00.000Z", guides: [], summaries: [], discussions: [], ...extra });
const shareGuide = (extra: Record<string, unknown> = {}) => ({ kind: "torah", readingKey: "pekudei", origin: "rabbi", credit: "Rabbi Daniel Bogard",
  body: { overview: "An invented overview.", themes: [{ id: "finished-work", title: "A finished work", intro: "An invented introduction.", notes: [{ verseRef: "Exodus 40:34", body: "An invented note.", sources: [{ ref: REF }] }] }] }, ...extra });

test("export carries only reviewed, visible work, with stable keys and no ids, emails, held drafts or student guides", async () => {
  const f = await fixture();
  const reviewed = await f.seed("crc", "torah", "pekudei", { importCredit: null });
  await f.seed("crc", "torah", "pekudei", { version: 2, reviewed: true, hold: true, body: guide({ overview: "HELD-CANARY draft over reviewed work." }) });
  await f.seed("crc", "torah", "vayera", { reviewed: false, body: guide({ overview: "UNREVIEWED-CANARY published draft." }) });
  await f.seed("crc", "haftarah", "vayera", { reviewed: true, hold: true, body: guide({ overview: "HELD-ONLY-CANARY never visible." }) });
  // A student-specific addition, which only the student's own guide may carry.
  const studentId = f.students[0].id;
  await f.owner(async () => {
    const [assignment] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Exodus 40:34-38", status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { slotProvenance: 1, needsReview: false, source: {} } }).returning();
    await f.db.insert(s.studyGuideStudent).values({ tenantId: "crc", studentId, assignmentId: assignment.id, assignmentRevision: 1, kind: "torah", version: 1, baseVersion: 0, previousVersion: null, origin: "rabbi", reviewed: true,
      body: { themes: [theme("for-you", { title: "STUDENT-CANARY" })] }, actorUserId: f.adminMember.userId, actorMembershipId: f.adminMember.id, roleGrantId: f.adminGrant.id, role: "admin", mode: "admin", channel: "mcp", mutationId: randomUUID(), requestDigest: digest });
    // An approved summary and a draft; a published discussion and a withdrawn one.
    const draft = (revision: number, text: string) => f.db.insert(s.portionSummary).values({ tenantId: "crc", readingKey: "vayera", revision, status: "draft", summary: text, outline: OUTLINE, draftedBy: f.adminMember.id, mutationId: randomUUID(), requestDigest: digest });
    await draft(1, "An approved synthetic summary.");
    await f.db.update(s.portionSummary).set({ status: "approved", approvedBy: f.adminMember.id, approvedGrantId: f.adminGrant.id, approvedRole: "admin", approvedAt: sql`now()`, credit: "Rabbi Daniel Bogard" }).where(eq(s.portionSummary.readingKey, "vayera"));
    await draft(2, "DRAFT-SUMMARY-CANARY");
    // One transaction: the source guard wants the discussion stamped in the same instant.
    await f.db.transaction(async tx => {
      for (const slug of ["why-this-verse", "gone-talk"]) {
        const [d] = await tx.insert(s.curatedDiscussion).values({ tenantId: "crc", slug, title: `Synthetic ${slug}`, kind: "torah", status: "published", selectedBy: f.adminMember.id, mutationId: randomUUID(), requestDigest: digest }).returning();
        await tx.insert(s.curatedDiscussionSource).values({ tenantId: "crc", discussionId: d.id, revision: 1, position: 1, ref: REF, anchorRef: "Exodus 40:34", edition: "Invented English Edition", selectedBy: f.adminMember.id, selectedByName: "Rabbi Test" });
      }
      await tx.update(s.curatedDiscussion).set({ status: "withdrawn", revision: 2 }).where(eq(s.curatedDiscussion.slug, "gone-talk"));
    });
  });
  const r = await f.exported();
  expect(r.headers.get("content-disposition")).toContain("attachment");
  const file = r.body;
  expect(parseShareFile(file).ok).toBe(true);
  expect(file.schema).toBe(SHARE_SCHEMA);
  expect(file.guides.map((g: { kind: string; readingKey: string }) => `${g.kind}:${g.readingKey}`)).toEqual(["torah:pekudei"]);
  expect(file.guides[0]).toMatchObject({ origin: "rabbi", credit: "the rabbi" });
  // The reviewed version that is live is exported, not the held draft written over it; citations are keys, never link ids.
  expect(file.guides[0].body.themes[0].notes[0].sources).toEqual([{ ref: REF }]);
  expect(file.summaries).toEqual([{ reading: "vayera", summary: "An approved synthetic summary.", outline: OUTLINE, credit: "Rabbi Daniel Bogard" }]);
  expect(file.discussions.map((d: { slug: string }) => d.slug)).toEqual(["why-this-verse"]);
  for (const canary of ["HELD-CANARY", "UNREVIEWED-CANARY", "HELD-ONLY-CANARY", "STUDENT-CANARY", "DRAFT-SUMMARY-CANARY", "gone-talk", "example.test", reviewed.id, f.adminMember.id, f.adminMember.userId, f.adminGrant.id, studentId, "invented-source-1"])
    expect(r.text, canary).not.toContain(canary);
});

test("only an admin exports or imports; tutors, students and signed-out callers are refused and nothing is written", async () => {
  const f = await fixture();
  await f.seed("crc", "torah", "pekudei");
  for (const who of ["multi", "learner"] as const) {
    expect((await f.send(EXPORT, { who })).status, who).toBe(403);
    for (const path of [PREVIEW, IMPORT]) expect((await f.post(path, fileOf({ guides: [shareGuide()] }), who, "http://localhost:3000")).status, `${who} ${path}`).toBe(403);
  }
  expect((await f.send(EXPORT, { who: "anonymous" })).status).toBe(401);
  expect((await f.post(IMPORT, fileOf({ guides: [shareGuide()] }), "learner", "http://localhost:3000")).status).toBe(403);
  // A tutor of one congregation is no admin of it; the same person is an admin of the other, where an import lands.
  expect((await f.guides("crc")).length).toBe(1);
  expect(await f.audits()).toHaveLength(0);
  // Cross-site posts are refused even for an admin.
  const forged = await f.send(IMPORT, { who: "admin", method: "POST", headers: { origin: "https://evil.example" }, body: { file: fileOf() } });
  expect(forged.status).toBe(403);
});

test("an import lands only in the importer's own tenant: held, unreviewed, credited, audited once, and never visible to a student", async () => {
  const f = await fixture();
  await f.seed("crc", "torah", "pekudei");
  const file = (await f.exported()).body;
  const before = (await f.guides("crc")).length;
  const preview = await f.post(PREVIEW, file);
  expect(preview.status).toBe(200);
  expect(preview.body.guides).toEqual([{ kind: "torah", readingKey: "pekudei", status: "ready", droppedCitations: 0, credit: "the rabbi" }]);
  expect(await f.guides("other")).toHaveLength(0);
  const done = await f.post(IMPORT, file);
  expect(done.status).toBe(200);
  expect(done.body.imported).toEqual({ guides: 1, summaries: 0 });
  const [row, ...rest] = await f.guides("other");
  expect(rest).toHaveLength(0);
  expect(row).toMatchObject({ tenantId: "other", kind: "torah", readingKey: "pekudei", version: 1, hold: true, reviewed: false, origin: "rabbi", channel: "web", importCredit: "the rabbi", role: "admin", mode: "admin" });
  expect(row.importKey).toMatch(/^[a-f0-9]{64}$/);
  // The citation was looked up again in this portal's catalog: its own link id, not anything from the file.
  const stored = validateGuideBody(row.body, { allowOverview: true });
  expect(stored.ok && stored.value.themes[0].notes[0].sources.map(x => x.id)).toEqual(["importer-link-77"]);
  // The exporting congregation is untouched, and exactly one audit event records the import.
  expect((await f.guides("crc")).length).toBe(before);
  const events = await f.audits();
  expect(events.map(e => [e.tenantId, e.targetType, e.mode])).toEqual([["other", "study_guide_import", "admin"]]);
  // Held means the live head is empty: no student path serves it.
  const heads = await f.owner(async () => (await f.db.select().from(s.studyGuide).where(and(eq(s.studyGuide.tenantId, "other"), eq(s.studyGuide.hold, false)))).length);
  expect(heads).toBe(0);
});

test("re-importing the same file adds nothing, and an import never overwrites a guide the importer already has", async () => {
  const f = await fixture();
  await f.seed("crc", "torah", "pekudei");
  await f.seed("crc", "torah", "vayera");
  const file = (await f.exported()).body;
  const mine = await f.seed("other", "torah", "vayera", { body: guide({ overview: "IMPORTER-OWN overview, already live." }), reviewed: false });
  const first = await f.post(IMPORT, file);
  expect(first.body.imported.guides).toBe(1);
  expect(first.body.guides.find((g: { readingKey: string }) => g.readingKey === "vayera")).toMatchObject({ status: "skipped", reason: "has-guide" });
  const again = await f.post(IMPORT, file);
  expect(again.body.imported).toEqual({ guides: 0, summaries: 0 });
  expect(again.body.guides.find((g: { readingKey: string }) => g.readingKey === "pekudei")).toMatchObject({ status: "skipped", reason: "already-imported" });
  const rows = await f.guides("other");
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.id === mine.id)?.body).toEqual(mine.body);
  expect((await f.audits()).length).toBe(1);
});

test("a citation this portal's catalog cannot confirm is dropped and counted; the file's own ids are never read", async () => {
  const f = await fixture();
  const withUnknown = shareGuide({ body: { overview: "An invented overview.", themes: [{ id: "finished-work", title: "A finished work", intro: "An invented introduction.",
    notes: [{ verseRef: "Exodus 40:34", body: "An invented note.", sources: [{ ref: REF }, { ref: "Invented Commentary on Exodus 40:34:9" }] }] }] } });
  const preview = await f.post(PREVIEW, fileOf({ guides: [withUnknown] }));
  expect(preview.body.guides[0]).toMatchObject({ status: "ready", droppedCitations: 1 });
  await f.post(IMPORT, fileOf({ guides: [withUnknown] }));
  const stored = validateGuideBody((await f.guides("other"))[0].body, { allowOverview: true });
  expect(stored.ok && stored.value.themes[0].notes[0].sources.map(x => x.ref)).toEqual([REF]);
  // A source carrying an id (the exporter's Sefaria link id) is not this format.
  const smuggled = shareGuide({ body: { overview: "An invented overview.", themes: [{ id: "finished-work", title: "A finished work", intro: "An invented introduction.",
    notes: [{ verseRef: "Exodus 40:34", body: "An invented note.", sources: [{ ref: REF, id: "exporter-link-1" }] }] }] } });
  expect((await f.post(PREVIEW, fileOf({ guides: [smuggled] }))).status).toBe(400);
});

test("a malformed, hostile or oversized file is refused whole and writes nothing", async () => {
  const f = await fixture();
  const refused = async (file: unknown, status = 400) => {
    for (const path of [PREVIEW, IMPORT]) expect((await f.post(path, file)).status, path).toBe(status);
  };
  await refused("not an object");
  await refused({ schema: "guide-export/v2", exportedAt: "2026-10-30T12:00:00.000Z", guides: [], summaries: [], discussions: [] });
  await refused({ ...fileOf(), extra: 1 });
  await refused(fileOf({ guides: [shareGuide({ id: randomUUID() })] }));
  await refused(fileOf({ guides: [shareGuide({ readingKey: "../etc/passwd" })] }));
  await refused(fileOf({ guides: [shareGuide({ kind: "student" })] }));
  await refused(fileOf({ guides: [shareGuide({ credit: "Rabbi X <rabbi@example.test>" })] }));
  await refused(fileOf({ guides: [shareGuide({ credit: "<img src=x onerror=alert(1)>" })] }));
  await refused(fileOf({ guides: [shareGuide(), shareGuide()] }));
  const bodyWith = (overview: string, noteBody = "An invented note.") => shareGuide({ body: { overview, themes: [{ id: "finished-work", title: "A finished work", intro: "An invented introduction.", notes: [{ verseRef: "Exodus 40:34", body: noteBody, sources: [] }] }] } });
  await refused(fileOf({ guides: [bodyWith("<script>alert(1)</script>")] }));
  await refused(fileOf({ guides: [bodyWith("See [here](https://evil.example/)")] }));
  await refused(fileOf({ guides: [bodyWith("An invented overview.", "Contact someone@example.test")] }));
  await refused(fileOf({ guides: [bodyWith("x".repeat(9000))] }));
  await refused(fileOf({ summaries: [{ reading: "vayera", summary: "Synthetic.", outline: ["only one"], credit: "Rabbi Daniel Bogard" }] }));
  await refused(fileOf({ guides: Array.from({ length: 201 }, (_, i) => shareGuide({ readingKey: `reading-${i}` })) }));
  // An own "__proto__" key is data, not a prototype, and is refused like any other unknown key.
  await refused(JSON.parse('{"schema":"guide-export/v1","exportedAt":"2026-10-30T12:00:00.000Z","guides":[],"summaries":[],"discussions":[],"__proto__":{"admin":true}}'));
  // Over the size limit the body is never parsed.
  const huge = await f.send(IMPORT, { who: "multi", origin: OTHER, method: "POST", headers: { origin: OTHER }, body: { file: { pad: "x".repeat(5 * 1024 * 1024) } } });
  expect(huge.status).toBe(413);
  expect(await f.guides("other")).toHaveLength(0);
  expect(await f.audits()).toHaveLength(0);
});

test("a note on a verse outside the reading, or a reading this portal does not have, cannot be placed and says why", async () => {
  const f = await fixture();
  const outside = shareGuide({ body: { overview: "An invented overview.", themes: [{ id: "finished-work", title: "A finished work", intro: "An invented introduction.", notes: [{ verseRef: "Genesis 1:1", body: "An invented note.", sources: [] }] }] } });
  const unknown = shareGuide({ readingKey: "no-such-reading" });
  const preview = await f.post(PREVIEW, fileOf({ guides: [outside, unknown] }));
  expect(preview.body.guides.map((g: { reason: string }) => g.reason)).toEqual(["verse-outside-reading", "not-in-catalog"]);
  const done = await f.post(IMPORT, fileOf({ guides: [outside, unknown] }));
  expect(done.body.imported.guides).toBe(0);
  expect(await f.guides("other")).toHaveLength(0);
});

test("summaries arrive as drafts nobody sees, once; discussions are listed but cannot arrive held", async () => {
  const f = await fixture();
  const summaries = [{ reading: "vayera", summary: "An approved synthetic summary.", outline: OUTLINE, credit: "Rabbi Daniel Bogard" }, { reading: "shabbat-chol-hamoed", summary: "Not a parashah.", outline: OUTLINE, credit: "Rabbi Daniel Bogard" }];
  const discussions = [{ slug: "why-this-verse", title: "Synthetic title", kind: "torah", sources: [{ ref: REF, anchorRef: "Exodus 40:34", edition: "Invented English Edition", translation: null, selectedBy: "Rabbi Test" }] }];
  const file = fileOf({ summaries, discussions });
  const done = await f.post(IMPORT, file);
  expect(done.status).toBe(200);
  expect(done.body.imported).toEqual({ guides: 0, summaries: 1 });
  expect(done.body.summaries.map((x: { reason?: string }) => x.reason)).toEqual([undefined, "not-a-parashah"]);
  expect(done.body.discussions).toEqual([{ slug: "why-this-verse", status: "skipped", reason: "cannot-arrive-held" }]);
  const rows = await f.owner(async () => (await f.client.query("select tenant_id, reading_key, status, credit from portion_summary")).rows);
  expect(rows).toEqual([{ tenant_id: "other", reading_key: "vayera", status: "draft", credit: null }]);
  expect((await f.owner(async () => (await f.client.query("select count(*)::int as n from curated_discussion")).rows[0] as { n: number })).n).toBe(0);
  expect((await f.post(IMPORT, file)).body.imported).toEqual({ guides: 0, summaries: 0 });
  expect((await f.owner(async () => (await f.client.query("select count(*)::int as n from portion_summary")).rows[0] as { n: number })).n).toBe(1);
});

test("an imported guide, once published through the existing path, keeps its original author's credit", async () => {
  const f = await fixture();
  const done = await f.post(IMPORT, fileOf({ guides: [shareGuide()] }));
  expect(done.body.imported.guides).toBe(1);
  const [held] = await f.guides("other");
  const { createStudyGuideService } = await import("../../src/server/study-guides/service");
  const { membershipRabbiAuthority } = await import("../../src/server/study-guides/authority");
  const { createPracticeService } = await import("../../src/server/practice/service");
  const grant = await f.owner(async () => (await f.db.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, "other"), eq(s.roleGrant.role, "admin"))))[0]);
  const member = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  const guides = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check: async ({ body }) => ({ ok: true as const, body }) });
  const authority = membershipRabbiAuthority({ db: f.db, tenantId: "other", membershipId: member.id, channel: "mcp", mayReview: true, bound: { roleGrantId: grant.id, roleGrantRevision: grant.revision, authorityRevision: member.authorityRevision } });
  expect(await guides.publishBaseGuide(authority, { kind: "torah", readingKey: "pekudei", version: held.version, mutationId: randomUUID() })).toMatchObject({ ok: true, version: 2, held: false });
  const live = (await f.guides("other")).find(r => r.version === 2)!;
  expect(live).toMatchObject({ hold: false, importCredit: "Rabbi Daniel Bogard", importKey: held.importKey, channel: "mcp" });
  // The label students see carries the credit alongside the review state.
  const view = await guides.getBaseGuide(authority, { kind: "torah", readingKey: "pekudei" });
  expect(view.visible).toMatchObject({ importedFrom: "Rabbi Daniel Bogard", reviewed: false });
});

test("credit holds through the importer's own save, review and publish: an export still names the original author", async () => {
  const f = await fixture();
  await f.post(IMPORT, fileOf({ guides: [shareGuide()] }));
  const { createStudyGuideService } = await import("../../src/server/study-guides/service");
  const { membershipRabbiAuthority } = await import("../../src/server/study-guides/authority");
  const { createPracticeService } = await import("../../src/server/practice/service");
  const grant = await f.owner(async () => (await f.db.select().from(s.roleGrant).where(and(eq(s.roleGrant.tenantId, "other"), eq(s.roleGrant.role, "admin"))))[0]);
  const member = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  const guides = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check: async ({ body }) => ({ ok: true as const, body }) });
  const authority = membershipRabbiAuthority({ db: f.db, tenantId: "other", membershipId: member.id, channel: "mcp", mayReview: true, bound: { roleGrantId: grant.id, roleGrantRevision: grant.revision, authorityRevision: member.authorityRevision } });
  const edited = guide({ overview: "The importing rabbi's own edit of the overview." });
  const saved = await guides.setBaseGuide(authority, { kind: "torah", readingKey: "pekudei", expectedVersion: 1, body: edited, origin: "rabbi", reviewed: true, hold: true, mutationId: randomUUID() });
  expect(saved).toMatchObject({ ok: true, version: 2, held: true });
  expect(await guides.publishBaseGuide(authority, { kind: "torah", readingKey: "pekudei", version: 2, mutationId: randomUUID() })).toMatchObject({ ok: true, version: 3 });
  const rows = await f.guides("other");
  expect(rows.map(r => [r.version, r.importCredit]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[1, "Rabbi Daniel Bogard"], [2, "Rabbi Daniel Bogard"], [3, "Rabbi Daniel Bogard"]]);
  const exportedFile = await f.send(EXPORT, { who: "multi", origin: OTHER });
  expect(exportedFile.body.guides).toHaveLength(1);
  expect(exportedFile.body.guides[0]).toMatchObject({ readingKey: "pekudei", credit: "Rabbi Daniel Bogard" });
});

test("an imported summary keeps its author through approval, public read and export, though this congregation has no credit of its own", async () => {
  const f = await fixture();
  const summary = { reading: "vayera", summary: "An approved synthetic summary.", outline: OUTLINE, credit: "Rabbi Daniel Bogard" };
  expect((await f.post(IMPORT, fileOf({ summaries: [summary] }))).body.imported.summaries).toBe(1);
  const { approveSummary } = await import("../../src/server/portion-summary/service");
  const { lockRabbi } = await import("../../src/server/study-guides/authority");
  const { withTenantTransaction } = await import("../../src/server/db/runtime");
  const { readApprovedPortionSummary } = await import("../../src/server/portion-summary/public");
  const member = await f.owner(async () => (await f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other")))[0]);
  const authority = { run: <T,>(action: (tx: never, writer: { tenantId: string; membershipId: string; roleGrantId: string; attended: boolean }, live: () => void) => Promise<T>) => withTenantTransaction(f.db, { tenantId: "other" }, async tx => {
    const rabbi = await lockRabbi(tx as never, "other", member.id);
    return action(tx as never, { tenantId: "other", membershipId: rabbi.membershipId, roleGrantId: rabbi.roleGrantId, attended: true }, () => {});
  }) };
  expect(await approveSummary(authority as never, { reading: "vayera", revision: 1 })).toMatchObject({ ok: true, status: "approved", credit: "Rabbi Daniel Bogard" });
  const shown = await withTenantTransaction(f.db, { tenantId: "other" }, tx => readApprovedPortionSummary(tx as never, "other", "vayera"));
  expect(shown).toMatchObject({ reading: "vayera", credit: "Rabbi Daniel Bogard" });
  const exportedFile = await f.send(EXPORT, { who: "multi", origin: OTHER });
  expect(exportedFile.body.summaries).toEqual([summary]);
});
