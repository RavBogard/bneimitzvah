import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/provider", () => ({ useWorkspaceModal() {} }));
import { LiftedLine } from "../../src/components/portal/workspace/study/lift";
import { ReadingPlayer } from "../../src/components/portal/workspace/study/reading-player";
import { createReadingAudioCoordinator } from "../../src/components/portal/workspace/study/reading-audio-coordinator";
import { explorationPage } from "./exploration-client-helper";

const verses = explorationPage().verses.slice(0, 2);
test("modal short controls preview current verse without loading or autoplay on mount/navigation", () => {
  const load = vi.fn(), coordinator = createReadingAudioCoordinator();
  for (const index of [0, 1, 0]) {
    const markup = renderToStaticMarkup(createElement(LiftedLine, { verses, assignment: { kind: "torah", confirmed: false, verses: [] },
      index, total: 2, offset: 0, onIndex() {}, onClose() {}, reference: { scopeKey: "synthetic-modal", audio: coordinator, active: true, navigation: index + 1, load } }));
    expect(markup).toContain('aria-label="Reading playback"');
    expect(markup).toContain(`${verses[index].ref}</bdi> \u00b7 Whole verse`);
    expect(markup).toContain(">Hear whole verse</span>");
    expect(markup).toContain('aria-label="Close practice view"');
    expect(markup).toContain("Practice"); expect(markup).toContain("Recording credit");
    expect(markup).not.toContain("Load recording"); expect(markup).not.toContain("for tools");
  }
  expect(load).not.toHaveBeenCalled();
});

test("controlled preview enables first explicit Play while uncomposed main player stays inert", () => {
  const load = vi.fn(), coordinator = createReadingAudioCoordinator();
  const controlled = renderToStaticMarkup(createElement(ReadingPlayer, { scopeKey: "synthetic-modal", verses, active: true,
    target: { index: 1, generation: 4 }, audio: { coordinator, slot: "lifted" }, load, register() {}, onActiveWord() {} }));
  expect(controlled).toContain(`${verses[1].ref}</bdi> \u00b7 Whole verse`);
  expect(controlled).toContain('<button type="button">Play</button>');
  const main = renderToStaticMarkup(createElement(ReadingPlayer, { scopeKey: "synthetic-main", verses, active: true,
    load, register() {}, onActiveWord() {} }));
  expect(main).toContain("Listen to your reading"); expect(main).toContain('disabled="">Play</button>');
  expect(load).not.toHaveBeenCalled();
});
