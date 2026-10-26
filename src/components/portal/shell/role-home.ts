// Where each role lives, and which role a page that belongs to no one role (the front door, /workspace) takes the person to. Pure.
import type { Role } from "../api";
import { shellRole } from "./tabs";

export const rolePaths = { student: "/workspace/student", parent: "/workspace/parent", tutor: "/workspace/tutor", admin: "/workspace/admin/students" } as const satisfies Record<Role, string>;

/**
 * The role the front door and /workspace lead with: the role the person was last in (kept in page memory only), else the highest of
 * admin, tutor, parent, student. Null for an account with no role.
 */
export function homeRole(roles: readonly Role[], remembered: Role | null): Role | null {
  return shellRole("/", roles, remembered);
}

/** Where /workspace sends a person: the home of their role (see `homeRole`), or Account for an account with no role, where it can ask for one. */
export function workspaceDestination(roles: readonly Role[], remembered: Role | null): string {
  const role = homeRole(roles, remembered);
  return role ? rolePaths[role] : "/account";
}
