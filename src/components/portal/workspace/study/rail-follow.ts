"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The notes column follows the text (Study v6, Daniel 2026-10-28). Exactly one verse is open: the first verse with entries at or after the first row
 * whose bottom passes a reading line at 33% of the viewport height, and the open one is kept while its own verse is still on screen above that line.
 * The column then glides to the open card (an eased requestAnimationFrame scroll, about 700 ms, ease-out quart); hand-scrolling the column pauses following
 * for about 1.8 s; choosing a folded line opens it and smooth-scrolls the text to its verse. With prefers-reduced-motion nothing animates.
 */
export const FOLLOW = Object.freeze({ line: 0.33, glideMs: 700, handPauseMs: 1800, clickPauseMs: 2500, holdMs: 1500, gap: 6, lead: 8 });

/** Pure: which entry is open. `rows` are the page's verses in order, each with its bottom and top edge in the viewport; `entries` the refs with notes, in order. */
export function chooseOpen(rows: readonly Readonly<{ ref: string; top: number; bottom: number }>[], entries: readonly string[], current: string | null, viewport: number): string | null {
  if (!entries.length) return null;
  const line = viewport * FOLLOW.line, position = new Map(rows.map((row, index) => [row.ref, index]));
  const at = rows.findIndex(row => row.bottom > line);
  if (at < 0) return current && entries.includes(current) ? current : entries[entries.length - 1];
  const target = entries.find(ref => (position.get(ref) ?? -1) >= at) ?? entries[entries.length - 1];
  if (current && entries.includes(current)) {
    const row = rows[position.get(current) ?? -1];
    if (row && row.bottom > 80 && row.top < line && (position.get(current) ?? 0) <= at) return current;
  }
  return target;
}
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOutQuart = (x: number) => 1 - Math.pow(1 - x, 4);

export function useRailFollow({ entries, enabled, rows, rail }: { entries: readonly string[]; enabled: boolean; rows: RefObject<HTMLElement | null>; rail: RefObject<HTMLElement | null> }) {
  const [current, setCurrent] = useState<string | null>(entries[0] ?? null);
  const now = useRef<string | null>(current), pause = useRef(0), hold = useRef(0), frame = useRef(0), list = useRef(entries); list.current = entries;
  const glide = useCallback((to: number) => {
    const node = rail.current; if (!node) return;
    cancelAnimationFrame(frame.current);
    if (reduced()) { node.scrollTop = to; return; }
    const from = node.scrollTop, distance = to - from, start = performance.now();
    const step = (time: number) => { const p = Math.min(1, (time - start) / FOLLOW.glideMs); node.scrollTop = from + distance * easeOutQuart(p); if (p < 1) frame.current = requestAnimationFrame(step); };
    frame.current = requestAnimationFrame(step);
  }, [rail]);
  /** Where the card's top will be once the cards before it are folded: the folded heads' heights, measured. */
  const aim = useCallback((ref: string) => {
    const node = rail.current; if (!node) return 0;
    let y = 0;
    for (const head of node.querySelectorAll<HTMLElement>("[data-rail-head]")) { if (head.dataset.railHead === ref) break; y += head.offsetHeight + FOLLOW.gap; }
    return Math.max(0, y - FOLLOW.lead);
  }, [rail]);
  const set = useCallback((ref: string | null, move: boolean) => {
    if (ref === now.current) return;
    now.current = ref; setCurrent(ref);
    if (move && ref && Date.now() > pause.current) glide(aim(ref));
  }, [aim, glide]);
  const sync = useCallback(() => {
    const root = rows.current; if (!root || !list.current.length || Date.now() < hold.current) return;
    const rects = [...root.querySelectorAll<HTMLElement>("[data-verse-ref]")].map(element => { const box = element.getBoundingClientRect(); return { ref: element.dataset.verseRef!, top: box.top, bottom: box.bottom }; });
    const next = chooseOpen(rects, list.current, now.current, window.innerHeight);
    if (next !== null) set(next, true);
  }, [rows, set]);
  // A new page of entries: keep the open one if it is still there, else follow the text again.
  useLayoutEffect(() => {
    if (!enabled) return;
    if (!entries.length) { now.current = null; setCurrent(null); return; }
    if (!now.current || !entries.includes(now.current)) { now.current = entries[0]; setCurrent(entries[0]); }
    sync();
  }, [entries, enabled, sync]);
  useEffect(() => {
    if (!enabled) return;
    let tick = false;
    const onScroll = () => { if (tick) return; tick = true; requestAnimationFrame(() => { tick = false; sync(); }); };
    window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", onScroll);
    const node = rail.current, hand = () => { pause.current = Date.now() + FOLLOW.handPauseMs; };
    node?.addEventListener("wheel", hand, { passive: true }); node?.addEventListener("touchmove", hand, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); node?.removeEventListener("wheel", hand); node?.removeEventListener("touchmove", hand); cancelAnimationFrame(frame.current); };
  }, [enabled, rail, sync]);
  /** A folded line chosen: it opens, the column settles on it and the text scrolls to its verse. */
  const choose = useCallback((ref: string) => {
    pause.current = Date.now() + FOLLOW.clickPauseMs; hold.current = Date.now() + FOLLOW.holdMs; set(ref, false); glide(aim(ref));
    const row = rows.current?.querySelector<HTMLElement>(`[data-verse-ref="${CSS.escape(ref)}"]`);
    row?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
  }, [aim, glide, rows, set]);
  return { current, choose };
}
