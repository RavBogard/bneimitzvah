import { expect, test, type Page } from "@playwright/test";
import { studyEditions } from "../src/components/portal/workspace/study/credits";

const student = { id: "11111111-1111-4111-8111-111111111111", firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2027-03-06", revision: 1 };
const claimed = "22222222-2222-4222-8222-222222222222";
const reading = { id: "33333333-3333-4333-8333-333333333333", kind: "torah", status: "confirmed", revision: 1, ranges: ["Genesis 1:1-20"],
  verses: Array.from({ length: 20 }, (_, index) => `Genesis 1:${index + 1}`), basis: "custom", needsReview: false, confirmationDate: null, aliyahStarts: null,
  source: { status: "unknown", fetchedAt: null, date: null, calendar: null, attribution: null } };
const adminReading = `/workspace/admin/students/${student.id}/reading`;
const tutorReading = `/workspace/tutor/${student.id}`;
const nav = (page: Page) => page.getByRole("navigation", { name: "Staff navigation", exact: true });
const bar = (page: Page) => page.getByRole("navigation", { name: "Workspace", exact: true });
const tab = (page: Page, name: string) => bar(page).getByRole("link", { name, exact: true });
const disclosure = (page: Page) => nav(page).getByText("My Students", { exact: true });
const siteReadings = (page: Page) => page.getByRole("banner").getByRole("link", { name: "My Readings", exact: true });
const skip = (page: Page) => page.getByRole("link", { name: "Skip to workspace tabs", exact: true });

async function setup(page: Page, roles: string[], needsReview = false) {
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await page.route("**/api/**", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/session", route => route.fulfill({ json: { membershipAvailable: true, roles, saved: true, approver: false, sessionBinding: "A".repeat(43) } }));
  await page.route("**/api/admin/students", route => route.fulfill({ json: { students: [{ ...student, studentKind: "child", serviceSlot: "morning", parentEmail: "synthetic@example.test", ownEmail: null, disabledAt: null }] } }));
  await page.route("**/api/students?*", route => route.fulfill({ json: { students: [student] } }));
  await page.route("**/api/learners**", route => route.fulfill({ json: { ok: true, learners: [
    { membershipId: claimed, name: "Claimed Synthetic", readings: 1, nearest: null, tutor: { name: "Tutor Synthetic", claimed: true, mine: true }, tutors: [], student: null },
  ] } }));
  await page.route("**/api/students/*/reading?*", route => route.fulfill({ json: { student, mode: new URL(route.request().url()).searchParams.get("mode"),
    context: null, readings: [{ ...reading, needsReview }], referenceListeningEnabled: false } }));
  const syllables = "אָ֑ב גַּ֖ד דָּ֥ה".normalize("NFC");
  const hebrew = { text: syllables, readingText: syllables, segments: [{ kind: "text", text: syllables }], paragraphAfter: null };
  await page.route("**/api/students/*/study-text?*", route => route.fulfill({ json: {
    studentId: student.id, studentRevision: 1, mode: new URL(route.request().url()).searchParams.get("mode"), context: null,
    assignment: { id: reading.id, revision: reading.revision, kind: reading.kind, needsReview },
    offset: 0, nextOffset: null, totalVerses: reading.verses.length,
    translation: { key: "jps2023", status: "unavailable" }, verses: reading.verses.map(ref => ({ ref, english: null, hebrew })),
    chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam] }],
  } }));
  return requests;
}

test("an admin keeps the same navigation from My Readings to a student and back to the Students tab", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "Covered at phone and desktop widths.");
  const requests = await setup(page, ["admin"]);
  await page.goto("/workspace/admin/students");
  await expect(tab(page, "This week")).toHaveAttribute("aria-current", "page");
  await siteReadings(page).click();
  await expect(page).toHaveURL(/\/mine$/);
  await expect(siteReadings(page)).toHaveAttribute("aria-current", "page");
  await expect(siteReadings(page).locator(".site-bar-mine-text")).toBeInViewport();
  await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(0);
  await expect(bar(page).getByRole("link")).toHaveCount(4);
  await expect(nav(page).getByRole("link", { name: "View as", exact: true })).toHaveAttribute("href", "/preview");
  await bar(page).evaluate(node => node.setAttribute("data-continuity-probe", ""));
  const opened = requests.length;
  await disclosure(page).click();
  const row = nav(page).getByRole("link", { name: "Noa Synthetic", exact: true });
  await expect(row).toHaveAttribute("href", adminReading);
  expect(requests.slice(opened).filter(url => /\/api\/(learners|students\?mode=tutor)/.test(url))).toEqual([]);
  await row.click();
  await expect(page).toHaveURL(adminReading);
  await expect(bar(page)).toHaveAttribute("data-continuity-probe", "");
  await expect(tab(page, "Students")).toHaveAttribute("aria-current", "page");
  await expect(nav(page).locator("details")).not.toHaveAttribute("open", "");
  await disclosure(page).click();
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(nav(page).getByRole("link", { name: "See all students", exact: true })).toHaveAttribute("href", "/workspace/admin/students?tab=students");
  await row.focus();
  await page.keyboard.press("Escape");
  await expect(disclosure(page)).toBeFocused();
  await expect(nav(page).locator("details")).not.toHaveAttribute("open", "");
  await page.getByRole("link", { name: "All students", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/admin\/students\?tab=students$/);
  await expect(page.getByRole("heading", { level: 1, name: "Students", exact: true })).toBeVisible();
  await expect(tab(page, "Students")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Details for Noa Synthetic", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "People and access for Noa Synthetic", exact: true })).toBeVisible();

  await page.route("**/preview", route => route.fulfill({ contentType: "text/html", body: "<h1>Sample preview</h1>" }));
  const preview = page.waitForRequest(request => new URL(request.url()).pathname === "/preview");
  await nav(page).getByRole("link", { name: "View as", exact: true }).click();
  expect((await preview).resourceType()).toBe("document");
  await expect(page.getByRole("heading", { name: "Sample preview" })).toBeVisible();
});

