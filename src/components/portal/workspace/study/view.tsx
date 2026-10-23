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
import { CommentaryCredits, CommentaryStatus, linkedVerse, useCommentLink, useWorkCommentary, VerseRashi } from "./commentary-view";
import { COMMENTARY_WORKS } from "../../../../lib/readings/commentary";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";
import { PortalRequestError } from "../../api";
import { watchReadingAudioDeadline } from "./reading-player-intent";
import type { ShortReferenceOwner } from "./short-reference-bridge";

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
/** Aliyah labels above the verse where an aliyah starts (or continues from the previous text page), in either lens. */
function aliyahSections(kind: StudyKind, assignment: Assigned["readings"][number], verses: readonly StudyVerse[]) {
  return verses.flatMap((verse, index) => { const position = aliyahPosition(kind, assignment.aliyahStarts, assignment.verses, verse.ref);
    return position && (position.startsHere || index === 0) ? [{ index, label: `Aliyah ${position.number}${position.startsHere ? " starts here" : " · continued from the previous text page"}` }] : []; });
}
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange, guardDeparture, serviceHref, renderGuide, renderWork, renderActiveWork, onPage, onPrint, learner = false, liftHandle, practiceHandle, textStartHandle, verseLookupHandle, songSession = learner, onShown, renderMark, renderLiftControls, onVisit, onHearReady, onPracticeReady, active = true, audio, stopAudio }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
  guardDeparture?(): Promise<boolean>; serviceHref?: string; renderGuide?(kind: StudyKind, verseRef: string): ReactNode; renderWork?(kind: StudyKind, verseRef: string): ReactNode; renderActiveWork?(): ReactNode; onPage?(kind: StudyKind, offset: number, signal: AbortSignal): Promise<void>;
  /** Opens the printable practice sheet; learners on phones reach it here rather than in the hero. */
  onPrint?(): void;
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
  audio?: ReturnType<typeof createReadingAudioCoordinator>; stopAudio?(): void;
}) {
  const { readStudy, createShortReferenceOwner, readWordAids, readWordDetails, summary, concealed, epoch } = useWorkspace(), aidsGroup = useId(), prefs = useReadingPrefs();
  const lens = useStudyLens(), study = lens.lens === "study", leinLink = useCommentLink();
  const shortMetadata = useRef<ShortReferenceOwner | null>(null);
  const playback = useRef<ReadingPlayerHandle | null>(null), registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const tools = useRef<WordToolsHandle | null>(null), registerTools = useCallback((value: WordToolsHandle | null) => { tools.current = value; }, []);
  const [playingWord, setPlayingWord] = useState<{ verse: number; index: number } | null>(null);
  const [lift, setLift] = useState<{ page: StudyPage; index: number; opening: number; navigation: number } | null>(null);
  const modalOwner = useRef<ShortReferenceOwner | null>(null), modalRequest = useRef<AbortController | null>(null), modalSequence = useRef(0);
  const modalScope = useRef(lift); modalScope.current = lift;
  const metadata = useRef<Assigned | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const selection = useRef<{ kind: StudyKind; offset: number; assignmentKey: string } | null>(null);
  // A word place chosen on another text page; bound to the load turn that shows it.
  const pendingPlace = useRef<{ kind: StudyKind; offset: number; turn: number; ref: string; wordIndex: number } | null>(null);
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
  const livePage = key && state.binding === key && !state.loading ? state.page : undefined;
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
  const rashi = useWorkCommentary("rashi", commentaryRefs, commentaryRefs.length > 0 && (!study || lens.works.includes("rashi")));
  const womens = useWorkCommentary("womens", commentaryRefs, commentaryRefs.length > 0 && study && state.kind === "torah" && lens.works.includes("womens"));
  const works = useMemo(() => [rashi, womens].filter(row => lens.works.includes(row.work)), [rashi, womens, lens.works]);
  const clearLink = leinLink.clear;
  useEffect(() => { clearLink(); }, [livePage, study, clearLink]);
  useEffect(() => { if (shown) onShown?.(...shown); }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  const hear = (page: StudyPage, index: number, word: ReadingSelection = "verse") => { playback.current?.select(index, word); if (word === "verse") tools.current?.selectVerse(index); else tools.current?.select(index, word); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  const open = (page: StudyPage, index: number) => { stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.suspend(); modalRequest.current?.abort();
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
  const offsets = [0]; if (assignment && current?.page) { let next: number | null = 0; while (next !== null) { const page = studyPlan(baseline, kind, next); next = page.nextOffset; if (next !== null) offsets.push(next); } }
  const previous = current?.page ? offsets[offsets.indexOf(current.page.offset) - 1] : undefined;
  const single = current?.page ? previous === undefined && current.page.nextOffset === null : false;
  return <section className="assigned-study" aria-label="Assigned text" data-size={prefs.size}>
    {/* On a learner's phone the switch waits under the passage, so the first verse stays above the fold. */}
    {(baseline.readings.length > 1 || lens.available) && <div className="reading-lens-row" data-learner={learner ? "" : undefined}>
      {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-label={row.kind === "torah" ? "Torah text" : "Haftarah text"} aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}{serviceHref && <a className="button-secondary service-entry" href={serviceHref}>Service parts</a>}</div>}
      <LensSwitch />
    </div>}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status"><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? learner ? "Your reading was just updated. Load the new version to keep going." : "Refresh the reading metadata before loading this assignment’s text again." : learner ? "The verses didn’t load. Check your connection and try again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
      {renderActiveWork?.()}
    </div> : current.page && <>
      {study ? <>
        <CommentaryStatus works={works.map(row => ({ work: row.work, status: row.status, retry: row.retry, covers: Boolean(COMMENTARY_WORKS[row.work]?.editions[corpus]) }))} />
        <StudyRows verses={current.page.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={lens.english}
          sections={aliyahSections(kind, assignment!, current.page.verses)} works={ref => works.map(row => ({ work: row.work, state: row.lookup.forVerse(ref) }))}
          onVerse={listeningEnabled ? index => hear(current.page!, index) : undefined} onWord={(index, word) => { if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else tools.current?.select(index, word); onVisit?.(kind, current.page!.verses[index].ref); }} />
      </> : <FlowingStudyText verses={current.page.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={songSession && prefs.translation} tikkun={kind === "torah" ? prefs.tikkunView : "off"}
        sections={aliyahSections(kind, assignment!, current.page.verses)} linked={linkedVerse(leinLink, current.page.verses)}
        onVerse={listeningEnabled ? index => hear(current.page!, index) : undefined} onWord={(index, word) => { if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else tools.current?.select(index, word); onVisit?.(kind, current.page!.verses[index].ref); }} />}
      {!concealed && listeningEnabled && <ReadingPlayer key={JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page.offset, generation.current])}
        scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page.offset, generation.current])} verses={current.page.verses} active={active && !lift} enabled={!concealed && !lift} expiresAt={baseline?.context ? Date.parse(baseline.context.expiresAt) : undefined} audio={audio ? { coordinator: audio, slot: "assigned" } : undefined}
        register={registerPlayback} onActiveWord={setPlayingWord} load={async (index, signal) => {
          const value = baseline, page = current.page!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const owned = shortMetadata.current; if (!owned) throw new PortalRequestError(409);
          const result = await owned.load(index, signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} />}
      {!concealed && active && <WordTools key={`word-tools:${JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page.offset, generation.current])}`}
        scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page.offset, generation.current])} verses={current.page.verses} register={registerTools}
        readAids={async (index, signal) => {
          const value = baseline, page = current.page!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const result = await readWordAids(value, kind, page.offset + index, page.verses[index], signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} readDetails={async (index, word, signal) => {
          const value = baseline, page = current.page!, turn = generation.current;
          if (signal.aborted || metadata.current !== value || page !== livePage || !page.verses[index]) throw new PortalRequestError(409);
          const result = await readWordDetails(value, kind, page.offset + index, page.verses[index], word, signal);
          if (signal.aborted || turn !== generation.current || metadata.current !== value) throw new PortalRequestError(409);
          return result;
        }} onHear={listeningEnabled ? (index, word) => hear(current.page!, index, word) : undefined}
        onPlace={(ref, wordIndex) => {
          const page = current.page!, here = page.verses.findIndex(row => row.ref === ref), position = assignment!.verses.indexOf(ref);
          if (position < 0) return;
          if (here >= 0) { tools.current?.select(here, wordIndex); onVisit?.(kind, ref); return; }
          const target = offsets.filter(offset => offset <= position).at(-1);
          if (target !== undefined && target !== page.offset) void explicitLoad(kind, target, { ref, wordIndex });
        }}
        takePlace={() => { const place = pendingPlace.current, page = current.page!; pendingPlace.current = null;
          return place && place.kind === kind && place.offset === page.offset && place.turn === generation.current ? { ref: place.ref, wordIndex: place.wordIndex } : null; }} />}
      <div className="study-verse-details">{current.page.verses.map((verse, index) => <div key={verse.ref} className="study-verse-detail" data-verse-ref={verse.ref}>
        <div className="verse-card-head"><h4>Verse tools · <bdi dir="ltr">{verse.ref}</bdi></h4>{renderMark?.(kind, verse.ref)}<button type="button" className="button-text" onClick={() => open(current.page!, index)}>View {verse.ref} up close</button></div>
        {!songSession && !study && <p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>}
        <Apparatus verse={verse} learner={learner} />{renderGuide?.(kind, verse.ref)}
        {!study && <VerseRashi verse={verse} state={rashi.lookup.forVerse(verse.ref)} link={leinLink} retry={rashi.retry} />}
        {!concealed && <SourcesPanel key={`sources:${JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page!.offset, generation.current, verse.ref])}`}
          scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page!.offset, generation.current, verse.ref])} baseline={baseline} kind={kind} offset={current.page!.offset + index} onRefreshReading={reloadMetadata} />}
        {renderWork?.(kind, verse.ref)}
      </div>)}</div>
      {!learner && kind==="torah" && assignment!.aliyahStarts===null && <p className="field-help">Aliyah boundaries have not been recorded for this assignment.</p>}
      {learner ? !single && <p className="study-page-position">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}</p>
        : <p role="status">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}. {current.page.translation.status === "partial" ? "The selected English edition is missing for some verses." : current.page.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>}
      {!learner && <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>}
      {!single && <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={current.page.nextOffset === null} onClick={() => current.page?.nextOffset !== null && void explicitLoad(kind, current.page!.nextOffset!)}>Next text page</button></nav>}
      {study && <CommentaryCredits works={works} refs={commentaryRefs} />}
      <div className="study-more"><StudyCredits chapters={current.page.chapters} summary={learner ? "About this text" : undefined} />{learner && <WorkspaceLink href="/trope-chart">Trope chart</WorkspaceLink>}{learner && onPrint && <button type="button" className="button-text study-print-action" onClick={onPrint}>Print practice sheet</button>}{learner && <div className="reading-lens-foot"><LensSwitch /></div>}</div>
      {lift && textReady && lift.page === current.page && <LiftedLine learner={learner} verses={current.page.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} index={lift.index} total={current.page.totalVerses} offset={current.page.offset}
        reference={audio && listeningEnabled ? { audio, active: active && !concealed, expiresAt: baseline.context ? Date.parse(baseline.context.expiresAt) : undefined,
          navigation: lift.navigation, scopeKey: JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page.offset, generation.current, lift.opening]),
          load: async (index, signal) => {
            const owner = modalOwner.current, selected = modalScope.current, turn = generation.current;
            if (!owner || !selected || index !== selected.index || selected.page !== current.page || signal.aborted) throw new PortalRequestError(409);
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
