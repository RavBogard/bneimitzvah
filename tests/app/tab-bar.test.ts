import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyboardIsOpen, parseReadingTab, roleOfPath, shellRole, tabsFor, type ShellRole } from "../../src/components/portal/shell/tabs";

// 1.9 N10: the tab bar's model. Browser-measured checks (one tap, reload, 44px, no overlap, skip link) are in e2e/tab-bar.spec.ts.
const labels = (role: ShellRole, pathname: string, tab: string | null = null, practiceStudentId?: string) => tabsFor({ role, pathname, tab, practiceStudentId }).map(item => item.label);
const current = (role: ShellRole, pathname: string, tab: string | null = null, practiceStudentId?: string) => tabsFor({ role, pathname, tab, practiceStudentId }).filter(item => item.current).map(item => item.label);

describe("the four tabs per role (decision 1)", () => {
  it("are exactly the approved words, in order", () => {
    expect(labels("student", "/workspace/student")).toEqual(["Today", "Reading", "Learn", "Account"]);
    expect(labels("parent", "/workspace/parent")).toEqual(["Today", "Practice", "Honors", "Account"]);
    expect(labels("tutor", "/workspace/tutor")).toEqual(["This week", "Students", "Lessons", "More"]);
    expect(labels("admin", "/workspace/admin/students")).toEqual(["This week", "Students", "People", "More"]);
  });
  it("are never more than four, and the public pages are not among their destinations", () => {
    for (const role of ["student", "parent", "tutor", "admin"] as const) for (const item of tabsFor({ role, pathname: "/workspace", tab: null })) {
      expect(item.href).not.toMatch(/^\/(read|trope-chart|print)/);
      expect(tabsFor({ role, pathname: "/workspace", tab: null })).toHaveLength(4);
    }
  });
});

describe("which tab is current", () => {
  it("is one tab on every page the shell knows, and the home tab on a role's home", () => {
    expect(current("student", "/workspace/student")).toEqual(["Today"]);
    expect(current("student", "/workspace/student", "service")).toEqual(["Reading"]);
    expect(current("student", "/account")).toEqual(["Account"]);
    expect(current("parent", "/workspace/parent")).toEqual(["Today"]);
    expect(current("parent", "/workspace/parent", "reading")).toEqual(["Practice"]);
    expect(current("parent", "/workspace/practice/abc")).toEqual(["Practice"]);
    expect(current("parent", "/workspace/parent", "honors")).toEqual(["Honors"]);
    expect(current("tutor", "/workspace/tutor")).toEqual(["This week"]);
    expect(current("tutor", "/workspace/tutor", "reading")).toEqual(["Students"]);
    expect(current("tutor", "/workspace/tutor/abc")).toEqual(["Students"]);
    expect(current("tutor", "/workspace/tutor/abc", "lessons")).toEqual(["Lessons"]);
    expect(current("tutor", "/workspace/more")).toEqual(["More"]);
    expect(current("tutor", "/workspace/email")).toEqual(["More"]);
    expect(current("admin", "/workspace/admin/students")).toEqual(["This week"]);
    expect(current("admin", "/workspace/admin/students", "students")).toEqual(["Students"]);
    expect(current("admin", "/workspace/admin/students/import")).toEqual(["Students"]);
    expect(current("admin", "/workspace/admin/students/abc/reading", "lessons")).toEqual(["Students"]);
    for (const path of ["/workspace/admin/invitations", "/workspace/admin/tutors", "/workspace/accounts"]) expect(current("admin", path)).toEqual(["People"]);
    for (const path of ["/workspace/more", "/workspace/admin/settings", "/workspace/admin/reference-review", "/workspace/email", "/workspace/claude"]) expect(current("admin", path)).toEqual(["More"]);
  });
  it("leaves Learn alone: it is a way out to the public page, never the current tab", () => {
    expect(tabsFor({ role: "student", pathname: "/workspace/student", tab: null }).find(item => item.label === "Learn")).toMatchObject({ href: "/learn", current: false });
  });
  it("sends a tutor's Lessons to the same student, and a parent's Practice back to the open child", () => {
    expect(tabsFor({ role: "tutor", pathname: "/workspace/tutor/abc", tab: null }).find(item => item.label === "Lessons")!.href).toBe("/workspace/tutor/abc?tab=lessons");
    expect(tabsFor({ role: "tutor", pathname: "/workspace/tutor", tab: null }).find(item => item.label === "Lessons")!.href).toBe("/workspace/tutor?tab=lessons");
    expect(tabsFor({ role: "parent", pathname: "/workspace/parent", tab: null, practiceStudentId: "abc" }).find(item => item.label === "Practice")!.href).toBe("/workspace/practice/abc");
    expect(tabsFor({ role: "parent", pathname: "/workspace/parent", tab: null }).find(item => item.label === "Practice")!.href).toBe("/workspace/parent?tab=reading");
  });
});

