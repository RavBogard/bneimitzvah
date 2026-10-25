import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";

const prefs = vi.hoisted(() => ({ colors: true, translation: false, size: "standard", tikkunView: "off" as "off" | "beside" | "only" }));
const setPrefs = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/reading-prefs", async original => ({ ...await original<typeof import("../../src/components/portal/workspace/reading-prefs")>(), useReadingPrefs: () => prefs, useReadingPrefsNow: () => prefs, useSetReadingPrefs: () => (change: unknown) => { setPrefs.calls.push(change); } }));
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

const views = [["off", "Pointed text"], ["beside", "Side by side"], ["only", "Tikkun only"]] as const;
type Tree = ReactElement<{ children?: ReactNode; onClick?(event: unknown): void; "data-tikkun-view"?: string }>;
const elements = (node: ReactNode): Tree[] => Array.isArray(node) ? node.flatMap(elements) : isValidElement(node) ? [node as Tree, ...elements((node as Tree).props.children)] : [];
/** The toolbar's element tree, rendered once so its hooks run, for invoking a menu choice's handler. */
function toolbarTree(props: { tikkunAvailable?: boolean }) {
  let tree: ReactNode = null;
  renderToStaticMarkup(createElement(function Probe() { tree = ReadingToolbar(props); return null; }));
  return elements(tree);
}
function withWidth<T>(wide: boolean, run: () => T): T {
  const previous = (globalThis as { matchMedia?: unknown }).matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: wide, addEventListener() {}, removeEventListener() {} });
  try { return run(); } finally { (globalThis as { matchMedia?: unknown }).matchMedia = previous; }
}
const flow = (tikkun: "off" | "beside" | "only", activeWord: { verse: number; index: number } | null = null) =>
  render(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord, onWord() {}, onVerse() {}, tikkun }));
const within = (all: Node[], ref: string) => nodes(all.find(node => attr(node, "data-verse-ref") === ref)!);

describe("Tikkun control", () => {
  it("is a three-way menu beside Torah text that reports the remembered view, and is absent for a haftarah", () => {
    try {
      for (const [view, label] of views) {
        prefs.tikkunView = view;
        const all = render(createElement(ReadingToolbar, { tikkunAvailable: true }));
        const shown = all.filter(node => attr(node, "class") === "toolbar-item" && text(node) === "Tikkun");
        expect(shown).toHaveLength(1);
        expect(attr(shown[0], "aria-pressed")).toBeUndefined(); expect(attr(shown[0], "data-active")).toBe(String(view !== "off"));
        expect(attr(shown[0], "aria-label")).toBe(`Tikkun: ${label}`);
        const menu = all.find(node => attr(node, "aria-label") === "Tikkun view")!;
        expect(attr(shown[0], "popovertarget")).toBe(attr(menu, "id"));
        const choices = nodes(menu).filter(node => attr(node, "data-tikkun-view") !== undefined);
        expect(choices.map(text)).toEqual(views.map(([, name]) => name));
        expect(choices.map(node => attr(node, "aria-pressed"))).toEqual(views.map(([id]) => String(id === view)));
      }
      for (const props of [{ tikkunAvailable: false }, {}]) {
        const all = render(createElement(ReadingToolbar, props));
        expect(all.some(node => text(node) === "Tikkun" && attr(node, "class") === "toolbar-item")).toBe(false);
        expect(all.some(node => attr(node, "data-tikkun-view") !== undefined || attr(node, "aria-label") === "Tikkun view")).toBe(false);
      }
    } finally { prefs.tikkunView = "off"; }
  });
  it("stores each chosen view and closes the menu", () => {
    setPrefs.calls.length = 0;
    const choices = toolbarTree({ tikkunAvailable: true }).filter(element => element.props["data-tikkun-view"] !== undefined);
    expect(choices.map(element => element.props["data-tikkun-view"])).toEqual(views.map(([id]) => id));
    let hidden = 0;
    for (const choice of choices) choice.props.onClick!({ currentTarget: { parentElement: { hidePopover() { hidden++; } } } });
    expect(setPrefs.calls).toEqual(views.map(([id]) => ({ tikkunView: id })));
    expect(hidden).toBe(3);
    expect(toolbarTree({ tikkunAvailable: false }).some(element => element.props["data-tikkun-view"] !== undefined)).toBe(false);
  });
});

