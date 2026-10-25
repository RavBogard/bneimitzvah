"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { PortalRequestError } from "../api";
import { RATE_LIMITED_MESSAGE } from "../public-reading/rate-limited";
import { fetchPublicRefReading, fetchPublicText, fetchPublicWeek, refSource, weekSource, type PublicSource } from "../public-reading/api";
import { ReadingChooser } from "../public-reading/reading-chooser";
import { useProductName } from "../public-reading/product-name";
import { displayRange, replaceAddress, useDocumentTitle } from "../public-reading/view";
import { fetchSavedReadings, type SavedReading } from "../saved/api";
import { SavedReadingState } from "../saved/saved-reading";
import { icons } from "../workspace/study/lift";
import type { StudyVerse } from "../workspace/study/api";
import type { StudyChapter } from "../workspace/study/credits";
import { namedReading } from "../../../lib/readings/named-readings";
import { addDays, shabbatOnOrAfter, thisShabbat } from "../../../lib/readings/public-shabbat";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { pageTitle } from "../../../lib/site/product-name";
import { aliyahStartsIn, portionLabel, portionPicks, portionRef, type PortionPick, type WeekPortions } from "../../../lib/print/portions";
import { parsePrintAddress, printAddress, printTargetFromRead, readAddressOfPrint, type PrintTarget } from "../../../lib/print/print-address";
import { COMMENTARY_CHOICES, DEFAULT_FORMAT, normalizeCommentary, type SheetFormat } from "../../../lib/print/sheet-format";
import { appendixChapters, buildAppendix, printableCoverage, type AppendixGroup } from "../../../lib/print/appendix";
import { createCommentaryChapterStore } from "../workspace/study/commentary-api";
import { fetchDiscussions, type DiscussionPassage } from "../workspace/study/discussions-api";
import { DISCUSSION_LABELS } from "../../../lib/discussions/labels";
import type { DiscussionsAnswer } from "../../../lib/discussions/answer";
import { commentarySummary } from "../workspace/study/commentary-text";
import { workLabel } from "../workspace/reading-toolbar";
import { fetchPublicAliyot } from "./api";
import { PrintDocument, type SheetHeading, type SheetText } from "./document";
import styles from "./print.module.css";
// The Hebrew face's @font-face, which the sheet's own type needs whatever else the page loads.
import "../../../styles/hebrew-font.module.css";

const MAX_PAGES = 10; // A passage is at most 1,000 verses, 100 to a text page.
const kindName = (kind: "torah" | "haftarah") => kind === "torah" ? "Torah" : "Haftarah";
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;

/** What a Shabbat offers the reading controls: which texts it has, and its calendar aliyot when they loaded. */
type Week = Readonly<{ date: string; torah: boolean; haftarah: boolean; kind: "torah" | "haftarah"; portions: WeekPortions | null; pick: PortionPick }>;
type Sheet = Readonly<{ heading: SheetHeading; text: SheetText; markers: ReadonlyMap<string, string>; week: Week | null;
  /** The passage printed, as its curated discussions are asked for. */
  passage: DiscussionPassage }>;
type Load = Readonly<{ key: string } & ({ status: "loading" } | { status: "ready"; sheet: Sheet } | { status: "failed"; code: number; week: Week | null }
  | { status: "saved"; state: "signed-out" | "not-eligible" | "missing" | "failed" } | { status: "empty"; week: Week })>;

class NoReading extends Error { constructor(readonly week: Week) { super("No reading"); } }
class SavedUnavailable extends Error { constructor(readonly state: "signed-out" | "not-eligible" | "missing") { super("Saved reading unavailable"); } }

async function loadText(source: PublicSource, signal: AbortSignal): Promise<SheetText> {
  const verses: StudyVerse[] = [], chapters: StudyChapter[] = [];
  for (const [index, page] of source.passage.pages.entries()) {
    if (index === MAX_PAGES) throw new PortalRequestError(503);
    const value = await fetchPublicText(source, page.offset, signal);
    verses.push(...value.verses);
    chapters.push(...value.chapters.filter(chapter => !chapters.some(row => row.ref === chapter.ref)));
  }
  return Object.freeze({ verses: Object.freeze(verses), chapters: Object.freeze(chapters) });
}
const passageOf = (source: PublicSource): DiscussionPassage => ({ ref: source.passage.ranges.join("; "), kind: source.passage.kind });
const versesOf = (source: PublicSource) => { try { return expandReadingRanges(source.passage.ranges, source.passage.kind, TANAKH_VERSE_COUNTS); } catch { return []; } };

