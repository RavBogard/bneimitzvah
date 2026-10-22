import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { accessFixture } from "./access-fixture";
import { portalRoutesFixture } from "./portal-routes-fixture";
import { createStudentService } from "../../src/server/students/service";
import { rehearsalsFit, studentInput } from "../../src/server/students/validation";
import { AccessDenied } from "../../src/server/access/errors";
import { parseStudents } from "../../src/components/portal/workspace/api";
import { PortalRequestError } from "../../src/components/portal/api";
import { RehearsalDates } from "../../src/components/portal/workspace/reading";
import * as s from "../../src/server/db/index";

const open: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(f => f.client.close())); });
const base = { firstName: "Synthetic", lastName: "Rehearsal", ceremonyDate: "2027-01-30", serviceSlot: "morning", parentEmail: "contact@example.test" };
// [rehearsal1, rehearsal2, ceremony, allowed]
const corpus: [string | null, string | null, string, boolean][] = [
  [null, null, "2027-01-30", true], ["2027-01-09", "2027-01-23", "2027-01-30", true], ["2027-01-09", null, "2027-01-30", true], [null, "2027-01-23", "2027-01-30", true],
  ["2027-01-30", "2027-01-30", "2027-01-30", true], ["2027-01-23", "2027-01-23", "2027-01-30", true], ["2026-12-31", "2027-01-01", "2027-01-30", true],
  ["2027-01-23", "2027-01-09", "2027-01-30", false], ["2027-01-31", null, "2027-01-30", false], [null, "2027-01-31", "2027-01-30", false],
  ["2027-01-09", "2027-02-06", "2027-01-30", false], ["2028-01-09", "2028-01-23", "2027-01-30", false],
];
async function denied(action: () => Promise<unknown>, status = 403) { try { await action(); return false; } catch (error) { return error instanceof AccessDenied && error.status === status; } }
async function sqlCode(action: () => Promise<unknown>) { try { await action(); return ""; } catch (error) { return String((error as { code?: string }).code); } }

test("0029 adds only the two nullable rehearsal dates and their order check, leaves existing students unchanged and replays", async () => {
  const isolation = await isolatedEnv(), client = new PGlite();
  try {
    const folder = "src/server/db/migrations", journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8"));
    expect(journal.entries.find((e: { tag: string }) => e.tag === "0029_rehearsal_dates")).toMatchObject({ idx: 29 });
    const entries = journal.entries.filter((e: { idx: number }) => e.idx < 29), prior = join(isolation.home, "prior");
    await mkdir(join(prior, "meta"), { recursive: true }); await writeFile(join(prior, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const e of entries) await copyFile(join(folder, e.tag + ".sql"), join(prior, e.tag + ".sql"));
    const db = drizzle(client); await migrate(db, { migrationsFolder: prior });
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Existing','2027-01-02','existing@example.test')", [randomUUID()]);
    const before = (await client.query("select * from student")).rows;
    await migrate(db, { migrationsFolder: folder }); await migrate(db, { migrationsFolder: folder });
    expect((await client.query("select * from student")).rows).toEqual(before.map(row => ({ ...(row as Record<string, unknown>), rehearsal_1: null, rehearsal_2: null })));
    const previous = JSON.parse(await readFile(join(folder, "meta/0028_snapshot.json"), "utf8")), current = JSON.parse(await readFile(join(folder, "meta/0029_snapshot.json"), "utf8"));
    const expected = structuredClone(previous.tables), student = current.tables["public.student"];
    expected["public.student"].columns.rehearsal_1 = student.columns.rehearsal_1; expected["public.student"].columns.rehearsal_2 = student.columns.rehearsal_2;
    expected["public.student"].checkConstraints.student_rehearsals_ordered = student.checkConstraints.student_rehearsals_ordered;
    expect(current.prevId).toBe(previous.id); expect(current.tables).toEqual(expected);
    for (const column of ["rehearsal_1", "rehearsal_2"]) expect(student.columns[column]).toMatchObject({ type: "date", notNull: false });
    expect(student.columns.rehearsal_1.default).toBeUndefined();
  } finally { await client.close(); await isolation.cleanup(); }
});

test("the SQL check and the TypeScript validator accept and refuse the same rehearsal dates", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const id = randomUUID();
    await client.query("insert into student(id,tenant_id,first_name,last_name,ceremony_date,parent_email) values($1,'crc','Synthetic','Check','2027-01-30','check@example.test')", [id]);
    for (const [rehearsal1, rehearsal2, ceremony, allowed] of corpus) {
      await client.query("update student set rehearsal_1=null,rehearsal_2=null,ceremony_date='2027-01-30' where id=$1", [id]);
      const code = await sqlCode(() => client.query("update student set ceremony_date=$2,rehearsal_1=$3,rehearsal_2=$4 where id=$1", [id, ceremony, rehearsal1, rehearsal2]));
      expect([rehearsal1, rehearsal2, ceremony, code]).toEqual([rehearsal1, rehearsal2, ceremony, allowed ? "" : "23514"]);
      expect(rehearsalsFit(ceremony, rehearsal1, rehearsal2)).toBe(allowed);
      const typed = (() => { try { return studentInput({ ...base, ceremonyDate: ceremony, rehearsal1, rehearsal2 }); } catch (error) { return error; } })();
      if (allowed) expect(typed).toMatchObject({ ceremonyDate: ceremony, rehearsal1, rehearsal2 }); else expect(typed).toBeInstanceOf(AccessDenied);
    }
    // Moving the ceremony before a saved rehearsal is refused by the database too.
    await client.query("update student set rehearsal_1='2027-01-09',rehearsal_2='2027-01-23' where id=$1", [id]);
    expect(await sqlCode(() => client.query("update student set ceremony_date='2027-01-16' where id=$1", [id]))).toBe("23514");
  } finally { await client.close(); }
});

