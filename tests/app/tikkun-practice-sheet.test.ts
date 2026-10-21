import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";

const prefs = vi.hoisted(() => ({ colors: true, translation: false, size: "standard", tikkun: false }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/reading-prefs", () => ({ useReadingPrefs: () => prefs, useSetReadingPrefs: () => () => {}, textSizes: [{ id: "standard", label: "Standard" }] }));
const ReadingToolbar = (await import("../../src/components/portal/workspace/reading-toolbar")).ReadingToolbar as (props: { tikkunAvailable?: boolean }) => ReturnType<typeof import("../../src/components/portal/workspace/reading-toolbar").ReadingToolbar>;
const { FlowingStudyText } = await import("../../src/components/portal/workspace/study/annotations");
const { PracticeSheetDocument } = await import("../../src/components/portal/workspace/study/practice-sheet");

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => nodes(parseFragment(renderToStaticMarkup(element)));
const sheetOf = (all: Node[]) => all.find(node => attr(node, "data-practice-sheet-document") !== undefined)!;
const marks = (value: string) => [...value].filter(char => { const point = char.codePointAt(0)!; return point >= 0x0591 && point <= 0x05c7; });
const cp = (...points: number[]) => String.fromCodePoint(...points);

// Invented syllables built from code points: bet-qamats-etnahta-alef, gimel-dagesh-patah-maqaf-dalet, sof pasuq.
const pointed = `${cp(0x05d1, 0x05b8, 0x0591, 0x05d0)} ${cp(0x05d2, 0x05bc, 0x05b7, 0x05be, 0x05d3)}${cp(0x05c3)}`;
const consonants = `${cp(0x05d1, 0x05d0)} ${cp(0x05d2)} ${cp(0x05d3)}`;
const refs = ["Genesis 1:1", "Genesis 1:2", "Genesis 1:3"];
const verses = refs.map(ref => ({ ref, hebrew: (({ segments, ...rest }) => ({ ...rest, segments: [...segments] }))(normalizeHebrew(pointed)), english: `Synthetic English ${ref}` }));
const assignment = { kind: "torah" as const, confirmed: true, verses: refs };

describe("Tikkun control", () => {
  it("appears beside Torah text, reports its remembered state, and is absent for a haftarah", () => {
    prefs.tikkun = true;
    try {
      const shown = render(createElement(ReadingToolbar, { tikkunAvailable: true })).filter(node => attr(node, "class") === "toolbar-item" && text(node) === "Tikkun");
      expect(shown).toHaveLength(1); expect(attr(shown[0], "aria-pressed")).toBe("true");
      expect(render(createElement(ReadingToolbar, { tikkunAvailable: false })).some(node => text(node) === "Tikkun" && attr(node, "class") === "toolbar-item")).toBe(false);
      expect(render(createElement(ReadingToolbar, {})).some(node => text(node) === "Tikkun" && attr(node, "class") === "toolbar-item")).toBe(false);
    } finally { prefs.tikkun = false; }
  });
});

describe("Tikkun reading", () => {
  it("replaces the pointed text on a phone with non-interactive consonant-only scroll text, verse by verse", () => {
    const all = render(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, onVerse() {}, tikkun: true }));
    const tikkun = all.filter(node => attr(node, "data-tikkun-ref"));
    expect(tikkun.map(node => attr(node, "data-tikkun-ref"))).toEqual(refs);
    for (const node of tikkun) {
      expect(text(node)).toBe(consonants); expect(marks(text(node))).toEqual([]);
      expect(attr(node, "lang")).toBe("he"); expect(attr(node, "dir")).toBe("rtl"); expect(attr(node, "aria-hidden")).toBeUndefined();
      expect(nodes(node).some(child => attr(child, "role") === "button" || attr(child, "tabindex") !== undefined)).toBe(false);
    }
    expect(all.some(node => attr(node, "data-word-index") !== undefined)).toBe(false);
    expect(all.filter(node => attr(node, "aria-label")?.startsWith("Hear "))).toHaveLength(3);
    expect(all.find(node => attr(node, "aria-label") === "Hebrew reading") && attr(all.find(node => attr(node, "aria-label") === "Hebrew reading")!, "data-tikkun")).toBe("instead");
  });
  it("leaves the pointed, playable text untouched when the tikkun is off", () => {
    const all = render(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, tikkun: false }));
    expect(all.some(node => attr(node, "data-tikkun-ref"))).toBe(false);
    expect(all.filter(node => attr(node, "data-word-index") !== undefined).length).toBeGreaterThan(0);
    expect(marks(text(all[0])).length).toBeGreaterThan(0);
  });
});

