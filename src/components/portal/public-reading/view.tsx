"use client";
import { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PortalRequestError } from "../api";
import { RATE_LIMITED_MESSAGE } from "./rate-limited";
import type { StudyKind, StudyPage, StudyVerse } from "../workspace/study/api";
import { FlowingStudyText } from "../workspace/study/annotations";
import { StudyCredits } from "../workspace/study/credits";
import { ReadingPlayer, playMainVerseForWord, type ReadingPlayerHandle } from "../workspace/study/reading-player";
import type { ReadingSelection } from "../workspace/study/main-playback";
import { WordTools, type WordToolsHandle } from "../workspace/study/word-tools";
import { LiftedLine } from "../workspace/study/lift";
import { createReadingAudioCoordinator } from "../workspace/study/reading-audio-coordinator";
import { ReadingToolbar } from "../workspace/reading-toolbar";
import { LensSwitch } from "../workspace/lens-switch";
import { LENS_STORAGE, lensFromSearch, StudyLensScope, useStudyLens, type Lens } from "../workspace/study-lens";
import { StudyRows } from "../workspace/study/study-rows";
import { CommentaryCredits, CommentaryStatus, linkedVerse, useCommentLink, useReadingWorks, VerseRashi, workStatuses } from "../workspace/study/commentary-view";
import { DiscussionList, SourcesButton, VersePanelScope, WordPanelSource } from "../workspace/study/verse-panel";
import { PortionSummaryBlock, usePortionSummary } from "../workspace/study/portion-summary";
import type { ApprovedPortionSummary } from "../../../lib/portion-summary/credit";
import { parashahSlug } from "../../../lib/portion-summary/reading";
import type { WordPanelHost } from "../workspace/study/word-panel";
import { ReadingPlace, scrollToVerse } from "../workspace/study/reading-place";
import { readingChapters } from "../workspace/study/reading-place-model";
import { namedReading, type NamedReading } from "../../../lib/readings/named-readings";
import { useReadingPrefs } from "../workspace/reading-prefs";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { labelsIn, pickOfSection, sectionIndexAt, sectionOfPick, sectionsOf, type Section, type SectionRow } from "../../../lib/readings/sections";
import { PORTION_LABELS, portionPicks, portionRef, type PortionPick, type WeekPortions } from "../../../lib/print/portions";
import { fetchPublicAliyot } from "../print/api";
import { PortionPicker } from "./portion-picker";
import { SectionTabs } from "../../ui";
import { NextSection } from "../workspace/study/next-section";
import { addDays, thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicRefReading, fetchPublicShortPage, fetchPublicText, fetchPublicWeek, fetchPublicWordAids, fetchPublicWordDetails, refSource, weekSource,
  type PublicShortPage, type PublicSource, type PublicWeek } from "./api";
import { parseReadAddress, parseSaveReturn, readAddress, saveReturnAddress, selectorKey, type ReadAddress, type ReadTarget, type SaveReturn } from "./urls";
import { go, goToReading, HEADING_FOCUS, HEADING_FOCUS_MS } from "./heading-focus";
import { ReturnSignInLink } from "../return-sign-in-link";
import { CHOOSE_STRINGS, PlaceLink, useVerseChoice, type ChoosePlan } from "./choose-verses";
import { canonicalReadingRef } from "../../../lib/readings/reading-ref";
import { positionInRef, selectionPlace, wholePortionFor } from "../../../lib/readings/verse-selection";
import { printAddress } from "../../../lib/print/print-address";
import { useProductName } from "./product-name";
import { pageTitle } from "../../../lib/site/product-name";
import { SaveReading } from "../saved/save-reading";
import { SavedReadingPage } from "../saved/saved-reading";
import { OfflineExpiryNote, OfflinePill } from "../offline/status";
import { DRILL_STRINGS, drillNext, TranslateDrillPanel } from "./translate-drill";
import { SiddurBlessings } from "./siddur-blessings";
import { MoreScope, ReadHeader, useMore } from "./read-header";
import { rareTropeNote, rareTropesIn } from "../../../lib/readings/rare-tropes";
import styles from "./public-reading.module.css";
import drillStyles from "./translate-drill.module.css";
import { SiteBar } from "../../site/site-bar";

export const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
export const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** The eyebrow's date: "October 31", with the year only when it is not this year's. */
export const shortDate = (date: string, today: string | null) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", ...today && today.slice(0, 4) === date.slice(0, 4) ? {} : { year: "numeric" }, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** Week mode keeps the static page title. */
const WEEK_TITLE = "This week’s reading";
const GROUP_EYEBROW: Readonly<Record<NamedReading["group"], string>> = { parashah: "Parashah", special: "Special Shabbat", festival: "Festival", fast: "Fast day" };

/** This week is plain /read; another Shabbat and the Study lens are in the address, so it can be shared. */
export function readingAddress(date: string, today: string, lens: Lens): string {
  return readAddress({ mode: "week", date, kind: null }, { today, study: lens === "study" });
}
/** A text page: the verses [start, end) of the passage, one section of it (`section` is its index in the sections) or one of the server's pages (-1). */
type PageWindow = Readonly<{ start: number; end: number; section: number }>;
const NO_SECTIONS: readonly Section[] = Object.freeze([]), NO_LABELS: readonly { index: number; label: string }[] = Object.freeze([]);
/** One passage the page can show, under the label its passage button carries. */
export type LabelledSource = Readonly<{ label: string; source: PublicSource }>;

/** The signed-out reading: this or any Shabbat's parashah and haftarah, any named reading, or any passage of
 * the Torah or the Prophets, with the same text, translation, recordings and study tools students use, and
 * nothing about anyone. Lein opens first; Study opens from `lens=study`, or when this browser last used it.
 * The address forms are in urls.ts (`readAddress`). */
export function PublicReading() {
  const [address, setAddress] = useState<ReadAddress | null>(null), [query, setQuery] = useState<Lens | null>(null), [back, setBack] = useState<SaveReturn>(NO_SAVE_RETURN);
  useEffect(() => { setQuery(lensFromSearch(window.location.search)); setAddress(parseReadAddress(window.location.search)); setBack(parseSaveReturn(window.location.search)); }, []);
  return <StudyLensScope storageKey={LENS_STORAGE.weekly} query={query}>
    {!address ? <Shell title={WEEK_TITLE} settled={false}><ReadHeader eyebrow="Torah and haftarah" title="Loading the reading" previous={{ label: "Previous week", disabled: true, onClick: () => {} }} next={{ label: "Next week", disabled: true, onClick: () => {} }} /><ReadingBlock /></Shell>
      : address.target?.mode === "week" ? <WeekReading initial={address.target} verse={address.verse} saveReturn={back} pick={address.pick} />
        : address.target?.mode === "saved" ? <SavedReadingPage id={address.target.id} verse={address.verse} learner={address.target.learner ?? null} />
        : address.target ? <ChosenReading target={address.target} verse={address.verse} saveReturn={back} />
          : <Unavailable />}
  </StudyLensScope>;
}

const NO_SAVE_RETURN: SaveReturn = Object.freeze({ choose: null, offer: false });
/**
 * The way back from sign-in for one reading (N20): the reading's address with the verse the reader is on, and for Save the
 * offer (with a selection's verses). `offer` is spent by the first Save that asks: the passage's own Save when nothing was
 * chosen, otherwise the Choose verses bar's.
 */
function useReturn(saveReturn: SaveReturn, address: (verse: number | null) => string | null, passage: { ranges: readonly string[]; kind: StudyKind } | null | undefined) {
  const place = useRef<string | null>(null);
  const passageOffer = useRef(saveReturn.offer && !saveReturn.choose), choiceOffer = useRef(saveReturn.offer && Boolean(saveReturn.choose));
  const here = () => address(passage && place.current ? positionInRef(passage.ranges.join("; "), passage.kind, place.current) : null);
  return { place, here, passageOffer, choiceOffer, forSave: (ranges?: readonly string[]) => () => { const at = here(); return at ? saveReturnAddress(at, ranges) : null; } };
}

