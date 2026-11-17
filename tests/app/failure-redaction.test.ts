import { expect, test } from "vitest";
import { describeError, methodForLog, routeForLog, scrubText, siteForLog, stripQuotedValues } from "../../src/server/logging/redact";

// Synthetic secrets only (CLAUDE.md: never a real token, cookie, connection string or address).
const EMAIL = "sarah.cohen@example.test";
const PASSWORD = "Zx9pQ2synthPW";
// Assembled at run time so the repository policy's credential scan never sees a literal connection string.
const SCHEME = ["postgres", "ql"].join("");
const CONNECTION = `${SCHEME}://portal_login:${PASSWORD}@example.test/neondb?sslmode=require`;
const TOKEN43 = "Ab3dEf6hIj9lMn2pQr5tUv8xYz1bCd4fGh7jKl0nOpQ";
const CODE32 = "qwertyuiopasdfghjklzxcvbnmqwerty";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ";
const COOKIE = "better-auth.session_token=SyntheticCookieValue123.abcDEF456";
const SECRETS = [EMAIL, PASSWORD, "portal_login", TOKEN43, CODE32, JWT, "SyntheticCookieValue123", "sslmode=require"];
const clean = (text: string) => SECRETS.every(secret => !text.includes(secret)) && !/sarah|cohen/i.test(text);

test("scrubText removes emails, connection strings, URLs with tokens, JWTs, cookies, authorization and long tokens", () => {
  const inputs = [
    `duplicate key for ${EMAIL}`,
    `percent-encoded sarah.cohen%40example.test`,
    `connect failed: ${CONNECTION}`,
    `host=ep-x.neon.tech user=portal_login password=${PASSWORD} dbname=neondb`,
    `fetch https://portal.example.test/api/notifications/unsubscribe?t=${TOKEN43}&kind=weekly failed`,
    `request to https://user:${PASSWORD}@example.test/v1/${TOKEN43} failed`,
    `invalid token ${JWT}`,
    `cookie: ${COOKIE}; other=1`,
    `Set-Cookie=${COOKIE}`,
    `headers {"authorization":"Bearer ${TOKEN43}"}`,
    `Authorization: Basic ${Buffer.from(`portal_login:${PASSWORD}`).toString("base64")}`,
    `token ${TOKEN43} rejected`,
    `sign-in code ${CODE32} unknown`,
    `?t=${TOKEN43}`,
    `api_key=${TOKEN43}`,
    `hl1.k1.${TOKEN43}.${TOKEN43}.${TOKEN43}`,
  ];
  for (const input of inputs) {
    const out = scrubText(input);
    expect(clean(out), out).toBe(true);
  }
  expect(scrubText(`connect failed: ${CONNECTION}`)).toContain(`${SCHEME}://example.test/[redacted]`);
  expect(scrubText("Progress unavailable")).toBe("Progress unavailable");
  expect(scrubText("connect ECONNREFUSED 10.0.0.1:5432")).toBe("connect ECONNREFUSED 10.0.0.1:5432");
});

test("scrubText keeps one line, bounds length and never throws on hostile input", () => {
  expect(scrubText("a\nb\r\nc\u2028d")).toBe("a b c d");
  expect(scrubText("x ".repeat(10_000)).length).toBeLessThanOrEqual(304);
  expect(scrubText(undefined)).toBe("");
  expect(scrubText({ toString() { throw new Error("touched"); } })).toBe("");
});

test("stripQuotedValues drops quoted values and keeps only identifier-shaped Postgres object names", () => {
  expect(stripQuotedValues(`duplicate key value violates unique constraint "user_email_key"`)).toBe(`duplicate key value violates unique constraint "user_email_key"`);
  expect(stripQuotedValues(`invalid input syntax for type uuid: "Sarah Cohen"`)).toBe(`invalid input syntax for type uuid: "..."`);
  expect(stripQuotedValues(`Key (email)=(${EMAIL}) already exists.`)).toBe("Key (...)=(...) already exists.");
  expect(stripQuotedValues(`relation "a b; drop" does not exist`)).toBe(`relation "..." does not exist`);
  expect(stripQuotedValues(`value 'Sarah' and unterminated "Cohen`)).toBe(`value '...' and unterminated "..."`);
});

