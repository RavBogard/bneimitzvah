import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { handleStudentWorkRequest } from "../../src/server/http/student-work";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import type { WorkSelection } from "../../src/server/student-work/validation";

// A verse's student-visible notes from a tutor or the rabbi. A student's own translation ("My translation", the draft stream) was removed on
// 2026-11-17 (Daniel); its rows stay in translation_draft, which the last test still checks for grants, RLS and immutability.
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
  const tutor: WorkSelection = { ...selection, mode: "tutor" };
  const write = (text = "Synthetic note", expectedVersion = 0) => ({ verseRef: "Genesis 1:1", text, expectedVersion, mutationId: randomUUID() });
  const request = (who: "learner" | "multi" | "admin" = "learner", handle?: string) => f.request("/", { who, method: "POST", handle });
  return { ...f, assignment, selection, tutor, write, work: f.runtime.studentWork, workRequest: request };
}

test("newer locked revision recovery explicitly distinguishes original committed and absent mutations without writing", async () => {
  const f = await fixture(), written = f.write("Synthetic original committed"), absent = f.write("Synthetic original absent"), initial = await f.work.page(f.workRequest("multi"), f.tutor);
  if (!initial.ok) throw new Error("Synthetic work authority missing");
  await f.work.append(f.workRequest("multi"), f.tutor, "note", written);
  await f.owner(() => f.db.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)));
  const current = { ...f.tutor, assignmentRevision: 2 };
  expect(await f.work.recovery(f.workRequest("multi"), current, "note", 1, written, initial.authorityBinding)).toMatchObject({ ok: true, outcome: "committed", assignmentRevision: 2, originalRevision: 1, mutationId: written.mutationId, verseRef: written.verseRef, stream: "note", receipt: { committed: { assignmentRevision: 1, text: written.text } } });
  expect(await f.work.recovery(f.workRequest("multi"), current, "note", 1, absent, initial.authorityBinding)).toMatchObject({ ok: true, outcome: "absent", assignmentRevision: 2, originalRevision: 1, mutationId: absent.mutationId, receipt: null });
  expect(await f.work.recovery(f.workRequest("multi"), current, "note", 2, absent, initial.authorityBinding)).toEqual({ ok: false, code: "invalid-request" });
  for (const altered of [{ ...written, text: "Synthetic mismatched original" }, { ...written, expectedVersion: 1 }, { ...written, verseRef: "Genesis 1:2" }]) expect(await f.work.recovery(f.workRequest("multi"), current, "note", 1, altered, initial.authorityBinding)).toEqual({ ok: false, code: "conflict" });
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", absent)).toEqual({ ok: false, code: "stale-revision" });
  expect(await f.owner(() => f.db.select().from(s.tutorNote))).toHaveLength(1);
  expect(await f.work.history(f.workRequest("multi"), current, "note", written.verseRef)).toMatchObject({ versions: [{ version: 1, assignmentRevision: 1 }] });
});

test("recovery is body-only, closed, Origin checked, privately cached and restricted to current writable streams", async () => {
  const f = await fixture(), initial = await f.work.page(f.workRequest("multi"), f.tutor); if (!initial.ok) throw new Error("Synthetic work authority missing");
  await f.owner(() => f.db.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)));
  const { studentId: _studentId, ...binding } = { ...f.tutor, assignmentRevision: 2 }, body = { ...binding, stream: "note", originalRevision: 1, write: f.write(), authorityBinding: initial.authorityBinding };
  const path = `/api/students/${f.students[0].id}/work/recovery`, call = (value: unknown = body, headers?: Record<string, string>, suffix = "") => handleStudentWorkRequest(f.request(`${path}${suffix}`, { who: "multi", body: value, headers }), f.runtime);
  const response = (await call())!; expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(await response.json()).toMatchObject({ outcome: "absent", receipt: null });
  expect((await call(body, { origin: "https://foreign.example.test" }))!.status).toBe(403);
  expect((await call({ ...body, extra: true }))!.status).toBe(400);
  expect((await call({ ...body, write: { ...body.write, assignmentRevision: 1 } }))!.status).toBe(400);
  expect((await call(body, undefined, "?originalRevision=1"))!.status).toBe(400);
  // The removed translation stream is no longer a stream at all.
  expect((await call({ ...body, stream: "draft" }))!.status).toBe(400);
  expect((await handleStudentWorkRequest(f.request(path, { who: "multi" }), f.runtime))!.status).toBe(405);
  for (const [mode, who] of [["student", "learner"], ["parent", "multi"]] as const) await expect(f.work.recovery(f.workRequest(who), { ...f.selection, mode, assignmentRevision: 2 }, "note", 1, body.write, initial.authorityBinding)).rejects.toMatchObject({ status: 403 });
});

