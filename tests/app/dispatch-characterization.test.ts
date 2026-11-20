import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync, writeFileSync } from "node:fs";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { portalRoutesFixture } from "./portal-routes-fixture";

/**
 * Characterization of the request path (2026-11-17, route-table refactor): a fixed table of requests covering every
 * route module the dispatcher owns, recorded as status, Allow, cache-control, content-type, location and whether a body
 * came back. The fixture (tests/fixtures/portal, where the repository policy allows data files) was generated from the dispatcher before the refactor and must stay
 * byte-identical through it. Regenerate only on purpose: UPDATE_DISPATCH_CHARACTERIZATION=1.
 *
 * Every route module gets, per path: each method it declares (signed in, with an empty JSON object for a POST), a wrong
 * method, HEAD and OPTIONS, a signed-out call, a trailing slash, a near miss and an unexpected query.
 */
const FIXTURE = new URL("../fixtures/portal/dispatch-characterization.json", import.meta.url);
const S = "{student}", L = "{link}", U = "00000000-0000-4000-8000-000000000000";

// [path, declared methods]; {student} is the fixture's first student and {link} a well-formed unknown id.
const owned: [string, string[]][] = [
  // booklet
  [`/api/students/${S}/booklet`, ["GET"]],
  // service-ecosystem, including its internal cron path
  ["/api/internal/service-ecosystem/drain", ["GET"]],
  [`/api/students/${S}/my-service`, ["GET"]],
  ...["synchronize", "assign", "progress", "request", "respond", "resource", "material", "separate", "resolve-original"].map((op): [string, string[]] => [`/api/students/${S}/my-service/${op}`, ["POST"]]),
  // honors
  [`/api/students/${S}/honors`, ["GET", "POST"]], [`/api/students/${S}/honors/receipt`, ["POST"]],
  // source content and source assignments
  [`/api/students/${S}/source-editions`, ["GET"]], [`/api/students/${S}/source-text`, ["GET"]],
  [`/api/students/${S}/source-assignments`, ["GET", "POST"]], [`/api/students/${S}/source-assignments/receipt`, ["POST"]],
  // auth (sign-out is driven last, below, so it does not end the session the other rows use)
  ...["/api/auth/sign-in/magic-link", "/api/auth/sign-in/social", "/api/auth/email/confirm", "/api/auth/google/challenge", "/api/invitations/open",
    "/api/auth/google/redirect", "/api/auth/sign-in/code"].map((path): [string, string[]] => [path, ["POST"]]),
  ["/api/auth/callback/google", ["GET"]],
  // portal: exact paths
  ["/api/session", ["GET"]], ["/api/session/begin", ["POST"]], ["/api/session/door", ["GET"]], ["/api/students", ["GET"]],
  ["/api/practice/read", ["GET"]], ["/api/practice/enter", ["POST"]], ["/api/practice/switch", ["POST"]], ["/api/practice/exit", ["POST"]],
  ["/api/admin/students", ["GET", "POST"]], ["/api/admin/tutors", ["GET"]], ["/api/admin/invitations", ["GET", "POST"]],
  ["/api/admin/invitations/needed", ["GET"]], ["/api/invitations/pending", ["GET"]], ["/api/invitations/accept", ["POST"]],
  // portal: patterns
  [`/api/students/${S}/reading/explore/reference/short/page`, ["POST"]], [`/api/students/${S}/reading/explore/prepare`, ["POST"]], [`/api/students/${S}/reading/explore/page`, ["POST"]],
  [`/api/students/${S}/reading/preview/prepare`, ["POST"]], [`/api/students/${S}/reading/preview/page`, ["POST"]],
  [`/api/students/${S}/reference-audio`, ["GET"]], [`/api/students/${S}/reference-audio/short/page`, ["GET"]],
  [`/api/students/${S}/study-word-aids`, ["GET"]], [`/api/students/${S}/study-sources`, ["GET"]], [`/api/students/${S}/study-word-details`, ["GET"]], [`/api/students/${S}/study-text`, ["GET"]],
  [`/api/students/${S}`, ["GET"]], [`/api/students/${S}/reading`, ["GET"]], [`/api/students/${S}/reading/prepare`, ["POST"]], [`/api/students/${S}/reading/confirm`, ["POST"]],
  [`/api/admin/students/${S}/relationships`, ["GET"]], [`/api/admin/students/${S}/relationships/tutors`, ["POST"]],
  [`/api/admin/students/${S}/relationships/tutors/${L}/revoke`, ["POST"]], [`/api/admin/students/${S}/relationships/guardians/${L}/revoke`, ["POST"]],
  [`/api/admin/students/${S}/relationships/identities/${L}/revoke`, ["POST"]], [`/api/admin/students/${S}/relationships/guardians/${L}/practice`, ["POST"]],
  [`/api/admin/grants/${L}/revoke`, ["POST"]], [`/api/admin/tutors/${L}/cantor`, ["POST"]],
  ...["edit", "disable", "ceremony-done", "ceremony-reverse"].map((op): [string, string[]] => [`/api/admin/students/${S}/${op}`, ["POST"]]),
  ...["reissue", "revoke", "copy"].map((op): [string, string[]] => [`/api/admin/invitations/${L}/${op}`, ["POST"]]),
  // student work
  [`/api/students/${S}/work`, ["GET"]], [`/api/students/${S}/work/history`, ["GET"]], [`/api/students/${S}/work/receipt`, ["GET"]],
  [`/api/students/${S}/work/recovery`, ["POST"]], [`/api/students/${S}/work/note`, ["POST"]],
  // service learning
  [`/api/students/${S}/service-plan`, ["GET"]], ...["catalog", "prepare", "confirm", "unit"].map((op): [string, string[]] => [`/api/students/${S}/service-plan/${op}`, ["POST"]]),
  // progress
  [`/api/students/${S}/progress`, ["GET"]], [`/api/students/${S}/progress/self-check`, ["POST"]], [`/api/students/${S}/progress/assessment`, ["POST"]],
  // study guides
  [`/api/students/${S}/study-guide`, ["GET"]], ["/api/admin/study-guides/torah/bereshit", ["GET"]], ["/api/admin/study-guides/haftarah/bereshit", ["GET"]], ["/api/admin/study-voice", ["GET"]],
  // guide share and guide admin
  ["/api/admin/guide-share/export", ["GET"]], ["/api/admin/guide-share/preview", ["POST"]], ["/api/admin/guide-share/import", ["POST"]],
  ["/api/admin/guides", ["GET"]], ["/api/admin/guides/text", ["GET"]], ["/api/admin/guides/discussions/withdraw", ["POST"]],
  ["/api/admin/guides/summaries/approve", ["POST"]], ["/api/admin/guides/summaries/withdraw", ["POST"]],
  // congregation settings, Claude connections, notifications (with its internal cron path)
  ["/api/admin/congregation-settings", ["GET", "POST"]], ["/api/congregation/links", ["GET"]],
  ["/api/staff/claude-connections", ["GET"]], ["/api/staff/claude-connections/revoke", ["POST"]], ["/api/admin/maven-link", ["GET"]], ["/api/admin/maven-link/unlink", ["POST"]],
  ["/api/notifications/preferences", ["GET", "POST"]], ["/api/notifications/unsubscribe", ["GET", "POST"]], ["/api/internal/notifications/run", ["GET"]],
  // saved
  ...["/api/saved/readings", "/api/saved/reading", "/api/saved/stars", "/api/saved/preferences", "/api/saved/learner/readings", "/api/saved/learner/reading", "/api/saved/learner/page"].map((path): [string, string[]] => [path, ["GET"]]),
  ...["/api/saved/readings/create", "/api/saved/readings/update", "/api/saved/readings/remove", "/api/saved/work", "/api/saved/mark", "/api/saved/star", "/api/saved/preferences/put"].map((path): [string, string[]] => [path, ["POST"]]),
  // learners, offline
  ["/api/learners", ["GET"]], ["/api/learners/claim", ["POST"]], ["/api/learners/unclaim", ["POST"]], ["/api/mine/tutor", ["GET"]], ["/api/mine/tutor/remove", ["POST"]],
  ["/api/offline/packs", ["GET"]],
  // accounts
  ["/api/account/request", ["GET", "POST"]],
  ...["/api/accounts/summary", "/api/accounts/requests", "/api/accounts/members", "/api/accounts/people", "/api/accounts/approvers"].map((path): [string, string[]] => [path, ["GET"]]),
  ...["/api/accounts/requests/approve", "/api/accounts/requests/decline", "/api/accounts/members/end", "/api/accounts/people/make-tutor", "/api/accounts/people/remove-tutor",
    "/api/accounts/approvers/add", "/api/accounts/approvers/remove"].map((path): [string, string[]] => [path, ["POST"]]),
  // course progress, service course, finished parts, practice visibility
  ["/api/learn/progress", ["GET"]], ["/api/learn/progress/put", ["POST"]], ["/api/learn/progress/merge", ["POST"]],
  ["/api/learn/service/progress", ["GET"]], ["/api/learn/service/progress/put", ["POST"]], ["/api/learn/service/progress/merge", ["POST"]], ["/api/learn/service/path", ["GET"]],
  [`/api/students/${S}/service-finished`, ["GET"]], [`/api/students/${S}/practice-visibility`, ["GET"]],
  // Private optional profile and tutor-spoken aliyah routes (2026-11-20).
  ["/api/profile/pronouns", ["GET", "POST"]],
  [`/api/students/${S}/tutor-spoken`, ["GET", "POST", "DELETE"]],
  [`/api/students/${S}/tutor-spoken/audio`, ["GET"]],
  // staff
  ["/api/admin/student-status", ["GET"]], ["/api/admin/tutor-students", ["GET"]], [`/api/admin/tutors/${L}/hand-over`, ["POST"]],
  [`/api/students/${S}/family`, ["GET"]], [`/api/students/${S}/reading/reconfirm`, ["POST"]],
  // verse review
  ["/api/learn/verses", ["GET"]], ["/api/learn/verses/put", ["POST"]],
  // MCP and OAuth (disabled in this runtime: every method reaches the handler)
  ["/api/mcp", ["POST"]], ["/.well-known/oauth-protected-resource", ["GET"]], ["/.well-known/oauth-protected-resource/api/mcp", ["GET"]],
  ["/.well-known/oauth-authorization-server", ["GET"]], ["/.well-known/oauth-authorization-server/api/mcp", ["GET"]],
  ["/api/oauth/register", ["POST"]], ["/api/oauth/authorize", ["GET"]], ["/api/oauth/token", ["POST"]], ["/api/oauth/revoke", ["POST"]],
  ["/api/oauth/consent/view", ["POST"]], ["/api/oauth/consent/approve", ["POST"]], ["/api/oauth/consent/deny", ["POST"]],
  // lesson log, practice calendar
  [`/api/students/${S}/lesson-log`, ["GET", "POST"]], [`/api/students/${S}/lesson-log/${L}/edit`, ["POST"]], [`/api/students/${S}/lesson-log/${L}/delete`, ["POST"]],
  [`/api/students/${S}/practice-calendar`, ["GET"]], [`/api/students/${S}/practice-events`, ["GET", "POST"]],
  // honoree management (UUID student only) and the guest read
  [`/api/students/${S}/honoree-links`, ["POST"]], [`/api/students/${S}/honoree-links/receipt`, ["POST"]], [`/api/students/${S}/honoree-links/status`, ["POST"]],
  ["/api/honoree/read", ["POST"]],
  // public reading and the page-view beacon (their own runtimes, stubbed here)
  ["/api/public/reading?date=2026-11-21", ["GET"]], ["/api/public/manifest", ["GET"]], ["/api/public", ["GET"]], ["/api/public/unknown", ["GET"]],
];
// Paths no module owns, or that a module owns only partly.
const unowned = ["/api", "/api/", "/api/nope", "/api/auth/get-session", "/api/auth/session", "/api/admin/roster-sheet/sync", "/api/admin/students/import/confirm",
  `/api/students/${S}/study-guide/theme-read`, `/api/admin/students/${S}/relationships/tutors/${L}/practice`, `/api/admin/grants/${L}/cantor`, `/api/admin/tutors/${L}/revoke`,
  `/api/students/not-a-uuid/honoree-links`, "/api/admin/study-guides/other/bereshit", "/api/internal/other", "/api/students/a/b/c/d/e/f"];

