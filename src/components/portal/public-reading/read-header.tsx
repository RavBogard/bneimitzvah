"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Sheet } from "../../ui";
import { FindReading } from "../find-reading/find-reading";
import { useStudyLens } from "../workspace/study-lens";
import { goToReading } from "./heading-focus";
import { ReaderTitle, type Pill } from "./reader-title";
import styles from "./public-reading.module.css";

/**
 * The "Change" sheet of the public reader (Readings for everyone B6, C1; the 1.9 N5 More sheet, regrouped). Its title is "Change reading":
 * Find a reading first (a parashah, a holiday, a date or verses, and the Coming up chips), then what is in this reading (the Portion
 * control, Choose verses and Go to verse). Start reading, Print, the Trope chart and the siddur blessings are in the reading itself and
 * at its foot, and Save is its own sheet. The page and the passage it holds are two components apart, so the Sheet has a host: the
 * page's scope keeps whether it is open and a slot inside it where the passage puts its controls with a portal.
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

/**
 * The reader's title block with the Change sheet (Readings for everyone C1). `pills` are the actions after Change (Save, or Edit on a saved
 * reading). The sheet holds Find a reading, then "In this reading": the passage's own Portion row, Choose verses and Go to verse, put in
 * its slot by the passage. With no scope above it (the page is still finding its address) Change is drawn inert.
 */
export function ReadHeader({ name, line, pills = [], note, loading, rest }: { name: string; line: ReactNode; pills?: readonly Pill[]; note?: ReactNode; loading?: boolean; rest?: ReactNode }) {
  const host = useMore(), lens = useStudyLens();
  const change: Pill = { key: "change", label: "Change", icon: "chevron", haspopup: "dialog", disabled: !host, onClick: () => host?.show() };
  return <header className={styles.readHeader}>
    <ReaderTitle name={name} line={line} pills={[change, ...pills]} loading={loading} note={note} />
    {host && <Sheet open={host.open} onClose={() => host.close()} title="Change reading" closeLabel="Close">
      <div className={styles.moreList} data-more-sheet="">
        {/* Mounted only while the sheet is open, so the calendar is asked for when someone wants it. The sheet closes first, then the reading opens. */}
        {host.open && <FindReading place="sheet" study={lens.lens === "study"} onOpen={address => host.close(() => goToReading(address))} />}
        <h3 className={styles.changeGroup}>In this reading</h3>
        <div ref={host.setSlot} className={styles.moreList} data-more-slot="" />
        {rest}
      </div>
    </Sheet>}
  </header>;
}
