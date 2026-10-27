import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namedHref, nextDates, parseIndexMode, ReadingsIndexView, type IndexMode } from "../../src/components/portal/readings-index";
import type { FindCalendar } from "../../src/components/portal/find-reading/find-reading";
import { nextShabbatot, type CalendarRow } from "../../src/lib/readings/calendar";
import { NAMED_READINGS, namedReading } from "../../src/lib/readings/named-readings";
import { TORAH_BOOKS } from "../../src/lib/readings/ranges";
import ReadingsPage, { generateMetadata } from "../../src/app/readings/page";

const TODAY = "2026-10-27";
const NAMES = ["Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz"];
const rows: CalendarRow[] = nextShabbatot(TODAY).map((date, i) => ({ date, name: NAMES[i % NAMES.length], kind: i === 5 ? "holiday" as const : "regular" as const }));
const ready: FindCalendar = { status: "ready", rows, today: TODAY };
const NONE: IndexMode = { add: false, prepare: false };
const render = (calendar: FindCalendar = ready, mode: IndexMode = NONE) => renderToStaticMarkup(createElement(ReadingsIndexView, { calendar, mode }));
const hrefs = (markup: string) => [...markup.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&"));

test("the index has one h1, the Torah's five books in order with the book read next open, and a link for every parashah", () => {
  const markup = render();
  expect(markup.match(/<h1/g)).toHaveLength(1);
  expect(markup).toContain(">Readings</h1>");
  const order = TORAH_BOOKS.map(book => markup.indexOf(`data-book="${book}"`));
  expect(order.every(at => at > -1)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Vayera is the parashah read next, in Genesis: only Genesis is open.
  expect(markup).toMatch(/<details[^>]*open=""[^>]*data-book="Genesis"|<details[^>]*data-book="Genesis"[^>]*open=""/);
  expect(markup.match(/<details[^>]*\bopen=""/g)).toHaveLength(1);
  const parashot = NAMED_READINGS.filter(reading => reading.group === "parashah");
  for (const reading of parashot) expect(hrefs(markup), reading.slug).toContain(`/read?reading=${reading.slug}`);
  expect(parashot.length).toBeGreaterThanOrEqual(54);
});

test("each coming-up row names its Shabbat; the first says This Shabbat and a holiday row says Holiday; parashot show the next date they are read", () => {
  const markup = render();
  const coming = markup.slice(markup.indexOf('data-testid="readings-coming-up"'), markup.indexOf('id="readings-torah"'));
  expect(coming.match(/<time /g)).toHaveLength(6);
  expect(coming).toContain(">This Shabbat</span>");
  expect(coming).toContain(">Holiday</span>");
  expect(coming).toContain('href="/read"'); // this Shabbat is plain /read
  expect(markup).toContain(">next Nov 14</span>");
  expect(nextDates(rows, TODAY).get("toldot")).toBe("2026-11-14");
});

test("the holidays and special Shabbatot are listed by group, and the credit moves here", () => {
  const markup = render();
  for (const label of ["Special Shabbatot", "Festivals", "Fast days"]) expect(markup).toContain(`>${label}</h3>`);
  expect(hrefs(markup)).toContain("/read?reading=simchat-torah");
  expect(markup).toContain('href="https://www.hebcal.com/"');
  expect(markup).toContain("CC BY 4.0");
});

test("while the calendar loads six rows hold the list's height, and a failed calendar still lists every reading", () => {
  const loading = render({ status: "loading" });
  expect(loading).toContain('aria-busy="true"');
  expect(loading.match(/class="[^"]*rowSkeleton[^"]*"/g)?.length ?? 0).toBe(6);
  const failed = render({ status: "failed" });
  expect(failed).toContain("Couldn’t load the calendar.");
  expect(hrefs(failed)).toContain("/read?reading=bereshit");
});

test("with add=1 every reading link carries the save offer", () => {
  const links = hrefs(render(ready, { add: true, prepare: false })).filter(href => href.startsWith("/read"));
  expect(links.length).toBeGreaterThan(60);
  for (const href of links) expect(href, href).toMatch(/save=1$/);
  expect(parseIndexMode("?add=1")).toEqual({ add: true, prepare: false });
  expect(parseIndexMode("?add=2&add=1")).toEqual({ add: false, prepare: false });
});

test("with for=prepare the rows open the preparation page, with the reading's own passage", () => {
  const markup = render(ready, { add: false, prepare: true });
  const first = hrefs(markup).find(href => href.includes("learn/prepare"));
  expect(first).toMatch(/^\/learn\/prepare\?/);
  expect(namedHref(namedReading("noach")!, { add: false, prepare: true })).toBe("/learn/prepare?ref=Genesis+6%3A9-11%3A32&kind=torah");
  expect(parseIndexMode("?for=prepare")).toEqual({ add: false, prepare: true });
  expect(hrefs(markup).filter(href => href.startsWith("/read?reading="))).toEqual([]);
});

test("the page is public and carries the product name, and the verse pickers are on it", async () => {
  const meta = await generateMetadata();
  expect(String(meta.title)).toContain("Readings");
  expect(meta.referrer).toBe("no-referrer");
  const markup = renderToStaticMarkup(await ReadingsPage());
  expect(markup).toContain('id="readings-verses"');
  expect(markup).toContain("Skip to main content");
  expect(markup).toContain(">Torah</button>");
  expect(markup).toContain(">Prophets</button>");
});

// The one wording test for this screen: approved copy, change only with the copy.
test("wording: the section headings", () => {
  const markup = render();
  for (const heading of ["Readings", "Coming up", "The Torah, in order", "Holidays and special Shabbatot", "Any verses"]) expect(markup).toContain(`>${heading}</h`);
});
