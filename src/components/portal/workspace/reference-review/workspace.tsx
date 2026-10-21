"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AdminNav } from "../admin-nav";
import { RequireRole, statusOf, useWorkspace } from "../provider";
import { REVIEW_CHECKS, reviewApi, type Batch, type Check, type Checks, type Detail, type Entry } from "./api";
import styles from "./review.module.css";
import hebrew from "../../../../styles/hebrew-font.module.css";
import { studyEditions } from "../study/credits";

const labels: Record<Check, [string, string]> = {
  privacy: ["Privacy", "No personal names, lesson conversation or other private material is audible."],
  listening: ["Listening", "I listened to the complete recording; its sound is clear and usable."],
  exactText: ["Exact text", "The recording matches all the Hebrew shown here, in this order."],
  musicalAccuracy: ["Teaching accuracy", "The reading or chant would teach the passage correctly."],
  rights: ["Permission", "This recording is covered by the permission for this collection."],
};
type Draft = Record<Check, "pass" | "hold" | "">;
const emptyChecks = (): Draft => ({ privacy: "", listening: "", exactText: "", musicalAccuracy: "", rights: "" });
const displayDate = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const title = (entry: Entry) => entry.verses.length === 1 ? entry.verses[0] : `${entry.verses.length} verses · ${entry.verses[0]}`;
export function ReferenceReviewCredits() {
  const edition = studyEditions.mam;
  return <aside aria-label="Recording and Hebrew text credits"><p>Teaching collection shared by Cantor Josh Finkel.</p>
    <details className="study-credits"><summary>Hebrew text source, license and changes</summary><h4>{edition.versionTitle}</h4><p>{edition.creator}</p>
      <p><a href={edition.sourceUrl} target="_blank" rel="noopener noreferrer">Edition source</a> · <a href={edition.licenseUrl} target="_blank" rel="noopener noreferrer">{edition.license}</a></p><p>{edition.changes}</p>
    </details></aside>;
}
export function ReferenceReviewWorkspace() { return <RequireRole role="admin"><Review /></RequireRole>; }
function Review() {
  const { concealed, registerReload, registerQuiet, registerDeparture } = useWorkspace();
  const [batches, setBatches] = useState<Batch[]>([]), [detail, setDetail] = useState<Detail | null>(null), [selected, setSelected] = useState("");
  const [checks, setChecks] = useState<Draft>(emptyChecks), [dirty, setDirty] = useState(false), [pending, setPending] = useState(true), [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState(""), [failed, setFailed] = useState(false), [audioReady, setAudioReady] = useState(false), [audioPending, setAudioPending] = useState(false);
  const [switching, setSwitching] = useState(false), switchPanel = useRef<HTMLElement | null>(null), nextAction = useRef<{ proceed: () => void; cancel: () => void } | null>(null), dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const media = useRef<HTMLAudioElement | null>(null), objectUrl = useRef<string | null>(null), request = useRef<AbortController | null>(null), audioRequest = useRef<AbortController | null>(null);
  const generation = useRef(0), audioGeneration = useRef(0), mounted = useRef(true), gate = useRef(false), current = useRef<Detail | null>(detail); current.current = detail;
  const entry = detail?.entries.find(row => row.assetKey === selected);
  const stopAudio = useCallback(() => {
    audioGeneration.current++; audioRequest.current?.abort(); audioRequest.current = null;
    if (media.current) { media.current.pause(); media.current.removeAttribute("src"); media.current.load(); }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null;
    if (mounted.current) { setAudioReady(false); setAudioPending(false); }
  }, []);
  const forget = useCallback(() => { generation.current++; request.current?.abort(); request.current = null; current.current = null; nextAction.current?.cancel(); nextAction.current = null; setSwitching(false);
    stopAudio(); setPending(false); setDetail(null); setBatches([]); setSelected(""); setChecks(emptyChecks()); setDirty(false); }, [stopAudio]);
  const fail = useCallback((error: unknown, mutation = false) => {
    forget(); setBlocked(true); setFailed(true);
    const status = statusOf(error);
    setMessage([401, 403, 404].includes(status) ? "This private review is no longer available. Check your account, then reload."
      : mutation && ![400, 409, 429].includes(status) ? "We couldn’t confirm whether the review was saved. Reload and inspect its status before trying again."
      : status === 409 ? "This review changed. Reload it before recording your checks."
      : "The private review couldn’t be loaded. Reload to check access and try again.");
  }, [forget]);
  const selectEntry = useCallback((value: Entry) => { stopAudio(); setSelected(value.assetKey); setChecks(value.decision ? { ...value.decision.checks } : emptyChecks()); setDirty(false); }, [stopAudio]);
  const switchView = useCallback((proceed: () => void, cancel: () => void = () => undefined) => {
    if (gate.current) { cancel(); return; }
    if (!dirtyRef.current) { proceed(); return; }
    stopAudio(); nextAction.current?.cancel(); nextAction.current = { proceed, cancel }; setSwitching(true);
  }, [stopAudio]);
  const load = useCallback(async (preferred?: string) => {
    const previous = preferred ?? current.current?.batch.id; request.current?.abort(); const controller = new AbortController(); request.current = controller; const turn = ++generation.current;
    stopAudio(); setPending(true); setMessage(""); setFailed(false); setBlocked(false); setDetail(null); setChecks(emptyChecks()); setDirty(false);
    try {
      const list = await reviewApi.list(controller.signal), batch = list.find(row => row.id === previous) ?? list[0];
      const next = batch ? await reviewApi.detail(batch.id, controller.signal) : null;
      if (!mounted.current || controller.signal.aborted || generation.current !== turn) return;
      setBatches(list); setDetail(next); if (next) selectEntry(next.entries[0]); else setSelected("");
    } catch (error) { if (mounted.current && !controller.signal.aborted && generation.current === turn) fail(error); throw error; }
    finally { if (mounted.current && !controller.signal.aborted && generation.current === turn) setPending(false); }
  }, [stopAudio, selectEntry, fail]);
  useEffect(() => { mounted.current = true; void load().catch(() => undefined); return () => { mounted.current = false; generation.current++; request.current?.abort(); nextAction.current?.cancel(); nextAction.current = null; stopAudio(); }; }, [load, stopAudio]);
  useEffect(() => registerReload(() => load()), [registerReload, load]);
  useEffect(() => registerDeparture(() => new Promise<boolean>(resolve => { stopAudio(); switchView(() => resolve(true), () => resolve(false)); })), [registerDeparture, stopAudio, switchView]);
  useEffect(() => { if (switching) { switchPanel.current?.focus(); switchPanel.current?.scrollIntoView({ block: "nearest" }); } }, [switching]);
  useEffect(() => registerQuiet(async signal => {
    const baseline = current.current; if (!baseline) return true;
    try {
      const next = await reviewApi.detail(baseline.batch.id, signal);
      if (signal.aborted) return false;
      const same = JSON.stringify(next) === JSON.stringify(baseline); if (!same) stopAudio(); return same;
    } catch (error) { if (!signal.aborted) fail(error); throw error; }
  }), [registerQuiet, stopAudio, fail]);
  useLayoutEffect(() => { if (concealed) stopAudio(); }, [concealed, stopAudio]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState !== "visible") stopAudio(); };
    window.addEventListener("blur", stopAudio); window.addEventListener("pagehide", stopAudio); document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("blur", stopAudio); window.removeEventListener("pagehide", stopAudio); document.removeEventListener("visibilitychange", hidden); };
  }, [stopAudio]);
  useEffect(() => {
    if (!detail) return;
    const expire = () => { if (Date.parse(detail.batch.expiresAt) <= Date.now()) { forget(); setBlocked(true); setFailed(true); setMessage("This private batch expired. Reload to see the batches still available."); } };
    const timer = setTimeout(expire, Math.max(0, Date.parse(detail.batch.expiresAt) - Date.now()));
    const clock = setInterval(expire, 1000); return () => { clearTimeout(timer); clearInterval(clock); };
  }, [detail, forget]);
  const liveMedia = () => { if (concealed || !detail || Date.parse(detail.batch.expiresAt) <= Date.now()) stopAudio(); };
  async function listen() {
    if (!detail || !entry || gate.current || blocked || concealed) return;
    stopAudio(); const controller = new AbortController(); audioRequest.current = controller; const turn = ++audioGeneration.current;
    setAudioPending(true); setMessage(""); setFailed(false);
    try {
      const blob = await reviewApi.audio(detail.batch, entry, controller.signal);
      if (!mounted.current || controller.signal.aborted || turn !== audioGeneration.current || Date.parse(detail.batch.expiresAt) <= Date.now()) return;
      const url = URL.createObjectURL(blob); objectUrl.current = url;
      if (!media.current) { URL.revokeObjectURL(url); objectUrl.current = null; return; }
      media.current.src = url; media.current.load(); setAudioReady(true); setMessage("Recording ready. Press Play to listen.");
    } catch (error) { if (mounted.current && !controller.signal.aborted && turn === audioGeneration.current) fail(error); }
    finally { if (mounted.current && turn === audioGeneration.current) setAudioPending(false); }
  }
  async function save() {
    if (!detail || !entry || gate.current || blocked || concealed || !dirty || !REVIEW_CHECKS.every(key => checks[key] !== "")) return;
    gate.current = true; stopAudio(); setPending(true); setMessage(""); setFailed(false);
    request.current?.abort(); const controller = new AbortController(); request.current = controller; const turn = ++generation.current;
    try {
      const decision = await reviewApi.decide(detail.batch, entry, checks as Checks, controller.signal);
      if (!mounted.current || controller.signal.aborted || generation.current !== turn) return;
      setDetail({ ...detail, entries: detail.entries.map(row => row.assetKey === entry.assetKey ? { ...row, decision } : row) }); setDirty(false);
      nextAction.current?.cancel(); nextAction.current = null; setSwitching(false);
      setMessage(decision.wholeClipAccepted ? "All five review checks saved. Student playback remains held." : "Review saved with a hold. Student playback remains held.");
    } catch (error) { if (mounted.current && !controller.signal.aborted && generation.current === turn) fail(error, true); }
    finally { gate.current = false; if (mounted.current && generation.current === turn) setPending(false); }
  }
  async function revoke() {
    if (!detail || gate.current || blocked || concealed) return;
    gate.current = true; stopAudio(); setPending(true); request.current?.abort(); const controller = new AbortController(); request.current = controller;
    try { await reviewApi.revoke(detail.batch, controller.signal); if (mounted.current && !controller.signal.aborted) { forget(); setMessage("Private batch access revoked."); setFailed(false); await load(); setMessage("Private batch access revoked."); } }
    catch (error) { if (mounted.current && !controller.signal.aborted) fail(error, true); }
    finally { gate.current = false; if (mounted.current) setPending(false); }
  }
  return <section className={`role-workspace admin-workspace ${styles.page}`}><AdminNav />
    <div className="admin-head"><h1>Recording review</h1><button type="button" className="button-secondary" disabled={pending || audioPending} onClick={() => switchView(() => void load().catch(() => undefined))}>Reload review</button></div>
    <p className={styles.intro}>Listen beside the Hebrew and record each check. This private review does not enable student playback.</p>
    {message && <p role={failed ? "alert" : "status"} className={failed ? "request-error" : "workspace-notice"}>{message}</p>}
    {switching && <section ref={switchPanel} tabIndex={-1} className={styles.switchPrompt} aria-label="Unsaved review checks"><h2>Keep your review checks?</h2><p>Save your checks before switching, or discard the changes to continue.</p><div className={styles.choices}><button type="button" className="button-secondary" onClick={() => { nextAction.current?.cancel(); nextAction.current = null; setSwitching(false); }}>Keep reviewing</button><button type="button" className="button-secondary" onClick={() => { const action = nextAction.current; nextAction.current = null; setSwitching(false); setDirty(false); dirtyRef.current = false; action?.proceed(); }}>Discard checks and continue</button></div></section>}
    {pending && !detail ? <p role="status" aria-live="polite">Checking private review access…</p> : !detail && !blocked ? <div className="admin-empty"><h2>No private batches to review</h2><p>Prepared recordings will appear here when a batch is assigned to your account.</p></div> : null}
    {detail && <>
      <div className={styles.batch}><label>Private batch<select value={detail.batch.id} disabled={pending || audioPending} onChange={event => { const id = event.target.value; switchView(() => void load(id).catch(() => undefined)); }}>{batches.map((batch, index) => <option key={batch.id} value={batch.id}>Batch {index + 1} · {batch.entryCount} {batch.entryCount === 1 ? "recording" : "recordings"} · expires {displayDate(batch.expiresAt)}</option>)}</select></label>
        <details className={styles.revoke}><summary>Batch access</summary><p>Revoke this entire batch’s private listening access. Saved review records remain.</p><button type="button" className="button-secondary" disabled={pending || blocked} onClick={() => void revoke()}>Revoke this batch</button></details></div>
      <div className={styles.layout}><nav className={styles.queue} aria-label="Recordings in this batch">{detail.entries.map((item, index) => <button type="button" key={item.assetKey} aria-current={selected === item.assetKey ? "true" : undefined} disabled={pending} onClick={() => { if (item.assetKey !== selected) switchView(() => { selectEntry(item); setMessage(""); setFailed(false); }); }}><span>Recording {index + 1}</span><strong>{title(item)}</strong><span>{item.mode === "spoken" ? "Spoken reading" : "Chant"} · {item.decision ? item.decision.wholeClipAccepted ? "Checks passed" : "On hold" : "Awaiting review"}</span></button>)}</nav>
        {entry && <article className={styles.recording} aria-label="Selected recording"><header><h2>{title(entry)}</h2><p>{entry.readingKind === "torah" ? "Torah" : "Haftarah"} · {entry.mode === "spoken" ? "Spoken reading" : "Chant"} · Whole recording</p></header>
          <div className={styles.passage} lang="he" dir="rtl">{entry.text.map(verse => <p key={verse.ref} className={hebrew.hebrew}><span className={styles.verseRef} lang="en" dir="ltr">{verse.ref}</span>{verse.readingText}</p>)}</div>
          <section className={styles.listening} aria-label="Private listening"><button type="button" className="button-primary" disabled={pending || blocked || audioPending || audioReady} onClick={() => void listen()}>{audioPending ? "Preparing recording…" : audioReady ? "Recording ready" : "Prepare recording"}</button>
            <audio ref={node => { media.current = node; node?.setAttribute("disableremoteplayback", ""); }} controls controlsList="nodownload noremoteplayback" preload="none" aria-label="Review recording" onPlay={liveMedia} onTimeUpdate={liveMedia} onError={() => { if (objectUrl.current) { stopAudio(); setFailed(true); setMessage("This recording couldn’t play. Prepare it again to retry."); } }} />
            <p>Compare the complete recording with every verse above. Phrase timing has not been reviewed.</p></section>
          <ReferenceReviewCredits />
          <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}><h3>Review checks</h3>
            {entry.decision && <p className={styles.saved}>Saved {displayDate(entry.decision.createdAt)} · {entry.decision.wholeClipAccepted ? "All checks passed" : "On hold"}</p>}
            {REVIEW_CHECKS.map(key => <fieldset key={key} disabled={pending || blocked}><legend>{labels[key][0]}</legend><p>{labels[key][1]}</p><div className={styles.choices}>{(["pass", "hold"] as const).map(value => <label key={value}><input type="radio" name={`review-${key}`} value={value} checked={checks[key] === value} onChange={() => { setChecks(previous => ({ ...previous, [key]: value })); setDirty(true); }} />{value === "pass" ? "Pass" : "Hold"}</label>)}</div></fieldset>)}
            <button type="submit" className="button-primary" disabled={pending || blocked || !dirty || !REVIEW_CHECKS.every(key => checks[key] !== "")}>{pending ? "Saving review…" : "Save these checks"}</button>
          </form>
        </article>}
      </div></>}
  </section>;
}
