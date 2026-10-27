import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminArea, keyboardIsOpen, parseReadingTab, roleOfPath, shellRole, tabsFor, type ShellRole } from "../../src/components/portal/shell/tabs";

// Area A: only the admin has a tab bar, and only on admin pages. Browser-measured checks are in e2e/tab-bar.spec.ts.
const labels = (role: ShellRole, pathname: string, tab: string | null = null) => tabsFor({ role, pathname, tab }).map(item => item.label);
const current = (role: ShellRole, pathname: string, tab: string | null = null) => tabsFor({ role, pathname, tab }).filter(item => item.current).map(item => item.label);

describe("the admin's four tabs", () => {
  it("are exactly the approved words, in order", () => {
    expect(labels("admin", "/workspace/admin/students")).toEqual(["This week", "Students", "People", "More"]);
  });
  it("are the only tabs: every other role has none anywhere", () => {
    for (const role of ["student", "parent", "tutor"] as const) for (const path of ["/mine", "/read", "/account", "/workspace/tutor/abc", "/workspace/admin/students", "/workspace/more"]) expect(tabsFor({ role, pathname: path, tab: null }), `${role} ${path}`).toEqual([]);
    for (const item of tabsFor({ role: "admin", pathname: "/workspace/admin/students", tab: null })) expect(item.href).not.toMatch(/^\/(read|trope-chart|print)/);
  });
  it("show on the admin's pages only (decision 20)", () => {
    expect(tabsFor({ role: "admin", pathname: "/mine", tab: null })).toEqual([]);
    expect(tabsFor({ role: "admin", pathname: "/workspace/tutor/abc", tab: null })).toEqual([]);
    expect(tabsFor({ role: "admin", pathname: "/workspace/admin/students/abc/reading", tab: null })).toEqual([]);
    expect(adminArea("/workspace/admin/students/import")).toBe(true);
    expect(adminArea("/workspace/accounts")).toBe(true);
  });
});

describe("which tab is current", () => {
  it("is one tab on every admin page the shell knows", () => {
    expect(current("admin", "/workspace/admin/students")).toEqual(["This week"]);
    expect(current("admin", "/workspace/admin/students", "students")).toEqual(["Students"]);
    expect(current("admin", "/workspace/admin/students/import")).toEqual(["Students"]);
    for (const path of ["/workspace/admin/invitations", "/workspace/admin/tutors", "/workspace/accounts"]) expect(current("admin", path)).toEqual(["People"]);
    for (const path of ["/workspace/more", "/workspace/admin/settings", "/workspace/admin/reference-review", "/workspace/email", "/workspace/claude"]) expect(current("admin", path)).toEqual(["More"]);
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
