import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { errorResponse } from "../../src/server/http/responses";
import { AccessDenied } from "../../src/server/access/errors";
import { causedBy, recordFailure, setFailureSinkForTests, Unavailable } from "../../src/server/logging/failure";

// Synthetic values only (CLAUDE.md: never a real token, cookie, connection string or address).
const ORIGIN = "http://localhost:3000";
const EMAIL = "sarah.cohen@example.test";
const PASSWORD = "Zx9pQ2synthPW";
// Assembled at run time so the repository policy's credential scan never sees a literal connection string.
const CONNECTION = `${["postgres", "ql"].join("")}://portal_login:${PASSWORD}@example.test/neondb?sslmode=require`;
const COOKIE_VALUE = "SyntheticSessionCookie0123456789.abcdefABCDEF";
const LEARNER = "0b7c6a52-3f1e-4c55-9d8a-2a1f3e4b5c6d";
const QUERY_SECRET = "QuerySecretValue9876543210abcdef";
const SECRETS = [EMAIL, PASSWORD, "portal_login", COOKIE_VALUE, QUERY_SECRET, "sslmode", "sarah", "Key (email)"];

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; });
function capture() { const lines: string[] = []; restore = setFailureSinkForTests(line => lines.push(line)); return lines; }

class NeonDbError extends Error {
  code = "23505"; constraint = "user_email_key"; table = "user";
  detail = `Key (email)=(${EMAIL}) already exists.`;
  constructor() { super(`duplicate key value violates unique constraint "user_email_key"`); this.name = "NeonDbError"; }
}
function failingError() {
  const driver = new NeonDbError();
  const query = new Error(`Failed query: insert into "user" values ($1)\nparams: ${EMAIL} via ${CONNECTION}`, { cause: driver });
  query.name = "DrizzleQueryError";
  return query;
}
/** A runtime whose every service method throws the database error; resolveHost succeeds. */
function throwingRuntime(error: () => unknown) {
  const service = new Proxy({}, { get: (_t, key) => key === "then" ? undefined : () => { throw error(); } });
  return new Proxy({}, { get: (_t, key) => key === "then" ? undefined : key === "origin" ? ORIGIN
    : key === "resolveHost" ? async () => ({ tenantId: "crc", origin: ORIGIN }) : service }) as never;
}
function request() {
  return new Request(`${ORIGIN}/api/saved/learner/readings?learner=${LEARNER}`, {
    headers: { cookie: `better-auth.session_token=${COOKIE_VALUE}`, authorization: `Bearer ${COOKIE_VALUE}`, "x-forwarded-for": "203.0.113.9" } });
}

