import { expect, test } from "vitest";
import { dibburWords, hebrewLetters, matchDibbur } from "../../src/lib/hebrew/dibbur";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";

// Invented syllables only: never a verse or a commentary's words. Pointing and
// cantillation are attached to show they are ignored, not to quote anything.
// Word 2 is two letter-words joined by a maqaf, as the reading's projection gives it: one verse word.
const verse = ["אָבָ֑ג", "דֵּ֖ה", "וְזַ֥ח־טִֽים", "כָּ֔ךְ", "לֻ֣ם", "נָ֣ן"];

test("letters only: points, cantillation, meteg and punctuation go; the maqaf, paseq and sof pasuq break words", () => {
  expect(hebrewLetters("אָבָ֑ג")).toBe("אבג");
  expect(hebrewLetters("וְזַ֥ח־טִֽים")).toBe("וזח טימ");
  expect(hebrewLetters("כָּ֔ךְ ׀ לֻ֣ם׃")).toBe("ככ למ");
  expect(hebrewLetters("נָ֣ן.")).toBe("ננ");
  expect(hebrewLetters("‏אב͏ג‎")).toBe("אבג");
  expect(hebrewLetters("Latin 12 אב")).toBe("אב");
});

test("final letters compare equal to their ordinary forms", () => {
  for (const [final, plain] of [["ך", "כ"], ["ם", "מ"], ["ן", "נ"], ["ף", "פ"], ["ץ", "צ"]]) expect(hebrewLetters(`א${final}`)).toBe(`א${plain}`);
  expect(matchDibbur("ככ", verse)).toEqual({ first: 3, last: 3 });
  expect(matchDibbur("כך", verse)).toEqual({ first: 3, last: 3 });
});

test("a quoted phrase links to the one place its consecutive words occur, unpointed or pointed", () => {
  expect(matchDibbur("אבג", verse)).toEqual({ first: 0, last: 0 });
  expect(matchDibbur("לם נן:", verse)).toEqual({ first: 4, last: 5 });
  expect(matchDibbur("דֵּה וְזַח טִים.", verse)).toEqual({ first: 1, last: 2 });
  expect(matchDibbur("אבג דה וזח טים ככ לם נן", verse)).toEqual({ first: 0, last: 5 });
});

test("a word joined by a maqaf is matched whole, written with or without the maqaf, and never by half", () => {
  expect(matchDibbur("וזח טים", verse)).toEqual({ first: 2, last: 2 });
  expect(matchDibbur("וזח־טים", verse)).toEqual({ first: 2, last: 2 });
  expect(matchDibbur("דה וזח טים ככ", verse)).toEqual({ first: 1, last: 3 });
  expect(matchDibbur("וזח", verse)).toBeNull(); // the first half of a joined word
  expect(matchDibbur("טים", verse)).toBeNull(); // the second half
  expect(matchDibbur("דה וזח", verse)).toBeNull(); // ends inside a word
  expect(matchDibbur("טים ככ", verse)).toBeNull(); // starts inside a word
  // A synthetic verse projected exactly as the reading projects it: the projection gives each side of a
  // maqaf as its own word, so quotations match across it either way.
  const text = "אָבָ֑ג דֵּ֖ה־וְזַ֥ח טִֽים׃", projected = projectStudyVerse("Genesis 1:1", { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text", text }] });
  expect(projected.status).toBe("ready");
  const words = projected.status === "ready" ? projected.projection.words.map(word => word.text) : [];
  expect(words).toHaveLength(4);
  expect(matchDibbur("דה וזח", words)).toEqual({ first: 1, last: 2 });
  expect(matchDibbur("דה־וזח", words)).toEqual({ first: 1, last: 2 });
  expect(matchDibbur("אבג דה וזח טים", words)).toEqual({ first: 0, last: 3 });
  expect(matchDibbur("טים", words)).toEqual({ first: 3, last: 3 });
});

test("Rashi's etc. ends the quotation: the words before it are what is matched", () => {
  expect(matchDibbur("אבג דה וגו׳", verse)).toEqual({ first: 0, last: 1 });
  expect(matchDibbur("אבג דה וגו'", verse)).toEqual({ first: 0, last: 1 });
  expect(matchDibbur("דה וגומר", verse)).toEqual({ first: 1, last: 1 });
  expect(matchDibbur("דה וכו'.", verse)).toEqual({ first: 1, last: 1 });
  expect(dibburWords("וגו׳")).toBeNull();
});

test("the divine-name abbreviation reads as the four letters; any other abbreviation is no link", () => {
  const named = ["אָמַ֣ר", "יְהוָ֔ה", "דֵּ֖ה"];
  expect(matchDibbur("אמר ה׳", named)).toEqual({ first: 0, last: 1 });
  expect(matchDibbur("אמר ה'", named)).toEqual({ first: 0, last: 1 });
  expect(dibburWords("ה'-אמר")).toEqual(["יהוה", "אמר"]);
  expect(matchDibbur("אמר בה׳", named)).toBeNull();
  expect(matchDibbur("אב״ג", verse)).toBeNull();
  expect(matchDibbur("דה ככ׳", verse)).toBeNull();
  // An abbreviation joined to a plain word by punctuation is still an abbreviation: no link.
  expect(dibburWords('א"ב.ככ')).toBeNull();
  expect(matchDibbur('א"ב.ככ', ["אָב", "כָּ֔ךְ"])).toBeNull();
});

test("an editor's bracketed or parenthesized insertion is not part of the verse's words", () => {
  expect(matchDibbur("אבג [מלה] דה", verse)).toEqual({ first: 0, last: 1 });
  expect(matchDibbur("אבג (מלה) דה", verse)).toEqual({ first: 0, last: 1 });
});

test("never guess: no match, two matches, a partial word or an empty quotation is no link", () => {
  expect(matchDibbur("קרש", verse)).toBeNull();
  expect(matchDibbur("אב", verse)).toBeNull(); // a prefix of a word is not the word
  expect(matchDibbur("אבגד", verse)).toBeNull();
  expect(matchDibbur("דה אבג", verse)).toBeNull(); // out of order
  expect(matchDibbur("אבג ככ", verse)).toBeNull(); // not consecutive
  expect(matchDibbur("דה", ["דֵּ֖ה", "אָבָ֑ג", "דָּ֥ה"])).toBeNull(); // twice in the verse
  expect(matchDibbur("דה", ["דֵּ֖ה־אָבָ֑ג", "דָּ֥ה"])).toEqual({ first: 1, last: 1 }); // once as a whole word
  expect(matchDibbur("", verse)).toBeNull();
  expect(matchDibbur(null, verse)).toBeNull();
  expect(matchDibbur(undefined, verse)).toBeNull();
  expect(matchDibbur(".", verse)).toBeNull();
  expect(matchDibbur("Latin only", verse)).toBeNull();
  expect(matchDibbur("אבג", [])).toBeNull();
  expect(matchDibbur("אבג דה וזח טים ככ לם נן אבג", verse)).toBeNull(); // longer than the verse
});

test("signs that are not words in the verse are skipped, never counted as words", () => {
  expect(matchDibbur("דה", ["אָבָ֑ג", "׃", "דֵּ֖ה"])).toEqual({ first: 2, last: 2 });
  expect(matchDibbur("אבג דה", ["אָבָ֑ג", "׀", "דֵּ֖ה"])).toEqual({ first: 0, last: 2 });
});
