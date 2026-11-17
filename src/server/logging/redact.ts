// Every rule that decides what a failure log line may contain lives in this one module, so a reviewer can read
// the whole contract in one place. It is pure (no I/O, no globals, no imports) and is unit tested with hostile
// input in tests/app/failure-redaction.test.ts.
//
// What a failure line may carry (failure.ts writes the line):
//   - a request id we generate, the HTTP method from a fixed list, and the route from routeForLog (never a query
//     string or fragment, never a token-shaped path segment);
//   - a static site code chosen by our own source (siteForLog), and the response status;
//   - per error in the cause chain (at most MAX_CAUSE_DEPTH deep): the class name (identifier-shaped only); the
//     message's first line with quoted values removed and then scrubbed (scrubText); a code only when it has the
//     shape of a Postgres SQLSTATE or a Node/undici error code (or a closed lowercase code on one of our own
//     classes); a `reason` only on our own classes; the Postgres constraint/table/schema/column/routine only when
//     identifier-shaped; and the stack frames ("at ..." lines only, never the message lines a stack starts with),
//     each frame scrubbed.
// A SyntaxError's message is never carried (JSON.parse quotes a fragment of its input).
// What it never carries: request or response bodies, headers, cookies, query strings, SQL text parameters,
// Postgres `detail`/`hint`/`where`/`position`/`internalQuery` (they quote row values), any other error property,
// names or email addresses. Nothing here calls toString/toJSON on a value it was given.

/** Our own error classes. Their messages are fixed strings and their `code`/`reason` fields are closed unions of
 * lowercase words chosen in source, so only for these names is a lowercase `code` or a `reason` logged. Messages
 * are treated the same for every class (first line, quoted values removed, scrubbed): for our fixed messages that
 * changes nothing, and a third-party error that borrows one of these names gains no more than a closed-shape code. */
const OWN_CLOSED_CODE_NAMES = new Set([
  "Unavailable", "RuntimeUnavailable", "AccessDenied", "AccessUnavailable", "HttpBoundaryError", "ReferenceUnavailable",
  "StudyUnavailable", "StudyCacheUnavailable", "SheetUnavailable", "ReadingUnavailable", "PublicReadingUnavailable",
  "SourceTextUnavailable", "SourceMetadataUnavailable", "SourceContentUnavailable", "SourceContentUnsupported",
  "SefariaJsonUnavailable", "StepSourceUnavailable", "CommentaryUnavailable", "TranslationsUnavailable",
  "CourseTextUnavailable", "ReviewUnavailable", "ReviewInvalid", "PhraseUnavailable",
]);
const OWN_CODE = /^[a-z][a-z-]{0,30}$/;

export const MAX_CAUSE_DEPTH = 4;
const MAX_FRAMES = 15;
const MAX_MESSAGE = 300;
const MAX_FRAME = 300;
const MAX_SEGMENTS = 12;

const IDENTIFIER = /^[A-Za-z_$][\w$]{0,63}$/;
// Postgres SQLSTATE (5 chars of 0-9A-Z) or a Node/undici-style code (ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT, ERR_INVALID_URL).
const ERROR_CODE = /^(?:[0-9A-Z]{5}|[A-Z][A-Z0-9_]{1,47})$/;
// Postgres object names are logged only when they look like a plain identifier (never a quoted value).
const SQL_IDENTIFIER = /^[a-z_][a-z0-9_$]{0,62}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A literal path word: lowercase words joined by single hyphens, no run longer than 20 letters. Sign-in codes
// (32 letters), invitation tokens (43 base64url), honoree links (hl1.k1. ...) and unsubscribe tokens all fail it.
const LITERAL_SEGMENT = /^[a-z]{1,20}(?:-[a-z]{1,20}){0,5}$/;
// Words after which a path segment could be a capability. Today every such secret travels in a body, a fragment or
// a query string (which is never logged), not the path: /api/invitations/open takes the token in its body, the
// sign-in code and magic-link token arrive in bodies, /api/notifications/unsubscribe takes `t` in the query or body,
// and the honoree guest read is POST /api/honoree/read with the token in the body. This rule pins that a future
// path form (/api/invitations/<token>, /api/unsubscribe/<token>) is redacted even when the segment is word-shaped
// or a UUID.
const SECRET_SEGMENT_AFTER = new Set(["invitations", "invitation", "unsubscribe", "code", "codes", "token", "tokens", "guest", "magic-link", "confirm", "read", "open", "link", "links"]);
// Literal words that may follow one of those words in today's routes.
const LITERAL_AFTER_SECRET = new Set(["open", "accept", "pending", "revoke", "resend", "receipt"]);
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** The method from a closed list, else "OTHER". */
export function methodForLog(method: unknown): string {
  return typeof method === "string" && METHODS.has(method) ? method : "OTHER";
}

