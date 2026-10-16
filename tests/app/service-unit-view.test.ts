import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { expect, it } from "vitest";
import { ServiceUnitView } from "../../src/components/portal/service-learning/unit-view";
import type { ServiceBlock, ServiceUnitMaterial } from "../../src/lib/service-learning/types";

type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const text = (node: Node): string => "value" in node ? node.value : children(node).map(text).join("");
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(a => a.name === name)?.value : undefined;
function find(node: Node, predicate: (node: Node) => boolean): Node[] { return [...(predicate(node) ? [node] : []), ...children(node).flatMap(child => find(child, predicate))]; }
const named = (name: string) => (node: Node) => node.nodeName === name;
const classed = (name: string) => (node: Node) => attr(node, "class")?.split(" ").includes(name) ?? false;
const h = (n: number): ServiceBlock => ({ type: "stanza", he: `אָ֑ב ${n}` });
const e = (n: number): ServiceBlock => ({ type: "english", en: `Synthetic meaning ${n}.` });
const rubric = (n: number): ServiceBlock => ({ type: "rubric", text: [{ t: `Synthetic instruction ${n}.` }] });
type Fixture = { -readonly [Key in keyof ServiceUnitMaterial]: ServiceUnitMaterial[Key] };
function material(blocks: readonly ServiceBlock[], hint?: Record<string, string | number | readonly number[]>): Fixture {
  return { unit: { id: "synthetic.part@bm-shacharit", family: "bm-shacharit", name: "Synthetic selected unit", section: 0, blocks,
    caption: "Synthetic caption credit", ...(hint ? { renderStructure: hint } : {}) },
    section: { idx: 0, en: "Synthetic section" }, blockGranularity: "line",
    license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic global attribution" },
    source: { catalogIdentity: "a".repeat(64), sourceGitSha: "b".repeat(40), sourceBuiltAt: "2026-10-16T00:00:00Z", artifactCommit: "c".repeat(40), artifactRunId: "123" } };
}
function rendered(value: ServiceUnitMaterial) { const html = renderToStaticMarkup(createElement(ServiceUnitView, { material: value })); return { html, root: parseFragment(html) }; }
const occurrences = (value: string, part: string) => value.split(part).length - 1;
function complete(value: ServiceUnitMaterial, root: Node) {
  const visible = text(root);
  for (const source of value.unit.blocks) {
    if (source.he) expect(occurrences(visible, source.he)).toBe(1);
    if (typeof source.en === "string" && source.en) expect(occurrences(visible, source.en)).toBe(1);
    for (const span of source.text ?? []) if ("t" in span) expect(occurrences(visible, span.t)).toBe(1);
  }
  expect(occurrences(visible, value.unit.name)).toBe(1);
  expect(occurrences(visible, value.unit.caption!)).toBe(1);
  expect(occurrences(visible, value.license.attribution!)).toBe(1);
  expect(occurrences(visible, value.license.spdx)).toBe(1);
}

const pair = () => [h(1), e(1), h(2), e(2)];
const cases: { kind: string; blocks: ServiceBlock[]; hint?: Record<string, string | number | readonly number[]>; interleave?: boolean }[] = [
  { kind: "litany", blocks: [{ ...h(1), gold: true }, e(1), h(2), e(2)], hint: { rows: [2, 2], refrain: 0 }, interleave: true },
  { kind: "paired-passages", blocks: [rubric(3), ...pair(), rubric(4)], hint: { groups: [2, 2], head: 1, tail: 1 } },
  { kind: "paragraphs", blocks: pair(), hint: { groups: [2, 2] } },
  { kind: "parallel-passages", blocks: [h(1), h(2), e(1), e(2)], hint: { rows: 2 } },
  { kind: "refrain-song", blocks: pair(), hint: { groups: [1, 1], refrainGroups: [1] } },
  ...["section-close", "section-opening", "section-opening-call", "section-start", "threshold", "title-page"].map(kind => ({ kind, blocks: [h(1), e(1), rubric(2)] })),
  { kind: "service-event", blocks: [rubric(1), rubric(2)] },
  { kind: "short-prayer", blocks: [{ ...h(1), en: "Synthetic meaning 1." }], hint: { groups: [1] } },
  { kind: "short-sequence", blocks: [e(3), ...pair(), e(4)], hint: { head: 1, tail: 1, rows: [2, 2] }, interleave: true },
  { kind: "source-lines", blocks: [h(1), h(2), e(1)], hint: { groups: [2] } },
  { kind: "stanza-groups", blocks: [h(1), h(2), e(1), rubric(2)], hint: { groups: [1, 1], tail: 2, refrainGroups: [0] } },
];

