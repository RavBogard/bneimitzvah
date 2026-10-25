import type { Page, Route } from "@playwright/test";
import { studyRangePlan } from "../src/components/portal/workspace/study/api";
import { studyEditions } from "../src/components/portal/workspace/study/credits";
import { TANAKH_VERSE_COUNTS } from "../src/lib/readings/catalog";
import { expandReadingRanges } from "../src/lib/readings/ranges";

/**
 * Synthetic Vayera for the aliyot specs: the real parashah's references and aliyah divisions (numbers only, which are
 * calendar data), and invented syllables and numbered English for every verse. Never a verse, a translation or a commentary.
 * The reading and text routes answer by date (as /read's week does) and by ref (as a picked or chosen passage does).
 */
export const VAYERA = "Genesis 18:1-22:24";
export const VAYERA_DATE = "2026-10-31";
export const FULL = [["1", "Genesis 18:1-14"], ["2", "Genesis 18:15-33"], ["3", "Genesis 19:1-20"], ["4", "Genesis 19:21-21:4"],
  ["5", "Genesis 21:5-21"], ["6", "Genesis 21:22-34"], ["7", "Genesis 22:1-24"], ["M", "Genesis 22:20-24"]] as const;
export const TRIENNIAL = [["1", "Genesis 18:1-14"], ["2", "Genesis 18:15-21"], ["3", "Genesis 18:22-26"], ["4", "Genesis 18:27-33"], ["5", "Genesis 19:1-5"],
  ["6", "Genesis 19:6-14"], ["7", "Genesis 19:15-20"], ["M", "Genesis 19:18-20"]] as const;
const syllables = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח", "טִֽים", "כָּ֔ךְ", "לֻ֣ם", "מָֽה", "נֶ֥גֶד", "סֵ֖פֶר", "עֹ֣ז", "פֶּ֔ה", "צַ֥ר"];
/** Twelve invented words with a trope mark on most, like a real verse, so the DOM and layout cost is realistic. */
export const verseOf = (ref: string, index: number) => {
  const text = `${Array.from({ length: 10 + (index % 6) }, (_, i) => syllables[(i + index) % syllables.length]).join(" ")}׃`;
  return { ref, english: `Synthetic translation ${ref}`, hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text" as const, text }] } };
};
export const versesOf = (ref: string) => expandReadingRanges(ref.split("; "), "torah", TANAKH_VERSE_COUNTS);
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const pagesOf = (ranges: string[]) => { const pages: { offset: number; first: string; last: string }[] = []; for (let offset: number | null = 0; offset !== null;) { const plan = studyRangePlan(ranges, "torah", offset); pages.push({ offset, first: plan.refs[0], last: plan.refs.at(-1)! }); offset = plan.nextOffset; } return pages; };

export type Fixture = Readonly<{ calls: string[]; aliyot: { mode: "ok" | "fail" | "none" } }>;
/**
 * Routes for the public reading API. `aliyot.mode`: "ok" answers Vayera's divisions; "none" answers a week with no divisions (a festival
 * Saturday: an empty full list and no triennial); "fail" refuses. Every other route is answered for both date and ref selectors.
 */
export async function mockVayera(page: Page, aliyot: Fixture["aliyot"] = { mode: "ok" }): Promise<Fixture> {
  const calls: string[] = [];
  await page.route("**/api/public/**", route => {
    const url = new URL(route.request().url()), q = url.searchParams, date = q.get("date"), ref = q.get("ref") ?? VAYERA, kind = q.get("kind") ?? "torah";
    calls.push(url.pathname + url.search);
    if (url.pathname === "/api/public/aliyot") {
      if (aliyot.mode === "fail") return json(route, 503, { error: "unavailable" });
      return json(route, 200, aliyot.mode === "none" ? { date, parashah: null, full: [], triennial: null }
        : { date, parashah: "Vayera", full: FULL.map(([n, r]) => ({ n, ref: r })), triennial: { year: 2, aliyot: TRIENNIAL.map(([n, r]) => ({ n, ref: r })) } });
    }
    if (kind !== "torah") return json(route, 503, { error: "unavailable" });
    const ranges = ref.split("; "), list = versesOf(ref);
    const passage = { kind: "torah", ranges, verseCount: list.length, pages: pagesOf(ranges) };
    if (url.pathname === "/api/public/reading")
      return json(route, 200, date ? { date, parashah: "Vayera", fetchedAt: 0, listening: { pocketTorah: false }, torah: passage, haftarah: null }
        : { ref, kind: "torah", passage, listening: { pocketTorah: false } });
    if (url.pathname === "/api/public/text") {
      const offset = Number(q.get("offset") ?? "0"), plan = studyRangePlan(ranges, "torah", offset);
      return json(route, 200, { kind: "torah", ...date ? { date } : { ref }, offset, nextOffset: plan.nextOffset, totalVerses: list.length, translation: { key: "jps2023", status: "available" },
        verses: plan.refs.map(item => verseOf(item, list.indexOf(item))),
        chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: chapter.url, fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] })) });
    }
    if (url.pathname === "/api/public/commentary") return json(route, 200, { work: q.get("work"), chapter: q.get("chapter"), verses: {}, editions: [] });
    if (url.pathname === "/api/public/discussions") return json(route, 200, { discussions: [], productName: null });
    return json(route, 503, { error: "unavailable" });
  });
  return { calls, aliyot };
}

/** Throttles the page's CPU (a phone is about four times slower than a laptop) and reports the longest `event` entry while `action` runs. */
export async function longestEvent(page: Page, rate: number, action: () => Promise<void>): Promise<{ longest: number; entries: { name: string; duration: number }[] }> {
  const client = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    const w = window as unknown as { __events: { name: string; duration: number }[] };
    w.__events = [];
    new PerformanceObserver(list => { for (const entry of list.getEntries()) w.__events.push({ name: entry.name, duration: entry.duration }); }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate });
  try { await action(); await page.waitForTimeout(1500); }
  finally { await client.send("Emulation.setCPUThrottlingRate", { rate: 1 }); }
  const entries = await page.evaluate(() => (window as unknown as { __events: { name: string; duration: number }[] }).__events);
  return { longest: Math.max(0, ...entries.map(entry => entry.duration)), entries };
}
