import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_FORMAT, describeFormat, formatEntries, formatFromRecord, parseFormat, SHEET_TYPE, type SheetFormat } from "../../src/lib/print/sheet-format";
import { parsePrintAddress, printAddress, printTargetFromRead, PRINT_PATH, readAddressOfPrint, refFromVerses } from "../../src/lib/print/print-address";
import { aliyahStartsIn, parsePortions, portionRef, portionsOf, type WeekPortions } from "../../src/lib/print/portions";
import { sheetHebrew } from "../../src/components/portal/print/hebrew";
import { PrintDocument, sheetCredits, type SheetText } from "../../src/components/portal/print/document";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import { handlePublicReadingRequest, type PublicRuntime } from "../../src/server/http/public-reading";
import { thisShabbat, addDays } from "../../src/lib/readings/public-shabbat";
import { parseCeremonyDate } from "../../src/lib/readings/ranges";
import type { Snapshot } from "../../src/lib/readings/proposals";

// The reader's print sheet. Invented Hebrew (letters and marks built from code points) and numbered English only:
// never a verse of any edition.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const ALEF = 0x05d0, BET = 0x05d1, GIMEL = 0x05d2, QAMATS = 0x05b8, PATAH = 0x05b7, ETNAHTA = 0x0591, METEG = 0x05bd, MAQAF = 0x05be, PASEQ = 0x05c0, SOF_PASUQ = 0x05c3;
const invented = (n: number) => `${cp(ALEF, QAMATS, ETNAHTA, BET, PATAH)}${cp(MAQAF)}${cp(GIMEL, QAMATS, METEG)} ${cp(PASEQ)} ${cp(BET, PATAH)}${n % 2 ? "" : cp(SOF_PASUQ)}`.normalize("NFC");
const verse = (ref: string, n: number, extra: Partial<StudyVerse["hebrew"]> = {}): StudyVerse => {
  const text = invented(n);
  return { ref, english: `Synthetic English for verse ${n}.`, hebrew: { text, readingText: text, segments: [{ kind: "text", text }], paragraphAfter: null, ...extra } };
};
const chapter = (ref: string) => ({ ref, sefariaUrl: `https://www.sefaria.org/${ref.replace(" ", ".")}`, fetchedAt: 0, hash: "a".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] });

const regular = (date: string): Snapshot => ({ date: parseCeremonyDate(date), calendar: "diaspora", classification: "regular", haftarah: "Isaiah 1:1-3",
  reading: { parashah: "Synthetic portion", type: "shabbat", summary: "", source: "Hebcal",
    aliyot: [{ n: 1, ref: "Genesis 1:1-5" }, { n: 2, ref: "Genesis 1:6-8" }, { n: 3, ref: "Genesis 1:9-13" }, { n: 4, ref: "Genesis 1:14-19" }, { n: 5, ref: "Genesis 1:20-23" },
      { n: 6, ref: "Genesis 1:24-31" }, { n: 7, ref: "Genesis 2:1-3" }, { n: "M", ref: "Genesis 2:1-3" }],
    triennial: { year: 2, aliyot: [{ n: 1, ref: "Genesis 1:1-2" }, { n: 2, ref: "Genesis 1:3-4" }, { n: 3, ref: "Genesis 1:5-6" }, { n: 4, ref: "Genesis 1:7-8" }, { n: 5, ref: "Genesis 1:9-10" }, { n: 6, ref: "Genesis 1:11-12" }, { n: 7, ref: "Genesis 1:13-14" }] } } });

