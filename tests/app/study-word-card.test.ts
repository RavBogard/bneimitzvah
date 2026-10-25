// Release 1.7 M1: in Study a tap opens the word card beside the verse; in Lein it still plays. Synthetic grammar and text only.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { firstWordKey, FlowingStudyText, StudyHebrew } from "../../src/components/portal/workspace/study/annotations";
import { ReadingPlace } from "../../src/components/portal/workspace/study/reading-place";
import { chapterOf, pageOffsetFor, readingChapters, topVisible } from "../../src/components/portal/workspace/study/reading-place-model";
import { focusKey, moveWord, requestPanel, type PanelOpen } from "../../src/components/portal/workspace/study/verse-panel-state";
import { adjacentWord, rovingTarget, tapWord } from "../../src/components/portal/workspace/study/word-nav";
import { WordPanelView } from "../../src/components/portal/workspace/study/word-panel";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import type { WordGrammar } from "../../src/lib/hebrew/word-details";
import { carriesQamatsQatan, QAMATS_QATAN_NOTE, wordSentence } from "../../src/lib/hebrew/word-sentence";
vi.mock("server-only", () => ({}));

const ready = (...morphemes: Extract<WordGrammar, { status: "ready" }>["morphemes"][number][]): WordGrammar => ({ status: "ready", language: "hebrew", morphemes });

describe("the plain-language sentence", () => {
  it("says what a verb is in plain words, with the meaning and the stem hint", () => {
    expect(wordSentence("synthetic gloss", ready({ partOfSpeech: "verb", stem: "Piel", form: "wayyiqtol", person: 3, gender: "masculine", number: "singular" })))
      .toBe("A verb, narrative past: ‘synthetic gloss’. Intensive (Piel).");
    expect(wordSentence(null, ready({ partOfSpeech: "verb", stem: "Qal", form: "imperative" }))).toBe("A verb, a command. Simple action (Qal).");
  });
  it("describes nouns, adjectives and pronouns by gender, number and state", () => {
    expect(wordSentence("synthetic", ready({ partOfSpeech: "noun", gender: "feminine", number: "plural", state: "construct" }))).toBe("A noun, feminine plural, in construct (‘… of’): ‘synthetic’.");
    expect(wordSentence(null, ready({ partOfSpeech: "noun", definite: true }))).toBe("A noun, definite.");
    expect(wordSentence(null, ready({ partOfSpeech: "adjective", gender: "masculine", number: "singular" }))).toBe("An adjective, masculine singular.");
    expect(wordSentence("he", ready({ partOfSpeech: "pronoun", person: 3, gender: "masculine", number: "singular" }))).toBe("A pronoun, 3rd person masculine singular: ‘he’.");
  });
  it("is about the word itself, not its prefix or suffix", () => {
    expect(wordSentence("synthetic", ready({ partOfSpeech: "conjunction" }, { partOfSpeech: "noun", gender: "masculine", number: "singular" }, { partOfSpeech: "suffix", person: 3, gender: "masculine", number: "singular" })))
      .toBe("A noun, masculine singular: ‘synthetic’.");
    expect(wordSentence(null, ready({ partOfSpeech: "preposition" }))).toBe("A preposition.");
  });
  it("gives nothing when the grammar is unknown, so the card says so", () => {
    expect(wordSentence("synthetic", { status: "unavailable", reason: "unrecognized-code" })).toBeNull();
  });
});

describe("tap routing", () => {
  it("Study: a tap opens the word card with the word and its element, and plays nothing", () => {
    const openCard = vi.fn(), play = vi.fn(), element = {} as HTMLElement;
    expect(tapWord({ openCard, play }, "Genesis 1:2", 3, element)).toBe("card");
    expect(openCard).toHaveBeenCalledWith("Genesis 1:2", 3, element);
    expect(play).not.toHaveBeenCalled();
  });
  it("Lein: there is no card, so a tap plays as before", () => {
    const play = vi.fn();
    expect(tapWord({ openCard: null, play }, "Genesis 1:2", 3, null)).toBe("play");
    expect(play).toHaveBeenCalledWith(3);
  });
});

