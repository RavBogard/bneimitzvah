"use client";
import { useId } from "react";
import { textSizes, useReadingPrefs, useSetReadingPrefs } from "./reading-prefs";
import { icons } from "./study/lift";

/** One toolbar drives every verse on the page through shared preferences. */
/** The Tikkun control appears only beside Torah text; a haftarah is read from a printed book, not a scroll. */
export function ReadingToolbar({ onHear, listeningEnabled = false, tikkunAvailable = false }: { onHear?(): void; listeningEnabled?: boolean; tikkunAvailable?: boolean } = {}) {
  const prefs = useReadingPrefs(), setReadingPrefs = useSetReadingPrefs(), id = useId(), menu = `${id}-size`;
  const size = textSizes.find(row => row.id === prefs.size)!;
  return <nav className="reading-toolbar" aria-label="Reading tools">
    <button type="button" className="toolbar-item" aria-pressed={prefs.colors} onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}<span>Colors</span></button>
    <button type="button" className="toolbar-item" aria-pressed={prefs.translation} onClick={() => setReadingPrefs({ translation: !prefs.translation })}>{icons.translate}<span>English</span></button>
    {tikkunAvailable && <button type="button" className="toolbar-item" aria-pressed={prefs.tikkun} onClick={() => setReadingPrefs({ tikkun: !prefs.tikkun })}>{icons.scroll}<span>Tikkun</span></button>}
    <button type="button" className="toolbar-item" popoverTarget={menu} aria-label={`Text size: ${size.label}`}>{icons.size}<span>{size.label}</span></button>
    <div id={menu} popover="auto" className="toolbar-menu" role="group" aria-label="Hebrew text size">
      {textSizes.map(row => <button type="button" key={row.id} aria-pressed={prefs.size === row.id} data-size={row.id}
        onClick={event => { setReadingPrefs({ size: row.id }); (event.currentTarget.parentElement as HTMLElement & { hidePopover?(): void }).hidePopover?.(); }}>
        <span className="toolbar-menu-sample" lang="he" dir="rtl" aria-hidden="true">אָ</span>{row.label}</button>)}
    </div>
    {listeningEnabled && <button type="button" className="toolbar-item" disabled={!onHear} onClick={onHear}>{icons.hear}<span>Hear verse</span></button>}
  </nav>;
}