test("the format lives in the address: defaults are left out, every field round-trips, unknown values fall back", () => {
  expect(formatEntries(DEFAULT_FORMAT)).toEqual([]);
  const custom: SheetFormat = { show: "hebrew", script: "vowels", size: "huge", aliyot: "page", numbers: false, notes: "lined", paper: "a4", orientation: "landscape", spacing: "standing", edition: "jps2023", commentary: ["rashi", "womens", "ramban"], discussions: false };
  const entries = formatEntries(custom);
  expect(entries.map(([key]) => key)).toEqual(["show", "script", "size", "aliyot", "numbers", "notes", "paper", "orient", "spacing", "comm"]);
  expect(entries.at(-1)).toEqual(["comm", "rashi,womens,ramban"]);
  expect(parseFormat(new URLSearchParams(entries))).toEqual(custom);
  // Commentary is off by default; the address names works in registry order, once each, registered works only.
  expect(parseFormat(new URLSearchParams("comm=womens,nonsense,rashi,rashi")).commentary).toEqual(["rashi", "womens"]);
  expect(parseFormat(new URLSearchParams("comm=")).commentary).toEqual([]);
  expect(formatEntries({ ...DEFAULT_FORMAT, commentary: ["womens", "rashi"] })).toEqual([["comm", "rashi,womens"]]);
  expect(formatFromRecord({ commentary: ["womens", "rashi"] })).toEqual({ format: { ...DEFAULT_FORMAT, commentary: ["rashi", "womens"] }, problems: [] });
  expect(formatFromRecord({ commentary: ["rashi", "not-a-work"] }).problems[0]).toContain("format.commentary must be a list of works from rashi, womens");
  expect(formatFromRecord({ commentary: "rashi" }).problems).toHaveLength(1);
  expect(describeFormat({ ...DEFAULT_FORMAT, commentary: ["rashi"] })).toContain("commentary on a new page after the reading (Rashi; only editions licensed for print)");
  expect(parseFormat(new URLSearchParams("show=klingon&size=&numbers=maybe&en=other&paper=A4"))).toEqual(DEFAULT_FORMAT);
  // Every size step sets the Hebrew larger than the English; Huge is large print.
  for (const step of Object.values(SHEET_TYPE)) expect(step.hebrew).toBeGreaterThan(step.english);
  expect(SHEET_TYPE.huge.english).toBeGreaterThanOrEqual(16);
});

test("a loose format record (the MCP's) is checked field by field and never guessed", () => {
  expect(formatFromRecord(undefined)).toEqual({ format: DEFAULT_FORMAT, problems: [] });
  expect(formatFromRecord({ size: "large", numbers: false }).format).toMatchObject({ size: "large", numbers: false, show: "both" });
  expect(formatFromRecord({ size: "giant", numbers: "no", colour: "red" }).problems).toEqual(["format.size must be one of small, standard, large, huge", "format.numbers must be true or false", "unknown format field colour"]);
  expect(formatFromRecord([]).problems).toEqual(["format must be an object"]);
  expect(describeFormat(DEFAULT_FORMAT)).toBe("Hebrew (vowels and trope) and English (JPS 2023) side by side, Hebrew on the right, standard type, verse numbers, aliyot marked in the text, no notes column, US Letter portrait.");
});

test("print addresses: plain /print is this Shabbat; every reading form and a portion pick round-trip with the format", () => {
  const today = thisShabbat(), next = addDays(today, 7);
  expect(printAddress({ mode: "week", date: today, kind: null, pick: "full" }, DEFAULT_FORMAT, { today })).toBe(PRINT_PATH);
  expect(parsePrintAddress("")).toEqual({ target: { mode: "week", date: null, kind: null, pick: "full" }, format: DEFAULT_FORMAT });
  // A link from the MCP always names its date.
  expect(printAddress({ mode: "week", date: today, kind: null, pick: "full" }, DEFAULT_FORMAT, { today: null })).toBe(`/print?date=${today}`);
  const big = { ...DEFAULT_FORMAT, size: "huge" as const };
  for (const target of [
    { mode: "week" as const, date: next, kind: null, pick: "aliyah-3" as const },
    { mode: "week" as const, date: next, kind: "haftarah" as const, pick: "full" as const },
    { mode: "named" as const, slug: "noach", passage: 2 },
    { mode: "ref" as const, ref: "Isaiah 40:1-11", kind: "haftarah" as const },
    { mode: "saved" as const, id: "0f0e0d0c-0b0a-4908-8706-050403020100" },
  ]) {
    const address = printAddress(target, big, { today });
    expect(address.startsWith("/print?")).toBe(true);
    expect(parsePrintAddress(address.slice(PRINT_PATH.length))).toEqual({ target, format: big });
  }
  // A haftarah has no portion; an unknown pick is the whole reading; an unopenable reading is null.
  expect(parsePrintAddress("?kind=haftarah&pick=aliyah-2").target).toMatchObject({ kind: "haftarah", pick: "full" });
  expect(parsePrintAddress("?pick=aliyah-9").target).toMatchObject({ pick: "full" });
  expect(parsePrintAddress("?reading=no-such-reading").target).toBeNull();
  expect(printTargetFromRead("/read?reading=bereshit&lens=study&verse=3")).toEqual({ mode: "named", slug: "bereshit", passage: 1 });
});