test("work authority is opaque, stable across assignment-only edits, and changes for student, relationship, grant and membership revisions", async () => {
  const f = await fixture();
  const binding = async () => { const page = await f.work.page(f.workRequest(), { ...f.selection, assignmentRevision: 2 }); if (!page.ok) throw new Error("Synthetic work authority missing"); return page.authorityBinding; };
  const first = await f.work.page(f.workRequest(), f.selection), staff = await f.work.page(f.workRequest("multi"), f.tutor); if (!first.ok || !staff.ok) throw new Error("Synthetic work authority missing");
  expect(first.authorityBinding).toMatch(/^[A-Za-z0-9_-]{43}$/);
  for (const sensitive of [f.identities.learner.id, f.identities.learner.sessionId, f.learnerMember.id, f.learnerGrant.id, f.learnerLink.id]) expect(first.authorityBinding).not.toContain(sensitive);
  await f.owner(() => f.db.update(s.assignment).set({ revision: 2 }).where(eq(s.assignment.id, f.assignment.id)));
  expect(await binding()).toBe(first.authorityBinding); let prior = first.authorityBinding;
  for (const update of [
    () => f.db.update(s.student).set({ revision: 2 }).where(eq(s.student.id, f.students[0].id)),
    async () => { await f.db.update(s.studentIdentity).set({ revokedAt: new Date() }).where(eq(s.studentIdentity.id, f.learnerLink.id)); await f.db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: f.students[0].id, roleGrantId: f.learnerGrant.id }); },
    () => f.db.update(s.roleGrant).set({ revision: 2 }).where(eq(s.roleGrant.id, f.learnerGrant.id)),
    () => f.db.update(s.membership).set({ authorityRevision: 2 }).where(eq(s.membership.id, f.learnerMember.id)),
  ]) { await f.owner(async () => { await update(); }); const next = await binding(); expect(next).not.toBe(prior); prior = next; }
  // The student's revision changed, so the tutor's earlier binding no longer recovers anything.
  await expect(f.work.recovery(f.workRequest("multi"), { ...f.tutor, assignmentRevision: 2 }, "note", 1, f.write(), staff.authorityBinding)).rejects.toMatchObject({ status: 404 });
});

test("notes preserve hostile plain text/Unicode, refuse an empty note, and keep CAS receipts and committed versus latest", async () => {
  const f = await fixture(), input = f.write(" <script>alert('synthetic')</script>\r\nא 😀 \t");
  const first = await f.work.append(f.workRequest("multi"), f.tutor, "note", input);
  expect(first).toMatchObject({ ok: true, replayed: false, committedVersion: 1, currentLatestVersion: 1, committed: { text: input.text.replace(/\r\n/g, "\n") } });
  await expect(f.work.append(f.workRequest("multi"), f.tutor, "note", f.write(" \n\t", 1))).rejects.toMatchObject({ status: 400 });
  await expect(f.work.append(f.workRequest("multi"), f.tutor, "draft" as never, f.write("Synthetic retired stream", 1))).rejects.toMatchObject({ status: 400 });
  const second = await f.work.append(f.workRequest("multi"), f.tutor, "note", f.write("Synthetic second", 1));
  expect(second).toMatchObject({ ok: true, committedVersion: 2, committed: { text: "Synthetic second" } });
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", input)).toMatchObject({ ok: true, replayed: true, committedVersion: 1, currentLatestVersion: 2 });
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", { ...input, text: "changed" })).toEqual({ ok: false, code: "conflict" });
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", f.write("stale", 0))).toEqual({ ok: false, code: "conflict" });
  expect(await f.work.receipt(f.workRequest("multi"), f.tutor, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1, currentLatestVersion: 2 });
  const page = await f.work.page(f.workRequest(), f.selection);
  expect(page).toMatchObject({ ok: true, nextOffset: 10 });
  if (page.ok) { expect(page.verses).toHaveLength(10); expect(page.verses[0]).not.toHaveProperty("draft"); expect(page.verses[0].notes[0].text).toBe("Synthetic second"); expect(page.verses[1].notes).toEqual([]); }
  const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(eq(s.auditEvent.action, "note.append")));
  expect(audits).toHaveLength(2); expect(audits[0]).not.toHaveProperty("text");
});

