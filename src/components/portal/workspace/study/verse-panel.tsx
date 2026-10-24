"use client";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseCompareVerse } from "../../../../lib/readings/compare";
import { CompareView } from "./compare-view";
import { ShelfView } from "./shelf-view";
import { WordPanelBody, type WordPanelHost } from "./word-panel";
import { escapeClosesPanel, focusKey, moveWord, requestPanel, type PanelOpen, type VersePanelKind } from "./verse-panel-state";
import { useStudyLens } from "../study-lens";
import styles from "./commentary.module.css";

/**
 * The verse panel (1.3): one open at a time on a page, for one verse, in Study only. On phones (1000px and
 * narrower) it opens in place after the verse's row; on wide screens it opens a column between the rows and
 * the tools rail. Opening moves focus to its heading; Close or Esc closes it and puts focus back on the
 * button that opened it. The verse that opened it stays where it was on screen while the text reflows.
 * Release 1.7 adds the "word" kind: in Study a tap on a word opens its card here (word-panel.tsx); Previous word and
 * Next word move it, and Esc puts focus back on the word it was last on. The pure rules are in verse-panel-state.ts.
 */
export type { VersePanelKind } from "./verse-panel-state";
type Open = PanelOpen;
type Scope = Readonly<{ open: Open | null; wide: boolean; toggle(verse: string, kind: VersePanelKind, trigger: HTMLElement): void; close(): void; closeWord(): void; stepFocus: { current: "previous" | "next" | null };
  /** Study's word tap: the word card for one word, beside its verse. Null when no text page has registered a host. */
  openWord: ((verse: string, word: number, trigger: HTMLElement | null) => void) | null; moveWord(verse: string, word: number, from?: "previous" | "next"): void;
  host: { current: WordPanelHost | null }; setHost(host: WordPanelHost | null): void }>;
const Context = createContext<Scope | null>(null);
export const WIDE_PANEL_QUERY = "(min-width: 1001px)";
const verseTop = (ref: string) => { try { return document.querySelector(`[data-verse-ref="${CSS.escape(ref)}"]`)?.getBoundingClientRect().top ?? null; } catch { return null; } };

