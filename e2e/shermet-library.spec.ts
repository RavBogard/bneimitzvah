import { expect, test } from "@playwright/test";
function wave() {
  const body = Buffer.alloc(44 + 8000 * 4 * 2);
  body.write("RIFF"); body.writeUInt32LE(body.length - 8, 4); body.write("WAVE", 8); body.write("fmt ", 12); body.writeUInt32LE(16, 16); body.writeUInt16LE(1, 20); body.writeUInt16LE(1, 22); body.writeUInt32LE(8000, 24); body.writeUInt32LE(16000, 28); body.writeUInt16LE(2, 32); body.writeUInt16LE(16, 34); body.write("data", 36); body.writeUInt32LE(body.length - 44, 40);
  return body;
}
test("recording library searches original labels, filters categories, and plays only a chosen available item", async ({ page }) => {
  const available = { id: "sr_" + "a".repeat(32), category: "blessing", title: "Traditional Blessings", label: "Synthetic blessing", pageUrl: "https://www.templeisraelomaha.com/traditional-blessings.html", status: "available", recordings: [{ sourceId: 123456, sha256: "a".repeat(64), duration: 4, bytes: wave().length, mimeType: "audio/wav" }] };
  const pending = { ...available, id: "sr_" + "b".repeat(32), category: "lesson", title: "Torah Trope", label: "Synthetic pending lesson", status: "pending", recordings: [] };
  const media: string[] = [];
  await page.route(/\/api\/shermet-library(?:\?.*)?$/, route => {
    const query = new URL(route.request().url()).searchParams;
    const items = [available, pending].filter(item => (!query.get("category") || query.get("category") === item.category) && (!query.get("q") || item.label.toLowerCase().includes(query.get("q")!.toLowerCase())));
    return route.fulfill({ json: { items, nextOffset: null } });
  });
  await page.route("**/api/shermet-library/media?*", route => { media.push(route.request().url()); return route.fulfill({ contentType: "audio/wav", body: wave() }); });
  await page.goto("/recordings");
  await expect(page.getByRole("heading", { name: "Synthetic blessing", exact: true })).toBeVisible();
  await expect(page.getByText("Recording not available yet.", { exact: true })).toBeVisible(); expect(media).toEqual([]);
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("lesson");
  await expect(page.getByRole("heading", { name: "Synthetic blessing", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Listen/ })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("");
  await page.getByRole("searchbox", { name: "Search recordings", exact: true }).fill("blessing");
  await expect(page.getByRole("heading", { name: "Synthetic pending lesson", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Listen to Synthetic blessing", exact: true }).click();
  const audio = page.getByRole("region", { name: "Selected recording", exact: true }).locator("audio");
  await expect(audio).toBeVisible(); await expect.poll(() => audio.evaluate(node => !(node as HTMLAudioElement).paused)).toBe(true);
  expect(media.length).toBeGreaterThan(0); expect(media.every(url => new URL(url).searchParams.get("id") === available.id)).toBe(true);
});
