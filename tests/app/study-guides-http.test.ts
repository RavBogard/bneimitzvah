import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomUUID } from "node:crypto";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createPracticeService } from "../../src/server/practice/service";
import { createStudyGuideService } from "../../src/server/study-guides/service";
import { membershipRabbiAuthority } from "../../src/server/study-guides/authority";
import * as s from "../../src/server/db/index";
import { guide, note, theme } from "../helpers/study-guide-fixture";

const open: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
const pekudei = { date: "2027-03-13", calendar: "diaspora", classification: "regular", haftarah: "I Kings 7:51-8:21",
  reading: { parashah: "Pekudei", type: "shabbat", summary: "", source: "Hebcal", triennial: null, aliyot: [{ n: 1, ref: "Exodus 38:21-40:38" }] } };

async function fixture() {
  const f = await portalRoutesFixture(); open.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const studentId = f.students[0].id;
  await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: "Exodus 40:34-35", status: "confirmed",
      setByMembershipId: f.adminMember.id, proposalSnapshot: { slotProvenance: 1, needsReview: false, source: pekudei } }).returning();
    await f.db.insert(s.assignmentVerse).values([34, 35].map((v, i) => ({ tenantId: "crc", studentId, assignmentId: row.id, ordinal: i + 1, verseRef: `Exodus 40:${v}` })));
  });
  const writer = createStudyGuideService({ access: f.service, practice: createPracticeService({ access: f.service }), check: async ({ body }) => ({ ok: true as const, body }) });
  const rabbi = membershipRabbiAuthority({ db: f.db, tenantId: "crc", membershipId: f.adminMember.id, channel: "mcp", mayReview: true,
    bound: { roleGrantId: f.adminGrant.id, roleGrantRevision: f.adminGrant.revision, authorityRevision: f.adminMember.authorityRevision } });
  await writer.setBaseGuide(rabbi, { kind: "torah", readingKey: "pekudei", expectedVersion: 0, body: guide({ themes: [theme("cloud", { notes: [note("Exodus 40:34")] })] }),
    origin: "claude", reviewed: false, hold: false, mutationId: randomUUID() });
  const send = async (path: string, options: Parameters<typeof f.request>[1] = {}) => {
    const response = await dispatch(f.request(path, options));
    return { status: response.status, body: await response.json().catch(() => null), cache: response.headers.get("cache-control") };
  };
  return { ...f, send, studentId, writer, rabbi };
}
const view = (studentId: string, mode: string) => `/api/students/${studentId}/study-guide?mode=${mode}&kind=torah`;
const tick = (f: { studentId: string }, mode: string, extra: Record<string, unknown> = {}) => ({ mode, kind: "torah", readingKey: "pekudei", themeId: "cloud", read: true, expectedVersion: 0, ...extra });

test("student GET 200 with the view; parent GET 200 identical", async () => {
  const f = await fixture();
  const student = await f.send(view(f.studentId, "student"), { who: "learner" });
  expect(student.status).toBe(200); expect(student.cache).toContain("no-store");
  expect(student.body.view.base).toMatchObject({ version: 1, label: { origin: "claude", reviewed: false, rabbiName: "the rabbi" } });
  expect(student.body.view.base.themes.map((t: { id: string }) => t.id)).toEqual(["cloud"]);
  const parent = await f.send(view(f.studentId, "parent"), { who: "multi" });
  expect(parent.status).toBe(200);
  expect({ ...parent.body.view, tickable: true }).toEqual(student.body.view);
  expect(parent.body.view.tickable).toBe(false);
});

test("parent POST theme-read 403; tutor POST 403; student POST 200 then GET shows read:true", async () => {
  const f = await fixture(), path = `/api/students/${f.studentId}/study-guide/theme-read`;
  expect((await f.send(path, { who: "multi", body: tick(f, "parent") })).status).toBe(403);
  expect((await f.send(path, { who: "multi", body: tick(f, "tutor") })).status).toBe(403);
  const done = await f.send(path, { who: "learner", body: tick(f, "student") });
  expect(done).toMatchObject({ status: 200, body: { ok: true, themeId: "cloud", read: true, version: 1 } });
  expect((await f.send(path, { who: "learner", body: tick(f, "student") })).status).toBe(409);
  expect((await f.send(view(f.studentId, "tutor"), { who: "multi" })).body.view.base.themes[0]).toMatchObject({ read: true, readVersion: 1 });
  // Cross-site and malformed writes never reach the service.
  expect((await f.send(path, { who: "learner", body: tick(f, "student", { expectedVersion: 1 }), headers: { origin: "https://evil.example" } })).status).toBe(403);
  expect((await f.send(path, { who: "learner", body: { ...tick(f, "student"), extra: 1 } })).status).toBe(400);
  expect((await f.send(path, { who: "learner", method: "GET" })).status).toBe(405);
});

test("unknown student 404 generic; anonymous denied", async () => {
  const f = await fixture();
  // An unknown id and a real student the tutor is not linked to are indistinguishable.
  const missing = await f.send(view(randomUUID(), "tutor"), { who: "multi" });
  const unrelated = await f.send(view(f.students[1].id, "tutor"), { who: "multi" });
  expect(missing.status).toBe(404); expect(unrelated.status).toBe(404); expect(unrelated.body).toEqual(missing.body);
  expect((await f.send(view(f.studentId, "student"), { who: "recipient" })).status).toBe(403);
  expect([401, 403]).toContain((await f.send(view(f.studentId, "student"), { who: "anonymous" })).status);
  expect((await f.send(`/api/students/${f.studentId}/study-guide?mode=student&kind=blessing-before`, { who: "learner" })).status).toBe(403);
});

test("admin guide GET returns held; tutor and student cannot read staff status", async () => {
  const f = await fixture();
  await f.writer.setBaseGuide(f.rabbi, { kind: "torah", readingKey: "pekudei", expectedVersion: 1, body: guide({ overview: "Held invented revision." }), origin: "claude", reviewed: false, hold: true, mutationId: randomUUID() });
  const admin = await f.send("/api/admin/study-guides/torah/pekudei", { who: "admin" });
  expect(admin.status).toBe(200);
  expect(admin.body.guide).toMatchObject({ kind: "torah", readingKey: "pekudei", visible: { version: 1, hold: false }, held: { version: 2, hold: true } });
  expect((await f.send(view(f.studentId, "student"), { who: "learner" })).body.view.base.version).toBe(1);
  expect((await f.send("/api/admin/study-guides/torah/pekudei", { who: "multi" })).status).toBe(403);
  expect((await f.send("/api/admin/study-guides/torah/pekudei", { who: "learner" })).status).toBe(403);
  expect((await f.send("/api/admin/study-voice", { who: "admin" })).body).toEqual({ ok: true, voice: { version: 0, template: true, updatedAt: null } });
  expect((await f.send("/api/admin/study-voice", { who: "admin", method: "POST", body: {} })).status).toBe(405);
  expect((await f.send("/api/admin/study-guides/torah/Pekudei", { who: "admin" })).status).toBe(404);
});
