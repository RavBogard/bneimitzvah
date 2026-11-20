// 1.9 N10: which tabs a signed-in role has, where each goes, and which one is current. Pure, so it is unit-tested without a browser.
// The admin keeps four tabs through their workspace and on My Readings.
// The shell role below is still read by the tab bar, More, and the front door and account page (homeRole); it stays until those stop asking.
import type { Role } from "../api";

export type ShellRole = Role;
export type TabIcon = "week" | "students" | "people" | "more";
export type ShellTab = { key: string; label: string; href: string; icon: TabIcon; current: boolean };

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

export type StaffNavigationRole = Extract<ShellRole, "admin" | "tutor">;

/** The disclosure follows the view, including the canonical family reading routes on the shelf. */
export function staffNavigationRole(pathname: string, roles: readonly ShellRole[], remembered: ShellRole | null): StaffNavigationRole | null {
  if (under(pathname, "/mine/child") || under(pathname, "/mine/reading")) return null;
  const role = roleOfPath(pathname) ?? shellRole(pathname, roles, remembered);
  return (role === "admin" || role === "tutor") && roles.includes(role) ? role : null;
}

const MORE_PATHS = ["/workspace/more", "/workspace/email", "/workspace/claude"] as const;
/** Where "More" lists its destinations. */
export const MORE_HREF = "/workspace/more";
export const STUDENTS_HREF = "/workspace/admin/students?tab=students";
const PEOPLE_PATHS = ["/workspace/admin/invitations", "/workspace/admin/tutors", "/workspace/accounts"] as const;
const isMore = (path: string) => MORE_PATHS.some(base => under(path, base)) || under(path, "/workspace/admin/settings") || under(path, "/workspace/admin/guide-sharing") || under(path, "/workspace/admin/guides");
const isPeople = (path: string) => PEOPLE_PATHS.some(base => under(path, base));

/** The admin workspace keeps its tabs on the roster, individual readers and the shared shelf. */
export function adminArea(pathname: string): boolean {
  return pathname === "/mine" || under(pathname, "/workspace/admin") || isMore(pathname) || isPeople(pathname);
}


export type TabContext = {
  role: ShellRole;
  pathname: string;
  /** The raw `?tab=` value. */
  tab: string | null;
};

/** The tabs for a role and whether each is current. The site bar marks My Readings when the shelf is open. */
export function tabsFor({ role, pathname, tab }: TabContext): ShellTab[] {
  if (role !== "admin" || !adminArea(pathname)) return [];
  const make = (key: string, label: string, href: string, icon: TabIcon, current: boolean): ShellTab => ({ key, label, href, icon, current });
  const roster = pathname === "/workspace/admin/students";
  return [
    make("week", "This week", "/workspace/admin/students", "week", roster && tab !== "students"),
    make("students", "Students", STUDENTS_HREF, "students", roster && tab === "students" || under(pathname, "/workspace/admin/students") && !roster),
    make("people", "People", "/workspace/admin/invitations", "people", isPeople(pathname)),
    make("more", "More", MORE_HREF, "more", isMore(pathname)),
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
