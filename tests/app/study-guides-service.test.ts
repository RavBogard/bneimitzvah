import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { accessFixture } from "./access-fixture";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudyGuideService, type GuideChecker } from "../../src/server/study-guides/service";
import { membershipRabbiAuthority, operatorRabbiAuthority } from "../../src/server/study-guides/authority";
import { markReadingsForReview } from "../../src/server/data/roster";
import { AccessDenied } from "../../src/server/access/errors";
import * as s from "../../src/server/db/index";
import { additions, guide, note, source, theme } from "../helpers/study-guide-fixture";

const open: Awaited<ReturnType<typeof accessFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });

const pekudei = {
  date: "2027-03-13", calendar: "diaspora", classification: "regular", haftarah: "I Kings 7:51-8:21",
  reading: { parashah: "Pekudei", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Exodus 38:21-40:38" }] },
};
async function fixture(options: { snapshot?: unknown } = {}) {
  const f = await accessFixture(); open.push(f);
  const practice = createPracticeService({ access: f.service });
  const check = vi.fn<GuideChecker>(async ({ body }) => {
    const invented = body.themes.flatMap(t => t.notes.flatMap(n => n.sources)).filter(x => x.id.startsWith("invented-by-caller"));
    return invented.length ? { ok: false as const, problems: invented.map(x => `unknown source ${x.id}`) } : { ok: true as const, body };
  });
  const guides = createStudyGuideService({ access: f.service, practice, check });
  const studentId = f.students[0].id;
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Exodus 40:34-38", status: "confirmed",
      setByMembershipId: f.adminMember.id, proposalSnapshot: { slotProvenance: 1, needsReview: false, source: options.snapshot === undefined ? pekudei : options.snapshot } }).returning();
    await f.db.insert(s.assignmentVerse).values([34, 35, 36, 37, 38].map((v, i) => ({ tenantId: "crc", studentId, assignmentId: row.id, ordinal: i + 1, verseRef: `Exodus 40:${v}` })));
    return row;
  });
  const rabbi = (mayReview = true) => membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id, channel: "mcp", mayReview });
  const save = (extra: Record<string, unknown> = {}, authority = rabbi()) => guides.setBaseGuide(authority, {
    kind: "torah", readingKey: "pekudei", expectedVersion: 0, body: guide(), origin: "claude", reviewed: false, hold: false, mutationId: randomUUID(), ...extra });
  const read = (who: "learner" | "multi" | "admin", mode: "student" | "parent" | "tutor" | "admin") => guides.studentGuide(f.request(who), { mode, studentId, kind: "torah" });
  const audits = () => f.owner(async () => (await f.db.select().from(s.auditEvent)).filter(a => a.action.startsWith("study-")).map(a => a.action));
  const rows = () => f.owner(async () => f.db.select().from(s.studyGuide));
  const post = (who: "learner" | "multi") => ({ ...f.request(who, "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" });
  return { ...f, guides, check, studentId, assignment, rabbi, save, read, audits, rows, post };
}
const denied = async (action: () => Promise<unknown>, status = 403) => { try { await action(); return false; } catch (e) { return e instanceof AccessDenied && e.status === status; } };

test("admin saves base guide, head advances, audit row written", async () => {
  const f = await fixture();
  const first = await f.save();
  expect(first).toMatchObject({ ok: true, replayed: false, version: 1, held: false });
  expect(await f.save({ expectedVersion: 1, body: guide({ overview: "A revised invented overview." }) })).toMatchObject({ ok: true, version: 2 });
  expect((await f.rows()).map(r => [r.version, r.channel, r.role, r.actorMembershipId === f.adminMember.id])).toEqual([[1, "mcp", "admin", true], [2, "mcp", "admin", true]]);
  expect(await f.audits()).toEqual(["study-guide.set", "study-guide.set"]);
});

test("tutor cannot save base guide (403)", async () => {
  const f = await fixture();
  const tutor = membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.multiMember.id, channel: "mcp", mayReview: true });
  expect(await denied(() => f.save({}, tutor))).toBe(true);
  expect(await denied(() => f.save({}, membershipRabbiAuthority({ db: f.db, tenantId: "other", membershipId: f.adminMember.id, channel: "mcp", mayReview: true })))).toBe(true);
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date() }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  expect(await denied(() => f.save())).toBe(true);
  expect(await f.rows()).toHaveLength(0);
});

test("conflict on stale expectedVersion, and a no-change save is refused", async () => {
  const f = await fixture();
  await f.save();
  expect(await f.save({ expectedVersion: 0 })).toMatchObject({ ok: false, code: "conflict" });
  expect(await f.save({ expectedVersion: 1 })).toMatchObject({ ok: false, code: "no-change" });
});

