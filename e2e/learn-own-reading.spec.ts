import { expect, test, type Page, type Route } from "@playwright/test";
import { syntheticCourseRoutes } from "./learn-synthetic";

// 1.9 N17: Learn wired to the signed-in student's own assigned reading. Every account answer is a route fulfilment with a
// synthetic student ("Noa", example.test, no real data); the public reading is the synthetic course data.
const OWNER = "a".repeat(32), STUDENT = "11111111-1111-4111-8111-111111111111", READING = "22222222-2222-4222-8222-222222222222";
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Noa is signed in with a live course grant and one assigned reading. */
async function signIn(page: Page, assigned: { kind: "torah" | "haftarah"; ranges: string[]; verses: string[] }, seen: string[]) {
  page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/")) seen.push(path); });
  await page.route("**/api/learn/progress**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/learn/progress") return json(route, { ok: true, owner: OWNER, progress: null, version: 0, until: null });
    const sent = (route.request().postDataJSON() as { progress: unknown }).progress;
    return json(route, { ok: true, owner: OWNER, progress: sent, version: 1, until: null });
  });
  await page.route("**/api/students?**", route => json(route, { students: [{ id: STUDENT, firstName: "Noa", lastName: "Fixture", ceremonyDate: "2027-03-06", revision: 1 }] }));
  await page.route(`**/api/students/${STUDENT}/reading?**`, route => json(route, { student: { id: STUDENT, firstName: "Noa", lastName: "Fixture", ceremonyDate: "2027-03-06", revision: 1 }, mode: "student", context: null,
    readings: [{ id: READING, status: "confirmed", kind: assigned.kind, basis: "selection", revision: 1, ranges: assigned.ranges, verses: assigned.verses, confirmationDate: null, needsReview: false,
      source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null }, aliyahStarts: null }] }));
}
const refOf = (page: Page) => page.locator("main bdi").first();

test.beforeEach(async ({ page }) => { await syntheticCourseRoutes().install(page, { torah: "Genesis 12:1-8" }); });

test("Noa, assigned Genesis 23:1, gets a first-verse lesson on Genesis 23:1 and never asks for this week's reading", async ({ page }) => {
  const seen: string[] = []; await signIn(page, { kind: "torah", ranges: ["Genesis 23:1"], verses: ["Genesis 23:1"] }, seen);
  const weekAsked: string[] = []; page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/public/reading" && url.searchParams.has("date")) weekAsked.push(url.search); });
  await page.goto("/learn/torah-first-verse");
  await expect(page.getByText("In your reading", { exact: true })).toBeVisible();
  await expect(refOf(page)).toHaveText("Genesis 23:1");
  await expect(page.getByRole("link", { name: "Back to my reading" })).toHaveAttribute("href", "/workspace/student?tab=reading");
  expect(weekAsked).toEqual([]);
  expect(seen).toContain("/api/students");
});

test("a signed-out visitor sees this week's verse as before and no account request beyond the progress check", async ({ page }) => {
  const seen: string[] = []; page.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/")) seen.push(path); });
  await page.route("**/api/learn/progress**", route => json(route, { error: "unauthenticated" }, 401));
  await page.goto("/learn/torah-first-verse");
  await expect(page.getByText("One verse from this week's reading.", { exact: true })).toBeVisible();
  await expect(page.getByText("In your reading", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to my reading" })).toHaveCount(0);
  expect(seen.filter(path => path.startsWith("/api/students") || path === "/api/session")).toEqual([]);
  await page.goto("/learn");
  await expect(page.locator("[data-first-phrase]")).toHaveCount(0);
  expect(seen.filter(path => path.startsWith("/api/students") || path === "/api/session")).toEqual([]);
});

test("the course home gives Noa a first-phrase row after the endings and a way back to her reading", async ({ page }) => {
  const seen: string[] = []; await signIn(page, { kind: "torah", ranges: ["Genesis 23:1-3"], verses: ["Genesis 23:1", "Genesis 23:2", "Genesis 23:3"] }, seen);
  await page.goto("/learn");
  const row = page.locator("[data-first-phrase=torah]");
  await expect(row).toHaveText("First phrase of your verse");
  expect(await row.getAttribute("href")).toBe("/learn/prepare?ref=Genesis+23%3A1&kind=torah");
  // The row follows the endings unit and precedes the next one.
  const order = await page.locator("#path-torah").locator("xpath=ancestor::section[1]").locator("h3, [data-first-phrase]").allTextContents();
  expect(order.indexOf("First phrase of your verse")).toBe(order.indexOf("The two endings") + 1);
  await expect(page.getByRole("link", { name: "Back to my reading" })).toHaveAttribute("href", "/workspace/student?tab=reading");
  // A Torah student keeps the Torah path first.
  expect(await page.locator("#path-torah, #path-haftarah").evaluateAll(nodes => nodes.map(node => node.id))).toEqual(["path-torah", "path-haftarah"]);
});

test("a student assigned a haftarah sees the haftarah path first", async ({ page }) => {
  const seen: string[] = []; await signIn(page, { kind: "haftarah", ranges: ["Isaiah 40:1-3"], verses: ["Isaiah 40:1", "Isaiah 40:2", "Isaiah 40:3"] }, seen);
  await page.goto("/learn");
  await expect(page.locator("[data-first-phrase=haftarah]")).toHaveText("First phrase of your verse");
  expect(await page.locator("#path-torah, #path-haftarah").evaluateAll(nodes => nodes.map(node => node.id))).toEqual(["path-haftarah", "path-torah"]);
  await expect(page.locator("[data-first-phrase=torah]")).toHaveCount(0);
});
