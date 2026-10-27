import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

/** Grouped rows for staff lists: one hairline surface, rows divided by hairlines. Put `ListRow`s (and only those) inside. */
export function List({ children, label }: { children: ReactNode; label?: string }) {
  return <ul className={styles.list} aria-label={label}>{children}</ul>;
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
  /** A link row that does something as it goes (the role Account remembers). Runs before the link is followed. */
  onNavigate?: () => void;
  /** The row is a button. Give neither and the row is plain text. */
  onClick?: () => void;
};

/** One row, at least 56px tall. A link or button row is one 44px-plus target across its full width, with a chevron. */
export function ListRow({ title, meta, trailing, href, external, onNavigate, onClick }: ListRowProps) {
  const inner = <>
    <span className={styles.rowMain}><span className={styles.rowTitle}>{title}</span>{meta && <span className={styles.rowMeta}>{meta}</span>}</span>
    {trailing && <span className={styles.rowTrailing}>{trailing}</span>}
    {(href || onClick) && <svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" /></svg>}
  </>;
  return <li className={styles.item}>
    {href && external ? <a href={href} className={styles.row} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{inner}</a>
      : href ? <Link href={href} className={styles.row} onClick={onNavigate}>{inner}</Link>
      : onClick ? <button type="button" className={styles.row} onClick={onClick}>{inner}</button>
        : <div className={styles.row}>{inner}</div>}
  </li>;
}