describe("the role whose tabs a page shows", () => {
  it("is the page's own role, else the remembered one, else the highest", () => {
    const all: ShellRole[] = ["student", "parent", "tutor", "admin"];
    expect(shellRole("/workspace/parent", all, "admin")).toBe("parent");
    expect(shellRole("/workspace/practice/x", all, "admin")).toBe("parent");
    expect(shellRole("/workspace/email", all, "tutor")).toBe("tutor");
    expect(shellRole("/workspace/email", all, null)).toBe("admin");
    expect(shellRole("/account", ["student", "parent"], null)).toBe("parent");
    expect(shellRole("/workspace/email", ["student"], "admin")).toBe("student");
    expect(shellRole("/workspace/tutor", ["student"], null)).toBe("student");
    expect(shellRole("/account", [], "admin")).toBeNull();
    expect(roleOfPath("/workspace/more")).toBeNull();
    expect(roleOfPath("/workspace/admin/people")).toBe("admin");
  });
  it("reads only the three views from ?tab=", () => {
    expect(["reading", "service", "lessons", "honors", "", null, undefined, "READING"].map(value => parseReadingTab(value))).toEqual(["reading", "service", "lessons", null, null, null, null, null]);
  });
});

describe("the on-screen keyboard", () => {
  it("is open only when a text field has focus and the visible viewport has lost much of the window", () => {
    expect(keyboardIsOpen({ layoutHeight: 844, visibleHeight: 480, textFieldFocused: true })).toBe(true);
    expect(keyboardIsOpen({ layoutHeight: 844, visibleHeight: 480, textFieldFocused: false })).toBe(false);
    expect(keyboardIsOpen({ layoutHeight: 844, visibleHeight: 844, textFieldFocused: true })).toBe(false);
    // Browser chrome that slides away is not a keyboard.
    expect(keyboardIsOpen({ layoutHeight: 844, visibleHeight: 790, textFieldFocused: true })).toBe(false);
    expect(keyboardIsOpen({ layoutHeight: 0, visibleHeight: 0, textFieldFocused: true })).toBe(false);
  });
});

describe("the shell's files", () => {
  const css = readFileSync("src/components/portal/shell/shell.module.css", "utf8");
  it("retire the seven-area admin bar", () => {
    expect(existsSync("src/components/portal/workspace/admin-nav.tsx")).toBe(false);
    expect(readFileSync("src/app/globals.css", "utf8")).not.toMatch(/\.admin-nav\b/);
  });
  it("spend tokens: no colour or radius of its own, every target at least 44px, and the bar hides only for the keyboard", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...stripped.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(match => match[0])).toEqual(["#fff"]);
    expect(stripped).not.toMatch(/border-radius:\s*\d/);
    expect(stripped).toMatch(/\.tab \{[^}]*min-height: 4rem/);
    expect(stripped).toMatch(/\.sublink \{[^}]*min-height: 44px/);
    expect(stripped).toMatch(/\.bar\[data-hidden\] \{ display: none; \}/);
    // From 1000px it is a rail and is never hidden for the keyboard.
    expect(stripped).toMatch(/@media \(min-width: 1000px\)[\s\S]*\.bar\[data-hidden\] \{ display: block; \}/);
  });
  it("write nothing to web storage (the student-work privacy test allows none)", () => {
    for (const file of ["role-memory.ts", "tab-bar.tsx", "tab-param.ts", "tabs.ts", "more.tsx", "people-nav.tsx"]) {
      expect(readFileSync(`src/components/portal/shell/${file}`, "utf8").replace(/\/\/.*$/gm, ""), file).not.toMatch(/sessionStorage|localStorage|indexedDB|document\.cookie/);
    }
  });
  it("keep the print links to the approved pair", () => {
    const reading = readFileSync("src/components/portal/workspace/reading.tsx", "utf8"), study = readFileSync("src/components/portal/workspace/study/view.tsx", "utf8");
    for (const source of [reading, study]) { expect(source).toContain("Print the whole reading"); expect(source).toContain("Print practice sheet"); }
    expect(reading).not.toMatch(/service-entry/);
  });
});
