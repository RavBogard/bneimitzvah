"use client";
import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Assigned } from "../api";
import { useWorkspace } from "../provider";
import { useReadingPrefs } from "../reading-prefs";
import { Apparatus, FlowingStudyText } from "./annotations";
import { StudyCredits } from "./credits";
import { explorationBinding, explorationReasons } from "./exploration-api";
import { createExplorationOwner, type ExplorationState } from "./exploration-owner";

/** Text only until proposed reading playback/word authority is implemented. */
export function ExplorationContent({ state, group, retry, page, refresh }: {
  state: ExplorationState; group: string; retry(): void; page(offset: number): void; refresh(): void;
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
        <FlowingStudyText verses={current.verses} assignment={{ kind: "torah", confirmed: false, verses: [] }} group={group} activeWord={null} />
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

export function ProposedTorahText({ baseline, reloadMetadata, authorityFailed, active = true }: {
  baseline: Assigned | null; reloadMetadata(): Promise<Assigned>; authorityFailed(status: number): void; active?: boolean;
}) {
  const { readExploration, readExplorationPage, summary, epoch, concealed, registerWork } = useWorkspace(), group = useId();
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
  if (!permitted || concealed) return null;
  return <ExplorationContent state={state} group={group} retry={() => void owner.load()} page={offset => void owner.load(offset)} refresh={() => void reloadMetadata().catch(() => undefined)} />;
}