export { go, goToReading };
/** The ask is read once, when this reading mounts: a page that was still loading when the person chose another reading must not
 * spend it, because the next page is the one it was left for. Focus follows once this reading is shown. */
function useHeadingFocus(shown: boolean) {
  const asked = useRef(false);
  useEffect(() => {
    try {
      const at = Number(window.sessionStorage.getItem(HEADING_FOCUS)), age = Date.now() - at; window.sessionStorage.removeItem(HEADING_FOCUS);
      if (Number.isSafeInteger(at) && at > 0 && age >= 0 && age < HEADING_FOCUS_MS) asked.current = true;
    } catch { /* Nothing was asked. */ }
  }, []);
  useEffect(() => {
    if (!shown || !asked.current) return;
    asked.current = false;
    document.getElementById("public-reading-title")?.focus({ preventScroll: true });
  }, [shown]);
}
export function replaceAddress(address: string) { try { if (window.location.pathname + window.location.search !== address) window.history.replaceState(null, "", address); } catch { /* Address bar stays as it was. */ } }

export const readTitle = (name: string, productName: string) => pageTitle(productName, name);
/** The tab names what is shown. The page is one static shell whose metadata says "This week’s reading", and
 * Next writes that title again after hydration, so a single document.title write is lost; this keeps it. */
export function useDocumentTitle(text: string) {
  useEffect(() => {
    const apply = () => { if (document.title !== text) document.title = text; };
    apply();
    let observer: MutationObserver | null = null;
    try { observer = new MutationObserver(apply); observer.observe(document.head, { childList: true, subtree: true, characterData: true }); } catch { /* The title stays as written. */ }
    return () => observer?.disconnect();
  }, [text]);
}
/** `signedIn`: the page already verified the session (a member's own saved reading); public modes never ask, and offer Sign in.
 * `settled`: the reading above has stopped growing. The Save card is added only then, below the reading, so it never sits where the
 * reading is about to arrive and moves under a reader's eyes (D3). */
export function Shell({ title, children, signedIn = false, back, settled = true }: { title: string; children: ReactNode; signedIn?: boolean; back?: () => string | null; settled?: boolean }) {
  useDocumentTitle(readTitle(title, useProductName()));
  return <div className="portal-shell">
    {/* Where there is a reading on the page, "Skip to the reading" lands on it (the dock and the words are then its first stops), not at the top of the page it already is at; without one, on the page's main. */}
    <a className="skip-link" href="#public-reading-main" onClick={event => { const text = document.querySelector<HTMLElement>("[data-reading-text]"); if (!text) return; event.preventDefault(); text.focus({ preventScroll: true }); text.scrollIntoView({ block: "start" }); }}>Skip to the reading</a>
    <SiteBar signedIn={signedIn || undefined} back={back} />
    <main id="public-reading-main" className="workspace-main">
      <div className="reading-workspace reading-with-work"><section aria-labelledby="public-reading-title">
        {children}
        {!signedIn && settled && <section className={styles.signIn} aria-labelledby="public-sign-in-heading">
          <h2 id="public-sign-in-heading">Save this reading</h2>
          <p>Sign in to keep this reading, your place and your preferred commentaries. Everything on this page is open to anyone.</p>
          <ReturnSignInLink className="button-start" back={back}>Sign in</ReturnSignInLink>
        </section>}
      </section></div>
    </main>
  </div>;
}
export function Hero({ eyebrow, title, meta, nav, actions }: { eyebrow: string; title: string; meta?: ReactNode; nav?: ReactNode; actions?: ReactNode }) {
  return <header className="reading-hero">
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1 id="public-reading-title" className={`hero-reference ${styles.title}`} tabIndex={-1}>{title}</h1>
    {meta && <p className="hero-meta">{meta}</p>}
    {nav && <nav className={styles.weeks} aria-label="Choose a reading">{nav}</nav>}
    {actions}
  </header>;
}
/** Holds a screen's worth of room for the reading until it is shown, so the Save card and the foot of the page stay below it.
 * `reserve` is false for an error or an empty week, which have nothing more coming. */
export function ReadingBlock({ reserve = true, children }: { reserve?: boolean; children?: ReactNode }) {
  return <div className={reserve ? styles.readingBlock : undefined}>{children}</div>;
}
/** Where every reading is listed: the Readings index (the three dropdowns of the old in-page chooser are retired). */
export const ALL_READINGS_LINK = "Every parashah, holiday and passage";
/** Start reading: scroll to the text and, with recordings, play the first verse. `row(extra, print)` adds Save or Edit beside it,
 * and Print, the reader's print sheet of the same reading (`print` is its /print address). */
export function useStarter() {
  const starter = useRef<(() => void) | null>(null), [ready, setReady] = useState(false);
  const register = useCallback((value: (() => void) | null) => { starter.current = value; setReady(value !== null); }, []);
  const start = useCallback(() => starter.current?.(), []);
  const row = (extra?: ReactNode, print?: string) => <div className="hero-actions">
    <button type="button" className="button-start" disabled={!ready} onClick={() => starter.current?.()}>Start reading</button>
    <a className="button-hero-secondary" href="/trope-chart">Trope chart</a>
    {print && <a className="button-hero-secondary" href={print}>Print</a>}
    {extra}
  </div>;
  return { register, ready, start, button: row(), row };
}

function Unavailable() {
  const today = useToday();
  return <Shell title="Reading unavailable">
    <Hero eyebrow="Torah and haftarah" title="Reading unavailable" nav={today && <button type="button" className="button-hero-secondary" onClick={() => goToReading("/read")}>This week</button>} />
    <div className="workspace-state" role="status"><h2>That reading isn’t available</h2><p>The address doesn’t name a reading this page can open. Choose one, or go back to this week.</p>
      <p><a href="/readings">{ALL_READINGS_LINK}</a></p></div>
  </Shell>;
}
function useToday() { const [today, setToday] = useState<string | null>(null); useEffect(() => { setToday(thisShabbat()); }, []); return today; }

