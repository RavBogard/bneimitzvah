"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { VerseChoiceView } from "../workspace/study/verse-choice";
import { countLine, countSelected, fitsGroups, selectionFromRanges, selectionLine, selectionRanges, tapVerse, SELECTION_MAX_GROUPS } from "../../../lib/readings/verse-selection";
import { printAddress } from "../../../lib/print/print-address";
import { useMore } from "./read-header";
import styles from "./choose-verses.module.css";

/** The words of Choose verses. "Choose verses", "Change verses" and "Whole portion" are the approved plan's; the rest are the plainest literal labels. */
export const CHOOSE_STRINGS = Object.freeze({
  choose: "Choose verses",
  change: "Change verses",
  wholePortion: "Whole portion",
  backToSelection: "Back to selection",
  range: "Select range",
  clear: "Clear",
  cancel: "Cancel",
  done: "Done",
  save: "Save",
  none: "No verses chosen",
  /** The bar before anything is chosen (Daniel, 2026-10-24, "Keep all"). */
  hint: "Tap verse numbers to choose them.",
  tooMany: `A reading can hold at most ${SELECTION_MAX_GROUPS} separate groups of verses.`,
  rangeFrom: "Choose the last verse of the range.",
});

/** What a page tells the reader about choosing: how it starts, what Save does, and the links that go with it. */
export type ChoosePlan = Readonly<{
  /** The button's label: "Choose verses" for a new selection, "Change verses" on a saved reading. */
  label: typeof CHOOSE_STRINGS.choose | typeof CHOOSE_STRINGS.change;
  /** Groups chosen when the mode opens ("; "-split ranges); empty for a new selection. */
  start: readonly string[];
  /** Groups marked in the text while not choosing (a whole portion showing its selection). */
  marked?: readonly string[];
  /** Open already choosing (the saved reading's Change verses, once its whole portion is on screen). */
  autoStart?: boolean;
  /** The page takes the button itself (it must first show the whole portion); choosing starts when it comes back with autoStart. */
  onBegin?(): void;
  /** Choosing ended without a save (Cancel). */
  onClose?(): void;
  /** What Save is: the existing save flow for a new reading, the confirm for a revision. `saved` tells the bar to say Done. */
  save(selection: ChosenSelection, saved: () => void): ReactNode;
  /** Whole portion, Back to selection: shown beside the button, never while choosing (they leave the page). */
  extra?: ReactNode;
  /** Told when choosing starts and ends, so the page can put away its own Save of the whole passage while the bar's Save is the one. */
  onChoosing?(choosing: boolean): void;
  /** Hands the page the way to start choosing (null while choosing), for the Save sheet's Choose verses row. */
  register?(begin: (() => void) | null): void;
  /** The verse the reader is on, as it changes, so a whole portion (or the way back) opens at the same place. */
  onPlace?(ref: string | null): void;
}>;
export type ChosenSelection = Readonly<{ kind: "torah" | "haftarah"; ranges: readonly string[]; count: number; line: string }>;

/**
 * The selection state of one passage on screen. `order` is the passage's verses in its own order. Choosing is a mode:
 * entered by the button, left by Cancel (or Done after a save); while it lasts the text's verse numbers toggle.
 */