test("role matrix and child practice: everyone linked reads notes, only staff write them", async () => {
  const f = await fixture();
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", f.write("Staff note"))).toMatchObject({ ok: true, committed: { author: { membershipId: f.multiMember.id, mode: "tutor", assisted: false } } });
  for (const [mode, who] of [["student", "learner"], ["parent", "multi"], ["tutor", "multi"], ["admin", "admin"]] as const) {
    const selection = { ...f.selection, mode };
    expect(await f.work.page(f.workRequest(who), selection)).toMatchObject({ ok: true, verses: [{ notes: [{ text: "Staff note" }] }, ...Array.from({ length: 9 }, () => expect.anything())] });
    if (mode === "student" || mode === "parent") await expect(f.work.append(f.workRequest(who), selection, "note", f.write("forbidden", 1))).rejects.toMatchObject({ status: 403 });
  }
  const child = await f.runtime.practice.enter(f.workRequest("multi"), { studentId: f.students[0].id });
  const childSelection = { ...f.selection, mode: "child-practice" as const };
  expect(await f.work.page(f.workRequest("multi", child.handle), childSelection)).toMatchObject({ ok: true, verses: [{ notes: [{ text: "Staff note" }] }, ...Array.from({ length: 9 }, () => expect.anything())] });
  await expect(f.work.append(f.workRequest("multi", child.handle), childSelection, "note", f.write("forbidden", 1))).rejects.toMatchObject({ status: 403 });
  await expect(f.work.append(f.workRequest("multi", child.handle), { ...f.selection, mode: "tutor" }, "note", f.write("forbidden", 1))).rejects.toMatchObject({ status: 403 });
  expect(await f.owner(() => f.db.select().from(s.translationDraft))).toHaveLength(0);
  for (const id of [f.students[2].id, f.students[3].id]) await expect(f.work.page(f.workRequest("multi"), { ...f.selection, mode: "tutor", studentId: id })).rejects.toMatchObject({ status: 404 });
});

test("all history/receipt surfaces revalidate live assignment and removed verses, re-add restores historical bindings", async () => {
  const f = await fixture(), input = f.write();
  await f.work.append(f.workRequest("multi"), f.tutor, "note", input);
  await f.owner(async () => {
    await f.db.update(s.assignment).set({ revision: 2, ref: "Genesis 1:2-12" }).where(eq(s.assignment.id, f.assignment.id));
    await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 11 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 2}` })));
  });
  expect(await f.work.history(f.workRequest("multi"), f.tutor, "note", input.verseRef)).toEqual({ ok: false, code: "stale-revision" });
  const current = { ...f.tutor, assignmentRevision: 2 };
  await expect(f.work.history(f.workRequest("multi"), current, "note", input.verseRef)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.receipt(f.workRequest("multi"), current, "note", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.append(f.workRequest("multi"), current, "note", input)).rejects.toMatchObject({ status: 404 });
  await f.owner(async () => {
    await f.db.update(s.assignment).set({ revision: 3, ref: "Genesis 1:1-12" }).where(eq(s.assignment.id, f.assignment.id));
    await f.db.delete(s.assignmentVerse).where(eq(s.assignmentVerse.assignmentId, f.assignment.id));
    await f.db.insert(s.assignmentVerse).values(Array.from({ length: 12 }, (_, i) => ({ tenantId: "crc", studentId: f.students[0].id, assignmentId: f.assignment.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 1}` })));
  });
  expect(await f.work.history(f.workRequest("multi"), { ...current, assignmentRevision: 3, mode: "parent" }, "note", input.verseRef)).toMatchObject({ versions: [{ assignmentRevision: 1, version: 1 }] });
  expect(await f.work.receipt(f.workRequest("multi"), { ...current, assignmentRevision: 3 }, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1 });
  expect(await f.work.append(f.workRequest("multi"), { ...current, assignmentRevision: 3 }, "note", { ...input, expectedVersion: 1 })).toEqual({ ok: false, code: "conflict" });
});

