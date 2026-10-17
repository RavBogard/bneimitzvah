import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";

const k = '<span class="mam-kq-k">בָ</span>', q = '<span class="mam-kq-q">[גָ דָ]</span>';
const pair = (reverse: boolean, separator = "\n\t ") => `<span class="mam-kq">${(reverse ? [q, k] : [k, q]).join(separator)}</span>`;
const source = (first: boolean, second: boolean) => `אָ${pair(first)}הָ־<span class="mam-kq-trivial">וָ</span> ${pair(second)}זָ׃<span class="mam-spi-samekh">{ס}</span>`;

for (const first of [false, true]) for (const second of [false, true]) test(`independent mixed-boundary KQ permutations ${first}/${second} preserve exact canonical segments and spoken source spans`, () => {
  const actual = normalizeHebrew(source(first, second)), expected = normalizeHebrew(source(false, false));
  expect(actual).toEqual(expected); expect(actual.paragraphAfter).toBe("setumah");
  const projected = projectStudyVerse("Genesis 1:1", actual); expect(projected).toEqual(projectStudyVerse("Genesis 1:1", expected));
  if (projected.status !== "ready") throw new Error("Synthetic KQ projection unavailable");
  expect(projected.projection.words.map(word => word.text)).toEqual(["אָגָ", "דָהָ", "וָ", "גָ", "דָזָ"].map(text => text.normalize("NFC")));
  expect(projected.projection.words.map(word => word.index)).toEqual([0, 1, 2, 3, 4]);
  for (const word of projected.projection.words) expect(word.spans.map(span => {
    const segment = actual.segments[span.segment];
    const text = span.field === "text" && segment.kind === "text" ? segment.text : span.field === "read" && segment.kind === "alternative" ? segment.read : "";
    return text.slice(span.start, span.end);
  }).join("")).toBe(word.text);
  expect(JSON.parse(JSON.stringify(actual))).toEqual(expected);
});

const badSides: [string, string][] = [
  ["duplicate semantic class", k.replace("mam-kq-k", "mam-kq-k mam-kq-k") + q],
  ["overlapping classes", k.replace("mam-kq-k", "mam-kq-k mam-kq-q") + q],
  ["two ketiv", k + k], ["two qere", q + q], ["missing ketiv", q], ["missing qere", k],
  ["empty ketiv", '<span class="mam-kq-k"> </span>' + q], ["empty qere", k + '<span class="mam-kq-q">[ ]</span>'],
  ["numeric side", k + '<span class="mam-kq-q">[123]</span>'],
  ["third side", q + k + q], ["nonwhitespace sibling", q + "דָ" + k], ["comment sibling", q + "<!--synthetic-->" + k],
  ["wrong tag", k.replaceAll("span", "b") + q], ["attribute on first", k.replace('class=', 'id="synthetic" class=') + q],
  ["attribute on second", q + k.replace('class=', 'title="synthetic" class=')],
  ["nested semantic pair", k + `<span class="mam-kq-q">${pair(true)}</span>`],
  ["nested standalone ketiv", q + '<span class="mam-kq-k"><span class="mam-kq-k">בָ</span></span>'],
  ["encoded direction override", k + q.replace("גָ", "גָ&#x202e;")],
  ["encoded control", k + q.replace("גָ", "גָ&#x1f;")],
  ...[false, true].flatMap(reverse => [0, 1, 2].map(position => {
    const sides = reverse ? [q, k] : [k, q]; sides.splice(position, 0, "&#xfeff;");
    return [`encoded forbidden BOM position ${position}, reversed ${reverse}`, sides.join("")] as [string, string];
  })),
];
test.each(badSides)("independent strict KQ boundary rejects %s", (_label, children) => {
  expect(() => normalizeHebrew(`אָ<span class="mam-kq">${children}</span>זָ׃`)).toThrow("Unsupported study markup");
});

test("independent ordering allowance never accepts standalone semantic sides or empty reviewed sides", () => {
  for (const text of [k, q, '<span class="mam-kq-k"></span>', '<span class="mam-kq-q">[]</span>']) expect(() => normalizeHebrew(`אָ ${text} זָ׃`)).toThrow("Unsupported study markup");
});
