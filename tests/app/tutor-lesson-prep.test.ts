import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/provider", async original => ({ ...await original<Record<string, unknown>>(),
  WorkspaceLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { ...rest, href }, children) }));
import { AliyotList, SinceLastLesson, StaffNextSteps } from "../../src/components/portal/workspace/staff/lesson-prep";
import { aliyahRows, marksSince, practicedSince } from "../../src/components/portal/workspace/staff/lesson-prep-model";
import { lastSevenDays, sevenDayWindow } from "../../src/lib/practice-calendar/seven-days";
import { lastSevenDays as cardDays } from "../../src/components/portal/workspace/today/model";
import type { Reading } from "../../src/components/portal/workspace/api";
import type { ProgressVerse } from "../../src/lib/progress/types";
import type { TutorPractice } from "../../src/lib/practice-visibility/types";

// Project review 2026-11-16 (T1, T2's neighbours, T4/T7, practice dots): the tutor's lesson card, from synthetic data only.
type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const byTestId = (root: Node, id: string) => nodes(root).filter(node => attr(node, "data-testid") === id);
const html = (element: ReturnType<typeof createElement>) => parseFragment(renderToStaticMarkup(element));

const refs = (n: number) => Array.from({ length: n }, (_, i) => `Genesis 37:${i + 1}`);
const torah = { id: "00000000-0000-4000-8000-000000000001", kind: "torah", revision: 1, verses: refs(6), ranges: ["Genesis 37:1-6"], aliyahStarts: ["Genesis 37:3", "Genesis 37:5"] } as unknown as Reading;
const haftarah = { id: "00000000-0000-4000-8000-000000000002", kind: "haftarah", revision: 1, verses: ["Amos 2:6", "Amos 2:7"], ranges: ["Amos 2:6-7"], aliyahStarts: null } as unknown as Reading;
const verse = (verseRef: string, assessment: "not-started" | "working" | "solid", self: "unmarked" | "working" | "got-it" = "unmarked"): ProgressVerse =>
  ({ verseRef, selfCheck: { state: self, version: 1 }, assessment: { state: assessment, version: 2 } });

describe("the Aliyot block (T1)", () => {
  const marks = new Map<Reading["kind"], ProgressVerse[]>([
    ["torah", [verse("Genesis 37:1", "solid"), verse("Genesis 37:2", "solid"), verse("Genesis 37:3", "working"), verse("Genesis 37:4", "not-started", "got-it"), verse("Genesis 37:5", "not-started"), verse("Genesis 37:6", "not-started")]],
    ["haftarah", [verse("Amos 2:6", "not-started"), verse("Amos 2:7", "not-started")]]]);
  it("gives one row per aliyah and one per undivided reading, with the student's Today rule for each state", () => {
    const rows = aliyahRows([torah, haftarah], marks);
    expect(rows.map(row => [row.key, row.state])).toEqual([["torah:1", "solid"], ["torah:2", "working"], ["torah:3", "not-started"], ["haftarah", "not-started"]]);
    // Mark solid would assess only the verses not already Solid.
    expect(rows[1].unsolid.map(row => row.verseRef)).toEqual(["Genesis 37:3", "Genesis 37:4"]);
    // A reading whose marks are not all read yet is left out rather than guessed.
    expect(aliyahRows([torah, haftarah], new Map([["torah", marks.get("torah")!.slice(0, 3)]])).map(row => row.key)).toEqual([]);
  });
  it("offers the tutor Mark solid on every row not already Solid, and shows an admin the states only", () => {
    const rows = aliyahRows([torah, haftarah], marks);
    const tutor = html(createElement(AliyotList, { rows, canMark: true, pending: null, failure: null, onMark() {} }));
    expect(byTestId(tutor, "aliyah-row").map(row => attr(row, "data-state"))).toEqual(["solid", "working", "not-started", "not-started"]);
    expect(byTestId(tutor, "mark-aliyah-solid")).toHaveLength(3);
    const admin = html(createElement(AliyotList, { rows, canMark: false, pending: null, failure: null, onMark() {} }));
    expect(byTestId(admin, "aliyah-row")).toHaveLength(4); expect(byTestId(admin, "mark-aliyah-solid")).toHaveLength(0);
    // While one row is being marked, every Mark button waits and the row says how far it got; a failure says what saved.
    const busy = html(createElement(AliyotList, { rows, canMark: true, pending: { key: "torah:2", done: 1, of: 2 }, failure: null, onMark() {} }));
    expect(byTestId(busy, "mark-aliyah-solid").every(button => attr(button, "disabled") !== undefined)).toBe(true);
    expect(byTestId(busy, "mark-aliyah-pending")).toHaveLength(1);
    const failed = html(createElement(AliyotList, { rows, canMark: true, pending: null, failure: { key: "torah:3", done: 0, of: 2 }, onMark() {} }));
    expect(attr(byTestId(failed, "mark-aliyah-failed")[0], "role")).toBe("alert");
  });
  it("is worded in the house voice (the one wording check for this card)", () => {
    const root = html(createElement(AliyotList, { rows: aliyahRows([torah, haftarah], marks), canMark: true, pending: null, failure: null, onMark() {} }));
    expect(text(nodes(root).find(node => "tagName" in node && node.tagName === "h3")!)).toBe("Aliyot");
    expect(byTestId(root, "mark-aliyah-solid").map(text)).toEqual(["Mark Aliyah 2 solid", "Mark Aliyah 3 solid", "Mark Haftarah solid"]);
    expect(renderToStaticMarkup(createElement(AliyotList, { rows: [], canMark: true, pending: null, failure: null, onMark() {} }))).toBe("");
  });
});

