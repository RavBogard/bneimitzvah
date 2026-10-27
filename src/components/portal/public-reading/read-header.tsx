"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sheet } from "../../ui";
import { FindReading } from "../find-reading/find-reading";
import { useStudyLens } from "../workspace/study-lens";
import { goToReading } from "./heading-focus";
import styles from "./public-reading.module.css";

/**
 * The "Change" sheet of the public reader (Readings for everyone B6; the 1.9 N5 More sheet, regrouped). Its title is "Change reading":
 * Find a reading first (a parashah, a holiday, a date or verses, and the Coming up chips), then what is in this reading (the Portion
 * control, Choose verses and Go to verse), then the actions that have not yet moved to the page's foot and pill (Start reading, Print,
 * Save, the Trope chart and the siddur blessings: Area C moves them). The page and the passage it holds are two components apart, so
 * the Sheet has a host: the page's scope keeps whether it is open and a slot inside it where the passage (which owns Choose verses, the
 * Portion control and Go to verse) puts its controls with a portal.
 */
export type MoreHost = Readonly<{
  open: boolean;
  show(): void;
  /** Closes the Sheet, then runs `then` once focus has gone back to the button that opened it, so an action that moves focus (Start reading, Choose verses) is the one that keeps it. */
  close(then?: () => void): void;
  slot: HTMLElement | null;
  setSlot(node: HTMLElement | null): void;
}>;
const Context = createContext<MoreHost | null>(null);
/** The page's More sheet, or null on a page that has none (a member's saved reading keeps its own header). */
export const useMore = () => useContext(Context);

export function MoreScope({ initiallyOpen = false, children }: { initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen), [slot, setSlot] = useState<HTMLElement | null>(null), after = useRef<(() => void) | null>(null);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback((then?: () => void) => { after.current = then ?? null; setOpen(false); }, []);
  // Effects run after the Sheet's own cleanup has given focus back, so what the action asks for is the last word.
  useEffect(() => { if (open) return; const run = after.current; after.current = null; run?.(); }, [open]);
  const value = useMemo<MoreHost>(() => ({ open, show, close, slot, setSlot }), [open, show, close, slot]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

type Step = Readonly<{ label: string; disabled?: boolean; onClick(): void }>;
const chevron = (direction: "previous" | "next") => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
  <path d={direction === "previous" ? "M14.5 6l-6 6 6 6" : "M9.5 6l6 6-6 6"} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/**
 * The two-line header: the eyebrow (what and when), then the name at title size with the week arrows and Change. `top` and `rest` are the
 * Sheet's contents before and after the passage's own controls, under "In this reading". With no scope above it (the page is still finding its address) Change is drawn inert.
 */
export function ReadHeader({ eyebrow, title, previous, next, top, rest }: { eyebrow: ReactNode; title: string; previous?: Step; next?: Step; top?: ReactNode; rest?: ReactNode }) {
  const host = useMore(), lens = useStudyLens();
  return <header className={styles.readHeader}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <div className={styles.titleRow}>
      <h1 id="public-reading-title" className={styles.readTitle} tabIndex={-1}>{title}</h1>
      <div className={styles.tools}>
        {previous && <button type="button" className={styles.arrow} aria-label={previous.label} disabled={previous.disabled} onClick={previous.onClick}>{chevron("previous")}</button>}
        {next && <button type="button" className={styles.arrow} aria-label={next.label} disabled={next.disabled} onClick={next.onClick}>{chevron("next")}</button>}
        <button type="button" className={`button-hero-secondary ${styles.moreButton}`} data-more-button="" aria-haspopup="dialog" disabled={!host} onClick={() => host?.show()}>Change<svg className={styles.changeChevron} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
      </div>
    </div>
    {host && <Sheet open={host.open} onClose={() => host.close()} title="Change reading" closeLabel="Close">
      <div className={styles.moreList} data-more-sheet="">
        {/* Mounted only while the sheet is open, so the calendar is asked for when someone wants it. The sheet closes first, then the reading opens. */}
        {host.open && <FindReading place="sheet" study={lens.lens === "study"} onOpen={address => host.close(() => goToReading(address))} />}
        <h3 className={styles.changeGroup}>In this reading</h3>
        {top}
        <div ref={host.setSlot} className={styles.moreList} data-more-slot="" />
        {rest}
      </div>
    </Sheet>}
  </header>;
}
