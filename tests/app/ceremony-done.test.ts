import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { withTenantTransaction } from "../../src/server/db/runtime";
import { rosterRows } from "../../src/server/roster-sheet/rows";
import { createCeremonyDoneService } from "../../src/server/students/ceremony-done";
import { ORIGIN as MCP_ORIGIN, closeMcpFixtures, mcpFixture } from "./mcp-fixture";

// Release 1.9 N21, "Ceremony done" (decision 13; PLAN Decided here 5: it narrows access, never widens it). Synthetic people only.
// The fixture's "multi" is the tutor of Sibling A (with a live tutor_student row) and the parent of Siblings A and B; "learner"
// is Sibling A's own student account; students[3] belongs to another congregation.
const ORIGIN = "http://localhost:3000";
const opened: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });
type Who = "admin" | "multi" | "learner" | "recipient";

async function setup() {
  const f = await portalRoutesFixture(); opened.push(f);
  const dispatch = createHttpDispatcher(async action => action(f.runtime));
  const [own, sibling, unrelated, other] = f.students;
  const call = async (path: string, who: Who, body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers); h.set("cookie", f.identities[who].cookie);
    if (body !== undefined) { if (!h.has("origin")) h.set("origin", ORIGIN); h.set("content-type", "application/json"); }
    const response = await dispatch(new Request(`${ORIGIN}${path}`, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const revisionOf = async (studentId: string) => (await f.owner(() => f.db.select({ revision: s.student.revision }).from(s.student).where(eq(s.student.id, studentId))))[0].revision;
  const setDone = async (who: Who, studentId: string, headers: Record<string, string> = {}) => call(`/api/admin/students/${studentId}/ceremony-done`, who, { expectedRevision: await revisionOf(studentId) }, headers);
  const reverse = async (who: Who, studentId: string) => call(`/api/admin/students/${studentId}/ceremony-reverse`, who, { expectedRevision: await revisionOf(studentId) });
  const liveTutorRows = (studentId: string) => f.owner(async () => (await f.db.select({ id: s.tutorStudent.id }).from(s.tutorStudent)
    .where(and(eq(s.tutorStudent.studentId, studentId), isNull(s.tutorStudent.revokedAt)))).length);
  const audits = () => f.owner(async () => (await f.db.select({ action: s.auditEvent.action, student: s.auditEvent.actingStudentId, mode: s.auditEvent.mode }).from(s.auditEvent))
    .filter(row => row.action.startsWith("ceremony-done.") || row.action === "tutor.revoke"));
  const names = (rows: { id: string }[]) => rows.map(row => row.id === own.id ? "own" : row.id === sibling.id ? "sibling" : row.id === unrelated.id ? "unrelated" : "else").sort();
  const list = async (who: Who, mode: string) => { const r = await call(`/api/students?mode=${mode}`, who); return r.status === 200 ? names(r.json.students) : r.status; };
  const sheet = () => withTenantTransaction(f.db, { tenantId: "crc" }, tx => rosterRows(tx, "crc")).then(rows => rows.slice(1).map(row => row[0]).sort());
  return { f, call, setDone, reverse, liveTutorRows, audits, list, sheet, revisionOf, own, sibling, unrelated, other };
}

// What each person reaches of Sibling A, by status (and for lists, by who is listed).
async function reach(t: Awaited<ReturnType<typeof setup>>) {
  const id = t.own.id, status = async (path: string, who: Who) => (await t.call(path, who)).status;
  return {
    student: { list: await t.list("learner", "student"), student: await status(`/api/students/${id}?mode=student`, "learner"), reading: await status(`/api/students/${id}/reading?mode=student`, "learner"),
      learn: await status("/api/learn/progress", "learner"), service: await status("/api/learn/service/progress", "learner"), saved: await status("/api/saved/readings", "learner"),
      session: await status("/api/session", "learner") },
    parent: { list: await t.list("multi", "parent"), student: await status(`/api/students/${id}?mode=parent`, "multi"), reading: await status(`/api/students/${id}/reading?mode=parent`, "multi") },
    tutor: { list: await t.list("multi", "tutor"), student: await status(`/api/students/${id}?mode=tutor`, "multi"), reading: await status(`/api/students/${id}/reading?mode=tutor`, "multi"),
      finished: await status(`/api/students/${id}/service-finished?mode=tutor`, "multi") },
  };
}

describe("Ceremony done narrows access, never widens it", () => {
  it("keeps the student's sign-in, Learn, saved readings and Study and the parent's view, and ends the old tutor's access everywhere", async () => {
    const t = await setup();
    const before = await reach(t);
    expect(before.tutor).toMatchObject({ list: ["own"], student: 200, reading: 200 });
    expect(await t.sheet()).toEqual(["Synthetic Sibling A", "Synthetic Sibling B", "Synthetic Unrelated"]);
    expect(await t.list("admin", "admin")).toEqual(["own", "sibling", "unrelated"]);

    const done = await t.setDone("admin", t.own.id);
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ ok: true, id: t.own.id });
    expect(await t.liveTutorRows(t.own.id)).toBe(0);
    expect(await t.audits()).toEqual(expect.arrayContaining([{ action: "tutor.revoke", student: t.own.id, mode: "admin" }, { action: "ceremony-done.set", student: t.own.id, mode: "admin" }]));

    const after = await reach(t);
    // The student and the parent reach exactly what they reached before.
    expect(after.student).toEqual(before.student);
    expect(after.student).toMatchObject({ list: ["own"], student: 200, learn: 200, service: 200, session: 200 });
    expect(after.parent).toEqual(before.parent);
    // The old tutor reads nothing: no list entry, the same 404 as a student who does not exist.
    expect(after.tutor).toEqual({ list: [], student: 404, reading: 404, finished: 404 });
    // In no active list: the admin's list, the staff Sheet; the admin roster names it apart.
    expect(await t.list("admin", "admin")).toEqual(["sibling", "unrelated"]);
    expect(await t.sheet()).toEqual(["Synthetic Sibling B", "Synthetic Unrelated"]);
    const roster = await t.call("/api/admin/students", "admin");
    const row = roster.json.students.find((x: { id: string }) => x.id === t.own.id);
    expect(typeof row.ceremonyDoneAt).toBe("string");
    expect(roster.json.students.filter((x: { ceremonyDoneAt: string | null }) => x.ceremonyDoneAt).length).toBe(1);
    // The admin still opens the student.
    expect((await t.call(`/api/students/${t.own.id}?mode=admin`, "admin")).status).toBe(200);
  });

  it("refuses a tutor, a parent, the student, a cross-site request and another congregation's student", async () => {
    const t = await setup();
    for (const who of ["multi", "learner", "recipient"] as const) expect((await t.setDone(who, t.sibling.id)).status, who).toBe(403);
    expect((await t.setDone("admin", t.sibling.id, { origin: "https://elsewhere.example.test" })).status).toBe(403);
    expect((await t.call(`/api/admin/students/${t.other.id}/ceremony-done`, "admin", { expectedRevision: 1 })).status).toBe(404);
    expect((await t.call(`/api/admin/students/${t.sibling.id}/ceremony-done`, "admin", { expectedRevision: 99 })).status).toBe(409);
    expect((await t.call(`/api/admin/students/${t.sibling.id}/ceremony-done`, "admin", {})).status).toBe(400);
    expect((await t.call(`/api/admin/students/${t.sibling.id}/ceremony-done`, "admin")).status).toBe(405);
    // Nothing was written by any refused request.
    expect(await t.f.owner(() => t.f.db.select().from(s.studentCeremonyDone))).toEqual([]);
    // Nor may anyone but an admin reverse it.
    expect((await t.setDone("admin", t.own.id)).status).toBe(200);
    for (const who of ["multi", "learner", "recipient"] as const) expect((await t.reverse(who, t.own.id)).status, who).toBe(403);
    // The service refuses any mode but admin before reading anything.
    const service = createCeremonyDoneService({ access: t.f.service });
    const request = { url: `${ORIGIN}/students`, headers: new Headers({ cookie: t.f.identities.multi.cookie, origin: ORIGIN }), method: "POST" };
    for (const mode of ["tutor", "parent", "student"] as const)
      await expect(service.set(request, { mode, studentId: t.sibling.id, expectedRevision: await t.revisionOf(t.sibling.id) })).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a tutor assignment while it is set, and a reversal restores no tutor: tutors are assigned again by hand", async () => {
    const t = await setup();
    expect((await t.setDone("admin", t.own.id)).status).toBe(200);
    expect((await t.setDone("admin", t.own.id)).status).toBe(409);
    const assign = () => t.call(`/api/admin/students/${t.own.id}/relationships/tutors`, "admin", { tutorGrantId: t.f.tutorGrant.id, expectedState: "unassigned" });
    expect((await assign()).status).toBe(409);
    expect(await t.liveTutorRows(t.own.id)).toBe(0);

    const reversed = await t.reverse("admin", t.own.id);
    expect(reversed.status).toBe(200);
    expect((await t.reverse("admin", t.own.id)).status).toBe(409);
    expect(await t.liveTutorRows(t.own.id)).toBe(0);
    expect((await t.call(`/api/admin/students/${t.own.id}/relationships`, "admin")).json.tutors).toEqual([]);
    expect((await reach(t)).tutor).toEqual({ list: [], student: 404, reading: 404, finished: 404 });
    // Back in the active lists, without a tutor.
    expect(await t.list("admin", "admin")).toEqual(["own", "sibling", "unrelated"]);
    expect(await t.sheet()).toContain("Synthetic Sibling A");
    expect((await t.audits()).filter(a => a.action.startsWith("ceremony-done.")).map(a => a.action)).toEqual(["ceremony-done.set", "ceremony-done.reverse"]);
    // Assigned again by hand, the tutor reads the student again.
    expect((await assign()).status).toBe(201);
    expect((await reach(t)).tutor).toMatchObject({ list: ["own"], student: 200 });
  });

  it("leaves Disable as it was, for a ceremony-done student too", async () => {
    const t = await setup();
    expect((await t.setDone("admin", t.own.id)).status).toBe(200);
    expect((await t.call(`/api/admin/students/${t.own.id}/disable`, "admin", { expectedRevision: await t.revisionOf(t.own.id) })).status).toBe(200);
    expect((await t.reverse("admin", t.own.id)).status).toBe(404);
  });
});

