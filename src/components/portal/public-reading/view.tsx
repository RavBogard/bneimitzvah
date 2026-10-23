"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PortalRequestError } from "../api";
import type { StudyKind, StudyPage } from "../workspace/study/api";
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
import { CommentaryCredits, CommentaryStatus, linkedVerse, useCommentLink, useWorkCommentary, VerseRashi } from "../workspace/study/commentary-view";
import { COMMENTARY_WORKS } from "../../../lib/readings/commentary";
import { namedReading, type NamedReading } from "../../../lib/readings/named-readings";
import { useReadingPrefs } from "../workspace/reading-prefs";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { addDays, shabbatOnOrAfter, thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicRefReading, fetchPublicShortPage, fetchPublicText, fetchPublicWeek, fetchPublicWordAids, fetchPublicWordDetails, refSource, weekSource,
  type PublicShortPage, type PublicSource, type PublicWeek } from "./api";
import { parseReadAddress, readAddress, selectorKey, type ReadAddress, type ReadTarget } from "./urls";
import { ReadingChooser } from "./reading-chooser";
import { SaveReading } from "../saved/save-reading";
import { SavedReadingPage } from "../saved/saved-reading";
import styles from "./public-reading.module.css";

export const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
export const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const GROUP_EYEBROW: Readonly<Record<NamedReading["group"], string>> = { parashah: "Parashah", special: "Special Shabbat", festival: "Festival", fast: "Fast day" };

/** This week is plain /read; another Shabbat and the Study lens are in the address, so it can be shared. */
export function readingAddress(date: string, today: string, lens: Lens): string {
  return readAddress({ mode: "week", date, kind: null }, { today, study: lens === "study" });
}
/** One passage the page can show, under the label its passage button carries. */
export type LabelledSource = Readonly<{ label: string; source: PublicSource }>;

/** The signed-out reading: this or any Shabbat's parashah and haftarah, any named reading, or any passage of
 * the Torah or the Prophets, with the same text, translation, recordings and study tools students use, and
 * nothing about anyone. Lein opens first; Study opens from `lens=study`, or when this browser last used it.
 * The address forms are in urls.ts (`readAddress`). */
export function PublicReading() {
  const [address, setAddress] = useState<ReadAddress | null>(null), [query, setQuery] = useState<Lens | null>(null);
  useEffect(() => { setQuery(lensFromSearch(window.location.search)); setAddress(parseReadAddress(window.location.search)); }, []);
  return <StudyLensScope storageKey={LENS_STORAGE.weekly} query={query}>
    {!address ? <Shell><Hero eyebrow="Torah and haftarah" title="Loading the reading" /></Shell>
      : address.target?.mode === "week" ? <WeekReading initial={address.target} verse={address.verse} />
        : address.target?.mode === "saved" ? <SavedReadingPage id={address.target.id} verse={address.verse} />
        : address.target ? <ChosenReading target={address.target} verse={address.verse} />
          : <Unavailable />}
  </StudyLensScope>;
}

export const go = (address: string) => { try { window.location.assign(address); } catch { /* Stay. */ } };
export function replaceAddress(address: string) { try { if (window.location.pathname + window.location.search !== address) window.history.replaceState(null, "", address); } catch { /* Address bar stays as it was. */ } }

