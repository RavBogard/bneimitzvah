import { describe, expect, it, vi } from "vitest";
import { normalizeEnglish, normalizeHebrew } from "../../src/server/study/normalize";
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
  it.each([
    '<script>throw()</script>אָב', '<img src="https://example.test">אָב', '<svg><text>אָב</text></svg>',
    '<span onclick="throw()">אָב</span>', '<span style="display:none">אָב</span>',
    '<span class="mam-new-semantics">אָב</span>', '<span class="mam-kq-k">אָב</span>',
    '<span class="mam-kq"><span class="mam-kq-q">ג</span><span class="mam-kq-k">ב</span></span>',
    '<span class="mam-spi-pe">אָב</span>', '<span class="mam-spi-invnun">נ</span>',
    'אָב\u202E', 'אָב&#x202e;', 'אָב\u0000', 'אָב\ud800', '<b class="a" class="b">אָב</b>',
    '<!-- hidden -->אָב', `${"<b>".repeat(35)}אָב${"</b>".repeat(35)}`, 'אָ'.repeat(40000),
  ])("rejects hostile, malformed or unknown semantic input without returning it (%#)", input => {
    expect(() => normalizeHebrew(input)).toThrow("Unsupported study markup");
  });
});