test("the validator keeps omitted dates omitted, clears with null and refuses anything that is not a real calendar date", () => {
  const omitted = studentInput(base);
  expect(Object.hasOwn(omitted, "rehearsal1") || Object.hasOwn(omitted, "rehearsal2")).toBe(false);
  expect(studentInput({ ...base, rehearsal1: null })).toMatchObject({ rehearsal1: null }); expect(Object.hasOwn(studentInput({ ...base, rehearsal1: null }), "rehearsal2")).toBe(false);
  for (const bad of ["", " 2027-01-09", "2027-1-9", "2027-02-30", "2027-01-09T00:00:00Z", "09/01/2027", 20270109, {}, [], true])
    for (const key of ["rehearsal1", "rehearsal2"]) expect(() => studentInput({ ...base, [key]: bad })).toThrow(AccessDenied);
});

async function serviceFixture() {
  const f = await accessFixture(); open.push(f);
  const service = createStudentService({ access: f.service, signingSecret: randomBytes(48).toString("base64url"), loadReading: async () => { throw new Error("not used"); } });
  const request = (who: "admin" | "multi" | "learner" = "admin") => ({ ...f.request(who, "http://localhost:3000", { origin: "http://localhost:3000" }), method: "POST" });
  return { ...f, students: f.students, studentsService: service, mutation: request };
}

