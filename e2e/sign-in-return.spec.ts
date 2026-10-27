import { expect, test, type Page, type Route } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { openMore } from "./more-sheet";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

// Release 1.9 N20 exit tests on the built, unconfigured production server: our own Continue with Google, nothing from Google
// or any other site on / and /read signed out, the way back from sign-in, and a return address that is refused. Session, sign-in
// and reading answers are synthetic route fulfilments, so the pages' own client code is under test (the server's carrying of the
// return address through the code and Google's state is tested in tests/app). Invented names and example.test addresses only.
const ORIGIN = "http://127.0.0.1:3100";
// The reader turns the current week's address into plain /read, so the browser clock is pinned to a Wednesday whose Shabbat is 2026-10-24: the 2026-10-31 addresses below are then always another week, whatever day the suite runs.
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date("2026-10-21T15:00:00Z")); });
const PORTION = "Deuteronomy 31:1-30";
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const text = `${["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"].join(" ")}׃`;
const verseOf = (ref: string) => ({ ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } });
const verses = (ref: string) => expandReadingRanges(ref.split("; "), "torah", TANAKH_VERSE_COUNTS);
async function openRoutes(page: Page) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams, ref = q.get("ref");
    if (url.pathname === "/api/public/reading" && q.get("date")) return json(route, 200, { date: q.get("date"), parashah: "Vayeilech", fetchedAt: 0, listening: { pocketTorah: false },
      torah: { kind: "torah", ranges: [PORTION], verseCount: 30, pages: [{ offset: 0, first: "Deuteronomy 31:1", last: "Deuteronomy 31:30" }] }, haftarah: null });
    const passage = ref ?? (q.get("date") ? PORTION : null);
    if (!passage || q.get("kind") !== "torah") return json(route, 503, { error: "unavailable" });
    const list = verses(passage);
    if (url.pathname === "/api/public/reading")
      return json(route, 200, { ref: passage, kind: "torah", passage: { kind: "torah", ranges: passage.split("; "), verseCount: list.length, pages: [{ offset: 0, first: list[0], last: list.at(-1) }] }, listening: { pocketTorah: false } });
    if (url.pathname === "/api/public/text")
      return json(route, 200, { kind: "torah", ref: passage, offset: 0, nextOffset: null, totalVerses: list.length, translation: { key: "jps2023", status: "available" }, verses: list.map(verseOf),
        chapters: studyRangePlan(passage.split("; "), "torah", 0).chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    return json(route, 503, { error: "unavailable" });
  });
}
const signedOut = (page: Page) => page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
const bar = (page: Page) => page.locator("[data-choose-bar]");
const line = (page: Page) => bar(page).locator("[data-choose-line]");
const verse = (page: Page, number: number) => page.getByRole("button", { name: `Select Deuteronomy 31:${number}`, exact: true });
/** Every request the page makes, by origin, and whether any reached Google. */
function watch(page: Page) {
  const origins = new Set<string>();
  page.on("request", request => { try { origins.add(new URL(request.url()).origin); } catch { origins.add("unparsed"); } });
  return { offSite: () => [...origins].filter(origin => origin !== ORIGIN && origin !== "null" && !origin.startsWith("data:") && !origin.startsWith("blob:")) };
}

