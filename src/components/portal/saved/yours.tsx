"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CommentaryEntry, verseWords, type WorkState } from "../workspace/study/commentary-view";
import { StarButton, starKey, STAR_STRINGS, type OwnLayer, type OwnStars, type StarKey } from "../workspace/study/own-layer";
import { workLabel } from "../workspace/reading-toolbar";
import type { StudyVerse } from "../workspace/study/api";
import { fetchSavedStars, setSavedStar, type SavedStar, type SavedWork } from "./api";
import styles from "./saved.module.css";

/**
 * The Yours row's words. "Yours" is the spec's (§3.2 item 5); "My translation" and "My notes" are the plan's labels for
 * texts the member stored earlier. Release 1.7 removed the editors: the row only shows what is already kept, read-only.
 * The rest is proposed wording, not yet approved by Daniel, kept here so each swaps in one place.
 */
export const YOURS_STRINGS = Object.freeze({
  row: "Yours",
  translation: "My translation",
  notes: "My notes",
  privacy: "Your tutor and the rabbi can see what you keep here.",
  starred: "Starred comments",
});

/** A verse's two own texts, once its page of ten has loaded. Stored text is shown to its owner and never written from here. */
export type VerseWork = Readonly<{ translation: SavedWork | null; note: SavedWork | null }>;

/** One stored own text, read-only; shown only when there is some. */
function Stored({ label, stream, text }: { label: string; stream: "translation" | "note"; text: string | undefined }) {
  if (!text?.trim()) return null;
  return <div className={styles.yoursField} data-yours-stored={label} data-yours-stream={stream}>
    <p className={styles.yoursWork}>{label}</p>
    <p className={styles.yoursText} dir="auto">{text}</p>
  </div>;
}

/** The closed Yours row under a Study verse: stored My translation and My notes, read-only, and the comments starred on it. Never a dialog. */
export function YoursRowView({ verseRef, open, onToggle, translation, note, starred }: {
  verseRef: string; open: boolean; onToggle(): void; translation: string | undefined; note: string | undefined; starred: ReactNode;
}) {
  const id = useId();
  return <section className={styles.yours} aria-label={`${YOURS_STRINGS.row} on ${verseRef}`} data-yours-ref={verseRef}>
    <button type="button" className={styles.yoursToggle} data-testid="yours-toggle" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} onClick={onToggle}>{YOURS_STRINGS.row}</button>
    {open && <div id={`${id}-panel`} className={styles.yoursPanel}>
      <p className={styles.yoursPrivacy}>{YOURS_STRINGS.privacy}</p>
      <Stored label={YOURS_STRINGS.translation} stream="translation" text={translation} />
      <Stored label={YOURS_STRINGS.notes} stream="note" text={note} />
      {starred}
    </div>}
  </section>;
}

/** The comments the member starred on this verse, from the works on screen, each with its star. */
function StarredComments({ verse, works, stars, list }: { verse: StudyVerse; works: readonly WorkState[]; stars: OwnStars; list: readonly SavedStar[] }) {
  const words = useMemo(() => verseWords(verse), [verse]);
  const groups = works.flatMap(({ work, state }) => {
    if (state.status !== "ready") return [];
    const shown = list.filter(star => star.work === work && star.verseRef === verse.ref && state.comments[star.comment - 1]).sort((a, b) => a.comment - b.comment);
    return shown.length ? [{ work, comments: shown.map(star => ({ index: star.comment - 1, comment: state.comments[star.comment - 1] })) }] : [];
  });
  if (!groups.length) return null;
  return <section className={styles.yoursStarred} data-testid="yours-starred" aria-label={`${YOURS_STRINGS.starred} on ${verse.ref}`}>
    <h5 className={styles.yoursHeading}>{YOURS_STRINGS.starred}</h5>
    {groups.map(group => <div key={group.work} data-work={group.work}>
      <p className={styles.yoursWork}>{workLabel(group.work)}</p>
      {group.comments.map(row => <CommentaryEntry key={row.index} comment={row.comment} words={words} verseRef={verse.ref}
        star={<StarButton stars={stars} work={group.work} verseRef={verse.ref} index={row.index} />} />)}
    </div>)}
  </section>;
}