test("only admins set or clear rehearsal dates, with revisioned writes and student.update audit; students, parents and tutors read them", async () => {
  const f = await serviceFixture(), target = f.students[0].id, dated = { ...base, rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" };
  const stored = () => f.owner(async () => (await f.db.select({ rehearsal1: s.student.rehearsal1, rehearsal2: s.student.rehearsal2, ceremonyDate: s.student.ceremonyDate, revision: s.student.revision }).from(s.student).where(eq(s.student.id, target)))[0]);
  for (const [who, mode] of [["multi", "tutor"], ["multi", "parent"], ["learner", "student"]] as const) {
    expect(await denied(() => f.studentsService.create(f.mutation(who), { mode, student: dated }))).toBe(true);
    expect(await denied(() => f.studentsService.edit(f.mutation(who), { mode, studentId: target, expectedRevision: 1, student: dated }))).toBe(true);
  }
  expect(await stored()).toEqual({ rehearsal1: null, rehearsal2: null, ceremonyDate: "2027-01-02", revision: 1 });
  const created = await f.studentsService.create(f.mutation(), { mode: "admin", student: dated });
  expect((await f.studentsService.listRoster(f.mutation(), { mode: "admin" })).find(row => row.id === created.id)).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
  expect((await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 1, student: dated })).ok).toBe(true);
  expect(await stored()).toEqual({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23", ceremonyDate: "2027-01-30", revision: 2 });
  const audits = await f.owner(() => f.db.select().from(s.auditEvent).where(and(eq(s.auditEvent.action, "student.update"), eq(s.auditEvent.targetId, target))));
  expect(audits).toHaveLength(1); expect(audits[0]).toMatchObject({ mode: "admin", targetType: "student", actingStudentId: target });
  for (const [who, mode] of [["multi", "parent"], ["multi", "tutor"], ["learner", "student"], ["admin", "admin"]] as const) {
    const view = await f.service.readStudent(f.mutation(who), { mode, studentId: target });
    expect(Object.keys(view).sort()).toEqual(["ceremonyDate", "firstName", "id", "lastName", "rehearsal1", "rehearsal2", "revision"]);
    expect(view).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
    expect((await f.service.listStudents(f.mutation(who), { mode })).find(row => row.id === target)).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
  }
  // A stale revision writes nothing; an omitted date keeps the saved one; an out-of-order pair is refused.
  expect(await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 1, student: { ...dated, rehearsal1: null } })).toEqual({ ok: false, code: "stale-revision" });
  expect((await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 2, student: { ...base, lastName: "Renamed" } })).ok).toBe(true);
  expect(await stored()).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23", revision: 3 });
  expect(await denied(() => f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 3, student: { ...base, rehearsal1: "2027-01-24" } }))).toBe(true);
  // Moving the ceremony before a kept rehearsal is refused before the database is asked.
  expect(await denied(() => f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 3, student: { ...base, ceremonyDate: "2027-01-16" } }))).toBe(true);
  expect(await stored()).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23", ceremonyDate: "2027-01-30", revision: 3 });
  expect((await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 3, student: { ...base, ceremonyDate: "2027-01-16", rehearsal2: null } })).ok).toBe(true);
  expect(await stored()).toEqual({ rehearsal1: "2027-01-09", rehearsal2: null, ceremonyDate: "2027-01-16", revision: 4 });
  expect((await f.studentsService.edit(f.mutation(), { mode: "admin", studentId: target, expectedRevision: 4, student: { ...base, ceremonyDate: "2027-01-16", rehearsal1: null, rehearsal2: null } })).ok).toBe(true);
  expect(await stored()).toEqual({ rehearsal1: null, rehearsal2: null, ceremonyDate: "2027-01-16", revision: 5 });
});

