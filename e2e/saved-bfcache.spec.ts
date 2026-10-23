import { expect, test, type Page, type Route } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// Shared devices: after signing out elsewhere, Back must not show a member's saved readings from the
// back-forward cache. Chromium keeps that cache on here (Playwright turns it off by default). Whether a given
// Back is served from it is the browser's choice, so each test also fires the restore event itself on a live
// page whose session has ended: the page must hide the saved content and ask again either way.
test.use({ launchOptions: { ignoreDefaultArgs: ["--disable-back-forward-cache"] } });
const binding = "A".repeat(43), ID = "00000000-0000-4000-8000-000000000001";
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const reading = { id: ID, name: "Private synthetic reading", date: "2026-10-24", kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3, revision: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" };
const syllables = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${syllables.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
async function routes(page: Page, signedIn: { value: boolean }) {
  await page.addInitScript(() => { window.addEventListener("pageshow", event => { if (event.persisted) (window as Window & { restoredFromCache?: boolean }).restoredFromCache = true; }); });
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    if (url.pathname === "/api/public/reading" && q.has("ref")) return json(route, 200, { ref: "Genesis 1:1-3", kind: "torah", passage: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, listening: { pocketTorah: false } });
    if (url.pathname === "/api/public/text") return json(route, 200, { kind: "torah", ref: "Genesis 1:1-3", offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" }, verses: refs.map(verseOf),
      chapters: studyRangePlan(["Genesis 1:1-3"], "torah", 0).chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    if (url.pathname === "/api/public/reading") return json(route, 200, { date: q.get("date"), parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false }, torah: null, haftarah: null });
    return json(route, 503, { error: "unavailable" });
  });
  await page.route("**/api/session", route => signedIn.value ? json(route, 200, { membershipAvailable: true, roles: ["parent"], saved: true, approver: false, sessionBinding: binding }) : json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/saved/readings", route => signedIn.value ? json(route, 200, { ok: true, readings: [reading] }) : json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/saved/reading?*", route => signedIn.value ? json(route, 200, { ok: true, reading, offset: 0, totalVerses: 3, nextOffset: null,
    verses: refs.map(ref => ({ ref, translation: null, note: null, mark: null })) }) : json(route, 401, { error: "authentication-required" }));
}
const restoredFromCache = (page: Page) => page.evaluate(() => (window as Window & { restoredFromCache?: boolean }).restoredFromCache === true);

test("Back after signing out hides a saved reading restored from the back-forward cache", async ({ page }) => {
  const signedIn = { value: true };
  await routes(page, signedIn);
  await page.goto(`/read?saved=${ID}`);
  await expect(page.getByRole("heading", { level: 1, name: "Private synthetic reading", exact: true })).toBeVisible();
  await page.goto("/trope-chart");
  signedIn.value = false;
  await page.goBack();
  test.info().annotations.push({ type: "bfcache", description: String(await restoredFromCache(page)) });
  await expect(page.getByRole("heading", { level: 2, name: "Sign in to open this reading", exact: true })).toBeVisible();
  await expect(page.getByText("Private synthetic reading")).toHaveCount(0);
  await expect(page.locator(".study-verses")).toHaveCount(0);
});

const restoreEvent = (page: Page) => page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });

test("a saved reading restored with an ended session hides at once and says why", async ({ page }) => {
  const signedIn = { value: true };
  await routes(page, signedIn);
  await page.goto(`/read?saved=${ID}`);
  await expect(page.locator(".study-verses")).toBeVisible();
  signedIn.value = false;
  await restoreEvent(page);
  await expect(page.getByRole("heading", { level: 2, name: "Sign in to open this reading", exact: true })).toBeVisible();
  await expect(page.getByText("Private synthetic reading")).toHaveCount(0);
  await expect(page.locator(".study-verses")).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});

test("My readings restored with an ended session hides at once, and so does the front door's signed-in state", async ({ page }) => {
  const signedIn = { value: true };
  await routes(page, signedIn);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "My readings" }).getByText("Private synthetic reading")).toBeVisible();
  signedIn.value = false;
  await restoreEvent(page);
  await expect(page.locator("[data-my-readings]")).toHaveCount(0);
  await expect(page.getByText("Private synthetic reading")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true }).first()).toBeVisible();
});

test("Back after signing out hides My readings restored from the back-forward cache", async ({ page }) => {
  const signedIn = { value: true };
  await routes(page, signedIn);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "My readings" }).getByText("Private synthetic reading")).toBeVisible();
  await page.goto("/trope-chart");
  signedIn.value = false;
  await page.goBack();
  test.info().annotations.push({ type: "bfcache", description: String(await restoredFromCache(page)) });
  await expect(page.getByRole("heading", { name: "Sign in", exact: true }).first()).toBeVisible();
  await expect(page.locator("[data-my-readings]")).toHaveCount(0);
  await expect(page.getByText("Private synthetic reading")).toHaveCount(0);
});