test("signed out, / and /read ask nothing of accounts.google.com or any other site; Google loads only when Continue with Google is pressed", async ({ page }) => {
  await signedOut(page); await openRoutes(page);
  const seen = watch(page);
  await page.goto("/");
  // The home's Beit Mitzvah door is a link to the sign-in page; the form, and Google, are on /sign-in alone.
  await expect(page.locator('[data-door="beit-mitzvah"]').getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toHaveCount(0);
  await expect(page.locator('script[src*="accounts.google.com"], iframe[src*="accounts.google.com"]')).toHaveCount(0);
  // F3: the way to the account request, before sign-in.
  await expect(page.getByRole("link", { name: "Ask for an account", exact: true })).toHaveAttribute("href", "/sign-in?return=%2Faccount");
  await page.goto(`/read?date=2026-10-24`);
  await expect(page.getByRole("heading", { level: 1, name: "Vayeilech", exact: true })).toBeVisible();
  // Signed out from the start: Sign in to save (in the More sheet), without asking the server about an account.
  await openMore(page);
  await expect(page.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
  await expect(page.getByText("Sign in to keep this reading, your place and your preferred commentaries. Everything on this page is open to anyone.", { exact: true })).toBeVisible();
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  const box = await page.getByRole("button", { name: "Continue with Google", exact: true }).boundingBox(); expect(box && box.height >= 44).toBe(true);
  expect(seen.offSite()).toEqual([]);
  // Pressed: the portal is asked for Google's address, and only then does the tab go to Google.
  const asked: unknown[] = [];
  await page.route("**/api/auth/google/redirect", route => { asked.push(route.request().postDataJSON()); return json(route, 200, { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=synthetic" }); });
  await page.route("https://accounts.google.com/**", route => route.fulfill({ contentType: "text/html", body: "<title>Synthetic Google</title>" }));
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  expect(asked).toEqual([{}]);
});

test("the front door holds the Beit Mitzvah door's height while access is checked, so the Learn door and the page below it do not jump (D3)", async ({ page }) => {
  await openRoutes(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    let answer!: () => void; const held = new Promise<void>(resolve => { answer = resolve; });
    await page.unroute("**/api/session");
    await page.route("**/api/session", async route => { await held; await json(route, 401, { error: "authentication-required" }); });
    await page.goto("/");
    const door = page.locator('[data-door="beit-mitzvah"]');
    await expect(door).toHaveAttribute("data-door-state", "loading");
    await expect(door.getByText("One moment while we check your access.", { exact: true })).toBeVisible();
    const learn = page.locator('[data-door="learn"]');
    const before = await learn.evaluate(node => node.getBoundingClientRect().top + scrollY);
    answer();
    await expect(door).toHaveAttribute("data-door-state", "sign-in");
    await expect(door.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    const after = await learn.evaluate(node => node.getBoundingClientRect().top + scrollY);
    expect(Math.abs(after - before), `the page below the door moved at ${width}px`).toBeLessThanOrEqual(8);
  }
});

test("Save, then sign in, comes back to the same reading with the same selection and offers Save there", async ({ page }) => {
  await signedOut(page); await openRoutes(page);
  const posted: Record<string, unknown>[] = [], codes: unknown[] = [];
  let signedIn = false;
  await page.route("**/api/saved/readings", route => signedIn ? json(route, 200, { ok: true, readings: [] }) : json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/auth/sign-in/magic-link", route => { posted.push(route.request().postDataJSON()); return json(route, 200, { requested: true }); });
  // The server answers the code with the return address it sealed with the email (tests/app/sign-in-code.test.ts); here the answer is synthetic.
  await page.route("**/api/auth/sign-in/code", route => { codes.push(route.request().postDataJSON()); signedIn = true; return json(route, 200, { ok: true, next: posted.at(-1)?.return ?? "/" }); });
  await page.goto(`/read?ref=${encodeURIComponent(PORTION)}&kind=torah&lens=study`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await (await openMore(page)).getByRole("button", { name: "Choose verses", exact: true }).click();
  await verse(page, 2).click();
  await verse(page, 5).click({ modifiers: ["Shift"] });
  await verse(page, 9).click();
  await expect(line(page)).toHaveText("5 verses: Deuteronomy 31:2–5; 31:9");
  const signIn = bar(page).getByRole("link", { name: "Sign in to save", exact: true });
  await expect(signIn).toBeVisible();
  await signIn.click();
  await expect(page).toHaveURL(/\/sign-in\?return=/);
  const back = new URL(page.url()).searchParams.get("return")!;
  expect(back.startsWith("/read?")).toBe(true);
  await page.getByLabel("Email address").fill("returning-reader@example.test");
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
  expect(posted).toEqual([{ email: "returning-reader@example.test", return: back }]);
  await page.getByLabel("Sign-in code").fill("123456");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Back on the same reading, in the same lens, choosing the same verses, with Save offered (its form open).
  await expect(page.getByRole("heading", { level: 1, name: "Deuteronomy 31:1–30", exact: true })).toBeVisible();
  await expect(line(page)).toHaveText("5 verses: Deuteronomy 31:2–5; 31:9");
  const form = page.getByRole("form", { name: "Save this reading" });
  await expect(form.getByLabel("Name")).toHaveValue("Deuteronomy 31:1–30 · Deuteronomy 31:2–5; 31:9");
  const url = new URL(page.url());
  expect(url.pathname).toBe("/read"); expect(url.searchParams.get("lens")).toBe("study"); expect(url.searchParams.get("ref")).toBe(PORTION);
  // The offer is read once: it is gone from the address the page keeps.
  expect(url.searchParams.has("save")).toBe(false); expect(url.searchParams.has("choose")).toBe(false);
  expect(codes).toEqual([{ code: "123456" }]);
});

test("already signed in, /sign-in goes back to the page the person left, or to My Readings when it names none (G16)", async ({ page }) => {
  await openRoutes(page);
  await page.route("**/api/session", route => json(route, 200, { membershipAvailable: true, roles: ["tutor"], saved: true, approver: false, sessionBinding: "A".repeat(43) }));
  await page.goto(`/sign-in?return=${encodeURIComponent("/read?date=2026-10-31")}`);
  await expect(page).toHaveURL(/\/read\?date=2026-10-31/);
  await expect(page.getByRole("heading", { level: 1, name: "Vayeilech", exact: true })).toBeVisible();
  await page.goto("/sign-in");
  await expect(page).toHaveURL(`${ORIGIN}/mine`);
  await expect(page.getByRole("heading", { level: 1, name: "My Readings", exact: true })).toBeVisible();
  await page.goto(`/sign-in?return=${encodeURIComponent("/read?date=2026-10-31&save=1")}`);
  await expect(page).toHaveURL(/\/read\?date=2026-10-31/);
});

test("back from a Google sign-in straight onto a reading, Save asks once and shows Save for the session that is there", async ({ page }) => {
  await openRoutes(page);
  let signedIn = false;
  await page.route("**/api/session", route => signedIn ? json(route, 200, { membershipAvailable: true, roles: [], saved: true, approver: false, sessionBinding: "A".repeat(43) }) : json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/saved/readings", route => signedIn ? json(route, 200, { ok: true, readings: [] }) : json(route, 401, { error: "authentication-required" }));
  await page.route("**/api/auth/google/redirect", route => json(route, 200, { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=synthetic" }));
  // A synthetic Google that signs in and sends the tab straight back to the reading (the portal's callback is tested in tests/app).
  await page.route("https://accounts.google.com/**", route => { signedIn = true; return route.fulfill({ status: 302, headers: { location: `${ORIGIN}/read?date=2026-10-31` } }); });
  await page.goto(`/sign-in?return=${encodeURIComponent("/read?date=2026-10-31")}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(`${ORIGIN}/read?date=2026-10-31`);
  await expect(page.getByRole("heading", { level: 1, name: "Vayeilech", exact: true })).toBeVisible();
  await openMore(page);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to save", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("crc-torah:signed-in/v1"))).toBe("1");
});

test("a return address that names another site, or anything but one of our pages, is dropped: sign-in lands on the default page", async ({ page }) => {
  await signedOut(page); await openRoutes(page);
  for (const evil of ["//evil.example", "https://evil.example/read", "/\\evil.example", "/%2F%2Fevil.example/", "javascript:alert(1)"]) {
    const posted: Record<string, unknown>[] = [], googled: unknown[] = [];
    await page.unroute("**/api/auth/**");
    await page.route("**/api/auth/sign-in/magic-link", route => { posted.push(route.request().postDataJSON()); return json(route, 200, { requested: true }); });
    await page.route("**/api/auth/sign-in/code", route => json(route, 200, { ok: true, next: "/mine" }));
    await page.route("**/api/auth/google/redirect", route => { googled.push(route.request().postDataJSON()); return json(route, 503, { error: "unavailable" }); });
    await page.goto(`/sign-in?return=${encodeURIComponent(evil)}`);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(page.getByText("Google sign-in is unavailable or this attempt ended. You can use email below.", { exact: true })).toBeVisible();
    expect(googled).toEqual([{}]);
    await page.getByLabel("Email address").fill("plain-reader@example.test");
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeVisible();
    expect(posted, evil).toEqual([{ email: "plain-reader@example.test" }]);
    await page.getByLabel("Sign-in code").fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${ORIGIN}/mine`);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
  }
});
