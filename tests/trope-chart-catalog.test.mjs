import { test } from "node:test";
import assert from "node:assert/strict";
import lib from "../trope/lib-trope.cjs";
import { ACCENTS } from "../trope/text.mjs";
import { accentLabel, accentSample, CHART_ACCENTS, ENDING_SAMPLE, HEBREW_FONT_PROOF, LEGARMEH_SAMPLE, PHRASE_FAMILIES } from "../src/lib/trope/chart-catalog.ts";

test("chart preserves all engine phrase-family IDs, labels, order and source colors", () => {
  assert.deepEqual(PHRASE_FAMILIES.map(row => [row.id, row.label]), lib.TROPE_FAMILIES);
  assert.deepEqual(PHRASE_FAMILIES.map(row => row.color), ["#fff176", "#9ec5ff", "#f59a9a", "#ffc078", "#9be29b", "#eaa0ea", "#ffd2d2", "#ffb3c6", "#d3c1ff", "#ffd9a3", "#66c2c2"]);
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
