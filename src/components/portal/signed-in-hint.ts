/**
 * Whether this browser was last seen signed in (release 1.9 N20). The reader never asks for a session on its own, so its
 * Save offers "Sign in to save" from the start unless this hint says a session may be here. It is only a hint for which
 * control to show first: it grants nothing, names no one, and any server answer replaces it.
 */
export const SIGNED_IN_HINT = "crc-torah:signed-in/v1";

export function signedInHint(): boolean {
  try { return window.localStorage.getItem(SIGNED_IN_HINT) === "1"; } catch { return false; }
}
export function rememberSignedIn(on: boolean): void {
  try { if (on) window.localStorage.setItem(SIGNED_IN_HINT, "1"); else window.localStorage.removeItem(SIGNED_IN_HINT); } catch { /* Storage blocked: Save asks when pressed. */ }
}
