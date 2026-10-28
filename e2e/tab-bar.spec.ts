import { expect, test, type Page } from "@playwright/test";

// 1.9 N10: the tab bar and the role shells. The built, unconfigured production server answers; session and student lists are
// synthetic route fulfilments with made-up names, so what is under test is the shell's own markup, CSS and navigation.
const binding = "A".repeat(43);
const ID_A = "11111111-1111-4111-8111-111111111111";
async function session(page: Page, roles: string[], approver = false) {
  // Anything else the screens ask for is "unavailable" (a 503 leaves the shell standing; a 404 would read as lost access).
  await page.route("**/api/**", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/api/session", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ membershipAvailable: true, roles, saved: true, approver, sessionBinding: binding }) }));
  // The admin lists the People pages and the roster read, empty.
  await page.route("**/api/admin/invitations?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ invitations: [] }) }));
  await page.route("**/api/admin/tutors*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ tutors: [] }) }));
  const ok = (path: string, body: object) => page.route(path, route => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) }));
  await ok("**/api/accounts/summary*", { ok: true, requests: 0 });
  await ok("**/api/accounts/requests?*", { ok: true, requests: [], productName: "Synthetic" });
  await ok("**/api/accounts/members", { ok: true, members: [] });
  await ok("**/api/accounts/approvers", { ok: true, admins: [], designated: [], candidates: [] });
  await page.route("**/api/admin/students", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ students: [] }) }));
  await page.route("**/api/students?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ students: [{ id: ID_A, firstName: "Noa", lastName: "Synthetic", ceremonyDate: "2027-03-06", revision: 1 }] }) }));
}
const bar = (page: Page) => page.getByRole("navigation", { name: "Workspace", exact: true });
const tab = (page: Page, name: string) => bar(page).getByRole("link", { name, exact: true });
const labels = (page: Page) => bar(page).getByRole("link").allInnerTexts();

type Step = { name: string; url: RegExp; landing?: string };
const roles: { role: string; home: string; tabs: string[]; steps: Step[] }[] = [
  { role: "admin", home: "/workspace/admin/students", tabs: ["This week", "Students", "People", "More"], steps: [
    { name: "Students", url: /\/workspace\/admin\/students\?tab=students$/ }, { name: "People", url: /\/workspace\/admin\/invitations$/ },
    { name: "More", url: /\/workspace\/more$/ }, { name: "This week", url: /\/workspace\/admin\/students$/ }] },
];