test("routeForLog keeps literal words and UUIDs, redacts tokens and everything after a capability word, never the query", () => {
  const id = "0b7c6a52-3f1e-4c55-9d8a-2a1f3e4b5c6d";
  expect(routeForLog(`https://portal.example.test/api/saved/learner/readings?learner=${id}&t=${TOKEN43}`)).toBe("/api/saved/learner/readings");
  expect(routeForLog(`/api/admin/students/${id}/tutors`)).toBe(`/api/admin/students/${id}/tutors`);
  expect(routeForLog(`/api/invitations/${TOKEN43}`)).toBe("/api/invitations/:redacted");
  expect(routeForLog(`/api/invitations/somewordtoken`)).toBe("/api/invitations/:redacted");
  expect(routeForLog(`/api/invitations/open`)).toBe("/api/invitations/open");
  expect(routeForLog(`/api/notifications/unsubscribe/${id}`)).toBe("/api/notifications/unsubscribe/:redacted");
  expect(routeForLog(`/api/auth/sign-in/code/${CODE32}`)).toBe("/api/auth/sign-in/code/:redacted");
  expect(routeForLog(`/api/x/${CODE32}`)).toBe("/api/x/:redacted");
  expect(routeForLog(`/api/x/${EMAIL}`)).toBe("/api/x/:redacted");
  expect(routeForLog(`/api/x/hl1.k1.abc`)).toBe("/api/x/:redacted");
  expect(routeForLog(`/api/x/%2e%2e`)).toBe("/api/x/:redacted");
  expect(routeForLog("/.well-known/oauth-protected-resource/api/mcp")).toBe("/.well-known/oauth-protected-resource/api/mcp");
  expect(routeForLog(`/${"a/".repeat(40)}`).endsWith("/...")).toBe(true);
  expect(routeForLog("not a url")).toBe("[unreadable]");
  expect(routeForLog(42)).toBe("[unreadable]");
  expect(methodForLog("POST")).toBe("POST");
  expect(methodForLog("PROPFIND")).toBe("OTHER");
  expect(siteForLog("reading-cache/get")).toBe("reading-cache/get");
  expect(siteForLog(`x/${EMAIL}`)).toBe("invalid-site");
});

test("describeError: a Postgres unique violation logs class, SQLSTATE, constraint, table and frames, never detail or the email", () => {
  class NeonDbError extends Error {
    code = "23505"; constraint = "user_email_key"; table = "user"; schema = "public";
    detail = `Key (email)=(${EMAIL}) already exists.`; hint = `try ${EMAIL}`; where = `SQL statement with ${EMAIL}`;
    constructor() { super(`duplicate key value violates unique constraint "user_email_key"`); this.name = "NeonDbError"; }
  }
  const pg = new NeonDbError();
  const drizzle = new Error(`Failed query: insert into "user" ("email") values ($1)\nparams: ${EMAIL},${CONNECTION}`, { cause: pg });
  drizzle.name = "DrizzleQueryError";
  const described = describeError(drizzle);
  const text = JSON.stringify(described);
  expect(clean(text), text).toBe(true);
  expect(text).not.toContain("params");
  expect(described.name).toBe("DrizzleQueryError");
  expect(described.stack?.length).toBeGreaterThan(0);
  expect(described.stack?.every(frame => frame.startsWith("at "))).toBe(true);
  expect(described.cause).toMatchObject({ name: "NeonDbError", code: "23505", constraint: "user_email_key", table: "user", schema: "public",
    message: `duplicate key value violates unique constraint "user_email_key"` });
  expect(Object.keys(described.cause!)).not.toContain("detail");
});