type Row = { request: string; status: number; allow: string | null; cacheControl: string | null; contentType: string | null; location: string | null; body: boolean };
const WRONG = ["GET", "POST", "PUT", "PATCH", "DELETE"];

test("characterization: every route module answers exactly as recorded", { timeout: 600_000 }, async () => {
  const f = await portalRoutesFixture();
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("No network in characterization"); });
  try {
    const dispatch = createHttpDispatcher(async action => action(f.runtime),
      async () => { throw new Error("Synthetic public runtime unavailable"); }, async () => { throw new Error("Synthetic page-view runtime unavailable"); });
    const student = f.students[0].id;
    const concrete = (path: string) => path.replaceAll(S, student).replaceAll(L, U);
    const normalise = (value: string | null) => value === null ? null : value.replaceAll(student, S).replaceAll(U, L)
      .replace(/([?&#][^=&#]+)=[^&#]*/g, "$1=…");
    const rows: Row[] = [];
    const drive = async (label: string, path: string, options: { who?: "multi" | "anonymous"; method: string; body?: unknown }) => {
      const response = await dispatch(f.request(concrete(path), { who: options.who ?? "multi", method: options.method, body: options.body }));
      const text = await response.text();
      rows.push({ request: `${options.method} ${path}${label}`, status: response.status, allow: response.headers.get("allow"), cacheControl: response.headers.get("cache-control"),
        contentType: response.headers.get("content-type"), location: normalise(response.headers.get("location")), body: text.length > 0 });
    };
    const bodyFor = (method: string) => method === "POST" ? {} : undefined;
    for (const [path, declared] of owned) {
      for (const method of declared) {
        await drive("", path, { method, body: bodyFor(method) });
        await drive(" (signed out)", path, { who: "anonymous", method, body: bodyFor(method) });
      }
      const wrong = WRONG.find(method => !declared.includes(method))!;
      await drive(" (wrong method)", path, { method: wrong, body: bodyFor(wrong) });
      await drive("", path, { method: "HEAD" });
      await drive("", path, { method: "OPTIONS" });
      const [bare, search] = path.split("?");
      await drive(" (trailing slash)", `${bare}/${search ? `?${search}` : ""}`, { method: declared[0], body: bodyFor(declared[0]) });
      await drive(" (near miss)", `${bare}x${search ? `?${search}` : ""}`, { method: declared[0], body: bodyFor(declared[0]) });
      await drive(" (unexpected query)", `${path}${search ? "&" : "?"}unexpected=1`, { method: declared[0], body: bodyFor(declared[0]) });
    }
    for (const path of unowned) for (const method of ["GET", "POST"]) await drive("", path, { method, body: bodyFor(method) });
    // Last: signing out ends the session every row above used.
    await drive(" (signed out)", "/api/auth/sign-out", { who: "anonymous", method: "POST", body: {} });
    await drive(" (wrong method)", "/api/auth/sign-out", { method: "GET" });
    await drive("", "/api/auth/sign-out", { method: "POST", body: {} });
    const json = `${JSON.stringify(rows, null, 1)}\n`;
    if (process.env.UPDATE_DISPATCH_CHARACTERIZATION === "1") writeFileSync(FIXTURE, json);
    expect(json).toBe(readFileSync(FIXTURE, "utf8"));
  } finally { network.mockRestore(); await f.client.close(); }
});