export function Shell({ children }: { children: ReactNode }) {
  return <div className="portal-shell">
    <a className="skip-link" href="#public-reading-main">Skip to the reading</a>
    <header className="portal-header app-bar"><a className="portal-brand" href="/">CRC Torah</a><a className="app-bar-account" href="/sign-in">Sign in</a></header>
    <main id="public-reading-main" className="workspace-main">
      <div className="reading-workspace reading-with-work"><section aria-labelledby="public-reading-title">
        {children}
        <aside className={styles.signIn} aria-labelledby="public-sign-in-heading">
          <h2 id="public-sign-in-heading">Preparing for your Beit Mitzvah?</h2>
          <p>Sign in to see your own verses, your tutor’s notes and your practice days. Everything on this page is open to anyone.</p>
          <a className="button-start" href="/sign-in">Sign in</a>
        </aside>
      </section></div>
    </main>
  </div>;
}
export function Hero({ eyebrow, title, meta, nav, actions }: { eyebrow: string; title: string; meta?: ReactNode; nav?: ReactNode; actions?: ReactNode }) {
  return <header className="reading-hero">
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1 id="public-reading-title" className="hero-reference">{title}</h1>
    {meta && <p className="hero-meta">{meta}</p>}
    {nav && <nav className={styles.weeks} aria-label="Choose a reading">{nav}</nav>}
    {actions}
  </header>;
}
/** The "Choose a reading" toggle and its panel, opened in place under the hero. */
export function useChooser(initiallyOpen = false) {
  const [open, setOpen] = useState(initiallyOpen), id = useId(), lens = useStudyLens();
  const button = <button type="button" className="button-hero-secondary" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>Choose a reading</button>;
  const panel = open ? <ReadingChooser id={id} study={lens.lens === "study"} onOpen={go} /> : null;
  return { button, panel };
}
/** Start reading: scroll to the text and, with recordings, play the first verse. `row(extra)` adds Save or Edit beside it. */
export function useStarter() {
  const starter = useRef<(() => void) | null>(null), [ready, setReady] = useState(false);
  const register = useCallback((value: (() => void) | null) => { starter.current = value; setReady(value !== null); }, []);
  const row = (extra?: ReactNode) => <div className="hero-actions">
    <button type="button" className="button-start" disabled={!ready} onClick={() => starter.current?.()}>Start reading</button>
    <a className="button-hero-secondary" href="/trope-chart">Trope chart</a>
    {extra}
  </div>;
  return { register, button: row(), row };
}

function Unavailable() {
  const chooser = useChooser(true), today = useToday();
  return <Shell>
    <Hero eyebrow="Torah and haftarah" title="Reading unavailable" nav={<>{today && <button type="button" className="button-hero-secondary" onClick={() => go("/read")}>This week</button>}{chooser.button}</>} />
    {chooser.panel}
    <div className="workspace-state" role="status"><h2>That reading isn’t available</h2><p>The address doesn’t name a reading this page can open. Choose one, or go back to this week.</p></div>
  </Shell>;
}
function useToday() { const [today, setToday] = useState<string | null>(null); useEffect(() => { setToday(thisShabbat()); }, []); return today; }

