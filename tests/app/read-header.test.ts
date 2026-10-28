import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoreScope, ReadHeader } from "../../src/components/portal/public-reading/read-header";

// B6: the reader's More sheet is the Change sheet. The button says Change, the dialog is named Change reading, and its contents run
// Find a reading first, then "In this reading" over the passage's own controls, and nothing else: C1 and C3 moved the actions out.
const render = (open: boolean) => renderToStaticMarkup(createElement(MoreScope, { initiallyOpen: open, children: createElement(ReadHeader, { name: "Vayera", line: "Torah" }) }));

test("the button is Change, the sheet is Change reading, and nothing says More", () => {
  const markup = render(false);
  expect(markup).toMatch(/data-more-button=""[^>]*>Change<svg/);
  expect(markup).toContain(">Change reading</h");
  expect(markup).not.toContain(">More<");
  expect(markup).toContain('aria-haspopup="dialog"');
});

test("Find a reading comes first while the sheet is open, then In this reading, then the rest; closed, the calendar is not asked for", () => {
  const open = render(true);
  const find = open.indexOf('data-testid="find-reading"'), group = open.indexOf(">In this reading</h3>"), slot = open.indexOf("data-more-slot");
  expect([find, group, slot].every(at => at > -1)).toBe(true);
  expect([find, group, slot]).toEqual([find, group, slot].toSorted((a, b) => a - b));
  expect(open).toContain('data-place="sheet"');
  expect(render(false)).not.toContain('data-testid="find-reading"');
});