it.each(cases)("renders complete selected content once for the $kind source hint", sample => {
  const value = material(sample.blocks, { kind: sample.kind, ...sample.hint });
  if (sample.interleave) value.unit = { ...value.unit, render: "interleave" };
  const { root } = rendered(value);
  complete(value, root);
  expect(find(root, named("article"))).toHaveLength(1);
  expect(attr(find(root, named("article"))[0], "data-layout")).toBe(sample.kind);
  for (const node of find(root, classed("service-unit-hebrew"))) {
    expect(attr(node, "lang")).toBe("he"); expect(attr(node, "dir")).toBe("rtl");
  }
});

it("pairs parallel source rows with their corresponding English without duplicate text", () => {
  const { root } = rendered(material([h(1), h(2), e(1), e(2)], { kind: "parallel-passages", rows: 2 }));
  expect(find(root, classed("service-unit-group")).map(text)).toEqual(["אָ֑ב 1Synthetic meaning 1.", "אָ֑ב 2Synthetic meaning 2."]);
});

const incompatibleHints: Record<string, string | number | readonly number[]>[] = [
  { kind: "paired-passages", groups: [2], head: 1, tail: 0 },
  { kind: "paragraphs", groups: [7] },
  { kind: "stanza-groups", groups: [1, 1], tail: 0 },
  { kind: "parallel-passages", rows: 3 },
  { kind: "refrain-song", groups: [1], refrainGroups: [4] },
  { kind: "short-sequence", rows: [1], head: 0, tail: 0 },
  { kind: "unrecognized" },
];
it.each(incompatibleHints)("keeps ordinary complete content when a $kind declaration is stale or incompatible", hint => {
  const value = material([rubric(3), ...pair(), rubric(4)], hint);
  complete(value, rendered(value).root);
});

it("interleaves source runs without absorbing leading/trailing English or original English instructions", () => {
  const original = { ...e(5), role: "original" as const };
  const value = material([e(3), ...pair(), e(4), original, rubric(6)]); value.unit = { ...value.unit, render: "interleave" };
  const { root } = rendered(value); complete(value, root);
  expect(find(root, classed("service-unit-group")).map(text)).toEqual([
    "Synthetic meaning 3.", "אָ֑ב 1Synthetic meaning 1.", "אָ֑ב 2Synthetic meaning 2.", "Synthetic meaning 4.", "Synthetic meaning 5.", "Synthetic instruction 6.",
  ]);
  expect(find(root, classed("service-source-english")).map(text)).toContain("Synthetic meaning 5.");
  expect(text(root)).not.toContain("Translation");
});

it("substitutes exact coordinated segments while preserving all block apparatus and credits once", () => {
  const value = material([{ type: "stanza", he: "אָ֑בגּד", en: "First synthetic. Second synthetic.", label: "Synthetic label", cue: "Synthetic cue", occasion: "Synthetic occasion",
    marks: [{ type: "ritual", label: "Synthetic mark" }], text: [{ t: "Synthetic instruction" }], footnote: [{ t: "Synthetic segment author credit" }] }]);
  value.unit = { ...value.unit, renderSegments: { he: ["אָ֑ב", "גּד"], en: ["First synthetic. ", "Second synthetic."] } };
  const { root } = rendered(value);
  expect(find(root, classed("service-unit-hebrew")).map(text)).toEqual(["אָ֑ב", "גּד"]);
  expect(find(root, classed("service-unit-english")).map(text)).toEqual(["First synthetic. ", "Second synthetic."]);
  for (const part of ["Synthetic label", "Synthetic cue", "Synthetic occasion", "Synthetic mark", "Synthetic instruction", "Synthetic segment author credit", "Synthetic caption credit", "Synthetic global attribution"])
    expect(occurrences(text(root), part)).toBe(1);
});

it("preserves exact whole-block segments and falls back for ambiguous or rewritten multi-block segments", () => {
  const blocks = [{ ...h(1), en: "Meaning one" }, { ...h(2), en: "Meaning two" }];
  const value = material(blocks); value.unit = { ...value.unit, renderSegments: { he: [blocks[0].he!, blocks[1].he!], en: ["Meaning one", "Meaning two"] } };
  complete(value, rendered(value).root);
  const unsafe = material(pair()); unsafe.unit = { ...unsafe.unit, renderSegments: { he: ["אָ֑ב 1אָ֑ב 2"], en: ["Synthetic meaning 1.Synthetic meaning 2."] } };
  const before = rendered(material(pair())).root;
  expect(text(rendered(unsafe).root)).toBe(text(before));
  unsafe.unit = { ...unsafe.unit, renderSegments: { he: ["Changed text"], en: ["Changed meaning"] } };
  expect(text(rendered(unsafe).root)).toBe(text(before));
});

