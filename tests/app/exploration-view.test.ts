import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ExplorationContent } from "../../src/components/portal/workspace/study/exploration-view";
import { FlowingStudyText } from "../../src/components/portal/workspace/study/annotations";
import { explorationPage, explorationPrepared } from "./exploration-client-helper";
import { ReadingPlayer } from "../../src/components/portal/workspace/study/reading-player";
import { createReadingAudioCoordinator } from "../../src/components/portal/workspace/study/reading-audio-coordinator";
const actions = { group: "synthetic-proposal", retry() {}, page() {}, refresh() {} };

test("optional verse-bound English preserves the exact continuous flow, qere and active indices when removed", () => {
  const verses = explorationPage().verses.slice(0, 3).map((verse, index) => ({ ...verse, english: index === 1 ? null : `Synthetic English ${index + 1}: <script>not markup</script>` }));
  const props = { verses, assignment: { kind: "torah" as const, confirmed: false, verses: [] }, group: "companion", activeWord: { verse: 0, index: 1 }, onWord() {}, onVerse() {} };
  const render = (showEnglish?: boolean) => renderToStaticMarkup(createElement(FlowingStudyText, { ...props, ...(showEnglish === undefined ? {} : { showEnglish }) }));
  const off = render(false), on = render(true);
  expect(render()).toBe(off);
  expect(on.replace(/<span class="study-english [^"]+" lang="en" dir="ltr" data-english-ref="[^"]+">[^]*?<\/span>/g, "")).toBe(off);
  expect(on.match(/data-english-ref=/g)).toHaveLength(3);
  for (const verse of verses) expect(on).toContain(`data-english-ref="${verse.ref}"`);
  expect(on).toContain("English reference unavailable for this verse.");
  expect(on).toContain("&lt;script&gt;not markup&lt;/script&gt;"); expect(on).not.toContain("<script>");
  expect(off).toContain("read / qere:"); expect(off).toContain('data-reference-active="true"');
  expect(on.match(/data-word-index="\d+"/g)).toEqual(off.match(/data-word-index="\d+"/g));
  expect(render(false)).toBe(off);
});

test("reviewed proposed audio adds main verse controls and highlight without assigned tools or work", () => {
  const current = explorationPage(), load = vi.fn(), coordinator = createReadingAudioCoordinator();
  const player = createElement(ReadingPlayer, { scopeKey: "synthetic-proposal", verses: current.verses, active: true, wordTools: false,
    audio: { coordinator, slot: "proposed" }, load, register() {}, onActiveWord() {} });
  const markup = renderToStaticMarkup(createElement(ExplorationContent, { ...actions,
    state: { pending: false, result: explorationPrepared(), page: current },
    audio: { activeWord: { verse: 0, index: 0 }, onWord() {}, onVerse() {}, player } }));
  expect(markup).toContain('aria-label="Reading playback"'); expect(markup).toContain("Whole verse"); expect(markup).toContain("Practice");
  expect(markup).toContain('data-reference-active="true"'); expect(markup).toContain('aria-label="Hear Genesis 1:1"');
  expect(markup).toContain('aria-label="Hear whole verse Genesis 1:1"'); expect(markup).not.toMatch(/select word [0-9]+ for tools/);
  expect(markup).toContain("Verses 1–100 of 146"); expect(markup).toContain("not an assigned reading yet"); expect(markup).toContain("CC-BY-SA-4.0");
  expect(markup).not.toMatch(/Word tools|Mark practiced|Translation draft|My translation|Practice calendar/);
  expect(load).not.toHaveBeenCalled();
});

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
  expect(assigned).toContain('aria-label="Hear Genesis 1:1"'); expect(assigned).toContain('role="button"'); expect(assigned).toContain("Hear whole verse Genesis 1:1; select word 1 for tools");
});

test("unresolved slot and temporary failures offer honest recovery with no invented portion or assignment operation", () => {
  const prepared = explorationPrepared(), { binding: _binding, expiresAt: _expiry, ranges: _ranges, portion: _portion, pages: _pages, verseCount: _count, sourceFetchedAt: _fetched, ...context } = prepared;
  const unresolved = renderToStaticMarkup(createElement(ExplorationContent, { ...actions, state: { pending: false, result: { ...context, status: "unresolved", serviceSlot: "unknown", readingDate: null, reason: "unknown-slot" } } }));
  expect(unresolved).toContain("choose a service time"); expect(unresolved).toContain("Try again"); expect(unresolved).not.toContain("Genesis");
  const stale = renderToStaticMarkup(createElement(ExplorationContent, { ...actions, state: { pending: false, error: 409 } }));
  expect(stale).toContain("Refresh reading"); expect(stale).not.toContain("Checking your access");
});

test("the proposed portion has the Lein | Study switch for staff and learners alike, and Study shows verse rows with no tikkun", async () => {
  const { StudyLensScope } = await import("../../src/components/portal/workspace/study-lens");
  const content = createElement(ExplorationContent, { ...actions, state: { pending: false, result: explorationPrepared(), page: explorationPage() } });
  const lein = renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, children: content }));
  expect(lein).toMatch(/aria-pressed="true" data-lens="lein">Lein<\/button>/);
  expect(lein).not.toContain("data-study-rows");
  const study = renderToStaticMarkup(createElement(StudyLensScope, { storageKey: null, query: "study", children: content }));
  expect(study).toContain("data-study-rows");
  expect(study).not.toContain("data-tikkun");
  // The proposed portion's words have no tools, and their labels say so.
  expect(study).not.toContain("for tools");
  // Outside a lens scope (no switch), the proposed portion is Lein exactly as before.
  expect(renderToStaticMarkup(content)).not.toContain('aria-label="Reading lens"');
});