/** A Shabbat's parashah and haftarah, by date, with week-by-week browsing. */
function WeekReading({ initial, verse }: { initial: Extract<ReadTarget, { mode: "week" }>; verse: number | null }) {
  const today = useToday(), [date, setDate] = useState<string | null>(null), lens = useStudyLens(), chooser = useChooser(), starter = useStarter();
  const [week, setWeek] = useState<{ date: string; value?: PublicWeek; error?: number } | null>(null), [retry, setRetry] = useState(0);
  const [kind, setKind] = useState<StudyKind | null>(initial.kind), [linked, setLinked] = useState(verse);
  useEffect(() => { if (today) setDate(current => current ?? initial.date ?? today); }, [today, initial.date]);
  // One Shabbat at a time; its address is shareable (and this week's Lein is plain /read).
  useEffect(() => { if (date && today) replaceAddress(readAddress({ mode: "week", date, kind: kind === "haftarah" ? "haftarah" : null }, { today, verse: linked, study: lens.lens === "study" })); },
    [date, today, kind, linked, lens.lens]);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    setWeek({ date });
    fetchPublicWeek(date, controller.signal).then(value => { if (!controller.signal.aborted) setWeek({ date, value }); },
      error => { if (!controller.signal.aborted) setWeek({ date, error: statusOf(error) }); });
    return () => controller.abort();
  }, [date, retry]);
  const current = week?.value && week.date === date ? week.value : null;
  const sources = useMemo(() => current ? (["torah", "haftarah"] as const).flatMap(row => { const source = weekSource(current, row); return source ? [{ label: row === "torah" ? "Torah" : "Haftarah", source }] : []; }) : [], [current]);
  const change = (next: string) => { if (next !== date) { setDate(next); setKind(null); setLinked(null); } };
  const index = Math.max(0, sources.findIndex(row => row.source.passage.kind === kind)), isThisWeek = date !== null && date === today;
  const shown = sources[index]?.source.passage;
  return <Shell>
    <Hero eyebrow={isThisWeek ? "This Shabbat" : date ? "Shabbat" : "Torah and haftarah"} title={current ? current.parashah ?? "Shabbat reading" : week?.error ? "Reading unavailable" : "Loading the reading"}
      meta={date && <><time dateTime={date}>{longDate(date)}</time>{current?.torah && <> · Torah <bdi dir="ltr">{displayRange(current.torah.ranges)}</bdi></>}{current?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(current.haftarah.ranges)}</bdi></>}</>}
      nav={<>
        <button type="button" className="button-hero-secondary" disabled={!date} onClick={() => date && change(addDays(date, -7))}>Previous week</button>
        {!isThisWeek && today && <button type="button" className="button-hero-secondary" onClick={() => change(today)}>This week</button>}
        <button type="button" className="button-hero-secondary" disabled={!date} onClick={() => date && change(addDays(date, 7))}>Next week</button>
        <label className={styles.picker}><span>Find a date</span><input type="date" value={date ?? ""} onChange={event => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { try { change(shabbatOnOrAfter(value)); } catch { /* Ignore partial input. */ } } }} /></label>
        {chooser.button}
      </>}
      actions={sources.length > 0 && starter.row(current && shown && <SaveReading passage={{ title: current.parashah, label: shown.kind === "torah" ? "Torah" : "Haftarah", kind: shown.kind, ranges: shown.ranges, date: current.date }} />)} />
    {chooser.panel}
    {week?.error && <div className="workspace-state" role="status"><h2>{week.error === 400 ? "That date isn’t available" : "The reading didn’t load"}</h2>
      <p>{week.error === 400 ? "Choose a Shabbat within the next few years, or go back to this week." : "Check your connection and try again."}</p>
      {week.error === 400 && today ? <button type="button" className="button-secondary" onClick={() => change(today)}>Go to this week</button> : <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {current && !sources.length && <div className="workspace-state" role="status"><h2>No reading to show for this Shabbat</h2><p>The calendar lists no weekly Torah portion or haftarah here. Try the week before or after.</p></div>}
    {current && sources.length > 0 && <>
      {!current.torah && current.parashah && <p className="field-help">This Shabbat’s Torah reading isn’t shown here. The haftarah is below.</p>}
      <PassageReading key={current.date} sources={sources} index={index} onIndex={next => { setKind(sources[next].source.passage.kind); setLinked(null); }}
        verse={linked} onVerseLeft={() => setLinked(null)} registerStart={starter.register} retry={retry} onRetry={() => setRetry(value => value + 1)} />
    </>}
  </Shell>;
}

/** A named reading from the catalog, or any canonical passage: its passages loaded by ref. */
function ChosenReading({ target, verse }: { target: Extract<ReadTarget, { mode: "named" | "ref" }>; verse: number | null }) {
  const named = target.mode === "named" ? namedReading(target.slug) : null, lens = useStudyLens(), chooser = useChooser(), starter = useStarter();
  const passages = useMemo(() => named ? named.passages : target.mode === "ref" ? [{ label: target.kind === "torah" ? "Torah" : "Haftarah", kind: target.kind, ref: target.ref }] : [], [named, target]);
  const title = named ? named.name : target.mode === "ref" ? displayRange([target.ref]) : "Reading";
  const [index, setIndex] = useState(target.mode === "named" ? Math.min(target.passage, passages.length) - 1 : 0), [linked, setLinked] = useState(verse);
  const [loaded, setLoaded] = useState<{ sources?: readonly LabelledSource[]; error?: number } | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => { try { document.title = `${title} | CRC Torah`; } catch { /* Keep the title. */ } }, [title]);
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
  return <Shell>
    <Hero eyebrow={named ? GROUP_EYEBROW[named.group] : "Any reading"} title={loaded?.error ? "Reading unavailable" : title}
      meta={<>{passages.map((row, at) => <span key={at}>{at > 0 && " · "}{row.label} <bdi dir="ltr">{displayRange([row.ref])}</bdi></span>)}</>}
      nav={<><button type="button" className="button-hero-secondary" onClick={() => go(readAddress({ mode: "week", date: null, kind: null }, { study: lens.lens === "study" }))}>This week</button>{chooser.button}</>}
      actions={sources.length > 0 && starter.row(sources[index] && <SaveReading passage={{ title: named ? named.name : title, label: passages[index]?.label ?? null, kind: sources[index].source.passage.kind, ranges: sources[index].source.passage.ranges, date: null }} />)} />
    {chooser.panel}
    {loaded?.error && <div className="workspace-state" role="status"><h2>{loaded.error === 400 ? "That reading isn’t available" : "The reading didn’t load"}</h2>
      <p>{loaded.error === 400 ? "Choose another reading, or go back to this week." : "Check your connection and try again."}</p>
      {loaded.error !== 400 && <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {sources.length > 0 && <PassageReading key={sources.map(row => selectorKey(row.source.selector)).join("|")} sources={sources} index={index}
      onIndex={next => { setIndex(next); setLinked(null); }} verse={linked} onVerseLeft={() => setLinked(null)} registerStart={starter.register} retry={retry} onRetry={() => setRetry(value => value + 1)} />}
  </Shell>;
}

/**
 * The reading itself, for any list of passages: the passage buttons (Torah | Haftarah, or a named reading's
 * own), Lein and Study, the text pages, the player, word tools, commentary and Up close.
 * `verse` (1-based in the passage shown) opens that verse selected: Word tools on it, and in the player
 * when recordings are on, ready to play. Any other choice lets it go (`onVerseLeft`).
 */
export function PassageReading({ sources, index, onIndex, verse, onVerseLeft, registerStart, retry, onRetry, verseExtra }: {
  sources: readonly LabelledSource[]; index: number; onIndex(index: number): void; verse: number | null; onVerseLeft(): void;
  registerStart(start: (() => void) | null): void; retry: number; onRetry(): void;
  /** In Lein, shown under the selected verse before Up close (a saved reading's Working and Got it marks). */
  verseExtra?: (ref: string) => ReactNode;
}) {
  const source = (sources[index] ?? sources[0]).source, passage = source.passage, kind = passage.kind, listening = source.listening, key = selectorKey(source.selector);
  const allVerses = useMemo(() => { try { return expandReadingRanges(passage.ranges, kind, TANAKH_VERSE_COUNTS); } catch { return []; } }, [passage, kind]);
  const linkedIndex = verse !== null && verse <= passage.verseCount ? verse - 1 : null;
  const pageOf = (position: number) => passage.pages.filter(row => row.offset <= position).at(-1)?.offset ?? 0;
  const [offset, setOffset] = useState(() => linkedIndex !== null ? pageOf(linkedIndex) : 0);
  const [text, setText] = useState<{ key: string; page?: StudyPage; error?: number } | null>(null);
  const [playingWord, setPlayingWord] = useState<{ verse: number; index: number } | null>(null);
  const [focus, setFocus] = useState<number | null>(null), [lift, setLift] = useState<{ index: number; opening: number; navigation: number } | null>(null);
  // One coordinator for the page's lifetime (as in the signed-in reading): it is stopped, never disposed,
  // so a development StrictMode remount keeps a live one.
  const audioRef = useRef<ReturnType<typeof createReadingAudioCoordinator> | null>(null);
  if (!audioRef.current) audioRef.current = createReadingAudioCoordinator();
  const audio = audioRef.current;
  const playback = useRef<ReadingPlayerHandle | null>(null), registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const tools = useRef<WordToolsHandle | null>(null), registerTools = useCallback((value: WordToolsHandle | null) => { tools.current = value; }, []);
  const shortPages = useRef(new Map<string, Promise<PublicShortPage>>()), pendingPlace = useRef<{ key: string; ref: string; wordIndex: number } | null>(null);
  const textAnchor = useRef<HTMLDivElement | null>(null), openings = useRef(0), group = useId(), prefs = useReadingPrefs(), lens = useStudyLens(), study = lens.lens === "study";
  // A deep-linked verse is shown selected in the player without playing; the first other choice releases it,
  // and that choice runs after the release so the player is never suspended under it.
  const deferred = useRef<(() => void) | null>(null), linkShown = useRef(false);
  useLayoutEffect(() => { const run = deferred.current; deferred.current = null; run?.(); });
  const release = (action: () => void) => { if (linkedIndex === null) { action(); return; } deferred.current = action; onVerseLeft(); };

  useEffect(() => () => { audio.stopAll(); }, [audio]);
  useEffect(() => {
    const leave = () => audio.stopAll(), background = () => { if (document.visibilityState !== "visible") audio.stopAll(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [audio]);
  const textKey = JSON.stringify([key, kind, offset]);
  useEffect(() => {
    const controller = new AbortController();
    audio.stopAll(); setText({ key: textKey }); setPlayingWord(null);
    fetchPublicText(source, offset, controller.signal).then(page => { if (!controller.signal.aborted) setText({ key: textKey, page }); },
      error => { if (!controller.signal.aborted) setText({ key: textKey, error: statusOf(error) }); });
    return () => controller.abort();
  }, [source, offset, textKey, retry, audio]);
  const page = text?.key === textKey ? text.page : undefined;
  const linkedOnPage = page && linkedIndex !== null && linkedIndex >= page.offset && linkedIndex < page.offset + page.verses.length ? linkedIndex - page.offset : null;
  // Commentary follows the text, never in its way: Rashi loads after the verses (for Lein's "Rashi (n)" too),
  // the Women's Commentary only when Study shows it on a Torah text.
  const refs = useMemo(() => page?.verses.map(row => row.ref) ?? [], [page]);
  const corpus = kind === "torah" ? "torah" : "neviim";
  const rashi = useWorkCommentary("rashi", refs, Boolean(page) && (!study || lens.works.includes("rashi")));
  const womens = useWorkCommentary("womens", refs, Boolean(page) && study && kind === "torah" && lens.works.includes("womens"));
  const works = useMemo(() => [rashi, womens].filter(row => lens.works.includes(row.work)), [rashi, womens, lens.works]);
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
    const shortKey = JSON.stringify([key, kind, page.offset]);
    let work = shortPages.current.get(shortKey);
    if (!work) { work = fetchPublicShortPage(source, page.offset, new AbortController().signal); shortPages.current.set(shortKey, work); void work.catch(() => shortPages.current.delete(shortKey)); }
    const result = await work; if (signal.aborted) throw new PortalRequestError(409);
    return result.references[at];
  }, [source, key, kind, page]);
  const hear = (at: number, word: ReadingSelection = "verse") => release(() => {
    setFocus(at); playback.current?.select(at, word);
    if (word === "verse") tools.current?.selectVerse(at); else tools.current?.select(at, word);
  });
  const chooseWord = (at: number, word: number) => release(() => { setFocus(at); if (listening) playMainVerseForWord(playback.current, tools.current, at, word); else tools.current?.select(at, word); });
  const changeIndex = (next: number) => { if (next === index) return; audio.stopAll(); setLift(null); setFocus(null); setOffset(0); onIndex(next); };
  const changeOffset = (next: number) => { if (next === offset) return; if (linkedIndex !== null) onVerseLeft(); setOffset(next); };
  const offsets = passage.pages.map(row => row.offset);
  const previousOffset = offsets[offsets.indexOf(offset) - 1], nextOffset = page?.nextOffset ?? null;
  // The haftarah's last verse takes the closing (sof haftarah) melody, as in the assigned reading.
  const assignment = useMemo(() => ({ kind, confirmed: kind === "haftarah", verses: allVerses }), [kind, allVerses]);
  const scopeKey = textKey;
  const start = useRef<() => void>(() => {}); start.current = () => { textAnchor.current?.scrollIntoView({ block: "start" }); if (listening && page) hear(0); else textAnchor.current?.focus(); };
  useEffect(() => { registerStart(page ? () => start.current() : null); return () => registerStart(null); }, [page, registerStart]);

  return <>
    <div className="reading-lens-row">
      {sources.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">
        {sources.map((row, at) => <button key={at} type="button" className="button-secondary" aria-pressed={at === index} onClick={() => changeIndex(at)}>{row.label}</button>)}
      </div>}
      <LensSwitch onChange={() => leinLink.clear()} />
    </div>
    {sources.length > 1 && <p className={`field-help ${styles.passageNote}`}><bdi dir="ltr">{displayRange(passage.ranges)}</bdi></p>}
    <div className="reading-passage-layout" ref={textAnchor} tabIndex={-1}>
      <ReadingToolbar listeningEnabled={listening} tikkunAvailable={kind === "torah"} worksCorpus={corpus} onHear={listening && page ? () => hear(focus ?? 0) : undefined} />
      <section className="assigned-study" aria-label={kind === "torah" ? "Torah text" : "Haftarah text"} data-size={prefs.size}>
        {!page ? text?.key === textKey && text.error ? <div role="status"><h4>Text unavailable</h4><p>The verses didn’t load. Check your connection and try again.</p><button type="button" className="button-secondary" onClick={onRetry}>Reload text</button></div>
          : <p role="status">Loading the text…</p> : <>
          {study ? <>
            <CommentaryStatus works={works.map(row => ({ work: row.work, status: row.status, retry: row.retry, covers: Boolean(COMMENTARY_WORKS[row.work]?.editions[corpus]) }))} />
            <StudyRows verses={page.verses} assignment={assignment} group={group} activeWord={playingWord} listening={listening} showEnglish={lens.english}
              works={ref => works.map(row => ({ work: row.work, state: row.lookup.forVerse(ref) }))}
              onVerse={listening ? at => hear(at) : undefined} onWord={chooseWord} />
          </> : <FlowingStudyText verses={page.verses} assignment={assignment} group={group} activeWord={playingWord} listening={listening} showEnglish={prefs.translation} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
            linked={linkedVerse(leinLink, page.verses)} onVerse={listening ? at => hear(at) : undefined} onWord={chooseWord} />}
          {listening && <ReadingPlayer key={`player:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} active={!lift} enabled={!lift} audio={{ coordinator: audio, slot: "proposed" }}
            target={linkedOnPage !== null ? { index: linkedOnPage, generation: 0 } : undefined} register={registerPlayback} onActiveWord={setPlayingWord} load={loadShort} />}
          <WordTools key={`tools:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} register={registerTools}
            readAids={(at, signal) => fetchPublicWordAids(source, page.offset + at, page.verses[at], signal)}
            readDetails={(at, word, signal) => fetchPublicWordDetails(source, page.offset + at, page.verses[at], word, signal)}
            onHear={listening ? (at, word) => hear(at, word) : undefined}
            onPlace={(ref, wordIndex) => {
              const here = page.verses.findIndex(row => row.ref === ref), position = allVerses.indexOf(ref);
              if (here >= 0) { tools.current?.select(here, wordIndex); return; }
              const target = offsets.filter(value => value <= position).at(-1);
              if (position >= 0 && target !== undefined && target !== page.offset) { pendingPlace.current = { key: JSON.stringify([key, kind, target]), ref, wordIndex }; changeOffset(target); }
            }}
            takePlace={() => { const place = pendingPlace.current; pendingPlace.current = null; return place && place.key === scopeKey ? { ref: place.ref, wordIndex: place.wordIndex } : null; }} />
          {!study && <VerseRashi key={focus !== null ? page.verses[focus]?.ref : "none"} verse={focus !== null ? page.verses[focus] ?? null : null} state={focus !== null && page.verses[focus] ? rashi.lookup.forVerse(page.verses[focus].ref) : { status: "none" }} link={leinLink} retry={rashi.retry} />}
          {!study && verseExtra && focus !== null && page.verses[focus] && verseExtra(page.verses[focus].ref)}
          {focus !== null && page.verses[focus] && <p className={styles.upClose}><button type="button" className="button-secondary" onClick={() => release(() => setLift({ index: focus, opening: ++openings.current, navigation: 0 }))}>View <bdi dir="ltr">{page.verses[focus].ref}</bdi> up close</button>
            <span className="field-help">Up close shows each phrase of trope by name.</span></p>}
          {(previousOffset !== undefined || nextOffset !== null) && <>
            <p className="study-page-position">Verses {page.offset + 1}–{page.offset + page.verses.length} of {page.totalVerses}</p>
            <nav className="study-pages" aria-label="Text pages"><button type="button" className="button-secondary" disabled={previousOffset === undefined} onClick={() => previousOffset !== undefined && changeOffset(previousOffset)}>Previous text page</button>
              <button type="button" className="button-secondary" disabled={nextOffset === null} onClick={() => nextOffset !== null && changeOffset(nextOffset)}>Next text page</button></nav></>}
          {study && <CommentaryCredits works={works} refs={refs} />}
          <div className="study-more"><StudyCredits chapters={page.chapters} summary="About this text" /><a href="/trope-chart">Trope chart</a></div>
          {lift && page.verses[lift.index] && <LiftedLine learner verses={page.verses} assignment={assignment} index={lift.index} total={page.totalVerses} offset={page.offset}
            reference={listening ? { audio, active: true, navigation: lift.navigation, scopeKey: JSON.stringify([scopeKey, lift.opening]), load: loadShort } : undefined}
            onIndex={at => setLift(value => value && { index: at, opening: value.opening, navigation: value.navigation + 1 })} onClose={() => { audio.stopAll(); setLift(null); }} />}
        </>}
      </section>
    </div>
  </>;
}
