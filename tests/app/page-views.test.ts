import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/server/db/index";
import { accessFixture } from "./access-fixture";
import { closeMcpFixtures, mcpFixture } from "./mcp-fixture";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { composePageViewRuntime } from "../../src/server/runtime/public-composition";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { handlePageViewRequest, type PageViewRuntime } from "../../src/server/http/page-views";
import { normalizePublicPagePath, publicPageViewPaths, READ_ANY_PATH } from "../../src/lib/site/page-views";
import { PAGE_VIEW_ROUTE } from "../../src/lib/site/page-view-route";
import { NAMED_READINGS } from "../../src/lib/readings/named-readings";
import { COURSE } from "../../src/lib/learn/course";

// The public page-view counter (release 1.5, cookieless analytics; Daniel: "path and day only"). Synthetic data only.
const ORIGIN = "http://localhost:3000";
const clients: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(f => f.client.close())); await closeMcpFixtures(); });

describe("which page a beacon names", () => {
  it("keeps one allow-listed path and nothing of the query but a catalog slug", () => {
    const cases: [unknown, string | null][] = [
      ["/read", "/read"], ["/read?date=2026-10-24", "/read"], ["/read?date=2026-10-24&kind=haftarah&verse=3&lens=study", "/read"], ["/read?anything=else", "/read"],
      ["/read?reading=noach", "/read/noach"], ["/read?reading=noach&passage=2&verse=4", "/read/noach"], ["/read?reading=vayakhel-pekudei", "/read/vayakhel-pekudei"],
      ["/read?ref=Genesis%206%3A9-11%3A32&kind=torah", READ_ANY_PATH],
      ["/learn", "/learn"], ["/learn/about", "/learn/about"], ["/learn/review", "/learn/review"], ["/learn/torah-zakef-gadol", "/learn/torah-zakef-gadol"], ["/learn/intro-phrases?x=1", "/learn/intro-phrases"],
      ["/trope-chart", "/trope-chart"],
      // A member's own saved reading is personal: never counted. Unknown slugs, refs, lessons and pages are dropped.
      ["/read?saved=0b4f6f2e-8f0e-4f53-9a0e-2a7c9d1e5b6f", null], ["/read?saved=x", null], ["/read?reading=not-a-reading", null], ["/read?reading=noach&passage=99", null],
      ["/read?ref=Nowhere%201%3A1&kind=torah", null], ["/read?ref=Genesis%201%3A1&kind=x", null], ["/learn/not-a-lesson", null], ["/learn/constructor", null], ["/learn/__proto__", null],
      ["/", null], ["/workspace", null], ["/workspace/admin/students", null], ["/sign-in", null], ["/api/public/reading", null], ["/read/", null], ["/Read", null], ["/read/noach", null],
      ["/trope-chart/", null], ["/learn/about/x", null], ["//evil.example/read", null], ["https://evil.example/read", null], ["read", null], ["/read#x", null], ["/re%61d", null],
      ["/read\\x", null], ["/read x", null], ["/read\n", null], ["/read?" + "a".repeat(600), null], ["", null], [null, null], [42, null], [["/read"], null], [{ page: "/read" }, null],
    ];
    for (const [location, path] of cases) expect(normalizePublicPagePath(location), JSON.stringify(location)).toBe(path);
  });

  it("is a fixed list from the code, each path within the table's own check, so no request can add a path", () => {
    const paths = publicPageViewPaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.length).toBe(6 + NAMED_READINGS.length + COURSE.lessons.length);
    expect(paths.length).toBeLessThan(200);
    // "any" is the Any-reading bucket, never a reading; "about" and "review" are pages, never lessons.
    expect(NAMED_READINGS.some(r => r.slug === "any")).toBe(false);
    expect(COURSE.lessons.some(l => l.id === "about" || l.id === "review")).toBe(false);
    for (const path of paths) {
      expect(path).toMatch(/^(\/[a-z0-9]+(-[a-z0-9]+)*)+$/); expect(path.length).toBeGreaterThanOrEqual(2); expect(path.length).toBeLessThanOrEqual(96);
      // Every stored path is a fixed point: it is what one real address normalizes to.
    }
    for (const reading of NAMED_READINGS) expect(normalizePublicPagePath(`/read?reading=${reading.slug}`)).toBe(`/read/${reading.slug}`);
    for (const lesson of COURSE.lessons) expect(normalizePublicPagePath(`/learn/${lesson.id}`)).toBe(`/learn/${lesson.id}`);
  });
});