test("Back to the reading names the same reading and, for a Shabbat, the same part of it (1.9 N5)", () => {
  const today = "2026-10-24";
  expect(readAddressOfPrint({ mode: "week", date: null, kind: null, pick: "full" }, today)).toBe("/read");
  expect(readAddressOfPrint({ mode: "week", date: today, kind: null, pick: "full" }, today)).toBe("/read");
  expect(readAddressOfPrint({ mode: "week", date: "2026-10-31", kind: null, pick: "aliyah-4" }, today)).toBe("/read?date=2026-10-31&pick=aliyah-4");
  expect(readAddressOfPrint({ mode: "week", date: "2026-10-31", kind: "haftarah", pick: "full" }, today)).toBe("/read?date=2026-10-31&kind=haftarah");
  expect(readAddressOfPrint({ mode: "named", slug: "bereshit", passage: 2 }, today)).toBe("/read?reading=bereshit&passage=2");
  expect(readAddressOfPrint({ mode: "ref", ref: "Genesis 18:1-10", kind: "torah" }, today)).toBe("/read?ref=Genesis+18%3A1-10&kind=torah");
  expect(readAddressOfPrint({ mode: "saved", id: "00000000-0000-4000-8000-000000000042" }, today)).toBe("/read?saved=00000000-0000-4000-8000-000000000042");
  // It always round-trips to the same print target.
  for (const address of ["/read?date=2026-10-31&pick=aliyah-4", "/read?reading=bereshit", "/read?ref=Genesis+18%3A1-10&kind=torah"]) {
    const target = printTargetFromRead(address)!;
    expect(printTargetFromRead(readAddressOfPrint(target, today))).toEqual(target);
  }
});

test("a Shabbat's portions come from the calendar: whole, triennial, one aliyah, maftir, and where each aliyah begins", () => {
  const date = thisShabbat(), portions = portionsOf(regular(date));
  expect(portions.full.map(row => row.n)).toEqual(["1", "2", "3", "4", "5", "6", "7", "M"]);
  expect(portionRef(portions, "full")).toBe("Genesis 1:1-2:3");
  expect(portionRef(portions, "triennial")).toBe("Genesis 1:1-14");
  expect(portionRef(portions, "aliyah-2")).toBe("Genesis 1:6-8");
  expect(portionRef(portions, "maftir")).toBe("Genesis 2:1-3");
  expect(portionsOf({ ...regular(date), classification: "holiday" })).toMatchObject({ full: [], triennial: null });
  expect(portionRef(portionsOf({ ...regular(date), classification: "holiday" }), "aliyah-1")).toBeNull();
  const genesis = ["Genesis 1:5", "Genesis 1:6", "Genesis 1:7", "Genesis 1:8", "Genesis 1:9"];
  expect([...aliyahStartsIn(portions, "full", genesis)]).toEqual([["Genesis 1:6", "2"], ["Genesis 1:9", "3"]]);
  expect([...aliyahStartsIn(portions, "triennial", genesis)]).toEqual([["Genesis 1:5", "3"], ["Genesis 1:7", "4"], ["Genesis 1:9", "5"]]);
  // The route's body parses strictly: a round trip, and nothing extra or malformed.
  const body = JSON.parse(JSON.stringify(portions));
  expect(parsePortions(body, date)).toEqual(portions);
  for (const bad of [{ ...body, extra: 1 }, { ...body, date: addDays(date, 7) }, { ...body, full: [{ n: "9", ref: "Genesis 1:1-5" }] }, { ...body, full: [{ n: "1", ref: "Genesis 1:1-99" }] },
    { ...body, triennial: { year: 4, aliyot: [] } }]) expect(parsePortions(bad, date)).toBeNull();
});

