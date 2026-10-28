import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReaderTitle, type Pill } from "../../src/components/portal/public-reading/reader-title";
import { MoreScope, ReadHeader } from "../../src/components/portal/public-reading/read-header";
import { LensSwitch } from "../../src/components/portal/workspace/lens-switch";
import { StudyLensScope } from "../../src/components/portal/workspace/study-lens";

// Readings for everyone C1: one title block for the public reader, and no week arrows or eyebrow anywhere in it.
const change: Pill = { key: "change", label: "Change", icon: "chevron", haspopup: "dialog", onClick: () => {} };
const save: Pill = { key: "save", label: "Save", accessibleName: "Save to My Readings", icon: "bookmark", onClick: () => {} };

test("the title block is the h1, one muted line and the pills with their accessible names", () => {
  const markup = renderToStaticMarkup(createElement(ReaderTitle, { name: "Vayera", line: "Saturday, October 31, 2026 · Torah Genesis 18:1-22:24", pills: [change, save] }));
  expect(markup).toMatch(/<h1 id="public-reading-title"[^>]*tabindex="-1"[^>]*>Vayera<\/h1>/);
  expect(markup).toContain("data-reading-ranges");
  expect(markup).toContain("Saturday, October 31, 2026");
  expect(markup).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*data-pill="change"|data-pill="change"[^>]*aria-haspopup="dialog"/);
  expect(markup).toMatch(/aria-label="Save to My Readings"/);
  expect((markup.match(/<svg/g) ?? []).length).toBe(2);
});

test("a rendered reader header has no week arrows and no eyebrow", () => {
  const markup = renderToStaticMarkup(createElement(MoreScope, { children: createElement(ReadHeader, { name: "Vayera", line: "October 31" }) }));
  expect(markup).not.toMatch(/Previous week|Next week/);
  expect(markup).toMatch(/data-more-button=""/);
  expect(markup).not.toMatch(/data-read-week|class="[^"]*eyebrow/);
});

test("a signed-out save pill is a sign-in link, not a button", () => {
  const markup = renderToStaticMarkup(createElement(ReaderTitle, { name: "Vayera", line: "", pills: [{ ...save, label: "Sign in to save", signIn: () => "/read" }] }));
  expect(markup).toMatch(/<a [^>]*href="\/sign-in"[^>]*>Sign in to save/);
});

test("the Lein | Study switch has two pressed-state buttons with an icon each", () => {
  const markup = renderToStaticMarkup(createElement(StudyLensScope, { storageKey: "x", query: null, children: createElement(LensSwitch) }));
  expect((markup.match(/aria-pressed=/g) ?? []).length).toBe(2);
  expect((markup.match(/<svg/g) ?? []).length).toBe(2);
});

// C3: Print, the trope chart and the blessings are a quiet row after the last verse.
import { ReadingFoot } from "../../src/components/portal/public-reading/reading-foot";
test("the foot row is a labelled navigation with Print, the trope chart and the blessings after the text", () => {
  const markup = renderToStaticMarkup(createElement(ReadingFoot, { print: "/print?date=2026-10-31", blessings: createElement("p", { "data-siddur-blessings": "" }, "blessings") }));
  expect(markup).toMatch(/<nav[^>]*aria-label="After the reading"/);
  expect(markup).toContain('href="/print?date=2026-10-31"');
  expect(markup).toContain('href="/trope-chart"');
  expect(markup).toContain("data-siddur-blessings");
  expect(renderToStaticMarkup(createElement(ReadingFoot, {}))).not.toContain(">Print<");
});