type Call = { path: string; day: string; resolved: boolean };
function fakeViews(fail: "none" | "tenant" | "write" | "scope" = "none") {
  const calls: Call[] = [];
  const scope = async (action: (runtime: PageViewRuntime) => Promise<Response>) => {
    if (fail === "scope") throw new Error("runtime unavailable: synthetic");
    let resolved = false;
    return action({
      async resolveTenant() { if (fail === "tenant") throw new Error("synthetic host refused"); resolved = true; },
      async countPageView(path, day) { if (fail === "write") throw new Error("synthetic write failure"); calls.push({ path, day, resolved }); },
    });
  };
  const signedIn = vi.fn(async () => new Response(null, { status: 599 })), reading = vi.fn(async () => new Response(null, { status: 599 }));
  return { calls, signedIn, reading, dispatch: createHttpDispatcher(signedIn, reading, scope) };
}
const beacon = (body: unknown, init: { headers?: Record<string, string>; method?: string; url?: string; raw?: string } = {}) => new Request(init.url ?? `${ORIGIN}${PAGE_VIEW_ROUTE}`, {
  method: init.method ?? "POST", body: init.method === "GET" || init.method === "HEAD" ? undefined : init.raw ?? JSON.stringify(body),
  headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin", ...init.headers } });
async function expectQuiet(response: Response) {
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
}

describe("the beacon route", () => {
  it("adds one view of the normalized path for today's UTC day, on the counter's own runtime, never the signed-in or reading one", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T23:59:30-05:00"));
    try {
      const t = fakeViews();
      await expectQuiet(await t.dispatch(beacon({ page: "/read?reading=noach&verse=2" })));
      // Without Sec-Fetch-Site (older browsers) the Origin check alone admits it; an empty one is not same-origin.
      const bare = beacon({ page: "/learn/torah-etnachta" }); bare.headers.delete("sec-fetch-site");
      await expectQuiet(await t.dispatch(bare));
      await expectQuiet(await t.dispatch(beacon({ page: "/learn" }, { headers: { "sec-fetch-site": "" } })));
      expect(t.calls).toEqual([{ path: "/read/noach", day: "2026-10-25", resolved: true }, { path: "/learn/torah-etnachta", day: "2026-10-25", resolved: true }]);
      expect(t.signedIn).not.toHaveBeenCalled(); expect(t.reading).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("answers the same empty 204 to everything and counts only an allow-listed, same-origin, cookie-free POST", async () => {
    const t = fakeViews();
    const refused: Request[] = [
      beacon({ page: "/read" }, { method: "GET" }), beacon({ page: "/read" }, { method: "PUT" }), beacon({ page: "/read" }, { method: "HEAD" }),
      beacon({ page: "/read" }, { url: `${ORIGIN}${PAGE_VIEW_ROUTE}?page=/read` }),
      beacon({ page: "/read" }, { headers: { origin: "https://evil.example" } }), beacon({ page: "/read" }, { headers: { origin: "null" } }),
      beacon({ page: "/read" }, { headers: { "sec-fetch-site": "cross-site" } }), beacon({ page: "/read" }, { headers: { "sec-fetch-site": "same-site" } }),
      beacon({ page: "/read" }, { headers: { cookie: "a=b" } }), beacon({ page: "/read" }, { headers: { authorization: "Bearer synthetic" } }),
      beacon({ page: "/read" }, { headers: { "content-type": "text/plain" } }), beacon({ page: "/read" }, { headers: { "content-encoding": "gzip" } }),
      beacon(null, { raw: "{" }), beacon(null, { raw: "" }), beacon(["/read"]), beacon("/read"), beacon({}), beacon({ page: "/read", ip: "192.0.2.1" }),
      beacon({ page: "/read", pad: "x".repeat(2000) }), beacon({ page: "/" + "a".repeat(1100) }),
      beacon({ page: "/workspace" }), beacon({ page: "/read?saved=0b4f6f2e-8f0e-4f53-9a0e-2a7c9d1e5b6f" }), beacon({ page: "/read?reading=made-up" }), beacon({ page: "/learn/made-up" }),
    ];
    const withoutOrigin = new Request(`${ORIGIN}${PAGE_VIEW_ROUTE}`, { method: "POST", body: JSON.stringify({ page: "/read" }), headers: { "content-type": "application/json" } });
    for (const request of [...refused, withoutOrigin]) await expectQuiet(await t.dispatch(request));
    expect(t.calls).toEqual([]);
    // Failures anywhere after the checks look exactly the same and leave nothing behind.
    for (const fail of ["tenant", "write", "scope"] as const) {
      const broken = fakeViews(fail);
      await expectQuiet(await broken.dispatch(beacon({ page: "/read" })));
      expect(broken.calls).toEqual([]);
    }
    const ok = fakeViews();
    await expectQuiet(await ok.dispatch(beacon({ page: "/trope-chart" })));
    expect(ok.calls.map(c => c.path)).toEqual(["/trope-chart"]);
  });

  it("sends the 204 before the database is touched: the count runs after the response", async () => {
    const calls: string[] = [], tasks: (() => Promise<void>)[] = [];
    const scope = async (action: (runtime: PageViewRuntime) => Promise<Response>) => { calls.push("scope"); return action({ async resolveTenant() { calls.push("host"); }, async countPageView(path) { calls.push(path); } }); };
    const response = await handlePageViewRequest(beacon({ page: "/learn" }), scope, () => new Date(), async task => { tasks.push(task); });
    await expectQuiet(response);
    expect(calls).toEqual([]);
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(calls).toEqual(["scope", "host", "/learn"]);
    // A refused request schedules nothing at all.
    await expectQuiet(await handlePageViewRequest(beacon({ page: "/workspace" }), scope, () => new Date(), async task => { tasks.push(task); }));
    expect(tasks).toHaveLength(1);
  });

  it("logs nothing at all, whatever it is sent", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(name => vi.spyOn(console, name).mockImplementation(() => undefined));
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true), err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      for (const fail of ["none", "tenant", "write", "scope"] as const) {
        const t = fakeViews(fail);
        await t.dispatch(beacon({ page: "/read?reading=noach" })); await t.dispatch(beacon({ page: "/read?saved=0b4f6f2e-8f0e-4f53-9a0e-2a7c9d1e5b6f" })); await t.dispatch(beacon(null, { raw: "{" }));
      }
      for (const spy of [...spies, out, err]) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of [...spies, out, err]) spy.mockRestore(); }
  });
});