/** Everything the sheet shows for a reading: its heading, every verse, and where its aliyot begin. Public routes only, except a member's own saved reading. */
async function loadSheet(target: PrintTarget, today: string, signal: AbortSignal): Promise<Sheet> {
  if (target.mode === "week") {
    const date = target.date ?? today, value = await fetchPublicWeek(date, signal);
    const kind = target.kind ?? (value.torah ? "torah" : "haftarah");
    // The aliyot only mark the sheet; a calendar that does not answer leaves it unmarked, never unprinted.
    const portions = kind === "torah" && value.torah ? await fetchPublicAliyot(date, signal).catch(error => { if (signal.aborted) throw error; return null; }) : null;
    // A part of the reading needs the calendar's aliyot: without them the sheet says it did not load, never prints the whole parashah instead.
    if (target.pick !== "full" && !portions) throw new PortalRequestError(503);
    const ref = target.pick !== "full" && portions ? portionRef(portions, target.pick) : null, pick: PortionPick = ref ? target.pick : "full";
    const week: Week = Object.freeze({ date, torah: value.torah !== null, haftarah: value.haftarah !== null, kind, portions, pick });
    const source = ref ? refSource(await fetchPublicRefReading(ref, "torah", signal)) : weekSource(value, kind);
    if (!source) throw new NoReading(week);
    const text = await loadText(source, signal);
    return { heading: { title: value.parashah ?? "Shabbat reading", passage: `${kindName(kind)} ${displayRange(source.passage.ranges)}`, date }, text, week,
      markers: portions ? aliyahStartsIn(portions, pick, versesOf(source)) : new Map(), passage: passageOf(source) };
  }
  if (target.mode === "named") {
    const reading = namedReading(target.slug), passage = reading?.passages[target.passage - 1];
    if (!reading || !passage) throw new PortalRequestError(400);
    const source = refSource(await fetchPublicRefReading(passage.ref, passage.kind, signal));
    return { heading: { title: reading.name, passage: `${passage.label} ${displayRange([passage.ref])}`, date: null }, text: await loadText(source, signal), markers: new Map(), week: null, passage: passageOf(source) };
  }
  if (target.mode === "ref") {
    const source = refSource(await fetchPublicRefReading(target.ref, target.kind, signal));
    return { heading: { title: displayRange([target.ref]), passage: kindName(target.kind), date: null }, text: await loadText(source, signal), markers: new Map(), week: null, passage: passageOf(source) };
  }
  // A member's own saved reading: its passage comes from the account, the text from the public routes.
  const list = await fetchSavedReadings(signal);
  if (list.state !== "ready") throw new SavedUnavailable(list.state);
  const saved = list.readings.find(row => row.id === target.id);
  if (!saved) throw new SavedUnavailable("missing");
  const source = refSource(await fetchPublicRefReading(saved.ranges, saved.kind, signal));
  return { heading: { title: saved.name, passage: `${kindName(saved.kind)} ${displayRange([saved.ranges])}`, date: saved.date }, text: await loadText(source, signal), markers: new Map(), week: null, passage: passageOf(source) };
}

/** Printing waits for the Hebrew face, as the practice sheet does: a fallback serif would misplace the trope. */
async function fontsReady() {
  const loaded = await document.fonts.load('400 32px "CRC Noto Serif Hebrew"', "אבג");
  if (!loaded.length || !loaded.every(font => font.status === "loaded")) throw new Error("Sheet font unavailable");
}