/** A Shabbat's parashah and haftarah, by date, with week-by-week browsing. */
function WeekReading({ initial, verse, saveReturn, pick: initialPick }: { initial: Extract<ReadTarget, { mode: "week" }>; verse: number | null; saveReturn: SaveReturn; pick?: PortionPick }) {
  const today = useToday(), [date, setDate] = useState<string | null>(null), lens = useStudyLens(), starter = useStarter();
  const [week, setWeek] = useState<{ date: string; value?: PublicWeek; error?: number } | null>(null), [retry, setRetry] = useState(0);
  const [kind, setKind] = useState<StudyKind | null>(initial.kind), [linked, setLinked] = useState(verse), [choosing, setChoosing] = useState(false);
  const [pick, setPick] = useState<PortionPick>(initialPick ?? "full");
  useEffect(() => { if (today) setDate(current => current ?? initial.date ?? today); }, [today, initial.date]);
  // The Shabbat's calendar aliyot (N3), asked for beside the reading: a week without them (a festival Saturday, or the answer did not come) is read as before, Full only.
  const [aliyot, setAliyot] = useState<{ date: string; value: WeekPortions | null; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    fetchPublicAliyot(date, controller.signal).then(value => { if (!controller.signal.aborted) setAliyot({ date, value }); },
      () => { if (!controller.signal.aborted) setAliyot({ date, value: null, failed: true }); });
    return () => controller.abort();
  }, [date, retry]);
  const portions = aliyot?.date === date ? aliyot.value : null, aliyotSettled = aliyot?.date === date;
  const offered = portionPicks(portions), effectivePick: PortionPick = kind === "haftarah" || !offered.includes(pick) ? "full" : pick;
  // The triennial reading is its own passage: fetched by its ref, and read in sections like the full portion.
  const triennialRef = effectivePick === "triennial" && portions ? portionRef(portions, "triennial") : null;
  const [triennial, setTriennial] = useState<{ ref: string; source?: PublicSource; error?: number } | null>(null);
  useEffect(() => {
    if (!triennialRef) { setTriennial(null); return; }
    const controller = new AbortController();
    setTriennial({ ref: triennialRef });
    fetchPublicRefReading(triennialRef, "torah", controller.signal).then(value => { if (!controller.signal.aborted) setTriennial({ ref: triennialRef, source: refSource(value) }); },
      error => { if (!controller.signal.aborted) setTriennial({ ref: triennialRef, error: statusOf(error) }); });
    return () => controller.abort();
  }, [triennialRef, retry]);
  const triennialNow = triennialRef && triennial?.ref === triennialRef ? triennial : null;
  // What the address says: the pick once the calendar has answered that it can be had; while it has not answered, or could not, the asked-for pick is kept so a reload can honour it.
  const addressPick: PortionPick = kind === "haftarah" || (aliyotSettled && !aliyot?.failed && !offered.includes(pick)) ? "full" : pick;
  // One Shabbat at a time; its address is shareable (and this week's Lein is plain /read).
  useEffect(() => { if (date && today) replaceAddress(readAddress({ mode: "week", date, kind: kind === "haftarah" ? "haftarah" : null }, { today, verse: linked, study: lens.lens === "study", pick: addressPick })); },
    [date, today, kind, linked, lens.lens, addressPick]);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    setWeek({ date });
    fetchPublicWeek(date, controller.signal).then(value => { if (!controller.signal.aborted) setWeek({ date, value }); },
      error => { if (!controller.signal.aborted) setWeek({ date, error: statusOf(error) }); });
    return () => controller.abort();
  }, [date, retry]);
  const current = week?.value && week.date === date ? week.value : null;
  const triennialSource = triennialNow?.source;
  const sources = useMemo(() => current ? (["torah", "haftarah"] as const).flatMap(row => { const source = row === "torah" && triennialSource ? triennialSource : weekSource(current, row); return source ? [{ label: row === "torah" ? "Torah" : "Haftarah", source }] : []; }) : [], [current, triennialSource]);
  const change = (next: string) => { if (next !== date) { setDate(next); setKind(null); setLinked(null); setPick("full"); } };
  const index = Math.max(0, sources.findIndex(row => row.source.passage.kind === kind)), isThisWeek = date !== null && date === today;
  const shown = sources[index]?.source.passage;
  // The parashah's approved summary (N7), asked for only while Study shows its Torah.
  const summary = usePortionSummary(shown?.kind === "torah" ? parashahSlug(current?.parashah) : null, lens.lens === "study");
  // The sections the Torah is read in: the full portion's aliyot, or the triennial reading's own.
  const division = triennialSource ? "triennial" : "full";
  const sectionRows = useMemo(() => portions ? division === "triennial" ? portions.triennial?.aliyot : portions.full : undefined, [portions, division]);
  // The reader is ready to be shown once the aliyot have answered (so the first page is a section, never one that is then replaced) and the triennial text, if asked for, is here.
  const ready = (!current?.torah || aliyotSettled) && (!triennialRef || Boolean(triennialNow && (triennialNow.source || triennialNow.error)));
  const picked = effectivePick !== "full" && effectivePick !== "triennial" && portions ? portionRef(portions, effectivePick) : null;
  const back = useReturn(saveReturn, at => date && today ? readAddress({ mode: "week", date, kind: kind === "haftarah" ? "haftarah" : null }, { today, verse: at ?? linked, study: lens.lens === "study", pick: addressPick }) : null, shown);
  // Choose verses: the Shabbat's own passage is the whole portion already, so a selection from it only needs Save.
  // Back from "Sign in to save" with a selection, choosing opens with it.
  const choosePlan: ChoosePlan | undefined = current ? { label: CHOOSE_STRINGS.choose, start: saveReturn.choose ?? [], autoStart: Boolean(saveReturn.choose), onChoosing: setChoosing, onPlace: ref => { back.place.current = ref; },
    save: (selection, saved) => <SaveReading passage={{ title: current.parashah, label: selection.line, kind: selection.kind, ranges: selection.ranges, date: current.date }} onSaved={saved} back={back.forSave(selection.ranges)} offer={back.choiceOffer} /> } : undefined;
  const weekShown = Boolean(week && week.date === date && (week.value || week.error));
  useHeadingFocus(weekShown);
  const savePassage = current && shown ? { title: current.parashah, label: effectivePick !== "full" ? PORTION_LABELS[effectivePick] : shown.kind === "torah" ? "Torah" : "Haftarah", kind: shown.kind, ranges: picked ? picked.split("; ") : shown.ranges, date: current.date } : null;
  const printHref = date && shown ? printAddress({ mode: "week", date, kind: shown.kind === "haftarah" ? "haftarah" : null, pick: effectivePick }, undefined, { today }) : undefined;
  // The Torah's rare tropes this week, for the reader's note (N5, G17).
  const rareNote = useMemo(() => current?.torah ? rareTropeNote(rareTropesIn(expandReadingRanges(current.torah.ranges, "torah", TANAKH_VERSE_COUNTS))) : null, [current]);
  return <MoreScope initiallyOpen={saveReturn.offer && !saveReturn.choose}><Shell title={WEEK_TITLE} back={back.here} settled={weekShown}>
    <ReadHeader eyebrow={date && today ? <><span data-read-week={isThisWeek ? "this" : "other"}>{isThisWeek ? "This Shabbat" : "Shabbat"}</span> · <time dateTime={date}>{shortDate(date, today)}</time><OfflinePill /></> : "Torah and haftarah"}
      title={current ? current.parashah ?? "Shabbat reading" : week?.error ? "Reading unavailable" : "Loading the reading"}
      previous={{ label: "Previous week", disabled: !date, onClick: () => { if (date) change(addDays(date, -7)); } }}
      next={{ label: "Next week", disabled: !date, onClick: () => { if (date) change(addDays(date, 7)); } }}
      top={<>
        {date && <p className="field-help" data-reading-ranges=""><time dateTime={date}>{longDate(date)}</time>{current?.torah && <> · Torah <bdi dir="ltr">{displayRange(current.torah.ranges)}</bdi></>}{current?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(current.haftarah.ranges)}</bdi></>}</p>}
        {rareNote && <p className="field-help" data-rare-trope="">{rareNote}</p>}
      </>}
      rest={<>
        {sources.length > 0 && <MoreStart ready={starter.ready} onStart={starter.start} />}
        {sources.length > 0 && printHref && <a className="button-hero-secondary" href={printHref}>Print</a>}
        {sources.length > 0 && savePassage && !choosing && <SaveReading passage={savePassage} back={back.forSave()} offer={back.passageOffer} />}
        <a className="button-hero-secondary" href="/trope-chart">Trope chart</a>
        {current && sources.length > 0 && <SiddurBlessings torah={Boolean(current.torah)} haftarah={Boolean(current.haftarah)} />}
      </>} />
    <ReadingBlock reserve={!week?.error && !(current && !sources.length)}>
    {week?.error && <div className="workspace-state" role="status"><h2>{week.error === 400 ? "That date isn’t available" : "The reading didn’t load"}</h2>
      <p>{week.error === 400 ? "Choose a Shabbat within the next few years, or go back to this week." : week.error === 429 ? RATE_LIMITED_MESSAGE : "Check your connection and try again."}</p>
      {week.error === 400 && today ? <button type="button" className="button-secondary" onClick={() => change(today)}>Go to this week</button> : <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}
      <OfflineExpiryNote /></div>}
    {current && !sources.length && <div className="workspace-state" role="status"><h2>No reading to show for this Shabbat</h2><p>The calendar lists no weekly Torah portion or haftarah here. Try the week before or after.</p></div>}
    {current && sources.length > 0 && <>
      {!current.torah && current.parashah && <p className="field-help">This Shabbat’s Torah reading isn’t shown here. The haftarah is below.</p>}
      {triennialNow?.error ? <div className="workspace-state" role="status"><h2>The reading didn’t load</h2>
        <p>{triennialNow.error === 429 ? RATE_LIMITED_MESSAGE : "Check your connection and try again."}</p>
        <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>
        : !ready ? <p role="status">Loading the text…</p>
          : <PassageReading key={`${current.date}|${division}`} sources={sources} index={index} onIndex={next => { setKind(sources[next].source.passage.kind); setLinked(null); }}
            verse={linked} onVerseLeft={() => setLinked(null)} registerStart={starter.register} retry={retry} onRetry={() => setRetry(value => value + 1)} choose={choosePlan}
            sectionRows={sectionRows} section={sectionOfPick(effectivePick)} onSection={n => { if (division === "full") { setPick(pickOfSection("full", n)); setLinked(null); } }}
            portion={shown?.kind === "torah" ? <PortionPicker portions={portions} pick={effectivePick} onPick={next => { setPick(next); setLinked(null); }} /> : undefined}
            summary={summary} summaryJump={division === "full"}
            foot={shown?.kind === "torah" && rareNote ?<p className="field-help" data-rare-trope="">{rareNote}</p> : undefined} />}
    </>}
    </ReadingBlock>
  </Shell></MoreScope>;
}