export function useVerseChoice(plan: ChoosePlan | undefined, order: readonly string[], kind: "torah" | "haftarah") {
  const [choosing, setChoosing] = useState(Boolean(plan?.autoStart));
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => plan?.autoStart ? selectionFromRanges(plan.start, kind) ?? new Set() : new Set());
  const [anchor, setAnchor] = useState<string | null>(null), [rangeMode, setRangeMode] = useState(false), [note, setNote] = useState(""), [saved, setSaved] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null), bar = useRef<HTMLElement | null>(null), restore = useRef(false), entered = useRef(false), more = useMore();
  const markedKey = plan?.marked?.join("; ") ?? "";
  const marked = useMemo(() => plan?.marked?.length ? selectionFromRanges(plan.marked, kind) ?? new Set<string>() : new Set<string>(), [markedKey, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranges = useMemo(() => selectionRanges(order, selected), [order, selected]);
  const count = countSelected(order, selected);
  const change = (next: ReadonlySet<string>) => { setSelected(next); setSaved(false); };
  const onToggle = useCallback((ref: string, shift: boolean) => {
    setNote("");
    // A second tap after one verse makes the range (F4); Shift and Select range extend from the last verse tapped.
    const next = tapVerse(order, selected, anchor, ref, { shift, rangeMode });
    if (!fitsGroups(order, next)) { setNote(CHOOSE_STRINGS.tooMany); return; }
    change(next); setAnchor(ref); setRangeMode(false);
  }, [order, selected, anchor, rangeMode]);

  const begin = () => {
    if (!plan) return;
    if (plan.onBegin) { plan.onBegin(); return; }
    change(selectionFromRanges(plan.start, kind) ?? new Set()); setAnchor(null); setRangeMode(false); setNote(""); setChoosing(true);
  };
  const registered = useRef(plan?.register); registered.current = plan?.register;
  useEffect(() => { registered.current?.(plan && !choosing ? begin : null); });
  useEffect(() => () => registered.current?.(null), []);
  const leave = () => { restore.current = true; setChoosing(false); setRangeMode(false); setNote(""); plan?.onClose?.(); };
  useEffect(() => { if (choosing && !entered.current) { entered.current = true; bar.current?.focus({ preventScroll: true }); } if (!choosing) entered.current = false; }, [choosing]);
  // Back to the button that began it; with a More sheet that button is inside the closed sheet, so More itself takes the focus.
  useEffect(() => {
    if (choosing || !restore.current) return;
    restore.current = false;
    const back = opener.current?.isConnected && opener.current.getClientRects().length > 0 ? opener.current : document.querySelector<HTMLElement>("[data-more-button]") ?? opener.current;
    back?.focus();
  });

  const told = useRef(plan?.onChoosing); told.current = plan?.onChoosing;
  useEffect(() => { told.current?.(choosing); return () => told.current?.(false); }, [choosing]);
  const view: VerseChoiceView | undefined = plan ? { choosing, selected, marked, onToggle } : undefined;
  // In the More sheet the sheet closes first, so the bar that opens is the one that takes focus.
  const button = plan && !choosing ? <button type="button" ref={opener} className="button-secondary" onClick={() => more && !plan.onBegin ? more.close(begin) : begin()}>{plan.label}</button> : null;
  const live = rangeMode && anchor !== null ? `${countLine(count, ranges)}. ${CHOOSE_STRINGS.rangeFrom}` : count < 1 ? CHOOSE_STRINGS.hint : countLine(count, ranges);
  const barView = plan && choosing ? <ChooseBar barRef={bar} label={plan.label} line={live} note={note} rangeMode={rangeMode} canRange={anchor !== null} empty={count < 1} count={count} saved={saved}
    onRange={() => setRangeMode(value => !value)} onClear={() => { change(new Set()); setAnchor(null); setRangeMode(false); setNote(""); }} onCancel={leave}
    save={count > 0 ? plan.save({ kind, ranges, count, line: selectionLine(ranges) }, () => setSaved(true)) : null}
    print={count > 0 ? printAddress({ mode: "ref", ref: ranges.join("; "), kind }) : null} /> : null;
  return { view, button, extra: plan && !choosing ? plan.extra : null, bar: barView, choosing };
}

/** A link between a selection and its whole portion. It opens at the verse the reader is on: `href(place)` is the address with that verse, `base` the one without (new tab, copied link). */
export function PlaceLink({ base, href, place, children }: { base: string; href(place: string | null): string; place: { current: string | null }; children: ReactNode }) {
  return <a className="button-secondary" href={base} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try { window.location.assign(href(place.current)); } catch { /* Stay. */ }
  }}>{children}</a>;
}

/** The bar that stays in view while choosing: the live count and references, range, clear, save and cancel. */
function ChooseBar({ barRef, label, line, note, rangeMode, canRange, empty, count, saved, onRange, onClear, onCancel, save, print }: {
  barRef: { current: HTMLElement | null }; label: string; line: string; note: string; rangeMode: boolean; canRange: boolean; empty: boolean; count: number; saved: boolean;
  onRange(): void; onClear(): void; onCancel(): void; save: ReactNode;
  /** The print sheet of exactly the chosen verses (F4): /print names them by ref, so it prints those verses and nothing else. */
  print: string | null;
}) {
  const id = useId();
  return <section ref={barRef} tabIndex={-1} className={styles.bar} aria-labelledby={`${id}-name`} data-choose-bar="" data-choose-count={count}>
    <h2 id={`${id}-name`} className={styles.name}>{label}</h2>
    <p className={styles.line} role="status" aria-live="polite" aria-atomic="true" data-choose-line=""><bdi dir="ltr">{line}</bdi></p>
    {note && <p className={styles.note} role="alert">{note}</p>}
    <div className={styles.actions}>
      <button type="button" className="button-secondary" aria-pressed={rangeMode} disabled={!canRange} onClick={onRange}>{CHOOSE_STRINGS.range}</button>
      <button type="button" className="button-secondary" disabled={empty} onClick={onClear}>{CHOOSE_STRINGS.clear}</button>
      {save}
      {print && <a className="button-secondary" href={print} data-choose-print="">Print</a>}
      <button type="button" className="button-secondary" onClick={onCancel}>{saved ? CHOOSE_STRINGS.done : CHOOSE_STRINGS.cancel}</button>
    </div>
  </section>;
}
