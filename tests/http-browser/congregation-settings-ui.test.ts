import { openAuthMail } from "./auth-navigation";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined;
const contexts: BrowserContext[] = [], signedIn = new Map<string, Awaited<ReturnType<BrowserContext["cookies"]>>>();
async function safe<T>(action: () => Promise<T>): Promise<T> { try { return await action(); } catch { throw new Error("Congregation settings browser operation failed; private details withheld"); } }
async function navigate(tab: Page, path: string) { await safe(() => tab.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 })); }
async function api(tab: Page, path: string, body?: unknown) {
  return safe(() => tab.evaluate(async ({ path, body }) => {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" } });
    return { status: response.status, data: await response.json() };
  }, { path, body }));
}
async function page(role: "admin" | "tutor", mobile = false) {
  const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
  await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
  // One sign-in per role for the file, so magic-link rate limits are never the thing under test.
  const saved = signedIn.get(role); if (saved) await context.addCookies(saved);
  const tab = await context.newPage(); await navigate(tab, "/"); if (saved) return tab;
  const email = role === "admin" ? "pg-admin@example.test" : "pg-tutor@example.test";
  expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status === 200).toBe(true); await openAuthMail(tab, fixture.takeMail(email)); signedIn.set(role, await context.cookies()); return tab;
}
const main = (tab: Page) => tab.locator("#workspace-main");
async function capture(tab: Page, name: string) {
  expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.CI) return;
  const directory = join(process.cwd(), ".impeccable", "review"); await mkdir(directory, { recursive: true });
  await safe(() => tab.screenshot({ path: join(directory, `${name}.png`), fullPage: true }));
}
beforeAll(async () => {
  try { assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture(); stop = await startBrowserServer(fixture.withRuntime); browser = await chromium.launch({ headless: true }); }
  catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); throw new Error("Congregation settings setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); }, 120_000);

it("an admin opens Congregation settings from More, fixes a refused link, saves, and is told when someone else saved first", async () => {
  const tab = await page("admin"); await navigate(tab, "/workspace/admin/students");
  await safe(() => tab.getByRole("navigation", { name: "Workspace", exact: true }).getByRole("link", { name: "More", exact: true }).click());
  await safe(() => main(tab).getByRole("link", { name: "Settings", exact: true }).click());
  await ui(tab.getByRole("heading", { name: "Congregation settings", level: 1, exact: true })).toBeVisible();
  await ui(tab.getByLabel("Name on study guides", { exact: true })).toHaveValue("");
  await ui(main(tab).getByText("Left blank, guides use “the rabbi”.", { exact: false })).toBeVisible();
  await capture(tab, "settings-empty-desktop");

  let posts = 0;
  await tab.route(`${BROWSER_ORIGIN}/api/admin/congregation-settings`, async route => { if (route.request().method() === "POST") posts++; await route.continue(); });
  await safe(() => tab.getByLabel("Name on study guides", { exact: true }).fill("Rabbi Synthetic"));
  await safe(() => tab.getByLabel("Works to show first", { exact: true }).fill("Rashi\nRamban on Genesis"));
  await safe(() => tab.getByLabel("Siddur link", { exact: true }).fill("https://siddur.example.test/"));
  await safe(() => tab.getByRole("button", { name: "Save settings", exact: true }).click());
  // The draft is checked with the server's own rules before anything is sent.
  await ui(main(tab).getByRole("alert")).toHaveText("Some settings need a change before they can be saved.");
  await ui(tab.getByText("Use a full https:// link on centralreform.org or centralreform.live.", { exact: true })).toBeVisible();
  await ui(tab.getByLabel("Siddur link", { exact: true })).toHaveAttribute("aria-invalid", "true");
  // G21: focus moves to the first field that needs a change; CRC's roster sheet is the operator's, so its field is not offered.
  await ui(tab.getByLabel("Siddur link", { exact: true })).toBeFocused();
  await ui(tab.getByLabel("Roster sheet ID", { exact: true })).toHaveCount(0);
  await ui(tab.getByTestId("settings-email-status")).toBeVisible();
  expect(posts).toBe(0);
  await safe(() => tab.getByLabel("Siddur link", { exact: true }).fill("https://siddur.centralreform.org/crc/"));
  await safe(() => tab.getByLabel("Morning start time", { exact: true }).fill("09:30"));
  await safe(() => tab.getByRole("button", { name: "Save settings", exact: true }).click());
  await ui(main(tab).getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  expect(posts).toBe(1);
  const saved = await api(tab, "/api/admin/congregation-settings");
  expect(saved.data.view).toMatchObject({ version: 1, settings: { rabbiDisplayName: "Rabbi Synthetic", preferredSources: ["Rashi", "Ramban on Genesis"], siddurUrl: "https://siddur.centralreform.org/crc/", services: { morning: { start: "09:30" } } } });
  await ui(tab.getByLabel("Name on study guides", { exact: true })).toHaveValue("Rabbi Synthetic");
  await ui(main(tab).getByText("Students see it as “Reviewed by Rabbi Synthetic”.", { exact: false })).toBeVisible();
  // Every member's pages read the links.
  expect((await api(tab, "/api/congregation/links")).data.links).toEqual({ siddurUrl: "https://siddur.centralreform.org/crc/", musicUrl: null });

  // A save made elsewhere (here through the API, as the same admin) lands version 2 while this page still shows version 1.
  expect((await api(tab, "/api/admin/congregation-settings", { expectedVersion: 1, settings: { ...saved.data.view.settings, rabbiDisplayName: "Rabbi Elsewhere" }, mutationId: randomUUID() })).status).toBe(200);
  await safe(() => tab.getByLabel("Music link", { exact: true }).fill("https://centralreform.live/"));
  await safe(() => tab.getByRole("button", { name: "Save settings", exact: true }).click());
  await ui(main(tab).getByRole("alert")).toContainText("Someone saved these settings after you opened this page, so your changes weren’t saved.");
  await ui(tab.getByRole("button", { name: "Save settings", exact: true })).toHaveCount(0);
  await ui(tab.getByLabel("Music link", { exact: true })).toBeDisabled();
  expect((await api(tab, "/api/admin/congregation-settings")).data.view.version).toBe(2);
  await safe(() => tab.getByRole("button", { name: "Reload settings", exact: true }).click());
  await ui(tab.getByLabel("Name on study guides", { exact: true })).toHaveValue("Rabbi Elsewhere");
  await ui(tab.getByLabel("Music link", { exact: true })).toHaveValue("");
  await ui(tab.getByRole("button", { name: "Save settings", exact: true })).toBeEnabled();
  await safe(() => tab.getByRole("button", { name: "Save settings", exact: true }).click());
  await ui(main(tab).getByRole("status").filter({ hasText: "Nothing changed, so nothing was saved." })).toBeVisible();
});

it("fits a phone without sideways scrolling, and a tutor can neither open nor write the settings", async () => {
  const phone = await page("admin", true); await navigate(phone, "/workspace/admin/settings");
  await ui(phone.getByRole("heading", { name: "Congregation settings", level: 1, exact: true })).toBeVisible();
  await ui(phone.getByLabel("Name on study guides", { exact: true })).toBeVisible();
  await capture(phone, "settings-mobile");
  const tutor = await page("tutor"); await navigate(tutor, "/workspace/admin/settings");
  await ui(tutor.getByRole("heading", { name: "Role unavailable", exact: true })).toBeVisible();
  expect(await tutor.getByLabel("Name on study guides", { exact: true }).count()).toBe(0);
  expect((await api(tutor, "/api/admin/congregation-settings")).status).toBe(403);
  expect((await api(tutor, "/api/admin/congregation-settings", { expectedVersion: 0, settings: { rabbiDisplayName: "Not allowed" }, mutationId: randomUUID() })).status).toBe(403);
});

it("a parent sees the congregation's service name in the reading header, its time only on a wide screen, and the consent notice in the summary", async () => {
  const admin = await page("admin"), current = (await api(admin, "/api/admin/congregation-settings")).data.view;
  const [student] = await fixture.ownerDb.select().from(s.student).where(eq(s.student.id, fixture.student.id)), serviceSlot = "havdalah";
  await fixture.ownerDb.update(s.student).set({ serviceSlot, revision: student.revision + 1 }).where(eq(s.student.id, student.id));
  const settings = { ...current.settings, services: { [serviceSlot]: { label: "Synthetic gathering", start: "09:30" } }, consentNotice: "Synthetic consent notice for families." };
  expect((await api(admin, "/api/admin/congregation-settings", { expectedVersion: current.version, settings, mutationId: randomUUID() })).status).toBe(200);
  // The settings page no longer calls these fields unused.
  await navigate(admin, "/workspace/admin/settings"); await ui(admin.getByLabel("Consent notice", { exact: true })).toHaveValue("Synthetic consent notice for families.");
  expect(await main(admin).getByText(/Saved for your records|isn’t shown to families/).count()).toBe(0);
  for (const mobile of [false, true]) {
    const parent = await page("tutor", mobile); await navigate(parent, "/workspace/parent");
    await safe(() => parent.getByLabel("Child", { exact: true }).locator(`[data-student-id="${fixture.student.id}"]`).click());
    const slot = parent.locator(".hero-who .hero-slot");
    await ui(slot).toHaveText(mobile ? "· Synthetic gathering" : "· Synthetic gathering · 9:30 AM", { useInnerText: true });
    // On a phone the service stays on the name line, so the header does not grow.
    if (mobile) { const [name, line] = await Promise.all([parent.locator(".hero-who .hero-name").boundingBox(), slot.boundingBox()]); expect(Math.abs((name?.y ?? 0) - (line?.y ?? 99))).toBeLessThan(4); }
    await ui(parent.getByRole("region", { name: "Preparation summary", exact: true }).getByText("Synthetic consent notice for families.", { exact: true })).toBeVisible();
    await capture(parent, mobile ? "settings-parent-mobile" : "settings-parent-desktop");
  }
});
