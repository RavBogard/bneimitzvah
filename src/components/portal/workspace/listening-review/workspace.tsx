"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AdminNav } from "../admin-nav";
import { RequireRole, statusOf, useWorkspace } from "../provider";
import { PortalRequestError } from "../../api";
import { FlowingStudyText } from "../study/annotations";
import { ReadingPlayer, playMainVerseForWord, type ReadingPlayerHandle } from "../study/reading-player";
import { createReadingAudioCoordinator } from "../study/reading-audio-coordinator";
import type { ReadingPlaybackState } from "../study/main-playback";
import { LISTENING_NOTE_LIMIT, LISTENING_REASONS, LISTENING_REASON_LABELS, LISTENING_SET_LABELS, LISTENING_SOURCES, LISTENING_SOURCE_LABELS, listeningNote, type ListeningReason } from "../../../../lib/listening-review/sample";
import { listeningApi, type ItemView, type Overview, type OverviewItem, type Tally } from "./api";
import styles from "./review.module.css";

type Draft = { verdict: "pass" | "needs-work" | null; reasons: ListeningReason[]; note: string };
const emptyDraft = (): Draft => ({ verdict: null, reasons: [], note: "" });
const percent = (value: number) => `${Math.round(value * 100)}%`;
const time = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const status = (item: OverviewItem) => !item.available ? "Not available" : !item.verdict ? "Not heard" : item.verdict.verdict === "pass" ? "Pass" : "Needs work";

export function ListeningReviewWorkspace() { return <RequireRole role="admin"><Review /></RequireRole>; }

/** Plain counts only: the page never says a set is accepted. */
function TallyLine({ tally }: { tally: Tally }) {
  return <div className={styles.set}>
    <h3>{LISTENING_SET_LABELS[tally.set]}</h3>
    {tally.items === 0 ? <p className={styles.bar}>Not available yet.</p>
      : <p className={styles.counts}><strong>{tally.pass} of {tally.items}</strong> passed, <strong>{tally.needsWork}</strong> need work, <strong>{tally.wouldTeachWrong}</strong> would teach wrong <span>({tally.heard} of {tally.items} heard)</span></p>}
  </div>;
}

