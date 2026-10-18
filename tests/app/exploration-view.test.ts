import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ExplorationContent } from "../../src/components/portal/workspace/study/exploration-view";
import { FlowingStudyText } from "../../src/components/portal/workspace/study/annotations";
import { explorationPage, explorationPrepared } from "./exploration-client-helper";
const actions = { group: "synthetic-proposal", retry() {}, page() {}, refresh() {} };

test("proposed text uses flowing Hebrew/qere and real credits without fake Hear/word/progress/draft controls", () => {
  const markup = renderToStaticMarkup(createElement(ExplorationContent, { ...actions, state: { pending: false, result: explorationPrepared(), page: explorationPage() } }));
  expect(markup).toContain('aria-label="Proposed Torah portion"'); expect(markup).toContain("Verses 1–100 of 146");
  expect(markup).toContain("not an assigned reading yet"); expect(markup).toContain("read / qere:"); expect(markup).toContain("About this text"); expect(markup).toContain("CC-BY-SA-4.0");
  expect(markup).toContain("Next text page"); expect(markup).not.toMatch(/Hear word|aria-label="Hear |role="button"|<audio|data-reference-active="true"|Translation draft|Mark practiced/);
});

test("readonly flowing renderer removes listening affordances but assigned renderer keeps exact accessible callbacks", () => {
  const verses = explorationPage().verses.slice(0, 2), common = { verses, assignment: { kind: "torah" as const, confirmed: false, verses: [] }, group: "synthetic", activeWord: null };
  const read = renderToStaticMarkup(createElement(FlowingStudyText, common));
  expect(read).not.toContain('role="button"'); expect(read).not.toContain('aria-label="Hear'); expect(read).toContain("<sup");
  const assigned = renderToStaticMarkup(createElement(FlowingStudyText, { ...common, onWord() {}, onVerse() {} }));
  expect(assigned).toContain('aria-label="Hear Genesis 1:1"'); expect(assigned).toContain('role="button"'); expect(assigned).toContain("Hear word 1 of Genesis 1:1");
});

test("unresolved slot and temporary failures offer honest recovery with no invented portion or assignment operation", () => {
  const prepared = explorationPrepared(), { binding: _binding, expiresAt: _expiry, ranges: _ranges, portion: _portion, pages: _pages, verseCount: _count, sourceFetchedAt: _fetched, ...context } = prepared;
  const unresolved = renderToStaticMarkup(createElement(ExplorationContent, { ...actions, state: { pending: false, result: { ...context, status: "unresolved", serviceSlot: "unknown", readingDate: null, reason: "unknown-slot" } } }));
  expect(unresolved).toContain("choose a service time"); expect(unresolved).toContain("Try again"); expect(unresolved).not.toContain("Genesis");
  const stale = renderToStaticMarkup(createElement(ExplorationContent, { ...actions, state: { pending: false, error: 409 } }));
  expect(stale).toContain("Refresh reading"); expect(stale).not.toContain("Checking your access");
});
