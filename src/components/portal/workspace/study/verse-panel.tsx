"use client";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseCompareVerse } from "../../../../lib/readings/compare";
import { CompareView } from "./compare-view";
import { useStudyLens } from "../study-lens";
import styles from "./commentary.module.css";

/**
 * The verse panel (1.3): one open at a time on a page, for one verse, in Study only. On phones (1000px and
 * narrower) it opens in place after the verse's row; on wide screens it opens a column between the rows and
 * the tools rail. Opening moves focus to its heading; Close or Esc closes it and puts focus back on the
 * button that opened it. The verse that opened it stays where it was on screen while the text reflows.
 */
export type VersePanelKind = "compare";
type Open = Readonly<{ verse: string; kind: VersePanelKind; id: string }>;
type Scope = Readonly<{ open: Open | null; wide: boolean; toggle(verse: string, kind: VersePanelKind, trigger: HTMLElement): void; close(): void }>;
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
  const remember = (verse: string) => { const top = verseTop(verse); anchor.current = top === null ? null : { verse, top }; };
  const current = useRef(open); current.current = open;
  const toggle = useCallback((verse: string, kind: VersePanelKind, element: HTMLElement) => {
    const shown = current.current;
    remember(verse);
    if (shown?.verse === verse && shown.kind === kind) { restore.current = true; setOpen(null); return; }
    trigger.current = element; restore.current = false;
    setOpen(Object.freeze({ verse, kind, id: `${base}-panel` }));
  }, [base]);
  const close = useCallback(() => {
    const shown = current.current; if (!shown) return;
    remember(shown.verse); restore.current = true; setOpen(null);
  }, []);
  // The text column narrows or widens as the panel opens or closes: keep the verse where the reader saw it.
  useLayoutEffect(() => {
    const held = anchor.current; anchor.current = null;
    if (held) { const top = verseTop(held.verse); if (top !== null && Math.abs(top - held.top) > 0.5) window.scrollBy(0, top - held.top); }
    if (!open && restore.current) { restore.current = false; if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }
  }, [open, wide]);
  useEffect(() => {
    if (!open) return;
    // Esc belongs to the panel only while the reader is in it (or on the button that opened it) and no modal is
    // open above the page: a modal (Up close, the reading sheet, a guide walk) closes itself, and the panel stays.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      let modal = false; try { modal = document.querySelector("dialog:modal") !== null; } catch { modal = document.querySelector("dialog[open]") !== null; }
      const panel = document.getElementById(open.id), focused = document.activeElement;
      if (modal || !focused || !(panel?.contains(focused) || focused === trigger.current)) return;
      event.preventDefault(); close();
    };
    document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key);
  }, [open, close]);
  useEffect(() => { if (!active) setOpen(null); }, [active]);
  const value = useMemo<Scope>(() => ({ open: active ? open : null, wide, toggle, close }), [active, open, wide, toggle, close]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
const usePanel = () => useContext(Context);

/** The verse's actions, under its row in Study: Compare. Nothing outside a VersePanelScope. */
export function VerseActions({ verse }: { verse: string }) {
  const scope = usePanel();
  if (!scope || !parseCompareVerse(verse)) return null;
  const open = scope.open?.verse === verse && scope.open.kind === "compare";
  return <div className={styles.actions}>
    <button type="button" className={styles.action} aria-expanded={open} aria-controls={open ? scope.open!.id : undefined}
      onClick={event => scope.toggle(verse, "compare", event.currentTarget)}>Compare</button>
  </div>;
}

function Panel({ open, onClose }: { open: Open; onClose(): void }) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [open.verse, open.kind]);
  return <section id={open.id} className={styles.versePanel} aria-labelledby={`${open.id}-heading`} data-verse-panel={open.verse}>
    <div className={styles.panelHead}>
      <h3 id={`${open.id}-heading`} ref={heading} tabIndex={-1}>Compare <bdi dir="ltr">{open.verse}</bdi></h3>
      <button type="button" className={styles.panelClose} onClick={onClose}>Close</button>
    </div>
    {open.kind === "compare" && <CompareView verse={open.verse} />}
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
