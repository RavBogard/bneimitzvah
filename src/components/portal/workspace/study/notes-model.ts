import { matchDibbur } from "../../../../lib/hebrew/dibbur";
import type { VerseDiscussion } from "../../../../lib/discussions/answer";
import type { CommentaryComment } from "../../../../lib/readings/commentary";
import { commentaryParts, type CommentaryParts } from "./commentary-text";
import { workLabel } from "../reading-toolbar";
import type { WorkState } from "./commentary-view";
import type { GuideLabel, GuideNote } from "./guide-api";

/**
 * What a verse has in Study's notes column (Study v6, Daniel 2026-10-28). Three kinds, each with its own colour: a classical commentary (rust),
 * a modern one (forest) and the rabbi's (plum: his curated sources for the verse, and a rabbi-written note for this student). Nothing else:
 * the Claude-written base guide's verse notes and themes never reach this model. Pure, so the rules are tested without a browser.
 */
export type NoteKind = "classic" | "modern" | "rabbi";
export const NOTE_KINDS: readonly NoteKind[] = Object.freeze(["classic", "modern", "rabbi"]);
/** Sefaria files the Women's Commentary under "Modern Commentary"; the registry of inline works has no category of its own, so that one fact is kept here. Every other work is a classical commentary. */
const SEFARIA_CATEGORY: Readonly<Record<string, string>> = Object.freeze({ womens: "Modern Commentary" });
export const workKind = (work: string): "classic" | "modern" => SEFARIA_CATEGORY[work] === "Modern Commentary" ? "modern" : "classic";
export const KIND_LABEL: Readonly<Record<NoteKind, string>> = Object.freeze({ classic: "Commentary", modern: "Modern commentary", rabbi: "" });

type Base = { id: string; kind: NoteKind; source: string; letter?: string };
export type CommentNote = Base & { type: "comment"; work: string; index: number; comment: CommentaryComment; parts: CommentaryParts };
export type DiscussionNote = Base & { type: "discussion"; row: VerseDiscussion };
export type GuideAddition = Readonly<{ theme: string; note: GuideNote; label: GuideLabel }>;
export type GuideNoteEntry = Base & { type: "guide"; theme: string; note: GuideNote; label: GuideLabel };
export type VerseNote = CommentNote | DiscussionNote | GuideNoteEntry;

export type VerseEntries = Readonly<{
  ref: string; notes: readonly VerseNote[];
  /** Each kind the verse has, in the order its notes come: the dots under the verse number and on the folded line. */
  kinds: readonly NoteKind[];
  /** The distinct names, in order: "Rashi", "From Rabbi Daniel". */
  names: readonly string[];
  /** Word index (of the verse's words) to the lemma letters set on it: the best-effort link from a commentary's opening words to the verse. */
  marks: ReadonlyMap<number, string>;
}>;

/** "From Rabbi Daniel": the setting's own name, never a literal one. */
export const fromRabbi = (rabbiName: string | null | undefined) => `From ${rabbiName && rabbiName.trim() ? rabbiName.trim() : "the rabbi"}`;

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * The verse's entries, in order: each chosen work's comments, then the rabbi's curated sources, then his notes for this student.
 * `words` are the verse's words as the Hebrew shows them (empty when it can't be split): a commentary whose quoted opening words are found
 * once in the verse, by letters alone (the existing dibbur rules), gets a letter in order of where it falls, on the word and on the note.
 * A comment that is not found, or is found more than once, simply has no letter. Never a guess.
 */
