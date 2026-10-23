"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CommentaryEntry, verseWords, type WorkState } from "../workspace/study/commentary-view";
import { StarButton, starKey, STAR_STRINGS, type DrillDraft, type OwnLayer, type OwnStars, type StarKey } from "../workspace/study/own-layer";
import { workLabel } from "../workspace/reading-toolbar";
import type { StudyVerse } from "../workspace/study/api";
import { conflictWork, fetchSavedStars, saveSavedWork, savedText, setSavedStar, type SavedStar, type SavedWork, type WorkStream } from "./api";
import styles from "./saved.module.css";

/**
 * The Yours row's words. "Yours" is the spec's (§3.2 item 5); "My translation", "My notes" and "Save" are the plan's;
 * "Saved." is the reading editor's. The rest are proposed wording, not yet approved by Daniel, kept here so each swaps in one place.
 */
export const YOURS_STRINGS = Object.freeze({
  row: "Yours",
  translation: "My translation",
  notes: "My notes",
  save: "Save",
  saved: "Saved.",
  privacy: "Only you can see what you keep here.",
  starred: "Starred comments",
  conflict: "This changed elsewhere. It shows what’s saved now.",
  failed: "This didn’t save. Try again.",
  limit: "This account has as many translations and notes as it can keep.",
  tooLong: "This is too long to save. Shorten it, then save.",
});

/** A verse's two own texts, once its page of ten has loaded. */
export type VerseWork = Readonly<{ translation: SavedWork | null; note: SavedWork | null }>;
type Notice = Readonly<{ text: string; tone: "status" | "alert" }>;
export type YoursField = Readonly<{ value: string; ready: boolean; busy: boolean; notice: Notice | null; onChange(value: string): void; onSave(): void }>;

/** One own text with its Save, opened in place. */
function Field({ id, label, field, inputRef }: { id: string; label: string; field: YoursField; inputRef?: (element: HTMLTextAreaElement | null) => void }) {
  return <form className={styles.yoursField} aria-label={label} onSubmit={event => { event.preventDefault(); field.onSave(); }}>
    <label htmlFor={id}>{label}</label>
    <textarea id={id} ref={inputRef} value={field.value} rows={3} dir="auto" disabled={!field.ready || field.busy} onChange={event => field.onChange(event.target.value)} />
    <div className={styles.yoursSave}>
      <button type="submit" className="button-secondary" disabled={!field.ready || field.busy}>{YOURS_STRINGS.save}</button>
      <p className={field.notice?.tone === "alert" ? "request-error" : styles.yoursNote} role={field.notice?.tone ?? "status"}>{field.notice?.text ?? ""}</p>
    </div>
  </form>;
}

/** The closed Yours row under a Study verse: My translation, My notes, and the comments starred on it. Never a dialog. */
export function YoursRowView({ verseRef, open, onToggle, translation, note, starred, inputRef }: {
  verseRef: string; open: boolean; onToggle(): void; translation: YoursField; note: YoursField; starred: ReactNode; inputRef?: (element: HTMLTextAreaElement | null) => void;
}) {
  const id = useId();
  return <section className={styles.yours} aria-label={`${YOURS_STRINGS.row} on ${verseRef}`} data-yours-ref={verseRef}>
    <button type="button" className={styles.yoursToggle} aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined} onClick={onToggle}>{YOURS_STRINGS.row}</button>
    {open && <div id={`${id}-panel`} className={styles.yoursPanel}>
      <p className={styles.yoursPrivacy}>{YOURS_STRINGS.privacy}</p>
      <Field id={`${id}-translation`} label={YOURS_STRINGS.translation} field={translation} inputRef={inputRef} />
      <Field id={`${id}-note`} label={YOURS_STRINGS.notes} field={note} />
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
  return <section className={styles.yoursStarred} aria-label={`${YOURS_STRINGS.starred} on ${verse.ref}`}>
    <h5 className={styles.yoursHeading}>{YOURS_STRINGS.starred}</h5>
    {groups.map(group => <div key={group.work} data-work={group.work}>
      <p className={styles.yoursWork}>{workLabel(group.work)}</p>
      {group.comments.map(row => <CommentaryEntry key={row.index} comment={row.comment} words={words} verseRef={verse.ref}
        star={<StarButton stars={stars} work={group.work} verseRef={verse.ref} index={row.index} />} />)}
    </div>)}
  </section>;
}

type StarState = Readonly<{ status: "loading" | "off" } | { status: "ready"; keys: ReadonlySet<string>; list: readonly SavedStar[] }>;
const fieldKey = (ref: string, stream: WorkStream) => `${stream}|${ref}`;

