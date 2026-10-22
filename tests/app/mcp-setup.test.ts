import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, inArray } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { parseRelatedMetadata } from "../../src/server/study/sources/metadata";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";

afterEach(async () => { vi.restoreAllMocks(); await closeMcpFixtures(); });

// Student setup through the portal MCP (Daniel, 2026-10-21: "Add setup + sources"). Synthetic students and sources only.
const SETUP = ["list_tutors", "get_student_setup", "find_sources", "assign_sources", "remove_source_assignment", "preview_student_reading", "set_student_reading", "set_student_tutor", "set_student_service"];
const ALL = "portal:read portal:study portal:roster";
const raw = (ref: string) => Array.from({ length: 40 }, (_, i) => ({ _id: `source_${String(i).padStart(2, "0")}`, sourceRef: `Invented Work ${i} on ${ref}`, index_title: `Invented Work ${i}`, category: "Commentary", anchorRef: ref }));

async function setup() {
  const related = vi.fn(async (ref: string) => parseRelatedMetadata(raw(ref), ref));
  const t = await mcpFixture(true, undefined, { related });
  await t.google("admin");
  const admin = (await t.connect("admin", { scope: ALL })).access_token as string;
  const texts: string[] = [];
  const call = async (name: string, args: Record<string, unknown>, token = admin) => { const r = await t.call(token, name, args); texts.push(r.text); return r; };
  const json = async (name: string, args: Record<string, unknown>, token = admin) => (await call(name, args, token)).json();
  const owner = <T>(action: () => Promise<T>) => t.f.owner(action);
  const audits = (actions: string[]) => owner(() => t.f.db.select().from(s.auditEvent).where(and(inArray(s.auditEvent.action, actions), eq(s.auditEvent.actorMembershipId, t.f.adminMember.id))));
  const student = (id: string) => owner(async () => (await t.f.db.select().from(s.student).where(eq(s.student.id, id)))[0]);
  const [crc, , unrelated, other] = t.f.students;
  return { t, admin, texts, call, json, owner, audits, student, related, crc, unrelated, other };
}
/** A confirmed custom Torah reading, as the portal's reading editor leaves one. */
async function confirmedTorah(f: Awaited<ReturnType<typeof setup>>, studentId: string, verses = 6) {
  return f.owner(async () => {
    const [a] = await f.t.f.db.insert(s.assignment).values({ tenantId: "crc", studentId, kind: "torah", basis: "custom", ref: `Genesis 1:1-${verses}`, status: "confirmed", setByMembershipId: f.t.f.adminMember.id }).returning();
    await f.t.f.db.insert(s.assignmentVerse).values(Array.from({ length: verses }, (_, i) => ({ tenantId: "crc", studentId, assignmentId: a.id, ordinal: i + 1, verseRef: `Genesis 1:${i + 1}` })));
    return a;
  });
}