describe("keyboard", () => {
  it("moves right to left in Hebrew order: ArrowLeft reads on, ArrowRight goes back, and the ends hold", () => {
    expect(rovingTarget(2, 5, "ArrowLeft")).toBe(3);
    expect(rovingTarget(2, 5, "ArrowRight")).toBe(1);
    expect(rovingTarget(4, 5, "ArrowLeft")).toBe(4);
    expect(rovingTarget(0, 5, "ArrowRight")).toBe(0);
    expect(rovingTarget(2, 5, "Home")).toBe(0);
    expect(rovingTarget(2, 5, "End")).toBe(4);
    expect(rovingTarget(2, 5, "ArrowDown")).toBeNull();
    expect(rovingTarget(0, 0, "ArrowLeft")).toBeNull();
  });
  it("steps the card to the next word across verses, skipping a verse with no words", () => {
    const counts = [2, 0, 3];
    expect(adjacentWord(counts, 0, 0, 1)).toEqual({ verse: 0, word: 1 });
    expect(adjacentWord(counts, 0, 1, 1)).toEqual({ verse: 2, word: 0 });
    expect(adjacentWord(counts, 2, 0, -1)).toEqual({ verse: 0, word: 1 });
    expect(adjacentWord(counts, 2, 2, 1)).toBeNull();
    expect(adjacentWord(counts, 0, 0, -1)).toBeNull();
  });
  const verse: StudyVerse = { ref: "Genesis 1:1", english: null, hebrew: { text: "אבג דהו זחט", readingText: "אבג דהו זחט", paragraphAfter: null, segments: [{ kind: "text", text: "אבג דהו זחט" }] } };
  const words = (html: string) => [...html.matchAll(/<span [^>]*role="button"[^>]*>/g)].map(match => match[0]);
  it("has one Tab stop per verse: the first word, the rest reachable by arrows", () => {
    const html = renderToStaticMarkup(createElement(StudyHebrew, { verse, colors: null, id: "v", onWordSelect() {}, wordAction: "card" }));
    const found = words(html);
    expect(found).toHaveLength(3);
    expect(found.filter(tag => tag.includes('tabindex="0"'))).toHaveLength(1);
    expect(found[0]).toContain('tabindex="0"');
    expect(found.slice(1).every(tag => tag.includes('tabindex="-1"'))).toBe(true);
    // The word names itself by its Hebrew (no aria-label); what a tap does is its description (1.9 N4, F5).
    expect(found.every(tag => !tag.includes("aria-label"))).toBe(true);
    expect(found.every(tag => tag.includes('aria-describedby="v-act"'))).toBe(true);
    expect(html).toContain('id="v-act"'); expect(html).toContain(">Open word</span>");
    expect(html.match(/id="v-act"/g)).toHaveLength(1); // one description for the verse, not one per word
  });
  it("is one Tab stop for the whole passage, not one per verse", () => {
    const second: StudyVerse = { ...verse, ref: "Genesis 1:2" };
    const html = renderToStaticMarkup(createElement(FlowingStudyText, { verses: [verse, second], assignment: { kind: "torah", confirmed: true, verses: [verse.ref, second.ref] }, group: "g", activeWord: null, onWord() {} }));
    const found = words(html);
    expect(found).toHaveLength(6);
    expect(found.filter(tag => tag.includes('tabindex="0"'))).toHaveLength(1);
    expect(found[0]).toContain('tabindex="0"');
  });
  it("names the first word of a passage that has one", () => {
    const empty: StudyVerse = { ...verse, ref: "Genesis 1:3", hebrew: { text: "", readingText: "", paragraphAfter: null, segments: [] } };
    expect(firstWordKey([verse, empty])).toBe("Genesis 1:1#0");
    expect(firstWordKey([empty])).toBeNull();
  });
});

describe("the one panel at a time", () => {
  const word = (verse: string, n: number): PanelOpen => Object.freeze({ verse, kind: "word", id: "p", word: n });
  it("opens a word, replaces whatever was open, and closes on the same word again with focus handed back", () => {
    const compare: PanelOpen = Object.freeze({ verse: "Genesis 1:1", kind: "compare", id: "p" });
    const first = requestPanel(compare, { verse: "Genesis 1:1", kind: "word", word: 2 }, "p");
    expect(first).toEqual({ open: word("Genesis 1:1", 2), restoreFocus: false });
    expect(requestPanel(first.open, { verse: "Genesis 1:1", kind: "word", word: 3 }, "p").open).toEqual(word("Genesis 1:1", 3));
    expect(requestPanel(first.open, { verse: "Genesis 1:1", kind: "word", word: 2 }, "p")).toEqual({ open: null, restoreFocus: true });
  });
  it("steps a word card to another word without reopening it or touching other panels", () => {
    expect(moveWord(word("Genesis 1:1", 2), "Genesis 1:2", 0)).toEqual(word("Genesis 1:2", 0));
    const shelf: PanelOpen = Object.freeze({ verse: "Genesis 1:1", kind: "shelf", id: "p" });
    expect(moveWord(shelf, "Genesis 1:2", 0)).toBe(shelf);
    expect(moveWord(null, "Genesis 1:2", 0)).toBeNull();
    const same = word("Genesis 1:1", 2);
    expect(moveWord(same, "Genesis 1:1", 2)).toBe(same);
  });
  it("closing is the same request as tapping the open word again: focus is restored to the opener (Esc itself is the Sheet's)", () => {
    expect(requestPanel(word("Genesis 1:1", 2), { verse: "Genesis 1:1", kind: "word", word: 2 }, "p").restoreFocus).toBe(true);
  });
  it("keeps the reader's place when a word card steps on, but moves focus when another panel opens", () => {
    expect(focusKey({ verse: "Genesis 1:1", kind: "word" })).toBe(focusKey({ verse: "Genesis 1:2", kind: "word" }));
    expect(focusKey({ verse: "Genesis 1:1", kind: "shelf" })).not.toBe(focusKey({ verse: "Genesis 1:2", kind: "shelf" }));
  });
});