/**
 * The member's own layer on their saved reading: stars (loaded once the reading has opened for its owner), the Yours rows
 * and the drill's own translation. `work` and `ensure` come from the page's ten-verse loads; `refused` asks the page to check
 * the account again, as a mark refusal does. Nothing here is ever cached beyond the page, and nothing is shared.
 */
export function useSavedOwnLayer({ readingId, active, work, putWork, ensure, refused, openStudy }: {
  readingId: string; active: boolean; work: ReadonlyMap<string, VerseWork>; putWork(ref: string, stream: WorkStream, value: SavedWork | null): void;
  ensure(ref: string): void; refused(): void; openStudy(): void;
}): OwnLayer {
  const [stars, setStars] = useState<StarState>({ status: "loading" });
  const [pendingStars, setPendingStars] = useState<ReadonlySet<string>>(new Set()), [starNotice, setStarNotice] = useState<{ key: string; text: string } | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set()), [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set()), [notices, setNotices] = useState<ReadonlyMap<string, Notice>>(new Map());
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
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

  const notify = (key: string, notice: Notice | null) => setNotices(current => { const next = new Map(current); if (notice) next.set(key, notice); else next.delete(key); return next; });
  const save = (ref: string, stream: WorkStream) => {
    const key = fieldKey(ref, stream), current = work.get(ref)?.[stream] ?? null, typed = drafts.get(key) ?? current?.text ?? "", text = savedText(typed);
    if (text === null) { notify(key, { text: YOURS_STRINGS.tooLong, tone: "alert" }); return; }
    setBusy(value => new Set(value).add(key)); notify(key, null);
    saveSavedWork({ readingId, verseRef: ref, stream, expectedVersion: current?.version ?? 0, text }).then(result => {
      setBusy(value => { const next = new Set(value); next.delete(key); return next; });
      const forget = () => setDrafts(value => { const next = new Map(value); next.delete(key); return next; });
      if (result.ok) { putWork(ref, stream, result.value); forget(); notify(key, { text: YOURS_STRINGS.saved, tone: "status" }); return; }
      if (result.code === "conflict") {
        const saved = conflictWork(result.current);
        if (saved !== undefined) { putWork(ref, stream, saved); forget(); notify(key, { text: YOURS_STRINGS.conflict, tone: "alert" }); return; }
      }
      notify(key, { text: result.code === "limit" ? YOURS_STRINGS.limit : YOURS_STRINGS.failed, tone: "alert" });
      if (result.code === "signed-out" || result.code === "not-eligible" || result.code === "missing") callbacks.current.refused();
    });
  };
  const field = (ref: string, stream: WorkStream): YoursField => {
    const key = fieldKey(ref, stream), loaded = work.get(ref);
    return { value: drafts.get(key) ?? loaded?.[stream]?.text ?? "", ready: loaded !== undefined, busy: busy.has(key), notice: notices.get(key) ?? null,
      onChange: value => { setDrafts(current => new Map(current).set(key, value)); notify(key, null); }, onSave: () => save(ref, stream) };
  };
  const toggle = (ref: string) => {
    callbacks.current.ensure(ref);
    setOpen(current => { const next = new Set(current); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
  };
  const yours = (verse: StudyVerse, works: readonly WorkState[]) => <YoursRow key={verse.ref} verseRef={verse.ref} open={open.has(verse.ref)} onToggle={() => toggle(verse.ref)}
    translation={field(verse.ref, "translation")} note={field(verse.ref, "note")} focus={focusRequest === verse.ref} onFocused={() => setFocusRequest(null)}
    starred={ownStars && stars.status === "ready" && <StarredComments verse={verse} works={works} stars={ownStars} list={stars.list} />} />;
  const draft = (ref: string): DrillDraft => {
    const loaded = work.get(ref);
    if (!loaded) return { state: "none" };
    return loaded.translation?.text.trim() ? { state: "draft", text: loaded.translation.text } : { state: "empty" };
  };
  const writeOwn = (ref: string) => {
    callbacks.current.ensure(ref);
    setOpen(current => new Set(current).add(ref)); setFocusRequest(ref); openStudy();
  };
  return { stars: ownStars, yours, draft, writeOwn };
}

/** A Yours row that, asked from the drill's "Write one in Yours", comes into view with My translation focused. */
function YoursRow({ focus, onFocused, ...view }: Parameters<typeof YoursRowView>[0] & { focus: boolean; onFocused(): void }) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!focus || !view.open || !view.translation.ready) return;
    onFocused();
    try { input.current?.scrollIntoView({ block: "center" }); } catch { /* Stay where the page is. */ }
    input.current?.focus({ preventScroll: true });
  }, [focus, view.open, view.translation.ready, onFocused]);
  return <YoursRowView {...view} inputRef={element => { input.current = element; }} />;
}
