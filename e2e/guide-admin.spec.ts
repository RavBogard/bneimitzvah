import { expect, test } from "@playwright/test";

test("filters 168 guides, pages through matches, and returns from the reader to the same row", async ({ page }) => {
  const updated = "2026-11-17T12:00:00.000Z";
  const version = { version: 3, origin: "claude", reviewed: false, changedAt: updated };
  const guides = Array.from({ length: 168 }, (_, index) => {
    const slug = `reading-${index + 1}`;
    const state = index === 0 ? "held" : index < 17 ? "draft" : "reviewed";
    return { kind: "torah", readingKey: slug, reading: { slug, name: index < 17 ? `Matching reading ${index}` : `Catalog reading ${index}`, order: index },
      state, current: version, visible: state === "held" ? null : version, afterHold: null, href: index === 12 ? "/read?reading=noach&lens=study" : null };
  });
  await page.route("**/api/session", route => route.fulfill({ json: { membershipAvailable: true, roles: ["admin"], saved: true, approver: false, sessionBinding: "A".repeat(43) } }));
  await page.route("**/api/admin/guides", route => route.fulfill({ json: { ok: true, guides, summaries: [], discussions: [], truncated: false, rabbiName: "Rabbi Synthetic" } }));
  await page.route("**/api/admin/guides/text?*", route => route.fulfill({ json: { ok: true, guide: { kind: "torah", readingKey: "reading-13", version: 3, hold: false,
    rabbiName: "Rabbi Synthetic", label: version, body: { overview: "A synthetic guide to inspect", themes: [] }, changedAt: updated } } }));
  await page.goto("/workspace/admin/guides");
  const list = page.getByTestId("guide-admin"), count = list.getByTestId("guide-admin-count");
  const search = list.getByRole("searchbox", { name: "Reading name" }), status = list.getByRole("combobox", { name: "Content status" });
  const catalog = list.getByTestId("guide-admin-readings"), pages = catalog.getByRole("navigation", { name: "Reading results pages" });
  await expect(count).toHaveText("168 results");
  await expect(list.getByTestId("guide-admin-waiting").getByTestId("guide-admin-guide")).toHaveCount(1);
  await expect(catalog.getByTestId("guide-admin-guide")).toHaveCount(10);
  await search.fill("No matching reading");
  await expect(list.getByRole("heading", { name: "No matching study content" })).toBeVisible();
  await expect(count).toHaveText("0 results of 168");
  await list.getByRole("button", { name: "Clear filters" }).click();
  await expect(count).toHaveText("168 results");
  await search.fill("Matching reading");
  await status.selectOption("draft");
  await expect(count).toHaveText("16 results of 168");
  await expect(list.getByTestId("guide-admin-waiting")).toHaveCount(0);
  await pages.getByRole("button", { name: "Next" }).click();
  await expect(catalog.getByTestId("guide-admin-guide")).toHaveCount(6);
  const row = catalog.getByTestId("guide-admin-guide").filter({ hasText: "Matching reading 12" });
  await row.getByText("Read version 3", { exact: true }).click();
  await expect(row.getByTestId("guide-admin-text")).toBeVisible();
  const open = row.getByTestId("guide-admin-open");
  await open.evaluate(el => el.scrollIntoView({ block: "center" }));
  const top = (await open.boundingBox())!.y;
  await open.click();
  await expect(page).toHaveURL(/\/read\?/);
  await page.goBack();
  await expect(search).toHaveValue("Matching reading");
  await expect(status).toHaveValue("draft");
  await expect(pages).toContainText("Page 2 of 2");
  await expect(open).toBeInViewport();
  await expect.poll(async () => Math.abs((await open.boundingBox())!.y - top)).toBeLessThan(60);
});
