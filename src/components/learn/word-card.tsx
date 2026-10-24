"use client";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { unitWordParts, wordCardPassage, type WordCardTarget } from "../../lib/learn/word-tap";
import { fetchPublicWordAids, fetchPublicWordDetails, type PublicSource } from "../portal/public-reading/api";
import type { StudyVerse } from "../portal/workspace/study/api";
import { WordCard } from "../portal/workspace/study/word-tools";
import { createWordToolsSelection, type WordToolsState } from "../portal/workspace/study/word-tools-selection";
import styles from "./learn.module.css";

/**
 * The Learn word card (ruling 2026-10-23): a tapped word opens its card, never trope. The card is /read's own
 * WordCard over the same createWordToolsSelection and the same ref-keyed public routes (/api/public/word-aids and
 * /api/public/word-details). A course verse is named by its own ref; a verse of this week's reading by the week's
 * passage, so "This word elsewhere" covers the reading. On phones it is a bottom sheet over a scrim; from 641px it
 * is a panel anchored under the word. Escape, Close or a tap outside closes it and focus goes back to the word.
 * It plays nothing.
 */
type Opener = (target: WordCardTarget, trigger: HTMLElement | null) => void;
const Context = createContext<Opener | null>(null), OpenContext = createContext(false);
/** The opener for word cards, or null outside a scope (the word is then plain text). */
export const useWordCard = () => useContext(Context);
/** Is a word card open on this page? Quick ten holds its next phrase while one is. */
export const useWordCardOpen = () => useContext(OpenContext);
type Open = Readonly<{ target: WordCardTarget; trigger: HTMLElement | null; n: number }>;
const same = (a: WordCardTarget, b: WordCardTarget) => a.verse === b.verse && a.unit === b.unit && a.word === b.word;

export function WordCardScope({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null), count = useRef(0), current = useRef(open); current.current = open;
  const show = useCallback<Opener>((target, trigger) => {
    if (current.current && same(current.current.target, target)) return;
    setOpen(Object.freeze({ target, trigger, n: ++count.current }));
  }, []);
  const close = useCallback((restore: boolean) => {
    const shown = current.current; if (!shown) return;
    setOpen(null);
    if (restore && shown.trigger?.isConnected) shown.trigger.focus({ preventScroll: true });
  }, []);
  return <Context.Provider value={show}><OpenContext.Provider value={open !== null}>{children}{open && <WordSheet key={open.n} target={open.target} trigger={open.trigger} onClose={close} />}</OpenContext.Provider></Context.Provider>;
}

export const WIDE_CARD_QUERY = "(min-width: 641px)";
function useWide(): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    let media: MediaQueryList;
    try { media = window.matchMedia(WIDE_CARD_QUERY); } catch { setWide(false); return; }
    const update = () => setWide(media.matches); update();
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}
const idle: WordToolsState = Object.freeze({ open: false, selection: null, aids: Object.freeze({ status: "idle" }), details: Object.freeze({ status: "idle" }) });
const GUTTER = 16, GAP = 8;

