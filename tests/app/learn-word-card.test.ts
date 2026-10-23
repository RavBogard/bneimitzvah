import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { analyseVerse } from "../../src/lib/learn/verse";
import { buildPools, type EndItem, type Phrase } from "../../src/lib/learn/pools";
import { routeUnitTap, unitCardWord, unitTapRoute, unitWordParts, wordCardPassage } from "../../src/lib/learn/word-tap";
import { maqafShape, source, threePhrases, verse } from "./learn-synthetic";

// Ruling 2026-10-23: in Learn, tapping a word opens its card (meaning, shoresh, syllables), never trope.
const player = vi.hoisted(() => ({ play: vi.fn(async () => true), stop: vi.fn(), subscribe: () => () => {}, state: { id: null, status: "idle", seconds: 0, part: 0 } }));
vi.mock("../../src/components/learn/services", () => ({
  useLearnServices: () => ({ player, audio: {}, loader: {} }),
  usePlayerState: () => player.state,
}));
const captured = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("../../src/components/learn/bits", async original => {
  const real = await original<typeof import("../../src/components/learn/bits")>();
  // The real UnitsText, with each call's props kept so a test can make the tap it would make.
  return { ...real, UnitsText: (props: Parameters<typeof real.UnitsText>[0]) => { captured.push(props as unknown as Record<string, unknown>); return real.UnitsText(props); } };
});
const { UnitsText } = await import("../../src/components/learn/bits");
const { WhereDoesItEnd, TapThePhrase } = await import("../../src/components/learn/drills");
const { WordCardScope } = await import("../../src/components/learn/word-card");
afterEach(() => { captured.length = 0; player.play.mockClear(); player.stop.mockClear(); });
const inScope = (child: ReactElement) => renderToStaticMarkup(createElement(WordCardScope, null, child));

describe("word mapping", () => {
  const value = verse("Genesis 2:2", maqafShape());
  it("splits a maqaf unit into its written words, each with its reading-word index", () => {
    expect(value.units[5].words).toEqual([5, 6]);
    const parts = unitWordParts(value.units[5])!;
    expect(parts.map(part => part.word)).toEqual([5, 6]);
    expect(parts.map(part => part.text).join("")).toBe(value.units[5].text);
    expect(parts[0].text.endsWith("־")).toBe(true);
    expect(unitWordParts(value.units[4])).toBeNull();
  });
  it("opens on the maqaf word tapped, else the unit's first word", () => {
    expect(unitCardWord(value.units[5], 1)).toBe(6);
    expect(unitCardWord(value.units[5], 0)).toBe(5);
    expect(unitCardWord(value.units[5], null)).toBe(5);
    expect(unitCardWord(value.units[5], 7)).toBe(5);
    expect(unitCardWord(value.units[5], -1)).toBe(5);
    // After the maqaf pair every unit sits one reading word later.
    expect(unitCardWord(value.units[6], null)).toBe(7);
    expect(unitCardWord(value.units[8], 0)).toBe(9);
  });
  it("falls back to the first word when the written parts do not line up", () => {
    const odd = { ...value.units[5], words: [5, 7] as const };
    expect(unitWordParts(odd)).toBeNull();
    expect(unitCardWord(odd, 1)).toBe(5);
  });
  it("asks for a course verse by its own ref and a week verse by the week's passage", () => {
    expect(wordCardPassage(value)).toEqual({ ref: "Genesis 2:2", index: 0, count: 1 });
    const week = analyseVerse({ ref: "Genesis 12:3", kind: "torah", hebrew: source(threePhrases()), passage: { ref: "Genesis 12:1-8", index: 2, count: 8 } })!;
    expect(wordCardPassage(week)).toEqual({ ref: "Genesis 12:1-8", index: 2, count: 8 });
    expect(week.hebrew.text).toBe(source(threePhrases()).text);
  });
});

