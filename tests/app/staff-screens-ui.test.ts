import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const prefs = vi.hoisted(() => ({ colors: false, translation: false, size: "standard" }));
vi.mock("../../src/components/portal/workspace/reading-prefs", () => ({ useReadingPrefs: () => prefs, useSetReadingPrefs: () => () => {} }));
vi.mock("../../src/components/portal/workspace/provider", async original => ({ ...await original<Record<string, unknown>>(),
  WorkspaceLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { ...rest, href }, children) }));
import { normalizeHebrew } from "../../src/server/study/normalize";
import { LiftedLine } from "../../src/components/portal/workspace/study/lift";
import { ExplorationContent } from "../../src/components/portal/workspace/study/exploration-view";
import { NeedsYou } from "../../src/components/portal/workspace/staff/needs-you";
import { ManageSheet, manageRows } from "../../src/components/portal/workspace/staff/manage-sheet";
import { familyLine, isSunday, linkRequestLine, needsYouRows, nextEventLine, savedSections, statusChips, stillWorkingLine, studentFacts, teachesLine, verseList, waitingForDivisions, waitingLine, type StudentNeed, type StudentStatus } from "../../src/components/portal/workspace/staff/model";
import { parseFamily, parseNeeded, parseStatuses } from "../../src/components/portal/workspace/staff/api";
import { explorationPrepared } from "./exploration-client-helper";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const today = new Date(2026, 9, 26);

