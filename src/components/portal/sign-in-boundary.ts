export type GoogleIntent = "account" | undefined;
export type AuthDestination = "/" | "/invitations/accept" | "/account";
export type EntryQuery = Record<string, string | string[] | undefined>;

/** Actual GIS attempt fence: cancelled or superseded work cannot deliver a redirect. */
export function createGoogleAttemptScope(isCurrent: () => boolean) {
  const controller = new AbortController();
  const live = () => !controller.signal.aborted && isCurrent();
  return { signal: controller.signal, live, abort: () => controller.abort(), accept(action: () => void) { if (live()) action(); } };
}

/** One decision supplies both the public document metadata and inline GIS. */
export function publicSignInBoundary(value: unknown, page: "home" | "sign-in") {
  const denied = { inlineGoogle: false, referrer: "no-referrer" as const, intent: undefined, authenticationError: false };
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return denied;
  const entries = Object.getOwnPropertyDescriptors(value), allowed = page === "home" ? [] : ["intent", "error"];
  if (Object.keys(entries).some(key => !allowed.includes(key) || !Object.hasOwn(entries[key], "value"))) return denied;
  const intent = entries.intent?.value, error = entries.error?.value;
  if (intent !== undefined && intent !== "account" || error !== undefined && error !== "authentication") return denied;
  return { inlineGoogle: true, referrer: "strict-origin-when-cross-origin" as const, intent: intent as GoogleIntent, authenticationError: error === "authentication" };
}