describe("student setup through the portal MCP", () => {
  it("treats a disabled student as not found for every setup tool, writing nothing", async () => {
    const f = await setup();
    const { call, crc, owner, audits, t } = f;
    const a = await confirmedTorah(f, crc.id);
    await owner(async () => { await t.f.db.update(s.student).set({ disabledAt: new Date() }).where(eq(s.student.id, crc.id)); });
    const at = { studentId: crc.id, kind: "torah", assignmentId: a.id, assignmentRevision: 1, verseRef: "Genesis 1:1" };
    const calls: [string, Record<string, unknown>][] = [
      ["get_student_setup", { studentId: crc.id }],
      ["find_sources", at],
      ["assign_sources", { ...at, expectedVersion: 0, sourceIds: ["source_01"], catalogHash: "0".repeat(64), mutationId: randomUUID() }],
      ["remove_source_assignment", { ...at, expectedVersion: 0, sourceIds: ["source_01"], mutationId: randomUUID() }],
      ["preview_student_reading", { studentId: crc.id, kind: "torah", expectedReadingRevision: 1, ranges: ["Genesis 1:1-2"] }],
      ["set_student_reading", { studentId: crc.id, kind: "torah", expectedReadingRevision: 1, ranges: ["Genesis 1:1-2"] }],
      ["set_student_tutor", { studentId: crc.id, expectedTutorIds: [t.f.tutorGrant.id], tutorIds: [] }],
      ["set_student_tutor", { studentId: crc.id, expectedTutorIds: [], tutorIds: [] }],
      ["set_student_service", { studentId: crc.id, expectedRevision: 2, serviceSlot: "morning" }],
    ];
    for (const [name, args] of calls) expect((await call(name, args)).text, name).toMatch(/Not found/);
    expect(await audits(["student.update", "reading.set", "tutor.assign", "tutor.revoke", "source-assignment.set"])).toHaveLength(0);
  });


  it("exists only for an attended admin with the roster consent: study, read-only, tutor and routine connections see and reach none of it", async () => {
    const { t, admin } = await setup();
    const names = async (token: string) => (await t.rpc(token, "tools/list")).body.result.tools.map((x: { name: string }) => x.name);
    expect(await names(admin)).toEqual(expect.arrayContaining(SETUP));
    const study = (await t.connect("admin", { scope: "portal:read portal:study" })).access_token;
    const readOnly = (await t.connect("admin", { scope: "portal:read" })).access_token;
    const routine = await t.connect("admin", { unattended: true, scope: ALL });
    expect(routine.scope).toBe("portal:read portal:study");
    await t.google("multi");
    const tutor = await t.connect("multi", { scope: ALL });
    expect(tutor.scope).toBe("portal:read");
    // Tutors get nothing new in Claude.
    expect(await names(tutor.access_token)).toEqual(["list_students", "get_student"]);
    for (const token of [study, readOnly, routine.access_token, tutor.access_token]) for (const name of SETUP) {
      expect(await names(token)).not.toContain(name);
      expect((await t.rpc(token, "tools/call", { name, arguments: { studentId: t.f.students[0].id } })).body.error.code).toBe(-32602);
    }
    // Writes are honest about what they replace; reads are read-only.
    const listed = (await t.rpc(admin, "tools/list")).body.result.tools as { name: string; annotations: Record<string, boolean> }[];
    const hint = (name: string) => listed.find(x => x.name === name)!.annotations;
    for (const name of ["list_tutors", "get_student_setup", "find_sources", "preview_student_reading"]) expect(hint(name)).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const name of ["remove_source_assignment", "set_student_reading", "set_student_tutor", "set_student_service"]) expect(hint(name)).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(hint("assign_sources")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  });

  it("reads the setup and the tutor list with names, ids and contact presence only, and refuses another congregation's student", async () => {
    const { json, call, texts, crc, other, t } = await setup();
    const tutors = await json("list_tutors", {});
    expect(tutors.tutors).toEqual([{ tutorId: t.f.tutorGrant.id, name: expect.any(String) }]);
    expect(Object.keys(tutors.tutors[0]).sort()).toEqual(["name", "tutorId"]);
    const view = await json("get_student_setup", { studentId: crc.id });
    expect(view).toMatchObject({ id: crc.id, name: "Synthetic Sibling A", ceremonyDate: "2027-01-02", serviceSlot: "unknown", revision: 1, rehearsal1: null, rehearsal2: null,
      tutors: [{ tutorId: t.f.tutorGrant.id }], contacts: { parentEmailOnFile: true, ownEmailOnFile: false, secondParentEmailOnFile: false },
      readings: { torah: { readingRevision: 0, confirmed: false }, haftarah: { readingRevision: 0, confirmed: false } } });
    const foreign = await call("get_student_setup", { studentId: other.id });
    expect(foreign.isError).toBe(true);
    expect(foreign.text).toMatch(/Not found/);
    // No address ever leaves: no result was withheld for one, and none carries one.
    for (const text of texts) { expect(text).not.toMatch(/@/); expect(text).not.toMatch(/withheld/); }
  });

  it("sets the service slot and rehearsals through the portal's student edit, refusing a stale revision, unfit dates and another congregation", async () => {
    const { json, call, crc, other, student, audits } = await setup();
    expect(await json("set_student_service", { studentId: crc.id, expectedRevision: 1, serviceSlot: "morning", rehearsal1: "2026-12-20", rehearsal2: "2026-12-27" }))
      .toMatchObject({ ok: true, revision: 2, serviceSlot: "morning", rehearsal1: "2026-12-20", rehearsal2: "2026-12-27", readingsSentToReview: true });
    expect(await student(crc.id)).toMatchObject({ serviceSlot: "morning", rehearsal1: "2026-12-20", rehearsal2: "2026-12-27", revision: 2, parentEmail: crc.parentEmail, firstName: "Synthetic" });
    expect(await audits(["student.update"])).toHaveLength(1);
    expect(await json("set_student_service", { studentId: crc.id, expectedRevision: 1, rehearsal2: null })).toMatchObject({ ok: false, code: "conflict", currentRevision: 2 });
    expect(await json("set_student_service", { studentId: crc.id, expectedRevision: 2, rehearsal1: "2027-02-01" })).toMatchObject({ ok: false, code: "rehearsals-do-not-fit" });
    expect(await json("set_student_service", { studentId: crc.id, expectedRevision: 2, serviceSlot: "morning" })).toMatchObject({ ok: false, code: "no-change" });
    expect(await json("set_student_service", { studentId: crc.id, expectedRevision: 2, rehearsal2: null })).toMatchObject({ ok: true, revision: 3, rehearsal1: "2026-12-20", rehearsal2: null, readingsSentToReview: false });
    expect((await call("set_student_service", { studentId: other.id, expectedRevision: 1, serviceSlot: "morning" })).text).toMatch(/Not found/);
    expect(await student(other.id)).toMatchObject({ serviceSlot: "unknown", revision: 1 });
    expect(await audits(["student.update"])).toHaveLength(2);
  });

  it("sets a student's tutors through the portal's tutor writes, atomically, with a conflict on a stale list and no foreign tutor", async () => {
    const { t, json, call, owner, audits, unrelated } = await setup();
    const links = () => owner(() => t.f.db.select().from(s.tutorStudent).where(eq(s.tutorStudent.studentId, unrelated.id)));
    const tutor = t.f.tutorGrant.id;
    expect(await json("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [], tutorIds: [tutor] })).toMatchObject({ ok: true, added: [tutor], removed: [], tutors: [{ tutorId: tutor }], invitationsSent: 0 });
    expect((await links()).filter(l => !l.revokedAt)).toHaveLength(1);
    expect(await audits(["tutor.assign"])).toHaveLength(1);
    // Re-sending the same change: the list is now the new one, so it is a conflict and nothing more is written.
    expect(await json("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [], tutorIds: [tutor] })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [tutor], tutorIds: [tutor] })).toMatchObject({ ok: true, unchanged: true });
    // Another congregation's tutor grant is not found, and the whole change is rolled back.
    const foreign = await owner(async () => {
      const [member] = await t.f.db.select().from(s.membership).where(eq(s.membership.tenantId, "other"));
      return (await t.f.db.insert(s.roleGrant).values({ tenantId: "other", membershipId: member.id, role: "tutor" }).returning())[0];
    });
    expect((await call("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [tutor], tutorIds: [foreign.id] })).text).toMatch(/Not found/);
    expect((await links()).filter(l => !l.revokedAt).map(l => l.tutorGrantId)).toEqual([tutor]);
    expect((await call("set_student_tutor", { studentId: t.f.students[3].id, expectedTutorIds: [], tutorIds: [tutor] })).text).toMatch(/Not found/);
    expect(await json("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [tutor], tutorIds: [] })).toMatchObject({ ok: true, removed: [tutor], tutors: [] });
    expect((await links()).filter(l => !l.revokedAt)).toHaveLength(0);
    expect(await audits(["tutor.revoke"])).toHaveLength(1);
    // Only a tutor grant can be assigned: the rabbi's own admin grant is not found.
    expect((await call("set_student_tutor", { studentId: unrelated.id, expectedTutorIds: [], tutorIds: [t.f.adminGrant.id] })).text).toMatch(/Not found/);
    expect(await audits(["tutor.assign"])).toHaveLength(1);
  });

  it("previews and sets readings through the portal's reading work: calendar picks, custom ranges and cut points, with conflicts on a stale revision", async () => {
    const { json, call, unrelated, other, owner, audits, t } = await setup();
    const reading = (kind: "torah" | "haftarah") => owner(async () => (await t.f.db.select().from(s.assignment).where(and(eq(s.assignment.studentId, unrelated.id), eq(s.assignment.kind, kind))))[0]);
    // An unknown slot leaves no calendar date to pick from.
    expect(await json("preview_student_reading", { studentId: unrelated.id, kind: "torah", expectedReadingRevision: 0, pick: "aliyah:1" })).toMatchObject({ ok: false, code: "needs-selection" });
    expect(await json("set_student_service", { studentId: unrelated.id, expectedRevision: 1, serviceSlot: "morning" })).toMatchObject({ ok: true });
    const pick = { studentId: unrelated.id, kind: "torah", expectedReadingRevision: 0, pick: "aliyah:1-2" };
    expect(await json("preview_student_reading", pick)).toMatchObject({ ok: true, wouldSet: { kind: "torah", basis: "selection", ranges: ["Genesis 1:1-6"], verseCount: 6, aliyahStarts: null, readingDate: "2027-01-02" } });
    expect(await reading("torah")).toBeUndefined();
    const set = await json("set_student_reading", pick);
    expect(set).toMatchObject({ ok: true, readingRevision: 1, set: { ranges: ["Genesis 1:1-6"] } });
    expect(await reading("torah")).toMatchObject({ id: set.assignmentId, status: "confirmed", ref: "Genesis 1:1-6", basis: "selection", revision: 1, setByMembershipId: t.f.adminMember.id });
    expect(await audits(["reading.set"])).toHaveLength(1);
    expect(await json("set_student_reading", pick)).toMatchObject({ ok: false, code: "conflict" });
    // New aliyah cut points on the confirmed verses only.
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "torah", expectedReadingRevision: 1, keepVerses: true, aliyahStarts: ["Genesis 1:4"] })).toMatchObject({ ok: true, readingRevision: 2 });
    expect(await reading("torah")).toMatchObject({ ref: "Genesis 1:1-6", aliyahStarts: ["Genesis 1:4"], revision: 2 });
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "torah", expectedReadingRevision: 2, keepVerses: true, aliyahStarts: ["Genesis 1:1"] })).toMatchObject({ ok: false, code: "invalid-reading" });
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "haftarah", expectedReadingRevision: 0, ranges: ["Isaiah 1:1-2"] })).toMatchObject({ ok: true, readingRevision: 1, set: { basis: "custom", ranges: ["Isaiah 1:1-2"], verseCount: 2 } });
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "haftarah", expectedReadingRevision: 1, ranges: ["Isaiah 99:1"] })).toMatchObject({ ok: false, code: "invalid-input" });
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "haftarah", expectedReadingRevision: 1, pick: "aliyah:1" })).toMatchObject({ ok: false, code: "invalid-input" });
    expect(await json("set_student_reading", { studentId: unrelated.id, kind: "torah", expectedReadingRevision: 2, pick: "full", ranges: ["Genesis 1:1"] })).toMatchObject({ ok: false, code: "invalid-input" });
    expect((await call("set_student_reading", { studentId: other.id, kind: "torah", expectedReadingRevision: 0, ranges: ["Genesis 1:1"] })).text).toMatch(/Not found/);
    expect(await audits(["reading.set"])).toHaveLength(3);
    const view = await json("get_student_setup", { studentId: unrelated.id });
    expect(view.readings.torah).toMatchObject({ confirmed: true, readingRevision: 2, ranges: ["Genesis 1:1-6"], aliyahStarts: ["Genesis 1:4"] });
    expect(view.readings.haftarah).toMatchObject({ confirmed: true, readingRevision: 1, ranges: ["Isaiah 1:1-2"] });
  });

  it("finds, assigns and removes verse sources through the portal's source replace, with replay, conflicts and stale readings refused", async () => {
    const f = await setup();
    const { json, call, crc, other, owner, audits, related, t } = f;
    const a = await confirmedTorah(f, crc.id);
    const at = { studentId: crc.id, kind: "torah", assignmentId: a.id, assignmentRevision: 1, verseRef: "Genesis 1:1" };
    const found = await json("find_sources", { ...at, query: "work 3" });
    expect(found).toMatchObject({ ok: true, totalSources: 40, matched: 13, current: { version: 0, sources: [] } });
    expect(found.sources[0]).toMatchObject({ id: "source_03", work: "Invented Work 3", assigned: false });
    const write = { ...at, expectedVersion: 0, sourceIds: ["source_31", "source_03"], catalogHash: found.catalogHash, mutationId: randomUUID() };
    expect(await json("assign_sources", write)).toMatchObject({ ok: true, replayed: false, version: 1, sources: [{ id: "source_03" }, { id: "source_31" }] });
    const rows = () => owner(() => t.f.db.select().from(s.verseSourceAssignment).where(eq(s.verseSourceAssignment.studentId, crc.id)));
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ role: "admin", mode: "admin", actorMembershipId: t.f.adminMember.id, roleGrantId: t.f.adminGrant.id, version: 1 });
    // Resending the same write replays it; a stale version with a new mutation is a conflict.
    expect(await json("assign_sources", write)).toMatchObject({ ok: true, replayed: true, version: 1 });
    expect(await json("assign_sources", { ...write, sourceIds: ["source_05"], mutationId: randomUUID() })).toMatchObject({ ok: false, code: "conflict" });
    expect(await json("assign_sources", { ...write, expectedVersion: 1, sourceIds: ["source_03"], mutationId: randomUUID() })).toMatchObject({ ok: false, code: "no-change" });
    expect(await json("assign_sources", { ...write, expectedVersion: 1, sourceIds: ["source_05"], mutationId: randomUUID() })).toMatchObject({ ok: true, version: 2, sources: [{ id: "source_03" }, { id: "source_05" }, { id: "source_31" }] });
    expect(await json("assign_sources", { ...write, expectedVersion: 2, sourceIds: ["not_listed"], mutationId: randomUUID() })).toMatchObject({ ok: false, code: "invalid-request" });
    expect(await json("assign_sources", { ...write, expectedVersion: 2, sourceIds: ["source_07"], catalogHash: "0".repeat(64), mutationId: randomUUID() })).toMatchObject({ ok: false, code: "source-catalog-changed" });
    expect(await json("remove_source_assignment", { ...at, expectedVersion: 2, sourceIds: ["source_03"], mutationId: randomUUID() })).toMatchObject({ ok: true, version: 3, sources: [{ id: "source_05" }, { id: "source_31" }] });
    expect(await json("remove_source_assignment", { ...at, expectedVersion: 3, sourceIds: ["source_03"], mutationId: randomUUID() })).toMatchObject({ ok: false, code: "no-change" });
    expect(await audits(["source-assignment.set"])).toHaveLength(3);
    const view = await json("get_student_setup", { studentId: crc.id });
    expect(view.readings.torah.sources).toEqual([{ verseRef: "Genesis 1:1", version: 3, sources: [expect.objectContaining({ id: "source_05" }), expect.objectContaining({ id: "source_31" })] }]);
    // A stale reading revision, a verse outside the reading, and another congregation's student are refused.
    expect(await json("find_sources", { ...at, assignmentRevision: 2 })).toMatchObject({ ok: false, code: "stale-revision" });
    expect(await json("assign_sources", { ...write, assignmentRevision: 2, expectedVersion: 3, mutationId: randomUUID() })).toMatchObject({ ok: false, code: "stale-revision" });
    expect((await call("find_sources", { ...at, verseRef: "Genesis 2:1" })).text).toMatch(/Not found/);
    expect((await call("find_sources", { ...at, studentId: other.id })).text).toMatch(/Not found/);
    expect((await call("assign_sources", { ...write, studentId: other.id, mutationId: randomUUID() })).text).toMatch(/Not found/);
    expect(await audits(["source-assignment.set"])).toHaveLength(3);
    // A version the verse has not reached is a conflict, so the merge can never drop another write's sources.
    expect(await json("assign_sources", { ...write, expectedVersion: 9, sourceIds: ["source_07"], mutationId: randomUUID() })).toMatchObject({ ok: false, code: "conflict" });
    expect(related).toHaveBeenCalled();
  });
});
