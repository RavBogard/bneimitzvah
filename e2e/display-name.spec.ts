import { expect, test, type Page, type Route } from "@playwright/test";

const binding = "A".repeat(43);
const firstId = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";
const date = "2026-11-01T00:00:00.000Z";
const json = (route: Route, body: object, status = 200) => route.fulfill({ json: body, status });
const reply = (route: Route, name: string, revision: number) => json(route, { ok: true, name, revision });

async function session(page: Page, admin: boolean) {
  await page.route("**/api/**", route => json(route, {}, 503));
  await page.route("**/api/session", route => json(route, { membershipAvailable: true, roles: admin ? ["admin"] : [], saved: true, approver: admin, sessionBinding: binding }));
}

test("a roleless account can add a name and recover from a concurrent edit", async ({ page }) => {
  await session(page, false);
  let name = "", revision = 0;
  const writes: object[] = [];
  await page.route("**/api/profile/name", route => {
    expect(route.request().headers()["x-session-binding"]).toBe(binding);
    if (route.request().method() === "GET") return reply(route, name, revision);
    const body = route.request().postDataJSON(); writes.push(body);
    if (writes.length === 1) { name = "Updated elsewhere"; revision = 1; return json(route, {}, 409); }
    name = body.name; revision++;
    return reply(route, name, revision);
  });
  await page.goto("/account");
  const account = page.getByRole("region", { name: "Display name" });
  await account.getByRole("button", { name: "Add name", exact: true }).click();
  const editor = page.getByTestId("display-name-editor"), input = editor.getByRole("textbox", { name: "Display name" });
  await expect(input).toBeEditable();
  await expect(input).toBeFocused();
  await input.fill("  שִׁירָה Synthetic  ");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("  שִׁירָה Synthetic  ");
  await editor.getByRole("button", { name: "Check current name" }).click();
  await expect(editor.getByText("Updated elsewhere")).toBeVisible();
  await expect(input).toBeFocused();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(account.getByText("שִׁירָה Synthetic", { exact: true })).toBeVisible();
  await expect(account.getByRole("button", { name: "Edit name" })).toBeFocused();
  expect(writes).toEqual([{ name: "שִׁירָה Synthetic", expectedRevision: 0 }, { name: "שִׁירָה Synthetic", expectedRevision: 1 }]);
});

test("changing the signed-in session removes the previous account's open editor", async ({ page }) => {
  let activeBinding = binding;
  const other = "B".repeat(43);
  await session(page, false);
  await page.route("**/api/session", route => json(route, { membershipAvailable: true, roles: [], saved: true, approver: false, sessionBinding: activeBinding }));
  await page.route("**/api/profile/name", route => {
    expect(route.request().method()).toBe("GET");
    const requestBinding = route.request().headers()["x-session-binding"];
    return reply(route, requestBinding === binding ? "First Synthetic" : "Second Synthetic", 1);
  });
  await page.goto("/account");
  const account = page.getByRole("region", { name: "Display name" });
  await account.getByRole("button", { name: "Edit name", exact: true }).click();
  const editor = page.getByTestId("display-name-editor"), input = editor.getByRole("textbox", { name: "Display name" });
  await expect(input).toHaveValue("First Synthetic");
  await input.fill("Unsaved Synthetic");
  activeBinding = other;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(editor).toHaveCount(0);
  await expect(account.getByText("Second Synthetic", { exact: true })).toBeVisible();
  await expect(account.getByText("First Synthetic", { exact: true })).toHaveCount(0);
});

test("People opens only the selected account and refreshes after a save", async ({ page }) => {
  await session(page, true);
  let second = "Second Synthetic", peopleReads = 0;
  const reads: Array<string | null> = [];
  await page.route("**/api/accounts/requests?*", route => json(route, { ok: true, requests: [], productName: "Synthetic" }));
  await page.route("**/api/accounts/approvers", route => json(route, { ok: true, admins: [], designated: [], candidates: [] }));
  await page.route("**/api/accounts/people", route => {
    peopleReads++;
    return json(route, { ok: true, people: [
      { id: firstId, name: "First Synthetic", memberId: null, email: null, roles: [], since: date },
      { id: secondId, name: second, memberId: null, email: null, roles: ["parent"], since: date },
    ] });
  });
  let resolveFirst!: () => void;
  const firstResponse = new Promise<void>(resolve => { resolveFirst = resolve; });
  await page.route("**/api/profile/name*", async route => {
    expect(route.request().headers()["x-session-binding"]).toBe(binding);
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ membershipId: secondId, name: "Revised Synthetic", expectedRevision: 5 });
      second = "Revised Synthetic";
      return reply(route, second, 6);
    }
    const id = new URL(route.request().url()).searchParams.get("membershipId"); reads.push(id);
    if (id === firstId) { await firstResponse; return reply(route, "First Synthetic", 4).catch(() => undefined); }
    return reply(route, second, 5);
  });
  await page.goto("/workspace/accounts");
  const people = page.getByTestId("people-with-access");
  const first = people.getByRole("button", { name: "Edit name for First Synthetic" });
  await expect(first).toBeVisible();
  expect(reads).toEqual([]);
  const editor = page.getByTestId("display-name-editor");
  try {
    await first.click();
    await expect.poll(() => reads).toEqual([firstId]);
    await editor.getByRole("button", { name: "Cancel" }).click();
    await expect(first).toBeFocused();
    await people.getByRole("button", { name: "Edit name for Second Synthetic" }).click();
    const input = editor.getByRole("textbox", { name: "Display name" });
    await expect(input).toHaveValue("Second Synthetic");
    resolveFirst();
    await expect(input).toBeEditable();
    await input.fill("Revised Synthetic");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(people.getByRole("heading", { name: "Revised Synthetic" })).toBeVisible();
    await expect(people.getByRole("button", { name: "Edit name for Revised Synthetic" })).toBeFocused();
    await expect.poll(() => peopleReads).toBeGreaterThan(1);
    expect(reads).toEqual([firstId, secondId]);
  } finally { resolveFirst(); }
});

test("Tutors edits a tutor grant inline at each viewport", async ({ page }) => {
  await session(page, true);
  let name = "Tutor Synthetic", lists = 0;
  const reads: Array<string | null> = [];
  await page.route("**/api/admin/tutors?limit=*", route => {
    lists++;
    return json(route, { tutors: [{ id: firstId, displayName: name, revision: 1, isCantor: false }] });
  });
  await page.route("**/api/profile/name*", route => {
    expect(route.request().headers()["x-session-binding"]).toBe(binding);
    if (route.request().method() === "GET") {
      reads.push(new URL(route.request().url()).searchParams.get("tutorGrantId"));
      return reply(route, name, 2);
    }
    expect(route.request().postDataJSON()).toEqual({ tutorGrantId: firstId, name: "Revised Tutor", expectedRevision: 2 });
    name = "Revised Tutor";
    return reply(route, name, 3);
  });
  await page.goto("/workspace/admin/tutors");
  const edit = page.getByRole("button", { name: "Edit name for Tutor Synthetic" });
  await expect(edit).toBeVisible();
  expect(reads).toEqual([]);
  await edit.click();
  const editor = page.getByTestId("display-name-editor"), input = editor.getByRole("textbox", { name: "Display name" });
  await expect(input).toHaveValue("Tutor Synthetic");
  expect(reads).toEqual([firstId]);
  expect(await editor.evaluate(node => node.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await input.fill("Revised Tutor");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revised Tutor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit name for Revised Tutor" })).toBeFocused();
  await expect.poll(() => lists).toBeGreaterThan(1);
});
