import { expect, test } from "vitest";
import { addressOf, findReadings, NO_MATCH_LINE, parseDateText } from "../../src/lib/readings/find-reading";
import { nextShabbatot, type CalendarRow } from "../../src/lib/readings/calendar";

const TODAY = "2026-10-27";
// A synthetic fifteen months: names rotate through a few real ones; 2026-11-14 is Toldot and 2026-12-12 is a Chanukah Shabbat.
const NAMES = ["Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz"];
const calendar: CalendarRow[] = nextShabbatot(TODAY).map((date, i) => {
  if (date === "2026-12-12") return { date, name: "Chanukah Day 3 (on Shabbat)", kind: "holiday" } as const;
  return { date, name: NAMES[i % NAMES.length], kind: "regular" } as const;
});
const toldot = calendar.find(row => row.name === "Toldot")!;
const find = (text: string) => findReadings(text, { calendar, today: TODAY });

test("the synthetic calendar is a Saturday every week for 66 weeks", () => {
  expect(calendar).toHaveLength(66);
  expect(calendar[0].date).toBe("2026-10-31");
});

test("a name prefix lists the named reading with the next Shabbat it is read", () => {
  const [first] = find("Tol");
  expect(first).toMatchObject({ kind: "named", slug: "toldot", name: "Toldot", next: toldot.date });
});

test("a holiday name finds the holiday", () => {
  const results = find("Chanukah");
  expect(results.length).toBeGreaterThan(1);
  expect(results.every(result => result.kind === "named" && result.group === "special")).toBe(true);
  expect(results.find(result => result.kind === "named" && result.slug === "chanukah-day-3-on-shabbat")).toMatchObject({ next: "2026-12-12" });
});

test("an exact name comes first, before names that merely start with the text", () => {
  expect(find("Vayeshev")[0]).toMatchObject({ kind: "named", slug: "vayeshev" });
  const results = find("Vaye");
  expect(results.map(result => result.kind === "named" ? result.slug : "")).toEqual(["vayera", "vayetzei", "vayeshev", "vayechi", "vayeilech"]);
});

test("names ignore apostrophes, hyphens, spaces and capitals", () => {
  expect(find("behaalot")[0]).toMatchObject({ slug: "behaalotcha" });
  expect(find("LECH lecha")[0]).toMatchObject({ slug: "lech-lecha" });
  expect(find("kitis")[0]).toMatchObject({ slug: "ki-tisa" });
});

test("a date with no year is the next occurrence, and answers the Shabbat on or after it with that week's name", () => {
  for (const text of ["Nov 14", "11/14", "2026-11-14", "November 14 2026", "Nov 14, 2026"]) {
    expect(find(text)[0], text).toEqual({ kind: "date", date: "2026-11-14", name: "Toldot" });
  }
  // A weekday answers the Shabbat after it.
  expect(find("Nov 11")[0]).toEqual({ kind: "date", date: "2026-11-14", name: "Toldot" });
});

test("a month and day already past this year is next year's", () => {
  expect(parseDateText("Oct 1", TODAY)).toBe("2027-10-01");
  expect(parseDateText("Oct 27", TODAY)).toBe("2026-10-27");
  expect(parseDateText("Feb 30", TODAY)).toBeNull();
  expect(parseDateText("13/40", TODAY)).toBeNull();
});

test("a holiday Shabbat date answers the holiday row's name; a date outside the calendar answers no name", () => {
  expect(find("Dec 12")[0]).toEqual({ kind: "date", date: "2026-12-12", name: "Chanukah Day 3 (on Shabbat)" });
  expect(find("2020-01-04")[0]).toEqual({ kind: "date", date: "2020-01-04", name: null });
});

test("verses answer as a reference of the right kind", () => {
  expect(find("Genesis 25:19-26:5")).toEqual([{ kind: "ref", ref: "Genesis 25:19-26:5", readingKind: "torah" }]);
  expect(find("Isaiah 54")).toEqual([{ kind: "ref", ref: "Isaiah 54:1-17", readingKind: "haftarah" }]);
  expect(find("1 Samuel 1:1-2:10")[0]).toMatchObject({ kind: "ref", ref: "I Samuel 1:1-2:10", readingKind: "haftarah" });
  expect(find("Genesis 99:1")).toEqual([]);
  // Torah passages must stay in one book and move forward.
  expect(find("Genesis 25:19-4")).toEqual([]);
});

test("text that is both a parashah prefix and a book name keeps one ordered list, and the first is what Enter opens", () => {
  const results = find("Num");
  // Numbers' parashiyot are not found by the book's name; only names starting with "num" would be, and none does.
  expect(results.filter(result => result.kind === "named")).toEqual([]);
  expect(find("Exo")).toEqual([]);
  // "Shemot" is a parashah and "Exodus 1:1-6:1" is its verses: a name never hides a reference, and the name leads.
  const both = find("Genesis 1:1");
  expect(both[0]).toMatchObject({ kind: "ref" });
});

test("nothing is never an error, and no answer ever has more than eight rows", () => {
  expect(find("zzz")).toEqual([]);
  expect(find("   ")).toEqual([]);
  expect(find("s").length).toBeLessThanOrEqual(8);
  expect(find("s").length).toBe(8);
});

test("the no-match line is the approved sentence", () => {
  expect(NO_MATCH_LINE("zzz")).toBe("No reading called zzz. Try a parashah, a holiday, a date like Nov 14, or verses like Genesis 25:19.");
});

test("addressOf opens the reader, with the save offer when adding", () => {
  const [named] = find("Toldot"), [date] = find("Nov 14"), [ref] = find("Isaiah 54");
  expect(addressOf(named)).toBe("/read?reading=toldot");
  expect(addressOf(date)).toBe("/read?date=2026-11-14");
  expect(addressOf(ref)).toBe("/read?ref=Isaiah+54%3A1-17&kind=haftarah");
  expect(addressOf(named, { add: true })).toBe("/read?reading=toldot&save=1");
  expect(addressOf(named, { study: true })).toContain("lens=study");
});

test("with prepare, a name, a date and verses open Learn's preparation page", () => {
  expect(addressOf(find("Toldot")[0], { prepare: true })).toBe("/learn/prepare?ref=Genesis+25%3A19-28%3A9&kind=torah");
  expect(addressOf(find("Nov 14")[0], { prepare: true })).toBe("/learn/prepare?ref=Genesis+25%3A19-28%3A9&kind=torah");
  expect(addressOf(find("Isaiah 54")[0], { prepare: true })).toBe("/learn/prepare?ref=Isaiah+54%3A1-17&kind=haftarah");
});
