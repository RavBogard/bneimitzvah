import { describe, expect, it, vi } from "vitest";
import { isHebrewLetter, tikkunText } from "../../src/lib/hebrew/tikkun";
import { normalizeHebrew } from "../../src/server/study/normalize";
vi.mock("server-only", () => ({}));

// Every test string is built from code points; no combining mark appears raw in source.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const [alef, bet, gimel, dalet, he, vav, shin, finalMem, tav] = [0x05d0, 0x05d1, 0x05d2, 0x05d3, 0x05d4, 0x05d5, 0x05e9, 0x05dd, 0x05ea].map(point => cp(point));
const qamats = cp(0x05b8), patah = cp(0x05b7), dagesh = cp(0x05bc), shinDot = cp(0x05c1), meteg = cp(0x05bd);
const etnahta = cp(0x0591), tipcha = cp(0x0596), merkha = cp(0x05a5), zaqef = cp(0x0594);
const maqaf = cp(0x05be), paseq = cp(0x05c0), sofPasuq = cp(0x05c3), qamatsQatan = cp(0x05c7), invertedNun = cp(0x05c6);
const marks = (value: string) => [...value].filter(char => { const point = char.codePointAt(0)!; return point >= 0x0591 && point <= 0x05c7; });

describe("tikkunText", () => {
  it("keeps only the letters of a pointed, cantillated verse and its word spaces", () => {
    const verse = `${bet}${qamats}${etnahta}${alef} ${gimel}${dagesh}${patah}${meteg}${dalet}${sofPasuq}`;
    expect(tikkunText(verse)).toBe(`${bet}${alef} ${gimel}${dalet}`);
    expect(marks(tikkunText(verse))).toEqual([]);
  });
  it("writes maqaf-joined words as separate words and drops paseq and sof pasuq", () => {
    expect(tikkunText(`${alef}${qamats}${maqaf}${bet}${tipcha} ${paseq} ${gimel}${merkha}${sofPasuq}`)).toBe(`${alef} ${bet} ${gimel}`);
    expect(tikkunText(`${he}${paseq}${vav}`)).toBe(`${he}${vav}`);
  });
  it("removes every code point in U+0591–U+05C7, including shin dots, qamats qatan and the inverted nun", () => {
    const all = Array.from({ length: 0x05c7 - 0x0591 + 1 }, (_, index) => cp(0x0591 + index));
    expect(tikkunText(`${shin}${all.filter(char => char !== maqaf).join("")}${finalMem}`)).toBe(`${shin}${finalMem}`);
    expect(marks(tikkunText(`${shin}${all.join("")}${finalMem}`))).toEqual([]);
    expect(tikkunText(`${shin}${shinDot}${qamatsQatan}${invertedNun}${tav}${zaqef}`)).toBe(`${shin}${tav}`);
  });
  it("keeps final forms, collapses spacing and trims", () => {
    expect(tikkunText(`  ${finalMem}\u00a0\t\n${alef}  `)).toBe(`${finalMem} ${alef}`);
    expect(tikkunText(`${sofPasuq} ${paseq} `)).toBe("");
    expect([0x05cf, 0x05d0, 0x05da, 0x05ea, 0x05eb].map(isHebrewLetter)).toEqual([false, true, true, true, false]);
  });
  it("decomposes presentation forms into their letters", () => {
    // U+FB2A is shin with shin dot; U+FB35 is vav with dagesh.
    expect(tikkunText(cp(0xfb2a, 0xfb35))).toBe(`${shin}${vav}`);
  });
  it("drops non-Hebrew characters, which a scroll never contains", () => {
    expect(tikkunText(`${alef} [${bet}] {${gimel}} 12 ${dalet}.`)).toBe(`${alef} ${bet} ${gimel} ${dalet}`);
  });
  it("uses the written form of normalized study text, never the read alternative", () => {
    const source = normalizeHebrew(`${alef}${qamats}${etnahta}${bet} <span class="mam-kq"><span class="mam-kq-k">${dalet}${qamats}</span><span class="mam-kq-q">[${gimel}${dagesh}${patah}]</span></span>${sofPasuq}`);
    expect(tikkunText(source.text)).toBe(`${alef}${bet} ${dalet}`);
  });
});