test("replay of same mutationId returns committed without a second row", async () => {
  const f = await fixture(), mutationId = randomUUID();
  expect(await f.save({ mutationId })).toMatchObject({ ok: true, replayed: false, version: 1 });
  expect(await f.save({ mutationId })).toMatchObject({ ok: true, replayed: true, version: 1 });
  expect(await f.save({ mutationId, body: guide({ overview: "Different invented text." }) })).toMatchObject({ ok: false, code: "conflict" });
  expect(await f.rows()).toHaveLength(1);
});

test("held version invisible to student view, visible with includeHeld", async () => {
  const f = await fixture();
  expect(await f.save({ hold: true })).toMatchObject({ ok: true, held: true });
  expect(await f.read("learner", "student")).toBeNull();
  const staff = await f.guides.getBaseGuide(f.rabbi(), { kind: "torah", readingKey: "pekudei" });
  expect(staff.visible).toBeNull(); expect(staff.held?.version).toBe(1);
  expect(await f.guides.publishBaseGuide(f.rabbi(), { kind: "torah", readingKey: "pekudei", version: 1, mutationId: randomUUID() })).toMatchObject({ ok: true, version: 2, held: false });
  expect((await f.read("learner", "student"))?.base?.version).toBe(2);
  expect(await f.audits()).toEqual(["study-guide.set", "study-guide.publish"]);
});

test("draft after a reviewed version is held until published", async () => {
  const f = await fixture();
  await f.save({ reviewed: true, origin: "rabbi" });
  const draft = await f.save({ expectedVersion: 1, body: guide({ overview: "A routine's newer invented draft." }), hold: false }, f.rabbi(false));
  expect(draft).toMatchObject({ ok: true, version: 2, held: true, heldBecauseReviewed: true });
  const seen = await f.read("learner", "student");
  expect(seen?.base).toMatchObject({ version: 1, label: { reviewed: true, origin: "rabbi", rabbiName: "the rabbi" } });
  // Only a reviewing rabbi releases it.
  expect(await f.guides.publishBaseGuide(f.rabbi(false), { kind: "torah", readingKey: "pekudei", version: 2, mutationId: randomUUID() })).toMatchObject({ ok: false, code: "review-not-permitted" });
  expect(await f.guides.publishBaseGuide(f.rabbi(), { kind: "torah", readingKey: "pekudei", version: 2, mutationId: randomUUID() })).toMatchObject({ ok: true, version: 3 });
  expect((await f.read("learner", "student"))?.base).toMatchObject({ version: 3, label: { reviewed: false } });
});

test("reviewed save replaces a reviewed head immediately", async () => {
  const f = await fixture();
  await f.save({ reviewed: true });
  expect(await f.save({ expectedVersion: 1, reviewed: true, body: guide({ overview: "The rabbi's edit in Cowork." }) })).toMatchObject({ ok: true, version: 2, held: false });
  expect((await f.read("learner", "student"))?.base?.overview).toBe("The rabbi's edit in Cowork.");
});

test("routine and operator consent cannot set reviewed:true", async () => {
  const f = await fixture();
  expect(await f.save({ reviewed: true }, f.rabbi(false))).toMatchObject({ ok: false, code: "review-not-permitted" });
  const operator = operatorRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id });
  expect(await f.save({ reviewed: true }, operator)).toMatchObject({ ok: false, code: "review-not-permitted" });
  expect(await f.save({}, operator)).toMatchObject({ ok: true, version: 1 });
  expect((await f.rows())[0].channel).toBe("operator");
});

test("an invented citation refuses the whole save", async () => {
  const f = await fixture();
  const body = guide({ themes: [theme("t", { notes: [note("Exodus 40:34", { sources: [source("real-one"), source("invented-by-caller-1")] })] })] });
  expect(await f.save({ body })).toMatchObject({ ok: false, code: "invalid", problems: ["unknown source invented-by-caller-1"] });
  expect(await f.rows()).toHaveLength(0); expect(await f.audits()).toEqual([]);
});

test("filters notes to assigned verses, keeps themes with remaining notes", async () => {
  const f = await fixture();
  const body = guide({ themes: [
    theme("cloud", { notes: [note("Exodus 40:34"), note("Exodus 39:1")] }),
    theme("elsewhere", { notes: [note("Exodus 38:21")] }),
    theme("framing", { notes: [] }),
  ] });
  await f.save({ body });
  const view = await f.read("learner", "student");
  expect(view?.base?.themes.map(t => [t.id, t.notes.map(n => n.verseRef)])).toEqual([["cloud", ["Exodus 40:34"]], ["framing", []]]);
  expect(view?.base?.label).toEqual({ origin: "claude", reviewed: false, rabbiName: "the rabbi" });
});