function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    let media: MediaQueryList;
    try { media = window.matchMedia(WIDE_PANEL_QUERY); } catch { return; }
    const update = () => setWide(media.matches); update();
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Holds the page's one open panel, in Study only: Lein closes it and offers none. */
export function VersePanelScope({ children }: { children: ReactNode }) {
  const lens = useStudyLens(), active = lens.available && lens.lens === "study";
  const [open, setOpen] = useState<Open | null>(null), wide = useWide(), base = useId();
  const trigger = useRef<HTMLElement | null>(null), anchor = useRef<{ verse: string; top: number } | null>(null), restore = useRef(false);
  const reveal = useRef<string | null>(null), lastWord = useRef<{ verse: string; word: number } | null>(null);
  const remember = (verse: string) => { const top = verseTop(verse); anchor.current = top === null ? null : { verse, top }; };
  const current = useRef(open); current.current = open;
  const request = useCallback((verse: string, kind: VersePanelKind, element: HTMLElement | null, word?: number) => {
    remember(verse);
    const next = requestPanel(current.current, { verse, kind, word }, `${base}-panel`);
    restore.current = next.restoreFocus;
    if (!next.restoreFocus) trigger.current = element;
    setOpen(next.open);
  }, [base]);
  const toggle = useCallback((verse: string, kind: VersePanelKind, element: HTMLElement) => request(verse, kind, element), [request]);
  const host = useRef<WordPanelHost | null>(null), [hasWords, setHasWords] = useState(false);
  const setHost = useCallback((value: WordPanelHost | null) => { host.current = value; setHasWords(Boolean(value)); }, []);
  const openWord = useCallback((verse: string, word: number, element: HTMLElement | null) => {
    request(verse, "word", element, word); host.current?.onVisit?.(verse);
  }, [request]);
  // Previous or Next word: the card follows to the next word's verse, which is brought into view; focus stays on the button pressed.
  const stepFocus = useRef<"previous" | "next" | null>(null);
  const stepWord = useCallback((verse: string, word: number, from?: "previous" | "next") => {
    const shown = current.current, next = moveWord(shown, verse, word); if (!shown || next === shown) return;
    stepFocus.current = from ?? null; reveal.current = verse; trigger.current = null; setOpen(next); host.current?.onVisit?.(verse);
  }, []);
  const close = useCallback(() => {
    const shown = current.current; if (!shown) return;
    remember(shown.verse); restore.current = true; setOpen(null);
  }, []);
  const closeWord = useCallback(() => { if (current.current?.kind === "word") close(); }, [close]);
  useLayoutEffect(() => { if (open?.kind === "word" && open.word !== undefined) lastWord.current = { verse: open.verse, word: open.word }; }, [open]);
  // The text column narrows or widens as the panel opens or closes: keep the verse where the reader saw it.
  useLayoutEffect(() => {
    const held = anchor.current; anchor.current = null;
    if (held) { const top = verseTop(held.verse); if (top !== null && Math.abs(top - held.top) > 0.5) window.scrollBy(0, top - held.top); }
    const shown = reveal.current; reveal.current = null;
    if (shown) { try { const box = document.querySelector(`[data-verse-ref="${CSS.escape(shown)}"]`)?.getBoundingClientRect(); if (box && (box.top < 0 || box.bottom > window.innerHeight)) document.querySelector(`[data-verse-ref="${CSS.escape(shown)}"]`)?.scrollIntoView({ block: "center" }); } catch { /* Stay where the page is. */ } }
    if (!open && restore.current) {
      restore.current = false;
      // A word card's focus goes back to the word it was last on, wherever Next word took it.
      if (!trigger.current?.isConnected && lastWord.current) { try { trigger.current = document.querySelector<HTMLElement>(`[data-verse-ref="${CSS.escape(lastWord.current.verse)}"] [data-word-index="${lastWord.current.word}"][role="button"]`); } catch { trigger.current = null; } }
      if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
    }
  }, [open, wide]);
  useEffect(() => {
    if (!open) return;
    // Esc belongs to the panel only while the reader is in it (or on the button that opened it) and no modal is
    // open above the page: a modal (Up close, the reading sheet, a guide walk) closes itself, and the panel stays.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      let modal = false; try { modal = document.querySelector("dialog:modal") !== null; } catch { modal = document.querySelector("dialog[open]") !== null; }
      const panel = document.getElementById(open.id), focused = document.activeElement;
      if (!focused || !escapeClosesPanel({ key: event.key, defaultPrevented: event.defaultPrevented, modal, kind: open.kind, inPanel: Boolean(panel?.contains(focused)),
        onOpener: focused === trigger.current, onWord: focused instanceof Element && focused.closest("[data-word-index]") !== null })) return;
      event.preventDefault(); close();
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [open, close]);
  useEffect(() => { if (!active) setOpen(null); }, [active]);
  const value = useMemo<Scope>(() => ({ open: active ? open : null, wide, toggle, close, closeWord, stepFocus, openWord: hasWords ? openWord : null, moveWord: stepWord, host, setHost }),
    [active, open, wide, toggle, close, closeWord, hasWords, openWord, stepWord, setHost]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
const usePanel = () => useContext(Context);
/** The verse the open panel is on, if one is open. */
export const useOpenPanelVerse = (): string | null => usePanel()?.open?.verse ?? null;
/** Study's word tap: the card opener, or null when there is no card here (Lein, the proposed portion, a page not yet loaded). */
export const useWordCardOpener = () => usePanel()?.openWord ?? null;
/** The text page tells the panel what it needs for a word card (its verses and how to read word details); nothing renders. */
export function WordPanelSource({ host }: { host: WordPanelHost | null }) {
  const scope = usePanel(), setHost = scope?.setHost, closeWord = scope?.closeWord, key = host?.scopeKey ?? null;
  // Every render hands over fresh closures; the panel's own state changes only when a host appears or goes.
  useLayoutEffect(() => { setHost?.(host); });
  useLayoutEffect(() => () => { setHost?.(null); }, [setHost]);
  // A new text page (or a closed one) leaves no word card behind.
  useEffect(() => () => { closeWord?.(); }, [key, closeWord]);
  return null;
}

const ACTIONS: readonly { kind: VersePanelKind; label: string }[] = [{ kind: "compare", label: "Compare" }, { kind: "shelf", label: "More on this verse" }];
/** The verse's actions, under its row in Study: Compare, and More on this verse. Nothing outside a VersePanelScope. */
export function VerseActions({ verse }: { verse: string }) {
  const scope = usePanel();
  if (!scope || !parseCompareVerse(verse)) return null;
  return <div className={styles.actions}>
    {ACTIONS.map(action => { const open = scope.open?.verse === verse && scope.open.kind === action.kind;
      return <button key={action.kind} type="button" className={styles.action} aria-expanded={open} aria-controls={open ? scope.open!.id : undefined}
        onClick={event => scope.toggle(verse, action.kind, event.currentTarget)}>{action.label}</button>; })}
  </div>;
}

function Panel({ open, onClose }: { open: Open; onClose(): void }) {
  const heading = useRef<HTMLHeadingElement | null>(null), section = useRef<HTMLElement | null>(null), lens = useStudyLens(), scope = usePanel();
  const key = focusKey(open);
  useEffect(() => {
    // Previous word or Next word on a phone moves the card to another verse's row: focus goes back to the button the reader pressed.
    const stepped = scope?.stepFocus.current ?? null; if (scope) scope.stepFocus.current = null;
    const button = stepped ? section.current?.querySelector<HTMLElement>(`button[data-word-step="${stepped}"]:not([disabled])`) : null;
    (button ?? heading.current)?.focus({ preventScroll: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const word = open.kind === "word" ? scope?.host.current : null;
  return <section id={open.id} ref={section} className={styles.versePanel} aria-labelledby={`${open.id}-heading`} data-verse-panel={open.verse}>
    <div className={styles.panelHead}>
      <h3 id={`${open.id}-heading`} ref={heading} tabIndex={-1}>{open.kind === "compare" ? "Compare" : open.kind === "word" ? "Word in" : "More on"} <bdi dir="ltr">{open.verse}</bdi></h3>
      <button type="button" className={styles.panelClose} onClick={onClose}>Close</button>
    </div>
    {open.kind === "compare" ? <CompareView verse={open.verse} />
      : open.kind === "word" ? word && open.word !== undefined && scope ? <WordPanelBody key={word.scopeKey} host={word} verse={open.verse} word={open.word} onMove={scope.moveWord} onGone={onClose} /> : null
        : <ShelfView key={open.verse} verse={open.verse} inline={lens.works} />}
  </section>;
}
/** Phones: the panel in place, right after its verse's row. */
export function InlineVersePanel({ verse }: { verse: string }) {
  const scope = usePanel();
  return scope?.open && !scope.wide && scope.open.verse === verse ? <Panel open={scope.open} onClose={scope.close} /> : null;
}
/** Wide screens: the panel's own column, placed in the reading layout between the text and the tools rail. */
export function VersePanelColumn() {
  const scope = usePanel();
  return scope?.open && scope.wide ? <aside className="verse-panel-column"><Panel open={scope.open} onClose={scope.close} /></aside> : null;
}