const env = () => {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-runtime", BETTER_AUTH_URL: ORIGIN, "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
};

describe("the counter's runtime, as the restricted runtime role", () => {
  it("resolves the host, upserts into public_page_view_day alone, counts up, and counts nothing for another congregation's host", async () => {
    const f = await accessFixture(); clients.push(f);
    const statements: string[] = [];
    const db = drizzle(f.client, { schema, logger: { logQuery: query => { statements.push(query); } } });
    const config = { ...loadRuntimeConfig(env()), origin: ORIGIN, deployment: { environment: "test" as const, deployment: "suite" } };
    const runtime = composePageViewRuntime(config, db);
    const dispatch = createHttpDispatcher(async () => new Response(null, { status: 599 }), async () => new Response(null, { status: 599 }), async action => action(runtime));
    for (const page of ["/read", "/read?date=2026-10-31", "/read?reading=noach", "/learn"]) await expectQuiet(await dispatch(beacon({ page })));
    // Another congregation's host, and an unknown one, are refused by the host check: nothing is counted for anyone.
    await expectQuiet(await dispatch(beacon({ page: "/read" }, { url: `http://localhost:3101${PAGE_VIEW_ROUTE}`, headers: { origin: "http://localhost:3101" } })));
    await expectQuiet(await dispatch(beacon({ page: "/read" }, { url: `http://localhost:3999${PAGE_VIEW_ROUTE}`, headers: { origin: "http://localhost:3999" } })));
    const rows = await f.owner(async () => (await f.client.query<{ tenant_id: string; path: string; views: number }>("select tenant_id, path, views from public_page_view_day order by path")).rows);
    expect(rows).toEqual([{ tenant_id: "crc", path: "/learn", views: 1 }, { tenant_id: "crc", path: "/read", views: 2 }, { tenant_id: "crc", path: "/read/noach", views: 1 }]);
    const tables = new Set(statements.flatMap(text => [...text.matchAll(/\b(?:from|into|update|join)\s+"?([a-z_]+)"?/gi)].map(m => m[1].toLowerCase())).filter(name => name !== "set" && name !== "pg_catalog"));
    expect([...tables].sort()).toEqual(["public_page_view_day", "tenant_host"]);
    expect(statements.some(text => /\b(?:delete|truncate|alter|grant)\b/i.test(text))).toBe(false);
    // The values the counter writes are the congregation, the day, the path and 1; nothing from the request.
    expect(statements.join("\n")).not.toMatch(/user[-_ ]agent|referer|x-forwarded-for|cookie/i);
  });
});

