// The role a person was last in, for the pages that belong to no one role (Account, Email, More). Role names only, in the
// session storage of this tab; nothing about a student. Blocked storage means those pages fall back to the highest role.
import type { Role } from "../api";

const KEY = "crc-shell-role";
export function rememberedRole(): Role | null {
  try { const value = window.sessionStorage.getItem(KEY); return value === "student" || value === "parent" || value === "tutor" || value === "admin" ? value : null; }
  catch { return null; }
}
export function rememberRole(role: Role) { try { window.sessionStorage.setItem(KEY, role); } catch { /* Storage blocked. */ } }
