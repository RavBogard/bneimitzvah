"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { HonorsContextView } from "../../../../lib/honors/types";
import { useWorkspace, useWorkspaceModal } from "../provider";
import { icons } from "../study/lift";
import { createHonorsClient, type HonorsClient } from "./api";
import { createHonorsOwner, type HonorsOwner, type HonorsState } from "./owner";
import { spanLabel } from "./draft";
import { HonorsFields } from "./fields";
import { createHonoreeClient } from "./honoree-api";
import { createHonoreeOwner, type HonoreeOwner, type HonoreeState } from "./honoree-owner";
import { HonoreeControls } from "./honoree-controls";
import { printSavedHonors } from "./print";
import styles from "./honors.module.css";

function ContextReview({ previous, current, state, owner, blocked, canReview }: { previous: HonorsContextView; current: HonorsContextView; state: HonorsState; owner: HonorsOwner; blocked: boolean; canReview(): boolean }) {
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const changed = state.draft.aliyot.filter(group => { const old = previous.spans.find(s => s.startVerse === group.startVerse); return !current.spans.some(s => s.startVerse === old?.startVerse && s.endVerse === old.endVerse); });
  return <section className={styles.review} aria-label="Review changed ceremony"><h3>Review the ceremony details</h3>
    <p>The saved form was for {when(previous.snapshot.ceremonyDate, previous.snapshot.serviceSlot)}. The ceremony is now {when(current.snapshot.ceremonyDate, current.snapshot.serviceSlot)}.</p>
    <p>{previous.snapshot.torah?.ref ?? "No previous Torah reading"} → {current.snapshot.torah?.ref ?? "No current Torah reading"}</p>
    {changed.length ? <><p>These groups still belong to their previous spans. Choose a current span for each group or explicitly remove it. People stay in their original order.</p><ol>{changed.map(group => { const old = previous.spans.find(s => s.startVerse === group.startVerse); return <li key={group.startVerse}><label><span>Previous span: {old ? spanLabel(old) : group.startVerse}</span><span>{group.participants.map(p => p.englishName || "Unnamed person").join(", ") || "Empty group"}</span><select aria-label={`Current span for ${group.startVerse}`} value={Object.hasOwn(mapping, group.startVerse) ? mapping[group.startVerse] ?? "remove" : ""} onChange={e => setMapping(m => ({ ...m, [group.startVerse]: e.target.value === "remove" ? null : e.target.value }))}><option value="">Choose a current span…</option>{current.spans.map(span => <option key={span.startVerse} value={span.startVerse}>{spanLabel(span)}</option>)}<option value="remove">Remove this group from the form</option></select></label></li>; })}</ol></> : <p>The entered groups still match their actual spans. Confirm that you have reviewed the current date, service time and reading.</p>}
    <button type="button" className="button-secondary" disabled={state.phase !== "ready" || blocked} onClick={() => { if (!blocked && canReview()) owner.review(mapping); }}>I reviewed the current ceremony</button>
    <p className={styles.help}>This updates your draft. Use Save honors to record the review.</p>
  </section>;
}
const slotName = (slot: string) => slot === "morning" ? "Morning service" : slot === "havdalah" ? "Havdalah service" : "Service time not confirmed";
const longDate = (value: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const when = (date: string, slot: string) => `${longDate(date)}, ${slot === "unknown" ? "service time not confirmed" : slotName(slot).toLowerCase()}`;
// Child students remain read-only; own-adult eligibility is projected by the live list.
export function HonorsNote() {
  return <section className={styles.entry} aria-label="Family honors"><div><h2>Family honors</h2><p>Your family or the congregation office arranges who takes part in your ceremony, such as opening the ark and the aliyot. If you’re arranging your own ceremony, send the names to the congregation office and they’ll enter them for you.</p></div></section>;
}
export function HonorsEntry({ studentId, name, mode = "parent" }: { studentId: string; name: string; mode?: "parent" | "student" }) {
  const [open, setOpen] = useState(false), { busy, context } = useWorkspace(), origin = useRef<HTMLButtonElement>(null);
  return <><section className={styles.entry} aria-label="Family honors"><div><h2>Family honors</h2><p>Choose the people who will take part in the ceremony.</p></div><button ref={origin} type="button" className="button-secondary" disabled={busy || !!context} onClick={() => setOpen(true)}>Family honors</button></section>
    {open && <HonorsSheet studentId={studentId} name={name} mode={mode} onClose={() => { setOpen(false); origin.current?.focus(); }} />}</>;
}
export function HonorsSheet({ studentId, name, mode, onClose }: { studentId: string; name: string; mode: "parent" | "admin" | "student"; onClose(): void }) {
  const { summary, context, verifyServiceSession, serviceAuthorityFailed, registerDeparture, registerWork, registerReload, registerQuiet } = useWorkspace();
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), lastFocus = useRef<HTMLElement | null>(null), settled = useRef(false), id = useId();
  const [state, setState] = useState<HonorsState | null>(null), [departure, setDeparture] = useState(false), [discardReview, setDiscardReview] = useState(false), [printing, setPrinting] = useState(false), [printError, setPrintError] = useState("");
  const [linkState, setLinkState] = useState<HonoreeState | null>(null);
  const lifetime = useRef<{ owner: HonorsOwner; links: HonoreeOwner; api: HonorsClient; active: boolean } | null>(null), pendingDeparture = useRef<{ promise: Promise<boolean>; resolve(value: boolean): void } | null>(null);
  const printAbort = useRef<AbortController | null>(null), printCleanup = useRef<(() => void) | null>(null), printingRef = useRef(false), departureHeading = useRef<HTMLHeadingElement>(null);
  const finishDeparture = useCallback((leave: boolean) => { const pending = pendingDeparture.current; pendingDeparture.current = null; setDeparture(false); pending?.resolve(leave); }, []);
  const guard = useCallback(() => {
    const life = lifetime.current; if (!life?.active || life.owner.busy() || life.links.busy() || printingRef.current) return Promise.resolve(false);
    if (!life.owner.hasUnsaved() && !life.links.uncertain()) return Promise.resolve(true);
    if (pendingDeparture.current) return pendingDeparture.current.promise;
    let resolve!: (value: boolean) => void; const promise = new Promise<boolean>(done => { resolve = done; }); pendingDeparture.current = { promise, resolve }; setDeparture(true); return promise;
  }, []);
  useLayoutEffect(() => {
    let active = true; setState(null); setLinkState(null); setDeparture(false); setPrintError("");
    if (context) { onClose(); return; }
    const api = createHonorsClient({ studentId, mode, verify: verifyServiceSession, denied: status => { if (active && lifetime.current?.active) serviceAuthorityFailed(status); } });
    const owner = createHonorsOwner(api, value => { if (active) setState(value); });
    const linkApi = createHonoreeClient({ studentId, mode, origin: window.location.origin, verify: verifyServiceSession, denied: status => { if (active && lifetime.current?.active) serviceAuthorityFailed(status); } });
    const clearSecretDOM = () => { dialog.current?.querySelectorAll<HTMLInputElement>("input[data-honoree-secret]").forEach(field => { field.value = ""; field.defaultValue = ""; field.removeAttribute("value"); }); };
    const links = createHonoreeOwner(linkApi, { honors: () => owner.state, blocked: () => printingRef.current || !!pendingDeparture.current, changed: value => { if (active) { if (!value.secret) clearSecretDOM(); setLinkState(value); } } });
    const life = { owner, links, api, active: true }; lifetime.current = life; setState(owner.state); setLinkState(links.state);
    const cleanupPrint = () => { printAbort.current?.abort(); printCleanup.current?.(); printCleanup.current = null; };
    const pauseLinks = () => { clearSecretDOM(); links.pause(); };
    const concealed = () => { if (document.visibilityState !== "visible") pauseLinks(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) pauseLinks(); };
    document.addEventListener("visibilitychange", concealed); window.addEventListener("pagehide", pauseLinks); window.addEventListener("pageshow", restored);
    const lifecycle = { pause() { owner.pause(); pauseLinks(); cleanupPrint(); }, clear() { clearSecretDOM(); cleanupPrint(); links.clear(); owner.clear(); finishDeparture(false); }, async settle() { await Promise.all([owner.settle(), links.settle()]); }, hasUnsaved() { return owner.hasUnsaved() || links.uncertain(); }, reveal() { links.resume(); } };
    const removeWork = registerWork(lifecycle), removeDeparture = registerDeparture(guard), removeReload = registerReload(async () => { if (life.active) { await owner.load(); links.resume(); } }), removeQuiet = registerQuiet(async signal => { const same = await owner.quiet(signal); if (same && !signal.aborted) links.resume(); return same; });
    void owner.load();
    return () => { active = false; life.active = false; clearSecretDOM(); cleanupPrint(); links.clear(); owner.clear(); finishDeparture(false); removeWork(); removeDeparture(); removeReload(); removeQuiet(); document.removeEventListener("visibilitychange", concealed); window.removeEventListener("pagehide", pauseLinks); window.removeEventListener("pageshow", restored); if (lifetime.current === life) lifetime.current = null; };
    // Session binding and selected student define this private owner. Practice never supplies authority.
  }, [studentId, mode, summary.sessionBinding, context?.id, verifyServiceSession, serviceAuthorityFailed, registerDeparture, registerWork, registerReload, registerQuiet, guard, finishDeparture]);
  const shown = useWorkspaceModal(dialog, true), shownRef = useRef(shown); shownRef.current = shown;
  useLayoutEffect(() => { settled.current = false; if (!shown) return; const field = lastFocus.current; (field?.isConnected && dialog.current?.contains(field) ? field : heading.current)?.focus(); settled.current = true; }, [shown]);
  useEffect(() => { if (departure) departureHeading.current?.focus(); }, [departure]);
  useEffect(() => { const unload = (event: BeforeUnloadEvent) => { const life = lifetime.current; if (life?.owner.hasUnsaved() || life?.links.uncertain()) { event.preventDefault(); event.returnValue = ""; } life?.links.pause(); }; window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload); }, []);
  async function close() { const life = lifetime.current; if (await guard() && life === lifetime.current) { life?.links.clear(); life?.owner.clear(); onClose(); } }
  function keepEditing() { if (!lifetime.current?.owner.busy() && !lifetime.current?.links.busy() && !printingRef.current) finishDeparture(false); }
  function leave() { const life = lifetime.current; if (!life?.active || life.owner.busy() || life.links.busy() || printingRef.current || !pendingDeparture.current) return; life.links.clear(); life.owner.clear(); finishDeparture(true); }
  function recover(check: boolean) { const life = lifetime.current; if (!life?.active || pendingDeparture.current || life.owner.busy() || life.links.busy() || life.links.uncertain() || printingRef.current) return; life.links.hideSecret(); void (check ? life.owner.check() : life.owner.retry()); }
  async function print() {
    const life = lifetime.current; if (!life?.active || mode !== "admin" || life.owner.busy() || life.owner.uncertain() || life.links.busy() || life.links.uncertain() || printingRef.current) return;
    life.links.hideSecret();
    printingRef.current = true; setPrinting(true); setPrintError(""); printAbort.current?.abort(); const controller = new AbortController(); printAbort.current = controller;
    try { const saved = await life.api.read(controller.signal); if (!life.active || lifetime.current !== life || controller.signal.aborted) return; printCleanup.current?.(); printCleanup.current = printSavedHonors(saved, name); }
    catch { if (life.active && !controller.signal.aborted) setPrintError("The saved form couldn’t be verified for printing. No draft was printed."); }
    finally { printingRef.current = false; if (life.active) setPrinting(false); }
  }
  const owner = lifetime.current?.owner, links = lifetime.current?.links, current = state?.current, busy = !!owner?.busy() || !!links?.busy() || printing, linkUncertain = !!links?.uncertain(), privateReady = state?.phase !== "disposed", review = !!current && !!state?.draftContext && !state.reviewed;
  const fieldStarts = new Set([...(state?.draftContext ?? current?.currentContext)?.spans.map(span => span.startVerse) ?? [], ...state?.draft.aliyot.map(group => group.startVerse) ?? []]);
  const retainedLinkStarts = [...new Set([...Object.keys(linkState?.records ?? {}).filter(start => !!linkState?.records[start]), ...(linkState?.pending ? [linkState.pending.startVerse] : [])])].filter(start => !fieldStarts.has(start));
  return <dialog ref={dialog} className={`roster-sheet ${styles.sheet}`} aria-labelledby={`${id}-title`} closedby={busy ? "none" : "closerequest"} onFocus={e => { const target = e.target as HTMLElement; if (settled.current && target !== heading.current) lastFocus.current = target; }} onCancel={e => { e.preventDefault(); if (!busy) void close(); }} onClose={() => { if (!shownRef.current) return; if (!dialog.current?.open) dialog.current?.showModal(); if (!busy) void close(); }}>
    <div className="sheet-bar"><button type="button" className="sheet-close" aria-label="Close family honors" disabled={busy} onClick={() => void close()}>{icons.close}</button></div>
    <div className={styles.body}><h2 id={`${id}-title`} className={styles.title} ref={heading} tabIndex={-1}>Family honors</h2>
      {privateReady && <p className={styles.student}><bdi dir="auto">{name}</bdi></p>}
      {current && <><p className={styles.meta}><time dateTime={current.currentContext.snapshot.ceremonyDate}>{longDate(current.currentContext.snapshot.ceremonyDate)}</time> · {slotName(current.currentContext.snapshot.serviceSlot)}</p><p className={styles.intro}>Choose who will take part, in ceremony order. You don’t need everything at once: save what you have and come back later. Changes stay in this tab until you save. Unknown Hebrew names can be left blank.</p></>}
      {(!state || state.phase === "loading") && <p role="status">Loading private family honors…</p>}
      {state?.phase === "disposed" && <p role="status">This family’s honors are no longer available in this session.</p>}
      {departure && <section className={styles.departure} aria-labelledby={`${id}-departure`}><h3 id={`${id}-departure`} tabIndex={-1} ref={departureHeading}>{owner?.uncertain() ? "Leave with the save unconfirmed?" : linkUncertain ? "Leave with the link action unconfirmed?" : "Leave your unsaved changes?"}</h3><p>{owner?.uncertain() ? "The original save may still complete. Leaving removes this tab’s receipt and retry controls and cannot cancel or undo the save." : linkUncertain ? "The original link action may still complete. Leaving removes this tab’s receipt and retry controls and cannot cancel or undo that action." : "Your changes are only in this tab. Leaving discards them."}</p><div className={styles.actions}><button type="button" className="button-primary" disabled={busy} onClick={keepEditing}>Keep editing</button><button type="button" className="button-secondary" disabled={busy} onClick={leave}>{owner?.uncertain() || linkUncertain ? "Leave without confirmation" : "Discard changes and leave"}</button></div></section>}
      {state?.error && <p role="alert" className={styles.notice}>{state.error}</p>}
      {state && ["unavailable", "conflict"].includes(state.phase) && !state.pending && <div className={styles.actions}><button type="button" className="button-secondary" disabled={busy || linkUncertain} onClick={() => { links?.hideSecret(); void owner?.load(); }}>Check current form</button><button type="button" className="button-text" disabled={busy || linkUncertain} onClick={() => { links?.hideSecret(); if (!owner?.hasUnsaved()) void owner?.discard(); else setDiscardReview(true); }}>Discard draft and reload saved form</button></div>}
      {discardReview && <section className={styles.departure}><h3>Discard this draft?</h3><p>The latest saved form will replace the unsaved names in this tab.</p><div className={styles.actions}><button className="button-secondary" type="button" disabled={busy} onClick={() => { if (!owner?.busy() && !printingRef.current) setDiscardReview(false); }}>Keep draft</button><button className="button-secondary" type="button" disabled={busy} onClick={() => { if (owner?.busy() || printingRef.current) return; setDiscardReview(false); void owner?.discard(); }}>Discard draft and reload</button></div></section>}
      {current && state && owner && <>
        {current.currentContext.unknownSlot && <p className={styles.contextNotice}>The service time is not confirmed. Ask the congregation to confirm it.</p>}
        {current.currentContext.readingNeedsReview && <p className={styles.contextNotice}>The assigned reading needs staff review. Saving honors does not confirm the reading.</p>}
        {review && <ContextReview key={current.currentContext.hash} previous={state.draftContext!} current={current.currentContext} state={state} owner={owner} blocked={busy || linkUncertain || departure} canReview={() => { if (links?.busy() || links?.uncertain() || pendingDeparture.current || printingRef.current) return false; links?.hideSecret(); return true; }} />}
        <HonorsFields draft={state.draft} context={state.draftContext ?? current.currentContext} disabled={state.phase !== "ready" || busy || linkUncertain || departure || review} onChange={draft => { if (!links?.busy() && !links?.uncertain() && !pendingDeparture.current && !printingRef.current) { links?.hideSecret(); owner.edit(draft); } }} honoree={startVerse => links && linkState && <HonoreeControls startVerse={startVerse} owner={links} state={linkState} blocked={departure || printing || !!state.pending || owner.busy() || state.phase === "unavailable" || state.phase === "disposed"} />} retainedHonoree={links && linkState && retainedLinkStarts.map(startVerse => <div key={startVerse}><p className={styles.help}>Previous aliyah link record · <bdi>{startVerse}</bdi></p><HonoreeControls startVerse={startVerse} owner={links} state={linkState} blocked={departure || printing || !!state.pending || owner.busy() || state.phase === "unavailable" || state.phase === "disposed"} /></div>)} />
      </>}
      {state?.phase === "unknown" && <div className={styles.notice}><p>We couldn’t confirm whether your honors saved. It may have saved. Check what saved before changing anything; editing is paused until then, and nothing is sent twice automatically.</p><div className={styles.actions}><button type="button" className="button-primary" disabled={departure || busy} onClick={() => recover(true)}>Check what saved</button><button type="button" className="button-text" disabled={departure || busy} onClick={() => recover(false)}>Send the same save again</button></div></div>}
      {printError && <p role="alert">{printError}</p>}
    </div>
    <footer className={styles.footer}><p role="status">{state?.phase === "saving" ? "Saving honors…" : state?.phase === "checking" ? "Checking the original save…" : state?.phase === "unknown" ? "Save not confirmed" : state?.savedNotice ? "Honors saved." : state?.dirty ? "Unsaved changes" : current?.saved ? `Saved version ${current.currentVersion}` : "No saved form yet"}</p>
      {mode === "admin" && current?.saved && <button type="button" className="button-secondary" disabled={busy || linkUncertain || !!state?.pending || departure} onClick={() => void print()}>{printing ? "Verifying saved form…" : `Print saved version ${current.currentVersion}`}</button>}
      <button type="button" className="button-primary" disabled={!state?.dirty || state.phase !== "ready" || busy || linkUncertain || review || departure} onClick={() => { if (!links?.busy() && !links?.uncertain() && !printingRef.current && !pendingDeparture.current) { links?.hideSecret(); void owner?.save(); } }}>Save honors</button>
    </footer>
  </dialog>;
}