describe("tap routing", () => {
  const value = verse("Genesis 2:2", maqafShape());
  it("a reading tap opens the card on the right word and answers nothing", () => {
    const openCard = vi.fn(), onAnswer = vi.fn();
    expect(routeUnitTap({ verse: value, openCard }, 5, 1, "trigger")).toBe("card");
    expect(openCard).toHaveBeenCalledWith({ verse: value, unit: 5, word: 6 }, "trigger");
    expect(routeUnitTap({ verse: value, openCard }, 2, null, "key")).toBe("card");
    expect(openCard).toHaveBeenLastCalledWith({ verse: value, unit: 2, word: 2 }, "key");
    expect(onAnswer).not.toHaveBeenCalled();
  });
  it("an answer tap answers while the question is open and opens no card", () => {
    const openCard = vi.fn(), onAnswer = vi.fn();
    expect(routeUnitTap({ verse: value, onAnswer, openCard }, 5, 1, null)).toBe("answer");
    expect(onAnswer).toHaveBeenCalledWith(5);
    expect(openCard).not.toHaveBeenCalled();
    expect(unitTapRoute({ answering: false, card: false })).toBe("none");
    expect(routeUnitTap({ verse: value }, 3, null, null)).toBe("none");
    expect(routeUnitTap({ verse: value, openCard }, 99, null, null)).toBe("none");
  });
  it("renders reading Hebrew as card targets, and a maqaf unit with its words marked", () => {
    const html = inScope(createElement(UnitsText, { verse: value }));
    expect(html.match(/data-tap="card"/g)).toHaveLength(value.units.length);
    expect(html.match(/role="button"/g)).toHaveLength(value.units.length);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('data-tap="answer"');
    expect(html.match(/data-part="\d"/g)).toEqual(['data-part="0"', 'data-part="1"']);
    expect(html).toMatch(/lang="he" dir="rtl"/);
  });
  it("leaves Hebrew plain outside a scope, inside another answer target, and in answer mode it is the answer", () => {
    expect(renderToStaticMarkup(createElement(UnitsText, { verse: value }))).not.toContain("role=");
    expect(inScope(createElement(UnitsText, { verse: value, card: false }))).not.toContain("role=");
    const answering = inScope(createElement(UnitsText, { verse: value, onUnit: () => {}, unitLabel: unit => `Word ${unit + 1}` }));
    expect(answering.match(/data-tap="answer"/g)).toHaveLength(value.units.length);
    expect(answering).not.toContain("data-word-card");
    expect(answering).not.toContain("data-part");
  });
});

describe("drills", () => {
  const value = verse("Genesis 4:4", threePhrases()), pools = buildPools([value]);
  const phrase = (index: number): Phrase => {
    const row = value.phrases[index];
    return { ref: value.ref, kind: "torah", family: row.family, words: row.units, tropes: [], book: value.book, verseUnits: value.units.length };
  };
  const props = { pools, melody: "torah" as const, contrast: () => null };
  it("where does it end: a wrong tap answers and plays nothing", () => {
    const onAnswer = vi.fn(), item: EndItem = { type: "where-does-it-end", key: "e1", target: phrase(1), audio: true };
    const html = inScope(createElement(WhereDoesItEnd, { ...props, item, onAnswer }));
    expect(html).toContain('data-tap="answer"');
    expect(html).not.toContain("data-word-card");
    const units = captured.find(row => row.onUnit) as { onUnit(unit: number): void };
    units.onUnit(0);
    expect(onAnswer).toHaveBeenCalledWith(false);
    units.onUnit(5);
    expect(onAnswer).toHaveBeenLastCalledWith(true);
    // Server render runs no effects, so the autoplay never ran either: every play here would be the tap's.
    expect(player.play).not.toHaveBeenCalled();
  });
  it("tap the phrase: while open the phrases are the targets and their words are not cards", () => {
    const html = inScope(createElement(TapThePhrase, { ...props, item: { type: "tap-the-phrase", key: "t1", target: phrase(2) }, onAnswer: vi.fn() }));
    expect(html.match(/data-phrase-target="\d"/g)).toHaveLength(value.phrases.length);
    expect(html).not.toContain("data-word-card");
    expect(captured.every(row => row.card === false)).toBe(true);
    expect(player.play).not.toHaveBeenCalled();
  });
});
