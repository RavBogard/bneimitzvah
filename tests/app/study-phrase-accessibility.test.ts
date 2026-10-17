import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { expect, it, vi } from "vitest";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { AnnotatedStudyVerse } from "../../src/components/portal/workspace/study/annotations";
import { LiftedLine } from "../../src/components/portal/workspace/study/lift";

const prefs = vi.hoisted(() => ({ colors: true, translation: false, size: "standard" }));
vi.mock("server-only", () => ({}));
vi.mock("../../src/components/portal/workspace/reading-prefs", () => ({ useReadingPrefs: () => prefs, useSetReadingPrefs: () => () => {} }));
type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(value => value.name === name)?.value : undefined;
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
function nodes(node: Node): Node[] { return [node, ...children(node).flatMap(nodes)]; }
const verses = ["Genesis 1:1", "Genesis 1:2"].map(ref => {
  const hebrew = normalizeHebrew("אָ֑ב גַּֽד׃");
  return { ref, hebrew: { ...hebrew, segments: [...hebrew.segments] }, english: null };
});
const assignment = { kind: "torah" as const, confirmed: true, verses: verses.map(verse => verse.ref) };

it("gives every colored reading word a unique, nonempty phrase description alongside the open practice dialog", () => {
  prefs.colors = true;
  const root = parseFragment(renderToStaticMarkup(createElement(Fragment, null,
    ...verses.map(verse => createElement(AnnotatedStudyVerse, { key: verse.ref, verse, assignment, group: "reading", learner: true })),
    createElement(LiftedLine, { verses, assignment, index: 0, total: 2, offset: 0, onIndex() {}, onClose() {}, learner: true }),
  )));
  const all = nodes(root), descriptions = all.filter(node => attr(node, "aria-describedby"));
  expect(descriptions.length).toBeGreaterThanOrEqual(6);
  const ids = all.map(node => attr(node, "id")).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  for (const word of descriptions) {
    for (const id of attr(word, "aria-describedby")!.split(/\s+/)) {
      const matches = all.filter(node => attr(node, "id") === id);
      expect(matches).toHaveLength(1);
      expect(text(matches[0])).toMatch(/\S.*Word/);
    }
  }
  const listLegends = all.filter(node => attr(node, "class") === "sr-only");
  expect(listLegends).toHaveLength(2);
  expect(listLegends.every(node => text(node).includes("Word"))).toBe(true);
});

it("removes phrase descriptions and word references together when colors are off", () => {
  prefs.colors = false;
  try {
    const all = nodes(parseFragment(renderToStaticMarkup(createElement(AnnotatedStudyVerse, { verse: verses[0], assignment, group: "plain", learner: true }))));
    expect(all.filter(node => attr(node, "aria-describedby"))).toHaveLength(0);
    expect(all.filter(node => attr(node, "aria-label")?.startsWith("Phrase families"))).toHaveLength(0);
    expect(all.filter(node => attr(node, "class") === "sr-only")).toHaveLength(0);
  } finally { prefs.colors = true; }
});
