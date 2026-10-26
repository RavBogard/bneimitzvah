import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PHRASE_FAMILIES, phraseFill } from "../src/lib/trope/chart-catalog.ts";

// 1.9 N8 (G18): the phrase colours must tell every phrase apart for a reader with protanopia or deuteranopia, by day and by night.
// Agreed floor (decided here, PLAN.md "N8, decided while building"): CIEDE2000 of at least 7 between every pair of the eleven families,
// seen through a colour-vision simulation at full severity, for normal vision too. A pair is judged without knowing which families sit
// next to each other in a verse, so no adjacent pair can fall below it. (Adjacent flat patches are plainly different from about 5.)
const FLOOR = 7;

const hex = value => [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16) / 255);
const linear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gamma = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
const mul = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const clamp = v => v.map(c => Math.min(1, Math.max(0, c)));
// Machado, Oliveira and Fernandes 2009, severity 1.0 (linear sRGB); Vienot, Brettel and Mollon 1999 as a second, independent model.
const MODELS = {
  normal: null,
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  "protanopia (Vienot)": [[0.11238, 0.88762, 0], [0.11238, 0.88762, 0], [0.00401, -0.00401, 1]],
  "deuteranopia (Vienot)": [[0.29275, 0.70725, 0], [0.29275, 0.70725, 0], [-0.02234, 0.02234, 1]],
};
const simulate = (rgb, model) => MODELS[model] === null ? rgb : clamp(mul(MODELS[model], clamp(rgb.map(linear)))).map(gamma);
function lab(rgb) {
  const [r, g, b] = rgb.map(linear);
  const xyz = [0.4124564 * r + 0.3575761 * g + 0.1804375 * b, 0.2126729 * r + 0.7151522 * g + 0.072175 * b, 0.0193339 * r + 0.119192 * g + 0.9503041 * b];
  const f = [xyz[0] / 0.95047, xyz[1], xyz[2] / 1.08883].map(t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (deg(Math.atan2(b1, a1p)) + 360) % 360, h2p = (deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2)), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) { hbp = (h1p + h2p) / 2; if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 180 : -180; }
  const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp)) + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lbp - 50) ** 2 / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const luminance = rgb => { const [r, g, b] = rgb.map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const INK = hex("#13202f"), RING = hex("#154680");

/** Every pair of the colours, through one simulation: [ [a, b, distance], ... ]. */
function pairs(colors, model) {
  const seen = colors.map(({ id, fill }) => ({ id, lab: lab(simulate(hex(fill), model)) })), out = [];
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) out.push([seen[i].id, seen[j].id, ciede2000(seen[i].lab, seen[j].lab)]);
  return out;
}
const sets = { day: PHRASE_FAMILIES.map(row => ({ id: row.id, fill: row.color })), night: PHRASE_FAMILIES.map(row => ({ id: row.id, fill: row.night })) };
const OLD_DAY = ["#fff176", "#9ec5ff", "#f59a9a", "#ffc078", "#9be29b", "#eaa0ea", "#ffd2d2", "#ffb3c6", "#d3c1ff", "#ffd9a3", "#66c2c2"];

test("the simulation and the distance are the ones the review measured: the 1.0 palette had etnachta and pazer 0.8 apart for protanopia", () => {
  const old = pairs(PHRASE_FAMILIES.map((row, index) => ({ id: row.id, fill: OLD_DAY[index] })), "protanopia");
  const [, , distance] = old.find(([a, b]) => a === "etnachta" && b === "pazer");
  assert.ok(Math.abs(distance - 0.8) < 0.1, `etnachta/pazer protan distance ${distance}`);
  assert.ok(Math.min(...old.map(row => row[2])) < FLOOR, "the old palette is under the floor, so this test would have caught it");
  // Known CIEDE2000 pair from Sharma, Wu and Dalal 2005 (data set row 1), to pin the implementation itself.
  assert.ok(Math.abs(ciede2000([50, 2.6772, -79.7751], [50, 0, -82.7485]) - 2.0425) < 1e-3);
});

for (const [name, colors] of Object.entries(sets)) {
  test(`${name}: no pair of the eleven phrase families is under CIEDE2000 ${FLOOR} for normal vision, protanopia or deuteranopia (two models each)`, () => {
    assert.equal(colors.length, 11);
    assert.equal(new Set(colors.map(row => row.fill)).size, 11, "no two families share a fill");
    for (const model of Object.keys(MODELS)) {
      const all = pairs(colors, model);
      assert.equal(all.length, 55);
      const worst = all.reduce((low, row) => row[2] < low[2] ? row : low);
      assert.ok(worst[2] >= FLOOR, `${name}, ${model}: ${worst[0]} and ${worst[1]} are ${worst[2].toFixed(2)} apart`);
    }
  });
  test(`${name}: every fill keeps the dark ink of the words readable`, () => {
    for (const { id, fill } of colors) assert.ok(contrast(hex(fill), INK) >= (name === "day" ? 7 : 5.4), `${id} ${fill} ${contrast(hex(fill), INK).toFixed(2)}`);
  });
}
test("day: the focus ring (lake-deep, 3:1 needed) is readable on every fill", () => {
  for (const { id, fill } of sets.day) assert.ok(contrast(hex(fill), RING) >= 3, id);
});

test("globals.css sets one custom property per family, day inks in :root and night inks in dark mode, equal to the catalog", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const read = block => Object.fromEntries([...block.matchAll(/--phrase-([a-z-]+): (#[0-9a-f]{6});/g)].map(match => [match[1], match[2]]));
  const day = /:root \{\n((?:  --phrase-[a-z-]+: #[0-9a-f]{6};\n)+)\}/.exec(css.replace(/\r\n/g, "\n"))?.[1];
  const night = /@media \(prefers-color-scheme: dark\) \{\n  :root \{\n((?:    --phrase-[a-z-]+: #[0-9a-f]{6};\n)+)  \}\n\}/.exec(css.replace(/\r\n/g, "\n"))?.[1];
  assert.ok(day && night, "both blocks are present");
  assert.deepEqual(read(day), Object.fromEntries(PHRASE_FAMILIES.map(row => [row.id, row.color])));
  assert.deepEqual(read(night), Object.fromEntries(PHRASE_FAMILIES.map(row => [row.id, row.night])));
  for (const row of PHRASE_FAMILIES) assert.equal(phraseFill(row.id), `var(--phrase-${row.id}, ${row.color})`);
});