describe("Ceremony done over the portal MCP", () => {
  it("takes the student out of the tutor's and the admin's list_students and get_student", async () => {
    const t = await mcpFixture();
    const [own] = t.f.students;
    await t.google("multi"); await t.google("admin");
    const tutor = await t.connect("multi", { scope: "portal:read" }), admin = await t.connect("admin");
    const listed = async (token: string) => (await t.call(token, "list_students")).json().students.map((x: { name: string }) => x.name).sort();
    expect(await listed(tutor.access_token)).toEqual(["Synthetic Sibling A"]);
    expect((await t.call(tutor.access_token, "get_student", { studentId: own.id })).isError).toBe(false);
    const service = createCeremonyDoneService({ access: t.f.service });
    const [row] = await t.f.owner(() => t.f.db.select({ revision: s.student.revision }).from(s.student).where(eq(s.student.id, own.id)));
    expect(await service.set({ ...t.f.request("admin", MCP_ORIGIN, { origin: MCP_ORIGIN }), method: "POST" }, { mode: "admin", studentId: own.id, expectedRevision: row.revision })).toMatchObject({ ok: true });
    expect(await listed(tutor.access_token)).toEqual([]);
    expect((await t.call(tutor.access_token, "get_student", { studentId: own.id })).isError).toBe(true);
    expect(await listed(admin.access_token)).toEqual(["Synthetic Sibling B", "Synthetic Unrelated"]);
  });
});
