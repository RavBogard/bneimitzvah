import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PlayerState } from "../../src/components/learn/player";
import { maqafShape, verse } from "./learn-synthetic";
const observed = vi.hoisted(() => ({ state: { id: null, status: "idle", seconds: 0, part: 0 } as PlayerState }));
vi.mock("../../src/components/learn/services", () => ({ usePlayerState: () => observed.state, useLearnServices: () => ({}) }));
vi.mock("../../src/components/learn/word-card", () => ({ useWordCard: () => null }));
import { UnitsText } from "../../src/components/learn/bits";

describe("the visible sounding word", () => {
  it("outlines only the actual canonical word inside a maqaf unit, even without a word-card target", () => {
    const v = verse("Genesis 1:2", maqafShape());
    observed.state = { id: "pair", status: "playing", seconds: 3, part: 1, current: { ref: v.ref, kind: v.kind, word: 6 } };
    const html = renderToStaticMarkup(createElement(UnitsText, { verse: v, card: false, playback: [{ id: "pair", part: 1 }] }));
    expect(html.match(/data-playback-active/g)).toHaveLength(1);
    expect(html).toMatch(/data-reading-word="6" data-playback-active=""/);
    expect(html).not.toContain("data-part=");
    const otherPart = renderToStaticMarkup(createElement(UnitsText, { verse: v, playback: [{ id: "pair", part: 0 }] }));
    expect(otherPart).not.toContain("data-playback-active");
    observed.state = { ...observed.state, status: "paused", current: null };
    expect(renderToStaticMarkup(createElement(UnitsText, { verse: v, playback: ["pair"] }))).not.toContain("data-playback-active");
  });
});
