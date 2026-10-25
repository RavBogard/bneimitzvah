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
  try { window.sessionStorage.removeItem(SIGN_IN_PENDING); } catch { /* Nothing pending here. */ }
}

/**
 * This tab just left for Google to sign in. Google's way back may land straight on a reading that never asks for a
 * session, so the reader asks once (SaveReading) and the answer sets or clears the hint above. Tab-scoped, short-lived.
 */
export const SIGN_IN_PENDING = "crc-torah:sign-in-pending/v1";
const PENDING_MS = 15 * 60_000;
export function markSignInPending(): void {
  try { window.sessionStorage.setItem(SIGN_IN_PENDING, String(Date.now())); } catch { /* The reader asks when Save is pressed. */ }
}
export function signInPending(): boolean {
  try { const at = Number(window.sessionStorage.getItem(SIGN_IN_PENDING)), age = Date.now() - at; return Number.isSafeInteger(at) && at > 0 && age >= 0 && age < PENDING_MS; } catch { return false; }
}
