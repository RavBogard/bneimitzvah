import { expect, test, vi } from "vitest";
import { unavailableTranslations } from "../helpers/translations";
vi.mock("server-only", () => ({}));
import { createPublicReadingService } from "../../src/server/public-reading/service";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { parseTahot, parseTbesh } from "../../src/server/study/lexical/step";
import { WORD_ELSEWHERE_LOADS } from "../../src/server/study/lexical/word-elsewhere";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { planStudyPage } from "../../src/server/study/sefaria";
import type { StudyPage, StudyRequest } from "../../src/server/study/types";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { expandReadingRanges } from "../../src/lib/readings/ranges";

// Invented two-word verses (the same invented lexeme twice) and invented STEP rows for every verse of
// Genesis: a common word in a long ref needs more text pages than "this word elsewhere" may read.
const rendered = normalizeHebrew("בָּ֑ג בָּ֖ג׃"), plain = "בָּג";
const book = parseTahot(TANAKH_VERSE_COUNTS.Genesis.flatMap((verses, c) => Array.from({ length: verses }, (_, v) =>
  [1, 2].map(i => `Gen.${c + 1}.${v + 1}#${i}=L\t${plain}\tDISCARDED\tSynthetic gloss\t{H0001}\tHNcmsa\t`).join("\n"))).join("\n"), "Gen");
const lexicon = parseTbesh(`H0001#1\tH0001\tH0001\t${plain}\tDISCARDED\tHNcmsa\tSynthetic sense\tDISCARDED`);

function harness() {
  const loadText = vi.fn(async (request: StudyRequest): Promise<StudyPage> => {
    const page = planStudyPage(request, TANAKH_VERSE_COUNTS);
    return { offset: page.offset, totalVerses: page.totalVerses, nextOffset: page.nextOffset, verses: page.refs.map(ref => ({ ref, hebrew: rendered, english: null })),
      chapters: [], translation: { key: "jps2023", status: "unavailable" } };
  });
  const reading = createPublicReadingService({ loadReading: async () => { throw new Error("no calendar for a ref"); }, loadText,
    stepSource: { book: async () => book, lexicon: async () => lexicon }, pocketTorah: null });
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading, commentary: (async () => { throw new Error("unused"); }) as unknown as PublicRuntime["commentary"], translations: unavailableTranslations };
  const call = (ref: string) => handlePublicReadingRequest(new Request(`https://beitmitzvah.centralreform.org/api/public/word-details?${new URLSearchParams([["ref", ref], ["kind", "torah"], ["verse", "0"], ["word", "0"]])}`),
    async action => action(runtime));
  return { loadText, call };
}

test("a common word in a long ref gets a cacheable partial answer, the same every time, never a 503", async () => {
  for (const ref of ["Genesis 1:1-4:26", "Genesis 1:1-15:21", "Genesis 1:1-24:67", "Genesis 1:1-31:54"]) {
    const verses = expandReadingRanges([ref], "torah", TANAKH_VERSE_COUNTS, 1000).length, h = harness();
    const response = await h.call(ref);
    expect(response.status, ref).toBe(200);
    expect(response.headers.get("vercel-cdn-cache-control"), ref).toBe("public, s-maxage=86400");
    const { elsewhere } = (await response.json()).wordDetails;
    expect(elsewhere.status, ref).toBe("ready");
    // The first page plus at most the budget of further pages; only a reading longer than that is partial.
    expect(h.loadText.mock.calls.length, ref).toBeLessThanOrEqual(1 + WORD_ELSEWHERE_LOADS);
    const pages = Math.ceil(verses / 100);
    if (pages > 1 + WORD_ELSEWHERE_LOADS) expect(elsewhere.partial, ref).toBe(true);
    else expect(elsewhere, ref).not.toHaveProperty("partial");
    expect(elsewhere.total, ref).toBeGreaterThan(0); expect(elsewhere.total, ref).toBeLessThan(2 * verses);
    const again = await (await harness().call(ref)).json();
    expect(again.wordDetails.elsewhere, ref).toEqual(elsewhere);
  }
});

test("a real text failure while searching is still a 503 that no cache keeps", async () => {
  const h = harness(), first = h.loadText.getMockImplementation()!;
  h.loadText.mockImplementation(async request => { if (request.offset > 0) throw new Error("synthetic text outage"); return first(request); });
  const response = await h.call("Genesis 1:1-24:67");
  expect(response.status).toBe(503); expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
});