describe("Needs you and the roster chips (N14)", () => {
  const student = (n: number, ceremonyDate: string, extra: Partial<{ serviceSlot: "morning" | "unknown"; disabledAt: string | null; ceremonyDoneAt: string | null; rehearsal1: string | null }> = {}) =>
    ({ id: id(n), firstName: `Synthetic${n}`, lastName: "Student", ceremonyDate, serviceSlot: "morning" as const, disabledAt: null, ceremonyDoneAt: null, ...extra });
  const ready: Omit<StudentStatus, "id"> = { tutors: 1, family: "joined", reading: "confirmed", honors: true, tutorName: "Synthetic Tutor", got: 10, total: 10 };
  const links = (item: Node) => nodes(item).filter(node => "tagName" in node && node.tagName === "a");
  it("gives each student one row with everything left to do, never a disabled or ceremony-done student", () => {
    const students = [student(1, "2026-12-07"), student(2, "2026-11-07", { serviceSlot: "unknown" }), student(3, "2027-03-06"), student(4, "2026-11-14", { disabledAt: "2026-10-01T00:00:00Z" }), student(5, "2026-11-14", { ceremonyDoneAt: "2026-10-01T00:00:00Z" })];
    const statuses = new Map<string, StudentStatus>([
      [id(1), { id: id(1), ...ready, tutors: 0, tutorName: null }], [id(2), { id: id(2), ...ready, family: "expired", reading: "review", honors: false }],
      [id(3), { id: id(3), ...ready, tutors: 0 }], [id(4), { id: id(4), ...ready, tutors: 0 }], [id(5), { id: id(5), ...ready, tutors: 0 }]]);
    const rows = needsYouRows(students, statuses, today);
    expect(rows.map(row => [row.student?.id, "conditions" in row ? row.conditions : null])).toEqual([
      [id(2), ["invitation-expired", "reading-review", "no-service", "honors"]], [id(1), ["no-tutor"]]]);
    const markup = parseFragment(renderToStaticMarkup(createElement(NeedsYou, { rows, statuses, disabled: false, onEdit() {}, onHonors() {} })));
    const items = nodes(markup).filter(node => attr(node, "data-student-id"));
    expect(items).toHaveLength(2);
    // The no-tutor condition leads to the student's access page, and each condition has its own verb.
    const tutor = nodes(items[1]).find(node => attr(node, "data-condition") === "no-tutor")!;
    expect(attr(links(tutor)[0], "href")).toBe(`/workspace/admin/students/${id(1)}/access`);
    expect(nodes(items[0]).filter(node => attr(node, "data-condition"))).toHaveLength(4);
    // The one deliberate wording check for these rows.
    expect(nodes(items[0]).filter(node => attr(node, "data-condition")).map(item => text(item))).toEqual(["The family's invitation expired. Send a new one.", "Reading needs review Confirm reading is still right",
      "No service date yet. Set the service.", "Honors not started. Open the honors form."]);
    expect(statusChips(students[1], statuses.get(id(2)))).toEqual(["Reading needs review", "No service date yet"]);
    expect(statusChips(students[0], { id: id(1), ...ready, family: "expiring", reading: "none", tutors: 0 })).toEqual(["Expires tomorrow", "No reading yet"]);
    expect(statusChips(students[3], statuses.get(id(4)))).toEqual([]);
  });
  it("ranks who needs the rabbi first: a near date with no tutor or behind on verses, then the soonest next rehearsal or ceremony", () => {
    // Today is 2026-10-26. Student 1: ceremony in 40 days, no honors. Student 2: rehearsal in 3 days, 2 of 12 verses got. Student 3: ceremony in 10 days, no tutor. Student 4: rehearsal in 2 days, all got, no honors.
    const students = [student(1, "2026-12-05"), student(2, "2026-11-20", { rehearsal1: "2026-10-29" }), student(3, "2026-11-05"), student(4, "2026-11-20", { rehearsal1: "2026-10-28" })];
    const statuses = new Map<string, StudentStatus>([[id(1), { id: id(1), ...ready, honors: false }], [id(2), { id: id(2), ...ready, got: 2, total: 12 }],
      [id(3), { id: id(3), ...ready, tutors: 0, tutorName: null }], [id(4), { id: id(4), ...ready, honors: false }]]);
    const rows = needsYouRows(students, statuses, today);
    expect(rows.map(row => row.student?.id)).toEqual([id(2), id(3), id(4), id(1)]);
    expect((rows[0] as StudentNeed).conditions).toEqual(["behind"]);
    expect((rows[0] as StudentNeed).next).toMatchObject({ kind: "rehearsal", days: 3 });
    // Far from any date, low progress is not behind.
    expect(needsYouRows([student(1, "2026-12-05")], new Map([[id(1), { id: id(1), ...ready, got: 0, total: 12 }]]), today)).toEqual([]);
    expect(nextEventLine({ kind: "rehearsal", date: "", days: 0 })).toBe("Rehearsal today");
    expect(nextEventLine({ kind: "rehearsal", date: "", days: 1 })).toBe("Rehearsal tomorrow");
    expect(nextEventLine({ kind: "ceremony", date: "", days: 5 })).toBe("Beit Mitzvah in 5 days");
  });
  it("shows the roster facts: who teaches, whether a parent joined, and the verses got", () => {
    expect(studentFacts({ id: id(1), ...ready, got: 6, total: 12 })).toEqual(["Tutor: Synthetic Tutor", "Parent: joined", "6 of 12 verses got"]);
    expect(studentFacts({ id: id(1), ...ready, tutors: 0, tutorName: null, family: "invited", total: 0, got: 0 })).toEqual(["No tutor yet", "Parent: not joined yet"]);
    expect(studentFacts({ id: id(1), ...ready, family: null, total: 0, got: 0 })).toEqual(["Tutor: Synthetic Tutor"]);
  });
  it("asks for a parent invitation when a child's family has none, or when the invitations service names the student", () => {
    const students = [student(1, "2026-11-21"), student(2, "2026-11-21")];
    const statuses = new Map<string, StudentStatus>([[id(1), { id: id(1), ...ready, family: "none" }], [id(2), { id: id(2), ...ready, family: "invited" }]]);
    expect(needsYouRows(students, statuses, today).map(row => row.student?.id)).toEqual([id(1)]);
    expect(needsYouRows(students, statuses, today, new Set([id(2)])).map(row => row.student?.id)).toEqual([id(1), id(2)]);
  });
  it("says so when nothing needs the admin, and takes only student ids from the invitations service", () => {
    const empty = renderToStaticMarkup(createElement(NeedsYou, { rows: [], statuses: new Map(), disabled: false, onEdit() {}, onHonors() {} }));
    // E4: the empty line says what was checked.
    expect(empty).toContain("Nothing needs you this week: no readings to review, no link requests, no invitations waiting.");
    const row = { memberId: id(9), name: "Synthetic Parent", email: "synthetic-parent@example.test", student: { id: id(1), firstName: "Synthetic", lastName: "Student" } };
    expect([...parseNeeded({ needed: [row] })]).toEqual([id(1)]);
    expect(() => parseNeeded({ needed: [{ ...row, extra: 1 }] })).toThrow();
    expect(() => parseNeeded({ needed: [{ ...row, student: { ...row.student, id: "x" } }] })).toThrow();
  });
  it("puts link requests waiting first, as one row that opens Account requests, and says nothing for none (Readings for everyone E4)", () => {
    const students = [{ id: id(1), firstName: "Synthetic", lastName: "Student", ceremonyDate: "2026-11-08", serviceSlot: "morning" as const, disabledAt: null }];
    const statuses = new Map<string, StudentStatus>([[id(1), { id: id(1), ...ready, tutors: 0, tutorName: null }]]);
    const rows = needsYouRows(students, statuses, today, new Set(), 3);
    expect(rows.map(row => row.student?.id ?? "link-request")).toEqual(["link-request", id(1)]);
    expect(needsYouRows(students, statuses, today, new Set(), 0).map(row => row.student?.id)).toEqual([id(1)]);
    const markup = parseFragment(renderToStaticMarkup(createElement(NeedsYou, { rows, statuses, disabled: false, onEdit() {}, onHonors() {} })));
    const row = nodes(markup).find(node => attr(node, "data-condition") === "link-request")!, link = links(row)[0];
    expect(text(link)).toBe("3 link requests waiting"); expect(attr(link, "href")).toBe("/workspace/accounts");
    expect(linkRequestLine(1)).toBe("1 link request waiting");
  });
  it("flags a Sunday ceremony only", () => { expect(isSunday("2026-11-08")).toBe(true); expect(isSunday("2026-11-07")).toBe(false); expect(isSunday("")).toBe(false); });
  it("refuses a status page with unknown keys or states", () => {
    const row = { id: id(1), tutors: 0, family: "none", reading: "none", honors: false, tutorName: null, got: 0, total: 0 };
    expect(parseStatuses({ students: [row] })).toHaveLength(1);
    // A tutor name that is not a clean name loses only the name, not the page.
    expect(parseStatuses({ students: [{ ...row, tutorName: "x@example.test" }, { ...row, id: id(2), tutorName: "Synthetic Tutor" }] }).map(value => value.tutorName)).toEqual([null, "Synthetic Tutor"]);
    for (const bad of [{ ...row, email: "x@example.test" }, { ...row, family: "maybe" }, { ...row, tutors: -1 }, { ...row, got: 2, total: 1 }]) expect(() => parseStatuses({ students: [bad] })).toThrow();
  });
});