describe("Practice sheet", () => {
  const student = { firstName: "Synthetic", lastName: "Reader", ceremonyDate: "2027-01-02" };
  const text_ = { verses, chapters: [{ ref: "Genesis 1", sefariaUrl: "https://www.sefaria.org/Genesis.1", fetchedAt: 0, hash: "c".repeat(64), editions: [studyEditions.mam] }] };
  const torah = { kind: "torah" as const, ranges: ["Genesis 1:1-3"], verses: refs, aliyahStarts: ["Genesis 1:3"] };
  const printedOn = new Date(Date.UTC(2026, 9, 21, 12));
  it("prints the header, every verse once with vowels and trope, aliyah markers and no English", () => {
    const all = render(createElement(PracticeSheetDocument, { student, reading: torah, text: text_, tikkun: false, aliyahBreaks: false, printedOn }));
    const whole = text(all[0]);
    expect(whole).toContain("Beit Mitzvah"); expect(whole).toContain("Synthetic Reader"); expect(whole).toContain("Saturday, January 2, 2027");
    expect(whole).toContain("Torah · Genesis 1:1\u20133"); expect(whole).not.toContain("Synthetic English");
    expect(all.filter(node => attr(node, "data-verse-ref")).map(node => attr(node, "data-verse-ref"))).toEqual(refs);
    expect(all.filter(node => "tagName" in node && node.tagName === "h2").map(text)).toEqual(["Aliyah 1", "Aliyah 2"]);
    expect(all.filter(node => attr(node, "data-aliyah")).map(node => attr(node, "data-aliyah"))).toEqual(["1", "2"]);
    const hebrew = all.filter(node => attr(node, "lang") === "he" && "tagName" in node && node.tagName === "p");
    expect(hebrew).toHaveLength(3); for (const node of hebrew) expect(marks(text(node)).length).toBeGreaterThan(0);
    expect(all.some(node => attr(node, "data-tikkun-ref"))).toBe(false);
    expect(all.some(node => attr(node, "role") === "button" || attr(node, "data-word-index") !== undefined && attr(node, "tabindex") !== undefined)).toBe(false);
    expect(whole).toContain("Miqra according to the Masorah"); expect(whole).not.toContain("Stam Ashkenaz");
    expect(attr(sheetOf(all), "data-tikkun")).toBe("off"); expect(attr(sheetOf(all), "data-aliyah-breaks")).toBe("off");
  });
  it("adds a consonant-only tikkun column for Torah and its font credit, and can break pages at each aliyah", () => {
    const all = render(createElement(PracticeSheetDocument, { student, reading: torah, text: text_, tikkun: true, aliyahBreaks: true, printedOn }));
    const tikkun = all.filter(node => attr(node, "data-tikkun-ref"));
    expect(tikkun.map(node => attr(node, "data-tikkun-ref"))).toEqual(refs);
    for (const node of tikkun) { expect(text(node)).toBe(consonants); expect(marks(text(node))).toEqual([]); }
    expect(text(all[0])).toContain("Stam Ashkenaz CLM");
    expect(attr(sheetOf(all), "data-tikkun")).toBe("on"); expect(attr(sheetOf(all), "data-aliyah-breaks")).toBe("on");
  });
  it("never adds a tikkun column or aliyah markers to a haftarah", () => {
    const haftarah = { kind: "haftarah" as const, ranges: ["Isaiah 1:1-3"], verses: ["Isaiah 1:1", "Isaiah 1:2", "Isaiah 1:3"], aliyahStarts: null };
    const all = render(createElement(PracticeSheetDocument, { student, reading: haftarah, text: { ...text_, verses: verses.map((verse, index) => ({ ...verse, ref: haftarah.verses[index] })) }, tikkun: true, aliyahBreaks: false, printedOn }));
    expect(all.some(node => attr(node, "data-tikkun-ref"))).toBe(false);
    expect(all.some(node => attr(node, "data-aliyah"))).toBe(false);
    expect(text(all[0])).toContain("Haftarah · Isaiah 1:1\u20133");
    expect(attr(sheetOf(all), "data-tikkun")).toBe("off");
  });
});
