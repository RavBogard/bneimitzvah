// The role a person was last in, for the pages that belong to no one role (Account, Email, More). It is kept in the page's
// memory only, never in web storage (a signed-in screen writes nothing to the device): moving between pages remembers it, a
// reload falls back to the highest role.
import type { Role } from "../api";

let last: Role | null = null;
export function rememberedRole(): Role | null { return last; }
export function rememberRole(role: Role) { last = role; }