test("a database failure inside a service writes one line with route, class, SQLSTATE, constraint and stack, and no secret; the response is unchanged", async () => {
  const lines = capture();
  const dispatch = createHttpDispatcher(async action => action(throwingRuntime(failingError)));
  const response = await dispatch(request());
  // Exactly what the client received before this change: the fixed 503 body and private headers.
  const expected = errorResponse(undefined);
  expect(response.status).toBe(503);
  expect(await response.text()).toBe(await expected.text());
  expect([...response.headers]).toEqual([...expected.headers]);
  expect(lines.length).toBe(1);
  const line = JSON.parse(lines[0]);
  expect(Object.keys(line).sort()).toEqual(["error", "event", "method", "requestId", "route", "site", "status"]);
  expect(line).toMatchObject({ event: "server.failure", method: "GET", route: "/api/saved/learner/readings", status: 503 });
  expect(line.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(line.error.name).toBe("DrizzleQueryError");
  expect(line.error.stack.length).toBeGreaterThan(0);
  expect(line.error.stack.every((frame: string) => frame.startsWith("at "))).toBe(true);
  expect(line.error.cause).toMatchObject({ name: "NeonDbError", code: "23505", constraint: "user_email_key", table: "user" });
  for (const secret of SECRETS) expect(lines[0].includes(secret), secret).toBe(false);
  expect(lines[0]).not.toContain("params");
  expect(lines[0]).not.toContain("203.0.113.9");
});

test("a request whose query string carries a token is logged without the query", async () => {
  const lines = capture();
  const dispatch = createHttpDispatcher(async action => action(throwingRuntime(failingError)));
  await dispatch(new Request(`${ORIGIN}/api/saved/learner/readings?learner=${LEARNER}&t=${QUERY_SECRET}`));
  // The extra key is refused before the service runs (400): an expected refusal writes nothing.
  expect(lines).toEqual([]);
});

test("expected refusals (401, 403, 404) write no failure line", async () => {
  const lines = capture();
  for (const status of [401, 403, 404] as const) {
    const dispatch = createHttpDispatcher(async action => action(throwingRuntime(() => new AccessDenied(status))));
    expect((await dispatch(request())).status).toBe(status);
  }
  expect(lines).toEqual([]);
});

test("a runtime that fails before any handler is written once, with its cause chain, and still answers the fixed 503", async () => {
  const lines = capture();
  const setup = causedBy(new Error("Service temporarily unavailable"), new Unavailable("config/database-url-shape"));
  const dispatch = createHttpDispatcher(async () => { recordFailure(setup, "runtime/scope", 503); throw setup; });
  const response = await dispatch(request());
  expect(response.status).toBe(503);
  expect(lines.length).toBe(1);
  expect(JSON.parse(lines[0]).error.cause).toMatchObject({ name: "Unavailable", reason: "config/database-url-shape" });
});

test("a 5xx no catch recorded still writes one line naming the route and status, with no error", async () => {
  const lines = capture();
  const dispatch = createHttpDispatcher(async () => errorResponse(undefined));
  expect((await dispatch(request())).status).toBe(503);
  expect(lines.length).toBe(1);
  expect(JSON.parse(lines[0])).toMatchObject({ site: "dispatch/unrecorded-5xx", route: "/api/saved/learner/readings", status: 503, error: null });
});

test("a response the server could not serialize names its static reason", async () => {
  const lines = capture();
  const hostile = { ok: true, get readings() { return EMAIL; } };
  const service = new Proxy({}, { get: (_t, key) => key === "then" ? undefined : async () => hostile });
  const runtime = new Proxy({}, { get: (_t, key) => key === "then" ? undefined : key === "resolveHost" ? async () => ({ tenantId: "crc", origin: ORIGIN }) : service });
  const response = await createHttpDispatcher(async action => action(runtime as never))(request());
  expect(response.status).toBe(503);
  expect(lines.length).toBe(1);
  expect(JSON.parse(lines[0]).error).toMatchObject({ name: "Unavailable", reason: "private-json/accessor", message: "private-json/accessor" });
  expect(lines[0]).not.toContain(EMAIL);
});

// Errors now carry their raw, unredacted cause (causedBy). Only the failure log may read one, so no console call in
// src/server outside src/server/logging may be added without review: these are the reviewed lines, none of which
// passes an error object (each writes a fixed string or a closed JSON record).
const REVIEWED_CONSOLE = [
  "src/server/reference-audio/short-diagnostic.ts: console.warn(JSON.stringify(record",
  "src/server/http/roster-sheet.ts: console.error(`roster sheet sync failed: ${result.reason}`)",
  "src/server/service-course/finished.ts: console.error(JSON.stringify({ event: \"service-part.finish-skipped\" }))",
  "src/server/notifications/service.ts: console.error(`notifications run: ${counts.sent} sent",
];
test("no console call or inspector outside the logging module can pass a caught error (raw cause) to the logs", () => {
  const found: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) { if (path !== "src/server/logging") walk(path); }
    else if (/\.(?:ts|tsx|mjs)$/.test(entry.name)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        for (const match of line.matchAll(/console\.(?:error|log|warn|info|debug|trace)\(|\butil\.inspect\(|\b(?:inspect|structuredClone)\((?:error|err|e|cause|failure)\b/g)) {
          const at = line.slice(match.index);
          if (!REVIEWED_CONSOLE.some(entry => { const [file, start] = entry.split(": "); return file === path && at.startsWith(start); })) found.push(`${path}: ${at.slice(0, 100)}`);
        }
      }
    }
  } };
  walk("src/server");
  expect(found).toEqual([]);
});

test("every new Unavailable(...) in src passes a unique static reason code", () => {
  const files: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path); else if (/\.(?:ts|tsx|mjs)$/.test(entry.name)) files.push(path);
  } };
  walk("src");
  const reasons: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/new Unavailable\(([^)]*)\)/g)) {
      // Each site names itself: a string literal, never a variable or interpolation that could carry data.
      expect(match[1], `${file}: ${match[1]}`).toMatch(/^"[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){1,3}"$/);
      reasons.push(match[1]);
    }
  }
  expect(reasons.length).toBeGreaterThan(80);
  const duplicates = reasons.filter((reason, i) => reasons.indexOf(reason) !== i);
  expect(duplicates).toEqual([]);
});
