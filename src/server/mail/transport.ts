import "server-only";
import { mailbox } from "../runtime/config";
import { RuntimeUnavailable } from "../runtime/errors";

type Kind = "invitation" | "magic-link";
const paths = { invitation: "/invitations/open", "magic-link": "/auth/email" } as const;
const redirects = new Set(["/", "/sign-in", "/invitations/accept"]);

function canonicalLink(value: string, origin: string, kind: Kind) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value)) throw 0;
  const url = new URL(value);
  if (url.href !== value || url.origin !== origin || url.username || url.password || url.search || url.pathname !== paths[kind]) throw 0;
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.size !== 1 || fragment.getAll("token").length !== 1) throw 0;
  const token = fragment.get("token") ?? "";
  if (!(kind === "invitation" ? /^[A-Za-z0-9_-]{43}$/ : /^[A-Za-z]{32}$/).test(token)) throw 0;
  if (url.hash !== `#token=${token}` || (kind === "invitation" && Buffer.from(token, "base64url").toString("base64url") !== token)) throw 0;
  return url.href;
}

// The SDK's generated GET URL is validated and discarded entirely in-process.
// Only the new fragment URL reaches the mail provider.
export function projectMagicLink(urlValue: string, token: string, origin: string): string {
  try {
    const url = new URL(urlValue);
    const keys = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"];
    if (url.href !== urlValue || url.origin !== origin || url.username || url.password || url.hash || url.pathname !== "/api/auth/magic-link/verify"
      || !/^[A-Za-z]{32}$/.test(token) || url.searchParams.get("token") !== token
      || [...url.searchParams.keys()].some(key => !keys.includes(key) || url.searchParams.getAll(key).length !== 1)) throw 0;
    for (const key of keys.slice(1)) if (url.searchParams.has(key) && !redirects.has(url.searchParams.get(key)!)) throw 0;
    return `${origin}/auth/email#token=${token}`;
  } catch { throw new RuntimeUnavailable(); }
}

// Plain-text transactional mail only. Tracking must also be disabled on the
// sending domain in Resend; their API has no per-message tracking override.
export function createMailTransport(input: { origin: string; apiKey: string; from: string; fetch: typeof globalThis.fetch; timeoutMs?: number }) {
  const timeout = input.timeoutMs ?? 5000;
  try {
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password || !["http:", "https:"].includes(origin.protocol)
      || !mailbox(input.from) || !/^re_[A-Za-z0-9_-]{8,256}$/.test(input.apiKey)
      || !Number.isInteger(timeout) || timeout < 1 || timeout > 10000) throw 0;
  } catch { throw new RuntimeUnavailable(); }
  return async (kind: Kind, message: Readonly<{ email: string; url: string }>): Promise<void> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!mailbox(input.from) || !mailbox(message.email)) throw 0;
      const link = canonicalLink(message.url, input.origin, kind);
      await Promise.race([
        (async () => {
          const response = await input.fetch("https://api.resend.com/emails", {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ from: input.from, to: [message.email], subject: kind === "invitation" ? "Your CRC B'nei Mitzvah invitation" : "Sign in to CRC B'nei Mitzvah",
              text: `Open this link to ${kind === "invitation" ? "review your invitation" : "sign in"}:\n\n${link}\n\nIf you did not request this message, you can ignore it.` }),
          });
          // No provider body/header/ID escapes, even on errors; do not buffer it.
          try {
            if (!response.ok || response.redirected || (response.url && response.url !== "https://api.resend.com/emails")) throw 0;
          } finally { await response.body?.cancel().catch(() => {}); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RuntimeUnavailable()); }, timeout); }),
      ]);
    } catch { throw new RuntimeUnavailable(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}

export type NotificationMessage = Readonly<{ email: string; subject: string; text: string; unsubscribeUrl: string; idempotencyKey: string }>;
/** sent: the provider accepted it. rejected: definitely not sent (refused, or never handed over). unknown: no answer. */
export type NotificationOutcome = "sent" | "rejected" | "unknown";
const NOTIFICATION_TOKEN = /^[tdr]\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Release 1.1 notification mail: plain text, the portal's own one-click unsubscribe (RFC 8058) in
 * the headers, and the ledger row's id as Resend's Idempotency-Key so a retried send of the same
 * row is delivered once. Never a bearer link to content: the only links are the portal's address
 * and the unsubscribe capability for this one recipient and kind.
 */
export function createNotificationTransport(input: { origin: string; apiKey: string; from: string; fetch: typeof globalThis.fetch; timeoutMs?: number }) {
  const timeout = input.timeoutMs ?? 5000;
  try {
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password || !["http:", "https:"].includes(origin.protocol)
      || !mailbox(input.from) || !/^re_[A-Za-z0-9_-]{8,256}$/.test(input.apiKey)
      || !Number.isInteger(timeout) || timeout < 1 || timeout > 10000) throw 0;
  } catch { throw new RuntimeUnavailable(); }
  const unsubscribePrefix = `${input.origin}/api/notifications/unsubscribe?t=`;
  return async (message: NotificationMessage): Promise<NotificationOutcome> => {
    try {
      if (!mailbox(message.email) || typeof message.subject !== "string" || message.subject.length < 1 || message.subject.length > 120 || /[\x00-\x1f\x7f-\x9f]/.test(message.subject)
        || typeof message.text !== "string" || message.text.length < 1 || message.text.length > 12000 || /[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(message.text)
        || typeof message.unsubscribeUrl !== "string" || !message.unsubscribeUrl.startsWith(unsubscribePrefix) || !NOTIFICATION_TOKEN.test(message.unsubscribeUrl.slice(unsubscribePrefix.length))
        || typeof message.idempotencyKey !== "string" || !UUID.test(message.idempotencyKey)) return "rejected";
    } catch { return "rejected"; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, refused = false, accepted = false;
    try {
      await Promise.race([
        (async () => {
          const response = await input.fetch("https://api.resend.com/emails", {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "idempotency-key": message.idempotencyKey },
            body: JSON.stringify({ from: input.from, to: [message.email], subject: message.subject, text: message.text,
              headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
          });
          // A 4xx (including 429) is a definite refusal; a 5xx or an odd answer may have been accepted.
          accepted = response.ok && !response.redirected && (!response.url || response.url === "https://api.resend.com/emails");
          refused = !accepted && response.status >= 400 && response.status < 500 && !response.redirected;
          // No provider body/header/ID escapes, even on errors; do not buffer it.
          await response.body?.cancel().catch(() => {});
          if (!accepted) throw 0;
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RuntimeUnavailable()); }, timeout); }),
      ]);
      return "sent";
    } catch { return accepted ? "sent" : refused ? "rejected" : "unknown"; }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
