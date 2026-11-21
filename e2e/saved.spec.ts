import { expect, test, type Page, type Route } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

// Release 1.4 saved readings in the built, unconfigured production server. The session, reading and
// saved-readings answers are synthetic route fulfilments, so the page's own client code is under test.
// Invented reading names only.
const binding = "A".repeat(43);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const row = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, name: `Synthetic reading ${index}`, date: index % 2 ? "2026-10-24" : null,
  kind: index % 3 ? "torah" : "haftarah", ranges: index % 3 ? "Genesis 6:9-11:32" : "Isaiah 54:1-55:5", verseCount: index % 3 ? 153 : 22, revision: 1,
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" });
async function week(page: Page) {
  await page.route("**/api/public/reading?*", route => json(route, 200, { date: new URL(route.request().url()).searchParams.get("date"), parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false },
    torah: { kind: "torah", ranges: ["Genesis 6:9-11:32"], verseCount: 153, pages: [{ offset: 0, first: "Genesis 6:9", last: "Genesis 10:11" }, { offset: 100, first: "Genesis 10:12", last: "Genesis 11:32" }] },
    haftarah: { kind: "haftarah", ranges: ["Isaiah 54:1-55:5"], verseCount: 22, pages: [{ offset: 0, first: "Isaiah 54:1", last: "Isaiah 55:5" }] } }));
}
/** This browser was seen signed in (the front door sets it), so Save asks when pressed rather than starting on Sign in to save (N20). */
const seenSignedIn = (page: Page) => page.addInitScript(() => { try { localStorage.setItem("crc-torah:signed-in/v1", "1"); } catch { /* none */ } });
async function minSize(page: Page, names: string[]) {
  for (const name of names) {
    const box = await page.getByRole("button", { name, exact: true }).or(page.getByRole("link", { name, exact: true })).first().boundingBox();
    expect(box && box.height >= 44 && box.width >= 44, `${name} is at least 44px`).toBe(true);
  }
}