/** A named reading from the catalog, or any canonical passage: its passages loaded by ref. */
function ChosenReading({ target, verse, saveReturn }: { target: Extract<ReadTarget, { mode: "named" | "ref" }>; verse: number | null; saveReturn: SaveReturn }) {
  const named = target.mode === "named" ? namedReading(target.slug) : null, lens = useStudyLens(), starter = useStarter();
  const summary = usePortionSummary(named?.group === "parashah" ? named.slug : null, lens.lens === "study");
  const passages = useMemo(() => named ? named.passages : target.mode === "ref" ? [{ label: target.kind === "torah" ? "Torah" : "Haftarah", kind: target.kind, ref: target.ref }] : [], [named, target]);
  const title = named ? named.name : target.mode === "ref" ? displayRange([target.ref]) : "Reading";
  const [index, setIndex] = useState(target.mode === "named" ? Math.min(target.passage, passages.length) - 1 : 0), [linked, setLinked] = useState(verse);
  const [loaded, setLoaded] = useState<{ sources?: readonly LabelledSource[]; error?: number } | null>(null), [retry, setRetry] = useState(0);
  const place = useRef<string | null>(null), study = lens.lens === "study", [choosing, setChoosing] = useState(false);
  useEffect(() => {
    const address: ReadTarget = target.mode === "named" ? { mode: "named", slug: target.slug, passage: index + 1 } : target;
    replaceAddress(readAddress(address, { verse: linked, study: lens.lens === "study" }));
  }, [target, index, linked, lens.lens]);
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    // The passage list is computed from each ref locally on the server: small, cached and fetched together.
    Promise.all(passages.map(row => fetchPublicRefReading(row.ref, row.kind, controller.signal))).then(rows => {
      if (!controller.signal.aborted) setLoaded({ sources: rows.map((reading, at) => Object.freeze({ label: passages[at].label, source: refSource(reading) })) });
    }, error => { if (!controller.signal.aborted) setLoaded({ error: statusOf(error) }); });
    return () => controller.abort();
  }, [passages, retry]);
  const sources = loaded?.sources ?? [];
  // Choose verses. A selection (an address with `mark`) is shown inside its whole portion with its verses marked, and the way back is one link;
  // any other passage of a parashah or haftarah offers its whole portion the same way. A named reading is whole already.
  const refTarget = target.mode === "ref" ? target : null;
  const portion = useMemo(() => {
    if (!refTarget || refTarget.mark) return null;
    const canonical = canonicalReadingRef(refTarget.ref, refTarget.kind), found = canonical && wholePortionFor(refTarget.kind, canonical.verses);
    return found && found.ref !== refTarget.ref ? found : null;
  }, [refTarget]);
  const links = refTarget?.mark ? <PlaceLink place={place} base={readAddress({ mode: "ref", ref: refTarget.mark, kind: refTarget.kind }, { study })}
      href={at => readAddress({ mode: "ref", ref: refTarget.mark!, kind: refTarget.kind }, { study, verse: selectionPlace(refTarget.mark!, refTarget.ref, refTarget.kind, at) })}>{CHOOSE_STRINGS.backToSelection}</PlaceLink>
    : portion && refTarget ? <PlaceLink place={place} base={readAddress({ mode: "ref", ref: portion.ref, kind: portion.kind, mark: refTarget.ref }, { study })}
      href={at => readAddress({ mode: "ref", ref: portion.ref, kind: portion.kind, mark: refTarget.ref }, { study, verse: positionInRef(portion.ref, portion.kind, at) })}>{CHOOSE_STRINGS.wholePortion}</PlaceLink> : null;
  const shownPassage = sources[index]?.source.passage;
  const back = useReturn(saveReturn, at => readAddress(target.mode === "named" ? { mode: "named", slug: target.slug, passage: index + 1 } : target, { verse: at ?? linked, study }), shownPassage);
  // Back from "Sign in to save" with a selection, choosing opens with it (in place of a marked selection's own verses).
  const choosePlan: ChoosePlan | undefined = sources.length > 0 ? { label: CHOOSE_STRINGS.choose, start: saveReturn.choose ?? (refTarget?.mark ? refTarget.mark.split("; ") : []), autoStart: Boolean(saveReturn.choose), marked: refTarget?.mark ? refTarget.mark.split("; ") : undefined,
    extra: links, onPlace: ref => { place.current = ref; back.place.current = ref; }, onChoosing: setChoosing,
    save: (selection, saved) => <SaveReading passage={{ title, label: selection.line, kind: selection.kind, ranges: selection.ranges, date: null }} onSaved={saved} back={back.forSave(selection.ranges)} offer={back.choiceOffer} /> } : undefined;
  useHeadingFocus(loaded !== null);
  return <MoreScope initiallyOpen={saveReturn.offer && !saveReturn.choose}><Shell title={title} back={back.here} settled={loaded !== null}>
    <ReadHeader eyebrow={named ? GROUP_EYEBROW[named.group] : "Any reading"} title={loaded?.error ? "Reading unavailable" : title}
      top={<>
        <p className="field-help" data-reading-ranges="">{passages.map((row, at) => <span key={at}>{at > 0 && " · "}{row.label} <bdi dir="ltr">{displayRange([row.ref])}</bdi></span>)}</p>
      </>}
      rest={<>
        {sources.length > 0 && <MoreStart ready={starter.ready} onStart={starter.start} />}
        {sources.length > 0 && <a className="button-hero-secondary" href={printAddress(target.mode === "named" ? { mode: "named", slug: target.slug, passage: index + 1 } : target)}>Print</a>}
        {sources[index] && !choosing && <SaveReading passage={{ title: named ? named.name : title, label: passages[index]?.label ?? null, kind: sources[index].source.passage.kind, ranges: sources[index].source.passage.ranges, date: null }} back={back.forSave()} offer={back.passageOffer} />}
        <a className="button-hero-secondary" href="/trope-chart">Trope chart</a>
      </>} />
    <ReadingBlock reserve={!loaded?.error}>
    {loaded?.error && <div className="workspace-state" role="status"><h2>{loaded.error === 400 ? "That reading isn’t available" : "The reading didn’t load"}</h2>
      <p>{loaded.error === 400 ? "Choose another reading, or go back to this week." : loaded.error === 429 ? RATE_LIMITED_MESSAGE : "Check your connection and try again."}</p>
      {loaded.error !== 400 && <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {sources.length > 0 && <PassageReading key={sources.map(row => selectorKey(row.source.selector)).join("|")} sources={sources} index={index}
      onIndex={next => { setIndex(next); setLinked(null); }} verse={linked} onVerseLeft={() => setLinked(null)} registerStart={starter.register} retry={retry} onRetry={() => setRetry(value => value + 1)} choose={choosePlan} summary={summary} />}
    </ReadingBlock>
  </Shell></MoreScope>;
}

/** Puts focus on a verse's own first control once the text has scrolled there (a verse on another text page is found after it loads). */
function focusVerse(ref: string) {
  let tries = 0;
  const attempt = () => {
    let row: Element | null = null;
    try { row = document.querySelector(`[data-study-rows] [data-verse-ref="${CSS.escape(ref)}"], .study-verses [data-verse-ref="${CSS.escape(ref)}"]`); } catch { /* No such verse here. */ }
    const target = row?.querySelector<HTMLElement>("button:not([disabled])") ?? (row instanceof HTMLElement ? row : null);
    if (target) { if (!target.hasAttribute("tabindex") && !(target instanceof HTMLButtonElement)) target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); return; }
    if (++tries < 20) window.setTimeout(attempt, 100);
  };
  window.setTimeout(attempt, 0);
}
/** Start reading, in the Change sheet (N5). The sheet closes first, so the action that moves focus into the reading is the one that keeps it. */
function MoreStart({ ready, onStart }: { ready: boolean; onStart(): void }) {
  const more = useMore();
  return <button type="button" className="button-primary" disabled={!ready} onClick={() => more ? more.close(onStart) : onStart()}>Start reading</button>;
}
/**
 * The reading itself, for any list of passages: the passage buttons (Torah | Haftarah, or a named reading's
 * own), Lein and Study, the text pages, the player, word tools, commentary and Up close.
 * `verse` (1-based in the passage shown) opens that verse selected: Word tools on it, and in the player
 * when recordings are on, ready to play. Any other choice lets it go (`onVerseLeft`).
 */
