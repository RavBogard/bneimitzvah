import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { expect as ui } from "@playwright/test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { count, eq, getTableName } from "drizzle-orm";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import { browserFixture } from "./fixture";
import { BROWSER_ORIGIN, assertBrowserStartupAllowed, startBrowserServer } from "./server";
import { installLoopbackFetchGuard } from "./egress";
import { openAuthMail } from "./auth-navigation";
import { CSV_FULL_HEADER } from "../../src/components/portal/workspace/csv-import/api";
import * as s from "../../src/server/db/index";
vi.mock("server-only", () => ({}));
let fixture: Awaited<ReturnType<typeof browserFixture>>, browser: Browser, stop: (() => Promise<void>) | undefined, restore: (() => void) | undefined, isolation: Awaited<ReturnType<typeof isolatedEnv>> | undefined;
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
const contexts: BrowserContext[] = [];
async function safe<T>(action: () => Promise<T>) { try { return await action(); } catch { throw new Error("Synthetic quiet roster browser operation failed; private details withheld"); } }
async function api(tab: Page, path: string, body?: unknown) {
 return safe(() => tab.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { path, body }));
}
async function page(mobile: boolean) {
 const context = await browser.newContext({ baseURL: BROWSER_ORIGIN, serviceWorkers: "block", acceptDownloads: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } }); contexts.push(context);
 await context.route("**/*", async route => { try { if (new URL(route.request().url()).origin === BROWSER_ORIGIN) await route.continue(); else await route.abort(); } catch { await route.abort(); } });
 if (cookies) await context.addCookies(cookies); const tab = await context.newPage(); await safe(() => tab.goto("/", { waitUntil: "domcontentloaded" }));
 if (!cookies) { const email = "pg-admin@example.test"; expect((await api(tab, "/api/auth/sign-in/magic-link", { email })).status).toBe(200); await openAuthMail(tab, fixture.takeMail(email)); cookies = await context.cookies(); }
 return tab;
}
async function counts() {
 const values: Record<string, number> = {};
 for (const table of [s.student, s.auditEvent, s.user, s.membership, s.roleGrant, s.guardian, s.tutorStudent, s.studentIdentity, s.invite, s.assignment]) values[getTableName(table)] = (await fixture.ownerDb.select({ n: count() }).from(table))[0].n;
 return values;
}
function csv(prefix: string) {
 const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
 const row = (suffix: string, tutor: string, secondEmail: string) => ["Synthetic", prefix + suffix, "2027-01-02", "primary@example.test", "", "havdalah", "Synthetic display label", tutor, "Synthetic First Guardian", "555-0100", "Synthetic Second Guardian", secondEmail, "Synthetic Hebrew", "Synthetic administrative note"].map(quote).join(",");
 return CSV_FULL_HEADER + "\n" + row("Matched", "Synthetic Import Tutor", "secondary@example.test") + "\n" + row("Unmatched", "Synthetic Unmatched Tutor", "");
}
async function capture(tab: Page, mobile: boolean) {
 if (process.env.CI) return;
 await safe(() => tab.evaluate(async () => { await document.fonts.ready; scrollTo(0, 0); await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))); }));
 expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 const dir = join(process.cwd(), ".local-logs"); await mkdir(dir, { recursive: true });
 await safe(() => tab.screenshot({ path: join(dir, `quiet-roster-preview-${mobile ? "mobile" : "desktop"}.png`), fullPage: true }));
}
beforeAll(async () => {
 try {
  assertBrowserStartupAllowed(); restore = installLoopbackFetchGuard(); fixture = await browserFixture();
  await fixture.ownerDb.update(s.user).set({ name: "Synthetic Import Tutor" }).where(eq(s.user.id, fixture.tutor.id));
  stop = await startBrowserServer(fixture.withRuntime); isolation = await isolatedEnv(); browser = await chromium.launch({ headless: true, env: isolation.env });
 } catch { await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); throw new Error("Synthetic quiet roster setup failed; private details withheld"); }
}, 120_000);
afterAll(async () => { await Promise.all(contexts.map(context => context.close().catch(() => undefined))); await browser?.close().catch(() => undefined); await stop?.().catch(() => undefined); await fixture?.close().catch(() => undefined); restore?.(); await isolation?.cleanup(); }, 120_000);
for (const mobile of [false, true]) it(`reviews rich quiet import and reaches the roster without authority side effects on ${mobile ? "mobile" : "desktop"}`, async () => {
 const tab = await page(mobile), before = await counts(); let authorityPosts = 0;
 tab.on("request", request => { const path = new URL(request.url()).pathname; if (request.method() === "POST" && /\/(?:invitations|relationships)(?:\/|$)/.test(path)) authorityPosts++; });
 await safe(() => tab.goto("/workspace/admin/students/import", { waitUntil: "domcontentloaded" }));
 await ui(tab.getByRole("button", { name: "Reload roster for import", exact: true })).toBeEnabled();
 await safe(() => tab.getByLabel("CSV draft to review", { exact: true }).fill(csv(mobile ? "MobileIntake" : "DesktopIntake")));
 await safe(() => tab.getByRole("button", { name: "Preview import", exact: true }).click()); const review = tab.locator(".csv-review");
 await ui(review.getByRole("heading", { name: "Review student import", exact: true })).toBeVisible();
 await ui(review).toContainText("2 valid rows. 0 invalid. 0 exact duplicates.");
 await ui(review).toContainText("Matched existing tutors: rows 2."); await ui(review).toContainText("Unmatched tutor names: rows 3."); await ui(review).toContainText("Ambiguous tutor names: none.");
 await ui(review).toContainText("These are proposals only. No tutor is assigned and no account access is created by this import.");
 await ui(review).toContainText("Second parent name or email is missing in rows 3. Records can be imported; contact details alone grant no guardian access.");
 await capture(tab, mobile); expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await safe(() => review.getByRole("button", { name: "Import reviewed students", exact: true }).click());
 await ui(tab.getByRole("status").filter({ hasText: "2 student records created. No invitations were sent." })).toBeVisible();
 const after = await counts(); expect(after).toEqual({ ...before, student: before.student + 2, audit_event: before.audit_event + 2 }); expect(authorityPosts).toBe(0);
 await safe(() => tab.locator(".csv-workspace").getByRole("link", { name: "All students", exact: true }).click());
 await ui(tab.getByRole("heading", { name: "Students", level: 1, exact: true })).toBeVisible();
 await ui(tab.getByRole("button", { name: `Edit details for Synthetic ${mobile ? "MobileIntake" : "DesktopIntake"}Matched`, exact: true })).toBeVisible();
 expect(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await tab.context().close();
});