/** One choice of several, as a row of pills made of real radio buttons. */
function Choice<T extends string>({ legend, name, value, options, onChange, disabled = false, stack = false }: {
  legend: string; name: string; value: T; options: readonly (readonly [T, string])[]; onChange(value: T): void; disabled?: boolean; stack?: boolean;
}) {
  const id = useId();
  return <fieldset className={styles.group} disabled={disabled}>
    <legend>{legend}</legend>
    <div className={styles.track} data-stack={stack || undefined}>{options.map(([option, label]) => <label key={option}>
      <input type="radio" name={`${id}-${name}`} value={option} checked={value === option} onChange={() => onChange(option)} />{label}
    </label>)}</div>
  </fieldset>;
}

/** The size of the printed page in CSS, from enumerated values only (no reading text ever enters a style rule). */
function pageRule(format: SheetFormat) {
  const size = `${format.paper === "letter" ? "letter" : "A4"} ${format.orientation}`, margin = format.paper === "letter" ? "0.5in 0.55in 0.6in" : "12.7mm 14mm 15mm";
  return `@page reader-sheet { size: ${size}; margin: ${margin}; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Bricolage Grotesque", system-ui, sans-serif; color: #4b5a6b; } }`;
}

type WorkProgress = Readonly<{ work: string; status: "none" | "loading" | "failed" | "ready" }>;
/**
 * The chosen commentary works for a loaded reading, fetched through the same chapter store Study uses (public route, same cache,
 * nothing new) and filtered for print (appendix.ts). Only works that can print on this reading are fetched. `retry` asks again.
 */
