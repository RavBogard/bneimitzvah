import "server-only";
import { mailbox } from "../runtime/config";
import { RuntimeUnavailable } from "../runtime/errors";

type Kind = "invitation" | "magic-link";
const paths = { invitation: "/invitations/open", "magic-link": "/auth/email" } as const;
const redirects = new Set(["/", "/mine", "/sign-in", "/invitations/accept"]);

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

/**
 * The sign-in email's code lines, Daniel's wording (2026-10-23, offload A3). The code goes alone on the line after
 * its label, as plain digits, and is the only 6-digit number in the email (what Mail and Gmail detect). No WebOTP
 * `@host #code` line: that format is defined for SMS only.
 */
export const SIGN_IN_CODE_LINES = Object.freeze({
  code: (product: string) => `Or enter this code in the ${product} app:`,
  once: "The link and the code work once, for 5 minutes.",
  // A capped address's link-only email: Daniel's line 3 with the code taken out (a derivation, not new wording).
  linkOnce: "The link works once, for 5 minutes.",
  never: (product: string) => `No one from ${product} will ever ask you for this code. Don’t read it to anyone or type it anywhere but ${product}.`,
});
const CODE = /^\d{6}$/;
export type InvitationMailRole = "parent" | "student" | "tutor";
const INVITATION_ROLES: readonly string[] = ["parent", "student", "tutor"];
/**
 * The invitation's expiry as the email states it (Daniel, N22): "The link works through Sunday, November 1", the last full
 * day the link works, date only, no clock time. It is the day before the expiry instant's own calendar date in the
 * congregation's time zone (America/Chicago, as everywhere else), so the link works all through the day the email names.
 */
export function invitationExpiryText(expiresAt: Date): string {
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) throw 0;
  // The last full day the link works (Daniel, N22): the calendar day before the expiry's own date in Central time.
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(expiresAt).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(year, month - 1, day - 1)))
    .replace(/[  ]/g, " ");
}
/**
 * The invitation email (decision 12; G13): it names the congregation, the role and the expiry, and never a student.
 * It is given no student at all, so no child's name can reach the subject or the body. The parent, student and tutor
 * lines are Daniel's approved wording.
 */
