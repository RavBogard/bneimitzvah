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
import { familyLine, isSunday, needsYouRows, savedSections, statusChips, stillWorkingLine, teachesLine, verseList, waitingForDivisions, waitingLine, type StudentStatus } from "../../src/components/portal/workspace/staff/model";
import { parseFamily, parseStatuses } from "../../src/components/portal/workspace/staff/api";
import { explorationPrepared } from "./exploration-client-helper";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const today = new Date(2026, 9, 26);

describe("Needs you and the roster chips (N14)", () => {
  const student = (n: number, ceremonyDate: string, extra: Partial<{ serviceSlot: "morning" | "unknown"; disabledAt: string | null; ceremonyDoneAt: string | null }> = {}) =>
    ({ id: id(n), firstName: `Synthetic${n}`, lastName: "Student", ceremonyDate, serviceSlot: "morning" as const, disabledAt: null, ceremonyDoneAt: null, ...extra });
  const ready: Omit<StudentStatus, "id"> = { tutors: 1, family: "joined", reading: "confirmed", honors: true };
  it("lists each missing step within eight weeks with one verb, soonest first, and never a disabled or ceremony-done student", () => {
    const students = [student(1, "2026-12-07"), student(2, "2026-11-07", { serviceSlot: "unknown" }), student(3, "2027-03-06"), student(4, "2026-11-14", { disabledAt: "2026-10-01T00:00:00Z" }), student(5, "2026-11-14", { ceremonyDoneAt: "2026-10-01T00:00:00Z" })];
    const statuses = new Map<string, StudentStatus>([
      [id(1), { id: id(1), ...ready, tutors: 0 }], [id(2), { id: id(2), ...ready, family: "expired", reading: "review", honors: false }],
      [id(3), { id: id(3), ...ready, tutors: 0 }], [id(4), { id: id(4), ...ready, tutors: 0 }], [id(5), { id: id(5), ...ready, tutors: 0 }]]);
    const rows = needsYouRows(students, statuses, today).map(row => [row.student.id, row.condition]);
    expect(rows).toEqual([[id(2), "invitation-expired"], [id(2), "reading-review"], [id(2), "no-service"], [id(2), "honors"], [id(1), "no-tutor"]]);
    const markup = parseFragment(renderToStaticMarkup(createElement(NeedsYou, { rows: needsYouRows(students, statuses, today), disabled: false, onEdit() {}, onHonors() {} })));
    const items = nodes(markup).filter(node => attr(node, "data-condition"));
    expect(items).toHaveLength(5);
    // One verb per row: exactly one link or button.
    for (const item of items) expect(nodes(item).filter(node => "tagName" in node && (node.tagName === "a" || node.tagName === "button"))).toHaveLength(1);
    const tutor = items.find(item => attr(item, "data-condition") === "no-tutor")!;
    expect(nodes(tutor).find(node => "tagName" in node && node.tagName === "a") && attr(nodes(tutor).find(node => "tagName" in node && node.tagName === "a")!, "href")).toBe(`/workspace/admin/students/${id(1)}/access`);
    // The one deliberate wording check for these rows (approved 2026-10-26).
    expect(items.map(item => text(item).replace(/^.*?(days|Tomorrow|Today)/, "").trim())).toEqual(["The family's invitation expired. Send a new one.", "Reading needs review Confirm reading is still right",
      "No service date yet. Set the service.", "Honors not started. Open the honors form.", "No tutor yet. Choose a tutor."]);
    expect(statusChips(students[1], statuses.get(id(2)))).toEqual(["Reading needs review", "No service date yet"]);
    expect(statusChips(students[0], { id: id(1), ...ready, family: "expiring", reading: "none", tutors: 0 })).toEqual(["No tutor yet", "Expires tomorrow", "No reading yet"]);
    expect(statusChips(students[3], statuses.get(id(4)))).toEqual([]);
  });
  it("asks for a parent invitation when a child's family has none, or when the invitations service names the student", () => {
    const students = [student(1, "2026-11-21"), student(2, "2026-11-21")];
    const statuses = new Map<string, StudentStatus>([[id(1), { id: id(1), ...ready, family: "none" }], [id(2), { id: id(2), ...ready, family: "invited" }]]);
    expect(needsYouRows(students, statuses, today).map(row => row.condition)).toEqual(["needs-invitation"]);
    expect(needsYouRows(students, statuses, today, new Set([id(2)])).map(row => row.condition)).toEqual(["needs-invitation", "needs-invitation"]);
  });
  it("flags a Sunday ceremony only", () => { expect(isSunday("2026-11-08")).toBe(true); expect(isSunday("2026-11-07")).toBe(false); expect(isSunday("")).toBe(false); });
  it("refuses a status page with unknown keys or states", () => {
    const row = { id: id(1), tutors: 0, family: "none", reading: "none", honors: false };
    expect(parseStatuses({ students: [row] })).toHaveLength(1);
    for (const bad of [{ ...row, email: "x@example.test" }, { ...row, family: "maybe" }, { ...row, tutors: -1 }]) expect(() => parseStatuses({ students: [bad] })).toThrow();
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
    // The picker is named by the verse count ("Verse 1 of 5"): no new words.
    expect(text(nodes(root).find(node => attr(node, "id") === attr(picker, "aria-labelledby"))!)).toBe("Verse 1 of 5");
  });
});

describe("Tutor lines and honors row (N13, N15)", () => {
  it("words the tutor's lines from approved strings with no address", () => {
    expect(familyLine({ joined: ["Dana Levin"], invited: false })).toEqual(["Family: Dana Levin (joined)"]);
    expect(familyLine({ joined: [], invited: true })).toEqual(["Family: invitation sent, not yet accepted"]);
    expect(familyLine({ joined: [], invited: false })).toEqual([]);
    expect(() => parseFamily({ kind: "child", joined: ["dana@example.test"], invited: false })).toThrow();
    expect(() => parseFamily({ kind: "child", joined: [], invited: false, email: "x" })).toThrow();
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