test("a tutor still reaches assigned students and independently claimed learners without admin tabs", async ({ page }, info) => {
  test.skip(info.project.name === "tablet", "Covered at phone and desktop widths.");
  const requests = await setup(page, ["admin", "tutor", "parent", "student"]);
  await page.goto(tutorReading);
  await expect(disclosure(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect(skip(page)).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "View as", exact: true })).toHaveCount(0);
  await siteReadings(page).click();
  await expect(page).toHaveURL(/\/mine$/);
  await expect(bar(page)).toHaveCount(0);
  await expect(skip(page)).toHaveCount(0);
  await disclosure(page).click();
  await expect(nav(page).getByRole("link", { name: "Claimed Synthetic", exact: true })).toHaveAttribute("href", `/mine/learner/${claimed}`);
  expect(requests.some(url => new URL(url).pathname === "/api/admin/students")).toBe(false);
  await nav(page).getByRole("link", { name: "Noa Synthetic", exact: true }).click();
  await expect(page).toHaveURL(tutorReading);

  for (const path of [`/mine/child/${student.id}`, "/mine/reading", `/workspace/practice/${student.id}`]) {
    await page.goto(path);
    await expect(page.locator('[data-workspace-state="checking"]')).toHaveCount(0);
    await expect(nav(page)).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    await expect(skip(page)).toHaveCount(0);
  }
});

test("a pending review keeps the native sheet and its focus in place", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "One viewport covers the confirmation flow.");
  await setup(page, ["admin"], true);
  let resume = () => {};
  const pending = new Promise<void>(resolve => { resume = resolve; });
  await page.route("**/api/students/*/reading/reconfirm", async route => {
    await pending;
    await route.fulfill({ status: 409, json: {} });
  });
  await page.goto(adminReading);
  await page.getByRole("button", { name: "Manage reading", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Manage reading", exact: true });
  const confirm = sheet.getByRole("button", { name: "Confirm reading is still right", exact: true });
  try {
    await confirm.click();
    await expect(confirm).toBeDisabled();
    await expect(confirm).toBeFocused();
    for (const action of ["Close", "Edit verses and aliyot", "Refresh reading", "Add lesson note", "Print practice sheet"]) {
      await expect(sheet.getByRole("button", { name: action, exact: true })).toBeDisabled();
    }
    await expect(sheet.getByRole("link", { name: "Print booklet", exact: true })).not.toHaveAttribute("href");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeVisible();
  } finally { resume(); }
  await expect(sheet.getByRole("status")).toContainText("The reading changed.");
  await expect(confirm).toBeEnabled();
  await expect(sheet.getByRole("link", { name: "Print booklet", exact: true })).toHaveAttribute("href", `/print/booklet/${student.id}`);
});

for (const width of [320, 390]) {
  test(`the admin's reading dock clears the workspace tabs at ${width}px and Practice hides private navigation`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "The test sets each phone width.");
    await page.setViewportSize({ width, height: 720 });
    await setup(page, ["admin"]);
    await page.goto(adminReading);
    const dock = page.locator(".reading-toolbar");
    const action = page.locator(".reading-practice-action");
    const trigger = page.getByRole("button", { name: "Manage reading", exact: true });
    await expect(dock).toBeVisible();
    await expect(trigger).toBeVisible();
    await expect(siteReadings(page).locator(".site-bar-mine-text")).toBeInViewport();
    await expect.poll(async () => {
      const [dockBox, tabBox] = await Promise.all([dock.boundingBox(), bar(page).boundingBox()]);
      return dockBox !== null && tabBox !== null && dockBox.y + dockBox.height <= tabBox.y;
    }).toBe(true);
    const header = (await page.getByRole("banner").boundingBox())!;
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.y - header.height).toBeGreaterThan(350);
    const manageBox = (await trigger.boundingBox())!;
    expect(manageBox.x + manageBox.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByTestId("study-verses").locator('[data-verse-ref="Genesis 1:1"]')).toBeVisible();
    await action.click();
    await expect(page.locator("[data-assigned-practice]")).toBeVisible();
    await expect(nav(page)).toBeHidden();
    await expect(bar(page)).toBeHidden();
    await expect(skip(page)).toBeHidden();
    await expect(page.getByRole("link", { name: "All students", exact: true })).toBeHidden();
    await page.getByTestId("close-assigned-practice").click();
    await expect(bar(page)).toBeVisible();
    await expect(disclosure(page)).toBeVisible();
  });
}
