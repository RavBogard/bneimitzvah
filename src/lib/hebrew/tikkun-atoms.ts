import type { DisplayPart, DisplayRun } from "./study-tokens";
import { tikkunPieces, type TikkunPiece } from "./tikkun";

const MAQAF = "־";

/**
 * One alignment atom of the side-by-side tikkun: the smallest stretch of text that sits on one line in
 * BOTH columns. A reading word is one atom. Words the pointed text joins with a maqaf are consecutive
 * atoms marked `joined`: the pointed column sets no word space between them, the scroll column does (the
 * maqaf is not written in a scroll), and the layout keeps such a phrase together on a line, parting it
 * at a maqaf only when the whole phrase is wider than a row.
 * `tikkun` holds the atom's scroll letters (as tikkunPieces gives them); `before` and `after` are the
 * indexes of the verse's paragraph-gap runs that sit beside it (spoken, never drawn in the columns).
 */
export type StudyAtom = {
  kind: "word" | "alternative" | "sign";
  /** Reading words the atom stands for (a ketiv alternative stands for all of its qere words). */
  words: readonly number[];
  /** The atom continues a maqaf phrase: the previous atom's pointed text ends in a maqaf, with no space after it. */
  joined: boolean;
  /** Pointed text: a word's display parts, with any non-space mark after it (the maqaf); empty for an alternative or a sign. */
  parts: readonly DisplayPart[];
  run: Extract<DisplayRun, { kind: "alternative" }> | null;
  tikkun: readonly TikkunPiece[];
  before: readonly number[];
  after: readonly number[];
};

/** The side-by-side tikkun atoms, in reading order, for a projected verse. */
export function studyAtoms(runs: readonly DisplayRun[]): StudyAtom[] {
  const atoms: StudyAtom[] = [];
  let pending: number[] = [];
  // Set when a space (or a paragraph gap, a sign, an alternative) has come since the last word: the next word is then not joined.
  let spaced = true;
  const push = (atom: Omit<StudyAtom, "before" | "after">) => { atoms.push({ ...atom, before: pending, after: [] }); pending = []; };
  const mutate = (patch: (atom: StudyAtom) => StudyAtom) => { atoms[atoms.length - 1] = patch(atoms.at(-1)!); };
  const endsInMaqaf = (atom: StudyAtom | undefined) => Boolean(atom && atom.kind === "word" && atom.parts.at(-1)?.text.trimEnd().endsWith(MAQAF));
  runs.forEach((run, index) => {
    if (run.kind === "gap") { spaced = true; if (atoms.length) mutate(atom => ({ ...atom, after: [...atom.after, index] })); else pending.push(index); return; }
    if (run.kind === "inverted-nun") { spaced = true; push({ kind: "sign", words: [], joined: false, parts: [], run: null, tikkun: tikkunPieces([run]) }); return; }
    if (run.kind === "alternative") {
      spaced = false;
      const read = [...new Set(run.read.flatMap(part => part.wordIndex === null ? [] : [part.wordIndex]))];
      push({ kind: "alternative", words: read, joined: false, parts: [], run, tikkun: tikkunPieces([run]) });
      return;
    }
    // Consecutive parts of one reading word are one atom; anything between words that is not a space rides with the atom before it.
    let word: DisplayPart[] = [];
    const flush = () => {
      if (!word.length) return;
      const previous = atoms.at(-1), joined = !spaced && endsInMaqaf(previous) || !spaced && word[0].text.startsWith(MAQAF) && previous?.kind === "word";
      push({ kind: "word", words: [word[0].wordIndex!], joined: Boolean(joined), parts: word, run: null, tikkun: tikkunPieces([{ kind: "text", segment: run.segment, parts: word }]) });
      word = []; spaced = false;
    };
    for (const part of run.parts) {
      if (part.wordIndex !== null) { if (word.length && word[0].wordIndex !== part.wordIndex) flush(); word.push(part); continue; }
      flush();
      if (/\s/u.test(part.text)) spaced = true;
      if (part.text.trim() && atoms.length) mutate(atom => ({ ...atom, parts: [...atom.parts, { ...part, text: part.text.trimEnd() }] }));
      // A mark with a space after it (a maqaf then a space) leaves the next word unjoined.
    }
    flush();
  });
  return atoms;
}
