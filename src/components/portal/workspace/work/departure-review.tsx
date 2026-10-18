"use client";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { WorkCoordinator } from "./coordinator";
import { useWorkspaceModal } from "../provider";

export function DepartureReview({ coordinator }: { coordinator: WorkCoordinator }) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot, coordinator.snapshot);
  const review = coordinator.departure, dialog = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null), keepWorking = useRef<HTMLButtonElement>(null);
  const busy = review?.busy ?? false;
  const reviewing = useRef(false);
  // Capture the opener before the parent suspends the editor's modal layer.
  useLayoutEffect(() => {
    if (review && !reviewing.current) origin.current = document.activeElement as HTMLElement | null;
    reviewing.current = Boolean(review);
  }, [review]);
  const visible = useWorkspaceModal(dialog, Boolean(review));
  useEffect(() => {
    // showModal cannot focus a disabled control while a save is settling.
    if (visible && !busy && (document.activeElement === dialog.current || !dialog.current?.contains(document.activeElement))) keepWorking.current?.focus();
    if (!review) {
      const opener = origin.current; origin.current = null;
      // The retained sheet has reopened by now. Never focus a concealed,
      // revoked, disconnected or still-closed dialog control.
      if (opener?.isConnected && !opener.closest('[hidden], [inert]') && opener.getClientRects().length && !opener.closest('dialog:not([open])')) opener.focus();
    }
  }, [review, busy, visible]);
  const unknown = ["torah", "haftarah"].some(kind => [...(coordinator.scope(kind as "torah" | "haftarah")?.cells.values() ?? [])].some(cell => cell.pending && cell.phase === "unknown"));
  return <dialog ref={dialog} className="work-departure" aria-labelledby="work-departure-title" aria-describedby="work-departure-help" onCancel={event => { event.preventDefault(); void coordinator.depart("cancel"); }}>
    <h2 id="work-departure-title">Review work before leaving</h2><p id="work-departure-help">{unknown ? "A request may have saved. Leaving without confirming discards the unsent and queued text in this tab." : "There is unsaved work in this reading. Save it or explicitly discard it before continuing."}</p>
    {review?.error && <p role="alert" className="request-error">{review.error}</p>}
    <div className="work-actions"><button autoFocus ref={keepWorking} className="button-secondary" disabled={review?.busy} onClick={() => void coordinator.depart("cancel")}>Keep working</button><button className="button-primary" disabled={review?.busy} onClick={() => void coordinator.depart(unknown ? "check" : "save")}>{review?.busy ? "Checking work…" : unknown ? "Check what saved and continue" : "Save and continue"}</button><button className="button-text" disabled={review?.busy} onClick={() => void coordinator.depart("discard")}>{unknown ? "Leave without confirming" : "Discard unsent edits and continue"}</button></div>
  </dialog>;
}
