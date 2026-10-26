"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { type Assigned } from "../api";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { studyBinding, studyPlan, type StudyKind, type StudyPage, type StudyVerse } from "./api";
import { StudyCredits } from "./credits";
import { Apparatus, FlowingStudyText } from "./annotations";
import { ReadingPlayer, playMainVerseForWord, type ReadingPlayerHandle } from "./reading-player";
import type { ReadingSelection } from "./main-playback";
import { WordTools, type WordToolsHandle } from "./word-tools";
import { SourcesPanel } from "./sources/panel";
import { LiftedLine } from "./lift";
import type { createReadingAudioCoordinator } from "./reading-audio-coordinator";
import { useReadingPrefs } from "../reading-prefs";
import { useStudyLens } from "../study-lens";
import { LensSwitch } from "../lens-switch";
import { StudyRows } from "./study-rows";
import { CommentaryCredits, CommentaryStatus, linkedVerse, useCommentLink, useReadingWorks, VerseRashi, workStatuses } from "./commentary-view";
import { VersePanelScope, WordPanelSource } from "./verse-panel";
import { StudySummary } from "./portion-summary";
import { parashahSlug } from "../../../../lib/portion-summary/reading";
import type { WordPanelHost } from "./word-panel";
import { ReadingPlace, scrollToVerse } from "./reading-place";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";
import { sectionIndexAt, sectionsFromStarts, type Section } from "../../../../lib/readings/sections";
import { SectionTabs, Sheet } from "../../../ui";
import { NextSection } from "./next-section";
import { PortalRequestError } from "../../api";
import { watchReadingAudioDeadline } from "./reading-player-intent";
import type { ShortReferenceOwner } from "./short-reference-bridge";

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
const NO_SECTIONS: readonly Section[] = Object.freeze([]), SERVICE_CHIP = "service";
/** Aliyah labels above the verse where an aliyah starts (or continues from the previous text page), in either lens. */
function aliyahSections(kind: StudyKind, assignment: Assigned["readings"][number], verses: readonly StudyVerse[]) {
  return verses.flatMap((verse, index) => { const position = aliyahPosition(kind, assignment.aliyahStarts, assignment.verses, verse.ref);
    return position && (position.startsHere || index === 0) ? [{ index, label: `Aliyah ${position.number}${position.startsHere ? " starts here" : " · continued from the previous text page"}` }] : []; });
}
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange, guardDeparture, serviceHref, renderGuide, renderWork, renderActiveWork, onPage, onPrint, printSheetHref, learner = false, liftHandle, practiceHandle, textStartHandle, verseLookupHandle, songSession = learner, onShown, renderMark, renderLiftControls, onVisit, onHearReady, onPracticeReady, onService, active = true, audio, stopAudio }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
  guardDeparture?(): Promise<boolean>; serviceHref?: string; renderGuide?(kind: StudyKind, verseRef: string): ReactNode; renderWork?(kind: StudyKind, verseRef: string): ReactNode; renderActiveWork?(): ReactNode; onPage?(kind: StudyKind, offset: number, signal: AbortSignal): Promise<void>;
  /** Opens the printable practice sheet; learners on phones reach it here rather than in the hero. */
  onPrint?(): void;
  /** The reader's print sheet of these verses (/print), shown under the reading on a learner's phone. */
  printSheetHref?: string;
  /** Students and child practice see the reading without status or provenance prose. */
  learner?: boolean; liftHandle?: MutableRefObject<((index: number) => void) | null>;
  practiceHandle?: MutableRefObject<((index: number) => void) | null>;
  textStartHandle?: MutableRefObject<(() => void) | null>;
  /** Looks up a verse on the live page, for the Study walk; null while concealed or loading. */
  verseLookupHandle?: MutableRefObject<((ref: string) => StudyVerse | null) | null>;
  /** The Song session reading: English follows the remembered toolbar preference. */
  songSession?: boolean;
  /** Called once a text page is on screen, so verse marks can load for it. */
  onShown?(kind: StudyKind, offset: number, length: number): void;
  renderMark?(kind: StudyKind, verseRef: string): ReactNode; renderLiftControls?(kind: StudyKind, verseRef: string): ReactNode;
  /** Called only when the reader explicitly opens a verse: tapping it, Start, or stepping to another verse. Never on a reload. */
  onVisit?(kind: StudyKind, verseRef: string): void;
  onHearReady?(ready: boolean): void; onPracticeReady?(ready: boolean): void; active?: boolean;
  /** Where the "Service parts" chip goes, the last chip of the section row (1.9 N3); absent, the row has none. */
  onService?(): void;
  audio?: ReturnType<typeof createReadingAudioCoordinator>; stopAudio?(): void;
}) {
  const { readStudy, createShortReferenceOwner, readWordAids, readWordDetails, summary, concealed, epoch, guardDeparture: guardLeaving } = useWorkspace(), aidsGroup = useId(), prefs = useReadingPrefs();
  const lens = useStudyLens(), study = lens.lens === "study", leinLink = useCommentLink();
  const shortMetadata = useRef<ShortReferenceOwner | null>(null);
  const playback = useRef<ReadingPlayerHandle | null>(null), registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const tools = useRef<WordToolsHandle | null>(null), registerTools = useCallback((value: WordToolsHandle | null) => { tools.current = value; }, []);
  const [playingWord, setPlayingWord] = useState<{ verse: number; index: number } | null>(null);
  const [lift, setLift] = useState<{ page: StudyPage; index: number; opening: number; navigation: number } | null>(null);
  // The selected verse (1.9 N4): the one last tapped (its number, one of its words, Up close), else the first. Its tools are one Sheet, opened from the bar under the passage
  // (and, in Study, from the verse's own actions); only the selected verse's tools are ever on the page.
  const [picked, setPicked] = useState<string | null>(null), [toolsRef, setToolsRef] = useState<string | null>(null), toolsOpener = useRef<HTMLElement | null>(null);
  const modalOwner = useRef<ShortReferenceOwner | null>(null), modalRequest = useRef<AbortController | null>(null), modalSequence = useRef(0);
  const modalScope = useRef(lift); modalScope.current = lift;
  const metadata = useRef<Assigned | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const selection = useRef<{ kind: StudyKind; offset: number; assignmentKey: string } | null>(null);
  // A word place chosen on another text page; bound to the load turn that shows it.
  const pendingPlace = useRef<{ kind: StudyKind; offset: number; turn: number; ref: string; wordIndex: number } | null>(null);
  // A chapter chosen on another text page: scrolled to once that page is on screen.
  const pendingJump = useRef<string | null>(null);
  const [state, setState] = useState<{ binding: string; kind?: StudyKind; page?: StudyPage; error?: number; loading?: boolean }>({ binding: "" });
  const key = baseline ? studyBinding(baseline) : "";
  const clear = useCallback(() => { stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.dispose(); shortMetadata.current = null; modalRequest.current?.abort(); modalOwner.current?.dispose(); modalOwner.current = null; generation.current++; controller.current?.abort(); setLift(null); setState({ binding: "", loading: true }); }, [stopAudio]);
  const load = useCallback(async (value: Assigned, kind: StudyKind, offset: number, outer?: AbortSignal) => {
    stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.dispose(); shortMetadata.current = null;
    modalRequest.current?.abort(); modalOwner.current?.dispose(); modalOwner.current = null;
    controller.current?.abort(); const request = new AbortController(), turn = ++generation.current; controller.current = request;
    const abort = () => request.abort(); if (outer?.aborted) abort(); outer?.addEventListener("abort", abort, { once: true });
    const binding = studyBinding(value), assignment = value.readings.find(row => row.kind === kind)!;
    onKindChange(kind); setLift(null);
    selection.current = { kind, offset, assignmentKey: JSON.stringify([value.mode, value.student.id, value.context?.id, assignment.id, assignment.revision, assignment.verses]) };
    setState({ binding, kind, loading: true });
    try {
      const page = await readStudy(value, kind, offset, request.signal);
      if (request.signal.aborted || turn !== generation.current) return false;
      setState({ binding, kind, page });
      return true;
    } catch (error) {
      if (request.signal.aborted || turn !== generation.current) return false;
      const status = statusOf(error); setState({ binding, kind, error: status });
      if ([401, 403, 404].includes(status)) { metadata.current = null; authorityFailed(status); throw error; }
      return false;
    } finally { outer?.removeEventListener("abort", abort); }
  }, [readStudy, authorityFailed, onKindChange, stopAudio]);
  const reload = useCallback(async (value: Assigned, signal: AbortSignal) => {
    metadata.current = value;
    if (!value.readings.length) { clear(); setState({ binding: studyBinding(value) }); selection.current = null; return; }
    const kind = value.readings.some(row => row.kind === selection.current?.kind) ? selection.current!.kind : value.readings.some(row => row.kind === "torah") ? "torah" : "haftarah";
    const assignment = value.readings.find(row => row.kind === kind)!;
    const assignmentKey = JSON.stringify([value.mode, value.student.id, value.context?.id, assignment.id, assignment.revision, assignment.verses]);
    const offset = selection.current?.assignmentKey === assignmentKey ? selection.current.offset : 0;
    await load(value, kind, offset, signal);
  }, [clear, load]);
  useLayoutEffect(() => register({ clear, reload }), [register, clear, reload]);
  useLayoutEffect(() => () => { generation.current++; controller.current?.abort(); metadata.current = null; }, []);
  const current = key && state.binding === key ? state : null;
  async function explicitLoad(kind: StudyKind, offset: number, place?: { ref: string; wordIndex: number }) {
    const value = metadata.current;
    if (!value || studyBinding(value) !== key) return;
    if (guardDeparture && !await guardDeparture()) return;
    if (metadata.current !== value || studyBinding(value) !== key) return;
    try {
      const pending = load(value, kind, offset), request = controller.current, turn = generation.current;
      pendingPlace.current = place ? { kind, offset, turn, ref: place.ref, wordIndex: place.wordIndex } : null;
      const loaded = await pending;
      if (loaded && place && controller.current === request && turn === generation.current) onVisit?.(kind, place.ref);
      if (loaded && onPage && request && controller.current === request && turn === generation.current && !request.signal.aborted && metadata.current === value) await onPage(kind, offset, request.signal);
    } catch { /* Authority state has already cleared text and metadata. */ }
  }
  // The tutor's recorded aliyot are the sections (1.9 N3, decision 2). A section is a text page that starts where it does (the server cuts a page from any
  // offset), and what is shown is that page up to the section's end: one section at a time, and the text flows inside it. A section longer than a text page
  // goes on by the page controls. Which section is open is simply the section the loaded page starts in.
  const rawPage = key && state.binding === key && !state.loading ? state.page : undefined;
  const sections = useMemo(() => { const row = baseline?.readings.find(item => item.kind === state.kind); return state.kind === "torah" && row ? sectionsFromStarts(row.verses, row.aliyahStarts) : NO_SECTIONS; }, [baseline, state.kind]);
  const livePage = useMemo(() => {
    if (!rawPage || !sections.length) return rawPage;
    const at = sectionIndexAt(sections, rawPage.offset), end = at >= 0 ? sections[at].end : rawPage.offset + rawPage.verses.length;
    return { ...rawPage, verses: rawPage.verses.slice(0, Math.max(1, end - rawPage.offset)), nextOffset: rawPage.offset + rawPage.verses.length >= end ? null : rawPage.nextOffset };
  }, [rawPage, sections]);
  const sectionNow = livePage && sections.length ? sectionIndexAt(sections, livePage.offset) : -1;
  useEffect(() => { const ref = pendingJump.current; if (ref && livePage?.verses.some(row => row.ref === ref)) { pendingJump.current = null; scrollToVerse(ref); } }, [livePage]);
  const listeningEnabled = baseline?.referenceListeningEnabled === true;
  const textReady = Boolean(livePage && !concealed), canHear = textReady && active && listeningEnabled;
  const shortView = useRef({ baseline, page: livePage, kind: state.kind, active, concealed, lift });
  shortView.current = { baseline, page: livePage, kind: state.kind, active, concealed, lift };
  useLayoutEffect(() => {
    if (!baseline || !livePage || !state.kind || !listeningEnabled) return;
    const value = baseline, page = livePage, kind = state.kind, turn = generation.current;
    const live = () => { const now = shortView.current; return now.baseline === value && metadata.current === value && now.page === page && now.kind === kind
      && turn === generation.current && !now.concealed && now.active && !now.lift && document.visibilityState === "visible"; };
    let owned: ShortReferenceOwner;
    try { owned = createShortReferenceOwner(value, kind, page.offset, live); } catch { return; }
    shortMetadata.current = owned;
    if (live()) void owned.prepare().catch(() => undefined);
    return () => { owned.dispose(); if (shortMetadata.current === owned) shortMetadata.current = null; };
  }, [baseline, livePage, state.kind, createShortReferenceOwner, epoch, key, listeningEnabled]);
  useLayoutEffect(() => {
    if (concealed || !active || lift) shortMetadata.current?.suspend();
  }, [concealed, active, lift]);
  useLayoutEffect(() => {
    const background = () => { if (document.visibilityState !== "visible") shortMetadata.current?.suspend(); };
    const leave = () => shortMetadata.current?.suspend();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, []);
  // Separate modal ownership: main owner remains restricted by !lift. Navigation
  // cancels only its subscriber; an authorized completed page can stay modal-local.
  useLayoutEffect(() => {
    if (!baseline || !livePage || !state.kind || !lift || !audio || !listeningEnabled) return;
    const value = baseline, page = livePage, kind = state.kind, opening = lift.opening, turn = generation.current;
    const live = () => { const now = shortView.current; return now.baseline === value && metadata.current === value && now.page === page && now.kind === kind
      && turn === generation.current && modalScope.current?.opening === opening && modalScope.current.page === page
      && !now.concealed && now.active && document.visibilityState === "visible"; };
    let owned: ShortReferenceOwner;
    try { owned = createShortReferenceOwner(value, kind, page.offset, live); } catch { return; }
    modalOwner.current = owned; // Deliberately no prepare on mount/navigation.
    const stop = () => { modalRequest.current?.abort(); owned.suspend(); stopAudio?.(); };
    const hidden = () => { if (document.visibilityState !== "visible") stop(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", stop);
    const deadline = value.context ? watchReadingAudioDeadline(Date.parse(value.context.expiresAt), () => modalOwner.current === owned, stop) : () => {};
    return () => { deadline(); modalRequest.current?.abort(); owned.dispose(); if (modalOwner.current === owned) modalOwner.current = null;
      document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", stop); };
  }, [baseline, livePage, state.kind, lift?.opening, createShortReferenceOwner, epoch, key, audio, stopAudio, listeningEnabled]);
  useLayoutEffect(() => { if (concealed || !active) { modalRequest.current?.abort(); modalOwner.current?.suspend(); } }, [concealed, active]);
  const openerScope = useRef({ baseline, page: livePage, concealed, epoch });
  openerScope.current = { baseline, page: livePage, concealed, epoch };
  useLayoutEffect(() => { onHearReady?.(canHear); return () => onHearReady?.(false); }, [canHear, onHearReady]);
  useLayoutEffect(() => { onPracticeReady?.(textReady); return () => onPracticeReady?.(false); }, [textReady, onPracticeReady]);
  useLayoutEffect(() => { if (concealed || !active) setLift(null); }, [concealed, active, epoch]);
  const shown = livePage && state.kind ? [state.kind, livePage.offset, livePage.verses.length] as const : null;
  // Commentary for the verses on screen, after they render: Rashi (Lein's "Rashi (n)" and Study), and the
  // Women's Commentary when Study shows it on Torah. Public texts only; nothing about the student is sent.
  const commentaryRefs = useMemo(() => livePage && !concealed ? livePage.verses.map(verse => verse.ref) : [], [livePage, concealed]);
  const corpus = state.kind === "haftarah" ? "neviim" : "torah";
  const { rashi, works } = useReadingWorks(commentaryRefs, { ready: commentaryRefs.length > 0, study, chosen: lens.works, corpus: state.kind === "torah" ? "torah" : "neviim" });
  const clearLink = leinLink.clear;
  useEffect(() => { clearLink(); }, [livePage, study, clearLink]);
  useEffect(() => { if (shown) onShown?.(...shown); }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolsVerse = livePage && toolsRef ? livePage.verses.find(row => row.ref === toolsRef) ?? null : null;
  useEffect(() => { if (toolsRef && livePage && !toolsVerse) setToolsRef(null); }, [toolsRef, livePage, toolsVerse]);
  // Closing asks the sources guard first, because the sheet's Sources hold choices that closing would drop. Unsent translation and notes are not asked about:
  // their text lives in the work coordinator, not in the sheet, so closing loses nothing and the reader's place and words are all still there on reopening.
  const closeTools = async () => { if (await guardLeaving("sources")) setToolsRef(null); };
  const openTools = (ref: string, opener: HTMLElement | null) => { toolsOpener.current = opener; setPicked(ref); setToolsRef(ref); };
  const hear = (page: StudyPage, index: number, word: ReadingSelection = "verse") => { setPicked(page.verses[index].ref); playback.current?.select(index, word); if (word === "verse") tools.current?.selectVerse(index); else tools.current?.select(index, word); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  const open = (page: StudyPage, index: number) => { setPicked(page.verses[index].ref); stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.suspend(); modalRequest.current?.abort();
    const old = modalScope.current, next = { page, index, opening: old?.page === page ? old.opening : ++modalSequence.current, navigation: (old?.navigation ?? 0) + 1 };
    modalScope.current = next; setLift(next); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  if (verseLookupHandle) verseLookupHandle.current = livePage && !concealed ? ref => livePage.verses.find(row => row.ref === ref) ?? null : null;
  // Explicit held Start reports the first verse of this live page; focus/reload do not.
  if (textStartHandle) {
    const scope = openerScope.current, turn = generation.current, kind = state.kind;
    textStartHandle.current = livePage && !concealed && !listeningEnabled && kind ? () => {
      if (openerScope.current !== scope || scope.concealed || metadata.current !== baseline
        || generation.current !== turn || controller.current?.signal.aborted) return;
      const first = livePage.verses[0];
      if (first) onVisit?.(kind, first.ref);
    } : null;
  }
  if (liftHandle || practiceHandle) {
    // Parent actions bring this tab forward in the same event.
    // Inactivity still unmounts media; it does not revoke this explicit opener.
    const scope = openerScope.current, turn = generation.current;
    const act = (practice: boolean) => livePage && !concealed ? (index: number) => {
      if (openerScope.current !== scope || scope.concealed || metadata.current !== baseline
        || generation.current !== turn || controller.current?.signal.aborted) return;
      const selected = Math.min(Math.max(index, 0), livePage.verses.length - 1);
      if (practice) open(livePage, selected); else if (listeningEnabled) hear(livePage, selected);
    } : null;
    if (liftHandle) liftHandle.current = act(false);
    if (practiceHandle) practiceHandle.current = act(true);
  }
  if (!baseline) return <section className="assigned-study" aria-label="Assigned text"><p role="status">Text is hidden while the assignment is checked.</p></section>;
  if (!baseline.readings.length) return null;
  const kind = current?.kind ?? selection.current?.kind ?? baseline.readings[0].kind, assignment = baseline.readings.find(row => row.kind === kind);
  // The text pages of what is open: the whole assignment, or the open section (which starts its own first page).
  const first = sectionNow >= 0 ? sections[sectionNow].start : 0, last = sectionNow >= 0 ? sections[sectionNow].end : Infinity;
  const offsets = [first]; if (assignment && livePage) { let next: number | null = first; while (next !== null) { const page = studyPlan(baseline, kind, next); next = page.nextOffset; if (next !== null && next < last) offsets.push(next); else next = null; } }
  const previous = livePage ? offsets[offsets.indexOf(livePage.offset) - 1] : undefined;
  const single = livePage ? previous === undefined && livePage.nextOffset === null : false;
  // Study's word card (1.7): the verse panel reads word details through the same authority checks as Word tools.
  const wordScope = JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage?.offset, generation.current]);
  const wordHost: WordPanelHost | null = study && !concealed && active && livePage && !current?.loading ? {
    scopeKey: wordScope, verses: livePage.verses,
    readAids: async (index, signal) => {
      const value = baseline, page = livePage!, turn = generation.current;
      if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
      const result = await readWordAids(value, kind, page.offset + index, page.verses[index], signal);
      if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
      return result;
    },
    readDetails: async (index, word, signal) => {
      const value = baseline, page = livePage!, turn = generation.current;
      if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
      const result = await readWordDetails(value, kind, page.offset + index, page.verses[index], word, signal);
      if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
      return result;
    },
    onHear: listeningEnabled ? (index, word) => hear(livePage!, index, word) : undefined,
    onVisit: ref => onVisit?.(kind, ref),
    reveal: ref => jumpTo(ref),
  } : null;
  const jumpTo = (ref: string) => {
    if (livePage?.verses.some(row => row.ref === ref)) { scrollToVerse(ref); return; }
    const target = pageFor(assignment!.verses.indexOf(ref));
    if (target !== null && target !== livePage?.offset) { pendingJump.current = ref; void explicitLoad(kind, target); }
  };
  // The offset of the text page that holds a verse (by its place in the assignment): a section's pages begin at the section's start, else the server's own chain from 0.
  function pageFor(position: number): number | null {
    if (position < 0) return null;
    let at = sections.length ? sections[Math.max(0, sectionIndexAt(sections, position))].start : 0;
    for (;;) { const plan = studyPlan(baseline!, kind, at); if (plan.nextOffset === null || plan.nextOffset > position) return at; at = plan.nextOffset; }
  }
  const goSection = (index: number) => { const target = sections[index]; if (target && target.start !== livePage?.offset) void explicitLoad(kind, target.start); };
  return <section className="assigned-study" aria-label="Assigned text" data-size={prefs.size}>
    <WordPanelSource host={wordHost} />
    {/* On a learner's phone the switch waits under the passage, so the first verse stays above the fold. */}
    {(baseline.readings.length > 1 || lens.available) && <div className="reading-lens-row" data-learner={learner ? "" : undefined}>
      {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-label={row.kind === "torah" ? "Torah text" : "Haftarah text"} aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}{serviceHref && <a className="button-secondary service-entry" href={serviceHref}>Service parts</a>}</div>}
      <LensSwitch />
    </div>}
    {/* The section chips (N3): a tab for each recorded aliyah, and "Service parts" last. In the sticky bar above the text, for every role: a learner's page tabs sit under the reading. */}
    {sections.length > 0 && <SectionTabs sticky label="Reading sections" current={sectionNow >= 0 ? sections[sectionNow].n : null}
      tabs={[...sections.map(row => ({ id: row.n, label: row.label })), ...onService ? [{ id: SERVICE_CHIP, label: "Service parts" }] : []]}
      onSelect={id => { if (id === SERVICE_CHIP) onService?.(); else goSection(sections.findIndex(row => row.n === id)); }} />}
    {/* The portion summary (1.9 N7), atop Study: only an approved one, only on a calendar parashah's Torah. A line goes to its aliyah only where the tutor
        recorded the whole portion aliyah by aliyah (seven sections); a student's own divisions are not the calendar's, so then the outline is plain text. */}
    {study && kind === "torah" && <StudySummary slug={parashahSlug(assignment?.readingKey)} active={active && !concealed} aliyot={sections.length >= 7 ? sections.map(row => row.n) : undefined}
      onAliyah={n => { const target = sections.find(row => row.n === n); if (target && assignment) jumpTo(assignment.verses[target.start]); }} />}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status"><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? learner ? "Your reading was just updated. Load the new version to keep going." : "Refresh the reading metadata before loading this assignment’s text again." : learner ? "The verses didn’t load. Check your connection and try again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
      {renderActiveWork?.()}
    </div> : livePage && <>
      {study ? <>
        <CommentaryStatus works={workStatuses(works, corpus)} />
        <ReadingPlace refs={assignment!.verses} pageKey={wordScope} onJump={jumpTo} />
        <StudyRows verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={lens.english}
          sections={aliyahSections(kind, assignment!, livePage.verses)} works={ref => works.map(row => ({ work: row.work, state: row.lookup.forVerse(ref) }))}
          onVerse={listeningEnabled ? index => hear(livePage!, index) : undefined} onWord={(index, word) => { setPicked(livePage!.verses[index].ref); if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else { tools.current?.select(index, word); tools.current?.reveal(); } onVisit?.(kind, livePage!.verses[index].ref); }}
          onTools={(ref, opener) => openTools(ref, opener)} />
      </> : <FlowingStudyText verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={songSession && prefs.translation} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
        sections={aliyahSections(kind, assignment!, livePage.verses)} linked={linkedVerse(leinLink, livePage.verses)}
        onVerse={listeningEnabled ? index => hear(livePage!, index) : undefined} onWord={(index, word) => { setPicked(livePage!.verses[index].ref); if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else { tools.current?.select(index, word); tools.current?.reveal(); } onVisit?.(kind, livePage!.verses[index].ref); }} />}
      {/* The end of the section (N3): the next one's first verse, faint, and the way on. The verse comes from the page already loaded, when it is on it. */}
      {sectionNow >= 0 && sectionNow + 1 < sections.length && livePage.nextOffset === null
        && <NextSection onNext={() => goSection(sectionNow + 1)} preview={rawPage?.verses[sections[sectionNow + 1].start - rawPage.offset]} />}
      {!concealed && listeningEnabled && <ReadingPlayer key={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])}
        scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])} verses={livePage.verses} active={active && !lift} enabled={!concealed && !lift} expiresAt={baseline?.context ? Date.parse(baseline.context.expiresAt) : undefined} audio={audio ? { coordinator: audio, slot: "assigned" } : undefined}
        register={registerPlayback} onActiveWord={setPlayingWord} load={async (index, signal) => {
          const value = baseline, page = livePage!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const owned = shortMetadata.current; if (!owned) throw new PortalRequestError(409);
          const result = await owned.load(index, signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} />}
      {!concealed && active && <WordTools key={`word-tools:${JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])}`}
        scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])} verses={livePage.verses} register={registerTools}
        readAids={async (index, signal) => {
          const value = baseline, page = livePage!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const result = await readWordAids(value, kind, page.offset + index, page.verses[index], signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} readDetails={async (index, word, signal) => {
          const value = baseline, page = livePage!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const result = await readWordDetails(value, kind, page.offset + index, page.verses[index], word, signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} onHear={listeningEnabled ? (index, word) => hear(livePage!, index, word) : undefined}
        onPlace={(ref, wordIndex) => {
          const page = livePage!, here = page.verses.findIndex(row => row.ref === ref), position = assignment!.verses.indexOf(ref);
          if (position < 0) return;
          if (here >= 0) { tools.current?.select(here, wordIndex); onVisit?.(kind, ref); return; }
          const target = pageFor(position);
          if (target !== null && target !== page.offset) void explicitLoad(kind, target, { ref, wordIndex });
        }}
        takePlace={() => { const place = pendingPlace.current, page = livePage!; pendingPlace.current = null;
          return place && place.kind === kind && place.offset === page.offset && place.turn === generation.current ? { ref: place.ref, wordIndex: place.wordIndex } : null; }} />}
      {/* The selected verse (1.9 N4): its tools are one Sheet, its mark and Up close beside it. Only this verse's tools are ever on the page, however long the section. */}
      {(() => { const index = Math.max(0, livePage.verses.findIndex(row => row.ref === picked)), verse = livePage.verses[index];
        return <div className="study-verse-bar" data-selected-verse={verse.ref}>
          <button type="button" className="button-secondary" aria-haspopup="dialog" onClick={event => openTools(verse.ref, event.currentTarget)}>Verse tools · <bdi dir="ltr">{verse.ref}</bdi></button>
          <button type="button" className="button-text" onClick={() => open(livePage!, index)}>View {verse.ref} up close</button>
          {renderMark?.(kind, verse.ref)}
        </div>; })()}
      {toolsVerse && <Sheet open onClose={() => void closeTools()} title={`Verse tools · ${toolsVerse.ref}`} closeLabel="Close" returnFocusTo={() => toolsOpener.current}>
        <div className="study-verse-detail" data-verse-ref={toolsVerse.ref}>
          {renderMark && <div className="verse-card-head">{renderMark(kind, toolsVerse.ref)}</div>}
          {!songSession && !study && <p className="study-english" lang="en" dir="ltr">{toolsVerse.english ?? "English reference unavailable for this verse."}</p>}
          <Apparatus verse={toolsVerse} learner={learner} />{renderGuide?.(kind, toolsVerse.ref)}
          {!study && <VerseRashi verse={toolsVerse} state={rashi.lookup.forVerse(toolsVerse.ref)} link={leinLink} retry={rashi.retry} />}
          {!concealed && <SourcesPanel key={`sources:${JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage!.offset, generation.current, toolsVerse.ref])}`}
            scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage!.offset, generation.current, toolsVerse.ref])} baseline={baseline} kind={kind} offset={livePage!.offset + livePage.verses.indexOf(toolsVerse)} onRefreshReading={reloadMetadata} />}
          {renderWork?.(kind, toolsVerse.ref)}
        </div>
      </Sheet>}
      {!learner && kind==="torah" && assignment!.aliyahStarts===null && <p className="field-help">Aliyah boundaries have not been recorded for this assignment.</p>}
      {learner ? !single && <p className="study-page-position">Verses {livePage.offset + 1}–{livePage.offset + livePage.verses.length} of {livePage.totalVerses}</p>
        : <p role="status">Verses {livePage.offset + 1}–{livePage.offset + livePage.verses.length} of {livePage.totalVerses}. {livePage.translation.status === "partial" ? "The selected English edition is missing for some verses." : livePage.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>}
      {!learner && <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>}
      {!single && <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={livePage.nextOffset === null} onClick={() => livePage?.nextOffset !== null && void explicitLoad(kind, livePage!.nextOffset!)}>Next text page</button></nav>}
      {study && <CommentaryCredits works={works} refs={commentaryRefs} />}
      <div className="study-more"><StudyCredits chapters={livePage.chapters} summary={learner ? "About this text" : undefined} />{learner && <WorkspaceLink href="/trope-chart">Trope chart</WorkspaceLink>}{learner && onPrint && <button type="button" className="button-text study-print-action" onClick={onPrint}>Print practice sheet</button>}{learner && printSheetHref && <WorkspaceLink className="study-print-sheet" href={printSheetHref}>Print the whole reading</WorkspaceLink>}{learner && <div className="reading-lens-foot"><LensSwitch /></div>}</div>
      {lift && textReady && lift.page === livePage && <LiftedLine learner={learner} verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} index={lift.index} total={livePage.totalVerses} offset={livePage.offset}
        reference={audio && listeningEnabled ? { audio, active: active && !concealed, expiresAt: baseline.context ? Date.parse(baseline.context.expiresAt) : undefined,
          navigation: lift.navigation, scopeKey: JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current, lift.opening]),
          load: async (index, signal) => {
            const owner = modalOwner.current, selected = modalScope.current, turn = generation.current;
            if (!owner || !selected || index !== selected.index || selected.page !== livePage || signal.aborted) throw new PortalRequestError(409);
            modalRequest.current?.abort(); const request = new AbortController(); modalRequest.current = request;
            const abort = () => request.abort(); signal.addEventListener("abort", abort, { once: true });
            try { const result = await owner.load(index, request.signal);
              if (request.signal.aborted || modalScope.current !== selected || turn !== generation.current || metadata.current !== baseline) throw new PortalRequestError(409);
              return result;
            } finally { signal.removeEventListener("abort", abort); if (modalRequest.current === request) modalRequest.current = null; }
          } } : undefined}
        onIndex={index => open(lift.page, index)} onClose={() => { stopAudio?.(); modalScope.current = null; modalRequest.current?.abort(); modalOwner.current?.dispose(); modalOwner.current = null; setLift(null); }} controls={renderLiftControls && (ref => renderLiftControls(kind, ref))} />}
    </>}
  </section>;
}
