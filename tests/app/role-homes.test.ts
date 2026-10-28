import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/provider", async original => ({ ...await original<Record<string, unknown>>(),
  useWorkspace: () => ({ context: null, busy: false, registerWork: () => () => {} }),
  WorkspaceLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { ...rest, href }, children) }));
vi.mock("../../src/components/portal/workspace/document-title", () => ({ DocumentTitle: () => null }));
import { ThisWeekLists, weekAhead, weekWindow, type WeekStudent } from "../../src/components/portal/workspace/staff/this-week";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// 2026-10-26 15:00 UTC is 10:00 in St. Louis, so the congregation's day is still the 26th.
const now = Date.UTC(2026, 9, 26, 15, 0, 0);
const student = (n: number, extra: Partial<WeekStudent> = {}): WeekStudent => ({ id: id(n), firstName: `Synthetic${n}`, lastName: "Student", ceremonyDate: "2027-03-06", rehearsal1: null, rehearsal2: null, serviceSlot: "morning", disabledAt: null, ceremonyDoneAt: null, ...extra });

describe("The admin's This week lists", () => {
  it("is the seven days from the congregation's today, not the viewer's clock", () => {
    expect(weekWindow(now)).toEqual({ from: "2026-10-26", through: "2026-11-01" });
    // 03:00 UTC on the 27th is still the evening of the 26th in St. Louis.
    expect(weekWindow(Date.UTC(2026, 9, 27, 3, 0, 0))).toEqual({ from: "2026-10-26", through: "2026-11-01" });
  });
  it("takes ceremonies and rehearsals inside the window, soonest first, and never a disabled or ceremony-done student", () => {
    const { ceremonies, rehearsals } = weekAhead([
      student(1, { ceremonyDate: "2026-11-01" }), student(2, { ceremonyDate: "2026-10-26" }), student(3, { ceremonyDate: "2026-11-02" }), student(4, { ceremonyDate: "2026-10-25" }),
      student(5, { ceremonyDate: "2026-10-28", disabledAt: "2026-10-01T00:00:00Z" }), student(6, { ceremonyDate: "2026-10-29", ceremonyDoneAt: "2026-10-01T00:00:00Z" }),
      student(7, { rehearsal1: "2026-10-30", rehearsal2: "2026-11-01" }), student(8, { rehearsal1: "2026-10-20", rehearsal2: "2026-11-02" })], now);
    expect(ceremonies.map(entry => entry.student.id)).toEqual([id(2), id(1)]);
    expect(rehearsals.map(entry => [entry.student.id, entry.date])).toEqual([[id(7), "2026-10-30"], [id(7), "2026-11-01"]]);
  });
  it("renders each list under its heading with a link to the student's page, the date and the service slot", () => {
    const markup = parseFragment(renderToStaticMarkup(createElement(ThisWeekLists, { now, students: [student(1, { ceremonyDate: "2026-10-31", serviceSlot: "havdalah" }), student(2, { serviceSlot: "unknown", rehearsal1: "2026-10-28" })] })));
    const ceremonies = nodes(markup).find(node => attr(node, "data-testid") === "this-week-ceremonies")!, rehearsals = nodes(markup).find(node => attr(node, "data-testid") === "this-week-rehearsals")!;
    const link = nodes(ceremonies).find(node => "tagName" in node && node.tagName === "a")!;
    expect(attr(link, "href")).toBe(`/workspace/admin/students/${id(1)}/reading`);
    expect(text(link)).toContain("Synthetic1 Student"); expect(text(link)).toContain("Havdalah");
    expect(nodes(link).some(node => "tagName" in node && node.tagName === "time" && attr(node, "datetime") === "2026-10-31")).toBe(true);
    const row = nodes(rehearsals).find(node => "tagName" in node && node.tagName === "a")!;
    expect(attr(row, "href")).toBe(`/workspace/admin/students/${id(2)}/reading`); expect(text(row)).not.toMatch(/service/i);
  });
  it("words the section titles and the empty state as approved", () => {
    const markup = renderToStaticMarkup(createElement(ThisWeekLists, { now, students: [student(1)] }));
    expect(markup).toContain("Ceremonies this week"); expect(markup).toContain("Rehearsals this week");
    expect(markup.match(/None this week\./g)).toHaveLength(2);
  });
});
