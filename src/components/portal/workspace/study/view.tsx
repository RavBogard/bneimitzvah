"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { type Assigned } from "../api";
import { statusOf, useWorkspace, WorkspaceLink } from "../provider";
import { studyBinding, studyPlan, type StudyKind, type StudyPage } from "./api";
import { StudyCredits } from "./credits";
import { Apparatus, FlowingStudyText } from "./annotations";
import { ReadingPlayer, playMainVerseForWord, type ReadingPlayerHandle } from "./reading-player";
import type { ReadingSelection } from "./main-playback";
import { WordTools, type WordToolsHandle } from "./word-tools";
import { SourcesPanel } from "./sources/panel";
import { LiftedLine } from "./lift";
import type { createReadingAudioCoordinator } from "./reading-audio-coordinator";
import { useReadingPrefs } from "../reading-prefs";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";
import { PortalRequestError } from "../../api";
import { watchReadingAudioDeadline } from "./reading-player-intent";
import type { ShortReferenceOwner } from "./short-reference-bridge";

export type StudyReload = { clear(): void; reload(baseline: Assigned, signal: AbortSignal): Promise<void> };
export function AssignedStudyText({ baseline, register, reloadMetadata, authorityFailed, onKindChange, guardDeparture, serviceHref, renderWork, renderActiveWork, onPage, learner = false, liftHandle, practiceHandle, textStartHandle, songSession = learner, onShown, renderMark, renderLiftControls, onVisit, onHearReady, onPracticeReady, active = true, audio, stopAudio }: {
  baseline: Assigned | null; register(value: StudyReload): () => void; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; onKindChange(kind: StudyKind): void;
  guardDeparture?(): Promise<boolean>; serviceHref?: string; renderWork?(kind: StudyKind, verseRef: string): ReactNode; renderActiveWork?(): ReactNode; onPage?(kind: StudyKind, offset: number, signal: AbortSignal): Promise<void>;
  /** Students and child practice see the reading without status or provenance prose. */
  learner?: boolean; liftHandle?: MutableRefObject<((index: number) => void) | null>;
  practiceHandle?: MutableRefObject<((index: number) => void) | null>;
  textStartHandle?: MutableRefObject<(() => void) | null>;
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
  const shortMetadata = useRef<ShortReferenceOwner | null>(null);
  const playback = useRef<ReadingPlayerHandle | null>(null), registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const tools = useRef<WordToolsHandle | null>(null), registerTools = useCallback((value: WordToolsHandle | null) => { tools.current = value; }, []);
  const [playingWord, setPlayingWord] = useState<{ verse: number; index: number } | null>(null);
  const [lift, setLift] = useState<{ page: StudyPage; index: number; opening: number; navigation: number } | null>(null);
  const modalOwner = useRef<ShortReferenceOwner | null>(null), modalRequest = useRef<AbortController | null>(null), modalSequence = useRef(0);
  const modalScope = useRef(lift); modalScope.current = lift;
  const metadata = useRef<Assigned | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0);
  const selection = useRef<{ kind: StudyKind; offset: number; assignmentKey: string } | null>(null);
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
  async function explicitLoad(kind: StudyKind, offset: number) {
    const value = metadata.current;
    if (!value || studyBinding(value) !== key) return;
    if (guardDeparture && !await guardDeparture()) return;
    if (metadata.current !== value || studyBinding(value) !== key) return;
    try {
      const pending = load(value, kind, offset), request = controller.current, turn = generation.current;
      const loaded = await pending;
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
  useEffect(() => { if (shown) onShown?.(...shown); }, [livePage]); // eslint-disable-line react-hooks/exhaustive-deps
  const hear = (page: StudyPage, index: number, word: ReadingSelection = "verse") => { playback.current?.select(index, word); if (word === "verse") tools.current?.selectVerse(index); else tools.current?.select(index, word); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
  const open = (page: StudyPage, index: number) => { stopAudio?.(); playback.current?.suspend(); shortMetadata.current?.suspend(); modalRequest.current?.abort();
    const old = modalScope.current, next = { page, index, opening: old?.page === page ? old.opening : ++modalSequence.current, navigation: (old?.navigation ?? 0) + 1 };
    modalScope.current = next; setLift(next); if (state.kind) onVisit?.(state.kind, page.verses[index].ref); };
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
    {baseline.readings.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading text selection">{baseline.readings.map(row => <button key={row.kind} className="button-secondary" aria-label={row.kind === "torah" ? "Torah text" : "Haftarah text"} aria-pressed={kind === row.kind} disabled={current?.loading} onClick={() => void explicitLoad(row.kind, 0)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}{serviceHref && <a className="button-secondary service-entry" href={serviceHref}>Service parts</a>}</div>}
    {!current || current.loading ? <p role="status">Loading the assigned text…</p> : current.error ? <div role="status"><h4>{current.error === 409 ? "Assignment changed" : [401, 403, 404].includes(current.error) ? "Text access changed" : "Text unavailable"}</h4>
      <p>{current.error === 409 ? learner ? "Your reading was just updated. Load the new version to keep going." : "Refresh the reading metadata before loading this assignment’s text again." : learner ? "The verses didn’t load. Check your connection and try again." : "No previous text is being shown. Confirmed references and the reading review form remain separate."}</p>
      <button className="button-secondary" onClick={() => { if (current.error === 409) void reloadMetadata().catch(() => undefined); else void explicitLoad(kind, selection.current?.offset ?? 0); }}>{current.error === 409 ? "Refresh reading and text" : "Reload assigned text"}</button>
      {renderActiveWork?.()}
    </div> : current.page && <>
      <FlowingStudyText verses={current.page.verses} assignment={{ kind, confirmed: true, verses: assignment!.verses }} group={aidsGroup} activeWord={playingWord} listening={listeningEnabled} showEnglish={songSession && prefs.translation}
        sections={current.page.verses.flatMap((verse, index) => { const position = aliyahPosition(kind, assignment!.aliyahStarts, assignment!.verses, verse.ref); return position && (position.startsHere || index === 0) ? [{ index, label: `Aliyah ${position.number}${position.startsHere ? " starts here" : " · continued from the previous text page"}` }] : []; })}
        onVerse={listeningEnabled ? index => hear(current.page!, index) : undefined} onWord={(index, word) => { if (listeningEnabled) playMainVerseForWord(playback.current, tools.current, index, word); else tools.current?.select(index, word); onVisit?.(kind, current.page!.verses[index].ref); }} />
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
        }} onHear={listeningEnabled ? (index, word) => hear(current.page!, index, word) : undefined} />}
      <div className="study-verse-details">{current.page.verses.map((verse, index) => <div key={verse.ref} className="study-verse-detail" data-verse-ref={verse.ref}>
        <div className="verse-card-head"><h4>Verse tools · <bdi dir="ltr">{verse.ref}</bdi></h4>{renderMark?.(kind, verse.ref)}<button type="button" className="button-text" onClick={() => open(current.page!, index)}>View {verse.ref} up close</button></div>
        {!songSession && <p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p>}
        <Apparatus verse={verse} learner={learner} />{renderWork?.(kind, verse.ref)}
        {!concealed && <SourcesPanel key={`sources:${JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page!.offset, generation.current, verse.ref])}`}
          scopeKey={JSON.stringify([summary.sessionBinding, epoch, key, kind, current.page!.offset, generation.current, verse.ref])} baseline={baseline} kind={kind} offset={current.page!.offset + index} onRefreshReading={reloadMetadata} />}
      </div>)}</div>
      {!learner && kind==="torah" && assignment!.aliyahStarts===null && <p className="field-help">Aliyah boundaries have not been recorded for this assignment.</p>}
      {learner ? !single && <p className="study-page-position">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}</p>
        : <p role="status">Verses {current.page.offset + 1}–{current.page.offset + current.page.verses.length} of {current.page.totalVerses}. {current.page.translation.status === "partial" ? "The selected English edition is missing for some verses." : current.page.translation.status === "unavailable" ? "The selected English edition is unavailable on this page." : "Selected English edition available."}</p>}
      {!learner && <p className="field-help">Hebrew: Miqra according to the Masorah. English reference: JPS2023. No alternate edition is substituted.</p>}
      {!single && <nav className="study-pages" aria-label="Text pages"><button className="button-secondary" disabled={previous === undefined} onClick={() => previous !== undefined && void explicitLoad(kind, previous)}>Previous text page</button><button className="button-secondary" disabled={current.page.nextOffset === null} onClick={() => current.page?.nextOffset !== null && void explicitLoad(kind, current.page!.nextOffset!)}>Next text page</button></nav>}
      <div className="study-more"><StudyCredits chapters={current.page.chapters} summary={learner ? "About this text" : undefined} />{learner && <WorkspaceLink href="/trope-chart">Trope chart</WorkspaceLink>}</div>
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