test("Save on /read asks about the account only when pressed, and answers signed out and not eligible inline", async ({ page }) => {
  const saved: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/saved/")) saved.push(new URL(request.url()).pathname); });
  await week(page);
  let answer = { status: 401, body: { error: "authentication-required" } as unknown };
  await page.route("**/api/saved/readings", route => json(route, answer.status, answer.body));
  // A browser never seen signed in here starts on Sign in to save (F4), still without asking.
  await page.goto("/read?date=2026-10-24");
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to My Readings", exact: true })).toHaveCount(0);
  expect(saved).toEqual([]);
  await seenSignedIn(page); await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Noach", exact: true })).toBeVisible();
  const save = page.getByRole("button", { name: "Save to My Readings", exact: true });
  await expect(save).toBeVisible();
  // Visiting the reading never asks about a session; this browser was seen signed in, so the site bar shows the account control, not Sign in.
  expect(saved).toEqual([]);
  await expect(page.getByRole("banner").getByRole("link", { name: "My Readings", exact: true })).toHaveAttribute("href", "/mine");
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
  await save.click();
  // Signed out after all: Save becomes Sign in to save, which comes back to this reading and offers Save there.
  const signIn = page.getByRole("link", { name: "Sign in to save", exact: true });
  await expect(signIn).toBeVisible();
  // Its address is filled in when the link is used (focus, pointer or click).
  await signIn.focus();
  // The reading's own address (this week's is plain /read) with the save offer.
  const back = new URLSearchParams((await signIn.getAttribute("href"))!.replace(/^\/sign-in\?/, "")).get("return") ?? "";
  expect(back).toMatch(/^\/read\?(date=2026-10-24&)?save=1$/);
  expect(saved).toEqual(["/api/saved/readings"]);
  answer = { status: 403, body: { error: "forbidden" } };
  await seenSignedIn(page); await page.reload();
  await save.click();
  // Refused (a membership turned off, plan D2): told so in the sheet, with no form and nothing to ask for.
  await expect(page.getByRole("status").filter({ hasText: "Saving isn’t available for this account." })).toBeVisible();
  await expect(page.getByRole("form", { name: "Add this reading" })).toHaveCount(0);
  await page.getByRole("dialog", { name: "Add to My Readings", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a member saves the passage on screen with its name and Shabbat filled in, at 360px and on desktop", async ({ page }) => {
  await seenSignedIn(page);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await week(page);
    const posted: unknown[] = []; let createAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true, reading: row(1) } };
    await page.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
    await page.route("**/api/saved/readings/create", route => { posted.push(route.request().postDataJSON()); return json(route, createAnswer.status, createAnswer.body); });
    await page.goto("/read?date=2026-10-24");
    await page.getByRole("button", { name: "Save to My Readings", exact: true }).click();
    const form = page.getByRole("form", { name: "Add this reading" });
    await expect(form).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Add to My Readings", exact: true })).toBeVisible();
    // Three ways to choose the verses, with what is on screen chosen.
    await expect(form.getByRole("radio")).toHaveCount(3);
    await expect(form.getByRole("radio", { name: /^Torah · Genesis 6:9–11:32/ })).toBeChecked();
    await expect(form.getByLabel("Name")).toHaveValue("Noach · Torah");
    await expect(form.getByLabel("Date you’re reading it (optional)")).toHaveValue("2026-10-24");
    expect(await noHorizontalScroll(page)).toBe(true);
    await minSize(page, ["Save to My Readings", "Add"]);
    if (width === 360 && test.info().project.name === "phone") await page.screenshot({ path: test.info().outputPath("save-form-360.png"), fullPage: false });
    // Over the cap, the member is told plainly and the form stays.
    createAnswer = { status: 409, body: { ok: false, code: "limit" } };
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(form.getByRole("alert")).toHaveText("You have 100 saved readings, the most an account keeps. Remove one to save another.");
    createAnswer = { status: 200, body: { ok: true, reading: row(1) } };
    await form.getByLabel("Name").fill("  My Noach  ");
    await form.getByLabel("Date you’re reading it (optional)").fill("");
    await form.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved to My Readings." })).toBeVisible();
    await expect(page.getByRole("link", { name: "My Readings", exact: true }).last()).toHaveAttribute("href", "/mine");
    expect(posted.at(-1)).toEqual({ name: "My Noach", date: null, kind: "torah", ranges: "Genesis 6:9-11:32" });
    // The haftarah is its own passage: Save starts over for it, named for it.
    await page.getByRole("tab", { name: /^Haftarah/ }).click();
    await page.getByRole("button", { name: "Save to My Readings", exact: true }).click();
    await expect(page.getByRole("form", { name: "Add this reading" }).getByLabel("Name")).toHaveValue("Noach · Haftarah");
    await page.getByRole("dialog", { name: "Add to My Readings", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("form", { name: "Add this reading" })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  }
});

// /read?saved=<id>: the member's own reading, its passage loaded by ref from the open routes.
const syllables = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח"];
const verseOf = (ref: string) => { const text = `${syllables.join(" ")}׃`; return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] } }; };
const RANGES = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
async function openRef(page: Page, listening = false) {
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams;
    if (url.pathname === "/api/public/reading" && q.get("ref") === "Genesis 1:1-3")
      return json(route, 200, { ref: "Genesis 1:1-3", kind: "torah", passage: { kind: "torah", ranges: ["Genesis 1:1-3"], verseCount: 3, pages: [{ offset: 0, first: "Genesis 1:1", last: "Genesis 1:3" }] }, listening: { pocketTorah: listening } });
    if (url.pathname === "/api/public/text" && q.get("ref") === "Genesis 1:1-3")
      return json(route, 200, { kind: "torah", ref: "Genesis 1:1-3", offset: 0, nextOffset: null, totalVerses: 3, translation: { key: "jps2023", status: "available" }, verses: RANGES.map(verseOf),
        chapters: studyRangePlan(["Genesis 1:1-3"], "torah", 0).chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    if (url.pathname === "/api/public/reading" && q.has("date")) return json(route, 200, { date: q.get("date"), parashah: "Noach", fetchedAt: 0, listening: { pocketTorah: false }, torah: null, haftarah: null });
    return json(route, 503, { error: "unavailable" });
  });
}
const savedRow = { ...row(1), name: "Synthetic reading 1", date: "2026-10-24", kind: "torah", ranges: "Genesis 1:1-3", verseCount: 3 };
const pageOf = (reading: typeof savedRow, marks: Record<string, { state: string; version: number }> = {}) => ({ ok: true, reading, offset: 0, totalVerses: 3, nextOffset: null,
  verses: RANGES.map(ref => ({ ref, note: null, mark: marks[ref] ? { ...marks[ref], updatedAt: "2026-10-22T00:00:00.000Z" } : null })) });
