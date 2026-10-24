import { commentaryCandidates, commentaryChapterOfVerse, type CommentaryComment, type CommentaryEdition, type CommentaryRun } from "../readings/commentary";
import type { SheetShow } from "./sheet-format";
import type { DiscussionSource, DiscussionsAnswer } from "../discussions/answer";
import { claudeTranslationCredit } from "../discussions/labels";

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
export function buildAppendix(refs: readonly string[], sources: readonly AppendixSource[], show: SheetShow, discussions?: DiscussionsAnswer | null): readonly AppendixGroup[] {
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
    if (discussions) works.push(...discussionWorks(ref, discussions, show));
    if (works.length) groups.push({ ref, works });
  }
  return groups;
}

/** A translation's markdown-lite text as runs: ** is bold, * and _ are italic, a list marker stays as the text it is; nothing is ever markup. */
function runsOf(line: string): readonly CommentaryRun[] {
  const runs: CommentaryRun[] = [], pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index) });
    runs.push(match[1] !== undefined ? { text: match[1], bold: true } : { text: match[2] ?? match[3] ?? "", italic: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });
  return runs.filter(run => run.text);
}
/** One printed paragraph per paragraph of the translation, and one per list line (numbers stay; bullets print as a bullet). */
export function translationParagraphs(body: string): readonly (readonly CommentaryRun[])[] {
  return body.replace(/\r\n?/g, "\n").split(/\n{2,}/).flatMap(block => block.split("\n").map(line => line.trim()).filter(Boolean).map(line => runsOf(line.replace(/^[-*]\s+/, "\u2022 "))))
    .filter(runs => runs.length);
}

/**
 * What one discussion source prints, or null. A Sefaria edition prints each language only when its edition's stated licence passes the
 * same filter as commentary, with that edition's credit (and nothing at all when Sefaria's text did not load). A Claude translation is
 * our own text and always prints, with "Claude translation for {productName}"; its Hebrew or Aramaic original prints beside it under
 * the filter. On a Hebrew-only sheet a translation gives way to an original that printed. "Selected by" is a screen detail and never prints.
 */
export function printableSource(source: DiscussionSource, productName: string, show: SheetShow): { comments: readonly AppendixComment[]; credits: readonly string[] } | null {
  const printable = (source.text?.editions ?? []).filter(edition => isPrintableLicense(edition.license));
  const hebrew = printable.some(edition => edition.language === "he"), english = printable.some(edition => edition.language === "en");
  const segments = (source.text?.segments ?? []).map(segment => ({ hebrew: hebrew ? segment.hebrew : null, english: english && source.kind === "edition" ? segment.english : null })).filter(segment => segment.hebrew || segment.english);
  if (source.kind === "edition") {
    const comments = segments.map(segment => chosen(segment, show));
    const shown = printable.filter(edition => comments.some(comment => edition.language === "he" ? comment.hebrew : comment.english));
    return comments.length ? { comments, credits: [...new Set(shown.map(edition => edition.credit))] } : null;
  }
  const original = segments.filter(segment => segment.hebrew).map(segment => ({ hebrew: segment.hebrew, english: null }));
  const body = show === "hebrew" && original.length ? [] : translationParagraphs(source.translation.body).map(runs => ({ hebrew: null, english: runs }));
  const comments = [...original, ...body];
  if (!comments.length) return null;
  const credits = [...(body.length ? [claudeTranslationCredit(productName)] : []), ...(original.length ? printable.filter(edition => edition.language === "he").map(edition => edition.credit) : [])];
  return { comments, credits: [...new Set(credits)] };
}

/**
 * The discussions anchored on one verse, as appendix works: each source is one block headed with its discussion's title and its own
 * reference, in the discussion's order, after the verse's commentary. A source with nothing printable is not listed.
 */
export function discussionWorks(ref: string, discussions: DiscussionsAnswer, show: SheetShow): readonly AppendixWork[] {
  const works: AppendixWork[] = [];
  if (!discussions.productName) return works;
  for (const discussion of discussions.discussions) for (const source of discussion.sources) {
    if (source.anchorRef !== ref) continue;
    const printed = printableSource(source, discussions.productName, show);
    if (printed) works.push({ work: `discussion:${discussion.slug}:${source.position}`, label: `${discussion.title}: ${source.ref}`, comments: printed.comments, credits: printed.credits });
  }
  return works;
}
