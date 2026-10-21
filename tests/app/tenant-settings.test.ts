import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createStudySourceDiscoveryService } from "../../src/server/study/source-discovery-service";
import { createStudyGuideService } from "../../src/server/study-guides/service";
import { createPracticeService } from "../../src/server/practice/service";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { discoverRelatedPage } from "../../src/server/study/sources/discovery";
import { effectiveRabbiName, preferredFirst } from "../../src/server/settings/validation";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
const PATH = "/api/admin/congregation-settings", LINKS = "/api/congregation/links";
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => { const response = await dispatch(f.request(path, options)); return { status: response.status, body: await response.json() }; };
  const save = (body: Record<string, unknown>, who: "admin" | "multi" | "learner" = "admin", extra: Parameters<typeof f.request>[1] = {}) =>
    send(PATH, { who, method: "POST", body: { expectedVersion: 0, settings: {}, mutationId: randomUUID(), ...body }, ...extra });
  const rows = () => f.owner(async () => f.db.select().from(s.tenantSettings));
  const audits = () => f.owner(async () => (await f.db.select().from(s.auditEvent)).filter(a => a.action === "tenant-settings.set"));
  return { ...f, dispatch, send, save, rows, audits };
}

test("an admin reads empty settings, saves a version with a receipt and an audit row, and replays the same mutation", async () => {
  const f = await fixture();
  expect(await f.send(PATH, { who: "admin" })).toEqual({ status: 200, body: { ok: true, view: { version: 0, settings: {}, updatedAt: null, defaults: { rabbiDisplayName: "the rabbi", siddurUrl: "https://siddur.centralreform.org/" } } } });
  const mutationId = randomUUID(), settings = { rabbiDisplayName: "Rabbi Daniel", preferredSources: ["Rashi"], siddurUrl: "https://siddur.centralreform.org/v2/" };
  expect(await f.save({ settings, mutationId })).toEqual({ status: 200, body: { ok: true, replayed: false, version: 1 } });
  expect(await f.save({ settings, mutationId })).toEqual({ status: 200, body: { ok: true, replayed: true, version: 1 } });
  // The same receipt with a different request is a conflict, never a second write.
  expect(await f.save({ settings: { rabbiDisplayName: "Other" }, mutationId })).toEqual({ status: 409, body: { ok: false, code: "conflict" } });
  const [row] = await f.rows();
  expect({ version: row.version, channel: row.channel, role: row.role, mode: row.mode, actor: row.actorMembershipId === f.adminMember.id, body: row.body })
    .toEqual({ version: 1, channel: "web", role: "admin", mode: "admin", actor: true, body: settings });
  expect((await f.audits()).map(a => [a.targetType, a.targetId, a.mode])).toEqual([["tenant_settings", row.id, "admin"]]);
  const read = await f.send(PATH, { who: "admin" });
  expect(read.body.view).toMatchObject({ version: 1, settings });
});

test("stale versions conflict, unchanged bodies are refused, and invalid fields are named without echoing them", async () => {
  const f = await fixture();
  expect((await f.save({ settings: { rabbiDisplayName: "Rabbi Daniel" } })).body).toMatchObject({ ok: true, version: 1 });
  expect(await f.save({ settings: { rabbiDisplayName: "Someone else" } })).toEqual({ status: 409, body: { ok: false, code: "conflict" } });
  expect(await f.save({ expectedVersion: 1, settings: { rabbiDisplayName: "Rabbi Daniel" } })).toEqual({ status: 409, body: { ok: false, code: "no-change" } });
  const invalid = await f.save({ expectedVersion: 1, settings: { siddurUrl: "https://evil.example/", rabbiDisplayName: "<b>secret-canary</b>" } });
  expect(invalid).toEqual({ status: 409, body: { ok: false, code: "invalid", problems: ["rabbiDisplayName", "siddurUrl"] } });
  expect(JSON.stringify(invalid)).not.toContain("secret-canary");
  for (const body of [{ expectedVersion: -1 }, { expectedVersion: 1.5 }, { mutationId: "not-a-uuid" }]) expect((await f.save(body)).status).toBe(403);
  expect((await f.send(PATH, { who: "admin", method: "POST", body: { expectedVersion: 1, settings: {}, mutationId: randomUUID(), extra: 1 } })).status).toBe(400);
  expect((await f.rows()).length).toBe(1);
});

