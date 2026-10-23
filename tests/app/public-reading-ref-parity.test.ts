import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPublicReadingService, type PublicPassage } from "../../src/server/public-reading/service";
import type { PublicRuntime } from "../../src/server/http/public-reading";
import { createHttpDispatcher } from "../../src/server/http/dispatch";
import { createShortSourceManifestLoader } from "../../src/server/reference-audio/short-source-manifest";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createSefariaCommentaryReader } from "../../src/server/study/commentary";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import { thisShabbat } from "../../src/lib/readings/public-shabbat";
import { joinReadingRef } from "../../src/lib/readings/reading-ref";
import { syntheticResponse } from "../helpers/study";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";

// The cutover plan's §3.11 contract: a week opened by date and the same passages opened by ref are the
// same resource with `ref` in place of `date`, so the 1.5 offline packer needs only its URL module.
// Synthetic calendar (a two-page Torah, a two-segment haftarah), invented text and clips only.
const origin = "https://beitmitzvah.centralreform.org", date = thisShabbat();

async function harness() {
  const calendar = vi.fn(async (value: string, cal: "diaspora" | "israel") => ({ fetchedAt: 1, snapshot: { date: parseCeremonyDate(value), calendar: cal, classification: "regular" as const,
    reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1 as const, ref: "Genesis 1:1-4:26" }], triennial: null },
    haftarah: "Isaiah 1:1-3; Isaiah 2:1-2" } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const short = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent, get: async () => byteStream(source.manifest) })();
  const service = createPublicReadingService({ loadReading: calendar, loadText: createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }),
    stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: { loadCatalog: async () => catalog, loadManifest: async () => short } });
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: service, commentary: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }) };
  const dispatch = createHttpDispatcher(async () => { throw new Error("The session runtime must not be reached"); }, async action => action(runtime));
  return async (path: string, entries: [string, string][]) => {
    const response = await dispatch(new Request(`${origin}${path}?${new URLSearchParams(entries)}`));
    expect(response.status, `${path} ${JSON.stringify(entries)}`).toBe(200);
    return { body: await response.json(), headers: response.headers };
  };
}
/** Chapter fetch times differ between two uncached loads; everything else must be byte-identical. */
const stable = (value: unknown) => JSON.stringify(value).replace(/"fetchedAt":\d+/g, "");

test("reading?ref returns exactly the passage reading?date serves, for the Torah and a multi-segment haftarah", async () => {
  const get = await harness(), week = (await get("/api/public/reading", [["date", date]])).body;
  expect(week.torah.pages).toHaveLength(2);
  expect(week.haftarah.ranges).toEqual(["Isaiah 1:1-3", "Isaiah 2:1-2"]);
  for (const kind of ["torah", "haftarah"] as const) {
    const passage: PublicPassage = week[kind], ref = joinReadingRef(passage.ranges);
    const { body, headers } = await get("/api/public/reading", [["ref", ref], ["kind", kind]]);
    expect(body).toEqual({ ref, kind, passage, listening: week.listening });
    expect(Object.keys(body.passage)).toEqual(["kind", "ranges", "verseCount", "pages"]);
    expect(headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600");
  }
});

test("text, short, word-aids and word-details pages are identical with ref in place of date, at every page start", async () => {
  const get = await harness(), week = (await get("/api/public/reading", [["date", date]])).body;
  for (const kind of ["torah", "haftarah"] as const) {
    const passage: PublicPassage = week[kind], ref = joinReadingRef(passage.ranges);
    for (const { offset } of passage.pages) {
      for (const path of ["/api/public/text", "/api/public/reference/short"]) {
        const byDate = await get(path, [["date", date], ["kind", kind], ["offset", String(offset)]]);
        const byRef = await get(path, [["ref", ref], ["kind", kind], ["offset", String(offset)]]);
        expect(Object.keys(byRef.body)).toEqual(Object.keys(byDate.body).map(key => key === "date" ? "ref" : key));
        const { date: shown, ...rest } = byDate.body;
        expect(shown).toBe(date);
        expect(stable(byRef.body)).toBe(stable({ kind, ref, ...Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "kind")) }));
        expect(byRef.headers.get("vercel-cdn-cache-control")).toBe(byDate.headers.get("vercel-cdn-cache-control"));
      }
    }
    const words: [string, [string, string][]][] = [["/api/public/word-aids", [["verse", "1"]]], ["/api/public/word-details", [["verse", "0"], ["word", "0"]]]];
    for (const [path, extra] of words) {
      const byDate = (await get(path, [["date", date], ["kind", kind], ...extra])).body, byRef = (await get(path, [["ref", ref], ["kind", kind], ...extra])).body;
      const { date: _shown, ...rest } = byDate, { ref: named, ...same } = byRef;
      expect(named).toBe(ref); expect(stable(same)).toBe(stable(rest));
    }
  }
});