describe("the word card's layout", () => {
  it("puts the plain sentence first, then Previous word, Next word and Hear this word, and folds the dictionary details last", () => {
    const html = renderToStaticMarkup(createElement(WordPanelView, { text: "אבג", place: "Word 1 of 3", sentence: "A noun, masculine singular.",
      actions: createElement("button", null, "Previous word"), details: createElement("p", null, "Dictionary senses go here") }));
    const at = (text: string) => html.indexOf(text);
    expect(at("A noun, masculine singular.")).toBeGreaterThan(-1);
    expect(at("A noun, masculine singular.")).toBeLessThan(at("Previous word"));
    expect(at("Previous word")).toBeLessThan(at("<details"));
    expect(at("<details")).toBeLessThan(at("Dictionary senses go here"));
    expect(html).toContain("<summary>Dictionary details</summary>");
    expect(html).not.toMatch(/<details[^>]* open/);
  });
});

describe("the qamats qatan note (1.9 N4)", () => {
  // Miqra according to the Masorah marks a qamats qatan with U+05C7 (the pipeline note in docs/superpowers/research/2026-10-15-trope-engine); the card says so only for a word that carries it.
  const view = (text: string) => renderToStaticMarkup(createElement(WordPanelView, { text, place: "Word 1 of 3", sentence: "A noun.", actions: null, details: null }));
  it("shows the approved note when the word carries U+05C7, and only then", () => {
    expect(carriesQamatsQatan("\u05DB\u05C7\u05BC\u05DC")).toBe(true);
    expect(carriesQamatsQatan("\u05DB\u05B8\u05DC")).toBe(false);
    expect(view("\u05DB\u05C7\u05BC\u05DC")).toContain("This vowel says o (qamats katan).");
    expect(view("\u05DB\u05B8\u05DC")).not.toContain("qamats katan");
    expect(QAMATS_QATAN_NOTE).toBe("This vowel says o (qamats katan).");
  });
});

describe("the reading place and chapter jump", () => {
  const refs = ["Genesis 12:3", "Genesis 12:4", "Genesis 13:1", "Genesis 13:2", "Genesis 14:1"];
  it("lists each chapter of the loaded reading once, in order, from its first verse", () => {
    expect(readingChapters(refs).map(row => [row.label, row.first])).toEqual([["Genesis 12", "Genesis 12:3"], ["Genesis 13", "Genesis 13:1"], ["Genesis 14", "Genesis 14:1"]]);
    expect(chapterOf("Song of Songs 2:3")).toBe("Song of Songs 2");
    expect(chapterOf("not a reference")).toBeNull();
  });
  it("finds the text page that holds a verse, and follows the verse nearest the top", () => {
    expect(pageOffsetFor([0, 2, 4], refs, "Genesis 13:2")).toBe(2);
    expect(pageOffsetFor([0, 2, 4], refs, "Genesis 14:1")).toBe(4);
    expect(pageOffsetFor([0, 2, 4], refs, "Genesis 99:1")).toBeNull();
    expect(topVisible(refs, new Set(["Genesis 13:2", "Genesis 13:1"]))).toBe("Genesis 13:1");
    expect(topVisible(refs, new Set())).toBeNull();
  });
  it("shows the current reference and a Chapter control, and no control for a single chapter", () => {
    const many = renderToStaticMarkup(createElement(ReadingPlace, { refs, pageKey: "a", onJump() {} }));
    expect(many).toContain("Genesis 12:3");
    expect(many).toContain("<span>Chapter</span>");
    expect(many).toContain('<option value="Genesis 13">Genesis 13</option>');
    const one = renderToStaticMarkup(createElement(ReadingPlace, { refs: refs.slice(0, 2), pageKey: "a", onJump() {} }));
    expect(one).toContain("Genesis 12:3");
    expect(one).not.toContain("Chapter");
    expect(renderToStaticMarkup(createElement(ReadingPlace, { refs: [], pageKey: "a", onJump() {} }))).toBe("");
  });
});