test.describe("at 390px", () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  for (const { role, home, tabs, steps } of roles) {
    test(`a ${role} has exactly the four tabs, each one tap from the last`, async ({ page }) => {
      await session(page, [role]);
      await page.goto(home);
      await expect(bar(page)).toBeVisible();
      expect(await labels(page)).toEqual(tabs);
      // Every tab is labelled in words beside its icon, and at least 44px square.
      for (const name of tabs) {
        const box = await tab(page, name).boundingBox();
        expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
        await expect(tab(page, name).locator("svg")).toHaveAttribute("aria-hidden", "true");
      }
      await expect(tab(page, tabs[0])).toHaveAttribute("aria-current", "page");
      for (const step of steps) {
        // Learn leaves the signed-in shell for the public page, which has no tab bar; return to where the next step starts.
        if (!(await bar(page).count())) await page.goto(home);
        await tab(page, step.name).click();
        await expect(page).toHaveURL(step.url);
        if (step.name === "Learn") { await expect(bar(page)).toHaveCount(0); continue; }
        await expect(tab(page, step.name), `${step.name} is the current tab`).toHaveAttribute("aria-current", "page");
        await expect(bar(page).locator('[aria-current="page"]')).toHaveCount(1);
      }
    });
  }

  test("a student, a parent and a tutor have no tab bar on /mine, /read or /account", async ({ page }) => {
    for (const role of ["student", "parent", "tutor"]) {
      await session(page, [role]);
      for (const path of ["/mine", "/read", "/account"]) {
        await page.goto(path);
        await expect(page.locator("[data-shell-tabs]"), `${role} ${path}`).toHaveCount(0);
      }
      await page.unroute("**/api/session");
    }
  });

  test("an admin on a student's reading has the site bar, the breadcrumb and no tab bar", async ({ page }) => {
    await session(page, ["admin"]);
    await page.goto(`/workspace/admin/students/${ID_A}/reading`);
    await expect(page.locator("[data-site-bar]")).toBeVisible();
    await expect(page.getByRole("link", { name: "All students", exact: true })).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test("a reload keeps the tab", async ({ page }) => {
    for (const { role, home, steps } of roles) {
      await session(page, [role]);
      await page.goto(home);
      // The last view that stays in the shell and is not the home.
      const step = steps.find(item => item.name !== "Learn" && item.name !== "Account" && !/Today|This week/.test(item.name))!;
      await tab(page, step.name).click();
      await expect(page).toHaveURL(step.url);
      await page.reload();
      await expect(tab(page, step.name), `${role}: ${step.name} after a reload`).toHaveAttribute("aria-current", "page");
      await page.unroute("**/api/session"); await page.unroute("**/api/students?*");
    }
  });

  test("no admin area is off-screen: People and More put every area on the screen", async ({ page }) => {
    await session(page, ["admin"], true);
    await page.goto("/workspace/admin/students");
    // The seven-area bar is gone, with its scrolling.
    await expect(page.getByRole("navigation", { name: "Admin", exact: true })).toHaveCount(0);
    const onScreen = async (name: string, locator = page.getByRole("link", { name, exact: true }).first()) => {
      const box = await locator.boundingBox();
      expect(box, name).not.toBeNull();
      expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(390);
    };
    await tab(page, "People").click();
    await expect(page.getByRole("navigation", { name: "People", exact: true })).toBeVisible();
    for (const name of ["Invitations", "Tutors", "Members"]) await onScreen(name, page.getByRole("navigation", { name: "People", exact: true }).getByRole("link", { name, exact: true }));
    await page.getByRole("navigation", { name: "People", exact: true }).getByRole("link", { name: "Tutors", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tutors", exact: true })).toBeVisible();
    await expect(tab(page, "People")).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: "People", exact: true }).getByRole("link", { name: "Members", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Members", exact: true })).toBeVisible();
    await expect(tab(page, "People")).toHaveAttribute("aria-current", "page");
    await tab(page, "More").click();
    await expect(page.getByRole("heading", { level: 1, name: "More", exact: true })).toBeVisible();
    const main = page.locator("#workspace-main");
    for (const name of ["Settings", "Email settings", "Claude connections", "Recording review"]) {
      await expect(main.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
      await onScreen(name, main.getByRole("link", { name: new RegExp(`^${name}`) }));
    }
    await expect(main.getByRole("button", { name: "Update the staff roster Sheet", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Each area opens from More, keeps More as the current tab, and Students no longer carries the staff Sheet button.
    for (const [name, heading] of [["Settings", "Congregation settings"], ["Email settings", "Email settings"], ["Claude connections", "Claude connections"], ["Recording review", "Recording review"]] as const) {
      await page.goto("/workspace/more");
      await main.getByRole("link", { name: new RegExp(`^${name}`) }).click();
      // Recording review needs its own review service to answer; its link is checked by address.
      if (name === "Recording review") { await expect(page).toHaveURL(/\/workspace\/admin\/reference-review$/); continue; }
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(tab(page, "More")).toHaveAttribute("aria-current", "page");
    }
    await page.goto("/workspace/admin/students");
    await expect(main.getByRole("button", { name: "Update staff Sheet" })).toHaveCount(0);
  });

  test("a keyboard user reaches the tab bar with one skip link", async ({ page }) => {
    await session(page, ["admin"]);
    await page.goto("/workspace/admin/students");
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to workspace", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to workspace tabs", exact: true });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("shell-tabs");
    await page.keyboard.press("Tab");
    await expect(tab(page, "This week")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(tab(page, "Students")).toBeFocused();
  });

  test("the bar never covers content: the last element is still clickable", async ({ page }) => {
    await session(page, ["admin"]);
    await page.goto("/workspace/admin/students");
    await expect(bar(page)).toBeVisible();
    await page.evaluate(() => {
      const main = document.querySelector("#workspace-main")!;
      const spacer = document.createElement("div"); spacer.style.height = "2400px";
      const last = document.createElement("button"); last.id = "last-element"; last.textContent = "Last element"; last.style.cssText = "display:block;min-height:48px;margin-top:8px";
      last.addEventListener("click", () => { last.dataset.clicked = "yes"; });
      main.append(spacer, last);
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const geometry = await page.evaluate(() => {
      const barBox = document.querySelector("nav#shell-tabs")!.getBoundingClientRect(), footer = document.querySelector(".site-footer")!.getBoundingClientRect();
      const last = document.querySelector("#last-element")!.getBoundingClientRect();
      return { barTop: barBox.top, footerBottom: footer.bottom, lastBottom: last.bottom, viewport: innerHeight };
    });
    expect(geometry.barTop).toBeLessThan(geometry.viewport);
    expect(geometry.footerBottom, "the footer ends above the bar").toBeLessThanOrEqual(geometry.barTop + 0.5);
    expect(geometry.lastBottom, "the last element ends above the bar").toBeLessThanOrEqual(geometry.barTop + 0.5);
    await page.locator("#last-element").click();
    await expect(page.locator("#last-element")).toHaveAttribute("data-clicked", "yes");
  });

  test("text at 200% still fits the bar and leaves the foot clear", async ({ page }) => {
    await session(page, ["admin"]);
    await page.goto("/workspace/admin/students");
    await expect(bar(page)).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const clear = await page.evaluate(() => document.querySelector(".site-footer")!.getBoundingClientRect().bottom <= document.querySelector("nav#shell-tabs")!.getBoundingClientRect().top + 0.5);
    expect(clear).toBe(true);
  });
});

test("from 1000px the site bar spans the full width and the tabs are a left rail beneath it, beside the page; below it, a bar at the foot", async ({ page }) => {
  await session(page, ["admin"]);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/workspace/admin/students");
  await expect(bar(page)).toBeVisible();
  const rail = (await bar(page).boundingBox())!, content = (await page.locator("#workspace-main").boundingBox())!, site = (await page.locator("[data-site-bar]").boundingBox())!;
  expect(site.x).toBe(0);
  expect(site.width, "the site bar spans the full width").toBeGreaterThanOrEqual(1100);
  expect(rail.x).toBe(0);
  expect(rail.y, "the rail starts beneath the site bar, not beside it").toBeGreaterThanOrEqual(site.y + site.height - 0.5);
  expect(rail.y + rail.height, "the rail runs to the foot of the window").toBeGreaterThanOrEqual(799);
  expect(rail.width).toBeLessThan(260);
  expect(content.x, "the page sits to the right of the rail").toBeGreaterThanOrEqual(rail.x + rail.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ["This week", "Students", "People", "More"]) expect((await tab(page, name).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 999, height: 800 });
  const foot = (await bar(page).boundingBox())!;
  expect(foot.y + foot.height).toBeGreaterThanOrEqual(799);
  expect(foot.width).toBeGreaterThanOrEqual(990);
});

test("the public pages have no tab bar, even for a signed-in person", async ({ page }) => {
  await session(page, ["student", "tutor"]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/read", "/learn", "/trope-chart", "/print"]) {
    await page.goto(path);
    await expect(page.locator("main, #main, body").first()).toBeVisible();
    await expect(bar(page), path).toHaveCount(0);
  }
});

test("Account has no tab bar for a parent, and none when signed out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/session", route => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await page.unroute("**/api/session");
  await session(page, ["parent"]);
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1, name: "Account", exact: true })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});