export function verseEntries(input: { ref: string; works: readonly WorkState[]; discussions: readonly VerseDiscussion[]; additions: readonly GuideAddition[];
  rabbiName?: string | null; words: readonly string[] }): VerseEntries {
  const notes: VerseNote[] = [];
  for (const { work, state } of input.works) {
    if (state.status !== "ready") continue;
    state.comments.forEach((comment, index) => notes.push({ id: `${work}:${index}`, type: "comment", kind: workKind(work), source: workLabel(work), work, index, comment, parts: commentaryParts(comment) }));
  }
  const rabbi = fromRabbi(input.rabbiName);
  input.discussions.forEach(row => notes.push({ id: `discussion:${row.discussion.slug}`, type: "discussion", kind: "rabbi", source: rabbi, row }));
  input.additions.forEach((add, index) => notes.push({ id: `guide:${index}`, type: "guide", kind: "rabbi", source: rabbi, theme: add.theme, note: add.note, label: add.label }));

  const found = notes.flatMap(note => {
    if (note.type !== "comment" || !note.parts.dibbur || !input.words.length) return [];
    const match = matchDibbur(note.parts.dibbur, input.words);
    return match ? [{ note, match }] : [];
  }).sort((a, b) => a.match.first - b.match.first || a.match.last - b.match.last);
  const marks = new Map<number, string>(), lettered = new Map<string, string>();
  found.slice(0, LETTERS.length).forEach(({ note, match }, at) => {
    const letter = LETTERS[at]; lettered.set(note.id, letter);
    marks.set(match.last, marks.has(match.last) ? `${marks.get(match.last)},${letter}` : letter);
  });
  const withLetters = notes.map(note => lettered.has(note.id) ? { ...note, letter: lettered.get(note.id) } as VerseNote : note);
  return Object.freeze({ ref: input.ref, notes: Object.freeze(withLetters), marks,
    kinds: Object.freeze([...new Set(withLetters.map(note => note.kind))]), names: Object.freeze([...new Set(withLetters.map(note => note.source))]) });
}

/** The rabbi-written per-student notes for one verse. Only `additions` (never the base guide) ever reach here. */
export function additionsFor(view: Readonly<{ additions: Readonly<{ label: GuideLabel; themes: readonly Readonly<{ title: string; notes: readonly GuideNote[] }>[] }> | null }> | null, ref: string): GuideAddition[] {
  const part = view?.additions;
  return part ? part.themes.flatMap(theme => theme.notes.filter(note => note.verseRef === ref).map(note => ({ theme: theme.title, note, label: part.label }))) : [];
}

const place = (ref: string) => { const match = /(\d+):(\d+)$/.exec(ref); return match ? [Number(match[1]), Number(match[2])] as const : null; };
/** "4:1–4", "4:30–5:2", "4:7": where a rabbi-written theme sits, for the line under its title. */
export function verseSpan(first: string, last: string): string {
  const a = place(first), b = place(last);
  if (!a || !b) return first === last ? first : `${first}–${last}`;
  if (a[0] === b[0] && a[1] === b[1]) return `${a[0]}:${a[1]}`;
  return a[0] === b[0] ? `${a[0]}:${a[1]}–${b[1]}` : `${a[0]}:${a[1]}–${b[0]}:${b[1]}`;
}
export type ThemeHeading = Readonly<{ id: string; title: string; intro: string; span: string; first: string }>;
/**
 * The headings of a rabbi-written guide for this student, one where each theme starts: its title, its one line and the verses it covers. A theme with no
 * note on a verse of this reading has none. `order` is the whole reading's verses; `first` is where the heading goes.
 */
export function themeHeadings(view: Readonly<{ additions: Readonly<{ themes: readonly Readonly<{ id: string; title: string; intro: string; notes: readonly GuideNote[] }>[] }> | null }> | null,
  order: readonly string[], firstLine: (text: string) => string): ThemeHeading[] {
  const at = new Map(order.map((ref, index) => [ref, index]));
  return (view?.additions?.themes ?? []).flatMap(theme => {
    const refs = theme.notes.map(note => note.verseRef).filter(ref => at.has(ref)).sort((a, b) => at.get(a)! - at.get(b)!);
    return refs.length ? [{ id: theme.id, title: theme.title, intro: firstLine(theme.intro), span: verseSpan(refs[0], refs[refs.length - 1]), first: refs[0] }] : [];
  });
}
