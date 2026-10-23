"use client";
import { useId } from "react";
import { textSizes, tikkunViews, useReadingPrefs, useSetReadingPrefs } from "./reading-prefs";
import { MAX_INLINE_WORKS, STUDY_WORKS, useStudyLens } from "./study-lens";
import { COMMENTARY_WORKS } from "../../../lib/readings/commentary";
import { icons } from "./study/lift";

/** Short names for the Works menu; the full title and edition are in each work's credit. */
export const WORK_LABELS: Readonly<Record<string, string>> = Object.freeze({ rashi: "Rashi", womens: "Women’s Commentary" });
export const workLabel = (key: string) => WORK_LABELS[key] ?? COMMENTARY_WORKS[key]?.title ?? key;

/** One toolbar drives every verse on the page through shared preferences. */
/** The Tikkun control appears only beside Torah text in Lein; a haftarah is read from a printed book, not a scroll,
 *  and Study is about meaning. In Study, Works chooses the commentaries shown under each verse (`worksCorpus`
 *  says which ones cover this text: the Women's Commentary covers the Torah only). */
export function ReadingToolbar({ onHear, listeningEnabled = false, tikkunAvailable = false, worksCorpus = "torah" }: { onHear?(): void; listeningEnabled?: boolean; tikkunAvailable?: boolean; worksCorpus?: "torah" | "neviim" } = {}) {
  const prefs = useReadingPrefs(), setReadingPrefs = useSetReadingPrefs(), lens = useStudyLens(), id = useId(), menu = `${id}-size`, tikkunMenu = `${id}-tikkun`, worksMenu = `${id}-works`;
  const size = textSizes.find(row => row.id === prefs.size)!, view = tikkunViews.find(row => row.id === prefs.tikkunView) ?? tikkunViews[0];
  const study = lens.available && lens.lens === "study";
  const covers = (work: string) => Boolean(COMMENTARY_WORKS[work]?.editions[worksCorpus]);
  const shown = lens.works.filter(covers);
  return <nav className="reading-toolbar" aria-label="Reading tools" data-lens={study ? "study" : "lein"}>
    <button type="button" className="toolbar-item" aria-pressed={prefs.colors} onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}<span>Colors</span></button>
    {/* Study keeps its own English choice, which starts on; Lein's stays as the reader left it. */}
    <button type="button" className="toolbar-item" aria-pressed={study ? lens.english : prefs.translation} onClick={() => study ? lens.setEnglish(!lens.english) : setReadingPrefs({ translation: !prefs.translation })}>{icons.translate}<span>English</span></button>
    {tikkunAvailable && !study && <>
      <button type="button" className="toolbar-item" popoverTarget={tikkunMenu} data-active={prefs.tikkunView !== "off"} aria-label={`Tikkun: ${view.label}`}>{icons.scroll}<span>Tikkun</span></button>
      <div id={tikkunMenu} popover="auto" className="toolbar-menu" role="group" aria-label="Tikkun view">
        {tikkunViews.map(row => <button type="button" key={row.id} aria-pressed={prefs.tikkunView === row.id} data-tikkun-view={row.id}
          onClick={event => { setReadingPrefs({ tikkunView: row.id }); (event.currentTarget.parentElement as HTMLElement & { hidePopover?(): void }).hidePopover?.(); }}>{row.label}</button>)}
      </div>
    </>}
    {study && <>
      <button type="button" className="toolbar-item" popoverTarget={worksMenu} aria-label={`Works: ${shown.length ? shown.map(workLabel).join(", ") : "none"}`}>{icons.works}<span>Works</span></button>
      <div id={worksMenu} popover="auto" className="toolbar-menu" role="group" aria-label="Commentaries under each verse">
        {STUDY_WORKS.map(work => {
          const on = lens.works.includes(work), full = !on && lens.works.length >= MAX_INLINE_WORKS;
          return <button type="button" key={work} aria-pressed={on} disabled={full} data-work={work}
            onClick={() => lens.setWorks(on ? lens.works.filter(row => row !== work) : [...lens.works, work])}>
            <span className="toolbar-menu-check" aria-hidden="true">{on && <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span><span className="toolbar-menu-label">{workLabel(work)}{!covers(work) && <span className="toolbar-menu-note">Torah only</span>}</span></button>;
        })}
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
