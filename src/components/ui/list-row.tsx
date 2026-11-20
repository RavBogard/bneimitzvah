import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** Grouped rows for staff lists: one hairline surface, rows divided by hairlines. Put `ListRow`s (and only those) inside. */
export function List({ children, label, testId }: { children: ReactNode; label?: string; testId?: string }) {
  return <ul className={styles.list} aria-label={label} data-testid={testId}>{children}</ul>;
}

export type ListRowProps = {
  title: ReactNode;
  /** A second muted line: a date, a role, a count in words. */
  meta?: ReactNode;
  /** Something non-interactive at the end of the row, typically a Chip. It is read as part of the row's name. */
  trailing?: ReactNode;
  /** The row is a link. */
  href?: string;
  /** A link row that leaves the site opens in a new tab and sends no referrer. */
  external?: boolean;
  /** Opens the link in this tab with a fresh document. */
  fullDocument?: boolean;
  /** A link row that does something as it goes (the role Account remembers). Runs before the link is followed. */
  onNavigate?: () => void;
  /** The row is a button. Give neither and the row is plain text. */
  onClick?: () => void;
  /** Retains the row while an in-flight action prevents activating it. */
  disabled?: boolean;
};

/** One row, at least 56px tall. A link or button row is one 44px-plus target across its full width, with a chevron. */
export function ListRow({ title, meta, trailing, href, external, fullDocument, onNavigate, onClick, disabled }: ListRowProps) {
  const inner = <>
    <span className={styles.rowMain}><span className={styles.rowTitle}>{title}</span>{meta && <span className={styles.rowMeta}>{meta}</span>}</span>
    {trailing && <span className={styles.rowTrailing}>{trailing}</span>}
    {!disabled && (href || onClick) && <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" /></svg>}
  </>;
  return <li className={styles.item}>
    {href && disabled ? <a className={styles.row} role="link" aria-disabled="true">{inner}</a>
      : href && external ? <a href={href} className={styles.row} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{inner}</a>
      : href && fullDocument ? <a href={href} className={styles.row} onClick={onNavigate}>{inner}</a>
      : href ? <Link href={href} className={styles.row} onClick={onNavigate}>{inner}</Link>
      : onClick ? <button type="button" className={styles.row} aria-disabled={disabled || undefined} onClick={disabled ? undefined : onClick}>{inner}</button>
        : <div className={styles.row}>{inner}</div>}
  </li>;
}
