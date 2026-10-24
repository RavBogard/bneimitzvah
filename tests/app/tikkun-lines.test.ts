import { describe, expect, it } from "vitest";
import { projectStudyVerse, type HebrewSource } from "../../src/lib/hebrew/study-tokens";
import { tikkunPieces, tikkunText } from "../../src/lib/hebrew/tikkun";
import { studyAtoms } from "../../src/lib/hebrew/tikkun-atoms";
import { breakRows, fitScale, fits, type AtomWidths, type Columns } from "../../src/lib/hebrew/tikkun-lines";

// Invented syllables only. The side-by-side tikkun breaks a verse into lines once and sets both columns
// from them, so the atoms must carry exactly the letters of the scroll text, in order, and the line
// breaker must never leave a row that does not fit either column.
const P = (...codes: number[]) => String.fromCodePoint(...codes);
const MAQAF = P(0x05be), SOF = P(0x05c3);
const word = (...letters: number[]) => P(...letters.flatMap(code => [code, 0x05b8]));
const source = (segments: HebrewSource["segments"]): HebrewSource => {
  const text = segments.map(s => s.kind === "text" ? s.text : s.kind === "alternative" ? s.written : s.kind === "gap" ? " " : "").join("").normalize("NFC").replace(/\s+/g, " ").trim();
  const readingText = segments.map(s => s.kind === "text" ? s.text : s.kind === "alternative" ? s.read : s.kind === "gap" ? " " : "").join("").normalize("NFC").replace(/\s+/g, " ").trim();
  const last = [...segments].reverse().find(s => s.kind !== "inverted-nun" && (s.kind !== "text" || s.text.trim()));
  return { text, readingText, segments, paragraphAfter: last?.kind === "gap" ? last.break : null };
};
const A = [0x05d0, 0x05d1, 0x05d2], B = [0x05d3, 0x05d4], C = [0x05d5, 0x05d6, 0x05d7, 0x05d8];
const plain = `${word(...A)} ${word(...B)}${MAQAF}${word(...C)}${MAQAF}${word(...A)} ${word(...C)}${SOF}`;
const project = (segments: HebrewSource["segments"]) => { const result = projectStudyVerse("Test 1:1", source(segments)); if (result.status !== "ready") throw new Error("projection"); return result.projection; };

describe("studyAtoms", () => {
  it("marks the words a maqaf joins and keeps every letter", () => {
    const projection = project([{ kind: "text", text: plain }]), atoms = studyAtoms(projection.runs);
    expect(atoms.map(atom => atom.words)).toEqual([[0], [1], [2], [3], [4]]);
    expect(atoms.map(atom => atom.joined)).toEqual([false, false, true, true, false]);
    // The maqaf stays with the word before it in the pointed column, and the scroll column has none.
    expect(atoms[1].parts.map(part => part.text).join("").endsWith(MAQAF)).toBe(true);
    expect(atoms.flatMap(atom => atom.tikkun).some(piece => piece.text.includes(MAQAF))).toBe(false);
    const letters = atoms.flatMap(atom => atom.tikkun.filter(piece => piece.text !== " ").map(piece => piece.text)).join("");
    expect(letters).toBe(tikkunText(plain).replace(/ /g, ""));
    expect(tikkunPieces(projection.runs).filter(piece => piece.text !== " ").map(piece => piece.text).join("")).toBe(letters);
    // Every scroll word of an atom belongs to that atom's reading word.
    for (const atom of atoms) for (const piece of atom.tikkun) expect(atom.words).toContain(piece.wordIndex);
  });

  it("makes a ketiv and its qere one atom, an inverted nun its own, and rides gaps on a neighbour", () => {
    const projection = project([{ kind: "inverted-nun" }, { kind: "text", text: `${word(...A)} ` }, { kind: "alternative", written: word(...B), read: word(...C) }, { kind: "text", text: ` ${word(...A)}` }, { kind: "gap", break: "petuchah" }, { kind: "text", text: word(...B) }]);
    const atoms = studyAtoms(projection.runs);
    expect(atoms.map(atom => atom.kind)).toEqual(["sign", "word", "alternative", "word", "word"]);
    expect(atoms[2].words).toEqual([1]);
    expect(atoms[2].tikkun.map(piece => piece.text).join("")).toBe(tikkunText(word(...B)));
    // The gap between the two last words belongs to the word before it.
    expect(atoms[3].after).toHaveLength(1);
    expect(projection.runs[atoms[3].after[0]].kind).toBe("gap");
    expect(atoms.flatMap(atom => atom.tikkun).filter(piece => piece.text !== " ").map(piece => piece.text).join("")).toBe(tikkunPieces(projection.runs).filter(piece => piece.text !== " ").map(piece => piece.text).join(""));
  });
});

