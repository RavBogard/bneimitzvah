import type { ReactNode } from "react";
import { crcSiddurPageLink } from "../../lib/siddur/pages";

/** A link into the siddur reader: its own tab, with no opener and no referrer. */
export function SiddurLink({ href, children, className = "button-text" }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>;
}

/**
 * A link to a printed page of the CRC book, or nothing at all when the page is missing or `siddurUrl` is not the
 * recognised reader, so a broken link is never drawn. `block` wraps it in its own paragraph; otherwise a space leads it.
 */
export function SiddurPageLink({ siddurUrl, page, block, children }: { siddurUrl: string; page: number | undefined; block?: boolean; children: ReactNode }) {
  const href = crcSiddurPageLink(siddurUrl, page); if (!href) return null;
  const link = <SiddurLink href={href}>{children}</SiddurLink>;
  return block ? <p>{link}</p> : <> {link}</>;
}