describe("get_page_views through the portal MCP", () => {
  async function seeded() {
    const t = await mcpFixture();
    await t.f.owner(async () => {
      await t.f.client.query(`insert into public_page_view_day(tenant_id, day, path, views) values
        ('crc','2026-10-20','/read',3), ('crc','2026-10-21','/read',4), ('crc','2026-10-21','/read/noach',2), ('crc','2026-10-21','/learn',1), ('crc','2026-12-31','/read',9),
        ('other','2026-10-21','/read',500), ('other','2026-10-21','/trope-chart',7)`);
    });
    return t;
  }
  it("gives an admin their own congregation's counts per path per day over a range, and never another congregation's", async () => {
    const t = await seeded();
    await t.google("admin");
    const admin = (await t.connect("admin")).access_token as string;
    const tools = (await t.rpc(admin, "tools/list")).body.result.tools as { name: string; annotations: Record<string, boolean> }[];
    expect(tools.find(x => x.name === "get_page_views")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const answer = (await t.call(admin, "get_page_views", { start: "2026-10-20", end: "2026-10-21" })).json();
    expect(answer).toEqual({ ok: true, start: "2026-10-20", end: "2026-10-21", truncated: false,
      rows: [{ day: "2026-10-20", path: "/read", views: 3 }, { day: "2026-10-21", path: "/learn", views: 1 }, { day: "2026-10-21", path: "/read", views: 4 }, { day: "2026-10-21", path: "/read/noach", views: 2 }],
      totals: [{ path: "/read", views: 7 }, { path: "/read/noach", views: 2 }, { path: "/learn", views: 1 }] });
    expect(JSON.stringify(answer)).not.toMatch(/500|trope-chart|other/);
    expect((await t.call(admin, "get_page_views", { start: "2026-12-01", end: "2026-12-31" })).json().rows).toEqual([{ day: "2026-12-31", path: "/read", views: 9 }]);
    // A read-only consent is enough; it is still the caller's congregation alone.
    const readOnly = (await t.connect("admin", { scope: "portal:read" })).access_token as string;
    expect((await t.call(readOnly, "get_page_views", { start: "2026-10-21", end: "2026-10-21" })).json().totals).toEqual([{ path: "/read", views: 4 }, { path: "/read/noach", views: 2 }, { path: "/learn", views: 1 }]);
  });

  it("refuses bad ranges plainly and takes no other argument", async () => {
    const t = await seeded();
    await t.google("admin");
    const admin = (await t.connect("admin")).access_token as string;
    for (const [args, hint] of [[{ start: "2026-02-30", end: "2026-03-01" }, /real dates/], [{ start: "2026-10-21", end: "2026-10-20" }, /on or after/], [{ start: "2026-01-01", end: "2026-04-03" }, /at most 92 days/]] as const)
      expect((await t.call(admin, "get_page_views", args)).json()).toMatchObject({ ok: false, code: "invalid", hint: expect.stringMatching(hint) });
    expect((await t.call(admin, "get_page_views", { start: "2026-01-01", end: "2026-04-02" })).json()).toMatchObject({ ok: true });
    for (const args of [{ start: "2026-10-21" }, { start: "10/21/2026", end: "2026-10-21" }, { start: "2026-10-21", end: "2026-10-21", tenant: "other" }, { start: "2026-10-21", end: "2026-10-21", tenantId: "other" }])
      expect((await t.call(admin, "get_page_views", args)).isError, JSON.stringify(args)).toBe(true);
  });

  it("is for admins only: a tutor's connection neither lists nor reaches it", async () => {
    const t = await seeded();
    await t.google("multi");
    const tutor = (await t.connect("multi")).access_token as string;
    expect((await t.rpc(tutor, "tools/list")).body.result.tools.map((x: { name: string }) => x.name).sort()).toEqual(["get_student", "list_students", "print_sheet_link", "study_link"]);
    expect((await t.rpc(tutor, "tools/call", { name: "get_page_views", arguments: { start: "2026-10-20", end: "2026-10-21" } })).body.error.code).toBe(-32602);
  });
});

describe("where the beacon is mounted", () => {
  async function files(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await files(path)); else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) out.push(path.replaceAll("\\", "/"));
    }
    return out;
  }
  it("only the public layouts (/read, /learn and its pages, /trope-chart) mount it; the workspace, root, sign-in and every other page never do", async () => {
    const all = [...await files("src/app"), ...await files("src/components")];
    const using: string[] = [];
    for (const file of all) if (/PageViewBeacon|page-view-beacon/.test(await readFile(file, "utf8"))) using.push(file);
    expect(using.sort()).toEqual(["src/app/learn/layout.tsx", "src/app/read/layout.tsx", "src/app/trope-chart/layout.tsx", "src/components/site/page-view-beacon.tsx"]);
    for (const layout of ["src/app/read/layout.tsx", "src/app/learn/layout.tsx", "src/app/trope-chart/layout.tsx"])
      expect(await readFile(layout, "utf8")).toMatch(/<PageViewBeacon \/>/);
    // Every page those layouts wrap is one of the public pages; a signed-in page added under them must be placed elsewhere.
    expect(all.filter(f => /^src\/app\/(read|learn|trope-chart)\//.test(f) && /\/page\.tsx$/.test(f)).sort()).toEqual([
      "src/app/learn/[lesson]/page.tsx", "src/app/learn/about/page.tsx", "src/app/learn/page.tsx", "src/app/learn/review/page.tsx", "src/app/read/page.tsx", "src/app/trope-chart/page.tsx"]);
    // Nothing under the signed-in workspace, the account page, sign-in, connect or the root layout imports it.
    for (const file of all.filter(f => /^src\/app\/(workspace|account|sign-in|connect|invitations|unsubscribe|offline)\//.test(f) || f === "src/app/layout.tsx" || f === "src/app/page.tsx"))
      expect(await readFile(file, "utf8"), file).not.toMatch(/PageViewBeacon|page-view-beacon|api\/public\/view/);
  });
  it("sends no cookie, no referrer and keeps nothing on the device", async () => {
    const source = await readFile("src/components/site/page-view-beacon.tsx", "utf8");
    expect(source).toContain(`credentials: "omit"`); expect(source).toContain(`referrerPolicy: "no-referrer"`);
    expect(source).toContain(`if (params.has("saved")) return;`);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|navigator\.sendBeacon|userAgent/);
  });
});