function WordSheet({ target, trigger, onClose }: { target: WordCardTarget; trigger: HTMLElement | null; onClose(restore: boolean): void }) {
  const { verse, unit, word } = target, passage = wordCardPassage(verse), id = useId(), wide = useWide();
  const study = useMemo<StudyVerse>(() => ({ ref: verse.ref, english: null, hebrew: verse.hebrew as StudyVerse["hebrew"] }), [verse]);
  const source = useMemo<PublicSource>(() => Object.freeze({ selector: Object.freeze({ by: "ref" as const, ref: passage.ref, kind: verse.kind }),
    passage: Object.freeze({ kind: verse.kind, ranges: Object.freeze(passage.ref.split("; ")), verseCount: passage.count, pages: Object.freeze([]) }), listening: false }), [passage.ref, passage.count, verse.kind]);
  const [state, setState] = useState<WordToolsState>(idle), owner = useRef<ReturnType<typeof createWordToolsSelection> | null>(null), opened = useRef(false);
  const panel = useRef<HTMLDivElement | null>(null), heading = useRef<HTMLHeadingElement | null>(null), [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const done = useRef(onClose); done.current = onClose;

  useLayoutEffect(() => {
    let live = true;
    const tools = createWordToolsSelection({ verses: [study], onState: value => { if (live) setState(value); },
      readAids: (_, signal) => fetchPublicWordAids(source, passage.index, study, signal),
      readDetails: (_, index, signal) => fetchPublicWordDetails(source, passage.index, study, index, signal) });
    owner.current = tools; tools.select(0, word); tools.open();
    return () => { live = false; tools.dispose(); if (owner.current === tools) owner.current = null; };
  }, [study, source, passage.index, word]);
  // The selection closes itself when the reading answers that the word cannot be shown; the sheet goes with it.
  useEffect(() => { if (state.open) opened.current = true; else if (opened.current) done.current(true); }, [state.open]);
  // Focus moves to the heading once the card is on screen: a wide panel is hidden until it has its place.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || wide === null || (wide && !place) || !heading.current) return;
    focused.current = true; heading.current.focus({ preventScroll: true });
  }, [wide, place, state.selection]);

  // Wide: under the word (or above it when there is more room there), inside the 16px gutters; it scrolls with the page.
  useLayoutEffect(() => {
    if (!wide) { setPlace(null); return; }
    const position = () => {
      const box = panel.current, word = trigger?.isConnected ? trigger.getBoundingClientRect() : null; if (!box || !word) return;
      const width = box.offsetWidth, height = box.offsetHeight, below = innerHeight - word.bottom, above = word.top;
      const top = below < height + GAP && above > below ? word.top - height - GAP : word.bottom + GAP;
      const left = Math.min(Math.max(GUTTER, word.right - width), document.documentElement.clientWidth - width - GUTTER);
      setPlace({ top: top + scrollY, left: Math.max(GUTTER, left) + scrollX });
    };
    position(); addEventListener("resize", position); return () => removeEventListener("resize", position);
  }, [wide, trigger, state.details.status, state.aids.status]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); done.current(true); } };
    // A tap outside closes the card; on the word that opened it, it stays.
    const down = (event: PointerEvent) => {
      const node = event.target as Node | null; if (node && (panel.current?.contains(node) || trigger?.contains(node))) return;
      const another = node instanceof Element && node.closest("[data-word-card]") !== null;
      // Focus goes back to the word; the press itself must not then move it to the page behind (a click still lands).
      if (!another) event.preventDefault();
      done.current(!another);
    };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", down);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", down); };
  }, [trigger]);

  if (wide === null || typeof document === "undefined") return null;
  const row = verse.units[unit], parts = row ? unitWordParts(row) : null;
  const title = row ? parts ? parts.map(part => part.word === word ? <mark key={part.word} className={styles.cardMark}>{part.text}</mark> : <span key={part.word}>{part.text}</span>) : row.text : undefined;
  return createPortal(<>
    {!wide && <div className={styles.cardScrim} aria-hidden="true" />}
    <div ref={panel} role="dialog" aria-modal="false" aria-labelledby={`${id}-heading`} className={styles.card} data-layout={wide ? "panel" : "sheet"}
      style={wide ? place ? { top: place.top, left: place.left } : { visibility: "hidden" } : undefined}
      onBlur={event => { const next = event.relatedTarget as Node | null; if (next && !panel.current?.contains(next) && !(next instanceof Element && next.closest("[data-word-card]"))) done.current(false); }}>
      <button type="button" className={styles.cardClose} aria-label="Close" onClick={() => done.current(true)}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <WordCard state={state} verse={study} heading={title} headingId={`${id}-heading`} headingRef={heading} showElsewhere={passage.count > 1} compact className={styles.cardBody} onRetry={() => owner.current?.retry()} />
    </div>
  </>, document.body);
}