test("the three Hebrew scripts: as given, without cantillation, and the scroll's letters with word spaces", () => {
  const text = invented(2);
  expect(sheetHebrew(text, "full")).toBe(text);
  const vowels = sheetHebrew(text, "vowels");
  expect([...vowels.normalize("NFD")].some(char => { const c = char.codePointAt(0)!; return c >= 0x0591 && c <= 0x05af || c === METEG || c === PASEQ; })).toBe(false);
  expect(vowels).toContain(cp(QAMATS)); expect(vowels).toContain(cp(MAQAF)); expect(vowels).toContain(cp(SOF_PASUQ));
  expect(vowels).not.toMatch(/ {2}/);
  expect(sheetHebrew(text, "letters")).toBe(`${cp(ALEF, BET)} ${cp(GIMEL)} ${cp(BET)}`);
});

const text = (verses: StudyVerse[]): SheetText => ({ verses, chapters: [chapter("Genesis 1"), chapter("Genesis 3")] });
const render = (format: Partial<SheetFormat>, verses: StudyVerse[], markers = new Map<string, string>()) =>
  renderToStaticMarkup(createElement(PrintDocument, { heading: { title: "Synthetic portion", passage: "Torah Genesis 1:1–3", date: "2026-10-24" }, text: text(verses), markers, format: { ...DEFAULT_FORMAT, ...format }, productName: "Test Torah" }));