describe("Admin service line (N14, AD-02)", () => {
  it("never tells the admin that the rabbi needs to choose a service: it offers Edit details for this student", () => {
    const { binding: _b, expiresAt: _e, ranges: _r, portion: _p, pages: _g, verseCount: _c, sourceFetchedAt: _f, ...context } = explorationPrepared();
    const render = (mode: string) => renderToStaticMarkup(createElement(ExplorationContent, { group: "g", retry() {}, page() {}, refresh() {},
      state: { pending: false, result: { ...context, mode, status: "unresolved", serviceSlot: "unknown", readingDate: null, reason: "unknown-slot" } as never } }));
    const admin = render("admin");
    expect(admin).not.toMatch(/Your rabbi needs to/);
    expect(admin).toContain("Choose a service for this student, then the reading can be shown");
    expect(admin).toContain(`href="/workspace/admin/students?tab=students&amp;edit=${context.studentId}"`);
    expect(render("tutor")).toMatch(/Your rabbi needs to/);
  });
});

describe("Practice up close verse picker (N14, G7)", () => {
  it("reaches 23:10 in at most three taps: open the lifted line, open the picker, choose the verse", () => {
    const verses = ["Genesis 23:1", "Genesis 23:2", "Genesis 23:9", "Genesis 23:10", "Genesis 23:11"].map(ref => { const hebrew = normalizeHebrew("אָ֑ב גַּֽד׃"); return { ref, hebrew: { ...hebrew, segments: [...hebrew.segments] }, english: null }; });
    const root = parseFragment(renderToStaticMarkup(createElement(LiftedLine, { verses, assignment: { kind: "torah", confirmed: true, verses: verses.map(v => v.ref) }, index: 0, total: 5, offset: 0, onIndex() {}, onClose() {} })));
    const picker = nodes(root).find(node => attr(node, "data-testid") === "lift-verse-picker")!;
    expect(picker).toBeDefined();
    const options = nodes(picker).filter(node => "tagName" in node && node.tagName === "option");
    expect(options.map(text)).toEqual(verses.map(verse => verse.ref));
    expect(attr(options.find(option => text(option) === "Genesis 23:10")!, "value")).toBe("3");
    expect(attr(picker, "aria-label")).toBe("Choose a verse");
  });
});

