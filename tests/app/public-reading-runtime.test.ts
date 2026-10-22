import { randomBytes } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/server/db/index";
import { accessFixture } from "./access-fixture";
import { loadRuntimeConfig } from "../../src/server/runtime/config";
import { composePublicRuntime, createPublicRuntimeScope } from "../../src/server/runtime/public-composition";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { AccessDenied } from "../../src/server/access/errors";
import { thisShabbat } from "../../src/lib/readings/public-shabbat";
import { syntheticResponse } from "../helpers/study";
import { syntheticCommentaryFetch } from "../helpers/commentary";

// Synthetic configuration, calendar fragment and chapter text only.
const env = () => {
  const database = new URL("postgresql://ep-synthetic.us-east-2.aws.neon.tech/synthetic");
  database.username = "synthetic_login"; database.password = randomBytes(24).toString("hex"); database.searchParams.set("sslmode", "require");
  return { PORTAL_ENVIRONMENT: "local", PORTAL_DEPLOYMENT: "synthetic-runtime", BETTER_AUTH_URL: "http://localhost:3000", "DATABASE_URL": database.href,
    "BETTER_AUTH_SECRET": randomBytes(48).toString("base64url"), "RESEND_API_KEY": `re_${randomBytes(24).toString("hex")}`, RESEND_FROM: "synthetic@example.test" };
};
const clients: { client: { close(): Promise<void> } }[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(f => f.client.close())); });
const date = thisShabbat();
function upstream() {
  return vi.fn<typeof globalThis.fetch>(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "www.hebcal.com") return new Response(JSON.stringify({ items: [{ date: url.searchParams.get("date"), name: { en: "Synthetic portion" }, type: "shabbat", parshaNum: 1,
      fullkriyah: { "1": { k: "Genesis", b: "1:1", e: "1:3", v: 3 } }, haft: { k: "Isaiah", b: "1:1", e: "1:3", v: 3 } }] }), { headers: { "content-type": "application/json" } });
    if (url.hostname === "www.sefaria.org" && decodeURIComponent(url.pathname).includes("/Rashi on ")) return syntheticCommentaryFetch()(url);
    if (url.hostname === "www.sefaria.org") return syntheticResponse(decodeURIComponent(url.pathname.split("/").at(-1)!));
    throw new Error("Unexpected synthetic upstream");
  });
}

test("as the restricted runtime role, the public runtime reads only the host map and the two global text caches, and caches upstream text", async () => {
  const f = await accessFixture(); clients.push(f);
  const statements: string[] = [];
  const db = drizzle(f.client, { schema, logger: { logQuery: query => { statements.push(query); } } });
  const config = { ...loadRuntimeConfig(env()), origin: "http://localhost:3000", deployment: { environment: "test" as const, deployment: "suite" } };
  const fetch = upstream(), runtime = composePublicRuntime(config, db, fetch, {});
  await runtime.resolveTenant(new Request(`http://localhost:3000/api/public/reading?date=${date}`));
  const week = await runtime.reading.week(date);
  expect(week).toMatchObject({ parashah: "Synthetic portion", torah: { ranges: ["Genesis 1:1-3"] }, haftarah: { ranges: ["Isaiah 1:1-3"] }, listening: { pocketTorah: false } });
  const first = await runtime.reading.text("torah", date, 0), calls = fetch.mock.calls.length;
  expect(first.verses.map(verse => verse.ref)).toEqual(["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"]);
  await runtime.reading.text("torah", date, 0); await runtime.reading.week(date);
  expect(fetch.mock.calls.length).toBe(calls); // the second visitor is served from the shared caches
  const before = statements.length, rashi = await runtime.commentary("rashi", "Genesis 1");
  expect(Object.keys(rashi.verses)).toEqual(["1", "3"]);
  expect(statements.length).toBe(before); // commentary never touches the database; the CDN keeps it
  const tables = new Set(statements.flatMap(sql => [...sql.matchAll(/\b(?:from|into|update|join)\s+"?([a-z_]+)"?/gi)].map(match => match[1].toLowerCase())
    .filter(name => name !== "set"))); // "on conflict do update set" is a cache refill, not a table
  expect([...tables].sort()).toEqual(["hebcal_cache", "sefaria_text_cache", "tenant_host"]);
  expect(statements.some(sql => /\b(?:delete|truncate|alter|grant|set_config)\b/i.test(sql))).toBe(false);
  // Another congregation's host never reaches the reading.
  await expect(runtime.resolveTenant(new Request(`http://localhost:3101/api/public/reading?date=${date}`))).rejects.toBeInstanceOf(AccessDenied);
});

test("an unconfigured or unreachable public runtime is a plain 503 without touching the session runtime", async () => {
  let sessionRuntime = 0;
  const dispatch = createHttpDispatcher(async () => { sessionRuntime++; return new Response(null, { status: 500 }); }, createPublicRuntimeScope(() => ({})));
  const response = await dispatch(new Request(`http://localhost:3000/api/public/reading?date=${date}`));
  expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(await response.json()).toEqual({ error: "unavailable" });
  expect(sessionRuntime).toBe(0);
});