test("the document: English, the verse number, then Hebrew on the right, the credit on every page, aliyot and jumps marked", () => {
  const verses = [verse("Genesis 1:1", 1), verse("Genesis 1:2", 2, { paragraphAfter: "setumah", segments: [{ kind: "text", text: invented(2) }, { kind: "gap", break: "setumah" }] }), verse("Genesis 3:5", 3)];
  const html = render({}, verses, new Map([["Genesis 1:2", "2"]]));
  const row = /<tr[^>]*data-verse-ref="Genesis 1:1"[^>]*>(.*?)<\/tr>/.exec(html)![1];
  expect([...row.matchAll(/<td class="([^"]+)"/g)].map(match => match[1].split("_")[1] ?? match[1])).toEqual(["english", "number", "hebrew"]);
  expect(row).toContain('lang="he" dir="rtl"');
  // The running head and the credit are the table's head and foot, which print on every page.
  expect(html).toMatch(/<thead>.*Synthetic portion.*Torah Genesis 1:1–3.*Saturday, October 24, 2026.*<\/thead>/);
  expect(html).toMatch(/<tfoot>.*Hebrew: Miqra according to the Masorah.*CC BY-SA 4\.0.*English: THE JPS TANAKH: Gender-Sensitive Edition, The Jewish Publication Society, 2023, via Sefaria \(CC BY-NC 4\.0\).*Test Torah.*<\/tfoot>/);
  expect(html).toContain("Aliyah 2");
  expect(html).toContain(">Genesis 3:5<"); // the reading skips: its new place is shown
  expect(html).toMatch(/>1:1<.*>2<.*>3:5</);
  expect(html).toContain("ס"); // the closed paragraph after verse 2
  expect(html).not.toMatch(/\bbeta\b|\balpha\b/i);
});

test("each format changes the document, and the edition credit follows exactly what is printed", () => {
  const verses = [verse("Genesis 1:1", 1), verse("Genesis 1:2", 2)];
  expect(render({ show: "hebrew" }, verses)).not.toContain("Synthetic English");
  expect(render({ show: "hebrew" }, verses)).not.toContain("English: THE JPS");
  expect(render({ show: "english" }, verses)).not.toContain("Hebrew: Miqra");
  expect(render({ show: "english" }, verses)).not.toContain('lang="he"');
  expect(render({ numbers: false }, verses)).not.toContain(">1:1<");
  expect(render({ notes: "lined" }, verses)).toMatch(/data-notes="lined"/);
  expect(render({ size: "huge", spacing: "standing", aliyot: "page", orientation: "landscape" }, verses)).toMatch(/data-size="huge".*data-spacing="standing".*data-aliyot="page".*data-orientation="landscape"/);
  expect(render({ size: "huge" }, verses)).toContain("--he-size:28pt");
  const missing = [{ ...verse("Genesis 1:1", 1), english: null }];
  expect(render({}, missing)).toContain("English reference unavailable for this verse.");
  expect(sheetCredits(text(missing), DEFAULT_FORMAT)).toEqual(["Hebrew: Miqra according to the Masorah, Dovi and Hebrew Wikisource contributors, via Sefaria (CC BY-SA 4.0)."]);
});

test("/api/public/aliyot answers a Shabbat's calendar aliyot, numbers only, cacheable and noindex; anything else is refused before any runtime opens", async () => {
  const date = thisShabbat();
  let opened = 0;
  const portions = vi.fn(async (value: string): Promise<WeekPortions> => portionsOf(regular(value)));
  const runtime = { resolveTenant: async () => undefined, reading: { portions } } as unknown as PublicRuntime;
  const call = (query: string, init: RequestInit = {}) => handlePublicReadingRequest(new Request(`https://beitmitzvah.centralreform.org/api/public/aliyot${query}`, init), async action => { opened++; return action(runtime); });
  const ok = await call(`?date=${date}`);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(ok.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=3600");
  const body = await ok.json();
  expect(parsePortions(body, date)).toEqual(portionsOf(regular(date)));
  expect(Object.keys(body)).toEqual(["date", "parashah", "full", "triennial"]);
  expect(opened).toBe(1);
  for (const query of ["", `?date=${addDays(date, 1)}`, `?date=${date}&kind=torah`, "?date=2026-02-30", `?date=${addDays(date, 7 * 400)}`]) expect((await call(query)).status).toBe(400);
  expect((await call(`?date=${date}`, { method: "POST", body: "{}" })).status).toBe(405);
  expect(opened).toBe(1);
});

test("/print is never for search engines, even with indexing on, and its title ends with the product name", async () => {
  vi.resetModules();
  vi.doMock("../../src/server/public-site/names", () => ({ readPublicProductName: async () => "Test Torah" }));
  vi.doMock("../../src/lib/site/indexing", async importOriginal => {
    const original = await importOriginal<typeof import("../../src/lib/site/indexing")>();
    return { ...original, PUBLIC_INDEXING: true, publicRobots: () => original.publicRobots(true) };
  });
  const page = await import("../../src/app/print/page"), { NOINDEX_META, noindexHeaderRule } = await import("../../src/lib/site/indexing");
  const metadata = await page.generateMetadata();
  expect(metadata.robots).toEqual(NOINDEX_META);
  expect(metadata.title).toBe("Print | Test Torah");
  expect(noindexHeaderRule(true).source).not.toContain("print");
  vi.doUnmock("../../src/server/public-site/names"); vi.doUnmock("../../src/lib/site/indexing"); vi.resetModules();
});

test("review fixes: a skip to a later chapter's first verse is marked, and the maftir keeps its own label", () => {
  const html = render({}, [verse("Genesis 1:1", 1), verse("Genesis 1:31", 2), verse("Genesis 2:1", 3), verse("Genesis 2:2", 4), verse("Genesis 3:1", 5)]);
  expect(html).toContain(">Genesis 1:31<"); // 1:1 to 1:31 skips
  expect(html).not.toContain(">Genesis 2:1<"); // 1:31 is Genesis 1's last verse: 2:1 follows on
  expect(html).toContain(">Genesis 3:1<"); // Genesis 2 has 25 verses: 2:2 to 3:1 skips
  const shared: WeekPortions = { date: thisShabbat(), parashah: "Synthetic portion", triennial: null,
    full: [{ n: "1", ref: "Genesis 1:1-3" }, { n: "7", ref: "Genesis 1:4-6" }, { n: "M", ref: "Genesis 1:4-6" }] };
  expect(aliyahStartsIn(shared, "full", ["Genesis 1:4"]).get("Genesis 1:4")).toBe("7");
  expect(aliyahStartsIn(shared, "maftir", ["Genesis 1:4"]).get("Genesis 1:4")).toBe("M");
});

test("an assigned reading's verses open on the sheet as one canonical ref, whatever form its ranges were stored in", () => {
  const genesis = (from: number, to: number, chapter = 1) => Array.from({ length: to - from + 1 }, (_, i) => `Genesis ${chapter}:${from + i}`);
  expect(refFromVerses(genesis(1, 25), "torah")).toBe("Genesis 1:1-25");
  expect(refFromVerses([...genesis(30, 31), ...genesis(1, 2, 2)], "torah")).toBe("Genesis 1:30-2:2");
  expect(refFromVerses([...genesis(1, 3), ...genesis(5, 6)], "torah")).toBe("Genesis 1:1-3; Genesis 1:5-6");
  expect(refFromVerses(["Isaiah 27:6", "Isaiah 29:22"], "haftarah")).toBe("Isaiah 27:6; Isaiah 29:22");
  expect(refFromVerses(["Genesis 1:1"], "haftarah")).toBeNull();
  expect(refFromVerses([], "torah")).toBeNull();
  expect(refFromVerses(["not a verse"], "torah")).toBeNull();
});

// 1.9 N8 (G18): a ketiv and its qere on paper. The qere is chanted, so it is set full size and flagged "read", the ketiv follows small; "Letters only"
// is the scroll's own lettering in the Stam face and drops the apparatus: the ketiv alone, no qere, no chip.
const qereVerse = (ref: string): StudyVerse => {
  const before = cp(BET, PATAH, ALEF), written = cp(GIMEL, QAMATS), read = cp(ALEF, PATAH, BET), after = cp(BET, PATAH, SOF_PASUQ);
  return { ref, english: "Synthetic English.", hebrew: { text: `${before} ${written} ${after}`.normalize("NFC"), readingText: `${before} ${read} ${after}`.normalize("NFC"), paragraphAfter: null,
    segments: [{ kind: "text", text: `${before} ` }, { kind: "alternative", written: written.normalize("NFC"), read: read.normalize("NFC") }, { kind: "text", text: ` ${after}` }] } };
};
test("on paper the qere is full size and flagged, the ketiv small after it, and Letters only drops the apparatus and uses the scroll face", () => {
  const verses = [qereVerse("Genesis 1:1")], ketiv = cp(GIMEL, QAMATS).normalize("NFC"), qere = cp(ALEF, PATAH, BET).normalize("NFC");
  for (const script of ["full", "vowels"] as const) {
    const html = render({ script }, verses);
    expect(html).toMatch(new RegExp(`<span>${qere}</span> <span class="[^"]*qere[^"]*" lang="en" dir="ltr">read<span class="sr-only">\\. Chant this word \\(qere\\)\\. The scroll writes it differently \\(ketiv\\)\\.</span></span> <span class="[^"]*written[^"]*">${ketiv}</span>`));
    expect(html).not.toContain("read / qere:");
    expect(html).toContain(`data-script="${script}"`);
  }
  const letters = render({ script: "letters" }, verses);
  expect(letters).toContain('data-script="letters"');
  expect(letters).toContain(sheetHebrew(ketiv, "letters"));
  expect(letters).not.toContain(sheetHebrew(qere, "letters")); // the read word is not on the scroll
  expect(letters).not.toMatch(/>read</);
  expect(letters).not.toContain("Chant this word");
  expect(letters).not.toMatch(/class="[^"]*alternative/);
});