describe("Tikkun reading", () => {
  it("sets the tikkun beside the pointed, playable text on every screen width, verse by verse", () => {
    const [wide, phone] = [true, false].map(width => withWidth(width, () => renderToStaticMarkup(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, onVerse() {}, tikkun: "beside" }))));
    expect(phone).toBe(wide);
    const all = flow("beside");
    expect(attr(all.find(node => attr(node, "aria-label") === "Hebrew reading")!, "data-tikkun")).toBe("beside");
    for (const ref of refs) {
      const verse = within(all, ref), pointed = verse.find(node => attr(node, "data-hebrew-ref") === ref)!, tikkun = verse.filter(node => attr(node, "data-tikkun-ref") === ref);
      expect(tikkun).toHaveLength(1);
      expect(text(tikkun[0])).toBe(consonants); expect(marks(text(tikkun[0]))).toEqual([]);
      expect(attr(tikkun[0], "aria-hidden")).toBe("true"); expect(attr(tikkun[0], "lang")).toBe("he"); expect(attr(tikkun[0], "dir")).toBe("rtl");
      expect(nodes(tikkun[0]).some(child => attr(child, "role") === "button" || attr(child, "tabindex") !== undefined || attr(child, "data-word-index") !== undefined)).toBe(false);
      // The pointed column is untouched: marks, playable words and the verse button.
      expect(marks(text(pointed)).length).toBeGreaterThan(0);
      expect(nodes(pointed).some(child => attr(child, "data-word-index") !== undefined)).toBe(true);
      expect(nodes(pointed).some(child => attr(child, "aria-label") === `Hear ${ref}`)).toBe(true);
      expect(nodes(pointed).some(child => attr(child, "data-tikkun-ref") !== undefined)).toBe(false);
    }
  });
  it("replaces the pointed text with non-interactive consonant-only scroll text on every screen width", () => {
    const [wide, phone] = [true, false].map(width => withWidth(width, () => renderToStaticMarkup(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, onVerse() {}, tikkun: "only" }))));
    expect(phone).toBe(wide);
    const all = flow("only");
    const tikkun = all.filter(node => attr(node, "data-tikkun-ref"));
    expect(tikkun.map(node => attr(node, "data-tikkun-ref"))).toEqual(refs);
    for (const node of tikkun) {
      expect(text(node)).toBe(consonants); expect(marks(text(node))).toEqual([]);
      expect(attr(node, "lang")).toBe("he"); expect(attr(node, "dir")).toBe("rtl"); expect(attr(node, "aria-hidden")).toBeUndefined();
      expect(nodes(node).some(child => attr(child, "role") === "button" || attr(child, "tabindex") !== undefined)).toBe(false);
    }
    expect(all.some(node => attr(node, "data-word-index") !== undefined)).toBe(false);
    expect(all.filter(node => attr(node, "aria-label")?.startsWith("Hear "))).toHaveLength(3);
    expect(attr(all.find(node => attr(node, "aria-label") === "Hebrew reading")!, "data-tikkun")).toBe("only");
  });
  it("colors every tikkun word like its pointed word when Colors is on, in both views, and neither text when it is off", () => {
    try {
      for (const view of ["beside", "only"] as const) {
        prefs.colors = true;
        const pointedAll = flow("off"), all = flow(view);
        for (const ref of refs) {
          const pointed = within(pointedAll, ref).filter(node => attr(node, "data-word-index") !== undefined && attr(node, "data-family") !== undefined);
          const written = within(all, ref).filter(node => attr(node, "data-tikkun-word") !== undefined);
          expect(written.length).toBeGreaterThan(0);
          expect(written.every(node => attr(node, "data-family") !== undefined)).toBe(true);
          for (const node of written) {
            const match = pointed.find(word => attr(word, "data-word-index") === attr(node, "data-tikkun-word"))!;
            expect(attr(node, "data-family")).toBe(attr(match, "data-family"));
            expect(attr(node, "class")).toBe(attr(match, "class"));
            expect(attr(node, "style")).toContain(`--phrase-color:${attr(match, "style")!.match(/--phrase-color:([^;]+)/)![1]}`);
          }
          if (view === "beside") expect(within(all, ref).filter(node => attr(node, "data-word-index") !== undefined && attr(node, "data-family") !== undefined).length).toBe(pointed.length);
          // The phrase list for screen readers stays once per verse.
          const phrases = within(all, ref).filter(node => /^g-flow-\d+-phrase-/.test(attr(node, "id") ?? ""));
          expect(phrases.length).toBeGreaterThan(0); expect(new Set(phrases.map(node => attr(node, "id"))).size).toBe(phrases.length);
        }
        prefs.colors = false;
        const plain = flow(view);
        expect(plain.some(node => attr(node, "data-family") !== undefined || attr(node, "style") !== undefined)).toBe(false);
        expect(plain.filter(node => attr(node, "data-tikkun-word") !== undefined).length).toBeGreaterThan(0);
        expect(plain.filter(node => attr(node, "data-tikkun-ref")).map(text)).toEqual(refs.map(() => consonants));
      }
    } finally { prefs.colors = true; }
  });
  it("highlights the playing word in the tikkun too, in both views", () => {
    for (const view of ["beside", "only"] as const) {
      const all = flow(view, { verse: 1, index: 1 });
      const active = all.filter(node => attr(node, "data-reference-active") === "true");
      const written = active.filter(node => attr(node, "data-tikkun-word") !== undefined);
      expect(written.map(node => attr(node, "data-tikkun-word"))).toEqual(["1"]);
      expect(within(all, "Genesis 1:2").includes(written[0])).toBe(true);
      expect(active.filter(node => attr(node, "data-word-index") !== undefined).map(node => attr(node, "data-word-index"))).toEqual(view === "beside" ? ["1"] : []);
    }
  });
  it("leaves the pointed, playable text untouched when the tikkun is off", () => {
    const all = render(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, tikkun: "off" }));
    expect(all.some(node => attr(node, "data-tikkun-ref"))).toBe(false);
    expect(all.filter(node => attr(node, "data-word-index") !== undefined).length).toBeGreaterThan(0);
    expect(marks(text(all[0])).length).toBeGreaterThan(0);
    expect(attr(all.find(node => attr(node, "aria-label") === "Hebrew reading")!, "data-tikkun")).toBeUndefined();
    expect(renderToStaticMarkup(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {} }))).toBe(renderToStaticMarkup(createElement(FlowingStudyText, { verses, assignment, group: "g", activeWord: null, onWord() {}, tikkun: "off" })));
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
