import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hebrewRuns, maqafChains } from "../../src/lib/hebrew/mixed-runs";
import { PrintDocument, type SheetText } from "../../src/components/portal/print/document";
import { DEFAULT_FORMAT } from "../../src/lib/print/sheet-format";
import { studyEditions } from "../../src/components/portal/workspace/study/credits";
import type { AppendixGroup } from "../../src/lib/print/appendix";

// 1.8.2 P1: the two splits shared by the screen and the print sheet, and the print markup built from them.
// Invented Hebrew only, built from code points: never a verse or a commentary's words.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const word = (...letters: number[]) => cp(...letters, 0x05b8);
const AB = word(0x05d0, 0x05d1), GD = word(0x05d2, 0x05d3), HZ = word(0x05d4, 0x05d6), MAQAF = cp(0x05be);

test("a maqaf chain is a space-free stretch holding a maqaf, and the runs give the text back", () => {
  const text = `${AB}${MAQAF}${GD} ${HZ} ${AB}${MAQAF}${GD}${MAQAF}${HZ}`;
  const runs = maqafChains(text);
  expect(runs.map(run => run.text).join("")).toBe(text);
  expect(runs.filter(run => run.chain).map(run => run.text)).toEqual([`${AB}${MAQAF}${GD}`, `${AB}${MAQAF}${GD}${MAQAF}${HZ}`]);
  expect(maqafChains(`${AB} ${GD}`).every(run => !run.chain)).toBe(true);
  expect(maqafChains("")).toEqual([]);
});

test("Hebrew inside English is found as runs, a phrase staying whole and English words never taken in", () => {
  const text = `literally, ${AB} WAS SITTING — a ${GD} ${HZ} and ${AB}"${GD} too`;
  const runs = hebrewRuns(text);
  expect(runs.map(run => run.text).join("")).toBe(text);
  expect(runs.filter(run => run.hebrew).map(run => run.text)).toEqual([AB, `${GD} ${HZ}`, `${AB}"${GD}`]);
  expect(hebrewRuns("plain English")).toEqual([{ text: "plain English", hebrew: false }]);
  expect(hebrewRuns(AB)).toEqual([{ text: AB, hebrew: true }]);
});

const verse = (text: string) => ({ ref: "Genesis 24:30", english: "Synthetic English.", hebrew: { text, readingText: text, paragraphAfter: null, segments: [{ kind: "text" as const, text }] } });
const sheet: SheetText = { verses: [verse(`${AB}${MAQAF}${GD} ${HZ}`)], chapters: [{ ref: "Genesis 24", sefariaUrl: "https://www.sefaria.org/Genesis.24", fetchedAt: 0, hash: "a".repeat(64), editions: [studyEditions.mam, studyEditions.jps2023] }] };
const appendix: AppendixGroup[] = [{ ref: "Genesis 24:30", works: [{ work: "rashi", label: "Rashi", credits: ["Synthetic credit"], comments: [
  { hebrew: [{ text: `${AB}.`, bold: true }, { text: ` ${GD}${MAQAF}${HZ}` }], english: [{ text: `literally, ${AB} WAS SITTING — one` }] },
  { hebrew: [{ text: `${GD}.`, bold: true }], english: [{ text: "two" }] },
  { hebrew: [{ text: `${HZ}.`, bold: true }], english: [{ text: "three" }] },
] }] }];
const render = () => renderToStaticMarkup(createElement(PrintDocument, { heading: { title: "Synthetic", passage: "Torah Genesis 24:30", date: null }, text: sheet, markers: new Map(), format: DEFAULT_FORMAT, productName: "Test Torah", appendix }));

test("the print sheet sets each maqaf chain in one no-break span and quoted Hebrew inside English in its own language", () => {
  const html = render();
  const chains = [...html.matchAll(/<span class="[^"]*chain[^"]*">([^<]*)<\/span>/g)].map(match => match[1]);
  expect(chains).toContain(`${AB}${MAQAF}${GD}`);
  expect(chains).toContain(`${GD}${MAQAF}${HZ}`); // Rashi's Hebrew in the appendix too
  // No maqaf outside a chain: strip the chains, and none is left in the Hebrew cell or the appendix's Hebrew.
  expect(html.replace(/<span class="[^"]*chain[^"]*">[^<]*<\/span>/g, "")).not.toContain(MAQAF);
  // Quoted Hebrew in the English paragraph is a Hebrew-language run; the three comments all print.
  expect(html).toMatch(new RegExp(`literally, <span lang="he" dir="rtl" class="[^"]*inlineHebrew[^"]*">${AB}</span> WAS SITTING`));
  expect([...html.matchAll(/<strong>([^<]*)<\/strong>/g)].map(match => match[1])).toEqual([`${AB}.`, `${GD}.`, `${HZ}.`]);
});
