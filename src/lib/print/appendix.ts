import { commentaryCandidates, commentaryChapterOfVerse, type CommentaryComment, type CommentaryEdition, type CommentaryRun } from "../readings/commentary";
import type { SheetShow } from "./sheet-format";

/**
 * The print sheet's commentary appendix (1.7 M5). Pure: the page fetches each chosen work's chapters through the same store Study
 * uses and hands the answers here, so the licence filter and the grouping are testable without a browser.
 *
 * Licence filter (Daniel, 2026-10-23, verbatim "CC BY-NC too (Recommended)"): an edition prints only when its stated licence is
 * public domain, CC0, CC BY or CC BY-NC, any version. No stated licence, and every other licence (CC BY-SA, ND, copyrighted), stays
 * on screen and out of print. JPS 2023 stays the printed English; nothing here touches it.
 */
export function isPrintableLicense(license: string): boolean {
  const value = license.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return /^(public-?domain|cc0(-\d+(\.\d+)?)?|cc-by(-nc)?(-\d+(\.\d+)?)?)$/.test(value);
}

/** One verse's commentary from one work, as the page's chapter store answers it (a ready answer carries the comments and the editions served). */
export type AppendixVerse = Readonly<{ status: "ready"; comments: readonly CommentaryComment[]; editions: readonly CommentaryEdition[] }>
  | Readonly<{ status: "none" | "loading" | "failed" }>;
export type AppendixSource = Readonly<{ work: string; label: string; forVerse(ref: string): AppendixVerse }>;
export type AppendixComment = Readonly<{ hebrew: readonly CommentaryRun[] | null; english: readonly CommentaryRun[] | null }>;
export type AppendixWork = Readonly<{ work: string; label: string; comments: readonly AppendixComment[]; credits: readonly string[] }>;
/** The verse reference is the group's heading. */
export type AppendixGroup = Readonly<{ ref: string; works: readonly AppendixWork[] }>;

/**
 * Whether a work can print on a reading's verses: "uncovered" (the work does not cover them), "unprintable" (it covers them but no
 * pinned edition has a printable licence), or "printable". Decided from the registry's pinned editions, so the settings can say
 * so before any text has loaded.
 */
export function printableCoverage(work: string, refs: readonly string[]): "uncovered" | "unprintable" | "printable" {
  const chapters = [...new Set(refs.map(ref => ref.slice(0, ref.lastIndexOf(":"))))];
  let covered = false;
  for (const name of chapters) {
    const chapter = commentaryChapterOfVerse(work, `${name}:1`);
    if (!chapter) continue;
    covered = true;
    const { he, en } = commentaryCandidates(chapter);
    if ([...he, ...en].some(edition => isPrintableLicense(edition.license))) return "printable";
  }
  return covered ? "unprintable" : "uncovered";
}

/** The distinct commentary chapters a work covers among the verses, in reading order (no cap: the sheet asks for all of them). */
export function appendixChapters(work: string, refs: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  for (const name of new Set(refs.map(ref => ref.slice(0, ref.lastIndexOf(":"))))) if (commentaryChapterOfVerse(work, `${name}:1`)) seen.add(name);
  return [...seen];
}

/** Which language(s) of a comment print: what the sheet shows, falling back to the other language when the work has only that one. */
function chosen(comment: AppendixComment, show: SheetShow): AppendixComment {
  if (show === "both") return comment;
  const wanted = show === "hebrew" ? comment.hebrew : comment.english;
  if (wanted) return show === "hebrew" ? { hebrew: wanted, english: null } : { hebrew: null, english: wanted };
  return show === "hebrew" ? { hebrew: null, english: comment.english } : { hebrew: comment.hebrew, english: null };
}

/**
 * The appendix: every verse of the reading that has printable commentary, in reading order, each with the chosen works in the order
 * given, and each work's comments followed by its credits. A language prints only when the edition served for it is licensed for print;
 * a comment left with nothing to print is dropped, and a verse or work left with nothing is not listed.
 */
export function buildAppendix(refs: readonly string[], sources: readonly AppendixSource[], show: SheetShow): readonly AppendixGroup[] {
  const groups: AppendixGroup[] = [];
  for (const ref of refs) {
    const works: AppendixWork[] = [];
    for (const source of sources) {
      const state = source.forVerse(ref);
      if (state.status !== "ready") continue;
      const printable = state.editions.filter(edition => isPrintableLicense(edition.license));
      const hebrew = printable.some(edition => edition.language === "he"), english = printable.some(edition => edition.language === "en");
      const comments = state.comments
        .map(comment => ({ hebrew: hebrew ? comment.hebrew : null, english: english ? comment.english : null }))
        .filter(comment => comment.hebrew || comment.english)
        .map(comment => chosen(comment, show));
      // Credit only the editions whose language actually prints.
      const shown = printable.filter(edition => comments.some(comment => edition.language === "he" ? comment.hebrew : comment.english));
      if (comments.length) works.push({ work: source.work, label: source.label, comments, credits: [...new Set(shown.map(edition => edition.credit))] });
    }
    if (works.length) groups.push({ ref, works });
  }
  return groups;
}
