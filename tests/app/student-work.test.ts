import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { handleStudentWorkRequest } from "../../src/server/http/student-work";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { WorkSelection } from "../../src/server/student-work/validation";

const fixtures: Awaited<ReturnType<typeof portalRoutesFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.client.close(); });
async function fixture() {
  const f = await portalRoutesFixture(); fixtures.push(f);
  const assignment = await f.owner(async () => {
    const [row] = await f.db.insert(s.assignment).values({ tenantId: "crc", studentId: f.students[0].id, kind: "torah", basis: "custom", ref: "Genesis 1:1-12", status: "confirmed", setByMembershipId: f.adminMember.id }).returning();
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 12 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: row.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 1}` })));
    return row;
  });
  const selection: WorkSelection = { mode: "student", studentId: f.students[0].id, kind: "torah", assignmentId: assignment.id, assignmentRevision: 1 };
  const write = (text = "Synthetic draft", expectedVersion = 0) => ({ verseRef: "Genesis 1:1", text, expectedVersion, mutationId: randomUUID() });
  const request = (who: "learner" | "multi" | "admin" = "learner", handle?: string) => f.request("/", { who, method: "POST", handle });
  return { ...f, assignment, selection, write, work: f.runtime.studentWork, workRequest: request };
}

test("drafts preserve hostile plain text/Unicode, explicit clear, CAS receipts and committed versus latest", async () => {
  const f = await fixture(), input = f.write(" <script>alert('synthetic')</script>\r\nא 😀 \t");
  const first = await f.work.append(f.workRequest(), f.selection, "draft", input);
  expect(first).toMatchObject({ ok: true, replayed: false, committedVersion: 1, currentLatestVersion: 1, committed: { text: input.text.replace(/\r\n/g, "\n") } });
  const cleared = await f.work.append(f.workRequest(), f.selection, "draft", f.write("", 1));
  expect(cleared).toMatchObject({ ok: true, committedVersion: 2, committed: { text: "" } });
  expect(await f.work.append(f.workRequest(), f.selection, "draft", input)).toMatchObject({ ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 2 });
  expect(await f.work.append(f.workRequest(), f.selection, "draft", { ...input, text: "changed" })).toEqual({ ok: false, code: "conflict" });
  expect(await f.work.append(f.workRequest(), f.selection, "draft", f.write("stale", 0))).toEqual({ ok: false, code: "conflict" });
  expect(await f.work.receipt(f.workRequest(), f.selection, "draft", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1, currentLatestVersion: 2 });
  const page = await f.work.page(f.workRequest(), f.selection);
  expect(page).toMatchObject({ ok: true, nextOffset: 10 });
  if (page.ok) { expect(page.verses).toHaveLength(10); expect(page.verses[0].draft?.text).toBe(""); expect(page.verses[1].draft).toBeNull(); }
  const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "draft.append")));
  expect(audits).toHaveLength(2); expect(audits[0]).not.toHaveProperty("text");
});

test("role matrix, attribution and child practice do not union staff powers", async () => {
  const f = await fixture();
  await f.work.append(f.workRequest(), f.selection, "draft", f.write());
  for (const [mode, who] of [["student", "learner"], ["parent", "multi"], ["tutor", "multi"], ["admin", "admin"]] as const) {
    const selection = { ...f.selection, mode };
    expect(await f.work.page(f.workRequest(who), selection)).toMatchObject({ ok: true });
    if (mode !== "student") await expect(f.work.append(f.workRequest(who), selection, "draft", f.write())).rejects.toMatchObject({ status: 403 });
    if (mode === "student" || mode === "parent") await expect(f.work.append(f.workRequest(who), selection, "note", f.write())).rejects.toMatchObject({ status: 403 });
  }
  expect(await f.work.append(f.workRequest("multi"), { ...f.selection, mode: "tutor" }, "note", f.write("Staff note"))).toMatchObject({ ok: true, committed: { author: { membershipId: f.multiMember.id, mode: "tutor", assisted: false } } });
  const child = await f.runtime.practice.enter(f.workRequest("multi"), { studentId: f.students[0].id });
  const childSelection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.work.append(f.workRequest("multi", child.handle), childSelection, "draft", f.write("Assisted", 1))).toMatchObject({ ok: true, committed: { author: { mode: "child-practice", assisted: true } } });
  await expect(f.work.append(f.workRequest("multi", child.handle), { ...f.selection, mode: "tutor" }, "note", f.write("forbidden", 1))).rejects.toMatchObject({ status: 403 });
  const stored = await f.owner(() => f.db.select().from(s.translationDraft).where(eq(s.translationDraft.version, 2)));
  expect(stored[0]).toMatchObject({ actorUserId: f.identities.multi.id, roleGrantId: f.parentGrant.id, guardianId: f.guardians[0].id, contextId: child.context.id });
  for (const id of [f.students[2].id, f.students[3].id]) await expect(f.work.page(f.workRequest("multi"), { ...f.selection, mode: "tutor", studentId: id })).rejects.toMatchObject({ status: 404 });
});

test("all history/receipt surfaces revalidate live assignment and removed verses, re-add restores historical bindings", async () => {
  const f = await fixture(), input = f.write();
  await f.work.append(f.workRequest(), f.selection, "draft", input);
  await f.owner(async () => {
    await f.db.update(s.assignment).set({ revision: 2, ref: "Genesis 1:2-12" }).where(eq(s.assignment.id, f.assignment.id));
    await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 11 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 2}` })));
  });
  expect(await f.work.history(f.workRequest(), f.selection, "draft", input.verseRef)).toEqual({ ok: false, code: "stale-revision" });
  const current = { ...f.selection, assignmentRevision: 2 };
  await expect(f.work.history(f.workRequest(), current, "draft", input.verseRef)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.receipt(f.workRequest(), current, "draft", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.append(f.workRequest(), current, "draft", input)).rejects.toMatchObject({ status: 404 });
  await f.owner(async () => {
    await f.db.update(s.assignment).set({ revision: 3, ref: "Genesis 1:1-12" }).where(eq(s.assignment.id, f.assignment.id));
    await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 12 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 1}` })));
  });
  expect(await f.work.history(f.workRequest("multi"), { ...current, assignmentRevision: 3, mode: "parent" }, "draft", input.verseRef)).toMatchObject({ versions: [{ assignmentRevision: 1, version: 1 }] });
  expect(await f.work.receipt(f.workRequest(), { ...current, assignmentRevision: 3 }, "draft", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1 });
  expect(await f.work.append(f.workRequest(), { ...current, assignmentRevision: 3 }, "draft", { ...input, expectedVersion: 1 })).toEqual({ ok: false, code: "conflict" });
});

test("HTTP has closed bounded bodies/queries, protected mutations and fixed private error/results", async () => {
  const f = await fixture();
  const url = `/api/students/${f.students[0].id}/work`;
  const { studentId: _id, ...binding } = f.selection;
  const call = (path: string, body?: unknown, headers?: Record<string, string>) => handleStudentWorkRequest(f.request(path, { who: "learner", body, headers }), f.runtime).then(response => response!);
  const query = new URLSearchParams(Object.entries(binding).map(([key, value]) => [key, String(value)])).toString();
  expect((await call(`${url}?${query}&mode=admin`)).status).toBe(400);
  expect((await call(`${url}?${query}&offset=12`)).status).toBe(400);
  for (const text of ["\ud800", "\0", "\x01", "\u0085", "x".repeat(4097)]) expect((await call(`${url}/draft`, { ...binding, ...f.write(text) })).status).toBe(400);
  expect((await call(`${url}/draft`, { ...binding, ...f.write(), actorUserId: f.identities.admin.id })).status).toBe(400);
  expect((await call(`${url}/draft`, { ...binding, ...f.write() }, { origin: "https://foreign.example.test" })).status).toBe(403);
  const saved = await call(`${url}/draft`, { ...binding, ...f.write("<b>Synthetic</b>") });
  expect(saved.status).toBe(200); expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toMatchObject({ committed: { text: "<b>Synthetic</b>" } });
  expect((await call(`${url}/note`, { ...binding, ...f.write("   ") })).status).toBe(400);
});

test("full dispatcher sends exact work routes to the work service before the broader portal namespace", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(action => action(f.runtime));
  const url = `/api/students/${f.students[0].id}/work`, { studentId: _id, ...binding } = f.selection;
  const query = new URLSearchParams(Object.entries(binding).map(([key, value]) => [key, String(value)]));
  const get = await dispatch(f.request(`${url}?${query}`, { who: "learner" }));
  expect(get.status).toBe(200); expect(await get.json()).toMatchObject({ ok: true, offset: 0, nextOffset: 10 });
  const saved = await dispatch(f.request(`${url}/draft`, { who: "learner", body: { ...binding, ...f.write("Synthetic dispatch append") } }));
  expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ ok: true, committedVersion: 1, committed: { text: "Synthetic dispatch append" } });
  const read = await dispatch(f.request(`${url}?${query}`, { who: "learner" })); expect(await read.json()).toMatchObject({ verses: [expect.objectContaining({ draft: expect.objectContaining({ version: 1 }) }), ...Array.from({ length: 9 }, () => expect.anything())] });
  expect((await dispatch(f.request(`${url}?${query}&mode=admin`, { who: "learner" }))).status).toBe(400);
  expect((await dispatch(f.request(`${url}?${query}`, { who: "learner", method: "POST", body: {} }))).status).toBe(405);
  expect((await dispatch(f.request(`${url}/draft`, { who: "learner", body: { ...binding, ...f.write("Synthetic foreign", 1) }, headers: { origin: "https://foreign.example.test" } }))).status).toBe(403);
  expect((await dispatch(f.request(`/api/students/${f.students[3].id}/work?${query}`, { who: "learner" }))).status).toBe(404);
  expect((await dispatch(f.request(`${url}/unowned`, { who: "learner" }))).status).toBe(404);
  expect((await dispatch(f.request("/api/unowned", { who: "learner" }))).status).toBe(404);
});

test("bounded version history uses descending cursor and revoked notes remain visible", async () => {
  const f = await fixture();
  await f.owner(() => f.db.update(s.user).set({ name: "Synthetic retained staff" }).where(eq(s.user.id, f.identities.multi.id)));
  const tutor = { ...f.selection, mode: "tutor" as const };
  for (let i = 0; i < 23; i++) expect(await f.work.append(f.workRequest("multi"), tutor, "note", f.write(`Synthetic note ${i}`, i))).toMatchObject({ ok: true });
  await f.owner(() => f.db.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.tutorLink.id)));
  const first = await f.work.history(f.workRequest(), f.selection, "note", "Genesis 1:1");
  expect(first).toMatchObject({ nextBeforeVersion: 4, versions: expect.arrayContaining([expect.objectContaining({ author: expect.objectContaining({ displayName: "Synthetic retained staff" }) })]) });
  if (first.ok) expect(first.versions).toHaveLength(20);
  expect(await f.work.history(f.workRequest(), f.selection, "note", "Genesis 1:1", 4)).toMatchObject({ versions: [{ version: 3 }, { version: 2 }, { version: 1 }], nextBeforeVersion: null });
  const page = await f.work.page(f.workRequest(), f.selection);
  if (page.ok) expect(page.verses[0].notes).toHaveLength(3);
  await expect(f.work.page(f.workRequest("multi"), tutor)).rejects.toMatchObject({ status: 404 });
});

test("receipt reads require same actor and live scope but may use another authorized mode", async () => {
  const f = await fixture(), input = f.write("Synthetic staff note");
  await f.work.append(f.workRequest("multi"), { ...f.selection, mode: "tutor" }, "note", input);
  expect(await f.work.receipt(f.workRequest("multi"), { ...f.selection, mode: "parent" }, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1 });
  await expect(f.work.receipt(f.workRequest("admin"), { ...f.selection, mode: "admin" }, "note", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.receipt(f.workRequest("multi"), { ...f.selection, mode: "parent" }, "note", "Genesis 1:2", input.mutationId)).rejects.toMatchObject({ status: 404 });
});

test("email-shaped account names use safe author labels on current/history/receipt responses", async () => {
  const f = await fixture(), input = f.write("Synthetic note");
  await f.owner(() => f.db.update(s.user).set({ name: "synthetic-staff@example.test" }).where(eq(s.user.id, f.identities.multi.id)));
  const selection = { ...f.selection, mode: "tutor" as const };
  const appended = await f.work.append(f.workRequest("multi"), selection, "note", input);
  expect(appended).toMatchObject({ committed: { author: { displayName: "Portal member", membershipId: f.multiMember.id } } });
  const page = await f.work.page(f.workRequest(), f.selection);
  if (!page.ok) throw new Error("Expected work page");
  expect(page.verses[0].notes[0].author.displayName).toBe("Portal member");
  const history = await f.work.history(f.workRequest(), f.selection, "note", input.verseRef);
  expect(history).toMatchObject({ versions: [{ author: { displayName: "Portal member" } }] });
  const receipt = await f.work.receipt(f.workRequest("multi"), selection, "note", input.verseRef, input.mutationId);
  expect(receipt).toMatchObject({ committed: { author: { displayName: "Portal member" } } });
  expect(JSON.stringify([appended, page, history, receipt])).not.toContain("@");
});

test("maximum valid quote-heavy texts produce bounded useful pages at verse boundaries", async () => {
  const f = await fixture(), text = '"'.repeat(4096);
  await f.work.append(f.workRequest(), f.selection, "draft", f.write(text));
  await f.work.append(f.workRequest("multi"), { ...f.selection, mode: "tutor" }, "note", f.write(text));
  await f.owner(async () => {
    const [draft] = await f.db.select().from(s.translationDraft), [note] = await f.db.select().from(s.tutorNote);
    const { id: _draftId, ...draftValues } = draft, { id: _noteId, ...noteValues } = note;
    await f.db.insert(s.translationDraft).values(Array.from({ length: 11 }, (_, i) => ({ ...draftValues, verseRef: `Genesis 1:${i + 2}`, mutationId: randomUUID() })));
    await f.db.insert(s.tutorNote).values(Array.from({ length: 36 }, (_, i) => ({ ...noteValues, verseRef: `Genesis 1:${Math.floor(i / 3) + 1}`, version: i % 3 + 1, baseVersion: i % 3, mutationId: randomUUID() })).slice(1));
  });
  const page = await f.work.page(f.workRequest(), f.selection);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(256 * 1024);
  if (!page.ok) throw new Error("Expected work page");
  expect(page.nextOffset).toBeGreaterThan(0); expect(page.nextOffset).toBeLessThan(10);
  expect(page.nextOffset).toBe(page.verses.length);
  const next = await f.work.page(f.workRequest(), f.selection, page.nextOffset!);
  if (!next.ok) throw new Error("Expected next work page");
  expect([...page.verses, ...next.verses].map(row => row.ref)).toEqual(Array.from({ length: 12 }, (_, i) => `Genesis 1:${i + 1}`));
});

test("maximum PostgreSQL version remains visible in latest/history/receipt and replay", async () => {
  const f = await fixture(), original = f.write();
  await f.work.append(f.workRequest(), f.selection, "draft", original);
  await f.owner(async () => {
    const [row] = await f.db.select().from(s.translationDraft);
    const { id: _id, ...values } = row;
    await f.db.insert(s.translationDraft).values({ ...values, version: 2147483646, baseVersion: 2147483645, mutationId: randomUUID() });
  });
  const input = f.write("Synthetic final version", 2147483646);
  expect(await f.work.append(f.workRequest(), f.selection, "draft", input)).toMatchObject({ committedVersion: 2147483647 });
  expect(await f.work.append(f.workRequest(), f.selection, "draft", input)).toMatchObject({ replayed: true, committedVersion: 2147483647, currentLatestVersion: 2147483647 });
  const page = await f.work.page(f.workRequest(), f.selection);
  if (page.ok) expect(page.verses[0].draft?.version).toBe(2147483647);
  expect(await f.work.history(f.workRequest(), f.selection, "draft", input.verseRef)).toMatchObject({ versions: [{ version: 2147483647 }, { version: 2147483646 }, { version: 1 }] });
  expect(await f.work.receipt(f.workRequest(), f.selection, "draft", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 2147483647, currentLatestVersion: 2147483647 });
});

test("fresh migration enforces retained immutable rows, mode/grant/assignment FK lineage, and runtime grants/RLS", async () => {
  const f = await fixture(); await f.work.append(f.workRequest(), f.selection, "draft", f.write());
  await f.owner(async () => {
    const [row] = await f.db.select().from(s.translationDraft);
    const { id: _id, ...values } = row;
    for (const changed of [{ actorUserId: f.identities.admin.id }, { roleGrantId: f.tutorGrant.id }, { studentId: f.students[1].id }, { tenantId: "other" }]) {
      await expect(f.db.insert(s.translationDraft).values({ ...values, mutationId: randomUUID(), verseRef: "Genesis 1:2", ...changed })).rejects.toBeDefined();
    }
    await expect(f.db.update(s.translationDraft).set({ text: "changed" })).rejects.toBeDefined();
    await expect(f.db.delete(s.translationDraft)).rejects.toBeDefined();
    const result = await f.db.execute(sql`select has_table_privilege('portal_runtime','translation_draft','SELECT') as read, has_table_privilege('portal_runtime','translation_draft','INSERT') as append, has_table_privilege('portal_runtime','translation_draft','UPDATE') as update, has_table_privilege('portal_runtime','translation_draft','DELETE') as delete`);
    expect(result.rows[0]).toEqual({ read: true, append: true, update: false, delete: false });
    const flags = await f.db.execute(sql`select relrowsecurity, relforcerowsecurity from pg_class where relname in ('translation_draft','tutor_note')`);
    expect(flags.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }, { relrowsecurity: true, relforcerowsecurity: true }]);
  });
});
