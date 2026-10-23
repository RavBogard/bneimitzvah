"use client";
import { Fragment, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { matchDibbur, type DibburMatch } from "../../../../lib/hebrew/dibbur";
import { projectStudyVerse } from "../../../../lib/hebrew/study-tokens";
import { COMMENTARY_WORKS, commentaryChapterOfVerse, commentarySefariaUrl, type CommentaryComment, type CommentaryCorpus, type CommentaryEdition, type CommentaryRun } from "../../../../lib/readings/commentary";
import { createCommentaryChapterStore, type CommentaryVerseState } from "./commentary-api";
import { commentaryCount, commentaryParts, commentarySummary } from "./commentary-text";
import { useCommentaryChapters, type CommentaryLookup } from "./use-commentary";
import { workCoverageNote, workLabel } from "../reading-toolbar";
import type { StudyVerse } from "./api";
import { StarButton, useOwnLayer } from "./own-layer";
import styles from "./commentary.module.css";

/** Text only: bold and italic runs become <strong> and <em>; nothing is ever markup. */
export function Runs({ runs }: { runs: readonly CommentaryRun[] }) {
  return <>{runs.map((run, index) => run.bold ? <strong key={index}>{run.text}</strong> : run.italic ? <em key={index}>{run.text}</em> : <Fragment key={index}>{run.text}</Fragment>)}</>;
}
/** The verse's words as the reader sees them, for the comment-to-word link; empty when the verse can't be split into words. */
export function verseWords(verse: StudyVerse): readonly string[] {
  const projection = projectStudyVerse(verse.ref, verse.hebrew);
  return projection.status === "ready" ? projection.projection.words.map(word => word.text) : [];
}

/** Pointing at a comment: by the mouse, by keyboard focus, or pinned by a tap. The first present wins, in that order. */
export type LinkSource = "hover" | "focus" | "pin";
export type LinkHandler = (source: LinkSource, match: DibburMatch | null) => void;
/** One verse's pointed-at words, from any number of comments; `marked` is what the Hebrew underlines. */
export function useCommentLink() {
  const [state, setState] = useState<Partial<Record<LinkSource, DibburMatch & { key: string }>>>({});
  const point = useCallback((key: string) => (source: LinkSource, match: DibburMatch | null) => setState(current => {
    // Letting go of a pin also lets go of this comment's focus and hover, so the underline really goes
    // (a tap focuses the quoted words in most browsers).
    const drop = (source: LinkSource) => current[source]?.key === key ? undefined : current[source];
    if (source === "pin") return current.pin?.key === key || !match ? { hover: drop("hover"), focus: drop("focus"), pin: undefined } : { ...current, pin: { ...match, key } };
    if (!match) return current[source]?.key === key ? { ...current, [source]: undefined } : current;
    return { ...current, [source]: { ...match, key } };
  }), []);
  const marked = state.hover ?? state.focus ?? state.pin ?? null;
  return { marked: marked ? { first: marked.first, last: marked.last } : null, markedKey: marked?.key ?? null, pinned: state.pin?.key ?? null, point, clear: useCallback(() => setState({}), []) };
}
export type CommentLink = ReturnType<typeof useCommentLink>;
/** Lein's passage underlines words in one verse: the verse (page index) whose comment is pointed at. Keys start "<verse ref>|". */
export function linkedVerse(link: CommentLink, verses: readonly StudyVerse[]): (DibburMatch & { verse: number }) | null {
  if (!link.marked || !link.markedKey) return null;
  const ref = link.markedKey.slice(0, link.markedKey.indexOf("|")), verse = verses.findIndex(row => row.ref === ref);
  return verse >= 0 ? { ...link.marked, verse } : null;
}

const CLAMP_SLACK = 2;
/**
 * One comment, English-led: Rashi's quoted words in bold Hebrew, then the
 * English, three lines and More. Hebrew shows Rashi's own words in place.
 * When the quoted words are found once in the verse, pointing at the comment
 * underlines them there; tapping the quoted words keeps them underlined.
 */
export function CommentaryEntry({ comment, words, verseRef, onLink, pinned, language = "he", star }: {
  comment: CommentaryComment; words: readonly string[]; verseRef: string; onLink?: LinkHandler; pinned?: boolean;
  /** A member's star on this comment (their own saved reading only), first in the comment's controls. */
  star?: ReactNode;
  /** The language of the non-English text: Hebrew, or Aramaic for a Targum or the Talmud (same direction and font). */
  language?: "he" | "arc";
}) {
  const id = useId(), parts = useMemo(() => commentaryParts(comment), [comment]);
  const linkable = Boolean(onLink), match = useMemo(() => linkable ? matchDibbur(parts.dibbur, words) : null, [linkable, parts.dibbur, words]);
  const [expanded, setExpanded] = useState(false), [hebrew, setHebrew] = useState(false), [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLParagraphElement | null>(null);
  // "More" appears only when the text is longer than three lines at this width.
  useLayoutEffect(() => {
    const element = body.current; if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + CLAMP_SLACK);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, parts]);
  const english = parts.english, leadsInHebrew = !english && !parts.lemma;
  const lemma = parts.lemma && <span className={styles.lemma} data-caps={parts.lemma.caps ? "" : undefined}>{parts.lemma.text}</span>;
  const quoted = parts.dibbur && <bdi lang={language} dir="rtl" className={styles.dibbur}>{parts.dibbur}</bdi>;
  const lead = parts.dibbur ? match ? <button type="button" className={styles.dibburLink} aria-pressed={pinned ?? false}
    onClick={event => { event.stopPropagation(); onLink?.("pin", pinned ? null : match);
      // Once the underline is drawn, bring the quoted words into view if they are off screen; no smooth scroll.
      if (!pinned) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-verse-ref="${CSS.escape(verseRef)}"] [data-linked="true"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" })); }}>
    {quoted}<span className="sr-only"> (show in the verse)</span></button> : quoted : null;
  const hebrewText = <>{parts.dibbur && <strong>{parts.dibbur}</strong>}{parts.dibbur && parts.hebrew && " "}{parts.hebrew && <Runs runs={parts.hebrew} />}</>;
  const hasHebrew = !leadsInHebrew && Boolean(parts.hebrew || parts.dibbur);
  return <div className={styles.entry} data-linkable={match ? "true" : undefined} data-pinned={pinned ? "true" : undefined}
    onPointerEnter={match ? event => { if (event.pointerType === "mouse") onLink?.("hover", match); } : undefined}
    onPointerLeave={match ? event => { if (event.pointerType === "mouse") onLink?.("hover", null); } : undefined}
    onFocus={match ? () => onLink?.("focus", match) : undefined}
    onBlur={match ? event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLink?.("focus", null); } : undefined}
    onClick={match ? event => { if ((event.target as Element).closest("a, button") || window.getSelection()?.toString()) return; onLink?.("pin", pinned ? null : match); } : undefined}>
    {leadsInHebrew
      ? <p ref={body} id={`${id}-text`} lang={language} dir="rtl" className={`${styles.text} ${styles.hebrewText} ${expanded ? "" : styles.clamped}`}>{match ? <>{lead}{parts.hebrew && " "}{parts.hebrew && <Runs runs={parts.hebrew} />}</> : hebrewText}</p>
      : <p ref={body} id={`${id}-text`} lang="en" dir="ltr" className={`${styles.text} ${expanded ? "" : styles.clamped}`}>{lead}{lead && " "}{lemma}{lemma && english && " "}{english && <Runs runs={english} />}</p>}
    {hebrew && hasHebrew && <p id={`${id}-hebrew`} lang={language} dir="rtl" className={`${styles.text} ${styles.hebrewText}`}>{hebrewText}</p>}
    {(overflows || expanded || hasHebrew || star) && <div className={styles.controls}>
      {star}
      {(overflows || expanded) && <button type="button" aria-expanded={expanded} aria-controls={`${id}-text`} onClick={() => setExpanded(value => !value)}>{expanded ? "Less" : "More"}</button>}
      {hasHebrew && <button type="button" aria-expanded={hebrew} aria-controls={`${id}-hebrew`} lang="en" onClick={() => setHebrew(value => !value)}>Hebrew</button>}
    </div>}
  </div>;
}

export type WorkState = Readonly<{ work: string; state: CommentaryVerseState }>;
/** A verse's inline commentary, set off by a hairline in its margin: each work with something to say, in Works order. */
/** A busy verse shows this many comments per work inline; the rest open in place from one row. */
export const INLINE_COMMENTS = 3;
function WorkComments({ verse, work, comments, words, link }: { verse: StudyVerse; work: string; comments: readonly CommentaryComment[]; words: readonly string[]; link?: CommentLink }) {
  const id = useId(), [all, setAll] = useState(false), hidden = comments.length - INLINE_COMMENTS, stars = useOwnLayer()?.stars ?? null;
  const entry = (comment: CommentaryComment, index: number) => <CommentaryEntry key={index} comment={comment} words={words} verseRef={verse.ref}
    onLink={link ? link.point(`${verse.ref}|${work}:${index}`) : undefined} pinned={link?.pinned === `${verse.ref}|${work}:${index}`}
    star={stars && <StarButton stars={stars} work={work} verseRef={verse.ref} index={index} />} />;
  return <section className={styles.work} aria-label={`${workLabel(work)} on ${verse.ref}`} data-work={work}>
    <h5 className={styles.workName}>{workLabel(work)}</h5>
    {comments.slice(0, INLINE_COMMENTS).map(entry)}
    {hidden > 0 && <>
      {all && <div id={`${id}-rest`}>{comments.slice(INLINE_COMMENTS).map((comment, index) => entry(comment, index + INLINE_COMMENTS))}</div>}
      <button type="button" className={styles.moreComments} aria-expanded={all} aria-controls={`${id}-rest`} onClick={() => setAll(value => !value)}>
        {all ? `${workLabel(work)}: fewer` : `${workLabel(work)}: ${hidden} more`}</button>
    </>}
  </section>;
}
export function VerseCommentary({ verse, works, link }: { verse: StudyVerse; works: readonly WorkState[]; link?: CommentLink }) {
  const words = useMemo(() => verseWords(verse), [verse]);
  const shown = works.filter(row => commentaryCount(row.state) > 0);
  if (!shown.length) return null;
  return <div className={styles.inline} data-commentary-ref={verse.ref}>
    {shown.map(({ work, state }) => state.status === "ready" && <WorkComments key={work} verse={verse} work={work} comments={state.comments} words={words} link={link} />)}
  </div>;
}

/** The editions a work's shown chapters used, each credited once (edition, licence, "via Sefaria", linked). */
export function editionsShown(lookup: CommentaryLookup, refs: readonly string[]): readonly CommentaryEdition[] {
  const seen = new Map<string, CommentaryEdition>();
  for (const ref of refs) { const state = lookup.forVerse(ref); if (state.status === "ready") for (const edition of state.editions) seen.set(`${edition.language}|${edition.title}`, edition); }
  return [...seen.values()];
}
function EditionCredits({ editions }: { editions: readonly CommentaryEdition[] }) {
  // One edition for both languages is credited once.
  const titles = [...new Set(editions.map(edition => edition.title))];
  return <>{titles.map(title => {
    const rows = editions.filter(edition => edition.title === title), languages = rows.map(row => row.language === "he" ? "Hebrew" : "English").join(" and ");
    return <span key={title} className={styles.creditLine}>{languages}: <a href={rows[0].url} target="_blank" rel="noopener noreferrer">{rows[0].credit}</a></span>;
  })}</>;
}
/** At the work's foot: what was shown and where it came from. */
export function CommentaryCredits({ works, refs }: { works: readonly Readonly<{ work: string; lookup: CommentaryLookup }>[]; refs: readonly string[] }) {
  const rows = works.map(row => ({ work: row.work, editions: editionsShown(row.lookup, refs) })).filter(row => row.editions.length);
  if (!rows.length) return null;
  const chapters = [...new Set(refs.map(ref => ref.slice(0, ref.lastIndexOf(":"))))];
  return <div className={styles.credits}>{rows.map(({ work, editions }) => <p key={work}><strong>{workLabel(work)}.</strong> <EditionCredits editions={editions} />
    {chapters.flatMap(chapter => { const parsed = commentaryChapterOfVerse(work, `${chapter}:1`); return parsed ? [<a key={chapter} className={styles.creditLine} href={commentarySefariaUrl(parsed)} target="_blank" rel="noopener noreferrer">{parsed.index} {parsed.number} on Sefaria</a>] : []; })}</p>)}</div>;
}

export type WorkStatus = Readonly<{ work: string; status: "none" | "loading" | "failed" | "ready"; retry(): void; covers: boolean }>;
/** Quiet, one line per work: loading, a failure with Try again, or a work that doesn't cover this text. Never blocks the Hebrew. */
export function CommentaryStatus({ works }: { works: readonly WorkStatus[] }) {
  const rows = works.filter(row => !row.covers || row.status === "loading" || row.status === "failed");
  if (!rows.length) return null;
  return <div className={styles.status} role="status">{rows.map(row => <p key={row.work}>
    {!row.covers ? `${COMMENTARY_WORKS[row.work]?.title.startsWith("The ") ? "The " : ""}${workLabel(row.work)} covers the ${workCoverageNote(row.work) === "Prophets only" ? "Prophets" : "Torah"} only.` : row.status === "loading" ? `Loading ${workLabel(row.work)}…`
      : <>{workLabel(row.work)} isn’t available right now. <button type="button" onClick={row.retry}>Try again</button></>}
  </p>)}</div>;
}

/**
 * Commentary for the verses on screen, one store per work. Fetched after the
 * text renders and only while `enabled`; Try again swaps in a fresh store, so
 * a failed chapter is asked for again at once.
 */
export function useWorkCommentary(work: string, refs: readonly string[], enabled: boolean) {
  const [store, setStore] = useState(() => createCommentaryChapterStore(work));
  const lookup = useCommentaryChapters(work, refs, enabled, store);
  const retry = useCallback(() => setStore(createCommentaryChapterStore(work)), [work]);
  const status = enabled ? commentarySummary(refs.map(ref => lookup.forVerse(ref))) : "none";
  return useMemo(() => ({ work, lookup, retry, status }), [work, lookup, retry, status]);
}

const ALL_WORKS = Object.freeze(Object.keys(COMMENTARY_WORKS));
/** Whether a registered work has editions for this corpus (the Women's Commentary and Ramban: the Torah; Radak: the Prophets). */
export const workCovers = (work: string, corpus: CommentaryCorpus) => Boolean(COMMENTARY_WORKS[work]?.editions[corpus]);
/**
 * Every registered work's commentary for the verses on screen, from one store each. Rashi loads in Lein
 * too (for "Rashi (n)"); in Study, each work loads only while it is chosen in Works and covers this text
 * (`corpus` null: a mixed passage, where each verse says for itself). Returns Rashi, and the chosen works in
 * Works order for Study's rows, status and credits.
 */
export function useReadingWorks(refs: readonly string[], options: Readonly<{ ready: boolean; study: boolean; chosen: readonly string[]; corpus: CommentaryCorpus | null }>) {
  const { ready, study, chosen, corpus } = options;
  // A fixed list (the registry): the same hooks in the same order on every render.
  const rows = ALL_WORKS.map(work => useWorkCommentary(work, refs, ready && (work === "rashi" && !study // eslint-disable-line react-hooks/rules-of-hooks
    || study && chosen.includes(work) && (corpus === null || workCovers(work, corpus)))));
  const works = useMemo(() => chosen.flatMap(work => rows.filter(row => row.work === work)), [chosen, ...rows]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rashi: rows[ALL_WORKS.indexOf("rashi")], works };
}

/**
 * Lein's quiet way to Rashi: a closed "Rashi (n)" disclosure in the selected
 * verse's tools, hidden when Rashi says nothing on the verse. Opening it shows
 * the comments in place, with the credit at their foot.
 */
export function VerseRashi({ verse, state, link, retry, children }: { verse: StudyVerse | null; state: CommentaryVerseState; link?: CommentLink; retry?(): void; children?: ReactNode }) {
  const id = useId(), [open, setOpen] = useState(false), words = useMemo(() => verse ? verseWords(verse) : [], [verse]);
  const count = commentaryCount(state), key = (index: number) => `${verse?.ref}|rashi:${index}`;
  // Nothing when Rashi has nothing to say here, and nothing when Rashi could not be read: Lein stays calm (a failed
  // chapter is asked for again by a later load), and a page of verse tools never shows a row of empty "Rashi" buttons.
  if (!verse || count === 0) return null;
  return <section className={styles.disclosureSection} aria-label={`Rashi on ${verse.ref}`} data-verse-rashi={verse.ref}>
    <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(value => !value)}>{count ? `Rashi (${count})` : "Rashi"}</button>
    {open && <div id={`${id}-panel`} className={styles.panel}>
      {state.status === "ready" && <div className={styles.inline}>
          <h4 className={styles.panelHeading}>Rashi on <bdi dir="ltr">{verse.ref}</bdi></h4>
          {state.comments.map((comment, index) => <CommentaryEntry key={`${verse.ref}:${index}`} comment={comment} words={words} verseRef={verse.ref}
            onLink={link ? link.point(key(index)) : undefined} pinned={link?.pinned === key(index)} />)}
          <p className={styles.credits}><EditionCredits editions={state.editions} /><a className={styles.creditLine} href={state.sefariaUrl} target="_blank" rel="noopener noreferrer">Rashi on <bdi dir="ltr">{verse.ref}</bdi> on Sefaria</a></p>
        </div>}
      {children}
    </div>}
  </section>;
}
