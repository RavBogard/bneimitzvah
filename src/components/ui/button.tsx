"use client";
import Link from "next/link";
import { useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode, type Ref } from "react";
import { cx } from "./cx";
import { Sheet } from "./sheet";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

/** The words and the action of the sheet a destructive button opens. Every word is the caller's. */
export type ConfirmSpec = {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Runs once, after the person has chosen the confirm action. The sheet stays up (and cannot be dismissed) until it settles. */
  onConfirm: () => void | Promise<void>;
};

type Shared = { variant?: ButtonVariant; block?: boolean };
type ButtonBase = Shared & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "onClick"> & { ref?: Ref<HTMLButtonElement> };
export type ButtonProps =
  | (ButtonBase & { destructive?: false; confirm?: never; onClick?: MouseEventHandler<HTMLButtonElement> })
  // A destructive button never acts on its own click: it opens the confirm sheet, and only that sheet's confirm action runs.
  | (ButtonBase & { destructive: true; confirm: ConfirmSpec; onClick?: never });

const classes = (variant: ButtonVariant, block: boolean | undefined, destructive: boolean | undefined) =>
  cx(styles.button, styles[variant], destructive && styles.destructive, block && styles.block);

/**
 * The one button, in three variants: primary (the step forward), secondary, quiet (text-weight, still a 44px target).
 * `destructive` styles it with the danger tone and routes its click through a confirm Sheet. The label is the word that
 * pairs the danger tone, so it is required text, never an icon.
 */
export function Button(props: ButtonProps) {
  const { variant = "secondary", block, destructive, confirm, onClick, type = "button", ...rest } = props;
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  async function confirmed() {
    if (!confirm || busy) return;
    setBusy(true);
    try { await confirm.onConfirm(); } finally { setBusy(false); setAsking(false); }
  }
  return <>
    <button {...rest} type={type} className={classes(variant, block, destructive)} onClick={destructive ? () => setAsking(true) : onClick} aria-haspopup={destructive ? "dialog" : undefined} />
    {destructive && confirm && <Sheet open={asking} onClose={() => { if (!busy) setAsking(false); }} title={confirm.title} dismissible={!busy} initialFocus={cancel}
      footer={<>
        <button ref={cancel} type="button" className={classes("secondary", false, false)} onClick={() => setAsking(false)} disabled={busy}>{confirm.cancelLabel}</button>
        <button type="button" className={classes("primary", false, true)} onClick={() => void confirmed()} disabled={busy} aria-busy={busy || undefined}>{confirm.confirmLabel}</button>
      </>}>
      {confirm.description && <div>{confirm.description}</div>}
    </Sheet>}
  </>;
}

export type ButtonLinkProps = Shared & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "style" | "href"> & { href: string };
/** The same button as a link, for a step that goes somewhere. */
export function ButtonLink({ variant = "secondary", block, href, ...rest }: ButtonLinkProps) {
  return <Link {...rest} href={href} className={classes(variant, block, false)} />;
}
