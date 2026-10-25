import { expect, test, type Page, type Route } from "@playwright/test";

// Asking for an account (release 1.4) on the built, unconfigured production server. Session and account answers
// are synthetic route fulfilments, so the page's own client code is under test; invented names only.
const binding = "A".repeat(43);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function week(page: Page) {
  await page.route("**/api/public/reading?*", route => json(route, 200, { date: new URL(route.request().url()).searchParams.get("date"), parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false },
    torah: { kind: "torah", ranges: ["Genesis 6:9-11:32"], verseCount: 153, pages: [{ offset: 0, first: "Genesis 6:9", last: "Genesis 10:11" }, { offset: 100, first: "Genesis 10:12", last: "Genesis 11:32" }] },
    haftarah: null }));
}
const session = (roles: string[], saved: boolean, membershipAvailable = roles.length > 0 || saved) => ({ membershipAvailable, roles, saved, approver: false, sessionBinding: binding });

test("a signed-in account with no role asks for one on the front door and on /account, at 360px and on desktop", async ({ page }) => {
  for (const [width, path] of [[360, "/"], [1280, "/"], [360, "/account"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await week(page);
    const posted: unknown[] = [];
    await page.route("**/api/session", route => json(route, 200, session([], false)));
    await page.route("**/api/account/request", route => {
      if (route.request().method() === "POST") { posted.push(route.request().postDataJSON()); return json(route, 200, { ok: true, state: "pending" }); }
      return json(route, 200, { ok: true, state: "requestable", suggestedName: "Ruth Synthetic", productName: "CRC Torah" });
    });
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Ask for an account", exact: true })).toBeVisible();
    await expect(page.getByText("An account keeps your saved readings, your place in Learn to lein, your preferred commentaries and your settings. Everything else on CRC Torah is open without one.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue("Ruth Synthetic");
    await expect(page.getByText("No congregation role is linked")).toHaveCount(0);
    await page.getByLabel("What would you like to work on? (optional)").fill("Learning\nthe haftarah");
    for (const name of ["Send request"]) { const box = await page.getByRole("button", { name, exact: true }).boundingBox(); expect(box && box.height >= 44).toBe(true); }
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByRole("button", { name: "Send request", exact: true }).click();
    await expect(page.getByText("You’ll get one email when it’s approved.", { exact: true })).toBeVisible();
    expect(posted).toEqual([{ name: "Ruth Synthetic", purpose: "Learning the haftarah" }]);
    expect(await noHorizontalScroll(page)).toBe(true);
  }
});

test("a pending request says so, a full day or queue is refused plainly, and a member is told the account can save readings", async ({ page }) => {
  await week(page);
  let state = "pending", answer: { status: number; body: unknown } = { status: 429, body: { ok: false, code: "rate-limited" } };
  await page.route("**/api/session", route => json(route, 200, session([], state === "member")));
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.route("**/api/account/request", route => route.request().method() === "POST" ? json(route, answer.status, answer.body) : json(route, 200, { ok: true, state, suggestedName: "", productName: "CRC Torah" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your request is in", exact: true })).toBeVisible();
  state = "requestable"; await page.reload();
  await page.getByLabel("Your name").fill("Ruth");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".account-request").getByRole("alert")).toHaveText("You’ve asked several times today. Try again tomorrow.");
  answer = { status: 429, body: { ok: false, code: "busy" } };
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".account-request").getByRole("alert")).toHaveText("Many requests are waiting right now. Try again later.");
  state = "member"; await page.reload();
  await expect(page.getByRole("heading", { name: "Your account can save readings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "This week’s reading", exact: true })).toHaveAttribute("href", "/read");
  await expect(page.getByRole("region", { name: "My readings" })).toBeVisible();
});

test("parents, tutors, admins and students are not offered a request on /account (G20: a student already has an account)", async ({ page }) => {
  await week(page);
  const asked: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/account/request") asked.push(request.method()); });
  let roles = ["parent"], saved = true;
  await page.route("**/api/session", route => json(route, 200, session(roles, saved)));
  await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
  await page.route("**/api/account/request", route => json(route, 200, { ok: true, state: "requestable", suggestedName: "", productName: "CRC Torah" }));
  await page.goto("/account");
  await expect(page.getByRole("list", { name: "Available roles" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask for an account", exact: true })).toHaveCount(0);
  expect(asked).toEqual([]);
  roles = ["student"]; saved = false;
  await page.reload();
  await expect(page.getByRole("list", { name: "Available roles" }).getByRole("link", { name: "Student", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask for an account", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ask for an account", exact: true })).toHaveCount(0);
  expect(asked).toEqual([]);
});

test("signed out, /, /sign-in and /account each show the way to ask for an account (F3), and it signs in to Account", async ({ page }) => {
  await week(page);
  await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
  for (const path of ["/", "/sign-in", "/account"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    const ask = page.getByRole("link", { name: "Ask for an account", exact: true });
    await expect(ask).toHaveAttribute("href", "/sign-in?return=%2Faccount");
    const box = await ask.boundingBox(); expect(box && box.height >= 44).toBe(true);
  }
  // On the way there, sign-in returns to Account, where the request form opens once signed in; the link is not offered again.
  await page.getByRole("link", { name: "Ask for an account", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?return=%2Faccount$/);
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask for an account", exact: true })).toHaveCount(0);
});
