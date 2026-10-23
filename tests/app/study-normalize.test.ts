import { describe, expect, it, vi } from "vitest";
import { normalizeEnglish, normalizeHebrew } from "../../src/server/study/normalize";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { studyCacheBinding, validateStudyChapterContent } from "../../src/server/study/cache";
import { MAM } from "../../src/server/study/versions";
vi.mock("server-only", () => ({}));

describe("synthetic study plaintext normalization", () => {
  it("preserves Hebrew marks, CGJ and punctuation while canonically normalizing whitespace", () => {
    const text = "אָ֑בֽ־ג׀ד׃\u034f";
    const verse = normalizeHebrew(`<big>${text}</big>&nbsp;<b>ב</b><br>ג`);
    expect(verse.text).toBe(`${text.normalize("NFC")} ב ג`);
    expect(verse.readingText).toBe(verse.text);
    expect(Object.isFrozen(verse) && Object.isFrozen(verse.segments)).toBe(true);
  });
  it("keeps written/read forms separate without brackets or duplicate spoken words", () => {
    const verse = normalizeHebrew('אָב <span class="mam-kq"><span class="mam-kq-k">כְּתָב</span> <span class="mam-kq-q">[קְרִי]</span></span> ג׃');
    expect(verse.text).toBe("אָב כְּתָב ג׃".normalize("NFC"));
    expect(verse.readingText).toBe("אָב קְרִי ג׃".normalize("NFC"));
    expect(verse.segments.find(segment => segment.kind === "alternative")).toEqual({ kind: "alternative", written: "כְּתָב".normalize("NFC"), read: "קְרִי".normalize("NFC") });
  });
  it("identifies both nonempty alternatives by exact semantic class regardless of child order", () => {
    const k = '<span class="mam-kq-k">בָ֔־גָ</span>', q = '<span class="mam-kq-q">[דָ֖ הָ֑]</span>';
    const normal = normalizeHebrew(`אָב־זָ <span class="mam-kq">${k} ${q}</span> וָ׃`);
    const reversed = normalizeHebrew(`אָב־זָ <span class="mam-kq">${q} ${k}</span> וָ׃`);
    expect(reversed).toEqual(normal);
    expect(reversed.text).toBe("אָב־זָ בָ֔־גָ וָ׃".normalize("NFC"));
    expect(reversed.readingText).toBe("אָב־זָ דָ֖ הָ֑ וָ׃".normalize("NFC"));
    const projected = projectStudyVerse("Genesis 1:1", reversed);
    expect(projected).toEqual(projectStudyVerse("Genesis 1:1", normal));
    if (projected.status !== "ready") throw new Error("Synthetic qere projection unavailable");
    expect(projected.projection.words.map(word => [word.index, word.text])).toEqual(["אָב", "זָ", "דָ֖", "הָ֑", "וָ"].map((text, index) => [index, text.normalize("NFC")]));
    for (const word of projected.projection.words) {
      const reconstructed = word.spans.map(span => {
        const segment = reversed.segments[span.segment];
        return (segment.kind === "text" ? segment.text : segment.kind === "alternative" ? segment.read : "").slice(span.start, span.end);
      }).join("");
      expect(reconstructed).toBe(word.text);
    }
    const payload = { verses: Array.from({ length: 31 }, (_, index) => ({ ref: `Genesis 1:${index + 1}`, hebrew: reversed, english: null })), editions: [MAM] };
    expect(validateStudyChapterContent(studyCacheBinding("Genesis 1"), JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });
  it("normalizes mixed ordinary/reversed alternatives to the same canonical segments and read projection", () => {
    const pair = (reverse: boolean) => { const sides = ['<span class="mam-kq-k"><b>בָ</b></span>', '<span class="mam-kq-q">[גָ]</span>']; return `<span class="mam-kq">${(reverse ? sides.reverse() : sides).join(" ")}</span>`; };
    const mixed = normalizeHebrew(`אָב ${pair(true)} דָ ${pair(false)} הָ׃`), normal = normalizeHebrew(`אָב ${pair(false)} דָ ${pair(false)} הָ׃`);
    expect(mixed).toEqual(normal);
    expect(projectStudyVerse("Genesis 1:1", mixed)).toEqual(projectStudyVerse("Genesis 1:1", normal));
  });
  it.each([
    '<span class="mam-kq-k">בָ</span><span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q">[בָ]</span><span class="mam-kq-q">[גָ]</span>',
    '<span class="mam-kq-q">[בָ]</span>',
    '<span class="mam-kq-q">[]</span><span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q">[בָ]</span><span class="mam-kq-k"></span>',
    '<span class="mam-kq-q">[בָ]</span><span class="mam-kq-k">גָ</span><span>דָ</span>',
    '<span class="mam-kq-q">[בָ]</span>דָ<span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q extra">[בָ]</span><span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q" title="synthetic">[בָ]</span><span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q">[בָ]</span><span class="mam-kq-k"><span class="unknown">גָ</span></span>',
    '<span class="mam-kq-q">[[בָ]]</span><span class="mam-kq-k">גָ</span>',
    '<span class="mam-kq-q">[בָ\u202e]</span><span class="mam-kq-k">גָ</span>',
  ])("rejects malformed or unreviewed semantic side pairs (%#)", sides => {
    expect(() => normalizeHebrew(`אָב <span class="mam-kq">${sides}</span> דָ׃`)).toThrow("Unsupported study markup");
  });
  it.each(["&#xfeff;", "&#x202e;", "&#x2066;", "&#x85;"])("validates decoded inter-side text before whitespace elision (%s)", control => {
    const k = '<span class="mam-kq-k">בָ</span>', q = '<span class="mam-kq-q">[גָ]</span>';
    for (const [first, second] of [[k, q], [q, k]]) {
      for (const content of [`${control}${first}${second}`, `${first}${control}${second}`, `${first}${second}${control}`]) {
        expect(() => normalizeHebrew(`אָב <span class="mam-kq">${content}</span> דָ׃`)).toThrow("Unsupported study markup");
      }
    }
    expect(normalizeHebrew(`אָב <span class="mam-kq">\n${q}\t ${k}\n</span> דָ׃`).readingText).toBe("אָב גָ דָ׃".normalize("NFC"));
  });
  it("preserves the reviewed plain trivial form as identical written/read text and one spoken word", () => {
    const form = "בָ֣\u034f", verse = normalizeHebrew(`אָב <span class="mam-kq-trivial">${form}</span> ג׃`);
    expect(verse.text).toBe(`אָב ${form} ג׃`.normalize("NFC"));
    expect(verse.readingText).toBe(verse.text);
    expect(verse.segments.every(segment => segment.kind === "text")).toBe(true);
    expect(verse.segments.map(segment => segment.kind === "text" ? segment.text : "").join("")).toBe(verse.text);
    const projected = projectStudyVerse("Genesis 1:1", verse);
    expect(projected.status).toBe("ready");
    if (projected.status !== "ready") throw new Error("Synthetic trivial projection unavailable");
    expect(projected.projection.words.map(word => word.text)).toEqual(["אָב", form.normalize("NFC"), "ג"]);
    expect(projected.projection.words.map(word => word.index)).toEqual([0, 1, 2]);
    expect(projected.projection.runs.every(run => run.kind === "text")).toBe(true);
    expect(Object.isFrozen(verse.segments[1])).toBe(true);
  });
  it.each([
    '<span class="mam-kq-trivial"></span>', '<span class="mam-kq-trivial"> </span>',
    '<span class="mam-kq-trivial">[]</span>', '<span class="mam-kq-trivial">[בָ]</span>',
    '<span class="mam-kq-trivial">Synthetic</span>', '<span class="mam-kq-trivial"><b>בָ</b></span>',
    '<span class="mam-kq-trivial"><span>בָ</span></span>',
    '<span class="mam-kq-trivial"><span class="mam-kq-k">בָ</span><span class="mam-kq-q">[גָ]</span></span>',
    '<span class="mam-kq-trivial"><!-- hidden -->בָ</span>',
    '<span class="mam-kq-trivial extra">בָ</span>', '<span class="mam-kq-trivial mam-kq-trivial">בָ</span>',
    '<span class="mam-kq-trivial" title="synthetic">בָ</span>',
    '<span class="mam-kq-trivial" onclick="throw()">בָ</span>', '<span class="mam-kq-trivial">בָ&#x202e;</span>',
    '<span class="mam-kq-trivial">בָ\u0000</span>', '<span class="mam-kq-trivial">בָ\ud800</span>',
    '<span class="mam-kq-trivial">בָ</span',
  ])("rejects unreviewed trivial-wrapper shapes and attributes (%#)", input => {
    expect(() => normalizeHebrew(`אָב ${input} ג׃`)).toThrow("Unsupported study markup");
  });
  it.each([
    '<span class="mam-kq"><span class="mam-kq-k"></span><span class="mam-kq-q">[בָ]</span></span>',
    '<span class="mam-kq"><span class="mam-kq-k">בָ</span><span class="mam-kq-q">[]</span></span>',
    '<span class="mam-kq"><span class="mam-kq-q">[בָ]</span></span>',
  ])("does not broaden exceptional empty/missing ketiv-qere behavior (%#)", input => {
    expect(() => normalizeHebrew(`אָב ${input} ג׃`)).toThrow("Unsupported study markup");
  });
  it("separates internal/terminal paragraph markers and inverted nun from words", () => {
    const verse = normalizeHebrew('<span class="mam-spi-invnun"><b>׆</b></span>אָב<span class="mam-spi-samekh">{ס}</span>ג׃ <small><span class="mam-spi-pe">{פ}</span></small><br>');
    expect(verse.text).toBe("אָב ג׃");
    expect(verse.paragraphAfter).toBe("petuchah");
    expect(verse.segments.filter(segment => segment.kind !== "text").map(segment => segment.kind)).toEqual(["inverted-nun", "gap", "gap"]);
  });
  it("omits footnote subtrees and preserves translation line breaks as plain text", () => {
    const note = '<sup class="footnote-marker">a</sup><i class="footnote"><b>Hidden note</b><a href="javascript:throw()">Hidden link</a></i>';
    expect(normalizeHebrew(`אָב${note} ג׃`).text).toBe("אָב ג׃");
    expect(normalizeEnglish(`Synthetic${note}<br><span class="poetry indentAll"><small>second &amp; third</small></span>`)).toBe("Synthetic\nsecond & third");
    expect(normalizeEnglish(" &nbsp; ")).toBeNull();
    expect(normalizeEnglish("&lt;img&gt;")).toBe("<img>"); // Plain text, never trusted HTML.
  });
  it("retains translation text and ordinary line breaks through the inert double-indent poetry wrapper", () => {
    expect(normalizeEnglish('Synthetic first<br><span class="poetry indentAllDouble"><small>second &amp; third</small><br><span class="indentAll">fourth</span></span>'))
      .toBe("Synthetic first\nsecond & third\nfourth");
    expect(normalizeEnglish('<span class="indentAllDouble">Synthetic only</span>')).toBe("Synthetic only");
  });
  it("treats a raw newline in an English text node as a space, as HTML does; only <br> breaks a line", () => {
    // The shape Sefaria's translation uses around small caps (synthetic words only).
    expect(normalizeEnglish("\nL<small>ORD</small>\n spoke")).toBe("LORD spoke");
    expect(normalizeEnglish("Synthetic \nG<small>OD</small>\n said to a synthetic name")).toBe("Synthetic GOD said to a synthetic name");
    expect(normalizeEnglish("Synthetic one\nsynthetic two\r\nsynthetic three")).toBe("Synthetic one synthetic two synthetic three");
    expect(normalizeEnglish('<span class="poetry indentAll">a</span><br><span class="poetry indentAll">b</span>')).toBe("a\nb");
    expect(normalizeEnglish('<span class="poetry indentAll">a\n</span><br>\n<span class="poetry indentAll">\nb</span>')).toBe("a\nb");
    expect(normalizeEnglish("Synthetic first<br>\nL<small>ORD</small>\n second")).toBe("Synthetic first\nLORD second");
    // Hebrew is unchanged: every newline there was already a space.
    expect(normalizeHebrew("אָב\nג׃").text).toBe("אָב ג׃");
  });
  it.each([
    '<span class="poetry indentAllDouble unknown">Synthetic</span>',
    '<span class="poetry indentAllDoubleExtra">Synthetic</span>',
    '<span class="poetry indentAllDouble" title="synthetic">Synthetic</span>',
    '<span class="poetry indentAllDouble" style="display:none">Synthetic</span>',
    '<span class="poetry indentAllDouble" onclick="throw()">Synthetic</span>',
  ])("does not permit unknown translation classes or attributes alongside double indentation (%#)", input => {
    expect(() => normalizeEnglish(input)).toThrow("Unsupported study markup");
  });
  it.each(['<span class="indentAllDouble">אָב</span>', '<span class="poetry indentAllDouble">אָב</span>'])("keeps double indentation outside the Hebrew markup contract (%#)", input => {
    expect(() => normalizeHebrew(input)).toThrow("Unsupported study markup");
  });
  it.each([
    '<script>throw()</script>אָב', '<img src="https://example.test">אָב', '<svg><text>אָב</text></svg>',
    '<span onclick="throw()">אָב</span>', '<span style="display:none">אָב</span>',
    '<span class="mam-new-semantics">אָב</span>', '<span class="mam-kq-k">אָב</span>',
    '<span class="mam-kq"><span class="mam-kq-q">ג</span><span class="mam-kq-q">ב</span></span>',
    '<span class="mam-spi-pe">אָב</span>', '<span class="mam-spi-invnun">נ</span>',
    'אָב\u202E', 'אָב&#x202e;', 'אָב\u0000', 'אָב\ud800', '<b class="a" class="b">אָב</b>',
    '<!-- hidden -->אָב', `${"<b>".repeat(35)}אָב${"</b>".repeat(35)}`, 'אָ'.repeat(40000),
  ])("rejects hostile, malformed or unknown semantic input without returning it (%#)", input => {
    expect(() => normalizeHebrew(input)).toThrow("Unsupported study markup");
  });
});