const atom = (pointed: number, tikkun: number, word: number, joined = false): AtomWidths => ({ pointed, tikkun, word, joined });
const columns: Columns = { pointed: 100, tikkun: 90, pointedGap: 5, tikkunGap: 5 };
const rowsAreFit = (atoms: AtomWidths[], rows: [number, number][], cols: Columns) => rows.every(([from, to]) => to - from === 1 || fits(atoms, from, to, cols));

describe("breakRows", () => {
  it("breaks both columns at the same atoms, by the narrower column", () => {
    const atoms = [atom(30, 20, 0), atom(30, 40, 1), atom(30, 20, 2), atom(30, 20, 3), atom(40, 20, 4)];
    const rows = breakRows(atoms, columns);
    // Atoms 0 and 1 fit the pointed column (65) but not with a third in the tikkun column (20+5+40+5+20 = 90 is over the slack).
    expect(rows).toEqual([[0, 2], [2, 4], [4, 5]]);
    expect(rowsAreFit(atoms, rows, columns)).toBe(true);
  });

  it("keeps a maqaf phrase whole on one row, taking no space between pieces in the pointed column", () => {
    const atoms = [atom(40, 20, 0), atom(30, 20, 1), atom(30, 20, 1, true), atom(20, 20, 2)];
    expect(breakRows(atoms, columns)).toEqual([[0, 1], [1, 4]]);
    // 30 + 30 (no gap) + 5 + 20 = 85 fits 100; the tikkun side 20 + 5 + 20 + 5 + 20 = 70 fits 90.
  });

  it("parts a phrase wider than a whole row at its maqaf, and never splits any other word", () => {
    const atoms = [atom(40, 40, 0), atom(40, 40, 1), atom(40, 40, 1, true), atom(40, 40, 1, true)];
    const rows = breakRows(atoms, columns);
    expect(rows.flatMap(([from, to]) => Array.from({ length: to - from }, (_, index) => from + index))).toEqual([0, 1, 2, 3]);
    expect(rowsAreFit(atoms, rows, columns)).toBe(true);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("covers every atom exactly once, in order, whatever the widths", () => {
    let seed = 7;
    const next = (limit: number) => (seed = (seed * 48271) % 2147483647) % limit;
    for (let trial = 0; trial < 50; trial++) {
      const atoms: AtomWidths[] = []; let word = 0;
      for (let index = 0; index < 30; index++) { const joined = index > 0 && next(4) === 0; if (!joined) word++; atoms.push(atom(10 + next(60), 10 + next(60), word, joined)); }
      const rows = breakRows(atoms, columns);
      expect(rows[0][0]).toBe(0); expect(rows.at(-1)![1]).toBe(atoms.length);
      rows.forEach(([from, to], index) => { expect(to).toBeGreaterThan(from); if (index) expect(from).toBe(rows[index - 1][1]); });
      expect(rowsAreFit(atoms, rows, columns)).toBe(true);
    }
  });
});

describe("fitScale", () => {
  it("leaves type alone when the widest atom fits, and shrinks it just enough when not", () => {
    expect(fitScale([atom(80, 70, 0)], columns)).toBe(1);
    const scale = fitScale([atom(150, 70, 0), atom(20, 20, 1)], columns);
    expect(scale).toBeLessThan(1);
    expect(150 * scale).toBeLessThan(columns.pointed);
    expect(fitScale([atom(1000, 10, 0)], columns)).toBe(0.5);
  });
});
