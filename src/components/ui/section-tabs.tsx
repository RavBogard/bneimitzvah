"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { cx } from "./cx";
import styles from "./ui.module.css";

export type SectionTab = { id: string; label: string };
export type SectionTabsProps = {
  /** What the tabs choose, for assistive technology ("Reading sections"): required, because the tabs alone do not say. */
  label: string;
  tabs: ReadonlyArray<SectionTab>;
  /** The open tab, or null when the page shows none of them (every tab is then reachable, none is selected). */
  current: string | null;
  onSelect: (id: string) => void;
  /** The panel the open tab names. A single panel whose content changes with the tab, so one id serves every tab. */
  panelId?: string;
  /** Keeps the row in view at the top while the passage scrolls beneath it. */
  sticky?: boolean;
  className?: string;
};

/**
 * The section chip row (1.9 N3): aliyot 1 to 7 and the maftir, or a tutor's sections, with the workspace's "Service parts" last.
 * A tablist of pills that scrolls sideways where they do not fit. One tab stop: arrow keys, Home and End move among the tabs and
 * open the one they land on; the open tab is scrolled into view inside the row, never the page.
 */
export function SectionTabs({ label, tabs, current, onSelect, panelId, sticky = false, className }: SectionTabsProps) {
  const row = useRef<HTMLDivElement>(null), stop = tabs.some(tab => tab.id === current) ? current : tabs[0]?.id;
  // Bring the open tab into view inside the row only; the page is never scrolled by this.
  useEffect(() => {
    const box = row.current, tab = box?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    const left = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2;
    try { box.scrollTo({ left, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } catch { box.scrollLeft = left; }
  }, [current]);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex(tab => tab.id === stop), flip = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    const next = event.key === "ArrowRight" ? index + flip : event.key === "ArrowLeft" ? index - flip : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    onSelect(target.id);
    row.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(target.id)}"]`)?.focus();
  };
  return <div className={cx(styles.tabsBar, sticky && styles.tabsSticky, className)} data-section-tabs="">
    <div ref={row} role="tablist" aria-label={label} className={styles.tabs} onKeyDown={keys}>
      {tabs.map(tab => <button key={tab.id} type="button" role="tab" data-tab-id={tab.id} aria-selected={tab.id === current} aria-controls={panelId} tabIndex={tab.id === stop ? 0 : -1}
        className={styles.tab} onClick={() => onSelect(tab.id)}>{tab.label}</button>)}
    </div>
  </div>;
}
