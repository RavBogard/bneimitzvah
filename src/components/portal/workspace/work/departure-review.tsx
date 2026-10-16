"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WorkCoordinator } from "./coordinator";

export function DepartureReview({ coordinator }: { coordinator: WorkCoordinator }) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot, coordinator.snapshot);
  const review = coordinator.departure, dialog = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null), keepWorking = useRef<HTMLButtonElement>(null);
  const busy = review?.busy ?? false;
  useEffect(() => {
    if (review && !dialog.current?.open) { origin.current = document.activeElement as HTMLElement | null; dialog.current?.showModal(); }
    // showModal cannot focus a disabled control while a save is settling.
    if (review && !busy && (document.activeElement === dialog.current || !dialog.current?.contains(document.activeElement))) keepWorking.current?.focus();
    if (!review && dialog.current?.open) { dialog.current.close(); origin.current?.focus(); }
  }, [review, busy]);
  const unknown = ["torah", "haftarah"].some(kind => [...(coordinator.scope(kind as "torah" | "haftarah")?.cells.values() ?? [])].some(cell => cell.pending && cell.phase === "unknown"));
  return <dialog ref={dialog} className="work-departure" aria-labelledby="work-departure-title" aria-describedby="work-departure-help" onCancel={event => { event.preventDefault(); void coordinator.depart("cancel"); }}>
    <h2 id="work-departure-title">Review work before leaving</h2><p id="work-departure-help">{unknown ? "A request may have saved. Leaving without confirming discards the unsent and queued text in this tab." : "There is unsaved work in this reading. Save it or explicitly discard it before continuing."}</p>
    {review?.error && <p role="alert" className="request-error">{review.error}</p>}
    <div className="work-actions"><button autoFocus ref={keepWorking} className="button-secondary" disabled={review?.busy} onClick={() => void coordinator.depart("cancel")}>Keep working</button><button className="button-primary" disabled={review?.busy} onClick={() => void coordinator.depart(unknown ? "check" : "save")}>{review?.busy ? "Checking work…" : unknown ? "Check save and continue" : "Save and continue"}</button><button className="button-text" disabled={review?.busy} onClick={() => void coordinator.depart("discard")}>{unknown ? "Leave without confirming" : "Discard unsent edits and continue"}</button></div>
  </dialog>;
}