type StarState = Readonly<{ status: "loading" | "off" } | { status: "ready"; keys: ReadonlySet<string>; list: readonly SavedStar[] }>;

/**
 * The member's own layer on their saved reading: stars (loaded once the reading has opened for its owner) and the Yours
 * rows, which show stored text read-only. `work` and `ensure` come from the page's ten-verse loads; `refused` asks the
 * page to check the account again, as a mark refusal does. Nothing here is ever cached beyond the page, and nothing is shared.
 */
export function useSavedOwnLayer({ readingId, active, work, ensure, refused }: {
  readingId: string; active: boolean; work: ReadonlyMap<string, VerseWork>; ensure(ref: string): void; refused(): void;
}): OwnLayer {
  const [stars, setStars] = useState<StarState>({ status: "loading" });
  const [pendingStars, setPendingStars] = useState<ReadonlySet<string>>(new Set()), [starNotice, setStarNotice] = useState<{ key: string; text: string } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const callbacks = useRef({ refused, ensure }); callbacks.current = { refused, ensure };

  // Asked for again each time the reading opens for its owner (a page restored from the back-forward cache included).
  useEffect(() => {
    if (!active) { setStars({ status: "loading" }); return; }
    const controller = new AbortController();
    fetchSavedStars(controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setStars(result.state === "ready" ? { status: "ready", keys: new Set(result.stars.map(starKey)), list: result.stars } : { status: "off" });
    }, () => { if (!controller.signal.aborted) setStars({ status: "off" }); });
    return () => controller.abort();
  }, [active, readingId]);

  const toggleStar = useCallback((key: StarKey) => {
    if (stars.status !== "ready") return;
    const id = starKey(key), starred = !stars.keys.has(id);
    setPendingStars(current => new Set(current).add(id)); setStarNotice(null);
    setSavedStar({ ...key, starred }).then(result => {
      setPendingStars(current => { const next = new Set(current); next.delete(id); return next; });
      if (result.ok) {
        setStars(current => {
          if (current.status !== "ready") return current;
          const keys = new Set(current.keys), list = current.list.filter(star => starKey(star) !== id);
          if (result.value.starred) { keys.add(id); list.push({ work: key.work, verseRef: key.verseRef, comment: key.comment }); } else keys.delete(id);
          return { status: "ready", keys, list };
        });
        return;
      }
      setStarNotice({ key: id, text: result.code === "limit" ? STAR_STRINGS.limit : STAR_STRINGS.failed });
      if (result.code === "signed-out" || result.code === "not-eligible") callbacks.current.refused();
    });
  }, [stars]);
  const ownStars = useMemo<OwnStars | null>(() => stars.status !== "ready" ? null : Object.freeze({
    starred: key => stars.keys.has(starKey(key)), pending: key => pendingStars.has(starKey(key)),
    notice: key => starNotice?.key === starKey(key) ? starNotice.text : "", toggle: toggleStar,
  }), [stars, pendingStars, starNotice, toggleStar]);

  const toggle = (ref: string) => {
    callbacks.current.ensure(ref);
    setOpen(current => { const next = new Set(current); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
  };
  const yours = (verse: StudyVerse, works: readonly WorkState[]) => <YoursRowView key={verse.ref} verseRef={verse.ref} open={open.has(verse.ref)} onToggle={() => toggle(verse.ref)}
    translation={work.get(verse.ref)?.translation?.text} note={work.get(verse.ref)?.note?.text}
    starred={ownStars && stars.status === "ready" && <StarredComments verse={verse} works={works} stars={ownStars} list={stars.list} />} />;
  return { stars: ownStars, yours };
}
