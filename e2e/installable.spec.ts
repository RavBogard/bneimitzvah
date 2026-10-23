import { expect, test } from "@playwright/test";

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
