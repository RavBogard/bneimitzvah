import { expect, test, type Page } from "@playwright/test";

// The built, unconfigured production server. Session and student answers are synthetic route
// fulfilments (made-up names only), so the workspace shell's own markup and CSS are under test.
const binding = "A".repeat(43);
const ID_A = "11111111-1111-4111-8111-111111111111", ID_B = "22222222-2222-4222-8222-222222222222";
async function session(page: Page, roles: string[], approver = false) {
  await page.route("**/api/session", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membershipAvailable: true, roles, saved: true, approver, sessionBinding: binding }) }));
}
async function students(page: Page, rows: { id: string; firstName: string; lastName: string }[]) {
  await page.route("**/api/students?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ students: rows.map(row => ({ ...row, ceremonyDate: "2027-03-06", revision: 1 })) }) }));
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const SIGNED_IN = [
  "/mine", `/workspace/tutor/${ID_A}`,
  "/workspace/accounts", "/workspace/claude", "/workspace/email", "/workspace/more", "/workspace/admin/invitations", "/workspace/admin/reference-review",
  "/workspace/admin/settings", "/workspace/admin/students", "/workspace/admin/students/import", `/workspace/admin/students/${ID_A}/reading`,
  `/workspace/admin/students/${ID_A}/access`, "/workspace/admin/tutors", "/account", "/connect", "/invitations/accept",
];

test("every signed-in page has its own tab title and exactly one contentinfo landmark", async ({ page }) => {
  await session(page, ["student", "parent", "tutor", "admin"], true);
  await students(page, [{ id: ID_A, firstName: "Noa", lastName: "Synthetic" }]);
  const titles = new Map<string, string>();
  for (const path of SIGNED_IN) {
    await page.goto(path);
    const title = await page.title();
    expect(title, path).toMatch(/ \| CRC Torah$/);
    expect(title, path).not.toBe("CRC Torah");
    // The two student pages name the student only once the browser knows who it is, so a student id's pages share their pre-load title.
    if (!/\/(tutor|admin\/students)\/[0-9a-f-]{36}\/?(reading)?$/.test(path)) expect(titles.get(title), `${path} repeats the title of ${titles.get(title)}`).toBeUndefined();
    titles.set(title, path);
    await expect(page.getByRole("contentinfo"), path).toHaveCount(1);
  }
});

test("the tutor's student page is titled and headed with the student's name", async ({ page }) => {
  await session(page, ["tutor"]);
  await students(page, [{ id: ID_A, firstName: "Noa", lastName: "Synthetic" }, { id: ID_B, firstName: "Tamar", lastName: "Synthetic" }]);
  await page.goto(`/workspace/tutor/${ID_A}`);
  await expect(page).toHaveTitle("Noa Synthetic | CRC Torah");
  await expect(page.getByRole("heading", { level: 1, name: "Noa Synthetic", exact: true })).toBeAttached();
});

test("at a 200% root font the child cards and a text button fit a 412 px screen", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 });
  await session(page, ["parent"]);
  await students(page, [{ id: ID_A, firstName: "Noa-Shoshana-Rivka", lastName: "Synthetic-Longfamilyname" }, { id: ID_B, firstName: "Tamar", lastName: "Synthetic" }]);
  await page.goto("/workspace/parent");
  await expect(page.locator(".student-card")).toHaveCount(2);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  expect(await fits(page), "child cards").toBe(true);
  // The student page's "View … up close" is a .button-text in a flex row; a long one wraps instead of widening the page.
  await page.evaluate(() => {
    const head = document.createElement("div");
    head.className = "verse-card-head";
    head.style.display = "flex";
    head.innerHTML = '<h4>Verse tools · <bdi dir="ltr">Deuteronomy 32:10-14</bdi></h4><button type="button" class="button-text">View Deuteronomy 32:10-14 up close</button>';
    document.querySelector("#workspace-main")!.append(head);
  });
  expect(await fits(page), "a .button-text at 200%").toBe(true);
  const box = await page.locator(".verse-card-head .button-text").boundingBox();
  expect(box && box.x + box.width <= 412).toBe(true);
});
