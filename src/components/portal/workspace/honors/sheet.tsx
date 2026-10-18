"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HonorsContextView } from "../../../../lib/honors/types";
import { useWorkspace, useWorkspaceModal } from "../provider";
import { icons } from "../study/lift";
import { createHonorsClient, type HonorsClient } from "./api";
import { createHonorsOwner, type HonorsOwner, type HonorsState } from "./owner";
import { spanLabel } from "./draft";
import { HonorsFields } from "./fields";
import { printSavedHonors } from "./print";
import styles from "./honors.module.css";

function ContextReview({ previous, current, state, owner }: { previous: HonorsContextView; current: HonorsContextView; state: HonorsState; owner: HonorsOwner }) {
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const changed = state.draft.aliyot.filter(group => { const old = previous.spans.find(s => s.startVerse === group.startVerse); return !current.spans.some(s => s.startVerse === old?.startVerse && s.endVerse === old.endVerse); });
  return <section className={styles.review} aria-label="Review changed ceremony"><h3>Review the ceremony details</h3>
    <p>The saved form used {previous.snapshot.ceremonyDate} ({previous.snapshot.serviceSlot}). The current ceremony is {current.snapshot.ceremonyDate} ({current.snapshot.serviceSlot}).</p>
    <p>{previous.snapshot.torah?.ref ?? "No previous Torah reading"} → {current.snapshot.torah?.ref ?? "No current Torah reading"}</p>
    {changed.length ? <><p>These groups still belong to their previous spans. Choose a current span for each group or explicitly remove it. People stay in their original order.</p><ol>{changed.map(group => { const old = previous.spans.find(s => s.startVerse === group.startVerse); return <li key={group.startVerse}><label><span>Previous span: {old ? spanLabel(old) : group.startVerse}</span><span>{group.participants.map(p => p.englishName || "Unnamed person").join(", ") || "Empty group"}</span><select aria-label={`Current span for ${group.startVerse}`} value={Object.hasOwn(mapping, group.startVerse) ? mapping[group.startVerse] ?? "remove" : ""} onChange={e => setMapping(m => ({ ...m, [group.startVerse]: e.target.value === "remove" ? null : e.target.value }))}><option value="">Choose a current span…</option>{current.spans.map(span => <option key={span.startVerse} value={span.startVerse}>{spanLabel(span)}</option>)}<option value="remove">Remove this group from the form</option></select></label></li>; })}</ol></> : <p>The entered groups still match their actual spans. Confirm that you have reviewed the current date, service time and reading.</p>}
    <button type="button" className="button-secondary" disabled={state.phase !== "ready"} onClick={() => owner.review(mapping)}>I reviewed the current ceremony</button>
    <p className={styles.help}>This updates your draft. Use Save honors to record the review.</p>
  </section>;
}
export function HonorsEntry({ studentId, name }: { studentId: string; name: string }) {
  const [open, setOpen] = useState(false), { busy, context } = useWorkspace(), origin = useRef<HTMLButtonElement>(null);
  return <><section className={styles.entry} aria-label="Family honors"><div><h2>Family honors</h2><p>Choose the people who will take part in the ceremony.</p></div><button ref={origin} type="button" className="button-secondary" disabled={busy || !!context} onClick={() => setOpen(true)}>Family honors</button></section>
    {open && <HonorsSheet studentId={studentId} name={name} mode="parent" onClose={() => { setOpen(false); origin.current?.focus(); }} />}</>;
}
export function HonorsSheet({ studentId, name, mode, onClose }: { studentId: string; name: string; mode: "parent" | "admin"; onClose(): void }) {
  const { summary, context, verifyServiceSession, serviceAuthorityFailed, registerDeparture, registerWork, registerReload, registerQuiet } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), lastFocus = useRef<HTMLElement | null>(null), settled = useRef(false), id = useId();
  const [state, setState] = useState<HonorsState | null>(null), [departure, setDeparture] = useState(false), [discardReview, setDiscardReview] = useState(false), [printing, setPrinting] = useState(false), [printError, setPrintError] = useState("");
  const lifetime = useRef<{ owner: HonorsOwner; api: HonorsClient; active: boolean } | null>(null), pendingDeparture = useRef<{ promise: Promise<boolean>; resolve(value: boolean): void } | null>(null);
  const printAbort = useRef<AbortController | null>(null), printCleanup = useRef<(() => void) | null>(null), printingRef = useRef(false), departureHeading = useRef<HTMLHeadingElement>(null);
  const finishDeparture = useCallback((leave: boolean) => { const pending = pendingDeparture.current; pendingDeparture.current = null; setDeparture(false); pending?.resolve(leave); }, []);
  const guard = useCallback(() => {
    const life = lifetime.current; if (!life?.active || life.owner.busy() || printingRef.current) return Promise.resolve(false);
    if (!life.owner.hasUnsaved()) return Promise.resolve(true);
    if (pendingDeparture.current) return pendingDeparture.current.promise;
    let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); pendingDeparture.current = { promise, resolve }; setDeparture(true); return promise;
  }, []);
  useLayoutEffect(() => {
    let active = true; setState(null); setDeparture(false); setPrintError("");
    if (context) { onClose(); return; }
    const api = createHonorsClient({ studentId, mode, verify: verifyServiceSession, denied: status => { if (active && lifetime.current?.active) serviceAuthorityFailed(status); } });
    const owner = createHonorsOwner(api, value => { if (active) setState(value); }); const life = { owner, api, active: true }; lifetime.current = life; setState(owner.state);
    const cleanupPrint = () => { printAbort.current?.abort(); printCleanup.current?.(); printCleanup.current = null; };
    const lifecycle = { pause() { owner.pause(); cleanupPrint(); }, clear() { cleanupPrint(); owner.clear(); finishDeparture(false); }, settle: owner.settle, hasUnsaved: owner.hasUnsaved, reveal() {} };
    const removeWork = registerWork(lifecycle), removeDeparture = registerDeparture(guard), removeReload = registerReload(async () => { if (life.active) await owner.load(); }), removeQuiet = registerQuiet(signal => owner.quiet(signal));
    void owner.load();
    return () => { active = false; life.active = false; cleanupPrint(); owner.clear(); finishDeparture(false); removeWork(); removeDeparture(); removeReload(); removeQuiet(); if (lifetime.current === life) lifetime.current = null; };
    // Session binding and selected student define this private owner. Practice never supplies authority.
  }, [studentId, mode, summary.sessionBinding, context?.id, verifyServiceSession, serviceAuthorityFailed, registerDeparture, registerWork, registerReload, registerQuiet, guard, finishDeparture]);
  const shown = useWorkspaceModal(dialog, true), shownRef = useRef(shown); shownRef.current = shown;
  useLayoutEffect(() => { settled.current = false; if (!shown) return; const field = lastFocus.current; (field?.isConnected && dialog.current?.contains(field) ? field : heading.current)?.focus(); settled.current = true; }, [shown]);
  useEffect(() => { if (departure) departureHeading.current?.focus(); }, [departure]);
  useEffect(() => { const unload = (event: BeforeUnloadEvent) => { if (lifetime.current?.owner.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, []);
  async function close() { const life = lifetime.current; if (await guard() && life === lifetime.current) { life?.owner.clear(); onClose(); } }
  function keepEditing() { if (!lifetime.current?.owner.busy() && !printingRef.current) finishDeparture(false); }
  function leave() { const life = lifetime.current; if (!life?.active || life.owner.busy() || printingRef.current || !pendingDeparture.current) return; life.owner.clear(); finishDeparture(true); }
  function recover(check: boolean) { const life = lifetime.current; if (!life?.active || pendingDeparture.current || life.owner.busy() || printingRef.current) return; void (check ? life.owner.check() : life.owner.retry()); }
  async function print() {
    const life = lifetime.current; if (!life?.active || mode !== "admin" || life.owner.busy() || life.owner.uncertain() || printingRef.current) return;
    printingRef.current = true; setPrinting(true); setPrintError(""); printAbort.current?.abort(); const controller = new AbortController(); printAbort.current = controller;
    try { const saved = await life.api.read(controller.signal); if (!life.active || lifetime.current !== life || controller.signal.aborted) return; printCleanup.current?.(); printCleanup.current = printSavedHonors(saved, name); }
    catch { if (life.active && !controller.signal.aborted) setPrintError("The saved form couldn’t be verified for printing. No draft was printed."); }
    finally { printingRef.current = false; if (life.active) setPrinting(false); }
  }
  const owner = lifetime.current?.owner, current = state?.current, busy = !!owner?.busy() || printing, privateReady = state?.phase !== "disposed", review = !!current && !!state?.draftContext && !state.reviewed;
  return <dialog ref={dialog} className={`roster-sheet ${styles.sheet}`} aria-labelledby={`${id}-title`} closedby={busy ? "none" : "closerequest"} onFocus={e => { const target = e.target as HTMLElement; if (settled.current && target !== heading.current) lastFocus.current = target; }} onCancel={e => { e.preventDefault(); if (!busy) void close(); }} onClose={() => { if (!shownRef.current) return; if (!dialog.current?.open) dialog.current?.showModal(); if (!busy) void close(); }}>
    <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close family honors" disabled={busy} onClick={() => void close()}>{icons.close}</button></div>
    <div className={styles.body}><h2 id={`${id}-title`} className={styles.title} ref={heading} tabIndex={-1}>Family honors</h2>
      {privateReady && <p className={styles.student}><bdi dir="auto">{name}</bdi></p>}
      {current && <><p className={styles.meta}><time dateTime={current.currentContext.snapshot.ceremonyDate}>{current.currentContext.snapshot.ceremonyDate}</time> · {current.currentContext.snapshot.serviceSlot === "unknown" ? "Service time not confirmed" : current.currentContext.snapshot.serviceSlot === "morning" ? "Morning" : "Havdalah"}</p><p className={styles.intro}>Choose who will take part, in ceremony order. Changes stay in this tab until you save. Unknown Hebrew names can be left blank.</p></>}
      {(!state || state.phase === "loading") && <p role="status">Loading private family honors…</p>}
      {state?.phase === "disposed" && <p role="status">This family’s honors are no longer available in this session.</p>}
      {departure && <section className={styles.departure} aria-labelledby={`${id}-departure`}><h3 id={`${id}-departure`} tabIndex={-1} ref={departureHeading}>{owner?.uncertain() ? "Leave with the save unconfirmed?" : "Leave your unsaved changes?"}</h3><p>{owner?.uncertain() ? "The original save may still complete. Leaving removes this tab’s receipt and retry controls and cannot cancel or undo the save." : "Your changes are only in this tab. Leaving discards them."}</p><div className={styles.actions}><button type="button" className="button-primary" disabled={busy} onClick={keepEditing}>Keep editing</button><button type="button" className="button-secondary" disabled={busy} onClick={leave}>{owner?.uncertain() ? "Leave without confirmation" : "Discard changes and leave"}</button></div></section>}
      {state?.error && <p role="alert" className={styles.notice}>{state.error}</p>}
      {state && ["unavailable", "conflict"].includes(state.phase) && !state.pending && <div className={styles.actions}><button type="button" className="button-secondary" disabled={busy} onClick={() => void owner?.load()}>Check current form</button><button type="button" className="button-text" disabled={busy} onClick={() => { if (!owner?.hasUnsaved()) void owner?.discard(); else setDiscardReview(true); }}>Discard draft and reload saved form</button></div>}
      {discardReview && <section className={styles.departure}><h3>Discard this draft?</h3><p>The latest saved form will replace the unsaved names in this tab.</p><div className={styles.actions}><button className="button-secondary" type="button" disabled={busy} onClick={() => { if (!owner?.busy() && !printingRef.current) setDiscardReview(false); }}>Keep draft</button><button className="button-secondary" type="button" disabled={busy} onClick={() => { if (owner?.busy() || printingRef.current) return; setDiscardReview(false); void owner?.discard(); }}>Discard draft and reload</button></div></section>}
      {current && state && owner && <>
        {current.currentContext.unknownSlot && <p className={styles.contextNotice}>The service time is not confirmed. Ask the congregation to confirm it.</p>}
        {current.currentContext.readingNeedsReview && <p className={styles.contextNotice}>The assigned reading needs staff review. Saving honors does not confirm the reading.</p>}
        {review && <ContextReview key={current.currentContext.hash} previous={state.draftContext!} current={current.currentContext} state={state} owner={owner} />}
        <HonorsFields draft={state.draft} context={state.draftContext ?? current.currentContext} disabled={state.phase !== "ready" || busy || departure || review} onChange={owner.edit} />
      </>}
      {state?.phase === "unknown" && <div className={styles.notice}><p>The original save is unconfirmed. Edits are locked so the same request can be checked or retried.</p><div className={styles.actions}><button type="button" className="button-secondary" disabled={departure || busy} onClick={() => recover(true)}>Check save</button><button type="button" className="button-secondary" disabled={departure || busy} onClick={() => recover(false)}>Retry same save</button></div></div>}
      {printError && <p role="alert">{printError}</p>}
    </div>
    <footer className={styles.footer}><p role="status">{state?.phase === "saving" ? "Saving honors…" : state?.phase === "checking" ? "Checking the original save…" : state?.phase === "unknown" ? "Save not confirmed" : state?.savedNotice ? "Honors saved." : state?.dirty ? "Unsaved changes" : current?.saved ? `Saved version ${current.currentVersion}` : "No saved form yet"}</p>
      {mode === "admin" && current?.saved && <button type="button" className="button-secondary" disabled={busy || !!state?.pending || departure} onClick={() => void print()}>{printing ? "Verifying saved form…" : "Print saved form"}</button>}
      <button type="button" className="button-primary" disabled={!state?.dirty || state.phase !== "ready" || busy || review || departure} onClick={() => void owner?.save()}>Save honors</button>
    </footer>
  </dialog>;
}
