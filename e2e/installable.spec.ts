import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";
import { finishLesson } from "./learn-drill";

// The built, unconfigured production server on 127.0.0.1 (1.5 plan §6.2): the worker, the icons and the gate.
test("/sw.js is plain JavaScript revalidated on every check, and the yad icons are PNGs", async ({ request }) => {
  const worker = await request.get("/sw.js");
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toMatch(/^text\/javascript/);
  expect(worker.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
  const source = await worker.text();
  expect(source.startsWith('"use strict";\nconst POLICY = Object.freeze(')).toBe(true);
  for (const name of ["push", "notificationclick", "sync"]) expect(source.includes(`"${name}"`), name).toBe(false);
  for (const path of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/apple-touch-icon.png", "/favicon.ico"]) {
    const icon = await request.get(path);
    expect(icon.status(), path).toBe(200);
    expect(icon.headers()["content-type"], path).toBe("image/png");
    expect((await icon.body()).subarray(0, 8).toString("hex"), path).toBe("89504e470d0a1a0a");
  }
  expect((await request.get("/icon.svg")).status()).toBe(200);
});

test("off the torah origin nothing is installable: no manifest link, no touch-icon link, no worker, no hint", async ({ page }) => {
  for (const path of ["/", "/read", "/learn", "/account"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
    await expect(page.locator('link[rel="manifest"]'), path).toHaveCount(0);
    await expect(page.locator('link[rel="apple-touch-icon"]'), path).toHaveCount(0);
    await expect(page.locator("[data-install-hint]"), path).toHaveCount(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), path).toBe(0);
  }
});

test("with the loopback seam, the installed app links the manifest and registers the worker", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("crc.offline.force-installed", "1"));
  await page.goto("/read");
  await expect(page.locator('link[rel="manifest"][href="/api/public/manifest"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"][href="/apple-touch-icon.png"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL ?? null), { timeout: 30_000 }).toMatch(/\/sw\.js$/);
});

// Offline on the built server (§6.2): the service worker's own requests go through the context's routes, so every public
// answer is the Learn to lein synthetic data (invented syllables, generated tones), and "offline" aborts all of them.
const SEAM = "crc.offline.force-installed", OFFLINE_CACHE = "crc-offline-v1", INDEX = "/__crc_offline__/index";
async function installedApp(context: BrowserContext) {
  const state = { offline: false, fromWorker: [] as string[], ranges: [] as string[] };
  await context.addInitScript(key => { try { localStorage.setItem(key, "1"); } catch { /* No storage. */ } }, SEAM);
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (state.offline || url.hostname !== "127.0.0.1") return route.abort("internetdisconnected");
    if (url.pathname.startsWith("/reference-audio/") && (await route.request().allHeaders()).range) state.ranges.push(url.pathname);
    return route.continue();
  });
  await syntheticCourseRoutes().install({ addInitScript: context.addInitScript.bind(context),
    route: ((url: string, handler: (route: Route) => unknown) => context.route(url, route => state.offline ? route.abort("internetdisconnected") : handler(route))) as unknown as BrowserContext["route"] });
  context.on("response", response => { if (response.fromServiceWorker()) state.fromWorker.push(new URL(response.url()).pathname); });
  return { state, async offline(value: boolean) { state.offline = value; await context.setOffline(value); } };
}
const packs = (page: Page) => page.evaluate(async ([name, key]) => {
  if (!await caches.has(name)) return [];
  const response = await (await caches.open(name)).match(key);
  return response ? (await response.json() as { packs: { key: string; assets: string[] }[] }).packs : [];
}, [OFFLINE_CACHE, INDEX] as const);
async function saved(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect.poll(async () => (await packs(page)).map(row => row.key.split(":")[0]).sort(), { timeout: 90_000 }).toEqual(["course", "week"]);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test("offline, the installed app opens this week's reading from its shell and a verse plays; nothing private comes from the worker; after 14 days nothing is served", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one device is enough for the worker");
  test.setTimeout(240_000);
  const app = await installedApp(context);
  await page.goto("/read");
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic", exact: true })).toBeVisible();
  await saved(page);
  for (const pack of await packs(page)) expect(pack.assets.every(asset => /^\/(?:api\/public\/(?:reading|text|reference\/short)\?|reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$)/.test(asset)), pack.key).toBe(true);
  // One controlled visit, so every build file the reader loads is in the shell.
  await page.goto("/read");
  await expect(page.locator(".study-verses").getByRole("heading", { name: "Genesis 12:1", exact: true })).toBeVisible();

  await app.offline(true);
  await page.goto("/read");
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".study-verses").getByRole("heading", { name: "Genesis 12:1", exact: true })).toBeVisible();
  await expect(page.locator("[data-offline-pill]")).toHaveText(/^Offline · saved until \w{3} \d{1,2} \w{3}$/);
  const plays = () => page.evaluate(() => (window as unknown as { learnPlays: string[] }).learnPlays.length);
  const before = await plays();
  await page.locator('.study-verses [data-verse-ref="Genesis 12:1"] [data-word-index="0"]').first().click();
  await expect.poll(plays, { timeout: 20_000 }).toBeGreaterThan(before);
  expect(app.state.fromWorker).toEqual(expect.arrayContaining(["/read", "/api/public/reading", "/api/public/text"]));
  expect(app.state.fromWorker.filter(path => /^\/api\/(?!public\/(?:reading|text|reference\/short|manifest)$)/.test(path))).toEqual([]);
  expect(app.state.ranges).toEqual([]);
  expect(await page.evaluate(async () => { try { await fetch("/api/session", { credentials: "same-origin" }); return "answered"; } catch { return "failed"; } })).toBe("failed");

  // Expiry (§3.4): renewed fifteen days ago, so nothing is served and the page says how long saved readings last.
  await page.evaluate(async ([name, key]) => {
    const cache = await caches.open(name), index = await (await cache.match(key))!.json() as { packs: { renewedAt: number; expiresAt: number }[] };
    const then = Date.now() - 15 * 86_400_000;
    for (const row of index.packs) { row.renewedAt = then; row.expiresAt = then + 14 * 86_400_000; }
    await cache.put(key, new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
  }, [OFFLINE_CACHE, INDEX] as const);
  app.state.fromWorker.length = 0;
  await page.goto("/read");
  await expect(page.getByRole("heading", { name: "The reading didn’t load", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-offline-expiry]")).toContainText("Saved readings stay on this device for 14 days after you last opened CRC Torah online.");
  expect(app.state.fromWorker.filter(path => path.startsWith("/reference-audio/") || /^\/api\/public\/(?:reading|text|reference)/.test(path))).toEqual([]);
});

test("offline, a Learn to lein lesson opens from the shell and can be finished; the progress is kept on the device", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one device is enough for the worker");
  test.setTimeout(240_000);
  const app = await installedApp(context);
  await saved(page);
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 30_000 });
  await app.offline(true);
  await page.goto("/learn/torah-sof-pasuk");
  await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 30_000 });
  await finishLesson(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1") ?? "{}") as { lessons?: Record<string, unknown> });
  expect(Object.keys(stored.lessons ?? {})).toContain("torah-sof-pasuk");
});
