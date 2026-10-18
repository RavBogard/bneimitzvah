"use client";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useWorkspaceModal } from "../../provider";
import type { SourceDeparture } from "./selection";

export function SourceDepartureReview({ review, onKeep, onLeave }: { review: SourceDeparture | null; onKeep(): void; onLeave(): void }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), origin = useRef<HTMLElement | null>(null), keep = useRef<HTMLButtonElement>(null);
  const open = review !== null && review.kind !== "none", previous = useRef(false);
  useLayoutEffect(() => { if (open && !previous.current) origin.current = document.activeElement as HTMLElement | null; previous.current = open; }, [open]);
  const visible = useWorkspaceModal(dialog, open);
  useEffect(() => {
    if (visible) keep.current?.focus();
    if (!open) { const node = origin.current; origin.current = null; if (node?.isConnected && !node.closest('[hidden], [inert], dialog:not([open])') && node.getClientRects().length) node.focus(); }
  }, [open, visible]);
  const uncertain = review?.kind === "uncertain";
  return <dialog ref={dialog} className="work-departure" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onKeep(); }}>
    <h2 id={`${id}-title`}>Leave sources?</h2>
    <p id={`${id}-help`}>{uncertain ? "This save hasn’t been confirmed. It may still complete if you leave. Unsent choices in this view will be discarded." : "Your source choices haven’t been saved. Discard them to continue, or keep working."}</p>
    <div className="work-actions"><button ref={keep} type="button" className="button-secondary" onClick={onKeep}>Keep working</button><button type="button" className="button-primary" onClick={onLeave}>{uncertain ? "Leave without confirming" : "Discard changes"}</button></div>
  </dialog>;
}