function useAppendix(sheet: Sheet | null, format: SheetFormat, discussions: DiscussionsAnswer | null) {
  const refs = useMemo(() => sheet ? sheet.text.verses.map(verse => verse.ref) : [], [sheet]);
  const works = useMemo(() => format.commentary.filter(work => printableCoverage(work, refs) === "printable"), [format.commentary, refs]);
  const [attempt, setAttempt] = useState(0), [version, setVersion] = useState(0);
  const stores = useMemo(() => new Map(works.map(work => [work, createCommentaryChapterStore(work)] as const)), [works, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cleanups = [...stores].map(([work, store]) => store.load(appendixChapters(work, refs), () => setVersion(value => value + 1)));
    return () => { for (const cleanup of cleanups) cleanup(); };
  }, [stores, refs]);
  return useMemo(() => {
    const sources = [...stores].map(([work, store]) => ({ work, label: workLabel(work), forVerse: (ref: string) => store.forVerse(ref) }));
    const progress: WorkProgress[] = sources.map(source => ({ work: source.work, status: commentarySummary(refs.map(ref => source.forVerse(ref))) }));
    const included = format.discussions ? discussions : null;
    const groups: readonly AppendixGroup[] = format.commentary.length || included ? buildAppendix(refs, sources, format.show, included) : [];
    return { groups, progress, retry: () => setAttempt(value => value + 1) };
  }, [stores, refs, format.commentary, format.show, format.discussions, discussions, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The printed passage's curated discussions (public route, the same answer signed in or out), asked for once the sheet loads so the sheet can offer
 * them only where the reading has any. They join the appendix only when the format says so; `answer` is null when there is nothing to offer.
 */
function useSheetDiscussions(sheet: Sheet | null) {
  const passage = sheet?.passage ?? null, key = passage ? JSON.stringify([passage.ref, passage.kind]) : null;
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<{ key: string; answer?: DiscussionsAnswer } | null>(null);
  useEffect(() => {
    if (!passage || !key) return;
    const controller = new AbortController();
    fetchDiscussions(passage, controller.signal).then(answer => { if (!controller.signal.aborted) setState({ key, answer }); }, () => { if (!controller.signal.aborted) setState({ key }); });
    return () => controller.abort();
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = state?.key === key ? state : null;
  return { answer: current?.answer?.discussions.length && current.answer.productName ? current.answer : null, status: !key ? "none" as const : !current ? "loading" as const : current.answer ? "ready" as const : "failed" as const,
    retry: () => { setState(null); setAttempt(value => value + 1); } };
}

/**
 * The reader's print sheet (Daniel, 2026-10-23): a reading laid out for the Torah table, Hebrew and English side by side,
 * in the format the address names. With no address it is this coming Shabbat's Torah reading in the default format.
 * Changing the format redraws the paper at once; changing the reading loads its text. One Print button prints it.
 */
export function PrintSheetPage() {
  const productName = useProductName();
  const [today, setToday] = useState<string | null>(null), [target, setTarget] = useState<PrintTarget | null | undefined>(undefined), [format, setFormat] = useState<SheetFormat>(DEFAULT_FORMAT);
  const [load, setLoad] = useState<Load | null>(null), [retry, setRetry] = useState(0), [chooser, setChooser] = useState(false), [printing, setPrinting] = useState<"idle" | "preparing" | "error">("idle");
  const chooserId = useId(), gate = useRef(false);
  useEffect(() => { const parsed = parsePrintAddress(window.location.search); setToday(thisShabbat()); setTarget(parsed.target); setFormat(parsed.format); if (!parsed.target) setChooser(true); }, []);
  useEffect(() => { if (target && today) replaceAddress(printAddress(target, format, { today })); }, [target, format, today]);
  const key = target && today ? JSON.stringify([target, today, retry]) : null;
  useEffect(() => {
    if (!target || !today || !key) return;
    const controller = new AbortController();
    setLoad({ key, status: "loading" });
    loadSheet(target, today, controller.signal).then(sheet => { if (!controller.signal.aborted) setLoad({ key, status: "ready", sheet }); }, error => {
      if (controller.signal.aborted) return;
      if (error instanceof NoReading) setLoad({ key, status: "empty", week: error.week });
      else if (error instanceof SavedUnavailable) setLoad({ key, status: "saved", state: error.state });
      else if (target.mode === "saved") setLoad({ key, status: "saved", state: "failed" });
      else setLoad({ key, status: "failed", code: statusOf(error), week: null });
    });
    return () => controller.abort();
  }, [target, today, key]);
  const current = load && load.key === key ? load : null;
  const sheet = current?.status === "ready" ? current.sheet : null;
  const week = sheet?.week ?? (current?.status === "empty" ? current.week : null);
  const discussions = useSheetDiscussions(sheet);
  const appendix = useAppendix(sheet, format, discussions.answer);
  // Printing waits for the commentary and the discussions chosen: a sheet printed before (or without) one would silently lack it.
  const commentaryPending = appendix.progress.some(row => row.status === "loading" || row.status === "failed") || format.discussions && (discussions.status === "loading" || discussions.status === "failed");
  // A saved reading's own name stays on the page; the tab title (and so history and a saved PDF's name) says "My reading", as /read does.
  useDocumentTitle(pageTitle(productName, ...(target?.mode === "saved" ? ["My reading"] : sheet ? [sheet.heading.title] : []), "Print"));

  const set = <K extends keyof SheetFormat>(field: K, value: SheetFormat[K]) => setFormat(value === format[field] ? format : Object.freeze({ ...format, [field]: value }));
  const open = (next: PrintTarget) => { setTarget(next); setChooser(false); setPrinting("idle"); };
  const weekTarget = (date: string, kind: "torah" | "haftarah" | null = null, pick: PortionPick = "full"): PrintTarget => ({ mode: "week", date, kind, pick });
  const shownDate = target?.mode === "week" ? target.date ?? today : null;
  async function print() {
    if (gate.current || !sheet || commentaryPending) return;
    gate.current = true; setPrinting("preparing");
    try { await fontsReady(); setPrinting("idle"); window.print(); }
    catch { setPrinting("error"); }
    finally { gate.current = false; }
  }

  const title = sheet ? sheet.heading.title : current?.status === "failed" || current?.status === "saved" || target === null ? "Reading unavailable" : current?.status === "empty" ? "No reading to show for this Shabbat" : "Loading the reading";
  return <div className={`portal-shell ${styles.root}`}>
    <style>{pageRule(format)}</style>
    <a className={`skip-link ${styles.screenOnly}`} href="#print-sheet-paper">Skip to the reading</a>
    <header className={`portal-header app-bar ${styles.screenOnly}`}><a className="portal-brand" href="/">{productName}</a></header>
    <main className="workspace-main">
      <header className={`reading-hero ${styles.screenOnly}`}>
        <h1 className="hero-reference">{title}</h1>
        {sheet && <p className="hero-meta">{sheet.heading.date && <><time dateTime={sheet.heading.date}>{longDate(sheet.heading.date)}</time> · </>}<bdi dir="ltr">{sheet.heading.passage}</bdi></p>}
        {shownDate && today && <nav className={styles.weeks} aria-label="Choose a reading">
          <button type="button" className="button-hero-secondary" onClick={() => open(weekTarget(addDays(shownDate, -7)))}>Previous week</button>
          {shownDate !== today && <button type="button" className="button-hero-secondary" onClick={() => open(weekTarget(today))}>This week</button>}
          <button type="button" className="button-hero-secondary" onClick={() => open(weekTarget(addDays(shownDate, 7)))}>Next week</button>
        </nav>}
        <div className="hero-actions">
          <button type="button" className={`button-start ${styles.printButton}`} disabled={!sheet || printing === "preparing" || commentaryPending} onClick={() => void print()}>{icons.print}<span>Print</span></button>
          <button type="button" className="button-hero-secondary" aria-expanded={chooser} aria-controls={chooserId} onClick={() => setChooser(value => !value)}>Choose a reading</button>
          {target && today && <a className="button-hero-secondary" href={readAddressOfPrint(target, today)}>Back to the reading</a>}
          {target?.mode !== "week" && today && <button type="button" className="button-hero-secondary" onClick={() => open(weekTarget(today))}>This week</button>}
        </div>
        <p role="status" className={styles.status}>{printing === "preparing" ? "Getting the Hebrew ready to print…" : printing === "error" ? "The Hebrew lettering didn’t load. Reload the page, then print again." : ""}</p>
      </header>
      <div id={chooserId} className={styles.screenOnly} hidden={!chooser}>{chooser && <>
        <ReadingChooser id={`${chooserId}-panel`} study={false} onOpen={address => { const next = printTargetFromRead(address); if (next) open(next); }} />
        <MyReadings onOpen={reading => open({ mode: "saved", id: reading.id })} />
      </>}</div>
      <div className={styles.layout}>
        <form className={`${styles.settings} ${styles.screenOnly}`} aria-labelledby={`${chooserId}-settings`} onSubmit={event => event.preventDefault()}>
          <h2 id={`${chooserId}-settings`}>Sheet</h2>
          {week && <ReadingControls week={week} today={today} onOpen={open} />}
          <Choice stack legend="Languages" name="show" value={format.show} onChange={value => set("show", value)}
            options={[["both", "Hebrew and English"], ["hebrew", "Hebrew"], ["english", "English"]]} />
          {format.show !== "hebrew" && <p className={styles.help}>English: JPS 2023.</p>}
          <Choice stack legend="Hebrew" name="script" value={format.script} onChange={value => set("script", value)} disabled={format.show === "english"}
            options={[["full", "Vowels and trope"], ["vowels", "Vowels only"], ["letters", "Letters only"]]} />
          <Choice legend="Text size" name="size" value={format.size} onChange={value => set("size", value)}
            options={[["small", "Small"], ["standard", "Standard"], ["large", "Large"], ["huge", "Huge"]]} />
          {sheet && sheet.markers.size > 0 && <Choice stack legend="Aliyot" name="aliyot" value={format.aliyot} onChange={value => set("aliyot", value)}
            options={[["marked", "Marked"], ["page", "Each on a new page"]]} />}
          <Choice legend="Notes column" name="notes" value={format.notes} onChange={value => set("notes", value)}
            options={[["none", "None"], ["lined", "Lined"], ["blank", "Blank"]]} />
          <Choice legend="Paper" name="paper" value={format.paper} onChange={value => set("paper", value)} options={[["letter", "Letter"], ["a4", "A4"]]} />
          <Choice legend="Orientation" name="orientation" value={format.orientation} onChange={value => set("orientation", value)} options={[["portrait", "Portrait"], ["landscape", "Landscape"]]} />
          <div className={styles.group}>
            <label className={styles.check}><input type="checkbox" checked={format.numbers} onChange={event => set("numbers", event.currentTarget.checked)} /> Verse numbers</label>
            <label className={styles.check}><input type="checkbox" checked={format.spacing === "standing"} onChange={event => set("spacing", event.currentTarget.checked ? "standing" : "normal")} /> Stand-up spacing</label>
            <p className={styles.help}>More room between lines and darker Hebrew, for a sheet read standing at the Torah.</p>
          </div>
          {sheet && <CommentaryChoices format={format} refs={sheet.text.verses.map(verse => verse.ref)} progress={appendix.progress} retry={appendix.retry}
            onChange={commentary => setFormat(current => Object.freeze({ ...current, commentary }))} />}
          {sheet && <DiscussionChoice on={format.discussions} offered={discussions.answer !== null} status={discussions.status} retry={discussions.retry}
            onChange={value => setFormat(current => Object.freeze({ ...current, discussions: value }))} />}
        </form>
        <div className={styles.paperFrame}>
          <div id="print-sheet-paper" className={styles.paper} data-paper={format.paper} data-orientation={format.orientation} tabIndex={-1}>
            {sheet ? <PrintDocument heading={sheet.heading} text={sheet.text} markers={sheet.markers} format={format} productName={productName} appendix={appendix.groups} />
              : <Status load={current} unavailable={target === null} onRetry={() => setRetry(value => value + 1)} onThisWeek={today ? () => open(weekTarget(today)) : undefined} />}
          </div>
        </div>
      </div>
    </main>
  </div>;
}

/**
 * "Commentary": one checkbox per work that covers this reading (the works Study offers), off by default. A work with no edition licensed
 * for print says so beside it and is never printed; it stays on screen in Study.
 */
function CommentaryChoices({ format, refs, progress, retry, onChange }: {
  format: SheetFormat; refs: readonly string[]; progress: readonly WorkProgress[]; retry(): void; onChange(works: readonly string[]): void;
}) {
  const offered = useMemo(() => COMMENTARY_CHOICES.flatMap(work => { const coverage = printableCoverage(work, refs); return coverage === "uncovered" ? [] : [{ work, printable: coverage === "printable" }]; }), [refs]);
  if (!offered.length) return null;
  return <fieldset className={styles.group}>
    <legend>Commentary</legend>
    <p className={styles.help}>Add commentary after the reading</p>
    {offered.map(({ work, printable }) => {
      const on = printable && format.commentary.includes(work), status = on ? progress.find(row => row.work === work)?.status : undefined;
      return <div key={work} className={styles.workChoice}>
        <label className={styles.check}><input type="checkbox" checked={on} disabled={!printable}
          onChange={event => onChange(normalizeCommentary(event.currentTarget.checked ? [...format.commentary, work] : format.commentary.filter(row => row !== work)))} /> {workLabel(work)}</label>
        {!printable && <p className={styles.help}>Not available for print</p>}
        {status === "loading" && <p className={styles.help} role="status">Loading {workLabel(work)}…</p>}
        {status === "failed" && <p className={styles.help} role="status">{workLabel(work)} isn’t available right now. <button type="button" onClick={retry}>Try again</button></p>}
      </div>;
    })}
  </fieldset>;
}

/**
 * "Sources for this reading", offered where the reading has curated discussions (and while a link that asks for them is waiting on them),
 * off by default. They print in the same appendix, only from editions licensed for print, and Claude translations with their credit.
 */
function DiscussionChoice({ on, offered, status, retry, onChange }: { on: boolean; offered: boolean; status: "none" | "loading" | "ready" | "failed"; retry(): void; onChange(value: boolean): void }) {
  if (!offered && !(on && (status === "loading" || status === "failed"))) return null;
  return <div className={styles.group}>
    <label className={styles.check}><input type="checkbox" checked={on} disabled={!offered} onChange={event => onChange(event.currentTarget.checked)} /> {DISCUSSION_LABELS.list}</label>
    {on && status === "loading" && <p className={styles.help} role="status">Loading {DISCUSSION_LABELS.list}…</p>}
    {on && status === "failed" && <p className={styles.help} role="status">{DISCUSSION_LABELS.list} isn’t available right now. <button type="button" onClick={retry}>Try again</button></p>}
  </div>;
}

function Status({ load, unavailable, onRetry, onThisWeek }: { load: Load | null; unavailable: boolean; onRetry(): void; onThisWeek?: () => void }): ReactNode {
  if (unavailable) return <div className={`workspace-state ${styles.loading}`} role="status"><h2>That reading isn’t available</h2><p>The address doesn’t name a reading this page can open. Choose one, or go back to this week.</p>
    {onThisWeek && <button type="button" className="button-secondary" onClick={onThisWeek}>Go to this week</button>}</div>;
  if (!load || load.status === "loading") return <p className={styles.loading} role="status">Loading the text…</p>;
  if (load.status === "saved") return <SavedReadingState status={load.state} onRetry={onRetry} />;
  if (load.status === "empty") return <div className={`workspace-state ${styles.loading}`} role="status"><h2>No reading to show for this Shabbat</h2><p>The calendar lists no weekly Torah portion or haftarah here. Try the week before or after.</p></div>;
  if (load.status === "failed") return <div className={`workspace-state ${styles.loading}`} role="status">
    <h2>{load.code === 400 ? "That reading isn’t available" : "The reading didn’t load"}</h2>
    <p>{load.code === 400 ? "Choose another reading, or go back to this week." : load.code === 429 ? RATE_LIMITED_MESSAGE : "Check your connection and try again."}</p>
    {load.code === 400 ? onThisWeek && <button type="button" className="button-secondary" onClick={onThisWeek}>Go to this week</button> : <button type="button" className="button-secondary" onClick={onRetry}>Try again</button>}
  </div>;
  return null;
}

/** The Shabbat's own choices: Torah or haftarah, a date, and which part of the Torah reading. */
function ReadingControls({ week, today, onOpen }: { week: Week; today: string | null; onOpen(target: PrintTarget): void }) {
  const field = useId(), picks = portionPicks(week.portions);
  return <div className={styles.group}>
    {week.torah && week.haftarah && <Choice legend="Reading" name="kind" value={week.kind} onChange={kind => onOpen({ mode: "week", date: week.date === today ? null : week.date, kind: kind === "haftarah" ? "haftarah" : null, pick: "full" })}
      options={[["torah", "Torah"], ["haftarah", "Haftarah"]]} />}
    {week.kind === "torah" && picks.length > 1 && <>
      <label className={styles.label} htmlFor={`${field}-pick`}>Portion</label>
      <select id={`${field}-pick`} className={styles.select} value={week.pick} onChange={event => onOpen({ mode: "week", date: week.date === today ? null : week.date, kind: null, pick: event.target.value as PortionPick })}>
        {picks.map(pick => <option key={pick} value={pick}>{portionLabel(pick, week.portions)}</option>)}
      </select>
    </>}
    <label className={styles.label} htmlFor={`${field}-date`}>Find a date</label>
    <input id={`${field}-date`} className={styles.select} type="date" value={week.date} onChange={event => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { try { onOpen({ mode: "week", date: shabbatOnOrAfter(value), kind: null, pick: "full" }); } catch { /* Ignore partial input. */ } } }} />
  </div>;
}

/** A member's own saved readings in the chooser, asked for only once the chooser is open; signed out, it shows nothing. */
function MyReadings({ onOpen }: { onOpen(reading: SavedReading): void }) {
  const [readings, setReadings] = useState<readonly SavedReading[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetchSavedReadings(controller.signal).then(list => { if (!controller.signal.aborted) setReadings(list.state === "ready" ? list.readings : null); }, () => { if (!controller.signal.aborted) setReadings(null); });
    return () => controller.abort();
  }, []);
  const shown = useMemo(() => readings ?? [], [readings]);
  if (!shown.length) return null;
  return <section className={styles.mine} aria-labelledby="print-my-readings">
    <h3 id="print-my-readings">My readings</h3>
    <ul className={styles.mineList}>{shown.map(reading => <li key={reading.id}><button type="button" onClick={() => onOpen(reading)}>
      <span className={styles.mineName}><bdi>{reading.name}</bdi></span>
      <span className={styles.mineMeta}>{reading.date && <><time dateTime={reading.date}>{longDate(reading.date)}</time> · </>}{kindName(reading.kind)} <bdi dir="ltr">{displayRange([reading.ranges])}</bdi></span>
    </button></li>)}</ul>
  </section>;
}
