"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Assigned } from "../api";
import { statusOf, useWorkspace, useWorkspaceModal } from "../provider";
import { serviceApi, servicePlanKey, type AvailableCatalog, type Catalog, type PreparedServicePlan, type ServiceMetadata } from "./api";

export function ServicePlanEditor({ mode, studentId, baseline, metadata, onConfirmed, reloadReading, onDepartureActive }: {
  mode: "admin" | "tutor"; studentId: string; baseline: Assigned | null; metadata: ServiceMetadata | null;
  onConfirmed(): Promise<ServiceMetadata>; reloadReading(): Promise<Assigned>; onDepartureActive(active: boolean): void;
}) {
  const { registerWork, registerDeparture, guardDeparture, verifyServiceSession, serviceAuthorityFailed, concealed } = useWorkspace();
  const [catalog, setCatalog] = useState<Catalog | null>(null), [selected, setSelected] = useState<string[]>([]), [clearIntent, setClearIntent] = useState(false);
  const [review, setReview] = useState<PreparedServicePlan | null>(null), [pending, setPending] = useState<"catalog" | "prepare" | "confirm" | null>(null);
  const reviewRef = useRef(review); reviewRef.current = review;
  const [message, setMessage] = useState(""), [blocked, setBlocked] = useState(false), [paused, setPaused] = useState(false), [leaving, setLeaving] = useState(false);
  const seed = useRef<string[]>([]), seedContext = useRef(""), dirty = useRef(false), alive = useRef(true), generation = useRef(0), gate = useRef(false), skipOwnGuard = useRef(false);
  const request = useRef<AbortController | null>(null), task = useRef<Promise<void> | null>(null), pendingRef = useRef(pending); pendingRef.current = pending;
  const dialog = useRef<HTMLDialogElement>(null), departure = useRef<((leave: boolean) => void) | null>(null), reviewHeading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null), originSheet = useRef<HTMLDialogElement | null>(null), keepEditing = useRef<HTMLButtonElement>(null), catalogButton = useRef<HTMLButtonElement>(null);
  const departureState = useRef(onDepartureActive); departureState.current = onDepartureActive;
  const contextKey = baseline && metadata ? JSON.stringify([baseline.student.id, baseline.student.revision, baseline.student.ceremonyDate, servicePlanKey(metadata)]) : "";
  const context = useRef(contextKey); context.current = contextKey;
  const stale = Boolean(catalog?.state === "available" && baseline && (catalog.studentRevision !== baseline.student.revision || catalog.ceremonyDate !== baseline.student.ceremonyDate || contextKey && seedContext.current !== contextKey));
  const latest = useRef({ baseline, metadata }); latest.current = { baseline, metadata };
  const lifecycle = useRef({
    pause() { generation.current++; if (pendingRef.current !== "confirm") request.current?.abort(); setReview(null); setPaused(true); },
    clear() { generation.current++; if (pendingRef.current !== "confirm") request.current?.abort(); dirty.current = false; seed.current = []; seedContext.current = ""; setSelected([]); setCatalog(null); setReview(null); setClearIntent(false); setMessage(""); setBlocked(false); setPaused(true);
      origin.current = null; originSheet.current = null; const resolve = departure.current; departure.current = null; setLeaving(false); departureState.current(false); resolve?.(false); },
    async settle() { await task.current?.catch(() => undefined); }, hasUnsaved: () => dirty.current,
    reveal() { if (alive.current) setPaused(false); },
  });
  useLayoutEffect(() => {
    alive.current = true;
    const unregister = registerWork(lifecycle.current), unregisterGuard = registerDeparture(async () => {
      if (skipOwnGuard.current || !dirty.current) return true;
      if (departure.current) return false;
      // Capture before ReadingPanel suspends the sheet's physical modal layer.
      origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      originSheet.current = origin.current?.closest<HTMLDialogElement>("dialog.editor-sheet") ?? null;
      setLeaving(true); departureState.current(true); return new Promise<boolean>(resolve => { departure.current = resolve; });
    });
    return () => { alive.current = false; generation.current++; request.current?.abort(); departure.current?.(false); departure.current = null; origin.current = null; originSheet.current = null; departureState.current(false); unregisterGuard(); unregister(); };
  }, [registerWork, registerDeparture]);
  const visible = useWorkspaceModal(dialog, leaving);
  useEffect(() => {
    const canFocus = (node: HTMLElement | null) => Boolean(node?.isConnected && !node.matches(":disabled") && !node.closest("[hidden], [inert], dialog:not([open])") && node.getClientRects().length);
    if (visible && canFocus(keepEditing.current) && !dialog.current?.contains(document.activeElement)) keepEditing.current?.focus();
    if (!leaving && !concealed && (origin.current || originSheet.current)) {
      const opener = origin.current, sheet = originSheet.current; origin.current = null; originSheet.current = null;
      if (canFocus(opener)) opener?.focus();
      // Access revalidation may remove the old confirmation button. The same
      // retained sheet has reopened; keep its native initial focus in that case.
      else if (!sheet?.open && canFocus(catalogButton.current)) catalogButton.current?.focus();
    }
  }, [leaving, visible, concealed]);
  useEffect(() => { if (stale) setReview(null); }, [stale]);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(() => { setReview(null); setMessage("This service review expired. Prepare a new review before confirming."); }, Math.max(0, review.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  useEffect(() => {
    if (!dirty.current) return;
    const unload = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [selected, clearIntent]);
  function finishDeparture(leave: boolean) {
    if (!departure.current) return;
    if (leave) { dirty.current = false; setSelected(seed.current); setClearIntent(false); setReview(null); }
    const resolve = departure.current; departure.current = null; setLeaving(false); departureState.current(false); resolve(leave);
  }
  function edit(next: string[], explicitlyClear = false) {
    generation.current++; setSelected(next); setClearIntent(explicitlyClear || next.length === 0 && selected.length > 0); setReview(null); setMessage("");
    dirty.current = JSON.stringify(next) !== JSON.stringify(seed.current) || explicitlyClear;
  }
  async function openCatalog() {
    if (gate.current || !baseline || paused) return;
    gate.current = true; const turn = ++generation.current, controller = new AbortController(); request.current = controller; pendingRef.current = "catalog"; setPending("catalog"); setReview(null); setMessage("");
    try {
      await verifyServiceSession(controller.signal);
      const next = await serviceApi.catalog(mode, studentId, controller.signal);
      await verifyServiceSession(controller.signal);
      if (!alive.current || controller.signal.aborted || turn !== generation.current) return;
      const value = latest.current;
      if (!value.baseline || next.state === "available" && (next.studentRevision !== value.baseline.student.revision || next.ceremonyDate !== value.baseline.student.ceremonyDate || value.metadata && next.expectedPlanRevision !== (value.metadata.state === "no-plan" ? 0 : value.metadata.plan.revision))) throw Object.assign(new Error("Stale service catalog"), { stale: true });
      setCatalog(next); setBlocked(false); setClearIntent(false); dirty.current = false;
      const chosen = next.state === "available" && value.metadata?.state === "assigned" && value.metadata.plan.catalogIdentity === next.catalogIdentity ? value.metadata.units.map(unit => unit.id) : [];
      seed.current = chosen; seedContext.current = context.current; setSelected(chosen);
    } catch (error) { if (alive.current && !controller.signal.aborted && turn === generation.current) { if ([401, 403, 404].includes(statusOf(error))) serviceAuthorityFailed(statusOf(error)); else { setCatalog(null); setBlocked(true); setMessage("The catalog or student context could not be verified. Reload the current service plan before choosing parts."); } } }
    finally { gate.current = false; pendingRef.current = null; if (alive.current) setPending(null); }
  }
  async function prepare() {
    if (gate.current || catalog?.state !== "available" || !baseline || stale || blocked || paused || !selected.length && !clearIntent) return;
    gate.current = true; const turn = ++generation.current, controller = new AbortController(), selectedContext = context.current; request.current = controller;
    pendingRef.current = "prepare"; setPending("prepare"); setReview(null); setMessage("");
    try {
      await verifyServiceSession(controller.signal);
      const proposal = await serviceApi.prepare(mode, studentId, catalog, selected, controller.signal);
      await verifyServiceSession(controller.signal);
      if (!alive.current || controller.signal.aborted || turn !== generation.current || selectedContext !== context.current) return;
      setReview(proposal); queueMicrotask(() => reviewHeading.current?.focus());
    } catch (error) { if (alive.current && !controller.signal.aborted && turn === generation.current) { if ([401, 403, 404].includes(statusOf(error))) serviceAuthorityFailed(statusOf(error)); else { setBlocked(true); setMessage(statusOf(error) === 409 ? "The student or their service parts changed. Reload, then review again. Your choices are kept." : "These choices couldn’t be checked. Reload the current service parts, then review again. Your choices are kept."); } } }
    finally { gate.current = false; pendingRef.current = null; if (alive.current) setPending(null); }
  }
  async function confirm() {
    if (gate.current || !review || stale || blocked || paused || !baseline || Date.now() >= review.expiresAt) return;
    const proposal = review, selectedContext = context.current;
    skipOwnGuard.current = true; let leave = false;
    try { leave = await guardDeparture(); } finally { skipOwnGuard.current = false; }
    if (!leave || gate.current || !alive.current || selectedContext !== context.current || reviewRef.current !== proposal || Date.now() >= proposal.expiresAt) return;
    gate.current = true; const turn = ++generation.current, controller = new AbortController(); request.current = controller; pendingRef.current = "confirm"; setPending("confirm"); setReview(null); setMessage("");
    const operation = (async () => {
      try {
        await verifyServiceSession(controller.signal);
        const receipt = await serviceApi.confirm(mode, studentId, proposal.binding, controller.signal);
        await verifyServiceSession(controller.signal);
        if (!alive.current) return;
        if (turn !== generation.current || selectedContext !== context.current) throw new Error("Confirmation context changed");
        const fresh = await onConfirmed();
        if (!alive.current) return;
        if (fresh.state === "no-plan" || fresh.plan.id !== receipt.planId || fresh.plan.revision !== receipt.revision || receipt.cleared !== (fresh.state === "cleared")) throw new Error("Saved service plan differs");
        dirty.current = false; setCatalog(null); setSelected([]); seed.current = []; setClearIntent(false); setBlocked(false);
        setMessage(receipt.cleared ? "Saved. This student has no service parts now." : "Saved. These are the student’s service parts now.");
      } catch (error) { if (alive.current) { if ([401, 403, 404].includes(statusOf(error))) serviceAuthorityFailed(statusOf(error)); else { setBlocked(true); setMessage(statusOf(error) === 409 ? "The service parts changed after this review. Reload them, then review again. Your choices are kept." : "We couldn’t confirm whether this saved. It may have saved. Check what saved before continuing; nothing will be sent twice automatically."); } } }
      finally { gate.current = false; pendingRef.current = null; if (alive.current) setPending(null); }
    })();
    task.current = operation; await operation; if (task.current === operation) task.current = null;
  }
  const active = catalog?.state === "available" ? catalog : null, disabled = pending !== null || paused || !baseline;
  return <section className="service-plan-editor" aria-labelledby="service-plan-editor-heading">
    <h3 id="service-plan-editor-heading">Set service parts</h3>
    <p>Choose the parts this student will learn, check them, then save. Nothing changes for the student until you save.</p>
    <button ref={catalogButton} className="button-secondary" disabled={disabled} onClick={() => void openCatalog()}>{pending === "catalog" ? "Loading service parts…" : dirty.current || catalog ? "Discard choices and start again" : "Choose service parts"}</button>
    {catalog?.state === "unknown-slot" && <p>Set the student’s morning or Havdalah / afternoon slot before choosing service parts. Existing assigned parts remain separate.</p>}
    {catalog?.state === "unavailable" && <p>The list of service parts couldn’t be loaded. The saved service parts haven’t changed.</p>}
    {active && <>
      <p>Service: {active.serviceSlot === "morning" ? "Morning" : "Havdalah / afternoon"} · Ceremony: {active.ceremonyDate}.</p>
      {metadata?.state === "assigned" && metadata.plan.catalogIdentity !== active.catalogIdentity && <p className="field-help">The saved service parts come from an earlier list. Choose from the current list; nothing saved is replaced until you save.</p>}
      <fieldset disabled={disabled || blocked || stale}><legend>Parts to assign</legend><ul className="service-catalog-choices">{active.units.map(unit => <li key={unit.id}><label><input type="checkbox" checked={selected.includes(unit.id)} onChange={event => edit(active.units.filter(row => row.id === unit.id ? event.target.checked : selected.includes(row.id)).map(row => row.id))} /><span>{unit.name}{unit.caption && <span className="field-help service-choice-caption">{unit.caption}</span>}</span></label></li>)}</ul></fieldset>
      <div className="form-actions"><button className="button-secondary" disabled={disabled || blocked || stale || !selected.length && !clearIntent} onClick={() => void prepare()}>{pending === "prepare" ? "Checking your choices…" : "Review service parts"}</button>
        <button className="button-text" disabled={disabled || blocked || stale || !metadata || metadata.state === "no-plan" || metadata.state === "cleared"} onClick={() => edit([], true)}>Remove all service parts</button></div>
    </>}
    {stale && <p role="status" className="request-error">The student or their saved service parts changed. Your choices are kept; start again from the current list before reviewing.</p>}
    {message && <p role={blocked ? "alert" : "status"} className={blocked ? "request-error" : "field-help"}>{message}</p>}
    {blocked && <button className="button-secondary" disabled={disabled} onClick={() => void reloadReading().catch(() => undefined)}>Check what saved</button>}
    {review && active && <section className="service-plan-review" aria-labelledby="service-plan-review-heading"><h4 id="service-plan-review-heading" tabIndex={-1} ref={reviewHeading}>Check before saving</h4>
      <p><bdi dir="auto">{baseline?.student.firstName} {baseline?.student.lastName}</bdi> · Ceremony: {review.review.ceremonyDate} · {review.review.serviceSlot === "morning" ? "Morning" : "Havdalah / afternoon"}.</p>
      {review.clearsPlan ? <p>This removes every service part. The student will have none assigned.</p> : <><p>These parts will replace the student’s current service parts, in service order:</p><ol>{review.selectedIds.map(id => <li key={id}>{active.units.find(unit => unit.id === id)!.name}</li>)}</ol></>}
      <p>Nothing has changed yet.</p><button className="button-primary" disabled={disabled || blocked || stale || Date.now() >= review.expiresAt} onClick={() => void confirm()}>Save service parts</button>
    </section>}
    <dialog ref={dialog} className="work-departure" aria-labelledby="service-draft-departure-heading" onCancel={event => { event.preventDefault(); finishDeparture(false); }} onClose={() => { if (visible && !dialog.current?.open) finishDeparture(false); }}>
      <h2 id="service-draft-departure-heading">Keep this service draft?</h2><p>Your service choices have not been confirmed. Discard the draft to leave this student or role.</p>
      <div className="form-actions"><button autoFocus ref={keepEditing} className="button-secondary" onClick={() => finishDeparture(false)}>Keep editing service parts</button><button className="button-text" onClick={() => finishDeparture(true)}>Discard service draft and continue</button></div>
    </dialog>
  </section>;
}
