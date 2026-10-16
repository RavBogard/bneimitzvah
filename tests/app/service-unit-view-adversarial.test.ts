import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { expect, test } from "vitest";
import { ServiceUnitView } from "../../src/components/portal/service-learning/unit-view";
import type { ServiceUnitMaterial } from "../../src/lib/service-learning/types";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const content = (node: Node): string => "value" in node ? node.value : children(node).map(content).join("");
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(item => item.name === name)?.value : undefined;
function nodes(node: Node): Node[] { return [node, ...children(node).flatMap(nodes)]; }
const occurrences = (text: string, value: string) => text.split(value).length - 1;
function material(suffix: string): ServiceUnitMaterial {
  return { unit: { id: `invented.${suffix}@bm-shacharit`, family: "bm-shacharit", name: `Invented ${suffix}`, section: 0,
    caption: `Credit ${suffix}`, blocks: [{ type: "english", role: "original",
      text: [{ em: [{ t: `Instruction ${suffix}` }, { footnote: [{ t: `Instruction note ${suffix}` }] }] }],
      en: [{ t: `Prose ${suffix}` }, { strong: [{ footnote: [{ t: `Outer note ${suffix}` },
        { em: [{ footnote: [{ t: `Inner note ${suffix}` }] }] }] }] }],
      footnote: [{ t: `Block note ${suffix}` }] }] },
    section: { idx: 0 }, license: { spdx: `LicenseRef-${suffix}`, attribution: `Attribution ${suffix}` },
    source: { catalogIdentity: "a".repeat(64), sourceGitSha: "abcdef0", sourceBuiltAt: "2026-10-16T00:00:00Z",
      artifactCommit: "b".repeat(40), artifactRunId: "1" } };
}

test("sibling units give every nested source note a unique reachable keyboard target and exact credit", () => {
  const html = renderToStaticMarkup(createElement(Fragment, null,
    createElement(ServiceUnitView, { material: material("first") }), createElement(ServiceUnitView, { material: material("second") })));
  const root = parseFragment(html), all = nodes(root), summaries = all.filter(node => node.nodeName === "summary");
  expect(summaries).toHaveLength(8);
  const ids = all.flatMap(node => attr(node, "id") ? [attr(node, "id")!] : []);
  expect(new Set(ids).size).toBe(ids.length);
  for (const link of all.filter(node => node.nodeName === "a")) {
    expect(attr(link, "href")).toMatch(/^#/);
    expect(summaries.filter(node => attr(node, "id") === attr(link, "href")!.slice(1))).toHaveLength(1);
    expect(attr(link, "aria-label")).toMatch(/^Read note [1-4]$/);
  }
  for (const suffix of ["first", "second"]) for (const label of ["Instruction note", "Outer note", "Inner note", "Block note", "Credit", "Attribution"])
    expect(occurrences(content(root), `${label} ${suffix}`)).toBe(1);
  for (const detail of all.filter(node => node.nodeName === "details")) {
    expect(children(detail)[0].nodeName).toBe("summary");
    let parent = "parentNode" in detail ? detail.parentNode : null;
    while (parent) {
      expect(["p", "span", "em", "strong", "sup", "a"]).not.toContain(parent.nodeName);
      parent = "parentNode" in parent ? parent.parentNode : null;
    }
  }
});

test("coordinated text splits preserve exact Unicode and all apparatus independently of segment count", () => {
  const value = material("segments"), hebrew = "ד\u05b7\u05bc\u2067\u{1f3b5}\u2069", english = "One <script>. Two & end.";
  const source = { type: "stanza", he: hebrew, en: english, text: [{ t: "Segment instruction" }],
    footnote: [{ em: [{ t: "Segment nested credit" }] }], label: "Segment label", verse: "Segment label",
    cue: "Segment cue", occasion: "Segment occasion", marks: [{ type: "ritual", label: "Segment mark" }] };
  const selected = { ...value, unit: { ...value.unit, blocks: [source], renderSegments: {
    he: [hebrew.slice(0, 3), hebrew.slice(3), ""], en: ["One ", "<script>. ", "Two & end."] } } };
  const root = parseFragment(renderToStaticMarkup(createElement(ServiceUnitView, { material: selected }))), all = nodes(root);
  const byClass = (name: string) => all.filter(node => attr(node, "class")?.split(" ").includes(name));
  expect(byClass("service-unit-hebrew").map(content).join("")).toBe(hebrew);
  expect(byClass("service-unit-english").map(content).join("")).toBe(english);
  for (const label of ["Segment instruction", "Segment nested credit", "Segment label", "Segment cue", "Segment occasion", "Segment mark"])
    expect(occurrences(content(root), label)).toBe(1);
  expect(all.filter(node => node.nodeName === "script")).toHaveLength(0);
});

const incompatibleHints: Record<string, string | number | readonly number[]>[] = [
  { kind: "parallel-passages", rows: 1.5 },
  { kind: "paired-passages", groups: [1, 1], head: -1, tail: 0 },
  { kind: "refrain-song", groups: [1, 1], refrainGroups: [0, 0] },
  { kind: "stanza-groups", groups: [1, 1], tail: 1, refrainGroups: [9] },
];
test.each(incompatibleHints)("incompatible hint %j preserves all canonical bodies and credits", hint => {
  const value = material("fallback"), selected = { ...value, unit: { ...value.unit,
    blocks: [{ type: "stanza", he: "דַּג" }, { type: "stanza", he: "זֵח" }, { type: "english", en: "Invented ending." }], renderStructure: hint } };
  const root = parseFragment(renderToStaticMarkup(createElement(ServiceUnitView, { material: selected })));
  for (const text of ["דַּג", "זֵח", "Invented ending.", "Credit fallback", "Attribution fallback"])
    expect(occurrences(content(root), text)).toBe(1);
  expect(attr(nodes(root).find(node => node.nodeName === "article")!, "data-layout")).toBe("ordinary");
});
