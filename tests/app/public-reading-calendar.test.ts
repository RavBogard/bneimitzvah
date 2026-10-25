import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicReadingService, type PublicWeek } from "../../src/server/public-reading/service";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { createHebcalReader, type CacheEntry, type HebcalCache } from "../../src/lib/readings/proposals";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { unavailableExtras } from "../helpers/translations";

/**
 * The public reading calendar against the two-year reference table (T10, 2026-11-01 to 2028-12-31, diaspora: two days of festivals).
 * Hebcal wins where Hebcal and Sefaria disagree (Daniel's ruling), so the table is Hebcal's answer and the site must agree with it.
 * `public-reading-hebcal-saturdays.json` is Hebcal's leyning answer for each of the 113 Saturdays, trimmed to dates, parashah names and references
 * (no text), replayed through the real Hebcal reader with the network stubbed. `public-reading-t10-reference.json` is the table itself.
 * Only Saturdays are reachable through /api/public/reading, so the weekday festival rows are not compared here.
 */
type Row = { date: string; hebrewDate: string; name: string; torah: string; maftir: string; haftarah: string; special: string };
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "portal", name), "utf8"));
const hebcal = fixture("public-reading-hebcal-saturdays.json") as Record<string, unknown[]>;
const table = fixture("public-reading-t10-reference.json") as Row[];

const NOW = Date.parse("2026-10-25T12:00:00Z");
const isSaturday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 6;
const saturdays = [...new Set(table.map(row => row.date).filter(isSaturday))];
/** The morning reading of the day: the eve and afternoon rows that share a Saturday are not the Shabbat's reading. */
const primary = (date: string) => table.find(row => row.date === date && !/^Erev |\(Mincha\)$/.test(row.name))!;
/** The table writes a several-part haftarah as "Isaiah 27:6-28:13, 29:22-23" or "Hosea 14:2-10; Joel 2:15-27"; the app lists each part with its book. */
function segments(ref: string): string[] {
  let book = "";
  return ref.split(/\s*[;,]\s*/).map(part => {
    const named = /^(\D+?)\s+(\d+:\d+(?:-(?:\d+:)?\d+)?)$/.exec(part);
    if (named) { book = named[1]; return part; }
    return `${book} ${part}`;
  });
}

const requested: string[] = [];
function calendar() {
  const entries = new Map<string, CacheEntry>();
  const cache: HebcalCache = { get: async key => entries.get(key) ?? null, set: async (key, entry) => { entries.set(key, entry); } };
  // Replays the recording; any other host or an unrecorded date fails loudly, so nothing here can reach the network.
  const fetch = vi.fn<typeof globalThis.fetch>(async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    expect(url.origin + url.pathname).toBe("https://www.hebcal.com/leyning");
    expect(url.searchParams.get("i")).toBe("off");
    const date = url.searchParams.get("date")!;
    requested.push(date);
    if (!hebcal[date]) throw new Error(`no recorded Hebcal answer for ${date}`);
    return new Response(JSON.stringify({ location: "Diaspora", range: { start: date, end: date }, items: hebcal[date] }), { headers: { "content-type": "application/json" } });
  });
  return { fetch, loadReading: createHebcalReader({ fetch, cache, verseCounts: TANAKH_VERSE_COUNTS, now: () => NOW }) };
}
function service() {
  const c = calendar();
  const reading = createPublicReadingService({ loadReading: c.loadReading, loadText: async () => { throw new Error("no text in these tests"); },
    stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: null, now: () => NOW });
  return { ...c, reading };
}
afterEach(() => vi.useRealTimers());

test("the reference table and the recording cover the same 113 Saturdays", () => {
  expect(table).toHaveLength(232);
  expect(saturdays).toHaveLength(113);
  expect(Object.keys(hebcal).sort()).toEqual([...saturdays].sort());
  for (const date of saturdays) expect(primary(date), date).toBeDefined();
});