it("retains nested span markup, source-owned English and every note with valid native keyboard targets", () => {
  const value = material([{ type: "english", role: "original", en: [{ t: "Synthetic prose " }, { em: [{ strong: [{ t: "Synthetic emphasis" }] }] },
    { footnote: [{ t: "Synthetic inline credit " }, { footnote: [{ t: "Synthetic nested note" }] }] }], footnote: [{ t: "Synthetic block credit" }] }]);
  const { root } = rendered(value);
  expect(find(root, named("em")).map(text)).toEqual(["Synthetic emphasis"]);
  expect(find(root, named("strong")).map(text)).toEqual(["Synthetic emphasis"]);
  expect(find(root, named("details"))).toHaveLength(3);
  expect(find(root, named("summary"))).toHaveLength(3);
  const targets = find(root, named("summary")).map(node => attr(node, "id"));
  for (const link of find(root, named("a"))) expect(targets).toContain(attr(link, "href")!.slice(1));
  for (const credit of ["Synthetic inline credit", "Synthetic nested note", "Synthetic block credit"]) expect(occurrences(text(root), credit)).toBe(1);
  expect(text(root)).not.toContain("Translation");
});

it("escapes HTML-like text and never expands bare/transliteration, companions, groups, neighbours or global front matter", () => {
  const source = { ...h(1), en: "<img src=x onerror=alert(1)>", bare: "UNSELECTED_BARE", tr: "UNSELECTED_TRANSLITERATION" };
  const selected = { ...material([source]), front: [rubric(9)], units: [{ name: "UNSELECTED_COMPANION" }, { name: "UNSELECTED_NEIGHBOUR" }] };
  selected.unit = { ...selected.unit, group: "UNSELECTED_GROUP" };
  const { html, root } = rendered(selected);
  expect(find(root, named("img"))).toHaveLength(0); expect(find(root, named("script"))).toHaveLength(0);
  expect(text(root)).toContain(source.en);
  expect(html).not.toContain("UNSELECTED_"); expect(text(root)).not.toContain("Synthetic instruction 9.");
  expect(find(root, named("article"))).toHaveLength(1);
});

it("derives source-owned English boundaries without changing or repeating their canonical text", () => {
  const value = material([{ type: "english", role: "original", en: "First synthetic. Second synthetic. Third synthetic." }]);
  value.unit = { ...value.unit, sourceBoundaries: { en: [{ block: 0, endAfter: "First synthetic." }, { block: 0, endAfter: "Second synthetic." }] } };
  const { root } = rendered(value);
  expect(find(root, classed("service-source-segment")).map(text)).toEqual(["First synthetic.", " Second synthetic.", " Third synthetic."]);
  complete(value, root);
});

it("keeps apparatus once on mixed-language blocks and preserves every accepted block kind", () => {
  const kinds = ["stanza", "trope", "english", "rubric", "chatimah", "seasonal", "display"];
  const value = material(kinds.map((type, index) => ({ type, he: `אָ֑ב ${index}`, en: `Synthetic meaning ${index}.`,
    footnote: [{ t: `Synthetic credit ${index}.` }], label: `Synthetic label ${index}.`, marks: [{ type: "ritual", label: `Synthetic mark ${index}.` }] })));
  const { root } = rendered(value); complete(value, root);
  expect(find(root, named("details"))).toHaveLength(kinds.length);
  for (let index = 0; index < kinds.length; index++) for (const part of [`Synthetic credit ${index}.`, `Synthetic label ${index}.`, `Synthetic mark ${index}.`]) expect(occurrences(text(root), part)).toBe(1);
});

it("retains every authored repeated refrain rather than inventing another repetition", () => {
  const value = material([h(1), e(1), h(1), e(1)], { kind: "refrain-song", groups: [1, 1], refrainGroups: [0, 1] });
  const { root } = rendered(value);
  expect(occurrences(text(root), "אָ֑ב 1")).toBe(2);
  expect(occurrences(text(root), "Synthetic meaning 1.")).toBe(2);
  expect(find(root, classed("service-unit-refrain"))).toHaveLength(2);
});