const firstWord = (page: Page, ref: string) => page.locator(`.study-verses [data-verse-ref="${ref}"] [data-word-index="0"]`).first();

test("a saved reading opens with its name and date, keeps Still working and Got it per verse, renames and removes, at 360px and on desktop", async ({ page }) => {
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await openRef(page);
    let reading = { ...savedRow };
    const posts: Record<string, unknown[]> = { mark: [], update: [], remove: [] };
    await page.route("**/api/saved/reading?*", route => json(route, 200, pageOf(reading, { "Genesis 1:2": { state: "working", version: 1 } })));
    await page.route("**/api/saved/mark", route => { const body = route.request().postDataJSON(); posts.mark.push(body);
      return json(route, 200, { ok: true, verseRef: body.verseRef, mark: { state: body.state, version: body.expectedVersion + 1, updatedAt: "2026-10-23T00:00:00.000Z" } }); });
    await page.route("**/api/saved/readings/update", route => { const body = route.request().postDataJSON(); posts.update.push(body);
      reading = { ...reading, name: body.name, date: body.date, revision: reading.revision + 1 }; return json(route, 200, { ok: true, reading }); });
    await page.route("**/api/saved/readings/remove", route => { const body = route.request().postDataJSON(); posts.remove.push(body); return json(route, 200, { ok: true, removed: body.id }); });
    await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
    await page.goto(`/read?saved=${savedRow.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic reading 1", exact: true })).toBeVisible();
    await expect(page.getByText("Saturday, October 24, 2026 · Torah Genesis 1:1–3")).toBeVisible();
    // The private name is on the page, never in the tab title or browser history; the app bar knows the owner is signed in.
    await expect(page).toHaveTitle("My reading | CRC Torah");
    await expect(page.getByRole("link", { name: "My Readings", exact: true })).toHaveAttribute("href", "/mine");
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Add this reading" })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/read\\?saved=${savedRow.id}$`));
    await expect(page.getByRole("button", { name: "Save to My Readings", exact: true })).toHaveCount(0);
    // Choosing a verse in Lein shows its mark; pressing again clears it.
    await firstWord(page, "Genesis 1:2").click();
    const marks = page.getByRole("group", { name: "How Genesis 1:2 is going" });
    await expect(marks.getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "true");
    await marks.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(marks.getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(posts.mark.at(-1)).toEqual({ readingId: savedRow.id, verseRef: "Genesis 1:2", expectedVersion: 1, state: "got-it" });
    await marks.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(marks.getByRole("button", { name: "Got it", exact: true })).toHaveAttribute("aria-pressed", "false");
    expect(posts.mark.at(-1)).toEqual({ readingId: savedRow.id, verseRef: "Genesis 1:2", expectedVersion: 2, state: "unmarked" });
    await firstWord(page, "Genesis 1:3").click();
    await expect(page.getByRole("group", { name: "How Genesis 1:3 is going" }).getByRole("button", { name: "Still working", exact: true })).toHaveAttribute("aria-pressed", "false");
    await minSize(page, ["Edit", "Still working", "Got it"]);
    expect(await noHorizontalScroll(page)).toBe(true);
    // Edit opens a choice list; rename, then remove with one confirmation.
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    const choices = page.getByRole("group", { name: "Edit", exact: true });
    const changeVerses = choices.getByRole("button", { name: "Change verses", exact: true });
    const details = choices.getByRole("button", { name: "Edit name and date", exact: true });
    await edit.press("Enter");
    await expect(edit).toHaveAttribute("aria-expanded", "true");
    await expect(choices.getByRole("button").first()).toBeFocused();
    await expect(changeVerses).toBeFocused();
    await minSize(page, ["Change verses", "Edit name and date"]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await changeVerses.press("Escape");
    await expect(edit).toBeFocused();
    await expect(choices).toHaveCount(0);
    await edit.press("Space");
    await page.keyboard.press("Tab");
    await expect(details).toBeFocused();
    await details.press("Enter");
    const form = page.getByRole("form", { name: "Edit this reading" });
    await expect(form.getByLabel("Name")).toBeFocused();
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(edit).toBeFocused();
    await edit.click();
    await details.click();
    await expect(form.getByLabel("Name")).toHaveValue("Synthetic reading 1");
    await expect(form.getByLabel("Date (optional)")).toHaveValue("2026-10-24");
    await minSize(page, ["Save changes", "Cancel", "Remove reading"]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (width === 360 && test.info().project.name === "phone") await page.screenshot({ path: test.info().outputPath("saved-reading-edit-360.png"), fullPage: true });
    await form.getByLabel("Name").fill("Creation, first week");
    await form.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Creation, first week", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await expect(edit).toBeFocused();
    expect(posts.update.at(-1)).toEqual({ id: savedRow.id, revision: 1, name: "Creation, first week", date: "2026-10-24" });
    await edit.click();
    await details.click();
    await page.getByRole("button", { name: "Remove reading", exact: true }).click();
    await expect(page.getByText("Removes this reading with its marks and notes. This can’t be undone.", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Keep it", exact: true }).click();
    await page.getByRole("button", { name: "Remove reading", exact: true }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page).toHaveURL(/\/mine$/);
    expect(posts.remove).toEqual([{ id: savedRow.id, revision: 2 }]);
  }
});

test("a saved reading that cannot be opened says why, and a malformed address is just unavailable", async ({ page }) => {
  await openRef(page);
  for (const [status, heading] of [[401, "Sign in to open this reading"], [403, "Saving isn’t available for this account."], [404, "This reading isn’t in your saved readings"], [503, "Your reading didn’t load"]] as const) {
    await page.unroute("**/api/saved/reading?*");
    await page.route("**/api/saved/reading?*", route => json(route, status, { error: "x" }));
    await page.goto(`/read?saved=${savedRow.id}`);
    await expect(page.getByRole("heading", { level: 2, name: heading, exact: true })).toBeVisible();
    await expect(page.locator(".study-verses")).toHaveCount(0);
  }
  await page.goto("/read?saved=not-a-reading");
  await expect(page.getByRole("heading", { level: 1, name: "Reading unavailable", exact: true })).toBeVisible();
});

test("an owner copies public passage snapshots and the included weekday survives signed-out reading and printing", async ({ page, browser, baseURL }) => {
  const date = "2026-11-20";
  let removed = false;
  await openRef(page);
  await page.route("**/api/saved/reading?*", route => removed ? json(route, 404, { error: "missing" }) : json(route, 200, pageOf({ ...savedRow, date })));
  await page.route("**/api/saved/readings/remove", route => {
    removed = true;
    return json(route, 200, { ok: true, removed: savedRow.id });
  });
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (link: string) => {
      if (new URL(link).searchParams.has("readingDate")) throw new Error("Clipboard unavailable");
      sessionStorage.setItem("test-clipboard", link);
    },
  } }));
  await page.goto(`/read?saved=${savedRow.id}`);
  const share = page.getByRole("button", { name: "Share passage", exact: true });
  await share.press("Enter");
  const preview = page.getByRole("region", { name: "Share passage", exact: true });
  await expect(preview.getByRole("heading")).toBeFocused();
  await expect(preview).toContainText(/Genesis 1:1/);
  await expect(preview).not.toContainText(savedRow.name);
  const includeDate = preview.getByRole("checkbox", { name: /Include preparation date/ });
  await expect(includeDate).not.toBeChecked();
  const copy = preview.getByRole("button", { name: "Copy link", exact: true });
  await copy.click();
  await expect(preview.getByRole("status")).toBeVisible();
  const withoutDate = new URL((await page.evaluate(() => sessionStorage.getItem("test-clipboard")))!);
  expect([...withoutDate.searchParams.entries()]).toEqual([["ref", "Genesis 1:1-3"], ["kind", "torah"]]);
  await includeDate.check();
  await copy.click();
  const manual = preview.getByRole("textbox", { name: "Copy this link", exact: true });
  await expect(manual).toBeFocused();
  const copied = new URL(await manual.inputValue());
  expect(copied.pathname).toBe("/read");
  expect([...copied.searchParams.entries()]).toEqual([["ref", "Genesis 1:1-3"], ["kind", "torah"], ["readingDate", date]]);
  await share.press("Enter");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Edit name and date", exact: true }).click();
  await page.getByRole("button", { name: "Remove reading", exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page).toHaveURL(/\/mine$/);

  const publicPage = await browser.newPage({ baseURL, viewport: page.viewportSize() ?? undefined });
  try {
    const accountRequests: string[] = [];
    publicPage.on("request", request => { const path = new URL(request.url()).pathname; if (/^\/api\/(saved|session)/.test(path)) accountRequests.push(path); });
    await openRef(publicPage, true);
    await publicPage.goto(copied.href);
    const expectedDate = publicPage.locator(`main time[datetime="${date}"]`);
    await expect(expectedDate.first()).toContainText("Friday");
    await expect(publicPage.getByTestId("verse-cue")).toBeVisible();
    const first = publicPage.getByRole("button", { name: "Hear Genesis 1:1", exact: true });
    await publicPage.getByRole("button", { name: "Start reading", exact: true }).click();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
    await expect(publicPage.getByRole("button", { name: "Share passage", exact: true })).toHaveCount(0);
    await publicPage.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Study", exact: true }).click();
    await expect(publicPage).toHaveURL(/readingDate=2026-11-20&lens=study$/);
    await expect(expectedDate.first()).toBeVisible();
    await publicPage.getByRole("link", { name: "Print", exact: true }).last().click();
    await expect(publicPage).toHaveURL(/readingDate=2026-11-20$/);
    await expect(expectedDate.first()).toBeVisible();
    await publicPage.getByRole("link", { name: "Back to the reading", exact: true }).click();
    await expect(expectedDate.first()).toBeVisible();
    await publicPage.getByRole("group", { name: "Reading lens", exact: true }).getByRole("button", { name: "Lein", exact: true }).click();
    const signIn = publicPage.getByRole("link", { name: "Sign in to save", exact: true });
    await signIn.focus();
    const saveReturn = new URL(await signIn.getAttribute("href") ?? "", copied.origin).searchParams.get("return") ?? "";
    expect(new URL(saveReturn, copied.origin).searchParams.get("readingDate")).toBe(date);
    expect(accountRequests).toEqual([]);

    await seenSignedIn(publicPage);
    await publicPage.route("**/api/saved/readings", route => json(route, 200, { ok: true, readings: [] }));
    await publicPage.goto(copied.href);
    await publicPage.getByRole("button", { name: "Save to My Readings", exact: true }).click();
    const saveForm = publicPage.getByRole("form", { name: "Add this reading" });
    const dateField = saveForm.locator('input[type="date"]');
    await expect(dateField).toHaveValue(date);
    await saveForm.getByRole("radio", { name: "Choose verses", exact: true }).click();
    await publicPage.getByRole("button", { name: "Select Genesis 1:2", exact: true }).click();
    const selection = publicPage.getByRole("region", { name: "Choose verses", exact: true });
    const printSelection = new URL((await selection.getByRole("link", { name: "Print", exact: true }).getAttribute("href"))!, copied.origin);
    expect([...printSelection.searchParams.entries()]).toEqual([["ref", "Genesis 1:2"], ["kind", "torah"], ["readingDate", date]]);
    await selection.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dateField).toHaveValue(date);
  } finally {
    await publicPage.close();
  }
});