/**
 * The route for a log line: the pathname only (never the query or fragment), with each segment kept only when it
 * is a literal route word or a UUID. Every other segment, including anything that could be a token, becomes
 * ":redacted". A segment right after a capability word is redacted even when it looks like a word or a UUID.
 */
export function routeForLog(input: unknown): string {
  try {
    if (typeof input !== "string" || input.length > 8192) return "[unreadable]";
    let pathname = input.startsWith("/") ? input : new URL(input).pathname;
    const cut = pathname.search(/[?#]/);
    if (cut >= 0) pathname = pathname.slice(0, cut);
    const segments = pathname.split("/").slice(1);
    const out: string[] = [];
    let previous = "";
    for (const segment of segments.slice(0, MAX_SEGMENTS)) {
      if (segment === "") out.push("");
      else if (SECRET_SEGMENT_AFTER.has(previous) && !LITERAL_AFTER_SECRET.has(segment)) out.push(":redacted");
      else if (LITERAL_SEGMENT.test(segment) || segment === ".well-known") out.push(segment);
      else if (UUID.test(segment)) out.push(segment.toLowerCase());
      else out.push(":redacted");
      previous = segment;
    }
    if (segments.length > MAX_SEGMENTS) out.push("...");
    return `/${out.join("/")}`;
  } catch { return "[unreadable]"; }
}

type Rule = readonly [RegExp, string | ((match: string, ...groups: string[]) => string)];
// Applied in order. Each targets a shape, not a known value, so it also catches secrets we have never seen.
const SCRUB_RULES: readonly Rule[] = [
  // Control characters and line breaks: one line per field, and no forged log lines or stack frames.
  [/[\u0000-\u001f\u007f\u2028\u2029]+/g, " "],
  // Cookie and authorization values, to the end of the field: "cookie: a=b; c=d", "Authorization: Bearer x".
  [/\b(set-cookie|cookie|authorization|proxy-authorization)\b\s*[:=]\s*.*/gi, "$1=[redacted]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"],
  // better-auth session cookies, quoted or bare.
  [/(?:__Secure-|__Host-)?better-auth\.[A-Za-z0-9_.]+=[^\s;,"']*/g, "[cookie]"],
  // URLs of any scheme (postgres://, postgresql://, https://, wss://): keep scheme and host only. Credentials,
  // path, query and fragment are dropped (a path can carry a token, a query always might).
  [/\b([a-z][a-z0-9+.-]{1,20}):\/\/(?:[^\s/'"<>]*@)?([^\s/?#:'"<>@]+)[^\s'"<>]*/gi, (_m, scheme: string, host: string) => `${scheme}://${host}/[redacted]`],
  // libpq key=value connection strings and any credential-named key=value or key: value pair.
  [/\b(password|passwd|pwd|secret|client_secret|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|token|otp|sslpassword|sslkey|user|username|email|host|dbname)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1=[redacted]"],
  // Email addresses, also percent-encoded.
  [/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,63}/g, "[email]"],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, "[jwt]"],
  // Query strings outside a URL: "?t=...", "&token=...".
  [/[?&][A-Za-z0-9_.-]{1,40}=[^\s&'"]*/g, "?[query]"],
];
// Long hex, base64 and base64url runs (session tokens, API keys, HMACs, invitation tokens, signed links, sign-in
// codes). Not applied to stack frames, whose bundler chunk names have this shape and come from our build, not data.
const TOKEN_RULES: readonly Rule[] = [
  // A run of only lowercase letters, hyphens and slashes ("reading-cache/haftarah-ranges", our reason codes) is kept.
  [/[A-Za-z0-9+/_-]{20,}={0,2}/g, (match: string) => /\d/.test(match) || /[A-Z]/.test(match) && /[a-z]/.test(match) || /[_+]/.test(match) ? "[token]" : match],
  [/\b[A-Za-z]{32,}\b/g, "[token]"],
];
const MESSAGE_RULES = [...SCRUB_RULES, ...TOKEN_RULES];

function scrub(input: unknown, max: number, rules: readonly Rule[]): string {
  try {
    if (typeof input !== "string") return "";
    let text = input.length > 4 * max ? input.slice(0, 4 * max) : input;
    for (const [pattern, replacement] of rules) text = text.replace(pattern, replacement as never);
    text = text.trim();
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch { return "[unreadable]"; }
}

/** Removes anything shaped like a secret or personal identifier from free text. Pure; never throws. */
export function scrubText(input: unknown, max = MAX_MESSAGE): string { return scrub(input, max, MESSAGE_RULES); }

/**
 * Quoted text in a third-party message is usually a value (`invalid input syntax for type uuid: "x"`,
 * `Key (email)=(...)`): drop it, keeping only a Postgres object name after relation/column/constraint/table/index/
 * type/function/schema when it is identifier-shaped. Applied before scrubText.
 */
export function stripQuotedValues(text: string): string {
  const kept: string[] = [];
  return text
    .replace(/\b(relation|column|constraint|table|index|type|function|schema)\s+"([^"]{0,64})"/gi,
      (_m, word: string, name: string) => SQL_IDENTIFIER.test(name) ? `${word} \u0000${kept.push(name) - 1}\u0000` : `${word} "..."`)
    .replace(/"[^"]*"?/g, '"..."')
    .replace(/'[^']*'?/g, "'...'")
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, "(...)=(...)")
    .replace(/\u0000(\d+)\u0000/g, (_m, index: string) => `"${kept[Number(index)]}"`);
}

function read(target: unknown, key: string): unknown {
  try { return target !== null && (typeof target === "object" || typeof target === "function") ? (target as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}

function framesOf(error: Error): string[] {
  const stack = read(error, "stack");
  if (typeof stack !== "string") return [];
  // Only lines that are stack frames; the stack's first lines repeat the (unscrubbed) message and are never kept.
  // A message with an embedded "\n    at ..." line could pose as a frame, so every frame is scrubbed as well.
  const frames: string[] = [];
  for (const line of stack.slice(0, 32768).split("\n")) {
    const trimmed = line.trim();
    if (!/^at \S[^\n]{0,400}$/.test(trimmed)) continue;
    frames.push(scrub(trimmed, MAX_FRAME, SCRUB_RULES));
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

export type ErrorDescription = {
  name: string; message?: string; code?: string; reason?: string;
  constraint?: string; table?: string; schema?: string; column?: string; routine?: string;
  stack?: string[]; cause?: ErrorDescription;
};

function describeOne(error: unknown, depth: number, seen: Set<unknown>): ErrorDescription {
  if (error === null || error === undefined) return { name: String(error) };
  // A thrown non-Error is described by its type only: a thrown string or object could hold anything.
  if (!(error instanceof Error)) return { name: `non-error ${typeof error}` };
  seen.add(error);
  const rawName = read(error, "name");
  const name = typeof rawName === "string" && IDENTIFIER.test(rawName) ? rawName : "Error";
  const description: ErrorDescription = { name };
  const rawMessage = read(error, "message");
  // A SyntaxError (JSON.parse) quotes a fragment of its input, which may be a key, a token or a provider's body:
  // its message is never written, only its name and stack.
  if (typeof rawMessage === "string" && rawMessage && name !== "SyntaxError" && !(error instanceof SyntaxError)) {
    const message = scrubText(stripQuotedValues(rawMessage.split(/\r?\n/)[0]));
    if (message) description.message = message;
  }
  const own = OWN_CLOSED_CODE_NAMES.has(name);
  const code = read(error, "code");
  if (typeof code === "string" && (ERROR_CODE.test(code) || own && OWN_CODE.test(code))) description.code = code;
  const reason = own ? read(error, "reason") : undefined;
  if (typeof reason === "string" && SITE.test(reason)) description.reason = reason;
  for (const key of ["constraint", "table", "schema", "column", "routine"] as const) {
    const value = read(error, key);
    if (typeof value === "string" && SQL_IDENTIFIER.test(value)) description[key] = value;
  }
  const frames = framesOf(error);
  if (frames.length) description.stack = frames;
  const cause = read(error, "cause");
  if (cause !== undefined && depth + 1 < MAX_CAUSE_DEPTH && !seen.has(cause)) description.cause = describeOne(cause, depth + 1, seen);
  return description;
}

/** A closed, scrubbed description of an error and its cause chain. Never throws, never calls toString/toJSON. */
export function describeError(error: unknown): ErrorDescription {
  try { return describeOne(error, 0, new Set()); } catch { return { name: "Unreadable" }; }
}

/** Every error in the cause chain, outermost first (bounded, cycle-safe). */
export function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && chain.length < MAX_CAUSE_DEPTH + 2 && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? read(current, "cause") : undefined;
  }
  return chain;
}

/** Site and reason codes are static strings our own source chooses ("reading-cache/get"); anything else is replaced. */
const SITE = /^[a-z0-9][a-z0-9-]{0,40}(?:\/[a-z0-9][a-z0-9-]{0,40}){0,3}$/;
export function siteForLog(site: unknown): string {
  return typeof site === "string" && SITE.test(site) ? site : "invalid-site";
}