test("HTTP has closed bounded bodies/queries, protected mutations and fixed private error/results", async () => {
  const f = await fixture();
  const url = `/api/students/${f.students[0].id}/work`;
  const { studentId: _id, ...binding } = f.tutor;
  const call = (path: string, body?: unknown, headers?: Record<string, string>) => handleStudentWorkRequest(f.request(path, { who: "multi", body, headers }), f.runtime).then(response => response!);
  const query = new URLSearchParams(Object.entries(binding).map(([key, value]) => [key, String(value)])).toString();
  expect((await call(`${url}?${query}&mode=admin`)).status).toBe(400);
  expect((await call(`${url}?${query}&offset=12`)).status).toBe(400);
  for (const text of ["\ud800", "\0", "\x01", "\u0085", "x".repeat(4097), "   "]) expect((await call(`${url}/note`, { ...binding, ...f.write(text) })).status).toBe(400);
  expect((await call(`${url}/note`, { ...binding, ...f.write(), actorUserId: f.identities.admin.id })).status).toBe(400);
  expect((await call(`${url}/note`, { ...binding, ...f.write() }, { origin: "https://foreign.example.test" })).status).toBe(403);
  const saved = await call(`${url}/note`, { ...binding, ...f.write("<b>Synthetic</b>") });
  expect(saved.status).toBe(200); expect(saved.headers.get("cache-control")).toBe("private, no-store");
  expect(await saved.json()).toMatchObject({ committed: { text: "<b>Synthetic</b>" } });
  // The student's translation route is gone: this handler does not own it.
  expect(await handleStudentWorkRequest(f.request(`${url}/draft`, { who: "learner", body: { ...binding, mode: "student", ...f.write() } }), f.runtime)).toBeNull();
  expect((await call(`${url}/history?${query}&stream=draft&verseRef=Genesis%201%3A1`)).status).toBe(400);
});

test("full dispatcher sends exact work routes to the work service before the broader portal namespace", async () => {
  const f = await fixture(), dispatch = createHttpDispatcher(action => action(f.runtime));
  const url = `/api/students/${f.students[0].id}/work`, { studentId: _id, ...binding } = f.selection, { studentId: _tutorId, ...staff } = f.tutor;
  const query = new URLSearchParams(Object.entries(binding).map(([key, value]) => [key, String(value)]));
  const get = await dispatch(f.request(`${url}?${query}`, { who: "learner" }));
  expect(get.status).toBe(200); expect(await get.json()).toMatchObject({ ok: true, offset: 0, nextOffset: 10 });
  const saved = await dispatch(f.request(`${url}/note`, { who: "multi", body: { ...staff, ...f.write("Synthetic dispatch append") } }));
  expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ ok: true, committedVersion: 1, committed: { text: "Synthetic dispatch append" } });
  const read = await dispatch(f.request(`${url}?${query}`, { who: "learner" })); expect(await read.json()).toMatchObject({ verses: [expect.objectContaining({ notes: [expect.objectContaining({ version: 1 })] }), ...Array.from({ length: 9 }, () => expect.anything())] });
  expect((await dispatch(f.request(`${url}?${query}&mode=admin`, { who: "learner" }))).status).toBe(400);
  expect((await dispatch(f.request(`${url}?${query}`, { who: "learner", method: "POST", body: {} }))).status).toBe(405);
  expect((await dispatch(f.request(`${url}/note`, { who: "multi", body: { ...staff, ...f.write("Synthetic foreign", 1) }, headers: { origin: "https://foreign.example.test" } }))).status).toBe(403);
  expect((await dispatch(f.request(`/api/students/${f.students[3].id}/work?${query}`, { who: "learner" }))).status).toBe(404);
  // A student's translation route answers as any unknown route does (removed 2026-11-17).
  expect((await dispatch(f.request(`${url}/draft`, { who: "learner", body: { ...binding, ...f.write("Synthetic retired translation") } }))).status).toBe(404);
  expect((await dispatch(f.request(`${url}/unowned`, { who: "learner" }))).status).toBe(404);
  expect((await dispatch(f.request("/api/unowned", { who: "learner" }))).status).toBe(404);
  expect(await f.owner(() => f.db.select().from(s.translationDraft))).toHaveLength(0);
});

