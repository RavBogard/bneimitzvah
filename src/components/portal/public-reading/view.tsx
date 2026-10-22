"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useReadingPrefs } from "../workspace/reading-prefs";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { expandReadingRanges } from "../../../lib/readings/ranges";
import { addDays, isSaturday, shabbatOnOrAfter, thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicShortPage, fetchPublicText, fetchPublicWeek, fetchPublicWordAids, fetchPublicWordDetails, type PublicShortPage, type PublicWeek } from "./api";
import styles from "./public-reading.module.css";

const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
function initialDate(today: string): string {
  try {
    const value = new URLSearchParams(window.location.search).get("date");
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return isSaturday(value) ? value : shabbatOnOrAfter(value);
  } catch { /* Fall back to this week. */ }
  return today;
}

/** The signed-out reading: any Shabbat's parashah and haftarah, with the same text,
 * translation, recordings and study tools students use, and nothing about anyone. */
export function PublicReading() {
  const [today, setToday] = useState<string | null>(null), [date, setDate] = useState<string | null>(null);
  const [week, setWeek] = useState<{ date: string; value?: PublicWeek; error?: number } | null>(null);
  const [kind, setKind] = useState<StudyKind>("torah");
  const [text, setText] = useState<{ key: string; page?: StudyPage; error?: number } | null>(null);
  const [retry, setRetry] = useState(0);
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
  const textAnchor = useRef<HTMLDivElement | null>(null), openings = useRef(0), group = useId(), prefs = useReadingPrefs();
  const [offset, setOffset] = useState(0);

  useEffect(() => { const now = thisShabbat(); setToday(now); setDate(initialDate(now)); }, []);
  useEffect(() => () => { audio.stopAll(); }, [audio]);
  useEffect(() => {
    const leave = () => audio.stopAll(), background = () => { if (document.visibilityState !== "visible") audio.stopAll(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [audio]);
  // One Shabbat at a time; its address is shareable (and this week's is plain /read).
  useEffect(() => {
    if (!date || !today) return;
    try { window.history.replaceState(null, "", date === today ? "/read" : `/read?date=${date}`); } catch { /* Address bar stays as it was. */ }
    const controller = new AbortController();
    audio.stopAll(); setLift(null); setFocus(null); setWeek({ date }); setText(null);
    fetchPublicWeek(date, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setWeek({ date, value }); setOffset(0); setKind(value.torah ? "torah" : "haftarah");
    }, error => { if (!controller.signal.aborted) setWeek({ date, error: statusOf(error) }); });
    return () => controller.abort();
  }, [date, today, retry, audio]);
  const current = week?.value && week.date === date ? week.value : null, passage = current ? current[kind] : null;
  const textKey = current && passage ? JSON.stringify([current.date, kind, offset]) : "";
  useEffect(() => {
    if (!current || !passage) return;
    const controller = new AbortController(), key = JSON.stringify([current.date, kind, offset]);
    audio.stopAll(); setText({ key }); setPlayingWord(null);
    fetchPublicText(current, kind, offset, controller.signal).then(page => { if (!controller.signal.aborted) setText({ key, page }); },
      error => { if (!controller.signal.aborted) setText({ key, error: statusOf(error) }); });
    return () => controller.abort();
  }, [current, passage, kind, offset, retry, audio]);
  const page = text?.key === textKey ? text.page : undefined;
  const allVerses = useMemo(() => { try { return passage ? expandReadingRanges(passage.ranges, passage.kind, TANAKH_VERSE_COUNTS) : []; } catch { return []; } }, [passage]);
  const listening = Boolean(current?.listening.pocketTorah);
  useLayoutEffect(() => { if (lift) audio.stopAll(); }, [lift?.opening, audio]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadShort = useCallback(async (index: number, signal: AbortSignal) => {
    if (!current || !page || !page.verses[index]) throw new PortalRequestError(409);
    const key = JSON.stringify([current.date, kind, page.offset]);
    let work = shortPages.current.get(key);
    if (!work) { work = fetchPublicShortPage(current, kind, page.offset, new AbortController().signal); shortPages.current.set(key, work); void work.catch(() => shortPages.current.delete(key)); }
    const result = await work; if (signal.aborted) throw new PortalRequestError(409);
    return result.references[index];
  }, [current, kind, page]);
  const hear = (index: number, word: ReadingSelection = "verse") => {
    setFocus(index); playback.current?.select(index, word);
    if (word === "verse") tools.current?.selectVerse(index); else tools.current?.select(index, word);
  };
  const changeKind = (next: StudyKind) => { if (next === kind) return; audio.stopAll(); setLift(null); setFocus(null); setOffset(0); setKind(next); };
  const go = (next: string) => { if (next !== date) setDate(next); };
  const offsets = passage?.pages.map(row => row.offset) ?? [];
  const previousOffset = offsets[offsets.indexOf(offset) - 1], nextOffset = page?.nextOffset ?? null;
  // The haftarah's last verse takes the closing (sof haftarah) melody, as in the assigned reading.
  const assignment = useMemo(() => ({ kind, confirmed: kind === "haftarah", verses: allVerses }), [kind, allVerses]);
  const scopeKey = textKey, isThisWeek = date !== null && date === today;

  return <div className="portal-shell">
    <a className="skip-link" href="#public-reading-main">Skip to the reading</a>
    <header className="portal-header app-bar"><a className="portal-brand" href="/">CRC Beit Mitzvah</a><a className="app-bar-account" href="/sign-in">Sign in</a></header>
    <main id="public-reading-main" className="workspace-main">
      <div className="reading-workspace reading-with-work"><section aria-labelledby="public-reading-title">
        <header className="reading-hero">
          <p className={styles.eyebrow}>{isThisWeek ? "This Shabbat" : date ? "Shabbat" : "Torah and haftarah"}</p>
          <h1 id="public-reading-title" className="hero-reference">{current ? current.parashah ?? "Shabbat reading" : week?.error ? "Reading unavailable" : "Loading the reading"}</h1>
          {date && <p className="hero-meta"><time dateTime={date}>{longDate(date)}</time>{current?.torah && <> · Torah <bdi dir="ltr">{displayRange(current.torah.ranges)}</bdi></>}{current?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(current.haftarah.ranges)}</bdi></>}</p>}
          <nav className={styles.weeks} aria-label="Choose a Shabbat">
            <button type="button" className="button-hero-secondary" disabled={!date} onClick={() => date && go(addDays(date, -7))}>Previous week</button>
            {!isThisWeek && today && <button type="button" className="button-hero-secondary" onClick={() => go(today)}>This week</button>}
            <button type="button" className="button-hero-secondary" disabled={!date} onClick={() => date && go(addDays(date, 7))}>Next week</button>
            <label className={styles.picker}><span>Find a date</span><input type="date" value={date ?? ""} onChange={event => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { try { go(shabbatOnOrAfter(value)); } catch { /* Ignore partial input. */ } } }} /></label>
          </nav>
          {current && (current.torah || current.haftarah) && <div className="hero-actions">
            <button type="button" className="button-start" disabled={!page} onClick={() => { textAnchor.current?.scrollIntoView({ block: "start" }); if (listening && page) hear(0); else textAnchor.current?.focus(); }}>Start reading</button>
            <a className="button-hero-secondary" href="/trope-chart">Trope chart</a>
          </div>}
        </header>
        {week?.error && <div className="workspace-state" role="status"><h2>{week.error === 400 ? "That date isn’t available" : "The reading didn’t load"}</h2>
          <p>{week.error === 400 ? "Choose a Shabbat within the next few years, or go back to this week." : "Check your connection and try again."}</p>
          {week.error === 400 && today ? <button type="button" className="button-secondary" onClick={() => go(today)}>Go to this week</button> : <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
        {current && !current.torah && !current.haftarah && <div className="workspace-state" role="status"><h2>No reading to show for this Shabbat</h2><p>The calendar lists no weekly Torah portion or haftarah here. Try the week before or after.</p></div>}
        {current && passage && <>
          {current.torah && current.haftarah ? <div className="study-kind-choice" role="group" aria-label="Reading text selection">
            {(["torah", "haftarah"] as const).map(row => <button key={row} type="button" className="button-secondary" aria-pressed={kind === row} onClick={() => changeKind(row)}>{row === "torah" ? "Torah" : "Haftarah"}</button>)}
          </div> : !current.torah && current.parashah && <p className="field-help">This Shabbat’s Torah reading isn’t shown here. The haftarah is below.</p>}
          <div className="reading-passage-layout" ref={textAnchor} tabIndex={-1}>
            <ReadingToolbar listeningEnabled={listening} tikkunAvailable={kind === "torah"} onHear={listening && page ? () => hear(focus ?? 0) : undefined} />
            <section className="assigned-study" aria-label={kind === "torah" ? "Torah text" : "Haftarah text"} data-size={prefs.size}>
              {!page ? text?.key === textKey && text.error ? <div role="status"><h4>Text unavailable</h4><p>The verses didn’t load. Check your connection and try again.</p><button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Reload text</button></div>
                : <p role="status">Loading the text…</p> : <>
                <FlowingStudyText verses={page.verses} assignment={assignment} group={group} activeWord={playingWord} listening={listening} showEnglish={prefs.translation} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
                  onVerse={listening ? index => hear(index) : undefined}
                  onWord={(index, word) => { setFocus(index); if (listening) playMainVerseForWord(playback.current, tools.current, index, word); else tools.current?.select(index, word); }} />
                {listening && <ReadingPlayer key={`player:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} active={!lift} enabled={!lift} audio={{ coordinator: audio, slot: "proposed" }}
                  register={registerPlayback} onActiveWord={setPlayingWord} load={loadShort} />}
                <WordTools key={`tools:${scopeKey}`} scopeKey={scopeKey} verses={page.verses} register={registerTools}
                  readAids={(index, signal) => fetchPublicWordAids(current, kind, page.offset + index, page.verses[index], signal)}
                  readDetails={(index, word, signal) => fetchPublicWordDetails(current, kind, page.offset + index, page.verses[index], word, signal)}
                  onHear={listening ? (index, word) => hear(index, word) : undefined}
                  onPlace={(ref, wordIndex) => {
                    const here = page.verses.findIndex(row => row.ref === ref), position = allVerses.indexOf(ref);
                    if (here >= 0) { tools.current?.select(here, wordIndex); return; }
                    const target = offsets.filter(value => value <= position).at(-1);
                    if (position >= 0 && target !== undefined && target !== page.offset) { pendingPlace.current = { key: JSON.stringify([current.date, kind, target]), ref, wordIndex }; setOffset(target); }
                  }}
                  takePlace={() => { const place = pendingPlace.current; pendingPlace.current = null; return place && place.key === scopeKey ? { ref: place.ref, wordIndex: place.wordIndex } : null; }} />
                {focus !== null && page.verses[focus] && <p className={styles.upClose}><button type="button" className="button-secondary" onClick={() => setLift({ index: focus, opening: ++openings.current, navigation: 0 })}>View <bdi dir="ltr">{page.verses[focus].ref}</bdi> up close</button>
                  <span className="field-help">Up close shows each phrase of trope by name.</span></p>}
                {(previousOffset !== undefined || nextOffset !== null) && <>
                  <p className="study-page-position">Verses {page.offset + 1}–{page.offset + page.verses.length} of {page.totalVerses}</p>
                  <nav className="study-pages" aria-label="Text pages"><button type="button" className="button-secondary" disabled={previousOffset === undefined} onClick={() => previousOffset !== undefined && setOffset(previousOffset)}>Previous text page</button>
                    <button type="button" className="button-secondary" disabled={nextOffset === null} onClick={() => nextOffset !== null && setOffset(nextOffset)}>Next text page</button></nav></>}
                <div className="study-more"><StudyCredits chapters={page.chapters} summary="About this text" /><a href="/trope-chart">Trope chart</a></div>
                {lift && page.verses[lift.index] && <LiftedLine learner verses={page.verses} assignment={assignment} index={lift.index} total={page.totalVerses} offset={page.offset}
                  reference={listening ? { audio, active: true, navigation: lift.navigation, scopeKey: JSON.stringify([scopeKey, lift.opening]), load: loadShort } : undefined}
                  onIndex={index => setLift(value => value && { index, opening: value.opening, navigation: value.navigation + 1 })} onClose={() => { audio.stopAll(); setLift(null); }} />}
              </>}
            </section>
          </div>
        </>}
        <aside className={styles.signIn} aria-labelledby="public-sign-in-heading">
          <h2 id="public-sign-in-heading">Preparing for your Beit Mitzvah?</h2>
          <p>Sign in to see your own verses, your tutor’s notes and your practice days. Everything on this page is open to anyone.</p>
          <a className="button-start" href="/sign-in">Sign in</a>
        </aside>
      </section></div>
    </main>
  </div>;
}
