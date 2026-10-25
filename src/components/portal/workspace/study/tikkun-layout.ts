"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { breakRows, fitScale, sameRows, type AtomWidths } from "../../../../lib/hebrew/tikkun-lines";
import type { StudyAtom } from "../../../../lib/hebrew/tikkun-atoms";

/** `rows` is null until the verse has been measured: both columns then show their atoms in one wrapping line, as before. */
export type TikkunLayout = { rows: readonly (readonly [number, number])[] | null; scale: number };
const UNMEASURED: TikkunLayout = { rows: null, scale: 1 };

const px = (value: string) => { const number = parseFloat(value); return Number.isFinite(number) ? number : 0; };
function contentWidth(element: Element) {
  const style = getComputedStyle(element);
  return (element as HTMLElement).clientWidth - px(style.paddingLeft) - px(style.paddingRight);
}

/**
 * One set of line breaks for a verse's two tikkun columns. Both columns render their atoms (`data-tk-atom`)
 * inside `data-tk-side` containers; this measures every atom in each, and the width of each column, then
 * breaks the verse into rows that fit the narrower column. It runs before paint, again whenever the verse
 * resizes, when a font finishes loading and when the text size or Colors changes, so the rows never shift
 * after the reader has seen them. A word wider than a column shrinks the verse's type just enough to fit.
 */
export function useTikkunLayout(host: RefObject<HTMLElement | null>, atoms: readonly StudyAtom[] | null, remeasureKey: string) {
  const [layout, setLayout] = useState<TikkunLayout>(UNMEASURED);
  const applied = useRef<TikkunLayout>(UNMEASURED);
  applied.current = layout;
  // Measuring after a change of rows is a check, not a loop: type does not scale perfectly linearly (hinting), so a
  // second look may nudge the scale, but only a few looks are allowed before the layout is taken as it is.
  const passes = useRef(0);
  const active = atoms !== null && atoms.length > 0;

  const measure = useCallback((flush: boolean) => {
    const root = host.current;
    if (!root || !atoms || !atoms.length) return;
    const pointed = root.querySelectorAll<HTMLElement>('[data-tk-side="pointed"] [data-tk-atom]'), tikkun = root.querySelectorAll<HTMLElement>('[data-tk-side="tikkun"] [data-tk-atom]');
    const pointedHost = root.querySelector<HTMLElement>('[data-tk-side="pointed"]'), tikkunHost = root.querySelector<HTMLElement>('[data-tk-side="tikkun"]');
    const pointedLine = pointedHost?.querySelector<HTMLElement>("[data-tk-line]"), tikkunLine = tikkunHost?.querySelector<HTMLElement>("[data-tk-line]");
    if (!pointedHost || !tikkunHost || !pointedLine || !tikkunLine || pointed.length !== atoms.length || tikkun.length !== atoms.length) return;
    const columnPointed = contentWidth(pointedHost), columnTikkun = contentWidth(tikkunHost);
    // Not laid out (hidden, or no layout engine): leave the verse as it is.
    if (!(columnPointed > 0) || !(columnTikkun > 0)) return;
    const scale = applied.current.scale || 1;
    const widths: AtomWidths[] = atoms.map((atom, index) => ({
      pointed: pointed[index].getBoundingClientRect().width / scale, tikkun: tikkun[index].getBoundingClientRect().width / scale,
      joined: atom.joined, word: atom.words[0] ?? null,
    }));
    const fit = fitScale(widths, { pointed: columnPointed, tikkun: columnTikkun, pointedGap: 0, tikkunGap: 0 });
    const pointedGap = px(getComputedStyle(pointedLine).columnGap) / scale * fit, tikkunGap = px(getComputedStyle(tikkunLine).columnGap) / scale * fit;
    const rows = breakRows(widths.map(width => ({ ...width, pointed: width.pointed * fit, tikkun: width.tikkun * fit })), { pointed: columnPointed, tikkun: columnTikkun, pointedGap, tikkunGap });
    const current = applied.current;
    if (current.scale === fit && sameRows(current.rows, rows)) return;
    const next = { rows, scale: fit };
    if (flush) flushSync(() => setLayout(next)); else setLayout(next);
  }, [host, atoms]);

  // The rows and type scale reach the CSS as custom properties on the verse, set before paint and before each measure.
  useLayoutEffect(() => {
    const root = host.current;
    if (!root || !active) return;
    root.style.setProperty("--tk-lines", String(layout.rows?.length ?? 1)); root.style.setProperty("--tk-fit", String(layout.scale));
    return () => { root.style.removeProperty("--tk-lines"); root.style.removeProperty("--tk-fit"); };
  }, [host, active, layout]);

  // Before paint: the first render shows every atom in one line so there is something to measure; this swaps in the rows.
  useLayoutEffect(() => { if (active) { passes.current = 0; measure(false); } }, [active, measure, remeasureKey]);
  useLayoutEffect(() => { if (active && passes.current < 4) { passes.current++; measure(false); } }, [active, measure, layout]);

  useEffect(() => {
    const root = host.current;
    if (!active || !root) return;
    const again = () => { passes.current = 0; measure(true); };
    // Only a change of width matters (the rows change the height, which must not set the measuring off again).
    let width = -1;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      const next = entries[entries.length - 1]?.contentRect.width ?? width;
      if (next !== width) { const first = width < 0; width = next; if (!first) again(); }
    });
    observer?.observe(root);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener?.("loadingdone", again);
    void fonts?.ready?.then(again);
    return () => { observer?.disconnect(); fonts?.removeEventListener?.("loadingdone", again); };
  }, [active, host, measure]);

  return active ? layout : UNMEASURED;
}
