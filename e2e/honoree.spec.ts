import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

// All credentials/material here are invented; no real capability, mail, DB or
// approved blessing text is used. Do not enable traces/HAR for bearer surfaces.
test.use({ trace: "off", video: "off", screenshot: "off" });
const syntheticToken = `hl1.k1.${"A".repeat(22)}.${"A".repeat(43)}.${"A".repeat(43)}`;
const fixture = () => ({ ok: true, schemaVersion: 1, student: { firstName: "Synthetic <img src=x>", ceremonyDate: "2027-01-02" },
  aliyah: { startVerse: "Genesis 1:1", endVerse: "Genesis 1:3" }, material: { version: "invented-example", before: [{ he: "טקסט ניסיוני בלבד", en: "Invented before text <script>window.hostile=true</script>" }],
    after: [{ he: "דוגמה לקריאה בלבד", en: "Invented after text for layout review." }], credits: ["Synthetic example only. <a href='https://example.test'>Plain text credit</a>"] }, expiresAt: "2027-01-09T06:00:00.000Z" });
type Probe = { fragmentPresent: boolean; anonymousOptions: boolean };
async function invitation(page: Page) {
  // Seed browser history before the first document script. Navigation and its
  // diagnostics retain only /honoree; the token never enters a request URL.
  await page.addInitScript(value => {
    if (location.pathname !== "/honoree") return;
    history.replaceState(null, "", "/honoree#token=" + value);
    const state = { fragmentPresent: Boolean(location.hash), anonymousOptions: false };
    (window as unknown as { honoreeProbe: Probe }).honoreeProbe = state;
    const nativeFetch = window.fetch;
    window.fetch = (resource, options) => {
      state.anonymousOptions = resource === "/api/honoree/read" && options?.method === "POST" && options.credentials === "omit"
        && options.redirect === "error" && options.cache === "no-store" && options.referrerPolicy === "no-referrer";
      return nativeFetch(resource, options);
    };
  }, syntheticToken);
}
const fulfill = (route: Route, life: string | null = "90000") => route.fulfill({ status: 200, contentType: "application/json; charset=utf-8",
  headers: { "cache-control": "private, no-store", ...(life === null ? {} : { "X-Honoree-Remaining-Ms": life }) }, body: JSON.stringify(fixture()) });
// Leaving the page (an app or tab switch) has its own wording; every other cause keeps the general one.
async function cleared(page: Page, heading = "This invitation is unavailable") {
  await expect(page.locator("#reading")).toBeHidden();
  expect(await page.locator("#reading").evaluate(node => node.childNodes.length === 0)).toBe(true);
  await expect(page.locator("#heading")).toHaveText(heading);
}

test("static CSP document reads anonymous synthetic text safely in both themes", async ({ page, context }, info) => {
  await invitation(page);
  await context.addCookies([{ name: "synthetic_existing_session", value: "not-authority", url: "http://127.0.0.1:3100" }]);
  let transportOkay = false, resourceLeak = false;
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.hash || url.search || url.origin !== "http://127.0.0.1:3100") resourceLeak = true;
  });
  await page.route("**/api/honoree/read", async route => {
    const request = route.request(), headers = await request.allHeaders();
    let bodyOkay = false;
    try { const body = request.postDataJSON(); bodyOkay = Object.keys(body).join() === "token" && body.token === syntheticToken; } catch { /* Boolean only; never dump request bodies. */ }
    transportOkay = request.method() === "POST" && bodyOkay && !headers.cookie && !headers.authorization && !headers.referer;
    await fulfill(route);
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const response = await page.goto("/honoree"); expect(response?.status()).toBe(200);
    const headers = response!.headers(), html = await response!.text(), csp = headers["content-security-policy"];
    for (const tag of ["script", "style"]) {
      const content = html.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">"))![1];
      expect(csp.includes("'sha256-" + createHash("sha256").update(content).digest("base64") + "'")).toBe(true);
    }
    expect(headers["cache-control"]).toBe("private, no-store"); expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(Boolean(headers["set-cookie"])).toBe(false); expect(csp.includes("font-src 'self'") && csp.includes("frame-ancestors 'none'")).toBe(true);
    expect(/__NEXT|unsafe-inline|report-uri|report-to/.test(html + csp)).toBe(false);
    await expect(page.locator("#reading")).toBeVisible();
    expect(await page.evaluate(() => location.pathname === "/honoree" && !location.hash && !location.search)).toBe(true);
    const probe = await page.evaluate(() => (window as unknown as { honoreeProbe: Probe }).honoreeProbe);
    expect(probe.fragmentPresent && probe.anonymousOptions && transportOkay).toBe(true);
    await expect(page.locator(".context")).toHaveText("Synthetic <img src=x> · January 2, 2027");
    await expect(page.locator("section h2")).toHaveText(["Before the reading", "After the reading"]);
    await expect(page.locator(".english").first()).toHaveText(fixture().material.before[0].en);
    await expect(page.locator("#reading img, #reading script, #reading a")).toHaveCount(0);
    await expect(page.locator(".hebrew").first()).toHaveAttribute("dir", "rtl");
    await expect(page.locator(".credits .availability")).toContainText("Available until ");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); });
    // Root-only opt-in: the normal gate writes no screenshots. Select desktop
    // and phone projects for exactly four synthetic light/dark review frames.
    if (process.env.HONOREE_CAPTURE === "1" && ["desktop", "phone"].includes(info.project.name)) {
      const directory = resolve(".impeccable/review/honoree-landing"); await mkdir(directory, { recursive: true });
      await page.screenshot({ path: resolve(directory, `${info.project.name}-${colorScheme}.png`), fullPage: true });
    }
  }
  expect(resourceLeak).toBe(false);
});

test("missing invitation and invalid lifetime show only generic unavailable recovery", async ({ page }) => {
  await page.goto("/honoree"); await cleared(page);
  await invitation(page); await page.route("**/api/honoree/read", route => fulfill(route, null));
  await page.goto("/honoree"); await cleared(page);
  await expect(page.locator("#status")).toContainText("Reopen the original invitation.");
  await expect(page.locator("a, button, audio, nav")).toHaveCount(0);
});

test("remaining-life expiry clears independently of informational expiry display", async ({ page }) => {
  await page.clock.install(); await invitation(page);
  await page.route("**/api/honoree/read", route => fulfill(route, "5000"));
  await page.goto("/honoree"); await expect(page.locator("#reading")).toBeVisible();
  // Browser wall time is never an authority to extend delivered material.
  await page.clock.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
  await page.clock.fastForward(5001); await cleared(page);
});

for (const reason of ["departure", "timeout"] as const) {
  test(`pending synthetic response cannot restore content after ${reason}`, async ({ page }) => {
    await page.clock.install(); await invitation(page);
    let ready!: () => void, release!: () => void, completed!: () => void;
    const arrived = new Promise<void>(done => { ready = done; }), held = new Promise<void>(done => { release = done; }), finished = new Promise<void>(done => { completed = done; });
    await page.route("**/api/honoree/read", async route => {
      ready(); await held;
      try { await fulfill(route); } catch { /* Expected canceled synthetic request; no URL/body diagnostics retained. */ }
      finally { completed(); }
    });
    await page.goto("/honoree"); await arrived;
    if (reason === "timeout") await page.clock.fastForward(12001);
    else await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
    const heading = reason === "timeout" ? undefined : "Your blessings were closed for privacy";
    await cleared(page, heading); release(); await finished; await cleared(page, heading);
  });
}