test("every Saturday in the table resolves to the table's parashah, Torah and haftarah", async () => {
  const s = service(), failures: string[] = [];
  for (const date of saturdays) {
    const want = primary(date);
    let week: PublicWeek;
    try { week = await s.reading.week(date); } catch (error) { failures.push(`${date} ${want.name}: ${error instanceof Error ? error.message : "failed"}`); continue; }
    const got = { parashah: week.parashah, torah: week.torah?.ranges ?? null, haftarah: week.haftarah?.ranges ?? null };
    const expected = { parashah: want.name, torah: [want.torah], haftarah: want.haftarah ? segments(want.haftarah) : null };
    if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${date} ${want.name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(expected)}`);
  }
  expect(failures).toEqual([]);
  expect(new Set(requested).size).toBe(113);
});

// The eleven Saturdays the table found wrong on the live site, with what the table says each must show.
const ELEVEN: readonly [date: string, parashah: string, torah: string, haftarah: string][] = [
  ["2027-04-24", "Pesach Shabbat Chol ha-Moed", "Exodus 33:12-34:26", "Ezekiel 37:1-14"],
  ["2027-06-12", "Shavuot II (on Shabbat)", "Deuteronomy 14:22-16:17", "Habakkuk 3:1-19"],
  ["2027-07-24", "Pinchas", "Numbers 25:10-30:1", "Jeremiah 1:1-2:3"],
  ["2027-10-02", "Rosh Hashana I (on Shabbat)", "Genesis 21:1-34", "I Samuel 1:1-2:10"],
  ["2027-10-16", "Sukkot I (on Shabbat)", "Leviticus 22:26-23:44", "Zechariah 14:1-21"],
  ["2027-10-23", "Shmini Atzeret (on Shabbat)", "Deuteronomy 14:22-16:17", "I Kings 8:54-66"],
  ["2028-03-11", "Tetzaveh", "Exodus 27:20-30:10", "I Samuel 15:2-34"],
  ["2028-04-15", "Pesach Shabbat Chol ha-Moed", "Exodus 33:12-34:26", "Ezekiel 37:1-14"],
  ["2028-07-15", "Pinchas", "Numbers 25:10-30:1", "Jeremiah 1:1-2:3"],
  ["2028-09-30", "Yom Kippur (on Shabbat)", "Leviticus 16:1-34", "Isaiah 57:14-58:14"],
  ["2028-10-07", "Sukkot Shabbat Chol ha-Moed", "Exodus 33:12-34:26", "Ezekiel 38:18-39:16"],
];

test("the eleven dates the live site got wrong show the festival or special reading Hebcal gives", async () => {
  const s = service();
  for (const [date, parashah, torah, haftarah] of ELEVEN) {
    expect(table.some(row => row.date === date && row.name === parashah && row.torah === torah && row.haftarah === haftarah), date).toBe(true);
    const week = await s.reading.week(date);
    expect(week.parashah, date).toBe(parashah);
    expect(week.torah?.ranges, date).toEqual([torah]);
    expect(week.haftarah?.ranges, date).toEqual([haftarah]);
  }
});

test("the route answers the eleven dates with 200 and the same readings, with the network stubbed and the clock fixed", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const s = service();
  const runtime: PublicRuntime = { resolveTenant: async () => undefined, reading: s.reading, commentary: async () => { throw new Error("unused"); }, ...unavailableExtras };
  for (const [date, parashah, torah, haftarah] of ELEVEN) {
    const response = await handlePublicReadingRequest(new Request(`https://beitmitzvah.centralreform.org/api/public/reading?date=${date}`), action => action(runtime));
    expect(response.status, date).toBe(200);
    const body = await response.json() as { date: string; parashah: string; torah: { ranges: string[] }; haftarah: { ranges: string[] } };
    expect({ date: body.date, parashah: body.parashah, torah: body.torah.ranges, haftarah: body.haftarah.ranges }).toEqual({ date, parashah, torah: [torah], haftarah: [haftarah] });
  }
});

test("a second Hebcal item for the same day is set aside only when it is an eve or afternoon reading", async () => {
  const s = service();
  // The three Saturdays with a second item: the Shabbat or festival morning reading is the one shown, never the eve or the Mincha.
  for (const [date, also] of [["2027-10-23", "Erev Simchat Torah"], ["2028-03-11", "Erev Purim"], ["2028-09-30", "Yom Kippur (Mincha)"]] as const) {
    expect((hebcal[date] as { name: { en: string } }[]).map(item => item.name.en), date).toContain(also);
    expect((await s.reading.week(date)).parashah, date).not.toBe(also);
  }
  // Two real readings on one day still give no answer rather than a guess.
  const twin = [{ ...(hebcal["2028-03-11"] as object[])[0] as object }, { ...(hebcal["2028-03-11"] as object[])[0] as object }];
  const c = calendar();
  c.fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ location: "Diaspora", range: { start: "2028-03-11", end: "2028-03-11" }, items: twin }), { headers: { "content-type": "application/json" } }));
  const both = createPublicReadingService({ loadReading: c.loadReading, loadText: async () => { throw new Error("unused"); }, stepSource: { book: async () => Object.freeze([]), lexicon: async () => Object.freeze([]) }, pocketTorah: null, now: () => NOW });
  expect(await both.week("2028-03-11")).toMatchObject({ parashah: null, torah: null, haftarah: null });
});

test("Hebcal's one-verse overcount at Numbers 25:10-26:4 is accepted and stored as the catalog's count; no other count mismatch is", async () => {
  const read = (row: Record<string, unknown>) => {
    const item = { date: "2027-07-24", name: { en: "Synthetic" }, type: "shabbat", parshaNum: 41, fullkriyah: { 1: row } };
    const reader = createHebcalReader({ cache: { get: async () => null, set: async () => undefined }, verseCounts: TANAKH_VERSE_COUNTS, now: () => NOW,
      fetch: async () => new Response(JSON.stringify({ items: [item] }), { headers: { "content-type": "application/json" } }) });
    return reader("2027-07-24");
  };
  const seam = await read({ k: "Numbers", b: "25:10", e: "26:4", v: 14 });
  expect(seam.snapshot.reading?.aliyot[0]).toEqual({ n: 1, ref: "Numbers 25:10-26:4", verses: 13 });
  for (const row of [{ k: "Numbers", b: "25:10", e: "26:4", v: 15 }, { k: "Numbers", b: "25:10", e: "26:4", v: 12 }, { k: "Numbers", b: "24:1", e: "24:5", v: 6 },
    { k: "Numbers", b: "26:1", e: "26:4", v: 5 }, { k: "Genesis", b: "1:1", e: "1:3", v: 4 }]) await expect(read(row)).rejects.toMatchObject({ code: "invalid-response" });
});
