import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { describe, expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { colorStudyVerse } from "../../src/lib/hebrew/study-annotations";
import { INVERTED_NUN, isHebrewLetter, tikkunPieces, tikkunText } from "../../src/lib/hebrew/tikkun";
import { TikkunVerse } from "../../src/components/portal/workspace/study/annotations";
import { parseReadingPrefs } from "../../src/components/portal/workspace/reading-prefs";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
vi.mock("server-only", () => ({}));

// A wrong letter in a tikkun teaches a student wrong. The colored tikkun is built word by word from the
// projection, so it must spell exactly what the uncolored tikkunText spells, for every fixture verse.
type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const nodes = (node: Node): Node[] => [node, ...children(node).flatMap(nodes)];
const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => nodes(parseFragment(renderToStaticMarkup(element)));

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/trope/${name}`, import.meta.url), "utf8"));
const listed = (name: string) => (fixture(name).verses as { ref: string; he?: unknown; raw?: unknown }[]).flatMap(verse =>
  [verse.he, verse.raw].filter((value, index, all): value is string => typeof value === "string" && all.indexOf(value) === index).map(html => ({ ref: verse.ref, html })));
const single = (name: string) => { const value = fixture(name) as { ref: string; he: string }; return [{ ref: value.ref, html: value.he }]; };
// Synthetic markup for the apparatus the fixtures lack: inverted nuns at the start and end (Numbers 10:35-36),
// a ketiv/qere pair, open and closed paragraph gaps, paseq, maqaf and sof pasuq.
const synthetic = [
  '<span class="mam-spi-invnun">׆</span>אָ<b>ב</b>־גָ֣ ׀ <span class="mam-kq"><span class="mam-kq-k">כָ֔תָב</span><span class="mam-kq-q">[קָ֖רִי דָ֑בָר]</span></span><span class="mam-spi-samekh">{ס}</span>בָֽ׃<span class="mam-spi-pe">{פ}</span>',
  // Real MAM shape for Numbers 10:36: the closing inverted nun stands before the open-paragraph gap.
  'אָ֑ב גַּֽד׃ <span class="mam-spi-invnun">׆</span> <span class="mam-spi-pe">{פ}</span>',
  'אָב־גָ <span class="mam-kq"><span class="mam-kq-q">[קָרִי דָבָר]</span><span class="mam-kq-k">כָתָב</span></span> הָ׃',
  'הָ֣ ׀ וָ֔ זָ֖ ׃<span class="mam-spi-samekh">{ס}</span>',
].map((html, index) => ({ ref: `Numbers 10:${35 + index}`, html }));
const sources = [
  ...listed("calibration-torah.json"), ...listed("calibration-haftarah.json"), ...listed("edge-cases.json"),
  ...listed("week-min-hebrew.json"), ...listed("week-notes-hebrew.json"),
  ...single("idelsohn-272-joshua-1-14.json"), ...single("i-samuel-20-18.units.json"), ...synthetic,
];
function verse(ref: string, html: string): StudyVerse | null {
  try { const hebrew = normalizeHebrew(html); return { ref, hebrew: { ...hebrew, segments: [...hebrew.segments] }, english: null }; } catch { return null; }
}
const verses = sources.map(source => verse(source.ref, source.html)).filter((value): value is StudyVerse => value !== null);

describe("colored tikkun letters", () => {
  it("normalizes and projects the fixture corpus", () => {
    // 83 Torah + 53 haftarah calibration verses, edge cases (raw and cleaned where they differ), 28 week verses,
    // 2 single-verse fixtures and 4 synthetic verses. The study normalizer refuses five fixture strings
    // (a ketiv or qere without its pair, an empty pisqa span), so the reader never shows them at all.
    expect(sources.length).toBe(192);
    expect(verses.length).toBe(187);
    expect(verses.filter(value => projectStudyVerse(value.ref, value.hebrew).status === "ready").length).toBe(verses.length);
    expect(verses.some(value => value.hebrew.segments.some(segment => segment.kind === "alternative"))).toBe(true);
    expect(verses.some(value => value.hebrew.segments[0].kind === "inverted-nun")).toBe(true);
    expect(verses.some(value => value.hebrew.paragraphAfter === "petuchah") && verses.some(value => value.hebrew.paragraphAfter === "setumah")).toBe(true);
    expect(verses.some(value => value.hebrew.text.includes("\u05be")) && verses.some(value => value.hebrew.text.includes("\u05c0")) && verses.some(value => value.hebrew.text.includes("\u05c3"))).toBe(true);
  });
  it("spells every fixture verse exactly as tikkunText, word by word, with and without colors", () => {
    let checked = 0;
    for (const value of verses) {
      const projected = projectStudyVerse(value.ref, value.hebrew);
      if (projected.status !== "ready") continue;
      const pieces = tikkunPieces(projected.projection.runs);
      // With the inverted-nun signs set aside, the letters and word spaces are exactly tikkunText's.
      expect(pieces.filter(piece => !piece.sign).map(piece => piece.text).join("").replace(/ {2,}/g, " ").trim(), value.ref).toBe(tikkunText(value.hebrew.text));
      expect(pieces.filter(piece => piece.sign).length, value.ref).toBe(value.hebrew.segments.filter(segment => segment.kind === "inverted-nun").length);
      // Every piece is a sign, a single space or letters only; spaces and signs never carry a word.
      for (const piece of pieces) expect(piece.sign ? piece.text === INVERTED_NUN && piece.wordIndex === null : piece.text === " " ? piece.wordIndex === null : [...piece.text].every(char => isHebrewLetter(char.codePointAt(0)!)), value.ref).toBe(true);
      const colored = colorStudyVerse(value.ref, value.hebrew, { kind: "torah", confirmed: true, verses: [value.ref] });
      const plain = render(createElement(TikkunVerse, { verse: value }))[0];
      for (const colors of [colored.status === "ready" ? colored : null, null]) {
        const tree = render(createElement(TikkunVerse, { verse: value, projection: projected.projection, colors }))[0];
        // The inverted-nun signs stay exactly where the uncolored tikkun puts them.
        expect(text(tree), value.ref).toBe(text(plain));
      }
      checked++;
    }
    expect(checked).toBe(verses.length);
  });
  it("colors each written word with its pointed word's family, and a ketiv with its first read word", () => {
    const value = verse("Numbers 10:35", synthetic[0].html)!, projected = projectStudyVerse(value.ref, value.hebrew);
    if (projected.status !== "ready") throw new Error("Synthetic projection not ready");
    const colored = colorStudyVerse(value.ref, value.hebrew, { kind: "torah", confirmed: true, verses: [value.ref] });
    if (colored.status !== "ready") throw new Error("Synthetic colors not ready");
    const words = render(createElement(TikkunVerse, { verse: value, projection: projected.projection, colors: colored })).filter(node => attr(node, "data-tikkun-word") !== undefined);
    expect(words.length).toBeGreaterThan(0);
    for (const node of words) expect(attr(node, "data-family")).toBe(colored.words[Number(attr(node, "data-tikkun-word"))].family ?? undefined);
    const alternative = projected.projection.runs.find(run => run.kind === "alternative")!;
    if (alternative.kind !== "alternative") throw new Error("No alternative");
    const firstRead = alternative.read.find(part => part.wordIndex !== null)!.wordIndex!;
    expect(words.filter(node => Number(attr(node, "data-tikkun-word")) === firstRead).map(text)).toEqual([tikkunText(alternative.written)]);
    // The read form (qere) is never written in the tikkun.
    expect(text(render(createElement(TikkunVerse, { verse: value, projection: projected.projection, colors: colored }))[0])).not.toContain("\u05e7\u05e8\u05d9");
  });
  it("writes the inverted nuns where they stand: opening Numbers 10:35 and closing 10:36 before its open-paragraph gap", () => {
    const [opening, closing] = [verse("Numbers 10:35", synthetic[0].html)!, verse("Numbers 10:36", synthetic[1].html)!];
    expect(closing.hebrew.paragraphAfter).toBe("petuchah");
    expect(closing.hebrew.segments.at(-1)!.kind).toBe("gap");
    for (const value of [opening, closing]) {
      const projected = projectStudyVerse(value.ref, value.hebrew);
      if (projected.status !== "ready") throw new Error("Synthetic projection not ready");
      const colored = colorStudyVerse(value.ref, value.hebrew, { kind: "torah", confirmed: true, verses: [value.ref] });
      const letters = tikkunText(value.hebrew.text);
      const expected = value === opening ? `${INVERTED_NUN} ${letters}` : `${letters} ${INVERTED_NUN}`;
      for (const props of [{ verse: value }, { verse: value, projection: projected.projection }, { verse: value, projection: projected.projection, colors: colored.status === "ready" ? colored : null }]) {
        const all = render(createElement(TikkunVerse, props));
        expect(text(all[0]), value.ref).toBe(expected);
        expect(all.filter(node => attr(node, "role") === "img" && attr(node, "aria-label") === "Inverted nun, Masoretic sign")).toHaveLength(1);
      }
    }
  });
  it("lights the ketiv while any word of its multi-word qere plays", () => {
    // Shaped like Genesis 30:11 (ketiv of one word, qere of two), in invented syllables.
    const value = verse("Genesis 30:11", '\u05d0\u05b8\u0591\u05d1 <span class="mam-kq"><span class="mam-kq-k">\u05d1\u05b0\u05d2\u05b8\u05d3</span><span class="mam-kq-q">[\u05d1\u05b8\u05bc\u05a3\u05d0 \u05d2\u05b8\u05bd\u05d3]</span></span> \u05d4\u05b8\u05c3')!;
    const projected = projectStudyVerse(value.ref, value.hebrew);
    if (projected.status !== "ready") throw new Error("Synthetic projection not ready");
    const alternative = projected.projection.runs.find(run => run.kind === "alternative")!;
    if (alternative.kind !== "alternative") throw new Error("No alternative");
    const read = [...new Set(alternative.read.flatMap(part => part.wordIndex === null ? [] : [part.wordIndex]))];
    expect(read).toHaveLength(2);
    for (const activeWord of [...read, 0, null]) {
      const all = render(createElement(TikkunVerse, { verse: value, projection: projected.projection, activeWord }));
      const ketiv = all.find(node => attr(node, "data-tikkun-word") === String(read[0]))!;
      expect(text(ketiv)).toBe(tikkunText(alternative.written));
      expect(attr(ketiv, "data-reference-active"), String(activeWord)).toBe(activeWord !== null && read.includes(activeWord) ? "true" : undefined);
      expect(all.filter(node => attr(node, "data-reference-active") === "true")).toHaveLength(activeWord === null ? 0 : 1);
    }
  });
});

describe("stored tikkun view", () => {
  it("carries the earlier on/off choice over and lets a stored view win", () => {
    expect(parseReadingPrefs(null).tikkunView).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: true })).tikkunView).toBe("beside");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: false })).tikkunView).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: false, tikkunView: "only" })).tikkunView).toBe("only");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: true, tikkunView: "off" })).tikkunView).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: true, tikkunView: "sideways" })).tikkunView).toBe("beside");
    expect(parseReadingPrefs(JSON.stringify({ tikkun: "yes", tikkunView: 3 })).tikkunView).toBe("off");
    expect(parseReadingPrefs("not json").tikkunView).toBe("off");
    expect(parseReadingPrefs(JSON.stringify({ colors: false, size: "large", tikkun: true }))).toMatchObject({ colors: false, size: "large", tikkunView: "beside" });
  });
});
