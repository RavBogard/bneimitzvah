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
  for (const pack of await packs(page)) expect(pack.assets.every(asset => /^\/(?:api\/public\/(?:reading|text|reference\/short|aliyot|portion-summary)\?|reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$)/.test(asset)), pack.key).toBe(true);
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
  expect(app.state.fromWorker.filter(path => /^\/api\/(?!public\/(?:reading|text|reference\/short|manifest|aliyot|portion-summary)$)/.test(path))).toEqual([]);
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
  expect(app.state.fromWorker.filter(path => path.startsWith("/reference-audio/") || /^\/api\/public\/(?:reading|text|reference|aliyot|portion-summary)/.test(path))).toEqual([]);
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

test("offline, the 1.6 activities run from the course pack: look-alikes and which-half lessons finish and Quick ten opens", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one device is enough for the worker");
  test.setTimeout(240_000);
  const app = await installedApp(context);
  await saved(page);
  // The look-alike verses (some in no lesson's examples) travel in the course pack's fixed passages.
  const course = (await packs(page)).find(row => row.key === "course")!;
  const texts = course.assets.filter(asset => asset.startsWith("/api/public/text?")).map(asset => new URL(asset, "http://x").searchParams.get("ref") ?? "").join("; ");
  for (const ref of ["Deuteronomy 30:13", "Deuteronomy 6:10", "Genesis 1:29", "Isaiah 60:17", "I Kings 19:8", "Isaiah 54:11"]) expect(texts.split("; "), ref).toContain(ref);
  for (const id of ["torah-azla", "haftarah-zakef"]) {
    await app.offline(false);
    await page.goto(`/learn/${id}`);
    await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 30_000 });
    await app.offline(true);
    await page.goto(`/learn/${id}`);
    await expect(page.locator("main[data-step=hear]")).toBeVisible({ timeout: 30_000 });
    await finishLesson(page);
  }
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1") ?? "{}") as { lessons?: Record<string, unknown> });
  expect(Object.keys(stored.lessons ?? {})).toEqual(expect.arrayContaining(["torah-azla", "haftarah-zakef"]));
  // Quick ten, opened offline from the shell once three Torah families are heard.
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("crc-torah:learn-progress/v1")!) as { lessons: Record<string, { done: string }> };
    for (const id of ["intro-phrases", "torah-sof-pasuk", "torah-etnachta", "torah-zakef"]) value.lessons[id] = { done: "2026-10-20T15:00:00.000Z" };
    localStorage.setItem("crc-torah:learn-progress/v1", JSON.stringify(value));
  });
  await page.goto("/learn/practice/quick-ten-torah");
  await expect(page.getByRole("heading", { name: "Which phrase is this?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("The recording did not load. Try again.")).toHaveCount(0);
});

// 2.0 SC6, the exit test: the service course's public text is served from a synthetic build (invented letters, never prayer text), as
// e2e/service-course.spec.ts does. Signed out, so no evening text is ever kept; the siddur reader (the licensed book) is never asked.
const syntheticWord = (seed: number) => Array.from({ length: 3 }, (_, i) => String.fromCharCode(0x05d0 + ((seed * 7 + i * 5 + 3) % 22))).join("");
const syntheticServiceText = (unit: string) => ({ unit, volume: "shabbat-shacharit", credit: { title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0" },
  lines: Array.from({ length: 10 }, (_, line) => ({ he: Array.from({ length: 46 }, (_, w) => syntheticWord(line * 50 + w)).join(" "), tr: Array.from({ length: 46 }, (_, w) => `syl${line}x${w}`).join(" "), en: `Synthetic English line ${line}.` })) });
test("offline within 14 days, a done service-course lesson's Read, Key words and Check work from the service-course pack; the siddur link needs a connection; the licensed book is never asked for", async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "one device is enough for the worker");
  test.setTimeout(300_000);
  const app = await installedApp(context), asked: string[] = [];
  context.on("request", request => asked.push(request.url()));
  await context.route("**/api/public/service-text?**", route => app.state.offline ? route.abort("internetdisconnected")
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(syntheticServiceText(new URL(route.request().url()).searchParams.get("unit") ?? "")) }));
  const main = page.locator("main#lesson-main"), next = () => page.getByRole("button", { name: "Next" }).click();
  async function lessonToDone() {
    await expect(main).toHaveAttribute("data-step", "about", { timeout: 30_000 });
    await next(); await expect(main).toHaveAttribute("data-step", "where");
    await next(); await expect(main).toHaveAttribute("data-step", "read");
    await expect(main).toHaveAttribute("data-text", "ready", { timeout: 30_000 });
    await expect(main.locator("ol li p[lang='he']").first()).toBeVisible();
  }
  async function wordsCheckDone() {
    await next(); await expect(main).toHaveAttribute("data-step", "words");
    await expect(main.locator("[data-word-card]").first()).toBeVisible();
    await next(); await expect(main).toHaveAttribute("data-step", "check");
    for (let n = 0; n < 40 && await main.getAttribute("data-step") === "check"; n++) { await main.locator("ul button").first().click(); await next(); }
    await expect(main).toHaveAttribute("data-step", "done");
  }
  await page.goto("/");
  await expect.poll(async () => (await packs(page)).map(row => row.key).sort(), { timeout: 120_000 }).toEqual(expect.arrayContaining(["course", "service-course"]));
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const service = (await packs(page)).find(row => row.key === "service-course")!;
  expect(service.assets.length).toBeGreaterThanOrEqual(30);
  expect(service.assets.every(asset => /^\/api\/public\/(?:service-text\?unit=[a-z0-9.-]+%40(?!bm-)[a-z0-9-]+&build=[a-f0-9]+|text\?ref=[^&]+&kind=(?:torah|haftarah)&offset=0)$/.test(asset))).toBe(true);
  expect((await packs(page)).some(row => row.assets.some(asset => asset.includes("evening-text")))).toBe(false);

  // Online: the lesson is done once.
  await page.goto("/learn/service/vahavta");
  await lessonToDone();
  await expect(main.getByRole("link", { name: /^Open in the siddur, page \d+/ })).toBeVisible();
  await wordsCheckDone();
  expect(await page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem("crc-torah:service-progress/v1") ?? "{}") as { lessons?: object }).lessons ?? {}))).toContain("vahavta");

  // The network cut: the lesson opens from the shell, its text from the pack, and the siddur link says it needs a connection.
  await app.offline(true);
  app.state.fromWorker.length = 0;
  await page.goto("/learn/service/vahavta");
  await lessonToDone();
  await expect(main.locator("[data-siddur-page][data-offline]")).toHaveText("Needs a connection");
  await expect(main.locator("[data-siddur-page] a")).toHaveCount(0);
  await wordsCheckDone();
  await expect(main.locator("[data-siddur-page][data-offline]")).toBeVisible();
  expect(app.state.fromWorker).toEqual(expect.arrayContaining(["/learn/service/vahavta", "/api/public/service-text"]));
  // The home opens too, with no siddur line.
  await page.goto("/learn/service");
  await expect(page.locator("[data-lesson='vahavta']").first()).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  // Never the siddur reader (the licensed book), never the evening text, never anything private from the worker.
  expect(asked.filter(url => /siddur\.centralreform\.org|\/api\/public\/evening-text/.test(url))).toEqual([]);
  expect(app.state.fromWorker.filter(path => /^\/api\/(?!public\/(?:service-text|text|manifest)$)/.test(path))).toEqual([]);
});