test("only the admin grant in admin mode reads or writes settings; tutors, parents and students get 403 and cross-site posts are refused", async () => {
  const f = await fixture();
  for (const who of ["multi", "learner"] as const) {
    expect((await f.send(PATH, { who })).status).toBe(403);
    expect((await f.save({ settings: { rabbiDisplayName: "Not me" } }, who)).status).toBe(403);
  }
  expect((await f.send(PATH, { who: "anonymous" })).status).toBe(401);
  expect((await f.save({ settings: { rabbiDisplayName: "Rabbi" } }, "admin", { headers: { origin: "http://evil.example" } })).status).toBe(403);
  expect((await f.save({ settings: { rabbiDisplayName: "Rabbi" } }, "admin", { headers: { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" } })).status).toBe(403);
  // A tutor role on the same membership as a parent role changes nothing; a revoked admin grant denies.
  await f.owner(async () => { await f.db.update(s.roleGrant).set({ revokedAt: new Date(), revision: 2 }).where(eq(s.roleGrant.id, f.adminGrant.id)); });
  expect((await f.save({ settings: { rabbiDisplayName: "Rabbi" } })).status).toBe(403);
  expect(await f.rows()).toEqual([]);
});

test("member links default to the current siddur, follow settings, and never cross congregations", async () => {
  const f = await fixture();
  for (const who of ["learner", "multi", "admin"] as const) expect(await f.send(LINKS, { who })).toEqual({ status: 200, body: { ok: true, links: { siddurUrl: "https://siddur.centralreform.org/", musicUrl: null } } });
  expect((await f.send(LINKS, { who: "anonymous" })).status).toBe(401);
  // The links are identity-level; a practice-context header is refused rather than ignored.
  expect((await f.send(LINKS, { who: "multi", handle: "synthetic-handle" })).status).toBe(403);
  expect((await f.save({ settings: { siddurUrl: "https://siddur.centralreform.org/crc/", musicUrl: "https://centralreform.live/" } })).status).toBe(200);
  expect((await f.send(LINKS, { who: "learner" })).body.links).toEqual({ siddurUrl: "https://siddur.centralreform.org/crc/", musicUrl: "https://centralreform.live/" });
  // The same person in the other congregation sees that congregation's (default) links.
  expect((await f.send(LINKS, { who: "multi", origin: "http://localhost:3101" })).body.links).toEqual({ siddurUrl: "https://siddur.centralreform.org/", musicUrl: null });
  expect((await f.send(PATH, { who: "multi", origin: "http://localhost:3101" })).status).toBe(403);
  expect((await f.send(LINKS, { who: "learner", method: "POST", body: {} })).status).toBe(405);
});

test("the rabbi's name reads settings first, then the legacy customs key, then 'the rabbi'", async () => {
  expect(effectiveRabbiName(null, {})).toBe("the rabbi");
  expect(effectiveRabbiName(null, { credits: { rabbiDisplayName: "Rabbi Legacy" } })).toBe("Rabbi Legacy");
  expect(effectiveRabbiName({ rabbiDisplayName: "Rabbi Daniel" }, { credits: { rabbiDisplayName: "Rabbi Legacy" } })).toBe("Rabbi Daniel");
  expect(effectiveRabbiName({ siddurUrl: "https://siddur.centralreform.org/" }, { credits: { rabbiDisplayName: "Rabbi Legacy" } })).toBe("Rabbi Legacy");
  const f = await fixture();
  const guides = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check: async ({ body }) => ({ ok: true as const, body }) });
  const name = async () => (await guides.staffGuide(f.request("/students", { who: "admin" }), { kind: "torah", readingKey: "pekudei" })).rabbiName;
  expect(await name()).toBe("the rabbi");
  await f.owner(async () => { await f.db.update(s.tenant).set({ customs: { calendar: { diaspora: true }, credits: { rabbiDisplayName: "Rabbi Legacy" } } }).where(eq(s.tenant.id, "crc")); });
  expect(await name()).toBe("Rabbi Legacy");
  expect((await f.save({ settings: { preferredSources: ["Rashi"] } })).status).toBe(200);
  expect(await name()).toBe("Rabbi Legacy");
  expect((await f.save({ expectedVersion: 1, settings: { rabbiDisplayName: "Rabbi Daniel" } })).status).toBe(200);
  expect(await name()).toBe("Rabbi Daniel");
  expect((await f.send(PATH, { who: "admin" })).body.view.defaults.rabbiDisplayName).toBe("Rabbi Legacy");
});

test("preferred works come first in their order, case-insensitively, by index or collective title; the rest keep their order and the hash is unchanged", () => {
  const ref = "Genesis 1:1";
  const raw = [["a1", "Ibn Ezra on Genesis", "Ibn Ezra"], ["a2", "Rashi on Genesis", "Rashi"], ["a3", "Mishnah Berakhot", null], ["a4", "Ramban on Genesis", "Ramban"], ["a5", "Rashi on Genesis", "Rashi"], ["a6", "Talmud", null]]
    .map(([id, title, collective]) => ({ _id: id, sourceRef: `${title} 1:1:1`, index_title: title, category: "Commentary", anchorRef: ref, ...(collective ? { collectiveTitle: { en: collective, he: null } } : {}) }));
  const catalog = parseRelatedMetadata(raw, ref);
  const plain = discoverRelatedPage(catalog, ref, { sourceOffset: 0 }), ordered = discoverRelatedPage(catalog, ref, { sourceOffset: 0 }, ["ramban on genesis", "RASHI", "Not in this catalog"]);
  if (plain.status !== "ready" || ordered.status !== "ready") throw new Error("Expected pages");
  expect(plain.page.entries.map(e => e.id)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
  expect(ordered.page.entries.map(e => e.id)).toEqual(["a4", "a2", "a5", "a1", "a3", "a6"]);
  expect(ordered.page.catalogHash).toBe(plain.page.catalogHash);
  expect(preferredFirst(catalog.entries, []).map(e => e.id)).toEqual(["a1", "a2", "a3", "a4", "a5", "a6"]);
});

test("a student's source discovery lists the congregation's preferred works first", async () => {
  const f = await fixture(), ref = "Genesis 1:1";
  const assignment = await f.owner(async () => {
    const [a] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref, status: "confirmed", setByMembershipId: f.adminMember.id,
      proposalSnapshot: { confirmationDate: f.students[0].ceremonyDate, needsReview: false } }).returning();
    await f.db.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.students[0].id, assignmentId: a.id, ordinal: 1, verseRef: ref }); return a;
  });
  const raw = Array.from({ length: 12 }, (_, i) => ({ _id: `source_${String(i).padStart(4, "0")}`, sourceRef: `Work ${i} 1:1`, index_title: i === 11 ? "Rashi on Genesis" : `Work ${i}`, category: "Commentary", anchorRef: ref }));
  const page = async (r: StudyRequest): Promise<StudyPage> => ({ offset: r.offset, nextOffset: null, totalVerses: r.verses.length,
    verses: [{ ref: r.verses[r.offset], hebrew: normalizeHebrew("בָּ֑ג"), english: null }], translation: { key: "jps2023", status: "unavailable" }, chapters: [] });
  const service = createStudySourceDiscoveryService({ access: f.service, practice: f.runtime.practice, loadText: page, related: async () => parseRelatedMetadata(raw, ref) });
  const read = async () => {
    const result = await service.read(f.request("/students", { who: "learner" }), { mode: "student", studentId: f.students[0].id, kind: "torah", assignmentId: assignment.id, assignmentRevision: 1, translation: "jps2023", offset: 0 }, { sourceOffset: 0 });
    if (!result.ok) throw new Error("Expected sources"); return result.sources;
  };
  const before = await read();
  expect(before.entries.map(e => e.id)).not.toContain("source_0011");
  expect((await f.save({ settings: { preferredSources: ["Rashi on Genesis"] } })).status).toBe(200);
  const after = await read();
  expect(after.entries[0].id).toBe("source_0011");
  expect(after.entries.slice(1).map(e => e.id)).toEqual(before.entries.slice(0, 9).map(e => e.id));
  expect(after.catalogHash).toBe(before.catalogHash);
});
