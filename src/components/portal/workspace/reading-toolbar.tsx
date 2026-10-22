"use client";
import { useId } from "react";
import { textSizes, tikkunViews, useReadingPrefs, useSetReadingPrefs } from "./reading-prefs";
import { icons } from "./study/lift";

/** One toolbar drives every verse on the page through shared preferences. */
/** The Tikkun control appears only beside Torah text; a haftarah is read from a printed book, not a scroll. */
export function ReadingToolbar({ onHear, listeningEnabled = false, tikkunAvailable = false }: { onHear?(): void; listeningEnabled?: boolean; tikkunAvailable?: boolean } = {}) {
  const prefs = useReadingPrefs(), setReadingPrefs = useSetReadingPrefs(), id = useId(), menu = `${id}-size`, tikkunMenu = `${id}-tikkun`;
  const size = textSizes.find(row => row.id === prefs.size)!, view = tikkunViews.find(row => row.id === prefs.tikkunView) ?? tikkunViews[0];
  return <nav className="reading-toolbar" aria-label="Reading tools">
    <button type="button" className="toolbar-item" aria-pressed={prefs.colors} onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}<span>Colors</span></button>
    <button type="button" className="toolbar-item" aria-pressed={prefs.translation} onClick={() => setReadingPrefs({ translation: !prefs.translation })}>{icons.translate}<span>English</span></button>
    {tikkunAvailable && <>
      <button type="button" className="toolbar-item" popoverTarget={tikkunMenu} aria-pressed={prefs.tikkunView !== "off"} aria-label={`Tikkun: ${view.label}`}>{icons.scroll}<span>Tikkun</span></button>
      <div id={tikkunMenu} popover="auto" className="toolbar-menu" role="group" aria-label="Tikkun view">
        {tikkunViews.map(row => <button type="button" key={row.id} aria-pressed={prefs.tikkunView === row.id} data-tikkun-view={row.id}
          onClick={event => { setReadingPrefs({ tikkunView: row.id }); (event.currentTarget.parentElement as HTMLElement & { hidePopover?(): void }).hidePopover?.(); }}>{row.label}</button>)}
      </div>
    </>}
    <button type="button" className="toolbar-item" popoverTarget={menu} aria-label={`Text size: ${size.label}`}>{icons.size}<span>{size.label}</span></button>
    <div id={menu} popover="auto" className="toolbar-menu" role="group" aria-label="Hebrew text size">
      {textSizes.map(row => <button type="button" key={row.id} aria-pressed={prefs.size === row.id} data-size={row.id}
        onClick={event => { setReadingPrefs({ size: row.id }); (event.currentTarget.parentElement as HTMLElement & { hidePopover?(): void }).hidePopover?.(); }}>
        <span className="toolbar-menu-sample" lang="he" dir="rtl" aria-hidden="true">אָ</span>{row.label}</button>)}
    </div>
    {listeningEnabled && <button type="button" className="toolbar-item" disabled={!onHear} onClick={onHear}>{icons.hear}<span>Hear verse</span></button>}
  </nav>;
}