export function invitationMailText(input: Readonly<{ congregation: string; productName: string; role: InvitationMailRole; expiresAt: Date; link: string }>) {
  const until = invitationExpiryText(input.expiresAt);
  const line = input.role === "parent"
    ? `${input.congregation} invited you as a parent on ${input.productName}, to follow your child's Beit Mitzvah preparation. The link works through ${until}.`
    : `${input.congregation} invited you as a ${input.role} on ${input.productName}. The link works through ${until}.`;
  const subject = `${input.congregation} invited you to ${input.productName}`;
  // No number in a subject: a lock screen or Gmail card must never offer one as a code.
  if (/\p{N}/u.test(subject)) throw 0;
  return { subject, text: `${line}\n\nOpen this link to review your invitation:\n\n${input.link}\n\n${IGNORE}` };
}
const IGNORE = "If you did not request this message, you can ignore it.";
// A congregation's product name (tenant.product_name, E1) as these emails accept it: a plain name with no number of
// any kind, so no name can add a code-like run or a digit to a subject. A refused name sends nothing.
export const mailProductName = (value: unknown): value is string => plainName(value) && !/[\p{N}\p{Cf}\p{Cc}]/u.test(value as string);
function bodyOf(link: string, code: string | null | undefined, product: string): string {
  // The code is in the body only, never the subject (lock screens, provider subject logs). A capped address (null
  // code) gets the link only: line 2 (the label and the code) is left out and line 3 names only the link; lines 1, 4
  // and 5 are unchanged.
  const codeLines = code === null ? "" : `${SIGN_IN_CODE_LINES.code(product)}\n${code}\n\n`;
  const once = code === null ? SIGN_IN_CODE_LINES.linkOnce : SIGN_IN_CODE_LINES.once;
  const body = `Open this link to sign in:\n\n${link}\n\n${codeLines}${once}\n\n${SIGN_IN_CODE_LINES.never(product)}\n\n${IGNORE}`;
  // Fail closed rather than send an email a phone could misread: no number but ASCII digits, and the code is the
  // only run of 6 or more of them (none at all when link-only; the sign-in token is letters only).
  const runs = body.match(/\p{N}{6,}/gu) ?? [];
  if (/(?![0-9])\p{N}/u.test(body) || (code === null ? runs.length !== 0 : runs.length !== 1 || runs[0] !== code)) throw 0;
  return body;
}
function subjectOf(product: string): string {
  const subject = `Sign in to ${product}`;
  // No number in a subject: a lock screen or Gmail card must never offer one as the code.
  if (/\p{N}/u.test(subject)) throw 0;
  return subject;
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
  return async (kind: Kind, message: Readonly<{ email: string; url: string; productName: string; code?: string | null;
    congregation?: string; role?: InvitationMailRole; expiresAt?: Date }>): Promise<void> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!mailbox(input.from) || !mailbox(message.email) || !mailProductName(message.productName)) throw 0;
      // A sign-in email carries its code, or an explicit null when the address is capped (link only); an invitation
      // never carries one.
      if (kind === "magic-link" ? message.code !== null && (typeof message.code !== "string" || !CODE.test(message.code)) : message.code !== undefined) throw 0;
      // An invitation names its congregation (a plain name with no number), its role and its expiry; a sign-in email none of them.
      if (kind === "invitation" ? !mailProductName(message.congregation) || !INVITATION_ROLES.includes(message.role as string) || !(message.expiresAt instanceof Date)
        : message.congregation !== undefined || message.role !== undefined || message.expiresAt !== undefined) throw 0;
      const link = canonicalLink(message.url, input.origin, kind);
      const mail = kind === "invitation"
        ? invitationMailText({ congregation: message.congregation!, productName: message.productName, role: message.role!, expiresAt: message.expiresAt!, link })
        : { subject: subjectOf(message.productName), text: bodyOf(link, message.code, message.productName) };
      await Promise.race([
        (async () => {
          const response = await input.fetch("https://api.resend.com/emails", {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify({ from: input.from, to: [message.email], subject: mail.subject, text: mail.text }),
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

/**
 * Release 1.4's two account emails, the only ones (accounts plan section 4). The transport writes every word itself:
 * callers give a kind, one verified recipient, the congregation's own names and an idempotency key, never a URL,
 * a requester's name or their purpose, so a request cannot relay text to staff. Its one link is a fixed path on
 * this origin. Outside production (`enabled` false) it hands nothing to the provider and answers "skipped".
 */
export type AccountMailKind = "account-request" | "account-approved";
export type AccountMailOutcome = NotificationOutcome | "skipped";
const ACCOUNT_LINKS: Readonly<Record<AccountMailKind, string>> = { "account-request": "/workspace/accounts", "account-approved": "/" };
const plainName = (value: unknown) => typeof value === "string" && value.length >= 1 && value.length <= 120 && value === value.trim() && !/[\x00-\x1f\x7f-\x9f\u00ad\u061c\u115f\u1160\u200b-\u200d\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0\u{e0000}-\u{e007f}<>@]/u.test(value);
export function accountMailText(kind: AccountMailKind, origin: string, tenant: Readonly<{ name: string; productName: string }>) {
  const link = `${origin}${ACCOUNT_LINKS[kind]}`;
  return kind === "account-request"
    ? { subject: `An account request for ${tenant.productName}`,
      text: `Someone has asked for a ${tenant.productName} account.\n\nReview account requests: ${link}\n\nYou receive this because you approve accounts for ${tenant.name}.` }
    : { subject: `Your ${tenant.productName} account is ready`,
      // The parent-invitation line is Daniel's approved wording (G13, TP-06): an account is never a parent's access.
      text: `Your account request was approved. Sign in with this email address to save readings. ${link}. To follow a student's preparation, ask the congregation for a parent invitation. If you did not ask for an account, you can ignore this email.` };
}
export function createAccountMailTransport(input: { origin: string; apiKey: string; from: string; fetch: typeof globalThis.fetch; enabled: boolean; timeoutMs?: number }) {
  const timeout = input.timeoutMs ?? 5000;
  try {
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.username || origin.password || !["http:", "https:"].includes(origin.protocol) || typeof input.enabled !== "boolean"
      || !mailbox(input.from) || !/^re_[A-Za-z0-9_-]{8,256}$/.test(input.apiKey) || !Number.isInteger(timeout) || timeout < 1 || timeout > 10000) throw 0;
  } catch { throw new RuntimeUnavailable(); }
  return async (kind: AccountMailKind, to: string, tenant: Readonly<{ name: string; productName: string }>, idempotencyKey: string): Promise<AccountMailOutcome> => {
    try {
      if (!Object.hasOwn(ACCOUNT_LINKS, kind) || !mailbox(to) || !plainName(tenant?.name) || !plainName(tenant?.productName) || typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) return "rejected";
    } catch { return "rejected"; }
    // Tests, local and preview deployments never reach a real person.
    if (!input.enabled) return "skipped";
    const message = accountMailText(kind, input.origin, tenant), controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined, refused = false, accepted = false;
    try {
      await Promise.race([
        (async () => {
          const response = await input.fetch("https://api.resend.com/emails", {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
            body: JSON.stringify({ from: input.from, to: [to], subject: message.subject, text: message.text }),
          });
          accepted = response.ok && !response.redirected && (!response.url || response.url === "https://api.resend.com/emails");
          refused = !accepted && response.status >= 400 && response.status < 500 && !response.redirected;
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