test("bounded version history uses descending cursor and revoked notes remain visible", async () => {
  const f = await fixture();
  await f.owner(() => f.db.update(s.user).set({ name: "Synthetic retained staff" }).where(eq(s.user.id, f.identities.multi.id)));
  const tutor = f.tutor;
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
  await f.work.append(f.workRequest("multi"), f.tutor, "note", input);
  expect(await f.work.receipt(f.workRequest("multi"), { ...f.selection, mode: "parent" }, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 1 });
  await expect(f.work.receipt(f.workRequest("admin"), { ...f.selection, mode: "admin" }, "note", input.verseRef, input.mutationId)).rejects.toMatchObject({ status: 404 });
  await expect(f.work.receipt(f.workRequest("multi"), { ...f.selection, mode: "parent" }, "note", "Genesis 1:2", input.mutationId)).rejects.toMatchObject({ status: 404 });
});

test("email-shaped account names use safe author labels on current/history/receipt responses", async () => {
  const f = await fixture(), input = f.write("Synthetic note");
  await f.owner(() => f.db.update(s.user).set({ name: "synthetic-staff@example.test" }).where(eq(s.user.id, f.identities.multi.id)));
  const selection = f.tutor;
  const appended = await f.work.append(f.workRequest("multi"), selection, "note", input);
  expect(appended).toMatchObject({ committed: { author: { displayName: "your tutor", membershipId: f.multiMember.id } } });
  const page = await f.work.page(f.workRequest(), f.selection);
  if (!page.ok) throw new Error("Expected work page");
  expect(page.verses[0].notes[0].author.displayName).toBe("your tutor");
  const history = await f.work.history(f.workRequest(), f.selection, "note", input.verseRef);
  expect(history).toMatchObject({ versions: [{ author: { displayName: "your tutor" } }] });
  const receipt = await f.work.receipt(f.workRequest("multi"), selection, "note", input.verseRef, input.mutationId);
  expect(receipt).toMatchObject({ committed: { author: { displayName: "your tutor" } } });
  expect(JSON.stringify([appended, page, history, receipt])).not.toContain("@");
});

test("maximum valid quote-heavy texts produce bounded useful pages at verse boundaries", async () => {
  const f = await fixture(), text = '"'.repeat(4096);
  await f.work.append(f.workRequest("multi"), f.tutor, "note", f.write(text));
  await f.owner(async () => {
    const [note] = await f.db.select().from(s.tutorNote);
    const { id: _noteId, ...noteValues } = note;
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
  await f.work.append(f.workRequest("multi"), f.tutor, "note", original);
  await f.owner(async () => {
    const [row] = await f.db.select().from(s.tutorNote);
    const { id: _id, ...values } = row;
    await f.db.insert(s.tutorNote).values({ ...values, version: 2147483646, baseVersion: 2147483645, mutationId: randomUUID() });
  });
  const input = f.write("Synthetic final version", 2147483646);
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", input)).toMatchObject({ committedVersion: 2147483647 });
  expect(await f.work.append(f.workRequest("multi"), f.tutor, "note", input)).toMatchObject({ replayed: true, committedVersion: 2147483647, currentLatestVersion: 2147483647 });
  const page = await f.work.page(f.workRequest(), f.selection);
  if (page.ok) expect(page.verses[0].notes[0].version).toBe(2147483647);
  expect(await f.work.history(f.workRequest(), f.selection, "note", input.verseRef)).toMatchObject({ versions: [{ version: 2147483647 }, { version: 2147483646 }, { version: 1 }] });
  expect(await f.work.receipt(f.workRequest("multi"), f.tutor, "note", input.verseRef, input.mutationId)).toMatchObject({ committedVersion: 2147483647, currentLatestVersion: 2147483647 });
});

test("fresh migration enforces retained immutable rows, mode/grant/assignment FK lineage, and runtime grants/RLS", async () => {
  // The table stays although nothing writes it any more: a student's row is inserted directly, as the removed service did.
  const f = await fixture();
  await f.owner(async () => {
    await f.db.insert(s.translationDraft).values({ tenantId: "crc", studentId: f.students[0].id, verseRef: "Genesis 1:1", version: 1, baseVersion: 0, assignmentId: f.assignment.id, assignmentRevision: 1,
      text: "Synthetic retained translation", actorUserId: f.identities.learner.id, actorMembershipId: f.learnerMember.id, roleGrantId: f.learnerGrant.id, role: "student", mode: "student",
      studentIdentityId: f.learnerLink.id, mutationId: randomUUID(), requestDigest: "a".repeat(64) });
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
  // A retained translation row is never shown: the page carries notes only.
  const page = await f.work.page(f.workRequest(), f.selection);
  if (!page.ok) throw new Error("Expected work page");
  expect(JSON.stringify(page)).not.toContain("Synthetic retained translation");
});
