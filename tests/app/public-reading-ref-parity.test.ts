import { expect, test, vi } from "vitest";
import { unavailableTranslations } from "../helpers/translations";
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
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import type { StepSourceLoader } from "../../src/server/study/lexical/source-loader";
import { syntheticResponse } from "../helpers/study";
import { syntheticCommentaryFetch } from "../helpers/commentary";
import { publicShortFixture, byteStream } from "./reference-public-short-fixture";

// The cutover plan's §3.11 contract: a week opened by date and the same passages opened by ref are the
// same resource with `ref` in place of `date`, so the 1.5 offline packer needs only its URL module.
// Synthetic calendar (a two-page Torah, a two-segment haftarah), invented text and clips only.
const origin = "https://beitmitzvah.centralreform.org", date = thisShabbat();
// Invented STEP rows matching the synthetic chapters' two invented words in every verse, so word details carry
// dictionary entries and "this word elsewhere" places that depend on the passage (no vacuous parity).
const stepBooks: Readonly<Record<string, string>> = { Gen: "Genesis", Isa: "Isaiah" };
const stepSource: StepSourceLoader = {
  book: async code => parseTahot(TANAKH_VERSE_COUNTS[stepBooks[code]].flatMap((verses, c) => Array.from({ length: verses }, (_, v) =>
    `${code}.${c + 1}.${v + 1}#1=L\tאָב\tDISCARDED\tSynthetic first gloss\t{H0001}\tHNcmsa\t\n${code}.${c + 1}.${v + 1}#2=L\tג\tDISCARDED\tSynthetic second gloss\t{H0002}\tHNcmsa\t`)).join("\n"), code),
  lexicon: async () => parseTbesh(["H0001\tאָב", "H0002\tג"].map(row => { const [id, word] = row.split("\t"); return `${id}#1\t${id}\t${id}\t${word}\tDISCARDED\tHNcmsa\tSynthetic sense\tDISCARDED`; }).join("\n")),
};

async function harness() {
  const calendar = vi.fn(async (value: string, cal: "diaspora" | "israel") => ({ fetchedAt: 1, snapshot: { date: parseCeremonyDate(value), calendar: cal, classification: "regular" as const,
    reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal", aliyot: [{ n: 1 as const, ref: "Genesis 1:1-4:26" }], triennial: null },
    haftarah: "Isaiah 1:1-3; Isaiah 2:1-2" } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(url instanceof Request ? url.url : url).pathname.split("/").at(-1)!)));
  const source = publicShortFixture(), catalog = parseReferenceCatalog(JSON.parse(new TextDecoder().decode(source.parent)))!;
  const short = await createShortSourceManifestLoader({ sha256: source.manifestSHA256, parentCatalogSHA256: source.parentCatalogSHA256, parentCatalogBytes: source.parent, get: async () => byteStream(source.manifest) })();
  const service = createPublicReadingService({ loadReading: calendar, loadText: createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS }),
    stepSource, pocketTorah: { loadCatalog: async () => catalog, loadManifest: async () => short } });
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: service, commentary: createSefariaCommentaryReader({ fetch: syntheticCommentaryFetch() as typeof globalThis.fetch }), translations: unavailableTranslations };
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
      // Not vacuous: the answers carry passage-dependent facts.
      if (path.endsWith("word-details")) {
        expect(byRef.wordDetails).toMatchObject({ status: "ready", dictionary: [{ lemma: "H0001", status: "ready" }], elsewhere: { status: "ready", lemma: "H0001" } });
        expect(byRef.wordDetails.elsewhere.total).toBeGreaterThan(0);
        expect(byRef.wordDetails.elsewhere.places[0].ref).not.toBe(passage.pages[0].first);
      }
    }
  }
});

test("word details by ref depend on the ref: a shorter passage finds fewer places for the same verse and word", async () => {
  const get = await harness(), week = (await get("/api/public/reading", [["date", date]])).body, ref = joinReadingRef(week.torah.ranges);
  const whole = (await get("/api/public/word-details", [["ref", ref], ["kind", "torah"], ["verse", "0"], ["word", "0"]])).body.wordDetails.elsewhere;
  const short = (await get("/api/public/word-details", [["ref", "Genesis 1:1-5"], ["kind", "torah"], ["verse", "0"], ["word", "0"]])).body.wordDetails.elsewhere;
  expect(short).toMatchObject({ status: "ready", lemma: "H0001", total: 4 });
  expect(whole.total).toBeGreaterThan(short.total);
});