test("the admin HTTP routes carry rehearsal dates in closed contracts, and every role that sees the ceremony date sees them", async () => {
  const f = await portalRoutesFixture(); open.push(f);
  const json = async (response: Response) => await response.json() as Record<string, any>, id = f.students[0].id;
  const student = { firstName: "Synthetic", lastName: "Routed", ceremonyDate: "2027-01-30", parentEmail: "contact@example.test", rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" };
  for (const who of ["multi", "learner"] as const) expect((await f.call(`/api/admin/students/${id}/edit`, { who, body: { expectedRevision: 1, student } })).status).toBe(403);
  for (const bad of [{ ...student, rehearsal1: 20270109 }, { ...student, rehearsal2: "2027-01-230" }, { ...student, rehearsal3: "2027-01-23" }, { ...student, rehearsal1: "" }])
    expect((await f.call(`/api/admin/students/${id}/edit`, { who: "admin", body: { expectedRevision: 1, student: bad } })).status).toBe(400);
  for (const bad of [{ ...student, rehearsal1: "2027-01-24" }, { ...student, rehearsal2: "2027-01-31" }, { ...student, rehearsal1: "2027-02-30" }])
    expect((await f.call(`/api/admin/students/${id}/edit`, { who: "admin", body: { expectedRevision: 1, student: bad } })).status).toBe(403);
  const edit = await f.call(`/api/admin/students/${id}/edit`, { who: "admin", body: { expectedRevision: 1, student } });
  expect(edit.status).toBe(200); expect(await json(edit)).toMatchObject({ ok: true, revision: 2 });
  const roster = await json(await f.call("/api/admin/students", { who: "admin" }));
  expect(roster.students.find((row: { id: string }) => row.id === id)).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
  expect(roster.students.find((row: { id: string }) => row.id !== id)).toMatchObject({ rehearsal1: null, rehearsal2: null });
  expect(parseStudents(roster, true).find(row => row.id === id)).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
  for (const [who, mode] of [["multi", "parent"], ["multi", "tutor"], ["learner", "student"]] as const) {
    const one = await json(await f.call(`/api/students/${id}?mode=${mode}`, { who }));
    expect(Object.keys(one.student).sort()).toEqual(["ceremonyDate", "firstName", "id", "lastName", "rehearsal1", "rehearsal2", "revision"]);
    expect(one.student).toMatchObject({ ceremonyDate: "2027-01-30", rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
    const list = await json(await f.call(`/api/students?mode=${mode}`, { who }));
    expect(parseStudents(list).find(row => row.id === id)).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
    const reading = await json(await f.call(`/api/students/${id}/reading?mode=${mode}`, { who }));
    expect(reading.student).toMatchObject({ rehearsal1: "2027-01-09", rehearsal2: "2027-01-23" });
  }
  // The admin People page keeps its own closed student summary.
  const people = await json(await f.call(`/api/admin/students/${id}/relationships`, { who: "admin" }));
  expect(Object.keys(people.student).sort()).toEqual(["ceremonyDate", "disabled", "firstName", "id", "lastName", "revision"]);
  // Clearing uses null; a student outside the tutor's links stays invisible.
  expect((await f.call(`/api/admin/students/${id}/edit`, { who: "admin", body: { expectedRevision: 2, student: { ...student, rehearsal1: null, rehearsal2: null } } })).status).toBe(200);
  expect((await json(await f.call(`/api/students/${id}?mode=parent`, { who: "multi" }))).student).toMatchObject({ rehearsal1: null, rehearsal2: null });
  expect((await f.call(`/api/students/${f.students[1].id}?mode=tutor`, { who: "multi" })).status).toBe(404);
});

test("the client parser accepts the dates only together, in order and on or before the ceremony, and still reads older responses", () => {
  const row = { id: randomUUID(), firstName: "Synthetic", lastName: "Parsed", ceremonyDate: "2027-01-30", revision: 1 };
  expect(parseStudents({ students: [row] })).toEqual([row]);
  expect(parseStudents({ students: [{ ...row, rehearsal1: "2027-01-09", rehearsal2: null }] })).toEqual([{ ...row, rehearsal1: "2027-01-09", rehearsal2: null }]);
  for (const bad of [{ ...row, rehearsal1: "2027-01-09" }, { ...row, rehearsal2: "2027-01-09" }, { ...row, rehearsal1: "2027-01-23", rehearsal2: "2027-01-09" },
    { ...row, rehearsal1: "2027-01-31", rehearsal2: null }, { ...row, rehearsal1: null, rehearsal2: "2027-02-01" }, { ...row, rehearsal1: "", rehearsal2: null }, { ...row, rehearsal1: "2027-02-30", rehearsal2: null }])
    expect(() => parseStudents({ students: [bad] })).toThrow(PortalRequestError);
});

test("the reading header shows saved rehearsals in the ceremony date's format and nothing when none is set", () => {
  const render = (rehearsal1: string | null | undefined, rehearsal2: string | null | undefined) => renderToStaticMarkup(createElement(RehearsalDates, { student: { rehearsal1, rehearsal2 } }));
  expect(render(undefined, undefined)).toBe(""); expect(render(null, null)).toBe("");
  expect(render("2027-01-09", "2027-01-23")).toBe('<p class="hero-rehearsals">Rehearsals: <span><time dateTime="2027-01-09">Sat, Jan 9, 2027</time></span><span> and <time dateTime="2027-01-23">Sat, Jan 23, 2027</time></span></p>');
  expect(render(null, "2027-01-23")).toBe('<p class="hero-rehearsals">Rehearsal: <span><time dateTime="2027-01-23">Sat, Jan 23, 2027</time></span></p>');
});
