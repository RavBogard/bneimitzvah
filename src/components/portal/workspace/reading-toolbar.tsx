"use client";
import { useId, useLayoutEffect, useRef } from "react";
import { useKeyboardOpen } from "../shell/tab-bar";
import { textSizes, tikkunViews, useReadingPrefs, useSetReadingPrefs } from "./reading-prefs";
import { MAX_INLINE_WORKS, STUDY_WORKS, useStudyLens } from "./study-lens";
import { COMMENTARY_WORKS } from "../../../lib/readings/commentary";
import { icons } from "./study/lift";

/** Short names for the Works menu; the full title and edition are in each work's credit. */
export const WORK_LABELS: Readonly<Record<string, string>> = Object.freeze({ rashi: "Rashi", womens: "Women’s Commentary", ramban: "Ramban", "ibn-ezra": "Ibn Ezra",
  sforno: "Sforno", rashbam: "Rashbam", "or-hachaim": "Or HaChaim", "kli-yakar": "Kli Yakar", chizkuni: "Chizkuni", radak: "Radak", "metzudat-david": "Metzudat David" });
export const workLabel = (key: string) => WORK_LABELS[key] ?? COMMENTARY_WORKS[key]?.title ?? key;
/** "Torah only" or "Prophets only" for a work that covers one of the two; null for one that covers both. */
export function workCoverageNote(key: string): "Torah only" | "Prophets only" | null {
  const editions = COMMENTARY_WORKS[key]?.editions;
  return editions?.torah && !editions.neviim ? "Torah only" : editions?.neviim && !editions.torah ? "Prophets only" : null;
}

/** One toolbar drives every verse on the page through shared preferences. On a phone it is the tool dock (1.9 N4): fixed in the thumb zone above the tab bar, hidden only
 *  while the on-screen keyboard is open, and measured so the passage keeps matching padding below it (globals.css, --dock-h). On a wide screen it is the rail beside the text. */
/** The Tikkun control appears only beside Torah text in Lein; a haftarah is read from a printed book, not a scroll,
 *  and Study is about meaning. In Study, Commentaries chooses the commentaries shown under each verse (`worksCorpus`
 *  says which ones cover this text: the Women's Commentary covers the Torah only). */