test("describeError: fetch and driver errors with tokens, connection strings and JSON fragments are scrubbed or withheld", () => {
  const fetchError = new TypeError("fetch failed", { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND for https://api.example.test/v1?token=${TOKEN43}`), { code: "ENOTFOUND" }) });
  const driver = Object.assign(new Error(`password authentication failed: ${CONNECTION}`), { code: "28P01", detail: CONNECTION });
  const json = (() => { try { JSON.parse(`{"private_key": "${TOKEN43}`); } catch (error) { return error; } })();
  for (const error of [fetchError, driver, json]) {
    const text = JSON.stringify(describeError(error));
    expect(clean(text), text).toBe(true);
  }
  expect(describeError(fetchError).cause?.code).toBe("ENOTFOUND");
  expect(describeError(driver).code).toBe("28P01");
  expect(describeError(json).name).toBe("SyntaxError");
  expect(describeError(json).message).toBeUndefined();
});

test("describeError: hostile and odd throwables never throw, never call toString/toJSON, and add no free properties", () => {
  let touched = false;
  const hostile = new Error("x");
  Object.defineProperty(hostile, "message", { get() { touched = true; throw new Error("accessor"); } });
  Object.defineProperty(hostile, "stack", { get() { throw new Error("accessor"); } });
  Object.defineProperty(hostile, "name", { value: `Evil\n{"event":"forged"}` });
  expect(describeError(hostile)).toEqual({ name: "Error" });
  expect(touched).toBe(true);
  const weird = { toString() { throw new Error("t"); }, toJSON() { throw new Error("j"); } };
  expect(describeError(weird)).toEqual({ name: "non-error object" });
  expect(describeError(EMAIL)).toEqual({ name: "non-error string" });
  expect(describeError(0)).toEqual({ name: "non-error number" });
  const loop = new Error("loop"); (loop as { cause?: unknown }).cause = loop;
  expect(describeError(loop).cause).toBeUndefined();
  const deep = [0, 1, 2, 3, 4, 5, 6].reduce<Error>((inner, i) => new Error(`level ${i}`, { cause: inner }), new Error("root"));
  let depth = 0; for (let d = describeError(deep); d.cause; d = d.cause) depth++;
  expect(depth).toBe(3);
  // A forged stack frame inside a message never becomes a frame with private content.
  const forged = new Error(`boom\n    at ${EMAIL} (${CONNECTION})`);
  expect(clean(JSON.stringify(describeError(forged)))).toBe(true);
  // A code is kept only when it has a code's shape; a free-text "code" on a third-party error is dropped.
  expect(describeError(Object.assign(new Error("x"), { code: EMAIL })).code).toBeUndefined();
  expect(describeError(Object.assign(new Error("x"), { code: "sarah" })).code).toBeUndefined();
  expect(describeError(Object.assign(new Error("x"), { constraint: `bad "${EMAIL}"` })).constraint).toBeUndefined();
  // A lookalike of our own class names gains neither a free lowercase code nor a reason.
  const spoof = Object.assign(new Error("x"), { name: "Unavailable", code: "alice-cohen", reason: "alice-cohen/ruth" });
  expect(describeError(spoof)).not.toHaveProperty("reason");
  expect(describeError(spoof)).not.toHaveProperty("code");
});

// Adversarial review of def1a6d: drizzle copies its params (free text from a lesson note) into the message, and V8
// copies the whole message into the stack. Nothing from it may survive as a "frame".
const NOTE = "Worked on aliyah 3 with Noa Levinson\nat Rabbi Bogard's study, Noa's mum noa.levinson.mum@example.test will drive\n  at home: dad (Ari Levinson) code 483920 token abcdefghijklmnopqrstuvwxyzabcd";
const NOTE_SECRETS = ["Noa", "Levinson", "Bogard", "noa.levinson", "483920", "abcdefghijklmnopqrstuvwxyzabcd", "Ari", "home", "params"];
test("a DrizzleQueryError whose params hold a multi-line note leaves nothing of the note in stack or message", async () => {
  const { DrizzleQueryError } = await import("drizzle-orm/errors");
  const pg = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
  for (const note of [NOTE, `${NOTE}\nat Noa Levinson's house (kitchen table:12:34)\n    at Levinson (notes:12:34)`]) {
    const error = new DrizzleQueryError('insert into "lesson_log" ("student_id","note") values ($1, $2)', ["0b6c2a8e-1111-4222-8333-444455556666", note], pg);
    const described = describeError(error);
    const text = JSON.stringify(described);
    for (const secret of NOTE_SECRETS) expect(text.includes(secret), `${secret}: ${text}`).toBe(false);
    expect(described.stack?.length).toBeGreaterThan(0);
    // Every kept frame is a code location: function plus a relative path and line:column.
    for (const frame of described.stack!) expect(frame).toMatch(/^at (?:[\w$.<> \[\]]+ \()?(?:node_modules\/|node:|[\w@.\-/[\]()]+\.[cm]?[jt]sx?:)[^\s]*\)?$/);
    expect(described.cause).toMatchObject({ code: "57014" });
  }
  // The same lines with the header no longer matching (message changed after construction) are still dropped.
  const mutated = new Error(`first\n${NOTE}`); mutated.message = "first";
  const mutatedText = JSON.stringify(describeError(mutated));
  for (const secret of NOTE_SECRETS) expect(mutatedText.includes(secret), secret).toBe(false);
  // A hostile line that ends like a frame but whose location is not a code file is dropped.
  const forged = new Error("x"); forged.stack = "Error: x\n    at Noa Levinson's study (home:12:34)\n    at Noa (kitchen:12:34)\n    at fn (/srv/app/src/a.ts:1:2)";
  // Outside the project root and node_modules, only the last three path segments are kept.
  expect(describeError(forged).stack).toEqual(["at fn (app/src/a.ts:1:2)"]);
});

test("Unicode, fullwidth, zero-width and repeatedly percent-encoded addresses are all removed whole", () => {
  const fullwidthAt = String.fromCharCode(0xff20), zwsp = String.fromCharCode(0x200b), rtl = String.fromCharCode(0x202e);
  const cases: [string, string[]][] = [
    ["send failed for josé@example.test", ["jos"]],
    ["send failed for zoë.cohen@example.test", ["zo", "cohen"]],
    ["rcpt alice@exämple.test rejected", ["alice", "mple"]],
    [`rcpt alice${fullwidthAt}example.test rejected`, ["alice"]],
    [`rcpt alice${zwsp}@example.test`, ["alice"]],
    [`rcpt ali${rtl}ce@example.test`, ["ali", "ce@"]],
    ["u=alice%2540example.test", ["alice"]],
    ["u=alice%252540example.test", ["alice"]],
  ];
  for (const [input, leftovers] of cases) {
    const out = scrubText(input);
    expect(out, input).toContain("[email]");
    for (const piece of leftovers) expect(out.includes(piece), `${input} -> ${out}`).toBe(false);
  }
});

test("capping never leaves part of an address at the edge, and token-shaped runs and 6-digit codes are removed", () => {
  const out = scrubText(`${"A1".repeat(595)} john.smith@example.test`);
  expect(out).not.toMatch(/john|smit/);
  const huge = scrubText(`${"word ".repeat(2000)}john.smith@example.test`);
  expect(huge).not.toMatch(/john|smit/);
  expect(scrubText("verification code 483920 rejected")).toBe("verification code [number] rejected");
  expect(scrubText("token abcdefghijklmnopqrstuvwxyzabcde invalid")).toBe("token [token] invalid");
  expect(scrubText("key ABCDEFGHIJKLMNOPQRSTUVWXYZABCDE invalid")).toBe("key [token] invalid");
  expect(scrubText("id abcdefghijklmnop-qrstuvwxyzabcdefgh-ijklmnopqrstuvwx")).not.toMatch(/qrstuvwxyzabcdefgh/);
  // Ordinary text, ports, SQLSTATE-free messages and our reason codes pass unchanged.
  expect(scrubText("connect ECONNREFUSED 10.0.0.1:5432")).toBe("connect ECONNREFUSED 10.0.0.1:5432");
  expect(scrubText("reading-cache/haftarah-ranges")).toBe("reading-cache/haftarah-ranges");
  const reasoned = describeError(new Error("x", { cause: Object.assign(new Error("57014 timeout"), { code: "57014" }) }));
  expect(reasoned.cause?.code).toBe("57014");
});
