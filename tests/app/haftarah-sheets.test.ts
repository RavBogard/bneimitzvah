import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHaftarahSheets, HAFTARAH_INDEX_URL, parseHaftarahIndex } from "../../src/server/study-guides/haftarah-sheets";

const index = { schema: 2, updated: "2026-10-16T00:00:00Z", weeks: [
  { slug: "2026-10-24-lech-lecha", civil: "2026-10-24", ref: "Isaiah 40:27–41:16" },
  { slug: "2026-10-17-noach", civil: "2026-10-17", ref: "Isaiah 54:1–55:5" },
  { slug: "../escape", civil: "2026-10-10" }, { slug: "2026-10-03-bereshit", civil: "2026-10-04" }, { slug: 7, civil: "2026-09-26" },
] };
const reply = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

test("present → the week page by its slug", async () => {
  const fetch = vi.fn(async () => reply(index)), sheets = createHaftarahSheets({ fetch });
  expect(await sheets.sheetFor("2026-10-17")).toBe("https://haftarah.centralreform.org/2026-10-17-noach");
  expect(fetch).toHaveBeenCalledWith(HAFTARAH_INDEX_URL, expect.objectContaining({ redirect: "error", credentials: "omit" }));
});

test("absent → null, and rows that break the library's contract are never guessed at", async () => {
  const sheets = createHaftarahSheets({ fetch: async () => reply(index) });
  expect(await sheets.sheetFor("2026-11-07")).toBeNull();
  expect(await sheets.sheetFor("2026-10-10")).toBeNull();
  expect(await sheets.sheetFor("2026-10-04")).toBeNull();
  expect(await sheets.sheetFor(null)).toBeNull();
  expect(await sheets.sheetFor("not a date")).toBeNull();
  expect([...parseHaftarahIndex(index).keys()]).toEqual(["2026-10-24", "2026-10-17"]);
});

test("fetch error → null and no throw; a bad body or wrong type is the same", async () => {
  for (const fetch of [async () => { throw new Error("offline"); }, async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
    async () => reply({ schema: 1, weeks: [] }), async () => reply(index, { status: 503 })]) {
    await expect(createHaftarahSheets({ fetch: fetch as typeof globalThis.fetch }).sheetFor("2026-10-17")).resolves.toBeNull();
  }
});

test("the index is fetched at most once a day, once at a time; a failure retries after a short pause", async () => {
  let time = 1_000_000, calls = 0, fail = false;
  const fetch = vi.fn(async () => { calls++; if (fail) throw new Error("offline"); return reply(index); });
  const sheets = createHaftarahSheets({ fetch, now: () => time });
  await Promise.all([sheets.sheetFor("2026-10-17"), sheets.sheetFor("2026-10-24"), sheets.sheetFor("2026-10-17")]);
  expect(calls).toBe(1);
  time += 23 * 60 * 60 * 1000; await sheets.sheetFor("2026-10-17"); expect(calls).toBe(1);
  time += 2 * 60 * 60 * 1000; fail = true; expect(await sheets.sheetFor("2026-10-17")).toBeNull(); expect(calls).toBe(2);
  fail = false; time += 5 * 60 * 1000; await sheets.sheetFor("2026-10-17"); expect(calls).toBe(2);
  time += 15 * 60 * 1000; expect(await sheets.sheetFor("2026-10-17")).toBe("https://haftarah.centralreform.org/2026-10-17-noach"); expect(calls).toBe(3);
});