test("rabbi display name comes from tenant customs", async () => {
  const f = await fixture();
  await f.owner(async () => { await f.db.update(s.tenant).set({ customs: { credits: { rabbiDisplayName: "Rabbi Daniel" } } }).where(eq(s.tenant.id, "crc")); });
  await f.save();
  expect((await f.read("learner", "student"))?.base?.label.rabbiName).toBe("Rabbi Daniel");
});

test("student guide drops additions after revision bump", async () => {
  const f = await fixture();
  await f.save();
  const add = (extra: Record<string, unknown> = {}) => f.guides.setStudentGuide(f.rabbi(), { studentId: f.studentId, kind: "torah", assignmentId: f.assignment.id, assignmentRevision: 1,
    expectedVersion: 0, body: additions([theme("for-you", { notes: [note("Exodus 40:35")] })]), origin: "claude", reviewed: false, mutationId: randomUUID(), ...extra });
  expect(await add()).toMatchObject({ ok: true, version: 1 });
  expect((await f.read("learner", "student"))?.additions?.themes.map(t => t.id)).toEqual(["for-you"]);
  await f.owner(async () => { await markReadingsForReview(f.db as never, "crc", f.studentId); });
  const after = await f.read("learner", "student");
  expect(after?.base?.version).toBe(1); expect(after?.additions).toBeNull();
  expect(await add()).toMatchObject({ ok: false, code: "stale-assignment" });
  expect(await add({ assignmentRevision: 2 })).toMatchObject({ ok: true, version: 1 });
  expect(await denied(() => add({ studentId: randomUUID() }), 404)).toBe(true);
});

test("student guide is null when readingKey is null and no additions", async () => {
  const f = await fixture({ snapshot: { reading: null, haftarah: null } });
  await f.save();
  expect(await f.read("learner", "student")).toBeNull();
});

test("theme tick: student writes, parent 403, tutor reads", async () => {
  const f = await fixture();
  await f.save({ body: guide({ themes: [theme("cloud", { notes: [note("Exodus 40:34")] })] }) });
  const tick = (who: "learner" | "multi", mode: "student" | "parent" | "tutor", extra: Record<string, unknown> = {}) =>
    f.guides.setThemeRead(f.post(who), { mode, studentId: f.studentId, kind: "torah", readingKey: "pekudei", themeId: "cloud", read: true, expectedVersion: 0, ...extra });
  expect(await tick("learner", "student")).toMatchObject({ ok: true, read: true, version: 1 });
  expect(await tick("learner", "student")).toMatchObject({ ok: false, code: "conflict" });
  expect(await denied(() => tick("multi", "parent", { expectedVersion: 1 }))).toBe(true);
  expect(await denied(() => tick("multi", "tutor", { expectedVersion: 1 }))).toBe(true);
  expect(await denied(() => tick("learner", "student", { themeId: "not-a-theme", expectedVersion: 1 }), 404)).toBe(true);
  expect(await tick("learner", "student", { readingKey: "vayakhel", expectedVersion: 1 })).toMatchObject({ ok: false, code: "stale-assignment" });
  const tutorView = await f.read("multi", "tutor"), parentView = await f.read("multi", "parent");
  expect(tutorView?.base?.themes[0]).toMatchObject({ id: "cloud", read: true, readVersion: 1 });
  expect(tutorView?.tickable).toBe(false); expect(parentView?.tickable).toBe(false);
  expect((await f.read("learner", "student"))?.tickable).toBe(true);
  expect(await tick("learner", "student", { read: false, expectedVersion: 1 })).toMatchObject({ ok: true, read: false, version: 2 });
  expect(await f.audits()).toEqual(["study-guide.set", "study-theme.read", "study-theme.read"]);
});

test("voice: template when empty, versioned saves, conflict on stale version", async () => {
  const f = await fixture();
  const empty = await f.guides.getVoice(f.rabbi());
  expect(empty).toMatchObject({ version: 0, template: true }); expect(empty.body).toContain("starter template");
  expect(await f.guides.setVoice(f.rabbi(), { expectedVersion: 0, body: "Our voice.", mutationId: randomUUID() })).toMatchObject({ ok: true, version: 1 });
  expect(await f.guides.setVoice(f.rabbi(), { expectedVersion: 0, body: "Stale.", mutationId: randomUUID() })).toMatchObject({ ok: false, code: "conflict" });
  expect(await f.guides.getVoice(f.rabbi())).toEqual({ version: 1, body: "Our voice.", template: false });
  expect(await denied(() => f.guides.setVoice(membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.learnerMember.id, channel: "mcp", mayReview: true }), { expectedVersion: 1, body: "x", mutationId: randomUUID() }))).toBe(true);
});
