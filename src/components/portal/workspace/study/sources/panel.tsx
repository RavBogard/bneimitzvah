"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Assigned } from "../../api";
import { useWorkspace } from "../../provider";
import type { StudyKind } from "../api";
import type { SourceAssignmentClient, SourceCitation } from "./api";
import { createSourceSelection, type SourceDeparture, type SourceSelectionState } from "./selection";
import { SourceDepartureReview } from "./departure-review";
import styles from "./panel.module.css";

/** Small navigation adapter; abandoning a request never claims cancellation or rollback. */
export function createSourcePanelLifetime(input: { scopeKey: string; api: SourceAssignmentClient; onState(state: SourceSelectionState): void; onReview(review: SourceDeparture | null): void }) {
  let alive = true, pending: { promise: Promise<boolean>; resolve(value: boolean): void } | undefined;
  const create = () => createSourceSelection({ scopeKey: input.scopeKey, canEdit: input.api.canEdit, api: input.api, onState: state => { if (alive) input.onState(state); } });
  let owner = create();
  function dismiss(value: boolean) { const current = pending; pending = undefined; if (alive) input.onReview(null); current?.resolve(value); }
  const clear = () => { owner.dispose(); dismiss(false); };
  return Object.freeze({
    get owner() { return owner; },
    guard() {
      if (!alive) return Promise.resolve(false);
      if (pending) return pending.promise;
      const review = owner.departure(); if (review.kind === "none") return Promise.resolve(true);
      let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); pending = { promise, resolve }; input.onReview(review); return promise;
    },
    keep() { dismiss(false); }, leave() { if (!pending) return; owner.abandon(); dismiss(true); },
    reset() { if (!alive || owner.departure().kind !== "none") return false; owner.dispose(); owner = create(); input.onState(owner.state); return true; },
    pause: clear, clear, settle: () => Promise.resolve(), hasUnsaved: () => owner.departure().kind !== "none", reveal() {},
    dispose() { alive = false; owner.dispose(); dismiss(false); }
  });
}
export type SourcePanelLifetime = ReturnType<typeof createSourcePanelLifetime>;

/** Guard the captured reading action, never a replacement panel's metadata. */
export async function refreshSourceReading(lifetime: { current: SourcePanelLifetime | null }, guard: () => Promise<boolean>, refresh: () => Promise<unknown>) {
  const session = lifetime.current;
  if (!session || !await guard() || lifetime.current !== session) return false;
  try { await refresh(); return true; } catch { return false; }
}

