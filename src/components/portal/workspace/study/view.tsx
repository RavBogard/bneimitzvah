"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";
import { type Assigned } from "../api";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { studyBinding, studyPlan, type StudyKind, type StudyPage, type StudyVerse } from "./api";
import { StudyCredits } from "./credits";
import { Apparatus, FlowingStudyText } from "./annotations";
import { nextAssignedVerse } from "./section-playback";
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
import type { WordPanelHost } from "./word-panel";
import { ReadingPlace, scrollToVerse } from "./reading-place";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";
import { sectionIndexAt, sectionsFromStarts, type Section } from "../../../../lib/readings/sections";
import { SectionTabs, Sheet } from "../../../ui";
import { NextSection } from "./next-section";
import { PortalRequestError } from "../../api";
import { readingAudioCurrent, watchReadingAudioDeadline } from "./reading-player-intent";
import type { ShortReferenceOwner } from "./short-reference-bridge";
import type { GuideStore } from "./guide-store";
import { additionsFor, themeHeadings } from "./notes-model";
import { firstLine } from "./markdown-lite";

const noGuide = () => () => {}, noVersion = () => 0;
/** The guide's view for one text, kept current; null without a guide. */
function useGuideView(store: GuideStore | undefined, kind: StudyKind | undefined) {
  useSyncExternalStore(store?.subscribe ?? noGuide, store?.snapshot ?? noVersion, store?.snapshot ?? noVersion);
  return store && kind ? store.view(kind) : null;
}

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
const NO_SECTIONS: readonly Section[] = Object.freeze([]), SERVICE_CHIP = "service";
/** Aliyah labels above the verse where an aliyah starts (or continues from the previous text page), in either lens. */
function aliyahSections(kind: StudyKind, assignment: Assigned["readings"][number], verses: readonly StudyVerse[]) {
  return verses.flatMap((verse, index) => { const position = aliyahPosition(kind, assignment.aliyahStarts, assignment.verses, verse.ref);
    return position && (position.startsHere || index === 0) ? [{ index, label: `Aliyah ${position.number}${position.startsHere ? " starts here" : " · continued from the previous text page"}` }] : []; });
}
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange, guardDeparture, serviceHref, renderGuide, guide, renderIntro, renderWork, renderActiveWork, onPage, onPrint, printSheetHref, learner = false, liftHandle, practiceHandle, upCloseHandle, textStartHandle, verseLookupHandle, songSession = learner, onShown, renderMark, renderLiftControls, onVisit, onHearReady, onPracticeReady, onService, active = true, audio, stopAudio, practicing = false, gotIt, onOpenPractice, practiceSurface = false, renderSectionControls }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
  guardDeparture?(): Promise<boolean>; serviceHref?: string; renderGuide?(kind: StudyKind, verseRef: string): ReactNode;
  /** The study guide, so Study's rail can mark the verses it has notes on and open on the first of them. */
  guide?: GuideStore;
  /** Study's intro at the top of the text (the guide's overview), drawn only in Study. */
  renderIntro?(kind: StudyKind): ReactNode;
  renderWork?(kind: StudyKind, verseRef: string): ReactNode; renderActiveWork?(): ReactNode; onPage?(kind: StudyKind, offset: number, signal: AbortSignal): Promise<void>;
  /** Opens the printable practice sheet; learners on phones reach it here rather than in the hero. */
  onPrint?(): void;
  /** The reader's print sheet of these verses (/print), shown under the reading on a learner's phone. */
  printSheetHref?: string;
  /** Students and child practice see the reading without status or provenance prose. */
  learner?: boolean; liftHandle?: MutableRefObject<((index: number) => void) | null>;
  /** Opens Up close at a verse of the page on screen: its index, or a choice made from the page's verse refs (the first not yet Got it). */
  practiceHandle?: MutableRefObject<((index: number | ((refs: readonly string[]) => number)) => void) | null>;
  /** Opens Up close at one verse of the assignment, loading the text page that holds it first (the pinned card's next step, student gaps A3); false when the verse is not assigned. */
  upCloseHandle?: MutableRefObject<((kind: StudyKind, ref: string) => boolean) | null>;
  textStartHandle?: MutableRefObject<(() => void) | null>;
  /** Looks up a verse on the live page, for the Study walk; null while loading. */
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
  /** The student practicing on a phone (student and child practice): a tapped word or verse number opens a sheet over the text and the page never scrolls on
   *  its own; the selected verse's actions live in its sheet, not in a bar after the passage; after the text only About and the practice sheet remain here. */
  practicing?: boolean;
  /** True when the student has marked this verse Got it (the check beside its number). */
  gotIt?(kind: StudyKind, verseRef: string): boolean;
  /** Present this same authorized aliyah as the lesson surface, keeping its player and passage mounted. */
  onOpenPractice?(): void;
  practiceSurface?: boolean;
  renderSectionControls?(section: { studentId: string; mode: Assigned["mode"]; assignmentId: string; assignmentRevision: number; kind: StudyKind; startVerse: string; practiceSurface: boolean }): ReactNode;
}) {
  const { readStudy, createShortReferenceOwner, readWordAids, readWordDetails, summary, epoch, guardDeparture: guardLeaving } = useWorkspace(), aidsGroup = useId(), prefs = useReadingPrefs();
  const lens = useStudyLens(), study = !practiceSurface && lens.lens === "study", leinLink = useCommentLink();
  const shortMetadata = useRef<ShortReferenceOwner | null>(null);
  const passageRef = useRef<HTMLDivElement>(null);
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
  // A verse Up close was asked to open on, once the text page that holds it is on screen.
  const pendingLift = useRef<{ kind: StudyKind; ref: string } | null>(null);
  type Run = { baseline: Assigned; kind: StudyKind; end: number; at: number; pageOffset: number; pending: boolean; continuous: boolean; focusNext: boolean };
  const run = useRef<Run | null>(null);
  const [runState, setRunState] = useState<"playing" | "finished" | "failed" | null>(null);
  const cancelRun = useCallback(() => { run.current = null; setRunState(null); }, []);
  useLayoutEffect(() => audio?.observe(slot => { if (slot !== "assigned") cancelRun(); }), [audio, cancelRun]);
  const [state, setState] = useState<{ binding: string; kind?: StudyKind; page?: StudyPage; error?: number; loading?: boolean }>({ binding: "" });
  const key = baseline ? studyBinding(baseline) : "";
  const readingDeadline = baseline?.context ? Date.parse(baseline.context.expiresAt) : undefined;
  const clear = useCallback(() => { cancelRun(); stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.dispose(); shortMetadata.current = null; modalRequest.current?.abort(); modalOwner.current?.dispose(); modalOwner.current = null; generation.current++; controller.current?.abort(); setLift(null); setState({ binding: "", loading: true }); }, [stopAudio, cancelRun]);
  const load = useCallback(async (value: Assigned, kind: StudyKind, offset: number, outer?: AbortSignal, continuation?: Run) => {
    if (continuation) {
      if (run.current !== continuation) return false;
      if (!readingAudioCurrent(value.context ? Date.parse(value.context.expiresAt) : undefined)) { cancelRun(); return false; }
    } else { cancelRun(); stopAudio?.(); }
    playback.current?.suspend(); shortMetadata.current?.dispose(); shortMetadata.current = null;
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
  }, [readStudy, authorityFailed, onKindChange, stopAudio, cancelRun]);
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
  useLayoutEffect(() => () => { run.current = null; generation.current++; controller.current?.abort(); metadata.current = null; }, []);
  useLayoutEffect(() => { cancelRun(); }, [key, epoch, active, study, practiceSurface, cancelRun]);
  const current = key && state.binding === key ? state : null;
  async function explicitLoad(kind: StudyKind, offset: number, place?: { ref: string; wordIndex: number }, continuation?: Run) {
    if (!continuation) cancelRun();
    const value = metadata.current;
    if (!value || studyBinding(value) !== key) { if (continuation && run.current === continuation) cancelRun(); return; }
    if (guardDeparture && !await guardDeparture()) { if (continuation && run.current === continuation) cancelRun(); return; }
    if (continuation && run.current !== continuation) return;
    if (metadata.current !== value || studyBinding(value) !== key) { if (continuation && run.current === continuation) cancelRun(); return; }
    try {
      const pending = load(value, kind, offset, undefined, continuation), request = controller.current, turn = generation.current;
      pendingPlace.current = place ? { kind, offset, turn, ref: place.ref, wordIndex: place.wordIndex } : null;
      const loaded = await pending;
      if (!loaded && continuation && run.current === continuation) cancelRun();
      if (loaded && place && controller.current === request && turn === generation.current) onVisit?.(kind, place.ref);
      if (loaded && onPage && request && controller.current === request && turn === generation.current && !request.signal.aborted && metadata.current === value) await onPage(kind, offset, request.signal);
    } catch { if (continuation && run.current === continuation) cancelRun(); /* Authority state has already cleared text and metadata. */ }
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
  const textReady = Boolean(livePage), canHear = textReady && active && listeningEnabled;
  const shortView = useRef({ baseline, page: livePage, kind: state.kind, active, lift });
  shortView.current = { baseline, page: livePage, kind: state.kind, active, lift };
  useLayoutEffect(() => {
    if (!baseline || !livePage || !state.kind || !listeningEnabled || study) return;
    const value = baseline, page = livePage, kind = state.kind, turn = generation.current;
    const live = () => { const now = shortView.current; return now.baseline === value && metadata.current === value && now.page === page && now.kind === kind
      && turn === generation.current && now.active && !now.lift && document.visibilityState === "visible"; };
    let owned: ShortReferenceOwner;
    try { owned = createShortReferenceOwner(value, kind, page.offset, live); } catch { return; }
    shortMetadata.current = owned;
    if (live()) void owned.prepare().catch(() => undefined);
    return () => { owned.dispose(); if (shortMetadata.current === owned) shortMetadata.current = null; };
  }, [baseline, livePage, state.kind, createShortReferenceOwner, epoch, key, listeningEnabled, study]);
  useLayoutEffect(() => {
    if (!active || lift) shortMetadata.current?.suspend();
  }, [active, lift]);
  useLayoutEffect(() => {
    const leave = () => { cancelRun(); shortMetadata.current?.suspend(); };
    const background = () => { if (document.visibilityState !== "visible") leave(); };
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [cancelRun]);
  // Separate modal ownership: main owner remains restricted by !lift. Navigation
  // cancels only its subscriber; an authorized completed page can stay modal-local.
  useLayoutEffect(() => {
    if (!baseline || !livePage || !state.kind || !lift || !audio || !listeningEnabled) return;
    const value = baseline, page = livePage, kind = state.kind, opening = lift.opening, turn = generation.current;
    const live = () => { const now = shortView.current; return now.baseline === value && metadata.current === value && now.page === page && now.kind === kind
      && turn === generation.current && modalScope.current?.opening === opening && modalScope.current.page === page
      && now.active && document.visibilityState === "visible"; };
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
  useLayoutEffect(() => { if (!active) { modalRequest.current?.abort(); modalOwner.current?.suspend(); } }, [active]);
  const openerScope = useRef({ baseline, page: livePage, epoch });
  openerScope.current = { baseline, page: livePage, epoch };
  useLayoutEffect(() => { onHearReady?.(canHear); return () => onHearReady?.(false); }, [canHear, onHearReady]);
  useLayoutEffect(() => { onPracticeReady?.(textReady); return () => onPracticeReady?.(false); }, [textReady, onPracticeReady]);
  useLayoutEffect(() => { if (!active) setLift(null); }, [active, epoch]);
  const shown = livePage && state.kind ? [state.kind, livePage.offset, livePage.verses.length] as const : null;
  // Commentary for the verses on screen, after they render: Rashi (Lein's "Rashi (n)" and Study), and the
  // Women's Commentary when Study shows it on Torah. Public texts only; nothing about the student is sent.
  const commentaryRefs = useMemo(() => livePage ? livePage.verses.map(verse => verse.ref) : [], [livePage]);
  const corpus = state.kind === "haftarah" ? "neviim" : "torah";
  const guideView = useGuideView(guide, state.kind);
  const { rashi, works } = useReadingWorks(commentaryRefs, { ready: commentaryRefs.length > 0, study, chosen: lens.works, corpus: state.kind === "torah" ? "torah" : "neviim" });
  // Study's notes (v6): only the rabbi-written per-student notes and headings come from the guide; the base guide's notes and themes are never drawn.
  const workStates = useMemo(() => (ref: string) => works.map(row => ({ work: row.work, state: row.lookup.forVerse(ref) })), [works]);
  const additionsOf = useCallback((ref: string) => additionsFor(guideView, ref), [guideView]);
  const readingVerses = baseline?.readings.find(row => row.kind === state.kind)?.verses;
  const headings = useMemo(() => themeHeadings(guideView, readingVerses ?? [], firstLine), [guideView, readingVerses]);
  const clearLink = leinLink.clear;
  useEffect(() => { clearLink(); }, [livePage, study, clearLink]);
  useEffect(() => { if (shown) onShown?.(...shown); }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolsVerse = livePage && toolsRef ? livePage.verses.find(row => row.ref === toolsRef) ?? null : null;
  useEffect(() => { if (toolsRef && livePage && !toolsVerse) setToolsRef(null); }, [toolsRef, livePage, toolsVerse]);
  // Closing asks the sources guard first, because the sheet's Sources hold choices that closing would drop. Unsent notes are not asked about:
  // their text lives in the work coordinator, not in the sheet, so closing loses nothing and the reader's place and words are all still there on reopening.
  const closeTools = async () => { if (!await guardLeaving("sources")) return false; setToolsRef(null); return true; };
  const openTools = (ref: string, opener: HTMLElement | null) => { toolsOpener.current = opener; setPicked(ref); setToolsRef(ref); };
  // Study plays nothing (2026-10-28): there a verse is only chosen.
  const hear = (page: StudyPage, index: number, word: ReadingSelection = "verse") => { setPicked(page.verses[index].ref); if (study) return; playback.current?.select(index, word); if (word === "verse") tools.current?.selectVerse(index); else tools.current?.select(index, word); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  const open = (page: StudyPage, index: number) => { cancelRun(); setPicked(page.verses[index].ref);
    if (onOpenPractice) { setToolsRef(null); onOpenPractice(); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); requestAnimationFrame(() => scrollToVerse(page.verses[index].ref)); return; }
    stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.suspend(); modalRequest.current?.abort();
    const old = modalScope.current, next = { page, index, opening: old?.page === page ? old.opening : ++modalSequence.current, navigation: (old?.navigation ?? 0) + 1 };
    modalScope.current = next; setLift(next); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  if (verseLookupHandle) verseLookupHandle.current = livePage ? ref => livePage.verses.find(row => row.ref === ref) ?? null : null;
  // Explicit held Start reports the first verse of this live page; focus/reload do not.
  if (textStartHandle) {
    const scope = openerScope.current, turn = generation.current, kind = state.kind;
    textStartHandle.current = livePage && !listeningEnabled && kind ? () => {
      if (openerScope.current !== scope || metadata.current !== baseline
        || generation.current !== turn || controller.current?.signal.aborted) return;
      const first = livePage.verses[0];
      if (first) onVisit?.(kind, first.ref);
    } : null;
  }
  // Up close at a verse on another text page or of the other reading: that page loads first, then Up close opens on it (student gaps A3).
  useEffect(() => {
    const want = pendingLift.current; if (!want || !livePage || state.kind !== want.kind) return;
    const index = livePage.verses.findIndex(row => row.ref === want.ref); if (index < 0) return;
    pendingLift.current = null; open(livePage, index);
  }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  function playRunVerse(page: StudyPage, selected: Run) {
    const index = selected.at - page.offset;
    const verse = page.verses[index];
    const reading = selected.baseline.readings.find(row => row.kind === selected.kind);
    if (metadata.current !== selected.baseline || !playback.current || !verse || verse.ref !== reading?.verses[selected.at]
      || !active || study || !readingAudioCurrent(readingDeadline) || document.visibilityState !== "visible") { cancelRun(); return; }
    selected.pending = false;
    setPicked(verse.ref); tools.current?.selectVerse(index);
    if (selected.continuous) playback.current.selectForRun(index);
    else { run.current = null; playback.current.select(index); }
    onVisit?.(selected.kind, verse.ref);
    if (selected.focusNext) {
      selected.focusNext = false;
      const row = passageRef.current?.querySelector('[data-verse-ref="' + CSS.escape(verse.ref) + '"]');
      const control = row?.querySelector<HTMLElement>('button[data-verse-number], [data-word-index][role="button"]');
      control?.focus({ preventScroll: true });
      control?.scrollIntoView({ block: "center" });
    }
  }
  useEffect(() => {
    const selected = run.current;
    if (selected?.pending && livePage?.offset === selected.pageOffset && state.kind === selected.kind) playRunVerse(livePage, selected);
  }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  if (upCloseHandle) upCloseHandle.current = livePage && baseline ? (want, ref) => {
    const row = baseline.readings.find(item => item.kind === want), position = row ? row.verses.indexOf(ref) : -1;
    if (!row || position < 0) return false;
    const parts = want === "torah" ? sectionsFromStarts(row.verses, row.aliyahStarts) : [];
    let at = parts.length ? parts[Math.max(0, sectionIndexAt(parts, position))].start : 0;
    for (;;) { const plan = studyPlan(baseline, want, at); if (plan.nextOffset === null || plan.nextOffset > position) break; at = plan.nextOffset; }
    pendingLift.current = { kind: want, ref };
    if (state.kind === want && livePage.offset === at) { const index = livePage.verses.findIndex(verse => verse.ref === ref); if (index >= 0) { pendingLift.current = null; open(livePage, index); return true; } }
    void explicitLoad(want, at);
    return true;
  } : null;
  if (liftHandle || practiceHandle) {
    // Parent actions bring this tab forward in the same event.
    // Inactivity still unmounts media; it does not revoke this explicit opener.
    const scope = openerScope.current, turn = generation.current;
    const act = (practice: boolean) => livePage ? (choice: number | ((refs: readonly string[]) => number)) => {
      if (openerScope.current !== scope || metadata.current !== baseline
        || generation.current !== turn || controller.current?.signal.aborted) return;
      const index = typeof choice === "function" ? choice(livePage.verses.map(row => row.ref)) : choice;
      const selected = Math.min(Math.max(index, 0), livePage.verses.length - 1);
      if (practice) open(livePage, typeof choice === "function" ? selected : picked ? Math.max(0, livePage.verses.findIndex(row => row.ref === picked)) : selected); else if (listeningEnabled) hear(livePage, selected);
    } : null;
    if (liftHandle) liftHandle.current = act(false);
    if (practiceHandle) practiceHandle.current = act(true);
  }
  if (!baseline) return <section className="assigned-study" aria-label="Assigned text"><p role="status">Text is hidden while the assignment is checked.</p></section>;
  if (!baseline.readings.length) return null;
  const kind = current?.kind ?? selection.current?.kind ?? baseline.readings[0].kind, assignment = baseline.readings.find(row => row.kind === kind);
  // The text pages of what is open: the whole assignment, or the open section (which starts its own first page).
  const first = sectionNow >= 0 ? sections[sectionNow].start : 0, last = sectionNow >= 0 ? sections[sectionNow].end : (assignment?.verses.length ?? 0);
  const offsets = [first]; if (assignment && livePage) { let next: number | null = first; while (next !== null) { const page = studyPlan(baseline, kind, next); next = page.nextOffset; if (next !== null && next < last) offsets.push(next); else next = null; } }
  const previous = livePage ? offsets[offsets.indexOf(livePage.offset) - 1] : undefined;
  const single = livePage ? previous === undefined && livePage.nextOffset === null : false;
  // Study's word card (1.7): the verse panel reads word details through the same authority checks as Word tools.
  const wordScope = JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage?.offset, generation.current]);
  const wordHost: WordPanelHost | null = study && active && livePage && !current?.loading ? {
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
    // Study plays nothing (2026-10-28): its word card has no Hear.
    onHear: undefined,
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
  const practiceRef = livePage?.verses.find(row => row.ref === picked)?.ref ?? livePage?.verses[0]?.ref;
  const playSection = () => {
    if (!livePage || !playback.current || !audio || first >= last || metadata.current !== baseline || !active || study || !readingAudioCurrent(readingDeadline)) return;
    audio.stopAll();
    const continuous = sectionNow >= 0;
    const selected: Run = { baseline, kind, at: first, end: last, pageOffset: first, pending: false, continuous, focusNext: false };
    run.current = selected;
    if (continuous) setRunState("playing");
    if (livePage.offset === first) playRunVerse(livePage, selected);
    else { selected.pending = true; void explicitLoad(kind, first, undefined, selected); }
  };
  const endRunVerse = (index: number) => {
    const selected = run.current;
    if (!selected || selected.pending || !livePage || selected.kind !== kind || selected.baseline !== baseline
      || selected.at !== livePage.offset + index) return;
    if (!readingAudioCurrent(readingDeadline)) { cancelRun(); return; }
    const next = nextAssignedVerse(selected, livePage);
    if (next.kind === "complete") { run.current = null; setRunState("finished"); return; }
    if (next.kind === "invalid") { cancelRun(); return; }
    selected.focusNext = Boolean(passageRef.current?.contains(document.activeElement?.closest("[data-player-transport]") ?? null));
    selected.at = next.at;
    if (next.kind === "verse") { playRunVerse(livePage, selected); return; }
    selected.pending = true; selected.pageOffset = next.at;
    void explicitLoad(kind, next.at, undefined, selected);
  };
  const failRunVerse = (index: number) => {
    const selected = run.current;
    if (!selected || selected.pending || !livePage || selected.baseline !== baseline || selected.kind !== kind || selected.at !== livePage.offset + index) return;
    run.current = null;
    setRunState("failed");
  };
  return <section className="assigned-study" data-testid="assigned-text" aria-label="Assigned text" data-size={prefs.size} data-practice-ref={practiceRef}>
    <WordPanelSource host={wordHost} />
    {/* On a learner's phone the switch waits under the passage, so the first verse stays above the fold. */}
    {(baseline.readings.length > 1 || lens.available) && <div className="reading-lens-row" data-learner={learner ? "" : undefined}>
      {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-label={row.kind === "torah" ? "Torah text" : "Haftarah text"} aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}{serviceHref && <a className="button-secondary service-entry" href={serviceHref}>Service parts</a>}</div>}
      {!practiceSurface && <LensSwitch />}
    </div>}
    {/* The section chips (N3): a tab for each recorded aliyah, and "Service parts" last. In the sticky bar above the text, for every role: a learner's page tabs sit under the reading. */}
    {sections.length > 0 && <SectionTabs sticky label="Reading sections" current={sectionNow >= 0 ? sections[sectionNow].n : null}
      tabs={[...sections.map(row => ({ id: row.n, label: row.label })), ...onService ? [{ id: SERVICE_CHIP, label: "Service parts" }] : []]}
      onSelect={id => { if (id === SERVICE_CHIP) onService?.(); else goSection(sections.findIndex(row => row.n === id)); }} />}
    {/* Study's About card (v6) is the one overview: the guide's, else the approved portion summary's text. The old summary block and its outline are gone. */}
    {study && renderIntro && <div className="study-intro">{renderIntro(kind)}</div>}
    {(livePage || runState === "playing") && <div className="study-section-start" data-testid="practice-section-start">
      {livePage && <h2>{sectionNow >= 0 ? sections[sectionNow].label : kind === "torah" ? "Torah reading" : "Haftarah reading"}</h2>}
      {listeningEnabled && active && !study && (runState === "playing"
        ? <button type="button" className="button-secondary" onClick={() => { cancelRun(); playback.current?.suspend(); }}>Stop aliyah</button>
        : <button type="button" className="button-secondary" data-testid="play-section-start" disabled={!readingAudioCurrent(readingDeadline)} onClick={playSection}>{sectionNow >= 0 ? "Play aliyah" : "Play from first verse"}</button>)}
      {runState === "finished" && <p role="status">Aliyah finished.</p>}
      {runState === "failed" && <p role="status">Playback stopped. Try this verse again or restart from the first verse.</p>}
    </div>}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status" data-testid="study-text-state" data-text-state={current.error === 409 ? "assignment-changed" : [401, 403, 404].includes(current.error) ? "access-changed" : "unavailable"}><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? learner ? "Your reading was just updated. Load the new version to keep going." : "Refresh the reading metadata before loading this assignment’s text again." : learner ? "The verses didn’t load. Check your connection and try again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
      {renderActiveWork?.()}
    </div> : livePage && <>
      {renderSectionControls?.({ studentId: baseline.student.id, mode: baseline.mode, assignmentId: assignment!.id, assignmentRevision: assignment!.revision, kind,
        startVerse: assignment!.verses[sectionNow >= 0 ? sections[sectionNow].start : 0], practiceSurface })}
      {study ? <>
        <CommentaryStatus works={workStatuses(works, corpus)} />
        <ReadingPlace refs={assignment!.verses} pageKey={wordScope} onJump={jumpTo} />
        <StudyRows verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} showEnglish={lens.english}
          sections={aliyahSections(kind, assignment!, livePage.verses)} works={workStates}
          additions={additionsOf} headings={headings} rabbiName={guideView?.additions?.label.rabbiName ?? guideView?.base?.label.rabbiName}
          onPick={ref => { setPicked(ref); onVisit?.(kind, ref); }} />
      </> : <FlowingStudyText passageRef={listeningEnabled ? passageRef : undefined} verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={songSession && prefs.translation} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
        sections={aliyahSections(kind, assignment!, livePage.verses)} linked={linkedVerse(leinLink, livePage.verses)}
        onNumber={practicing ? (index, opener) => { openTools(livePage!.verses[index].ref, opener); onVisit?.(kind, livePage!.verses[index].ref); } : undefined} gotIt={gotIt ? ref => gotIt(kind, ref) : undefined}
        onVerse={listeningEnabled ? index => hear(livePage!, index) : undefined} onWord={(index, word) => { setPicked(livePage!.verses[index].ref); if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else { tools.current?.select(index, word); tools.current?.reveal(); } onVisit?.(kind, livePage!.verses[index].ref); }} />}
      {/* The end of the section (N3): the next one's first verse, faint, and the way on. The verse comes from the page already loaded, when it is on it. */}
      {sectionNow >= 0 && sectionNow + 1 < sections.length && livePage.nextOffset === null
        && <NextSection onNext={() => goSection(sectionNow + 1)} preview={rawPage?.verses[sections[sectionNow + 1].start - rawPage.offset]} />}
      {listeningEnabled && !study && <ReadingPlayer passageRef={passageRef} key={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])}
        scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])} verses={livePage.verses} active={active && !lift} enabled={!lift} expiresAt={baseline?.context ? Date.parse(baseline.context.expiresAt) : undefined} audio={audio ? { coordinator: audio, slot: "assigned" } : undefined}
        register={registerPlayback} onActiveWord={setPlayingWord} onManualSelect={cancelRun} onVerseEnded={endRunVerse} onVerseFailed={failRunVerse} runActive={() => run.current?.continuous === true} load={async (index, signal) => {
          const value = baseline, page = livePage!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const owned = shortMetadata.current; if (!owned) throw new PortalRequestError(409);
          const result = await owned.load(index, signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} />}
      {active && <WordTools sheet={practicing} key={`word-tools:${JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage.offset, generation.current])}`}
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
      {!practicing && !practiceSurface && (() => { const index = Math.max(0, livePage.verses.findIndex(row => row.ref === picked)), verse = livePage.verses[index];
        return <div className="study-verse-bar" data-testid="study-verse-bar" data-selected-verse={verse.ref}>
          <button type="button" className="button-secondary" aria-haspopup="dialog" onClick={event => openTools(verse.ref, event.currentTarget)}>Verse tools · <bdi dir="ltr">{verse.ref}</bdi></button>
          {!study && <button type="button" className="button-text" onClick={() => open(livePage!, index)}>Practice {verse.ref}</button>}
          {renderMark?.(kind, verse.ref)}
        </div>; })()}
      {practiceSurface && renderLiftControls && <section className="practice-verse-controls" data-testid="practice-verse-controls" aria-label="Selected verse practice">
        <h3 data-testid="practice-selected-verse">{practiceRef!}</h3>
        {renderLiftControls(kind, practiceRef!)}
      </section>}
      {toolsVerse && <Sheet open onClose={() => void closeTools()} title={`Verse tools · ${toolsVerse.ref}`} closeLabel="Close" returnFocusTo={() => toolsOpener.current}>
        <div className="study-verse-detail" data-testid="study-verse-detail" data-verse-ref={toolsVerse.ref}>
          {renderMark && <div className="verse-card-head">{renderMark(kind, toolsVerse.ref)}</div>}
          {practicing && <div className="study-verse-actions" data-testid="study-verse-actions">
            <button type="button" className="button-secondary" onClick={() => { const index = livePage!.verses.indexOf(toolsVerse); void closeTools().then(closed => closed && requestAnimationFrame(() => requestAnimationFrame(() => open(livePage!, index)))); }}>Practice {toolsVerse.ref}</button>
            {listeningEnabled && <button type="button" className="button-secondary" onClick={() => hear(livePage!, livePage!.verses.indexOf(toolsVerse))}>Hear verse</button>}
          </div>}
          {!songSession && !study && <p className="study-english" data-testid="detail-english" lang="en" dir="ltr">{toolsVerse.english ?? "English reference unavailable for this verse."}</p>}
          <Apparatus verse={toolsVerse} learner={learner} />{!study && renderGuide?.(kind, toolsVerse.ref)}
          {!study && <VerseRashi verse={toolsVerse} state={rashi.lookup.forVerse(toolsVerse.ref)} link={leinLink} retry={rashi.retry} />}
          <SourcesPanel key={`sources:${JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage!.offset, generation.current, toolsVerse.ref])}`}
            scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, livePage!.offset, generation.current, toolsVerse.ref])} baseline={baseline} kind={kind} offset={livePage!.offset + livePage.verses.indexOf(toolsVerse)} onRefreshReading={reloadMetadata} />
          {renderWork?.(kind, toolsVerse.ref)}
        </div>
      </Sheet>}
      {!learner && kind==="torah" && assignment!.aliyahStarts===null && <p className="field-help" data-testid="aliyah-unrecorded">Aliyah boundaries have not been recorded for this assignment.</p>}
      {learner ? !single && <p className="study-page-position">Verses {livePage.offset + 1}–{livePage.offset + livePage.verses.length} of {livePage.totalVerses}</p>
        : <p role="status">Verses {livePage.offset + 1}–{livePage.offset + livePage.verses.length} of {livePage.totalVerses}. {livePage.translation.status === "partial" ? "The selected English edition is missing for some verses." : livePage.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>}
      {!learner && <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>}
      {!single && <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={livePage.nextOffset === null} onClick={() => livePage?.nextOffset !== null && void explicitLoad(kind, livePage!.nextOffset!)}>Next text page</button></nav>}
      {study && <CommentaryCredits works={works} refs={commentaryRefs} />}
      <div className="study-more"><StudyCredits chapters={livePage.chapters} summary={learner ? "About this text" : undefined} />{learner && !practicing && <WorkspaceLink href="/trope-chart">Trope chart</WorkspaceLink>}{learner && onPrint && <button type="button" className="button-text study-print-action" onClick={onPrint}>Print practice sheet</button>}{learner && !practicing && printSheetHref && <WorkspaceLink className="study-print-sheet" href={printSheetHref}>Print the whole reading</WorkspaceLink>}{learner && <div className="reading-lens-foot"><LensSwitch /></div>}</div>
      {lift && textReady && lift.page === livePage && <LiftedLine learner={learner} verses={livePage.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} index={lift.index} total={livePage.totalVerses} offset={livePage.offset}
        reference={audio && listeningEnabled ? { audio, active, expiresAt: baseline.context ? Date.parse(baseline.context.expiresAt) : undefined,
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
