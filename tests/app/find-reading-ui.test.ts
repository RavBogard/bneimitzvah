import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chipLabel, comingUp, FindReadingView, keyAction, resultLabel, type FindCalendar } from "../../src/components/portal/find-reading/find-reading";
import { findReadings } from "../../src/lib/readings/find-reading";
import { nextShabbatot, type CalendarRow } from "../../src/lib/readings/calendar";

const TODAY = "2026-10-27"; // a Tuesday; this Shabbat is 2026-10-31
const NAMES = ["Vayera", "Chayei Sara", "Toldot", "Vayetzei", "Vayishlach", "Vayeshev", "Miketz"];
const rows: CalendarRow[] = nextShabbatot(TODAY).map((date, i) => ({ date, name: NAMES[i % NAMES.length], kind: "regular" as const }));
const ready: FindCalendar = { status: "ready", rows, today: TODAY };
const render = (props: Partial<Parameters<typeof FindReadingView>[0]> = {}) =>
  renderToStaticMarkup(createElement(FindReadingView, { place: "home", calendar: ready, text: "", active: -1, ...props }));

test("the field is labelled, the calendar button is named, and four Coming up chips are links with this Shabbat first", () => {
  const markup = render();
  expect(markup).toMatch(/<label[^>]*for="[^"]+-field"[^>]*>Find a reading<\/label>/);
  expect(markup).toContain('role="combobox"');
  expect(markup).toContain('aria-label="Pick a date"');
  expect(markup).toContain('role="listbox"');
  expect(markup.match(/data-chip-date=/g)).toHaveLength(4);
  expect(markup).toMatch(/<a[^>]*href="\/read"[^>]*data-chip-date="2026-10-31"[^>]*>This Shabbat<\/a>/);
  expect(markup).toContain('href="/read?date=2026-11-07"');
  expect(markup).toMatch(/<a href="\/readings">Every parashah, holiday and passage<\/a>/);
});

test("on the index there are no chips and no link to itself", () => {
  const markup = render({ place: "index" });
  expect(markup).not.toContain("data-chip-date");
  expect(markup).not.toContain("Every parashah, holiday and passage");
  expect(markup).not.toContain("Coming up");
});

test("typing Tol lists Toldot as an option, and the first option is the one Enter opens", () => {
  const markup = render({ text: "Tol", active: -1 });
  expect(markup).toMatch(/role="option"[^>]*>Toldot · next Nov 14<\/li>/);
  expect(markup).not.toContain("No reading called");
  const results = findReadings("Tol", { calendar: rows, today: TODAY });
  expect(keyAction("Enter", -1, results.length)).toEqual({ active: -1, open: 0 });
  expect(resultLabel(results[0])).toBe("Toldot · next Nov 14");
});

test("arrow keys move the highlight and stop at the ends; Enter opens the highlighted one", () => {
  expect(keyAction("ArrowDown", -1, 3)).toEqual({ active: 0, open: null });
  expect(keyAction("ArrowDown", 2, 3)).toEqual({ active: 2, open: null });
  expect(keyAction("ArrowUp", 0, 3)).toEqual({ active: 0, open: null });
  expect(keyAction("Enter", 1, 3)).toEqual({ active: 1, open: 1 });
  expect(keyAction("Enter", -1, 0)).toEqual({ active: -1, open: null });
  expect(render({ text: "Vaye", active: 1 })).toMatch(/aria-activedescendant="[^"]+-option-1"/);
});

test("an unknown text shows the no-match line as a status; at most eight options are ever listed", () => {
  expect(render({ text: "zzz" })).toMatch(/role="status">No reading called zzz\. Try a parashah/);
  expect(render({ text: "s" }).match(/role="option"/g)!.length).toBeLessThanOrEqual(8);
});

test("while the calendar loads the chips hold their row, and a failed calendar says so with Try again and keeps the field", () => {
  const loading = render({ calendar: { status: "loading" } });
  expect(loading.match(/aria-hidden="true"/g)!.length).toBeGreaterThanOrEqual(4);
  expect(loading).toContain('aria-busy="true"');
  const failed = render({ calendar: { status: "failed" }, text: "Tol" });
  expect(failed).toContain("Couldn’t load the calendar.");
  expect(failed).toContain(">Try again</button>");
  expect(failed).toMatch(/role="option"[^>]*>Toldot<\/li>/); // names still answer; there is no next date to show
});

test("the add flow carries the save offer to every chip and to the index link", () => {
  const markup = render({ add: true });
  expect(markup).toContain('href="/read?save=1"');
  expect(markup).toContain('href="/read?date=2026-11-07&amp;save=1"');
  expect(markup).toContain('href="/readings?add=1"');
});

test("on a Saturday the home's chips begin after today, because the hero already leads with that week", () => {
  const sat = "2026-10-31";
  expect(comingUp(rows, sat, "home")[0].date).toBe("2026-11-07");
  expect(comingUp(rows, sat, "sheet")[0].date).toBe(sat);
  expect(chipLabel(rows[0], sat)).toBe("This Shabbat");
  expect(chipLabel({ date: "2026-12-05", name: null, kind: "other" }, TODAY)).toBe("Dec 5");
});

// The one wording test for this component: approved copy, change only with the copy.
test("wording: the label, the placeholder and the link text", () => {
  const markup = render();
  expect(markup).toContain(">Find a reading</label>");
  expect(markup).toContain('placeholder="A parashah, a holiday, a date or verses"');
  expect(markup).toContain(">Every parashah, holiday and passage</a>");
});