function Citation({ value }: { value: SourceCitation }) {
  return <span className={styles.citation}><span className={styles.title}>{value.labels.en ?? value.indexTitle}{value.labels.he && <bdi lang="he" dir="rtl">{value.labels.he}</bdi>}</span><bdi className={styles.ref} dir="auto">{value.ref}</bdi><span className={styles.category}>{value.category}</span></span>;
}
export function SourcesPanel({ scopeKey, baseline, kind, offset, onRefreshReading }: { scopeKey: string; baseline: Assigned; kind: StudyKind; offset: number; onRefreshReading(): Promise<unknown> }) {
  const { createSources, registerDeparture, registerWork, guardDeparture } = useWorkspace(), id = useId();
  const lifetime = useRef<SourcePanelLifetime | null>(null), labels = useRef(new Map<string, SourceCitation>()), catalog = useRef<string | null>(null);
  const [state, setState] = useState<SourceSelectionState | null>(null), [review, setReview] = useState<SourceDeparture | null>(null), [unavailable, setUnavailable] = useState(false);
  useLayoutEffect(() => {
    let active = true; labels.current.clear(); catalog.current = null; setState(null); setReview(null); setUnavailable(false);
    let api: SourceAssignmentClient;
    try { api = createSources(baseline, kind, offset); } catch { setUnavailable(true); return; }
    const current = createSourcePanelLifetime({ scopeKey, api, onReview: value => { if (active) setReview(value); }, onState: value => {
      if (!active) return;
      if (value.page && value.page.catalogHash !== catalog.current) { labels.current.clear(); catalog.current = value.page.catalogHash; }
      for (const entry of value.page?.entries ?? []) labels.current.set(entry.id, entry);
      for (const entry of value.current?.citations ?? []) labels.current.set(entry.id, entry);
      if (value.phase === "disposed") { labels.current.clear(); catalog.current = null; }
      setState(value);
    } });
    lifetime.current = current; setState(current.owner.state);
    const removeDeparture = registerDeparture(current.guard), removeWork = registerWork(current);
    return () => { active = false; current.dispose(); removeDeparture(); removeWork(); if (lifetime.current === current) lifetime.current = null; labels.current.clear(); };
    // baseline is captured by the owner identified by the complete parent scope key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, createSources, registerDeparture, registerWork]);
  const current = state?.scopeKey === scopeKey ? state : null, open = current?.open ?? false;
  const needsDeparture = Boolean(current?.dirty || current?.pending);
  useEffect(() => {
    if (!needsDeparture) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [needsDeparture]);
  async function toggle() {
    const session = lifetime.current; if (!session) return;
    if (session.owner.state.open) { if (!await session.guard() || lifetime.current !== session) return; if (session.owner.state.phase === "disposed") session.reset(); else session.owner.close(); }
    else { if (session.owner.state.phase === "disposed") session.reset(); await session.owner.open(); }
  }
  async function latest() {
    const session = lifetime.current; if (!session || !await session.guard() || lifetime.current !== session) return;
    if (session.owner.state.phase === "disposed") session.reset();
    await session.owner.discardAndReload();
  }
  const staff = baseline.mode === "admin" || baseline.mode === "tutor", editing = staff && current?.phase === "ready" && !current.pending;
  const selected = new Set(current?.draftIds ?? []), assigned = current?.current?.citations ?? [], additions = current?.draftIds.filter(value => !assigned.some(entry => entry.id === value)) ?? [];
  const unknown = current?.phase === "unknown" || current?.phase === "checking", busy = current?.phase === "saving" || current?.phase === "checking";
  const checkbox = (entry: SourceCitation) => <label className={styles.choice}><input type="checkbox" checked={selected.has(entry.id)} disabled={!editing || !selected.has(entry.id) && selected.size >= 32} onChange={event => lifetime.current?.owner.select(entry.id, event.target.checked)} /><Citation value={entry} /></label>;
  return <section className={styles.sources} aria-label={`Sources for ${baseline.readings.find(row => row.kind === kind)?.verses[offset] ?? "this verse"}`}>
    <button type="button" className={styles.disclosure} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => void toggle()}>Sources</button>
    {unavailable && <p role="status">Sources aren’t available for this reading.</p>}
    {open && current && <div id={`${id}-body`} className={styles.panel}>
      <h5>Assigned sources</h5>
      {current.phase === "loading" && <p role="status">Loading sources…</p>}
      {current.current && <>{assigned.length ? <ul className={styles.list} aria-label="Assigned sources">{assigned.map(entry => <li key={entry.id}>{staff ? checkbox(entry) : <Citation value={entry} />}</li>)}</ul> : <p>No sources have been assigned to this verse.</p>}
        {staff && additions.length > 0 && <><h5>New choices</h5><ul className={styles.list} aria-label="New source choices">{additions.map(value => <li key={value}>{labels.current.get(value) ? checkbox(labels.current.get(value)!) : <span>Selected source awaiting review</span>}</li>)}</ul></>}
      </>}
      {current.phase === "unavailable" && <p role="status">The assigned sources couldn’t be loaded. <button type="button" className={styles.link} onClick={() => void latest()}>Try sources again</button></p>}
      {current.phase === "refresh-required" && <p role="status">Your save was confirmed, and the assigned sources have changed again. <button type="button" className={styles.link} onClick={() => void latest()}>Load latest assigned sources</button></p>}
      {current.phase === "conflict" && <p role="status">{current.error === "stale-revision" ? "The reading changed. Review the reading before choosing sources." : "The source choices couldn’t be saved. Review the latest assigned sources before continuing."} <button type="button" className={styles.link} onClick={() => current.error === "stale-revision" ? void refreshSourceReading(lifetime, guardDeparture, onRefreshReading) : void latest()}>{current.error === "stale-revision" ? "Refresh reading" : "Review latest assigned sources"}</button></p>}
      {(unknown || current.phase === "saving") && <div className={styles.notice} role="status"><p>{current.phase === "saving" ? "Saving sources…" : current.phase === "checking" ? "Checking the save…" : "Save not confirmed. It may still complete. Check this save before making another change."}</p>
        {current.phase === "unknown" && <div className={styles.actions}><button type="button" onClick={() => void lifetime.current?.owner.reconcile()}>Check save</button><button type="button" onClick={() => void lifetime.current?.owner.retryExact()}>Retry same save</button></div>}
        <p className={styles.note}>Closing or reloading this tab can’t confirm the save.</p>
      </div>}
      {staff && current.current && <div className={styles.actions}><span>{selected.size} of 32 sources selected</span><button type="button" className={styles.save} disabled={!editing || !current.dirty || current.browsing} onClick={() => void lifetime.current?.owner.save()}>Save sources</button>{current.dirty && !current.pending && !busy && <button type="button" onClick={() => void latest()}>Discard choices</button>}</div>}
      {current.lastCommit && current.phase === "ready" && !current.dirty && <p role="status">Sources saved.</p>}
      {current.current && <div className={styles.browse}><button type="button" disabled={busy || Boolean(current.pending) || current.browsing || current.catalogChanged} onClick={() => void lifetime.current?.owner.browse()}>{current.browsing ? "Loading related sources…" : "Browse related sources"}</button>
        {current.catalogChanged && <p role="status">The related sources changed. Review the list before adding new choices. <button type="button" className={styles.link} onClick={() => { const owner = lifetime.current?.owner; if (owner?.reviewCatalog()) void owner.browse(); }}>Review related sources</button></p>}
        {current.error === "unavailable" && current.phase === "ready" && <p role="status">Related sources couldn’t be loaded. The assigned sources are still available.</p>}
        {current.page && <><h5>Related sources</h5>{current.page.entries.length ? <ul className={styles.list} aria-label="Related sources">{current.page.entries.map(entry => <li key={entry.id}>{staff ? checkbox(entry) : <Citation value={entry} />}</li>)}</ul> : <p>No related sources are listed for this verse.</p>}
          <div className={styles.actions}><span>{current.page.sourceOffset + (current.page.entries.length ? 1 : 0)}–{current.page.sourceOffset + current.page.entries.length} of {current.page.totalEntries}</span><button type="button" disabled={current.page.nextSourceOffset === null || current.browsing || busy || Boolean(current.pending) || current.catalogChanged} onClick={() => void lifetime.current?.owner.nextPage()}>Next sources</button></div>
          <p className={styles.credit}>Related-source listings from <a href="https://www.sefaria.org/" target="_blank" rel="noreferrer">Sefaria</a>. Source text isn’t shown here.</p>
        </>}
      </div>}
    </div>}
    <SourceDepartureReview review={review} onKeep={() => lifetime.current?.keep()} onLeave={() => lifetime.current?.leave()} />
  </section>;
}
