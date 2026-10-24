/**
 * Line breaks for the side-by-side tikkun, made once for both columns so a printed-tikkun row holds the
 * same words on the left and on the right. Pure arithmetic on measured widths; the DOM is read elsewhere.
 */
export type AtomWidths = {
  /** Natural width of the atom in the pointed column and in the tikkun column, in px. */
  pointed: number; tikkun: number;
  /** Continues the previous atom's reading word after a maqaf (the pointed column leaves no space there). */
  joined: boolean;
  /** The reading word the atom belongs to, so a maqaf phrase is placed whole when it fits. */
  word: number | null;
};
export type Columns = { pointed: number; tikkun: number; pointedGap: number; tikkunGap: number };

/** px of slack kept on every row, so sub-pixel font rounding never pushes a word past its column. */
const SLACK = 0.5;

function rowWidth(atoms: readonly AtomWidths[], from: number, to: number, column: "pointed" | "tikkun", gap: number) {
  let width = 0;
  for (let index = from; index < to; index++) {
    width += atoms[index][column];
    if (index > from) width += column === "pointed" && atoms[index].joined ? 0 : gap;
  }
  return width;
}

/** True when atoms [from, to) fit one row of both columns. */
export function fits(atoms: readonly AtomWidths[], from: number, to: number, columns: Columns) {
  return rowWidth(atoms, from, to, "pointed", columns.pointedGap) <= columns.pointed - SLACK && rowWidth(atoms, from, to, "tikkun", columns.tikkunGap) <= columns.tikkun - SLACK;
}

/**
 * The rows, as [from, to) ranges of atom indexes. A reading word (a maqaf phrase) is kept whole on a row;
 * only a phrase wider than a whole row is parted, at its maqaf. An atom too wide for a row on its own gets a
 * row to itself (the caller shrinks the type first, see fitScale).
 */
export function breakRows(atoms: readonly AtomWidths[], columns: Columns): [number, number][] {
  const rows: [number, number][] = [];
  let from = 0;
  while (from < atoms.length) {
    let to = from + 1;
    // Whole reading words at a time: the end of the word the next atom belongs to.
    const wordEnd = (at: number) => { let end = at + 1; while (end < atoms.length && atoms[end].joined) end++; return end; };
    to = wordEnd(from);
    if (!fits(atoms, from, to, columns)) {
      // The phrase alone is wider than a row: part it at its maqaf, as many pieces as fit.
      to = from + 1;
      while (to < wordEnd(from) && fits(atoms, from, to + 1, columns)) to++;
    } else {
      while (to < atoms.length) {
        const next = wordEnd(to);
        if (!fits(atoms, from, next, columns)) break;
        to = next;
      }
      // The next phrase is too wide for any row: let its first pieces start on this row if they fit.
      if (to < atoms.length && !fits(atoms, to, wordEnd(to), columns)) { const end = wordEnd(to); while (to < end && fits(atoms, from, to + 1, columns)) to++; }
    }
    rows.push([from, to]);
    from = to;
  }
  return rows;
}

/**
 * The type scale (at most 1) at which the widest atom fits a row of both columns, with a little room.
 * Widths scale with the font size, so the measured widths are taken at scale `1` (divide by the scale in use).
 */
export function fitScale(atoms: readonly AtomWidths[], columns: Columns, floor = 0.5) {
  let scale = 1;
  for (const atom of atoms) {
    if (atom.pointed > 0) scale = Math.min(scale, (columns.pointed - SLACK) / atom.pointed);
    if (atom.tikkun > 0) scale = Math.min(scale, (columns.tikkun - SLACK) / atom.tikkun);
  }
  return scale >= 1 ? 1 : Math.max(floor, Math.floor(scale * 0.98 * 1000) / 1000);
}

export const sameRows = (a: readonly (readonly [number, number])[] | null, b: readonly (readonly [number, number])[]) =>
  a !== null && a.length === b.length && a.every((row, index) => row[0] === b[index][0] && row[1] === b[index][1]);