describe("the seven-day window every practice surface uses", () => {
  it("is the seven days ending today, oldest first, across a month end", () => {
    const days = lastSevenDays("2026-11-03", new Set(["2026-10-28", "2026-11-03", "2026-10-27"]));
    expect(days.map(day => day.date)).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(days.map(day => day.practiced)).toEqual([true, false, false, false, false, false, true]);
    expect(days.filter(day => day.today).map(day => day.date)).toEqual(["2026-11-03"]);
    expect(days[0].weekday).toBe(3); // Wednesday
    expect(sevenDayWindow("2026-11-03")).toEqual({ from: "2026-10-28", through: "2026-11-03" });
    // The student's card and the shared helper agree, so the three screens the walkthrough compared cannot differ.
    expect(cardDays("2026-11-03", new Set(["2026-10-28"]))).toEqual(lastSevenDays("2026-11-03", ["2026-10-28"]));
  });
});

describe("Since your last lesson (T4/T7)", () => {
  const practice: TutorPractice = { from: "2026-10-01", today: "2026-11-17", practicedDays: 3, lastLesson: "2026-11-10", stillWorking: 1, learn: null, marks: [],
    days: [{ day: "2026-11-12", readings: [{ kind: "torah", opened: ["Genesis 37:1", "Genesis 37:2"], marked: [{ verseRef: "Genesis 37:2", state: "got-it" }, { verseRef: "Genesis 37:1", state: "got-it" }] }] },
      { day: "2026-11-14", readings: [{ kind: "torah", opened: ["Genesis 37:4"], marked: [{ verseRef: "Genesis 37:4", state: "working" }] }] },
      { day: "2026-11-09", readings: [{ kind: "torah", opened: ["Genesis 37:6"], marked: [{ verseRef: "Genesis 37:6", state: "got-it" }] }] }] };
  const lesson = { lessonDate: "2026-11-10", beforeNext: "When I sit down after dinner, I will chant aliyah 2 twice." };
  const practiced = { today: "2026-11-17", dates: ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-14"] };
  it("counts only what came after the lesson, as counts and ranges", () => {
    expect(practicedSince(practiced.dates, lesson.lessonDate, practiced.today)).toBe(2);
    expect(marksSince(practice, lesson.lessonDate)).toEqual({ lines: ["Marked Got it: 2 verses (Torah 37:1–37:2)", "Marked Still working: 1 verse (Torah 37:4)"], from: null });
    // A lesson older than the 14-day read says where the marks begin.
    expect(marksSince(practice, "2026-10-20").from).toBe("2026-11-04");
  });
  it("shows the assigned tutor the newly marked verses, and never shows that per-day detail to an admin", () => {
    const tutor = html(createElement(SinceLastLesson, { mode: "tutor", lesson, practiced, practice }));
    expect(byTestId(tutor, "since-marks")).toHaveLength(1);
    // An admin who is handed the same read (which the page never does) still gets no per-day lines: dates, the count and the note only.
    const admin = html(createElement(SinceLastLesson, { mode: "admin", lesson, practiced, practice }));
    expect(byTestId(admin, "lesson-since")).toHaveLength(1);
    expect(byTestId(admin, "since-marks")).toHaveLength(0);
    expect(renderToStaticMarkup(createElement(SinceLastLesson, { mode: "admin", lesson, practiced, practice }))).not.toMatch(/37:4|Got it|Still working/);
    expect(byTestId(admin, "since-practiced")).toHaveLength(1);
  });
  it("is not drawn at all before the first lesson note", () => {
    expect(renderToStaticMarkup(createElement(SinceLastLesson, { mode: "tutor", lesson: null, practiced, practice }))).toBe("");
  });
});

describe("an unassigned student's next steps", () => {
  it("leads with Assign verses, and gives an admin the tutor and invitation pages", () => {
    const admin = html(createElement(StaffNextSteps, { mode: "admin", student: { id: "00000000-0000-4000-8000-000000000009", firstName: "Synthetic" }, torahOnly: false, onAssign() {} }));
    expect(attr(byTestId(admin, "next-step-tutor")[0], "href")).toBe("/workspace/admin/students/00000000-0000-4000-8000-000000000009/access");
    expect(attr(byTestId(admin, "next-step-invite")[0], "href")).toBe("/workspace/admin/invitations?student=00000000-0000-4000-8000-000000000009&role=parent");
    const tutor = html(createElement(StaffNextSteps, { mode: "tutor", student: { id: "00000000-0000-4000-8000-000000000009", firstName: "Synthetic" }, torahOnly: true, onAssign() {} }));
    expect(byTestId(tutor, "next-step-tutor")).toHaveLength(0); expect(byTestId(tutor, "next-step-invite")).toHaveLength(0);
    expect(nodes(tutor).filter(node => "tagName" in node && node.tagName === "button")).toHaveLength(1);
  });
});
