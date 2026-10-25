"use client";
import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import styles from "./ui.module.css";

export type SheetProps = {
  open: boolean;
  /** Asked for by Esc, a tap outside, a swipe down or the close button. The sheet never closes itself: the owner sets `open`. */
  onClose: () => void;
  /** The sheet's name. It is the heading, and it names the dialog for assistive technology. */
  title: string;
  children: ReactNode;
  /** Actions, in reading order; they stay in view while the body scrolls. */
  footer?: ReactNode;
  /** The close button's accessible name. Leave it out only when the footer carries a clearly named close action. */
  closeLabel?: string;
  /** False while something is saving: Esc, a tap outside and a swipe are ignored. */
  dismissible?: boolean;
  /** Where focus goes when the sheet closes. Default: whatever had focus when it opened (a word, a row, a button). */
  returnFocusTo?: () => HTMLElement | null | undefined;
  /** What takes focus when it opens. Default: the heading, so a reader hears the sheet's name first. */
  initialFocus?: RefObject<HTMLElement | null>;
};

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(node => !node.hasAttribute("disabled") && node.getAttribute("aria-hidden") !== "true" && node.getClientRects().length > 0);
}

/**
 * The one bottom sheet. A native modal dialog, so the page behind it is inert and Esc is a cancel; on top of that the
 * focus trap wraps Tab in both directions, focus returns to where it came from, and a swipe down on the header dismisses.
 * Text is all props. It rises from the bottom at every width, and the rise snaps under prefers-reduced-motion.
 */
export function Sheet({ open, onClose, title, children, footer, closeLabel, dismissible = true, returnFocusTo, initialFocus }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null), opener = useRef<HTMLElement | null>(null);
  const drag = useRef<{ y: number; at: number; id: number } | null>(null);
  const id = useId();
  // Latest props, read by handlers that outlive a render.
  const live = useRef({ open, onClose, dismissible, returnFocusTo, initialFocus });
  useEffect(() => { live.current = { open, onClose, dismissible, returnFocusTo, initialFocus }; });

  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    node.style.removeProperty("--sheet-drag");
    if (!node.open) node.showModal();
    (live.current.initialFocus?.current ?? heading.current)?.focus({ preventScroll: true });
    return () => {
      if (node.open) node.close();
      const back = live.current.returnFocusTo?.() ?? opener.current;
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open]);

  function trap(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab" || !dialog.current) return;
    const items = focusables(dialog.current), first = items[0], last = items.at(-1), at = document.activeElement;
    if (!first || !last) { event.preventDefault(); heading.current?.focus(); return; }
    if (event.shiftKey && (at === first || at === heading.current || at === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus(); }
  }

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!dismissible || (event.pointerType === "mouse" && event.button !== 0) || (event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    drag.current = { y: event.clientY, at: event.timeStamp, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    dialog.current?.style.setProperty("--sheet-drag", `${Math.max(0, event.clientY - drag.current.y)}px`);
  }
  function up(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    const distance = Math.max(0, event.clientY - start.y), speed = distance / Math.max(1, event.timeStamp - start.at);
    if (distance > 96 || (distance > 24 && speed > 0.6)) onClose();
    else dialog.current?.style.removeProperty("--sheet-drag");
  }

  return <dialog ref={dialog} className={styles.sheet} aria-labelledby={`${id}-title`}
    onKeyDown={trap}
    onCancel={event => { event.preventDefault(); if (dismissible) onClose(); }}
    // A tap on the backdrop lands on the dialog element itself; the panel's own content never does.
    onClick={event => { if (event.target === event.currentTarget && dismissible) onClose(); }}
    // The browser closed it (not us): ask the owner to agree, unless it has already been reopened.
    onClose={() => { if (live.current.open && !dialog.current?.open) live.current.onClose(); }}>
    <div className={styles.grab} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <span className={styles.handle} aria-hidden="true" />
      <div className={styles.headrow}>
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className={styles.title}>{title}</h2>
        {closeLabel && <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>}
      </div>
    </div>
    <div className={styles.sheetBody}>{open ? children : null}</div>
    {footer && open && <div className={styles.footer}>{footer}</div>}
  </dialog>;
}