function Review() {
  const { concealed, epoch, summary } = useWorkspace(), group = useId();
  const [overview, setOverview] = useState<Overview | null>(null), [failure, setFailure] = useState<number | null>(null);
  const [index, setIndex] = useState(0), [view, setView] = useState<ItemView | null>(null), [viewError, setViewError] = useState<number | null>(null);
  const [retry, setRetry] = useState(0), [draft, setDraft] = useState<Draft>(emptyDraft), [saving, setSaving] = useState(false), [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null);
  const [activeWord, setActiveWord] = useState<{ verse: number; index: number } | null>(null), [latency, setLatency] = useState<number | null>(null);
  const player = useRef<ReadingPlayerHandle | null>(null), register = useCallback((value: ReadingPlayerHandle | null) => { player.current = value; }, []);
  const coordinator = useRef<ReturnType<typeof createReadingAudioCoordinator> | null>(null);
  if (!coordinator.current) coordinator.current = createReadingAudioCoordinator();
  const audio = coordinator.current, tapStart = useRef<number | null>(null), itemRequest = useRef<AbortController | null>(null), mounted = useRef(true);
  const items = overview?.items ?? [], item = items[index] as OverviewItem | undefined;

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await listeningApi.overview(signal); if (!mounted.current || signal?.aborted) return null;
      setOverview(next); setFailure(null); return next;
    } catch (error) { if (mounted.current && !signal?.aborted) setFailure(statusOf(error)); return null; }
  }, []);
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void loadOverview(controller.signal).then(next => { if (next) { const first = next.items.findIndex(row => row.available && !row.verdict); setIndex(first < 0 ? 0 : first); } });
    return () => { mounted.current = false; controller.abort(); itemRequest.current?.abort(); audio.stopAll(); };
  }, [loadOverview, audio, epoch]);
  useLayoutEffect(() => { if (concealed) audio.stopAll(); }, [audio, concealed]);
  useEffect(() => {
    const background = () => { if (document.visibilityState !== "visible") audio.stopAll(); }, leave = () => audio.stopAll();
    document.addEventListener("visibilitychange", background); window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", background); window.removeEventListener("pagehide", leave); };
  }, [audio]);

  const itemId = item?.id, available = item?.available === true;
  useEffect(() => {
    itemRequest.current?.abort(); audio.stopAll(); setView(null); setViewError(null); setActiveWord(null); setLatency(null); tapStart.current = null;
    if (!itemId || !available) return;
    const controller = new AbortController(); itemRequest.current = controller;
    listeningApi.item(itemId, controller.signal).then(next => { if (mounted.current && !controller.signal.aborted) setView(next); },
      error => { if (mounted.current && !controller.signal.aborted) setViewError(statusOf(error)); });
    return () => controller.abort();
  }, [itemId, available, audio, epoch, retry]);
  // A fresh draft for each verse, starting from the verdict already given.
  useEffect(() => {
    setMessage(null);
    const saved = items.find(row => row.id === itemId)?.verdict;
    setDraft(saved ? { verdict: saved.verdict, reasons: [...saved.reasons], note: saved.note ?? "" } : emptyDraft());
  }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const observe = useCallback((state: ReadingPlaybackState) => {
    const now = performance.now(), playback = state.playback.status;
    if (playback === "loading") { if (tapStart.current === null) tapStart.current = now; return; }
    if (playback === "playing" && tapStart.current !== null) {
      const measured = Math.min(60000, Math.max(0, Math.round(now - tapStart.current))); tapStart.current = null;
      setLatency(prior => prior ?? measured); return;
    }
    if (playback !== "ready") tapStart.current = null;
  }, []);
  const verses = useMemo(() => view?.page.verses ?? [], [view]);
  const reference = view?.reference ?? null;
  const load = useCallback(async (verse: number) => { if (verse !== 0 || !reference) throw new PortalRequestError(409); return reference; }, [reference]);
  const go = (next: number) => { if (next >= 0 && next < items.length) { setIndex(next); window.scrollTo({ top: 0 }); } };

  async function save() {
    if (!item || !reference?.source || !draft.verdict || saving) return;
    const note = listeningNote(draft.note);
    if (note === undefined) { setMessage({ text: `Keep the note to ${LISTENING_NOTE_LIMIT} characters, without < or >.`, tone: "alert" }); return; }
    setSaving(true); setMessage(null);
    try {
      const outcome = await listeningApi.record({ itemId: item.id, verdict: draft.verdict, reasons: draft.verdict === "pass" ? [] : draft.reasons, note, latencyMs: latency,
        asset: reference.source.id, mutationId: crypto.randomUUID() });
      if (!mounted.current) return;
      if (!outcome.ok) {
        setMessage({ text: outcome.code === "changed" ? "This verse’s recording changed since the page opened. Reload it and listen again." : outcome.code === "unavailable" ? "This recording isn’t available right now, so nothing was saved." : "That couldn’t be saved. Reload and try again.", tone: "alert" });
        return;
      }
      const refreshed = await loadOverview();
      setMessage({ text: `Saved: ${outcome.verdict.verdict === "pass" ? "Pass" : "Needs work"}.`, tone: "status" });
      const list = refreshed?.items ?? items, after = list.findIndex((row, i) => i > index && row.available && !row.verdict);
      if (after >= 0) go(after);
    } catch (error) {
      if (mounted.current) setMessage({ text: [401, 403].includes(statusOf(error)) ? "This isn’t allowed right now. You may need to sign in again." : "We couldn’t confirm the save. Reload to see what was kept.", tone: "alert" });
    } finally { if (mounted.current) setSaving(false); }
  }

  const toggleReason = (reason: ListeningReason) => setDraft(prior => ({ ...prior, reasons: prior.reasons.includes(reason) ? prior.reasons.filter(r => r !== reason) : LISTENING_REASONS.filter(r => r === reason || prior.reasons.includes(r)) }));
  const saved = item?.verdict;
  return <section className="role-workspace admin-workspace listening-review"><AdminNav />
    <div className="admin-head"><h1>Listening review</h1></div>
    <p className={styles.intro}>Listen to each verse exactly as a student will hear it, then mark it. Tap any word to hear the whole verse. Use Practice to drill one word, Repeat to loop and Speed to slow down. Saving a verdict here doesn’t change what students hear.</p>
    {!overview ? failure === null ? <p role="status">Loading the review…</p>
      : <div className="admin-state" role="alert"><p>{[401, 403].includes(failure) ? "This review is for administrators. Check your account and sign in again." : "The review couldn’t be loaded."}</p><button type="button" className="button-secondary admin-pill" onClick={() => void loadOverview()}>Reload</button></div>
      : <>
        <section className={`people-card ${styles.tallies}`} aria-label="Tally">
          {LISTENING_SOURCES.filter(source => overview.tallies.some(t => t.source === source)).map(source => <div key={source} className={styles.tally}>
            <h2>{LISTENING_SOURCE_LABELS[source]}</h2>
            {overview.tallies.filter(t => t.source === source).map(tally => <TallyLine key={tally.set} tally={tally} />)}
          </div>)}
          <p className={styles.bar}>No pass mark has been set for recorded reference audio; these are counts, not a decision. For comparison only, generated chant (a different gate) must reach {percent(overview.comparison.passRate)} pass with none marked “would teach wrong”.</p>
        </section>
        {item && <section className="people-card" aria-labelledby={`${group}-ref`}>
          <div className={styles.item}>
            <p className={styles.position}>{index + 1} of {items.length} · {LISTENING_SET_LABELS[item.set]} · {LISTENING_SOURCE_LABELS[item.source]} · {item.kind === "torah" ? "Torah" : "Haftarah"}</p>
            <h2 id={`${group}-ref`}><bdi>{item.ref}</bdi></h2>
            <p className={styles.why}>{item.why}</p>
            {!item.available ? <p role="status">This verse has no recording to play from this source, so it isn’t counted.</p>
              : viewError !== null ? <div role="alert"><p>{[401, 403].includes(viewError) ? "This isn’t allowed right now. You may need to sign in again." : "This verse couldn’t be loaded."}</p>
                <button type="button" className="button-secondary admin-pill" onClick={() => setRetry(n => n + 1)}>Try again</button></div>
              : !view ? <p role="status">Loading the verse…</p>
              : <>
                <div className={styles.hebrew}><FlowingStudyText verses={view.page.verses} assignment={{ kind: item.kind, confirmed: true, verses: [item.ref] }} group={group} activeWord={activeWord} listening={reference !== null}
                  onVerse={reference ? () => player.current?.select(0, "verse") : undefined} onWord={reference ? (verse, word) => playMainVerseForWord(player.current, null, verse, word) : undefined} /></div>
                {reference ? <>
                  {!concealed && <ReadingPlayer key={JSON.stringify([summary.sessionBinding, epoch, item.id])} scopeKey={JSON.stringify([summary.sessionBinding, epoch, item.id])} verses={verses} active={!concealed} enabled={!concealed}
                    audio={{ coordinator: audio, slot: "assigned" }} load={load} register={register} onActiveWord={setActiveWord} onPlaybackState={observe} wordTools={false} />}
                  <p className={styles.timing} role="status">{latency === null ? "First tap to playing is timed on this phone when you play (time until the player starts, not to the first sound you hear)." : `First tap to playing: ${latency} ms`}</p>
                </> : <p role="status">This source has no recording for this verse, so it can’t be marked.</p>}
                {reference && <form onSubmit={event => { event.preventDefault(); void save(); }}>
                  <div className={styles.verdicts} role="group" aria-label="Verdict">
                    <button type="button" className="button-secondary" aria-pressed={draft.verdict === "pass"} onClick={() => setDraft(prior => ({ ...prior, verdict: "pass", reasons: [] }))}>Pass</button>
                    <button type="button" className="button-secondary" aria-pressed={draft.verdict === "needs-work"} onClick={() => setDraft(prior => ({ ...prior, verdict: "needs-work" }))}>Needs work</button>
                  </div>
                  {draft.verdict === "needs-work" && <fieldset className={styles.reasons}><legend>What needs work? (optional)</legend>
                    {LISTENING_REASONS.map(reason => <label key={reason}><input type="checkbox" checked={draft.reasons.includes(reason)} onChange={() => toggleReason(reason)} />{LISTENING_REASON_LABELS[reason]}</label>)}
                  </fieldset>}
                  <label className={styles.note}>Note (optional)<textarea value={draft.note} maxLength={LISTENING_NOTE_LIMIT} rows={3} onChange={event => setDraft(prior => ({ ...prior, note: event.target.value }))} /></label>
                  <div className={styles.actions}><button type="submit" className="button-primary admin-pill" disabled={!draft.verdict || saving}>{saving ? "Saving…" : "Save and go to next"}</button></div>
                  {saved && <p className={styles.saved}>Last saved {time(saved.at)}: {saved.verdict === "pass" ? "Pass" : "Needs work"}{saved.latencyMs !== null ? ` · first tap to playing ${saved.latencyMs} ms` : ""}</p>}
                </form>}
              </>}
            {message && <p className={message.tone === "alert" ? "request-error" : "workspace-notice"} role={message.tone}>{message.text}</p>}
          </div>
          <div className={styles.steps}>
            <button type="button" className="button-secondary" disabled={index === 0} onClick={() => go(index - 1)}>Previous verse</button>
            <button type="button" className="button-secondary" disabled={index >= items.length - 1} onClick={() => go(index + 1)}>Next verse</button>
          </div>
        </section>}
        <details className={styles.list}><summary>All {items.length} verses</summary>
          <ol>{items.map((row, i) => <li key={row.id}><button type="button" aria-current={i === index ? "true" : undefined} onClick={() => go(i)}><span><bdi>{row.ref}</bdi></span><span>{status(row)}</span></button></li>)}</ol>
        </details>
      </>}
  </section>;
}
