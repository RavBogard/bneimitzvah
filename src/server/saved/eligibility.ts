import "server-only";

/**
 * Who may keep a saved layer (accounts plan choice B): worked out on every request, never granted.
 * An active parent, tutor or admin grant, or an active tenant_member row (an approved account, release 1.4 PR 2).
 * Students are not automatically eligible. The session summary's `saved` flag uses the same rule.
 */
export const SAVED_ELIGIBLE_ROLES = Object.freeze(["parent", "tutor", "admin"] as const);
export type SavedEligibleRole = (typeof SAVED_ELIGIBLE_ROLES)[number];
export const savedEligibleRole = (role: string): role is SavedEligibleRole => (SAVED_ELIGIBLE_ROLES as readonly string[]).includes(role);
