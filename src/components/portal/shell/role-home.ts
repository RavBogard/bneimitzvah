// Where each role lives, and which role a page that belongs to no one role (the front door, /workspace) takes the person to. Pure.
import type { Role } from "../api";
import { shellRole } from "./tabs";

/** The shelf: the home of every non-admin role. */
export const MINE_HREF = "/mine";
export const rolePaths = { student: MINE_HREF, parent: MINE_HREF, tutor: MINE_HREF, admin: "/workspace/admin/students" } as const satisfies Record<Role, string>;

/**
 * The role the front door and /workspace lead with: the role the person was last in (kept in page memory only), else the highest of
 * admin, tutor, parent, student. Null for an account with no role.
 */
export function homeRole(roles: readonly Role[], remembered: Role | null): Role | null {
  return shellRole("/", roles, remembered);
}

/** Where /workspace sends a person: the admin's This week when they are an admin, else My Readings (an account with no role too). */
export function workspaceDestination(roles: readonly Role[], _remembered: Role | null): string {
  return roles.includes("admin") ? rolePaths.admin : MINE_HREF;
}