export function PassageReading({ sources, index, onIndex, verse, onVerseLeft, registerStart, retry, onRetry, verseExtra, choose, sectionRows, section, onSection, portion, foot, summary, summaryJump }: {
  sources: readonly LabelledSource[]; index: number; onIndex(index: number): void; verse: number | null; onVerseLeft(): void;
  registerStart(start: (() => void) | null): void; retry: number; onRetry(): void;
  /** In Lein, shown under the selected verse before Up close (a saved reading's Working and Got it marks). */
  verseExtra?: (ref: string) => ReactNode;
  /** Choose verses (1.7): how choosing starts and saves on this page; absent, the reading has no choosing. */
  choose?: ChoosePlan;
  /** The calendar's aliyot for the Torah shown (1.9 N3, decision 2): the text pages by aliyah, with a chip for each. Absent, or for a haftarah, the text pages as the server cuts it. */
  sectionRows?: readonly SectionRow[];
  /** The section (an aliyah's `n`) the reading is open on, and told when the reader moves to another. */
  section?: string | null; onSection?(n: string): void;
  /** The Portion control, shown with Choose verses (in the More sheet where the page has one). */
  portion?: ReactNode;
  /** A reader note at the foot of the section, above its credits (a rare trope this week). */
  foot?: ReactNode;
  /** The parashah's approved summary (1.9 N7), shown atop Study on the Torah; and whether its outline lines go to the page's sections (the full portion's aliyot, not the triennial reading's). */
  summary?: ApprovedPortionSummary | null; summaryJump?: boolean;
}) {
  const source = (sources[index] ?? sources[0]).source, passage = source.passage, kind = passage.kind, listening = source.listening, key = selectorKey(source.selector);
  const allVerses = useMemo(() => { try { return expandReadingRanges(passage.ranges, kind, TANAKH_VERSE_COUNTS); } catch { return []; } }, [passage, kind]);
  const choice = useVerseChoice(choose, allVerses, kind), more = useMore(), chapters = useMemo(() => readingChapters(allVerses), [allVerses]);
  const linkedIndex = verse !== null && verse <= passage.verseCount ? verse - 1 : null;
  // What a text page is: one section when the calendar gives aliyot (the text flows inside it), else one of the server's pages.
  const sections = useMemo(() => kind === "torah" && sectionRows ? sectionsOf(sectionRows, allVerses) : NO_SECTIONS, [kind, sectionRows, allVerses]);
  const windows = useMemo<readonly PageWindow[]>(() => sections.length ? sections.map((row, at) => ({ start: row.start, end: row.end, section: at }))
    : passage.pages.map((row, at) => ({ start: row.offset, end: passage.pages[at + 1]?.offset ?? passage.verseCount, section: -1 })), [sections, passage]);
  const windowAt = (position: number) => Math.max(0, sections.length ? sectionIndexAt(sections, position) : windows.findIndex(row => position >= row.start && position < row.end));
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [win, setWin] = useState(() => { const asked = section ? sections.findIndex(row => row.n === section) : -1; return asked >= 0 ? asked : linkedIndex !== null ? windowAt(linkedIndex) : 0; });
  // Told another section (a pick from the Portion control) after the page is open: go to it; told none (the whole portion): back to the first.
  const askedSection = useRef(section);
  useEffect(() => {
    if (askedSection.current === section) return;
    askedSection.current = section;
    const at = section ? sections.findIndex(row => row.n === section) : 0;
    if (at >= 0) setWin(current => current === at ? current : at);
  }, [section, sections]);
  const range = windows[win] ?? windows[0], nextWin = win + 1 < windows.length ? win + 1 : null;
  const [text, setText] = useState<{ key: string; page?: StudyPage; preview?: StudyVerse | null; error?: number } | null>(null);
  const [playingWord, setPlayingWord] = useState<{ verse: number; index: number } | null>(null);
  const [focus, setFocus] = useState<number | null>(null), [lift, setLift] = useState<{ index: number; opening: number; navigation: number } | null>(null);
  // One coordinator for the page's lifetime (as in the signed-in reading): it is stopped, never disposed,
  // so a development StrictMode remount keeps a live one.
  const audioRef = useRef<ReturnType<typeof createReadingAudioCoordinator> | null>(null);
  if (!audioRef.current) audioRef.current = createReadingAudioCoordinator();
  const audio = audioRef.current;
  const playback = useRef<ReadingPlayerHandle | null>(null), registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const tools = useRef<WordToolsHandle | null>(null), registerTools = useCallback((value: WordToolsHandle | null) => { tools.current = value; }, []);
  const shortPages = useRef(new Map<string, Promise<PublicShortPage>>()), serverPages = useRef(new Map<string, Promise<StudyPage>>()), pendingPlace = useRef<{ key: string; ref: string; wordIndex: number } | null>(null);
  const textAnchor = useRef<HTMLDivElement | null>(null), openings = useRef(0), group = useId(), prefs = useReadingPrefs(), lens = useStudyLens(), study = lens.lens === "study";
  // A deep-linked verse is shown selected in the player without playing; the first other choice releases it,
  // and that choice runs after the release so the player is never suspended under it.
  const deferred = useRef<(() => void) | null>(null), linkShown = useRef(false);
  useLayoutEffect(() => { const run = deferred.current; deferred.current = null; run?.(); });
  const release = (action: () => void) => { if (linkedIndex === null) { action(); return; } deferred.current = action; onVerseLeft(); };
  // The translate drill (Lein only, Daniel F4): a view state, never stored. `revealed` names the verse whose English is shown.
  const [drill, setDrill] = useState<{ revealed: string | null } | null>(null), [announce, setAnnounce] = useState("");
  const drillHint = useRef<string | null>(null), drillToPage = useRef(false), drillFocus = useRef<"jps" | "reveal" | "toggle" | null>(null), drillScroll = useRef(false);
  // Which verse the player's Play is set to after the drill moves on (a controlled target: inert until Play, and it holds the old verse's audio still).
  // Any verse the reader chooses themselves clears it, so the player follows the verse that was last chosen either way.
  const [drillTarget, setDrillTarget] = useState<{ index: number; generation: number } | null>(null), drillGeneration = useRef(0);
  const jpsRef = useRef<HTMLHeadingElement | null>(null), revealRef = useRef<HTMLButtonElement | null>(null), drillToggle = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const target = drillFocus.current; if (!target) return; drillFocus.current = null;
    const control = (target === "jps" ? jpsRef : target === "reveal" ? revealRef : drillToggle).current;
    control?.focus({ preventScroll: target !== "toggle" });
    // After Next verse the new verse's controls come into view: on a phone the verse text is taller than the screen, so Reveal would be below it.
    if (target === "reveal" && drillScroll.current && control) {
      drillScroll.current = false;
      // Smooth only for a short way: a page of verses can be many screens tall, and a long smooth sweep is slow and dizzying.
      try {
        const panel = control.closest("[data-translate-drill]") ?? control, box = panel.getBoundingClientRect();
        const near = box.top < innerHeight * 1.5 && box.bottom > -innerHeight * 0.5, reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        panel.scrollIntoView({ block: "nearest", behavior: reduced || !near ? "auto" : "smooth" });
      } catch { /* Stay where the page is. */ }
    }
  });

  useEffect(() => () => { audio.stopAll(); }, [audio]);
  useEffect(() => {
    const leave = () => audio.stopAll(), background = () => { if (document.visibilityState !== "visible") audio.stopAll(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [audio]);
  const keyOf = (at: PageWindow | undefined) => JSON.stringify([key, kind, at?.start ?? 0, at?.end ?? 0]);
  const textKey = keyOf(range);
  // This passage's own canonical ref, which is how its curated discussions are asked for (the same for a Shabbat, a named reading or any passage).
  const discussionRef = passage.ranges.join("; "), discussionPassage = useMemo(() => ({ ref: discussionRef, kind }), [discussionRef, kind]);
  useEffect(() => {
    let live = true;
    audio.stopAll(); setText({ key: textKey }); setPlayingWord(null);
    // The server's pages are the unit of fetching and caching; a section is cut from the one or two pages it lies on, and the next section's first verse comes along to be previewed.
    const fetchPage = (offset: number) => {
      const id = JSON.stringify([key, kind, offset]);
      let work = serverPages.current.get(id);
      if (!work) { work = fetchPublicText(source, offset, new AbortController().signal); serverPages.current.set(id, work); void work.catch(() => serverPages.current.delete(id)); }
      return work;
    };
    const compose = async (): Promise<{ page: StudyPage; preview: StudyVerse | null }> => {
      if (!sections.length) return { page: await fetchPage(range.start), preview: null };
      const next = nextWin === null ? null : windows[nextWin];
      const lying = (from: number, to: number) => passage.pages.filter((row, at) => row.offset < to && (passage.pages[at + 1]?.offset ?? passage.verseCount) > from).map(row => row.offset);
      const loaded = await Promise.all([...new Set([...lying(range.start, range.end), ...next ? lying(next.start, next.start + 1) : []])].map(fetchPage));
      const verseAt = (position: number) => { const found = loaded.find(row => position >= row.offset && position < row.offset + row.verses.length); return found?.verses[position - found.offset] ?? null; };
      const verses: StudyVerse[] = [];
      for (let position = range.start; position < range.end; position++) { const row = verseAt(position); if (!row) throw new PortalRequestError(503); verses.push(row); }
      const touched = new Set(verses.map(row => row.ref.replace(/:[1-9]\d*$/, ""))), chapters: StudyPage["chapters"] = [];
      for (const row of [...loaded].sort((a, b) => a.offset - b.offset)) for (const chapter of row.chapters) if (touched.has(chapter.ref) && !chapters.some(item => item.ref === chapter.ref)) chapters.push(chapter);
      const translated = verses.filter(row => row.english !== null).length;
      return { page: { offset: range.start, nextOffset: null, totalVerses: passage.verseCount, verses, chapters,
        translation: { key: "jps2023", status: translated === verses.length ? "available" : translated === 0 ? "unavailable" : "partial" } }, preview: next ? verseAt(next.start) : null };
    };
    compose().then(result => { if (live) setText({ key: textKey, ...result }); }, error => { if (live) setText({ key: textKey, error: statusOf(error) }); });
    return () => { live = false; };
  }, [source, key, kind, passage, sections, windows, range, nextWin, textKey, retry, audio]);
  const page = text?.key === textKey ? text.page : undefined, preview = text?.key === textKey ? text.preview ?? null : null;
  // Print's labels ("Aliyah 4", "Maftir") above the verse where a section begins on this page, in either lens.
  const labels = useMemo(() => page && sections.length ? labelsIn(sections, range.section, page.offset, page.offset + page.verses.length) : NO_LABELS, [page, sections, range.section]);
  const linkedOnPage = page && linkedIndex !== null && linkedIndex >= page.offset && linkedIndex < page.offset + page.verses.length ? linkedIndex - page.offset : null;
  // Commentary follows the text, never in its way: Rashi loads after the verses (for Lein's "Rashi (n)" too),
  // the Women's Commentary only when Study shows it on a Torah text.
  const refs = useMemo(() => page?.verses.map(row => row.ref) ?? [], [page]);
  // The verse the reader is on, told to the page so a whole portion (and the way back) opens at the same place.
  const onPlace = useRef(choose?.onPlace); onPlace.current = choose?.onPlace;
  useEffect(() => { const ref = focus !== null && page?.verses[focus] ? page.verses[focus].ref : null; if (ref) onPlace.current?.(ref); }, [focus, page]);
  const corpus = kind === "torah" ? "torah" : "neviim";
  const { rashi, works } = useReadingWorks(refs, { ready: Boolean(page), study, chosen: lens.works, corpus });
  const leinLink = useCommentLink(), clearLink = leinLink.clear;
  // A pinned underline belongs to the verse it was pinned on; choosing another verse lets it go.
  useEffect(() => { clearLink(); }, [focus, textKey, clearLink]);
  useLayoutEffect(() => { if (lift) audio.stopAll(); }, [lift?.opening, audio]); // eslint-disable-line react-hooks/exhaustive-deps
  // The deep-linked verse, once its page is on screen: selected, in view, and in Word tools.
  useEffect(() => {
    if (linkedOnPage === null || !page || linkShown.current) return;
    linkShown.current = true; setFocus(linkedOnPage); tools.current?.selectVerse(linkedOnPage);
    try { document.querySelector(`[data-verse-ref="${CSS.escape(page.verses[linkedOnPage].ref)}"]`)?.scrollIntoView({ block: "center" }); } catch { /* Stay where the page is. */ }
  }, [linkedOnPage, page]);

  const loadShort = useCallback(async (at: number, signal: AbortSignal) => {
    if (!page || !page.verses[at]) throw new PortalRequestError(409);
    // Recordings come by the server's pages, whatever the text page is: the verse's place in the whole passage finds its page and its place on it.
    const position = page.offset + at, served = passage.pages.filter(row => row.offset <= position).at(-1);
    if (!served) throw new PortalRequestError(409);
    const shortKey = JSON.stringify([key, kind, served.offset]);
    let work = shortPages.current.get(shortKey);
    if (!work) { work = fetchPublicShortPage(source, served.offset, new AbortController().signal); shortPages.current.set(shortKey, work); void work.catch(() => shortPages.current.delete(shortKey)); }
    const result = await work; if (signal.aborted) throw new PortalRequestError(409);
    return result.references[position - served.offset];
  }, [source, key, kind, page, passage]);
  const hear = (at: number, word: ReadingSelection = "verse") => release(() => {
    setFocus(at); setDrillTarget(null); playback.current?.select(at, word);
    if (word === "verse") tools.current?.selectVerse(at); else tools.current?.select(at, word);
  });
  const chooseWord = (at: number, word: number) => release(() => { setFocus(at); setDrillTarget(null); if (listening) playMainVerseForWord(playback.current, tools.current, at, word); else { tools.current?.select(at, word); tools.current?.reveal(); } });
  const changeIndex = (next: number) => { if (next === index) return; pendingJump.current = null; audio.stopAll(); setLift(null); setFocus(null); setDrill(null); setDrillTarget(null); setWin(0); onIndex(next); };
  // To another text page. A section is told to the page (it names the address), even when it is the one already open.
  const changeWin = (next: number) => {
    const target = windows[next]; if (!target) return;
    if (target.section >= 0) onSection?.(sections[target.section].n);
    if (next === win) return;
    if (linkedIndex !== null) onVerseLeft();
    // 1.9 N16 re-measure (INP): the tab answers the tap at once; the new section's verses render as a transition behind it.
    setDrillTarget(null); setPendingTab(target.section >= 0 ? sections[target.section].n : null);
    startTransition(() => { setWin(next); setPendingTab(null); });
  };
  const previousWin = win > 0 ? win - 1 : undefined, nextStart = nextWin === null ? null : windows[nextWin].start;
  // The haftarah's last verse takes the closing (sof haftarah) melody, as in the assigned reading.
  const assignment = useMemo(() => ({ kind, confirmed: kind === "haftarah", verses: allVerses }), [kind, allVerses]);
  const scopeKey = textKey;
  // Study's word card (1.7): the text page tells the verse panel how to read word details; a tap in Lein never reaches it.
  const wordHost: WordPanelHost | null = page && study ? { scopeKey, verses: page.verses,
    readAids: (at, signal) => fetchPublicWordAids(source, page.offset + at, page.verses[at], signal),
    readDetails: (at, word, signal) => fetchPublicWordDetails(source, page.offset + at, page.verses[at], word, signal),
    onHear: listening ? (at, word) => hear(at, word) : undefined,
    onVisit: ref => { const at = page.verses.findIndex(row => row.ref === ref); if (at >= 0) release(() => setFocus(at)); },
    reveal: ref => jumpTo(ref) } : null;
  // The chapter jump: a verse on this text page is scrolled to; one on another page loads that page first.
  const pendingJump = useRef<string | null>(null);
  const jumpTo = (ref: string) => release(() => {
    if (page?.verses.some(row => row.ref === ref)) { scrollToVerse(ref); return; }
    const position = allVerses.indexOf(ref), target = position < 0 ? -1 : windowAt(position);
    if (target >= 0 && target !== win) { pendingJump.current = ref; changeWin(target); }
  });
  useEffect(() => { const ref = pendingJump.current; if (page && ref && page.verses.some(row => row.ref === ref)) { pendingJump.current = null; scrollToVerse(ref); } }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus follows the reader into the text (D10, F-SITE 25): to the first verse's own button when verses can be heard, else to the labelled
  // reading itself. Without this, Start reading or a new text page leaves focus on the control that was pressed, or on nothing.
  const focusReading = () => {
    const anchor = textAnchor.current; if (!anchor) return;
    anchor.scrollIntoView({ block: "start" });
    const target = anchor.querySelector<HTMLElement>(".study-verses [data-verse-ref] button[aria-label^='Hear ']:not([disabled])") ?? anchor.querySelector<HTMLElement>(".study-verses") ?? anchor;
    target.focus({ preventScroll: true });
  };
  const start = useRef<() => void>(() => {}); start.current = () => { if (listening && page) hear(0); focusReading(); };
  // The page the pager is taking the reader to: focus waits until that page's verses have rendered (the switch is a transition, 1.9 N16).
  const pagerFocus = useRef<number | null>(null), pagerTo = (next: number) => { pagerFocus.current = next; changeWin(next); };
  // An outline line of the portion summary: that aliyah's page, with focus on its first verse; the aliyah already open only takes the reader to its text.
  const goAliyah = (n: string) => { const at = sections.findIndex(row => row.n === n); if (at < 0) return; if (at === win) focusReading(); else pagerTo(at); };
  useEffect(() => { if (page && pagerFocus.current !== null && pagerFocus.current === win) { pagerFocus.current = null; focusReading(); } }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { registerStart(page ? () => start.current() : null); return () => registerStart(null); }, [page, registerStart]);

  // The drill follows the selected verse. Reveal, Hide again and End drill never start or stop audio; Next verse stops the old verse's audio
  // (Play is then set to the new verse) and starts nothing. Study ends the drill.
  const drillVerse = !study && drill && focus !== null ? page?.verses[focus] ?? null : null;
  useEffect(() => { if (study) setDrill(null); }, [study]);
  // Choosing another verse hides the English again: a reveal belongs to the verse it was made on.
  const drillRef = drillVerse?.ref ?? null;
  useEffect(() => { setDrill(current => current?.revealed && current.revealed !== drillRef ? { revealed: null } : current); }, [drillRef]);
  const drillGo = (at: number) => {
    if (!page?.verses[at]) return;
    const ref = page.verses[at].ref;
    release(() => { setFocus(at); tools.current?.selectVerse(at); });
    // Play follows the verse the drill is on, never the one last played; setting the target stops audio still playing the old verse and starts nothing.
    setDrillTarget({ index: at, generation: ++drillGeneration.current }); drillScroll.current = true;
    setDrill({ revealed: null }); setAnnounce(DRILL_STRINGS.moved(/:([1-9]\d*)$/.exec(ref)?.[1] ?? ref)); drillFocus.current = "reveal";
    try { document.querySelector(`.study-verses [data-verse-ref="${CSS.escape(ref)}"]`)?.scrollIntoView({ block: "start" }); } catch { /* Stay where the page is. */ }
  };
  // Next verse or Start from the first verse onto another text page: once that page is on screen, its first verse.
  useEffect(() => { if (page && drillToPage.current) { drillToPage.current = false; drillGo(0); } }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  const drillStart = () => { if (!drillVerse && focus !== null && page?.verses[focus]) { drillHint.current ??= page.verses[focus].ref; setLift(null); setAnnounce(""); setDrill({ revealed: null }); } };
  const drillEnd = () => { setDrill(null); setAnnounce(""); drillFocus.current = "toggle"; };
  const drillNextVerse = () => {
    if (!page || focus === null) return;
    const step = drillNext(focus, page.verses.length, nextStart);
    if (step === "on-page") drillGo(focus + 1);
    else if (step === "next-page" && nextWin !== null) { drillToPage.current = true; changeWin(nextWin); }
  };
  const drillRestart = () => { if (!page) return; if (win === 0) drillGo(0); else { drillToPage.current = true; changeWin(0); } };
  const drillPanel = drillVerse && focus !== null && page && <TranslateDrillPanel verseRef={drillVerse.ref} english={drillVerse.english} revealed={drill?.revealed === drillVerse.ref}
    hint={drillHint.current === drillVerse.ref} last={drillNext(focus, page.verses.length, nextStart) === "last"} announce={announce}
    jpsRef={jpsRef} revealRef={revealRef}
    onReveal={() => { setDrill({ revealed: drillVerse.ref }); setAnnounce(DRILL_STRINGS.shown); drillFocus.current = "jps"; }}
    onHide={() => { setDrill({ revealed: null }); setAnnounce(DRILL_STRINGS.hidden); drillFocus.current = "reveal"; }}
    onNext={drillNextVerse} onRestart={drillRestart} onEnd={drillEnd} />;

  return <VersePanelScope passage={discussionPassage}>
    <WordPanelSource host={wordHost} />
    <div className="reading-lens-row">
      {sources.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">
        {sources.map((row, at) => <button key={at} type="button" className="button-secondary" aria-pressed={at === index} onClick={() => changeIndex(at)}>{row.label}</button>)}
      </div>}
      <LensSwitch onChange={() => leinLink.clear()} />
    </div>
    {(choice.button || choice.extra || portion) && !more && <div className={styles.chooseRow}>{portion}{choice.button}{choice.extra}</div>}
    {/* With a More sheet (N5) the Portion control and Choose verses live in it, put there while it is open. */}
    {more?.slot && createPortal(<>{portion}{choice.button}{choice.extra}
      {/* Go to verse: a chapter of this reading, from the sheet. The sheet closes first, then the text scrolls there and focus goes to it. */}
      {chapters.length > 1 && <label className={styles.goTo}><span>Go to verse</span>
        <select aria-label="Go to verse" value="" onChange={event => { const next = chapters.find(row => row.key === event.target.value); if (next) more.close(() => { jumpTo(next.first); focusVerse(next.first); }); }}>
          <option value="" disabled>Chapter</option>{chapters.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select></label>}</>, more.slot)}
    {/* The portion summary (1.9 N7): atop Study, only an approved one, only on a parashah's Torah. Its outline goes to an aliyah where the page has it as a section. */}
    {study && kind === "torah" && summary && <PortionSummaryBlock summary={summary} aliyot={summaryJump ? sections.map(row => row.n) : undefined} onAliyah={goAliyah} />}
    {/* Curated discussions (1.7 M6b), in Study, only where this passage has any: one tap to the Sheet here; on a laptop they are the column beside the verses, below. */}
    <SourcesButton />
    {sources.length > 1 && !more && <p className={`field-help ${styles.passageNote}`}><bdi dir="ltr">{displayRange(passage.ranges)}</bdi></p>}
    {/* The section chips (N3): a tab for each aliyah, in the sticky bar above the text. The page below changes with the tab, so one panel serves them all. */}
    {/* 1.9 N16 re-measure (axe heading-order): the outline above the verses' own level-4 headings, said only to assistive technology. */}
    <h2 className="sr-only">{kind === "torah" ? "Torah" : "Haftarah"}</h2>
    <h3 className="sr-only">{sections[range.section]?.label ?? displayRange(passage.ranges)}</h3>
    {sections.length > 0 && <SectionTabs sticky label="Reading sections" panelId={`${group}-section`} current={pendingTab ?? sections[range.section]?.n ?? null}
      tabs={sections.map(row => ({ id: row.n, label: row.label }))} onSelect={n => changeWin(sections.findIndex(row => row.n === n))} />}
    <div className="reading-passage-layout" data-reading-text="" id={sections.length > 0 ? `${group}-section` : undefined} role={sections.length > 0 ? "tabpanel" : undefined} aria-label={sections.length > 0 ? sections[range.section]?.label : undefined} ref={textAnchor} tabIndex={-1}>
      <ReadingToolbar englishHidden={Boolean(drillVerse)} listeningEnabled={listening} tikkunAvailable={kind === "torah"} worksCorpus={corpus} onHear={listening && page ? () => hear(focus ?? 0) : undefined} />
      <section className="assigned-study" aria-label={kind === "torah" ? "Torah text" : "Haftarah text"} data-size={prefs.size}>
        {!page ? text?.key === textKey && text.error ? <div role="status"><h4>Text unavailable</h4><p>{text.error === 429 ? RATE_LIMITED_MESSAGE : "The verses didn’t load. Check your connection and try again."}</p><button type="button" className="button-secondary" onClick={onRetry}>Reload text</button></div>
          : <p role="status">Loading the text…</p> : <>
          {study ? <>
            <CommentaryStatus works={workStatuses(works, corpus)} />
            <ReadingPlace refs={allVerses} pageKey={textKey} onJump={jumpTo} onHere={choose?.onPlace ? ref => onPlace.current?.(ref) : undefined} />
            <StudyRows verses={page.verses} assignment={assignment} group={group} activeWord={playingWord} listening={listening} showEnglish={lens.english} sections={labels}
              works={ref => works.map(row => ({ work: row.work, state: row.lookup.forVerse(ref) }))}
              onVerse={listening ? at => hear(at) : undefined} onWord={chooseWord} choice={choice.view} />
          </> : <FlowingStudyText verses={page.verses} assignment={assignment} group={group} activeWord={playingWord} listening={listening} showEnglish={prefs.translation} englishHidden={drillVerse ? DRILL_STRINGS.hidden : undefined} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
            sections={labels} linked={linkedVerse(leinLink, page.verses)} onVerse={listening ? at => hear(at) : undefined} onWord={chooseWord} choice={choice.view} />}
          {/* The end of the section (N3): the next one's first verse, faint, and the way on. */}
          {sections.length > 0 && nextWin !== null && <NextSection onNext={() => pagerTo(nextWin)} preview={preview} />}
          {listening && <ReadingPlayer key={`player:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} active={!lift} enabled={!lift} audio={{ coordinator: audio, slot: "proposed" }}
            target={drillTarget ?? (linkedOnPage !== null ? { index: linkedOnPage, generation: 0 } : undefined)} register={registerPlayback} onActiveWord={setPlayingWord} load={loadShort} />}
          <WordTools key={`tools:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} register={registerTools}
            readAids={(at, signal) => fetchPublicWordAids(source, page.offset + at, page.verses[at], signal)}
            readDetails={(at, word, signal) => fetchPublicWordDetails(source, page.offset + at, page.verses[at], word, signal)}
            onHear={listening ? (at, word) => hear(at, word) : undefined}
            onPlace={(ref, wordIndex) => {
              const here = page.verses.findIndex(row => row.ref === ref), position = allVerses.indexOf(ref);
              if (here >= 0) { tools.current?.select(here, wordIndex); return; }
              const target = position < 0 ? -1 : windowAt(position);
              if (target >= 0 && target !== win) { pendingPlace.current = { key: keyOf(windows[target]), ref, wordIndex }; changeWin(target); }
            }}
            takePlace={() => { const place = pendingPlace.current; pendingPlace.current = null; return place && place.key === scopeKey ? { ref: place.ref, wordIndex: place.wordIndex } : null; }} />
          {/* While the drill is on, Rashi (whose English carries a translation) is closed away; ending it shows Rashi as it was. */}
          {!study && <div hidden={Boolean(drillVerse)}><VerseRashi key={focus !== null ? page.verses[focus]?.ref : "none"} verse={focus !== null ? page.verses[focus] ?? null : null} state={focus !== null && page.verses[focus] ? rashi.lookup.forVerse(page.verses[focus].ref) : { status: "none" }} link={leinLink} retry={rashi.retry} /></div>}
          {!study && verseExtra && focus !== null && page.verses[focus] && verseExtra(page.verses[focus].ref)}
          {!study && focus !== null && page.verses[focus] && <div className={drillStyles.control}>
            <button type="button" ref={drillToggle} className={drillStyles.toggle} aria-pressed={Boolean(drillVerse)} onClick={() => drillVerse ? drillEnd() : drillStart()}>{DRILL_STRINGS.control}</button>
            {drillPanel}
          </div>}
          {/* Up close shows the English too, so it waits while the drill is on. */}
          {!drillVerse && focus !== null && page.verses[focus] && <p className={styles.upClose}><button type="button" className="button-secondary" onClick={() => release(() => setLift({ index: focus, opening: ++openings.current, navigation: 0 }))}>{/* One span: the button is a flex box, which would drop the spaces between separate text items. */}<span>View <bdi dir="ltr">{page.verses[focus].ref}</bdi> up close</span></button>
            <span className="field-help">Up close shows each phrase of trope by name.</span></p>}
          {sections.length === 0 && (previousWin !== undefined || nextWin !== null) && <>
            <p className="study-page-position" data-testid="page-position" data-page-first={page.offset + 1} data-page-last={page.offset + page.verses.length} data-page-total={page.totalVerses}>Verses {page.offset + 1}–{page.offset + page.verses.length} of {page.totalVerses}</p>
            <nav className="study-pages" aria-label="Text pages"><button type="button" className="button-secondary" disabled={previousWin === undefined} onClick={() => previousWin !== undefined && pagerTo(previousWin)}>Previous text page</button>
              <button type="button" className="button-secondary" disabled={nextWin === null} onClick={() => nextWin !== null && pagerTo(nextWin)}>Next text page</button></nav></>}
          {study && <CommentaryCredits works={works} refs={refs} />}
          {foot}
          <div className="study-more"><StudyCredits chapters={page.chapters} summary="About this text" /><a href="/trope-chart">Trope chart</a></div>
          {choice.bar}
          {lift && page.verses[lift.index] && <LiftedLine learner verses={page.verses} assignment={assignment} index={lift.index} total={page.totalVerses} offset={page.offset}
            reference={listening ? { audio, active: true, navigation: lift.navigation, scopeKey: JSON.stringify([scopeKey, lift.opening]), load: loadShort } : undefined}
            onIndex={at => setLift(value => value && { index: at, opening: value.opening, navigation: value.navigation + 1 })} onClose={() => { audio.stopAll(); setLift(null); }} />}
        </>}
      </section>
      {/* The sources column (1.9 N7): on a laptop, to the right of the verses (the layout's third column); a phone has the button above instead. */}
      <DiscussionList />
    </div>
  </VersePanelScope>;
}
