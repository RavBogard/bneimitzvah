// 1.9 N10: which tabs a signed-in role has, where each goes, and which one is current. Pure, so it is unit-tested without a browser.
// The four tabs per role are decision 1's, word for word. Until N11 (Today) and N14 (This week) build their own screens, each of
// those tabs opens the role's current home, and the tabs that share a home tell themselves apart by `?tab=`.
import type { Role } from "../api";

export type ShellRole = Role;
export type TabIcon = "today" | "reading" | "learn" | "account" | "practice" | "honors" | "week" | "students" | "lessons" | "people" | "more";
export type ShellTab = { key: string; label: string; href: string; icon: TabIcon; current: boolean };

/** The three views of a student's page, and the value each takes in `?tab=`. */
export const readingTabs = ["reading", "service", "lessons"] as const;
export type ReadingTab = (typeof readingTabs)[number];
export const parseReadingTab = (value: string | null | undefined): ReadingTab | null => readingTabs.find(tab => tab === value) ?? null;

/** Highest authority first: where a page that belongs to no one role (Account, Email) takes its tabs from, absent a remembered role. */
const priority: readonly ShellRole[] = ["admin", "tutor", "parent", "student"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** The role whose tabs a page shows. A page that is one role's own names it; the rest keep the role the person was last in. */
export function shellRole(pathname: string, roles: readonly ShellRole[], remembered: ShellRole | null): ShellRole | null {
  if (!roles.length) return null;
  const named: ShellRole | null = under(pathname, "/workspace/student") ? "student" : under(pathname, "/workspace/parent") || under(pathname, "/workspace/practice") ? "parent"
    : under(pathname, "/workspace/tutor") ? "tutor" : under(pathname, "/workspace/admin") ? "admin" : null;
  if (named && roles.includes(named)) return named;
  if (remembered && roles.includes(remembered)) return remembered;
  return priority.find(role => roles.includes(role)) ?? null;
}
/** The role a page names for itself, so the shell can remember it; null for a shared page. */
export function roleOfPath(pathname: string): ShellRole | null {
  return under(pathname, "/workspace/student") ? "student" : under(pathname, "/workspace/parent") || under(pathname, "/workspace/practice") ? "parent"
    : under(pathname, "/workspace/tutor") ? "tutor" : under(pathname, "/workspace/admin") ? "admin" : null;
}

const MORE_PATHS = ["/workspace/more", "/workspace/email", "/workspace/claude"] as const;
/** Where "More" lists its destinations. */
export const MORE_HREF = "/workspace/more";
const PEOPLE_PATHS = ["/workspace/admin/invitations", "/workspace/admin/tutors", "/workspace/accounts"] as const;
const isMore = (path: string) => MORE_PATHS.some(base => under(path, base)) || under(path, "/workspace/admin/settings") || under(path, "/workspace/admin/reference-review");
const isPeople = (path: string) => PEOPLE_PATHS.some(base => under(path, base));
const isAccount = (path: string) => under(path, "/account");

export type TabContext = {
  role: ShellRole;
  pathname: string;
  /** The raw `?tab=` value. */
  tab: string | null;
  /** The child this tab has open in Practice, if any (a parent's Practice goes straight back to it). */
  practiceStudentId?: string | null;
};

/** The tabs for a role and whether each is current. Exactly one is current on a page the shell knows; none otherwise. */
export function tabsFor({ role, pathname, tab, practiceStudentId }: TabContext): ShellTab[] {
  const view = parseReadingTab(tab), account = isAccount(pathname);
  const make = (key: string, label: string, href: string, icon: TabIcon, current: boolean): ShellTab => ({ key, label, href, icon, current });
  if (role === "student") {
    const home = pathname === "/workspace/student";
    return [
      make("today", "Today", "/workspace/student", "today", home && view === null),
      make("reading", "Reading", "/workspace/student?tab=reading", "reading", home && view !== null),
      make("learn", "Learn", "/learn", "learn", false),
      make("account", "Account", "/account", "account", account || isMore(pathname)),
    ];
  }
  if (role === "parent") {
    const home = pathname === "/workspace/parent", practicing = under(pathname, "/workspace/practice");
    return [
      make("today", "Today", "/workspace/parent", "today", home && view === null && tab !== "honors"),
      make("practice", "Practice", practiceStudentId ? `/workspace/practice/${encodeURIComponent(practiceStudentId)}` : "/workspace/parent?tab=reading", "practice", practicing || home && view !== null),
      make("honors", "Honors", "/workspace/parent?tab=honors", "honors", home && tab === "honors"),
      make("account", "Account", "/account", "account", account || isMore(pathname)),
    ];
  }
  if (role === "tutor") {
    const list = pathname === "/workspace/tutor", mine = under(pathname, "/workspace/tutor");
    return [
      make("week", "This week", "/workspace/tutor", "week", list && view === null),
      make("students", "Students", "/workspace/tutor?tab=reading", "students", mine && view !== "lessons" && !(list && view === null)),
      // On a student's page Lessons stays on that student; elsewhere it opens the list, whose cards carry the view with them.
      make("lessons", "Lessons", mine && !list ? `${pathname}?tab=lessons` : "/workspace/tutor?tab=lessons", "lessons", mine && view === "lessons"),
      make("more", "More", MORE_HREF, "more", isMore(pathname) || account || under(pathname, "/workspace/accounts")),
    ];
  }
  const roster = pathname === "/workspace/admin/students";
  return [
    make("week", "This week", "/workspace/admin/students", "week", roster && tab !== "students"),
    make("students", "Students", "/workspace/admin/students?tab=students", "students", roster && tab === "students" || under(pathname, "/workspace/admin/students") && !roster),
    make("people", "People", "/workspace/admin/invitations", "people", isPeople(pathname)),
    make("more", "More", MORE_HREF, "more", isMore(pathname) || account),
  ];
}

/**
 * Whether the on-screen keyboard is open: a text field has focus and the visible viewport has lost a large part of the
 * window's height. Either alone is not enough (a short window, or a field focused with a hardware keyboard).
 */
export function keyboardIsOpen({ layoutHeight, visibleHeight, textFieldFocused }: { layoutHeight: number; visibleHeight: number; textFieldFocused: boolean }): boolean {
  if (!textFieldFocused || !(layoutHeight > 0) || !(visibleHeight > 0)) return false;
  return layoutHeight - visibleHeight > Math.max(120, layoutHeight * 0.15);
}
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit", "hidden"]);
/** A field a person types into (so one that raises a keyboard). */
export function isTextField(node: Element | null): boolean {
  if (!node) return false;
  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  if (node instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(node.type) && !node.readOnly && !node.disabled;
  return node instanceof HTMLElement && node.isContentEditable;
}
