import { expect, test, type Page, type Route } from "@playwright/test";

// Account as the home of roles, /workspace's redirect and an invitation's Continue, on the built, unconfigured production server.
// Session, student and invitation answers are synthetic route fulfilments (made-up names only), so the pages' own client code is under test.
const binding = "A".repeat(43);
const ID = "11111111-1111-4111-8111-111111111111";
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function session(page: Page, roles: string[]) {
  await page.route("**/api/session", route => json(route, 200, { membershipAvailable: true, roles, saved: true, approver: false, sessionBinding: binding }));
  await page.route("**/api/students?*", route => json(route, 200, { students: [{ id: ID, firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2027-03-06", revision: 1 }] }));
  await page.route("**/api/public/reading?*", route => json(route, 503, { error: "unavailable" }));
}
const door = (page: Page) => page.locator('[data-door="beit-mitzvah"]');

test("Account lists the roles with the current one marked, and choosing a role opens its home and is remembered when the page moves on inside the app", async ({ page }) => {
  await session(page, ["student", "parent", "tutor"]);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account", exact: true })).toBeVisible();
  const roles = page.getByRole("list", { name: "Roles" });
  await expect(roles.getByRole("link")).toHaveCount(3);
  // With nothing remembered the highest role is the current one.
  await expect(roles.getByRole("link", { name: /^Tutor/ })).toContainText("Current");
  await expect(roles.getByText("Current", { exact: true })).toHaveCount(1);
  await expect(roles.getByRole("link", { name: /^Parent/ })).toHaveAttribute("href", "/mine");
  await roles.getByRole("link", { name: /^Parent/ }).click();
  await expect(page).toHaveURL(/\/mine$/);
  await expect(page.getByRole("navigation", { name: "Workspace", exact: true })).toHaveCount(0);
  // The workspace's brand link moves inside the app, so the remembered role leads on the front door.
  await page.getByRole("link", { name: "CRC Torah", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(door(page).getByRole("heading", { level: 2, name: "Your readings", exact: true })).toBeVisible();
  await expect(door(page).getByRole("link", { name: "Open My Readings", exact: true })).toHaveAttribute("href", "/mine");
});

test("the old role pills and the chooser are gone from the workspace", async ({ page }) => {
  await session(page, ["parent", "tutor"]);
  await page.goto("/workspace/tutor");
  await expect(page.getByRole("navigation", { name: "Workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace roles", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Choose your workspace", exact: true })).toHaveCount(0);
});

test("/workspace leads an admin to This week and everyone else, an account with no role too, to My Readings", async ({ page }) => {
  await session(page, ["student", "parent", "tutor", "admin"]);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/workspace\/admin\/students$/);
  await page.unroute("**/api/session");
  await page.route("**/api/session", route => json(route, 200, { membershipAvailable: true, roles: ["student", "parent"], saved: true, approver: false, sessionBinding: binding }));
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/mine$/);
  await page.unroute("**/api/session");
  await page.route("**/api/session", route => json(route, 200, { membershipAvailable: false, roles: [], saved: false, approver: false, sessionBinding: binding }));
  await page.route("**/api/account/request", route => json(route, 200, { ok: true, state: "requestable", suggestedName: "", productName: "CRC Torah" }));
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/mine$/);
});

test("an accepted invitation's Continue lands on the work, and Sign out on Account returns to the sign-in form", async ({ page }) => {
  const invite = { role: "student", student: { firstName: "Synthetic", lastName: "Student" }, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), requiresConfirmation: true, reviewBinding: `1.${"A".repeat(43)}` };
  await page.route("**/api/invitations/pending", route => json(route, 200, invite));
  await page.route("**/api/invitations/accept", route => json(route, 200, { inviteId: ID, role: "student", studentId: ID }));
  await session(page, ["student"]);
  await page.goto("/invitations/accept");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByText("Your invitation has been accepted.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/mine$/);
  // Account, then Sign out: the form is what is left.
  await page.route("**/api/auth/sign-out", route => json(route, 200, { ok: true }));
  await page.goto("/account");
  // Wait for the signed-in Account page before the session turns signed out, or its own session read can see the 401 first.
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toBeVisible();
  await page.unroute("**/api/session");
  await page.route("**/api/session", route => json(route, 401, { error: "authentication-required" }));
  await signOut.click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask for an account", exact: true })).toHaveCount(0);
});