describe("Tutor lines and honors row (N13, N15)", () => {
  it("words the tutor's lines from approved strings with no address", () => {
    expect(familyLine({ joined: ["Dana Levin"], invited: false })).toEqual(["Family: Dana Levin (joined)"]);
    expect(familyLine({ joined: [], invited: true })).toEqual(["Family: invitation sent, not yet accepted"]);
    expect(familyLine({ kind: "child", joined: [], invited: false, neverInvited: true })).toEqual(["Family: not invited yet"]);
    expect(familyLine({ kind: "child", joined: [], invited: false, neverInvited: false })).toEqual(["Family: not joined yet"]);
    expect(familyLine({ kind: "adult", joined: [], invited: false, neverInvited: false })).toEqual([]);
    expect(parseFamily({ kind: "child", joined: [], invited: false, neverInvited: true })).toEqual({ kind: "child", joined: [], invited: false, neverInvited: true });
    expect(() => parseFamily({ kind: "child", joined: ["dana@example.test"], invited: false, neverInvited: false })).toThrow();
    expect(() => parseFamily({ kind: "child", joined: [], invited: false, neverInvited: false, email: "x" })).toThrow();
    expect(() => parseFamily({ kind: "adult", joined: [], invited: false, neverInvited: true })).toThrow();
    expect(teachesLine(["Noa", "Eli", "Leah"])).toBe("Teaches 3 students: Noa, Eli, Leah");
    expect(stillWorkingLine("Noa", ["Genesis 23:1", "Genesis 23:10", "Genesis 24:7"])).toBe("Noa is still working on 3 verses: Gen 23:1, 23:10, 24:7");
    expect(verseList(["Genesis 50:26", "Exodus 1:1"])).toBe("Gen 50:26, Exod 1:1");
    expect(waitingLine("Noa")).toBe("Noa's family is waiting for aliyah divisions to name aliyah honorees.");
  });
  it("tells the tutor a child's family waits for divisions only from the reading, never for an adult or a divided reading", () => {
    const torah = (aliyahStarts: string[] | null) => [{ kind: "torah" as const, aliyahStarts }];
    expect(waitingForDivisions("child", torah(null))).toBe(true);
    expect(waitingForDivisions("child", torah(["Genesis 23:3"]))).toBe(false);
    expect(waitingForDivisions("adult", torah(null))).toBe(false);
    expect(waitingForDivisions(undefined, torah(null))).toBe(false);
    expect(waitingForDivisions("child", [{ kind: "haftarah", aliyahStarts: null }])).toBe(false);
  });
  it("counts the saved honors sections", () => {
    const person = (englishName: string | null) => ({ englishName });
    const form = { openingArk: [person("A")], generationToGeneration: [person(" ")], undressingTorah: [person("B")], aliyot: [{ participants: [person("C")] }],
      redressingTorah: [person("D")], closingArk: [person("E")], parentalBlessing: { participation: "no" as const } };
    expect(savedSections(form)).toBe(6);
    expect(savedSections({ ...form, parentalBlessing: { participation: null } })).toBe(5);
  });
});

describe("The Manage sheet (Readings for everyone E3)", () => {
  const student = { id: id(1), firstName: "Synthetic", lastName: "Learner" };
  const reading = (kind: "torah" | "haftarah", needsReview: boolean) => ({ id: id(kind === "torah" ? 2 : 3), kind, revision: 1, ranges: ["Genesis 1:1-3"], verses: [], needsReview, aliyahStarts: null, source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, confirmationDate: null, basis: "custom" });
  const noop = () => {};
  const actions = { open: true, onClose: noop, setDivisions: noop, changeVerses: noop, printPractice: noop, printDisabled: false, printWholeHref: "/print?ref=Genesis%201%3A1-3", writeNote: noop, refresh: noop, reload: async () => undefined };
  const render = (mode: "tutor" | "admin", readings: ReturnType<typeof reading>[]) => renderToStaticMarkup(createElement(ManageSheet, { mode, student, baseline: { student, readings } as never, actions }));
  it("lists the rows in order, with Set divisions unpunctuated, and the admin's two links last", () => {
    expect(manageRows("tutor", [], false)).toEqual(["Set divisions", "Change verses", "Print practice sheet", "Print the whole reading", "Write a lesson note", "Refresh reading"]);
    expect(manageRows("admin", [], false).slice(-2)).toEqual(["People and access", "All students"]);
    expect(manageRows("tutor", ["torah", "haftarah"], true).slice(0, 2)).toEqual(["Confirm reading is still right:Torah", "Confirm reading is still right:Haftarah"]);
    const markup = render("tutor", []);
    const titles = [...markup.matchAll(/<span class="[^"]*rowTitle[^"]*">([^<]*)<\/span>/g)].map(match => match[1]);
    expect(titles).toEqual(manageRows("tutor", [], false));
    expect(markup).toContain(">Manage<");
    expect(markup).not.toContain("People and access");
  });
  it("names each reading that needs review, Torah or Haftarah, only when there are two; a reading that does not need it has no row", () => {
    const both = render("tutor", [reading("torah", true), reading("haftarah", true)]);
    expect(both.match(/Confirm reading is still right/g)).toHaveLength(2);
    expect(both).toContain(">Torah<"); expect(both).toContain(">Haftarah<");
    const one = render("tutor", [reading("torah", true)]);
    expect(one.match(/Confirm reading is still right/g)).toHaveLength(1);
    expect(render("tutor", [reading("torah", false)])).not.toContain("Confirm reading is still right");
  });
  it("gives an admin the links to this student's People and access and to All students", () => {
    const markup = render("admin", []);
    expect(markup).toContain(`href="/workspace/admin/students/${id(1)}/access"`);
    expect(markup).toContain('href="/workspace/admin/students"');
  });
});
