import { returnAddress } from "../../lib/site/return-address";

export type GoogleIntent = "account" | undefined;
export type AuthDestination = "/" | "/invitations/accept" | "/account";
export type EntryQuery = Record<string, string | string[] | undefined>;

/** Actual GIS attempt fence: cancelled or superseded work cannot deliver a redirect. */
export function createGoogleAttemptScope(isCurrent: () => boolean) {
  const controller = new AbortController();
  const live = () => !controller.signal.aborted && isCurrent();
  return { signal: controller.signal, live, abort: () => controller.abort(), accept(action: () => void) { if (live()) action(); } };
}

/**
 * One decision supplies both the public document metadata and inline Google sign-in. /sign-in may also carry
 * `return` (N20): where to go back to after signing in. A return address `returnAddress` refuses is simply
 * dropped (the default landing), and it never combines with the fixed Account intent.
 */
export function publicSignInBoundary(value: unknown, page: "home" | "sign-in") {
  const denied = { inlineGoogle: false, referrer: "no-referrer" as const, intent: undefined, authenticationError: false, back: null };
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return denied;
  const entries = Object.getOwnPropertyDescriptors(value), allowed = page === "home" ? [] : ["intent", "error", "return"];
  if (Object.keys(entries).some(key => !allowed.includes(key) || !Object.hasOwn(entries[key], "value"))) return denied;
  const intent = entries.intent?.value, error = entries.error?.value;
  if (intent !== undefined && intent !== "account" || error !== undefined && error !== "authentication") return denied;
  const back = intent === undefined ? returnAddress(entries.return?.value) : null;
  return { inlineGoogle: true, referrer: "strict-origin-when-cross-origin" as const, intent: intent as GoogleIntent, authenticationError: error === "authentication", back };
}