export function ReadingToolbar({ onHear, listeningEnabled = false, tikkunAvailable = false, worksCorpus = "torah", englishHidden = false, practice }: { onHear?(): void; listeningEnabled?: boolean; tikkunAvailable?: boolean; worksCorpus?: "torah" | "neviim";
  /** The translate drill is hiding the English: the button then reads not pressed and says why it does nothing, and the reader's own choice is kept. */
  englishHidden?: boolean;
  /** The student's practice bar (Hebrew first): Up close first, Listen always present, and Colors, English, Tikkun and size together under Text.
   *  While listening is not released, Listen is a disabled control whose tap only shows `listenReason`: it asks for no audio and has no way to play any. */
  practice?: { onUpClose?(): void; listenReason: string } } = {}) {
  const prefs = useReadingPrefs(), setReadingPrefs = useSetReadingPrefs(), lens = useStudyLens(), id = useId(), englishWhy = `${id}-english-why`, menu = `${id}-size`, tikkunMenu = `${id}-tikkun`, worksMenu = `${id}-works`;
  const size = textSizes.find(row => row.id === prefs.size)!, view = tikkunViews.find(row => row.id === prefs.tikkunView) ?? tikkunViews[0];
  const study = lens.available && lens.lens === "study";
  const keyboard = useKeyboardOpen(), nav = useRef<HTMLElement>(null);
  // The dock's own height, kept for the passage's padding. A hidden dock (keyboard open) keeps the last height, so the page does not jump.
  useLayoutEffect(() => {
    const node = nav.current; if (!node || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement, measure = () => { if (node.offsetHeight) root.style.setProperty("--dock-h", `${node.offsetHeight}px`); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => { observer.disconnect(); root.style.removeProperty("--dock-h"); };
  }, [study]);
  const covers = (work: string) => Boolean(COMMENTARY_WORKS[work]?.editions[worksCorpus]);
  const shown = lens.works.filter(covers);
  const hide = (event: { currentTarget: HTMLElement }) => (event.currentTarget.closest("[popover]") as HTMLElement & { hidePopover?(): void } | null)?.hidePopover?.();
  const worksPopover = <div id={worksMenu} popover="auto" className="toolbar-menu" role="group" aria-label="Commentaries under each verse">
    {STUDY_WORKS.map(work => {
      const on = lens.works.includes(work), full = !on && lens.works.length >= MAX_INLINE_WORKS;
      return <button type="button" key={work} aria-pressed={on} disabled={full} data-work={work}
        onClick={() => lens.setWorks(on ? lens.works.filter(row => row !== work) : [...lens.works, work])}>
        <span className="toolbar-menu-check" aria-hidden="true">{on && <svg viewBox="0 0 24 24" width="20" height="20"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span><span className="toolbar-menu-label">{workLabel(work)}{!covers(work) && <span className="toolbar-menu-note">{workCoverageNote(work)}</span>}</span></button>;
    })}
  </div>;
  // Study (2026-10-28) is a study sheet: it plays nothing and colours nothing, so its tools are a compact row at the top of the text, not the dock:
  // English, Commentaries and the text size (v6: Sources moved to the end of the page). Colors and Hear verse belong to Lein, and the colour preference is left as it was.
  if (study) return <nav className="study-toolbar" aria-label="Reading tools" data-lens="study" data-testid="study-toolbar">
    <button type="button" className="study-tool" aria-pressed={lens.english} onClick={() => lens.setEnglish(!lens.english)}>{icons.translate}<span>English</span></button>
    <button type="button" className="study-tool" popoverTarget={worksMenu} aria-label={`Commentaries: ${shown.length ? shown.map(workLabel).join(", ") : "none"}`}>{icons.works}<span>Commentaries</span>{shown.length > 0 && <em className="study-tool-names">{shown.map(workLabel).join(", ")}</em>}</button>
    {worksPopover}
    <button type="button" className="study-tool" popoverTarget={menu} aria-label={`Text size: ${size.label}`}>{icons.size}<span>{size.label}</span></button>
    <div id={menu} popover="auto" className="toolbar-menu" role="group" aria-label="Hebrew text size">
      {textSizes.map(row => <button type="button" key={row.id} aria-pressed={prefs.size === row.id} data-size={row.id} onClick={event => { setReadingPrefs({ size: row.id }); hide(event); }}>
        <span className="toolbar-menu-sample" lang="he" dir="rtl" aria-hidden="true">אָ</span>{row.label}</button>)}
    </div>
  </nav>;
  if (practice) {
    const listenWhy = `${id}-listen-why`, textMenu = `${id}-text`, englishOn = englishHidden && !study ? false : study ? lens.english : prefs.translation;
    return <nav ref={nav} className="reading-toolbar" aria-label="Reading tools" data-practice="" data-lens={study ? "study" : "lein"} data-hidden={keyboard ? "" : undefined}>
      <button type="button" className="toolbar-item toolbar-item-primary" data-testid="dock-up-close" disabled={!practice.onUpClose} onClick={practice.onUpClose}>{icons.closeup}<span>Up close</span></button>
      {listeningEnabled ? <button type="button" className="toolbar-item" data-testid="dock-listen" disabled={!onHear} onClick={onHear}>{icons.hear}<span>Listen</span></button>
        : <>{/* aria-disabled, not disabled, so it stays focusable and its tap shows why; the popover is the only thing it opens. */}
          <button type="button" className="toolbar-item" data-testid="dock-listen" aria-disabled="true" aria-describedby={listenWhy} popoverTarget={`${listenWhy}-tip`}>{icons.hear}<span>Listen</span></button>
          <span id={listenWhy} className="sr-only">{practice.listenReason}</span>
          <div id={`${listenWhy}-tip`} popover="auto" className="toolbar-menu toolbar-note" data-testid="dock-listen-reason"><p>{practice.listenReason}</p></div></>}
      <button type="button" className="toolbar-item" popoverTarget={textMenu} data-testid="dock-text">{icons.size}<span>Text</span></button>
      <div id={textMenu} popover="auto" className="toolbar-menu toolbar-menu-text" data-testid="dock-text-menu">
        <div role="group" aria-label="Reading tools">
          <button type="button" aria-pressed={prefs.colors} onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}Colors</button>
          <button type="button" aria-pressed={englishOn} aria-disabled={englishHidden && !study ? true : undefined} aria-describedby={englishHidden && !study ? englishWhy : undefined}
            onClick={() => { if (englishHidden && !study) return; if (study) lens.setEnglish(!lens.english); else setReadingPrefs({ translation: !prefs.translation }); }}>{icons.translate}English</button>
          {englishHidden && !study && <span id={englishWhy} className="sr-only">English is hidden while the translate drill is on. End the drill to change it.</span>}
        </div>
        {tikkunAvailable && !study && <div role="group" aria-label="Tikkun view">
          {tikkunViews.map(row => <button type="button" key={row.id} aria-pressed={prefs.tikkunView === row.id} data-tikkun-view={row.id} onClick={event => { setReadingPrefs({ tikkunView: row.id }); hide(event); }}>{icons.scroll}{row.label}</button>)}
        </div>}
        <div role="group" aria-label="Hebrew text size">
          {textSizes.map(row => <button type="button" key={row.id} aria-pressed={prefs.size === row.id} data-size={row.id} onClick={event => { setReadingPrefs({ size: row.id }); hide(event); }}>
            <span className="toolbar-menu-sample" lang="he" dir="rtl" aria-hidden="true">אָ</span>{row.label}</button>)}
        </div>
      </div>
    </nav>;
  }
  return <nav ref={nav} className="reading-toolbar" aria-label="Reading tools" data-lens={study ? "study" : "lein"} data-hidden={keyboard ? "" : undefined}>
    <button type="button" className="toolbar-item" aria-pressed={prefs.colors} onClick={() => setReadingPrefs({ colors: !prefs.colors })}>{icons.colors}<span>Colors</span></button>
    {/* Study keeps its own English choice, which starts on; Lein's stays as the reader left it. */}
    {/* aria-disabled, not disabled, so the button stays focusable and its reason is read. */}
    <button type="button" className="toolbar-item" aria-pressed={englishHidden && !study ? false : study ? lens.english : prefs.translation} aria-disabled={englishHidden && !study ? true : undefined}
      aria-describedby={englishHidden && !study ? englishWhy : undefined}
      onClick={() => { if (englishHidden && !study) return; if (study) lens.setEnglish(!lens.english); else setReadingPrefs({ translation: !prefs.translation }); }}>{icons.translate}<span>English</span></button>
    {/* Beside the button, not inside it, so the reason describes the button without becoming part of its name. */}
    {englishHidden && !study && <span id={englishWhy} className="sr-only">English is hidden while the translate drill is on. End the drill to change it.</span>}
    {tikkunAvailable && !study && <>
      <button type="button" className="toolbar-item" popoverTarget={tikkunMenu} data-active={prefs.tikkunView !== "off"} aria-label={`Tikkun: ${view.label}`}>{icons.scroll}<span>Tikkun</span></button>
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
