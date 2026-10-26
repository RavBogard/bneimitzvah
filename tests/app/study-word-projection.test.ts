import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse, type HebrewSource } from "../../src/lib/hebrew/study-tokens";
import * as annotations from "../../src/lib/hebrew/study-annotations";
import { AnnotatedStudyVerse, StudyHebrew } from "../../src/components/portal/workspace/study/annotations";
import { LiftedLine } from "../../src/components/portal/workspace/study/lift";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";

const prefs = vi.hoisted(() => ({ colors: true, translation: false, size: "standard" }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/reading-prefs", () => ({ useReadingPrefs: () => prefs, useSetReadingPrefs: () => () => {} }));
afterEach(() => { prefs.colors = true; vi.restoreAllMocks(); });

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
function nodes(node: Node): Node[] { return [node, ...children(node).flatMap(nodes)]; }
const wordNodes = (node: Node) => nodes(node).filter(node => attr(node, "data-word-index") !== undefined);
const indexed = (node: Node) => wordNodes(node).map(node => [Number(attr(node, "data-word-index")), text(node)]);
function verse(html: string, ref = "Genesis 1:1"): StudyVerse {
  const hebrew = normalizeHebrew(html);
  return { ref, hebrew: { ...hebrew, segments: [...hebrew.segments] }, english: null };
}
const assignment = (v: StudyVerse) => ({ kind: "torah" as const, confirmed: true, verses: [v.ref] });
function projection(v: StudyVerse) {
  const value = projectStudyVerse(v.ref, v.hebrew);
  if (value.status !== "ready") throw new Error("Synthetic projection not ready");
  return value.projection;
}
function rendered(v: StudyVerse, colored: boolean) {
  const result = colored ? annotations.colorStudyVerse(v.ref, v.hebrew, assignment(v)) : null;
  return parseFragment(renderToStaticMarkup(createElement(StudyHebrew, { verse: v, colors: result?.status === "ready" ? result : null, id: "synthetic" })));
}
function expectedVisible(source: HebrewSource) {
  return source.segments.map((segment, index) => segment.kind === "text" ? segment.text
    : segment.kind === "alternative" ? `${segment.read} read. Chant this word (qere). The scroll writes it differently (ketiv). ${segment.written}`
      : segment.kind === "inverted-nun" ? "׆" : source.paragraphAfter && index === source.segments.length - 1 ? "" : `${segment.break === "petuchah" ? "פ" : "ס"}[${segment.break === "petuchah" ? "open" : "closed"} paragraph]`).join("");
}

it("renders canonical word indices with identical Hebrew and apparatus in both color modes", () => {
  // Invented syllables: split source word, maqaf, two-word qere, internal/trailing gaps and sign.
  for (const v of [verse("אָ֑ב גַּֽד׃"), verse('<span class="mam-spi-invnun">׆</span>אָ<b>ב</b>־גָ֣ ׀ <span class="mam-kq"><span class="mam-kq-k">כָ֔תָב</span><span class="mam-kq-q">[קָ֖רִי דָ֑בָר]</span></span><span class="mam-spi-samekh">{ס}</span>בָֽ׃<span class="mam-spi-pe">{פ}</span>')]) {
    const p = projection(v), plain = rendered(v, false), colored = rendered(v, true);
    const expected = p.runs.flatMap(run => run.kind === "text" ? run.parts : run.kind === "alternative" ? run.read : []).filter(part => part.wordIndex !== null).map(part => [part.wordIndex, part.text]);
    expect(indexed(plain)).toEqual(expected);
    expect(indexed(colored)).toEqual(expected);
    expect(text(plain)).toBe(expectedVisible(v.hebrew));
    expect(text(plain)).toBe(text(colored));
    for (const word of p.words) expect(wordNodes(plain).filter(node => Number(attr(node, "data-word-index")) === word.index).map(text).join("").normalize("NFC")).toBe(word.text);
    expect(nodes(plain).filter(node => attr(node, "data-family") !== undefined || attr(node, "data-phrase") !== undefined || attr(node, "aria-describedby") !== undefined || attr(node, "style") !== undefined)).toHaveLength(0);
    expect(nodes(colored).filter(node => attr(node, "data-family") !== undefined).length).toBeGreaterThan(0);
  }
});

it("indexes read qere only and preserves literal maqaf outside the canonical reading words", () => {
  const v = verse('אָב־גָ <span class="mam-kq"><span class="mam-kq-q">[קָרִי דָבָר]</span><span class="mam-kq-k">כָתָב</span></span> הָ׃');
  const plain = rendered(v, false), colored = rendered(v, true);
  expect(indexed(plain)).toEqual(projection(v).words.map(w => [w.index, w.text]));
  expect(indexed(plain)).toEqual(indexed(colored));
  expect(wordNodes(plain).map(text)).toEqual(["אָב", "גָ", "קָרִי", "דָבָר", "הָ"]);
  expect(wordNodes(plain).map(text).some(value => value.includes("־") || value.includes("כָתָב"))).toBe(false);
  const alternative = nodes(plain).find(node => attr(node, "class") === "study-alternative")!;
  const written = children(alternative).find(node => attr(node, "class") === "study-ketiv")!;
  expect(text(written)).toBe("כָתָב");
  expect(wordNodes(written)).toHaveLength(0);
  expect(text(plain)).toBe(expectedVisible(v.hebrew));
});

it("does no phrase analysis, family attributes, legends or phrase navigation when colors are off", () => {
  prefs.colors = false;
  const analyzed = vi.spyOn(annotations, "colorStudyVerse"), v = verse("אָ֑ב גַּֽד׃");
  const root = parseFragment(renderToStaticMarkup(createElement(Fragment, null,
    createElement(AnnotatedStudyVerse, { verse: v, assignment: assignment(v), group: "plain" }),
    createElement(LiftedLine, { verses: [v], assignment: assignment(v), index: 0, total: 1, offset: 0, onIndex() {}, onClose() {} }),
  )));
  const all = nodes(root);
  expect(analyzed).not.toHaveBeenCalled();
  expect(wordNodes(root)).toHaveLength(projection(v).words.length * 2);
  expect(all.filter(node => attr(node, "data-family") !== undefined || attr(node, "data-phrase") !== undefined || attr(node, "aria-describedby") !== undefined)).toHaveLength(0);
  expect(all.filter(node => attr(node, "aria-label")?.startsWith("Phrase families"))).toHaveLength(0);
  expect(text(root)).not.toContain("Next phrase");
  expect(text(root)).not.toContain("phrase 1 of");
  expect(text(root)).toContain("Next verse");
});

it("keeps word projection available for unsupported phrase-color systems", () => {
  for (const ref of ["Psalms 1:1", "Proverbs 1:1", "Job 1:1"]) {
    const v = verse("אָ֑ב־גָֽ׃", ref);
    expect(annotations.colorStudyVerse(v.ref, v.hebrew, assignment(v))).toMatchObject({ status: "unavailable", reason: "unsupported-system" });
    const root = parseFragment(renderToStaticMarkup(createElement(AnnotatedStudyVerse, { verse: v, assignment: assignment(v), group: "unsupported" })));
    expect(indexed(root)).toEqual(projection(v).words.map(w => [w.index, w.text]));
    expect(nodes(root).filter(node => attr(node, "data-family") !== undefined || attr(node, "data-phrase") !== undefined || attr(node, "aria-describedby") !== undefined)).toHaveLength(0);
    expect(text(root)).toContain("Phrase colors aren’t available for Psalms, Proverbs and Job yet.");
  }
});

it("retains the original visible fallback without invented indices when projection fails", () => {
  const v = verse('אָב <span class="mam-kq"><span class="mam-kq-k">כָתָב</span><span class="mam-kq-q">[קָרִי]</span></span><span class="mam-spi-samekh">{ס}</span>');
  const stale = { ...v, hebrew: { ...v.hebrew, readingText: "שָ׃" } };
  for (const failed of [stale, verse("בָ ".repeat(513))]) {
    expect(projectStudyVerse(failed.ref, failed.hebrew).status).toBe("unavailable");
    const root = rendered(failed, false);
    expect(wordNodes(root)).toHaveLength(0);
    expect(text(root)).toBe(expectedVisible(failed.hebrew));
    expect(nodes(root).filter(node => attr(node, "data-family") !== undefined || attr(node, "aria-describedby") !== undefined)).toHaveLength(0);
  }
});

it("preserves escaped literal payloads, source spans and frozen inputs", () => {
  const v = verse("אָ֑ב &lt;img src=x onerror=synthetic()&gt; גָֽ׃");
  const before = JSON.stringify(v);
  v.hebrew.segments.forEach(Object.freeze); Object.freeze(v.hebrew.segments); Object.freeze(v.hebrew); Object.freeze(v);
  const root = rendered(v, false);
  expect(text(root)).toBe(expectedVisible(v.hebrew));
  expect(nodes(root).filter(node => node.nodeName === "img")).toHaveLength(0);
  expect(wordNodes(root).map(text)).toEqual(projection(v).words.map(word => word.text));
  expect(JSON.stringify(v)).toBe(before);
});
