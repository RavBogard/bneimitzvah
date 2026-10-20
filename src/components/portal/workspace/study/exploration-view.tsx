"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";
import type { Assigned } from "../api";
import { useWorkspace } from "../provider";
import { useReadingPrefs } from "../reading-prefs";
import { Apparatus, FlowingStudyText } from "./annotations";
import { StudyCredits } from "./credits";
import { explorationBinding, explorationReasons } from "./exploration-api";
import { createExplorationOwner, type ExplorationState } from "./exploration-owner";
import { ReadingPlayer, type ReadingPlayerHandle } from "./reading-player";
import type { createReadingAudioCoordinator } from "./reading-audio-coordinator";
import type { ShortExplorationOwner } from "./short-exploration-owner";
import { PortalRequestError } from "../../api";
import { readingAudioDeadline, watchReadingAudioDeadline } from "./reading-player-intent";

/** Proposed audio never grants assigned word/work/calendar authority. */
export function ExplorationContent({ state, group, retry, page, refresh, audio }: {
  state: ExplorationState; group: string; retry(): void; page(offset: number): void; refresh(): void;
  audio?: { activeWord: { verse: number; index: number } | null; onWord(verse: number, word: number): void; onVerse(verse: number): void; player: ReactNode };
}) {
  const prefs = useReadingPrefs(), prepared = state.result?.status === "prepared" ? state.result : undefined;
  const current = state.page, unresolved = state.result?.status === "unresolved" ? state.result : undefined;
  const offsetIndex = prepared && current ? prepared.pages.findIndex(row => row.offset === current.offset) : -1;
  const previous = prepared?.pages[offsetIndex - 1]?.offset;
  return <section className="assigned-study" aria-label="Proposed Torah portion" data-size={prefs.size} aria-busy={state.pending}>
    <header><h3>{prepared?.portion ?? "Explore the Torah portion"}</h3>
      <p className="field-help">Read the full portion while you and your tutor choose your verses. This is not an assigned reading yet.</p>
      {prepared && <p className="reading-reference">{prepared.ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2")}</p>}</header>
    {state.error ? <div role="status"><p>{state.error === 409 ? "The reading changed. Refresh it to continue." : [401, 403, 404].includes(state.error) ? "This reading is no longer available in the selected role." : "The Torah portion couldn’t be loaded. Try again in a moment."}</p>
      <button className="button-secondary" onClick={state.error === 409 ? refresh : retry}>{state.error === 409 ? "Refresh reading" : "Try again"}</button></div>
      : unresolved ? <div role="status"><p>{explorationReasons[unresolved.reason]}</p><button className="button-secondary" onClick={retry}>Try again</button></div>
      : !current || !prepared ? <p role="status">Loading the Torah portion…</p> : <>
        <FlowingStudyText verses={current.verses} assignment={{ kind: "torah", confirmed: false, verses: [] }} group={group} toolsAvailable={false} activeWord={audio?.activeWord ?? null} onWord={audio?.onWord} onVerse={audio?.onVerse} />
        {audio?.player}
        <div className="study-verse-details">{current.verses.map(verse => <div key={verse.ref} className="study-verse-detail" data-verse-ref={verse.ref}>
          {prefs.translation && <><h4><bdi dir="ltr">{verse.ref}</bdi></h4><p className="study-english" lang="en" dir="ltr">{verse.english ?? "English reference unavailable for this verse."}</p></>}
          <Apparatus verse={verse} learner />
        </div>)}</div>
        <p className="study-page-position">Verses {current.offset + 1}–{current.offset + current.verses.length} of {current.totalVerses}</p>
        {prepared.pages.length > 1 && <nav className="study-pages" aria-label="Proposed Torah text pages">
          <button className="button-secondary" disabled={state.pending || previous === undefined} onClick={() => previous !== undefined && page(previous)}>Previous text page</button>
          <button className="button-secondary" disabled={state.pending || current.nextOffset === null} onClick={() => current.nextOffset !== null && page(current.nextOffset)}>Next text page</button>
        </nav>}
        {state.pending && <p role="status">Loading the next text page…</p>}
        <div className="study-more"><StudyCredits chapters={current.chapters} summary="About this text" /></div>
      </>}
  </section>;
}

export function ProposedTorahText({ baseline, reloadMetadata, authorityFailed, active = true, audio, hearHandle, onHearReady, onReadingReady }: {
  baseline: Assigned | null; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; active?: boolean;
  audio?: ReturnType<typeof createReadingAudioCoordinator>; hearHandle?: MutableRefObject<((index: number) => void) | null>; onHearReady?(value: boolean): void; onReadingReady?(value: boolean): void;
}) {
  const { readExploration, readExplorationPage, createShortExplorationOwner, summary, epoch, concealed, registerWork } = useWorkspace(), group = useId();
  const listeningEnabled = baseline?.referenceListeningEnabled === true;
  const environment = useRef({ readExploration, readExplorationPage, authorityFailed });
  environment.current = { readExploration, readExplorationPage, authorityFailed };
  const stored = useRef<ReturnType<typeof createExplorationOwner> | null>(null);
  if (!stored.current) stored.current = createExplorationOwner({
    prepare: (value, signal) => environment.current.readExploration(value, signal),
    page: (value, prepared, offset, signal) => environment.current.readExplorationPage(value, prepared, offset, signal),
    denied: status => { if ([401, 403, 404].includes(status)) environment.current.authorityFailed(status); },
  });
  const owner = stored.current, state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const key = baseline ? explorationBinding(baseline) : "", scope = JSON.stringify([summary.sessionBinding, epoch, key]);
  const permitted = baseline !== null && baseline.mode !== "parent" && !baseline.readings.some(row => row.kind === "torah");
  useLayoutEffect(() => {
    if (concealed || !permitted) { owner.clear(); return; }
    const changed = owner.configure(baseline, scope);
    if (active && (changed || !owner.snapshot().page && !owner.snapshot().result && !owner.snapshot().pending && !owner.snapshot().error)) void owner.load();
    if (!active) owner.pause();
  }, [owner, scope, concealed, permitted, active, baseline]);
  useLayoutEffect(() => { const unregister = registerWork({ clear: owner.clear, pause: owner.pause, settle: async () => {}, hasUnsaved: () => false, reveal: () => {} });
    return () => { unregister(); owner.clear(); };
  }, [registerWork, owner]);
  useEffect(() => {
    const resume = () => { const current = owner.snapshot();
      if (document.visibilityState === "visible" && permitted && !concealed && active && !current.page && !current.result && !current.error && !current.pending) void owner.load();
    };
    document.addEventListener("visibilitychange", resume); return () => document.removeEventListener("visibilitychange", resume);
  }, [owner, permitted, concealed, active]);
  const prepared = state.result?.status === "prepared" ? state.result : undefined, currentPage = state.page;
  const shortMetadata = useRef<ShortExplorationOwner | null>(null), playback = useRef<ReadingPlayerHandle | null>(null);
  const registerPlayback = useCallback((value: ReadingPlayerHandle | null) => { playback.current = value; }, []);
  const [activeWord, setActiveWord] = useState<{ verse: number; index: number } | null>(null), [expiredClaim, setExpiredClaim] = useState<string | null>(null);
  const view = useRef({ baseline, prepared, page: currentPage, scope, permitted, pending: state.pending, error: state.error, active, concealed });
  view.current = { baseline, prepared, page: currentPage, scope, permitted, pending: state.pending, error: state.error, active, concealed };
  useLayoutEffect(() => {
    if (!permitted || !baseline || !prepared || !currentPage || !listeningEnabled) return;
    const value = baseline, claim = prepared, page = currentPage, capturedScope = scope;
    const live = () => { const now = view.current; return now.baseline === value && now.prepared === claim && now.page === page && now.scope === capturedScope
      && now.permitted && !now.pending && !now.error && now.active && !now.concealed && document.visibilityState === "visible" && claim.expiresAt > Date.now(); };
    let owned: ShortExplorationOwner;
    try { owned = createShortExplorationOwner(value, claim, page, live); } catch { return; }
    shortMetadata.current = owned;
    if (live()) void owned.prepare().catch(() => undefined);
    return () => { owned.dispose(); if (shortMetadata.current === owned) shortMetadata.current = null; };
  }, [baseline, prepared, currentPage, scope, permitted, createShortExplorationOwner, listeningEnabled]);
  useLayoutEffect(() => {
    if (concealed || !active || state.pending || state.error || !permitted) { playback.current?.suspend(); shortMetadata.current?.suspend(); }
  }, [concealed, active, state.pending, state.error, permitted]);
  const deadline = prepared ? readingAudioDeadline(prepared.expiresAt, baseline?.context?.expiresAt) : NaN;
  useLayoutEffect(() => {
    if (!prepared) return;
    return watchReadingAudioDeadline(deadline,
      () => view.current.prepared === prepared && view.current.scope === scope && view.current.baseline === baseline,
      () => { playback.current?.suspend(); shortMetadata.current?.suspend(); setExpiredClaim(prepared.binding); });
  }, [prepared, deadline, scope, baseline]);
  useEffect(() => {
    const leave = () => { playback.current?.suspend(); shortMetadata.current?.suspend(); }, hidden = () => { if (document.visibilityState !== "visible") leave(); };
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", leave);
    return () => { leave(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", leave); };
  }, []);
  const expired = Boolean(prepared && (expiredClaim === prepared.binding || !Number.isFinite(deadline) || deadline <= Date.now()));
  const textReady = Boolean(permitted && prepared && currentPage && !concealed && !state.pending && !state.error && !expired);
  const available = Boolean(audio && textReady && listeningEnabled);
  useLayoutEffect(() => { onHearReady?.(available); return () => onHearReady?.(false); }, [available, onHearReady]);
  useLayoutEffect(() => { onReadingReady?.(textReady); return () => onReadingReady?.(false); }, [textReady, onReadingReady]);
  useLayoutEffect(() => {
    if (!hearHandle) return;
    const hear = (index: number) => { if (available) playback.current?.select(index, "verse"); };
    hearHandle.current = hear; return () => { if (hearHandle.current === hear) hearHandle.current = null; };
  }, [hearHandle, available, currentPage]);
  if (!permitted || concealed) return null;
  const reloadPage = (offset?: number) => { playback.current?.suspend(); shortMetadata.current?.suspend(); void owner.load(offset); };
  const hearing = audio && prepared && currentPage && listeningEnabled ? {
    activeWord, onWord: (index: number) => playback.current?.select(index, "verse"), onVerse: (index: number) => playback.current?.select(index, "verse"),
    player: <><ReadingPlayer scopeKey={JSON.stringify([scope, prepared.binding, currentPage.offset])} verses={currentPage.verses} active={active} enabled={available} expiresAt={deadline} wordTools={false}
      audio={{ coordinator: audio, slot: "proposed" }} register={registerPlayback} onActiveWord={setActiveWord} load={async (index, signal) => {
        const now = view.current, owned = shortMetadata.current;
        if (signal.aborted || !owned || now.prepared !== prepared || now.page !== currentPage || !currentPage.verses[index] || now.scope !== scope || now.pending || now.error) throw new PortalRequestError(409);
        const result = await owned.load(index, signal);
        if (signal.aborted || view.current.prepared !== prepared || view.current.page !== currentPage || view.current.scope !== scope) throw new PortalRequestError(409);
        return result;
      }} />{expired && <p role="status">This proposed reading expired. <button type="button" className="button-text" onClick={() => reloadPage()}>Refresh the Torah portion</button></p>}</>,
  } : undefined;
  return <ExplorationContent audio={hearing} state={state} group={group} retry={() => reloadPage()} page={offset => reloadPage(offset)} refresh={() => { playback.current?.suspend(); shortMetadata.current?.suspend(); void reloadMetadata().catch(() => undefined); }} />;
}
