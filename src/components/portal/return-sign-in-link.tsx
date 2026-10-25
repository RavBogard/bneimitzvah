"use client";
import { useRef, type ReactNode } from "react";
import { currentReturnAddress, signInAddress } from "../../lib/site/return-address";

/**
 * A Sign in link that comes back to this page (release 1.9 N20). The reader rewrites its own address as the person
 * moves (another week, Study, a verse), so the way back is read when the link is used, not when it was drawn: `back`
 * names it (the page's address with the reader's place), or else the address bar. Whatever it names is checked as a
 * return address; anything refused is a plain /sign-in.
 */
export function ReturnSignInLink({ className, back, children }: { className?: string; back?: () => string | null; children: ReactNode }) {
  const link = useRef<HTMLAnchorElement>(null);
  const update = () => {
    let address: string | null = null;
    try { address = back ? back() : currentReturnAddress(); } catch { address = null; }
    if (link.current) link.current.href = signInAddress(address);
  };
  return <a ref={link} className={className} href="/sign-in" onPointerDown={update} onFocus={update} onMouseEnter={update} onClick={update}>{children}</a>;
}
