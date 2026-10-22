import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { createHebcalReader, type CacheEntry, type HebcalCache } from "../../src/lib/readings/proposals";
import { publicPlans } from "../../src/server/public-reading/service";

// Saved Hebcal leyning responses (CC BY 4.0; see tests/fixtures/trope/README.md). Numeric references only.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/trope/hebcal/${name}.json`, import.meta.url), "utf8"));

async function snapshotFor(name: string) {
  const payload = fixture(name);
  let cached: CacheEntry | null = null;
  const cache: HebcalCache = { get: vi.fn(async () => cached), set: vi.fn(async (_key, entry) => { cached = entry; }) };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }));
  const load = createHebcalReader({ fetch, cache, verseCounts: TANAKH_VERSE_COUNTS, now: () => 100000000 });
  return (await load(payload.range.start)).snapshot;
}

test.each([
  ["shemot", ["Isaiah 27:6-28:13", "Isaiah 29:22-23"], 23],
  ["shabbat-shuva", ["Hosea 14:2-10", "Joel 2:15-27"], 22],
])("the public page keeps every segment of a multi-range haftarah (%s), in Hebcal's order, beside the Torah", async (name, ranges, verses) => {
  const plans = publicPlans(await snapshotFor(name));
  expect(plans.haftarah?.ranges).toEqual(ranges);
  expect(plans.haftarah?.verses.length).toBe(verses);
  expect(plans.torah).not.toBeNull();
});

test("a haftarah that runs back to an earlier chapter (Mishpatim) is shown whole on the public page", async () => {
  const plans = publicPlans(await snapshotFor("mishpatim"));
  expect(plans.haftarah?.ranges.length).toBe(2);
  expect(plans.haftarah?.verses.at(-1)).toBe("Jeremiah 33:26");
  expect(plans.torah).not.toBeNull();
});
