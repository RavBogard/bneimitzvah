import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeEnglish, normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";

test("trivial wrappers preserve mixed real ketiv/qere, maqaf words and paragraph identity without changing read-word indices", () => {
  const ordinary = '<span class="mam-kq"><span class="mam-kq-k">דָ</span><span class="mam-kq-q">[הָ]</span></span>';
  const form = "בָ֣\u034f־גָ", ending = '<span class="mam-spi-samekh">{ס}</span>';
  const wrapped = normalizeHebrew(`אָב <span class="mam-kq-trivial">${form}</span> ${ordinary} וָ׃${ending}`);
  const bare = normalizeHebrew(`אָב ${form} ${ordinary} וָ׃${ending}`);
  expect(wrapped.text).toBe(bare.text); expect(wrapped.readingText).toBe(bare.readingText);
  expect(wrapped.text).toContain("דָ"); expect(wrapped.readingText).toContain("הָ");
  expect(wrapped.segments.filter(row => row.kind === "alternative")).toEqual([{ kind: "alternative", written: "דָ", read: "הָ" }]);
  expect(wrapped.paragraphAfter).toBe("setumah");
  const actual = projectStudyVerse("Genesis 1:1", wrapped), baseline = projectStudyVerse("Genesis 1:1", bare);
  expect(actual.status).toBe("ready"); expect(baseline.status).toBe("ready");
  if (actual.status !== "ready" || baseline.status !== "ready") throw new Error("Synthetic projection unavailable");
  expect(actual.projection.words.map(({ index, text }) => ({ index, text }))).toEqual(baseline.projection.words.map(({ index, text }) => ({ index, text })));
  // Wrapper boundaries legitimately change segment-local offsets. Resolve each
  // pointer against its own immutable segment rather than comparing offsets
  // from differently segmented inputs.
  for (const word of actual.projection.words) expect(word.spans.map(span => {
    const segment = wrapped.segments[span.segment];
    const text = span.field === "text" && segment.kind === "text" ? segment.text : span.field === "read" && segment.kind === "alternative" ? segment.read : "";
    return text.slice(span.start, span.end);
  }).join("")).toBe(word.text);
  expect(actual.projection.words.map(word => word.index)).toEqual(actual.projection.words.map((_, index) => index));
});

test("decoded plaintext and canonical whitespace survive adjacent trivial segments without entity or HTML artifacts", () => {
  const verse = normalizeHebrew('אָב <span class="mam-kq-trivial">בָ&#x034f;&nbsp;גָ</span> <span class="mam-kq-trivial">דָ</span> הָ׃');
  const bare = normalizeHebrew("אָב בָ\u034f גָ דָ הָ׃");
  expect(verse.text).toBe(bare.text); expect(verse.readingText).toBe(bare.readingText);
  expect(verse.segments.every(segment => segment.kind === "text")).toBe(true);
  expect(verse.text).not.toMatch(/[<&]/); expect(Object.isFrozen(verse) && Object.isFrozen(verse.segments)).toBe(true);
});

test.each([
  '<span class="mam-kq-trivial">אָ&#x5b;בָ&#x5d;</span>',
  '<span class="mam-kq-trivial">אָ&#x2066;בָ</span>',
  '<span class="mam-kq-trivial">אָ&#x7f;</span>',
  '<span class="mam-kq-trivial">אָ<sup class="footnote-marker">ב</sup></span>',
  '<span class="mam-kq-trivial">אָ<span class="mam-spi-pe">{פ}</span></span>',
  '<span class="mam-kq-trivial" class="mam-kq-trivial">אָ</span>',
  '<span class="mam-kq"><span class="mam-kq-k"><span class="mam-kq-trivial">אָ</span></span><span class="mam-kq-q">[בָ]</span></span>',
])("does not collapse encoded alternatives, hidden controls or nested semantics into a trivial plaintext form (%#)", input => {
  expect(() => normalizeHebrew(`אָב ${input} גָ׃`)).toThrow("Unsupported study markup");
});

test("the Hebrew-only trivial allowance does not broaden the translation markup contract", () => {
  expect(() => normalizeEnglish('<span class="mam-kq-trivial">Synthetic אָ</span>')).toThrow("Unsupported study markup");
});
