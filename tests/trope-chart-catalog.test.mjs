import { test } from "node:test";
import assert from "node:assert/strict";
import lib from "../trope/lib-trope.cjs";
import { ACCENTS } from "../trope/text.mjs";
import { accentLabel, accentSample, BARE_ENDING_SAMPLE, BARE_LEGARMEH_SAMPLE, bareSample, CHART_ACCENTS, ENDING_SAMPLE, HEBREW_FONT_PROOF, LEGARMEH_SAMPLE, PHRASE_FAMILIES } from "../src/lib/trope/chart-catalog.ts";

test("chart preserves all engine phrase-family IDs, labels and order, with the 1.9 N8 colour-blind-safe day and night colors", () => {
  assert.deepEqual(PHRASE_FAMILIES.map(row => [row.id, row.label]), lib.TROPE_FAMILIES);
  // The 1.0 colors (#fff176 ... #66c2c2) put etnachta and pazer 0.8 apart for protanopia; tests/phrase-colors.test.mjs measures the new sets.
  assert.deepEqual(PHRASE_FAMILIES.map(row => row.color), ["#fff692", "#9ac5ff", "#ff89ac", "#fda66d", "#d7ffca", "#b2a3d0", "#4ac0ab", "#f7ccd2", "#d1bfd8", "#debb9b", "#aeffff"]);
  assert.deepEqual(PHRASE_FAMILIES.map(row => row.night), ["#b29337", "#57a8f7", "#c0858c", "#d2b157", "#8dc19b", "#ee97c8", "#1eb29d", "#d9b0ba", "#b385c8", "#d99373", "#17ccf0"]);
});
test("chart inventories all thirty engine codepoints and exact teaching names/roles without alias loss", () => {
  assert.equal(CHART_ACCENTS.length, 30); assert.equal(new Set(CHART_ACCENTS.map(row => row.codepoint)).size, 30);
  assert.deepEqual(CHART_ACCENTS.map(row => [row.codepoint, row.name, row.role]), Object.entries(ACCENTS).map(([mark, row]) => [mark.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"), row[0], row[1]]));
  assert.deepEqual(CHART_ACCENTS.filter(row => row.name === "zarka").map(row => row.codepoint), ["0598", "05AE"]);
  assert.equal(accentLabel(CHART_ACCENTS.find(row => row.codepoint === "0598")), "zarka (helper)");
  assert.equal(CHART_ACCENTS.filter(row => row.family).length, 14); assert.equal(CHART_ACCENTS.filter(row => !row.family).length, 16);
  assert.ok(CHART_ACCENTS.every(row => Boolean(row.family) !== Boolean(row.context)));
});
test("every assigned chart closing accent matches the engine before its final-word override", () => {
  for (const accent of CHART_ACCENTS.filter(row => row.family)) {
    const phrases = lib.tropePhrases(`${accentSample(accent)} ${ENDING_SAMPLE}`);
    assert.equal(phrases[0].family, accent.family, accent.codepoint);
    assert.equal(phrases.at(-1).family, "sof-pasuk");
  }
});
test("context marks inherit following phrase and both ending variants and legarmeh remain contextual", () => {
  for (const accent of CHART_ACCENTS.filter(row => row.context)) assert.equal(lib.tropePhrases(`${accentSample(accent)} בָ֑ ${ENDING_SAMPLE}`)[0].family, "etnachta", accent.codepoint);
  assert.equal(lib.tropePhrases(LEGARMEH_SAMPLE + " " + ENDING_SAMPLE)[0].family, "revia");
  assert.equal(lib.tropePhrases(ENDING_SAMPLE)[0].family, "sof-pasuk");
  assert.equal(lib.tropePhrases(ENDING_SAMPLE, { final: true })[0].family, "sof-haftarah");
  assert.ok(!CHART_ACCENTS.some(row => row.family === "sof-pasuk" || row.family === "sof-haftarah"));
});
test("samples preserve NFC combining marks on an invented carrier, not verse or music payloads", () => {
  for (const accent of CHART_ACCENTS) {
    const sample = accentSample(accent); assert.equal(sample, sample.normalize("NFC"));
    assert.equal(sample, "בָ" + String.fromCodePoint(Number.parseInt(accent.codepoint, 16))); assert.ok(HEBREW_FONT_PROOF.includes(sample));
  }
  assert.ok(HEBREW_FONT_PROOF.includes(ENDING_SAMPLE) && HEBREW_FONT_PROOF.includes(LEGARMEH_SAMPLE));
});

test("1.9 N8: the chart samples sit on a bare carrier, a letter and the sign alone, so no vowel can hide the sign", () => {
  for (const accent of CHART_ACCENTS) {
    const sample = bareSample(accent);
    assert.equal(sample, sample.normalize("NFC"));
    assert.equal(sample, "ב" + String.fromCodePoint(Number.parseInt(accent.codepoint, 16)));
    assert.equal([...sample].length, 2, "the carrier and the sign, nothing else");
    assert.ok(![...sample].some(char => { const code = char.codePointAt(0); return code >= 0x05b0 && code <= 0x05bb || code === 0x05c7; }), "no vowel point");
    assert.ok(HEBREW_FONT_PROOF.includes(sample));
  }
  // The same signs still classify as they did on the vowelled sample: the engine reads accents, not vowels.
  for (const accent of CHART_ACCENTS.filter(row => row.family)) assert.equal(lib.tropePhrases(`${bareSample(accent)} ${BARE_ENDING_SAMPLE}`)[0].family, accent.family, accent.codepoint);
  assert.equal(lib.tropePhrases(BARE_LEGARMEH_SAMPLE + " " + BARE_ENDING_SAMPLE)[0].family, "revia");
  assert.equal(lib.tropePhrases(BARE_ENDING_SAMPLE)[0].family, "sof-pasuk");
  assert.equal(lib.tropePhrases(BARE_ENDING_SAMPLE, { final: true })[0].family, "sof-haftarah");
  assert.ok(HEBREW_FONT_PROOF.includes(BARE_ENDING_SAMPLE) && HEBREW_FONT_PROOF.includes(BARE_LEGARMEH_SAMPLE));
});
