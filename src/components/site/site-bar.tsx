"use client";

import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BetaMark } from "./beta-mark";
import { ReturnSignInLink } from "../portal/return-sign-in-link";
import { signedInHint } from "../portal/signed-in-hint";

/**
 * The site row: the one header every page carries, signed in or out (site navigation design, PR A). The tab bar (the left rail from
 * 1000px) is the role row beneath it and is not drawn here. A link may appear in both rows.
 *
 * `site` mode: the brand, the Beta mark, Read, Learn, and Sign in or My Readings. `minimal` mode (an invitation, Connect Claude,
 * unsubscribe, the print sheet, the saved-readings shelf): the brand and Beta only, no links.
 */
export type SiteBarMode = "site" | "minimal";
export type SiteLink = "read" | "learn" | "mine";

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);
/** Which site link is the current page: Read on /read*, Learn on /learn* and the trope chart, My Readings on /mine*; nothing elsewhere (Account is reached from the shelf). */
export function currentSiteLink(pathname: string | null | undefined): SiteLink | null {
  const path = pathname ?? "";
  return under(path, "/read") ? "read" : under(path, "/learn") || under(path, "/trope-chart") ? "learn" : under(path, "/mine") ? "mine" : null;
}

/**
 * The brand mark: Siona Benjamin's CRC floor as a 28px disc (DESIGN.md, Brand mark). Decoration, so the brand link keeps the name
 * "CRC Torah"; the width and height are set so the bar does not shift while it loads. The 2x file serves dense screens.
 */
export function BrandMark() {
  // eslint-disable-next-line @next/next/no-img-element -- a 28px disc from public/brand; next/image would add a resizing hop for two fixed files
  return <img className="site-bar-mark" src="/brand/mural-64.webp" srcSet="/brand/mural-64.webp 1x, /brand/mural-128.webp 2x" width={28} height={28} alt="" decoding="async" />;
}

/** The bookmark icon the My Readings control draws (it is decoration; the control is named "My Readings"). */
export function BookmarkIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4.5L6 21V4.5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

/** The person icon the Account control draws (decoration; the control is named "Account"). The session carries no name, so there is no initial to show. */
export function PersonIcon() {
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M4.5 20.5c.8-4 3.6-6 7.5-6s6.7 2 7.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

/** This browser's "last seen signed in" hint (the same one the reader's Save uses). The server and the first client render say signed out; the hint replaces it after hydration. */
const subscribeToHint = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
const useSignedInHint = () => useSyncExternalStore(subscribeToHint, signedInHint, () => false);

export type SiteBarProps = Readonly<{
  mode?: SiteBarMode;
  /** Known signed-in state, when the page has checked it. Left out, the browser's hint decides. */
  signedIn?: boolean;
  /** The way back from Sign in, read when the link is used (the reader's own place). Left out, the address bar. */
  back?: () => string | null;
  /** A page that guards leaving (the workspace) takes over a link's click. */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** The tenant's product name on a page that shows one; otherwise "CRC Torah". */
  productName?: string | null;
  className?: string;
  /** For a test; a page leaves it out and the address decides. */
  pathname?: string | null;
}>;

export function SiteBar(props: SiteBarProps) {
  const path = usePathname(), hint = useSignedInHint();
  return <SiteBarView {...props} pathname={props.pathname !== undefined ? props.pathname : path} signedIn={props.signedIn ?? hint} />;
}

export function SiteBarView({ mode = "site", signedIn = false, back, onNavigate, productName, className, pathname }: SiteBarProps & { signedIn: boolean }) {
  const current = currentSiteLink(pathname);
  const link = (key: SiteLink, href: string, children: ReactNode, extra = "", label?: string) => <a className={`site-bar-link${extra}`} href={href} aria-label={label} aria-current={current === key ? "page" : undefined} onClick={onNavigate ? event => onNavigate(event, href) : undefined}>{children}</a>;
  return <header className={`portal-header app-bar site-bar${className ? ` ${className}` : ""}`} data-site-bar={mode}>
    <div className="portal-brand-group"><a className="portal-brand" data-testid="site-brand" href="/" onClick={onNavigate ? event => onNavigate(event, "/") : undefined}><BrandMark />{mode === "site" && signedIn ? <span className="site-bar-name">{productName ?? "CRC Torah"}</span> : (productName ?? "CRC Torah")}</a><BetaMark /></div>
    {mode === "site" && <nav className="site-bar-nav" aria-label="Site">
      {link("read", "/read", <span className="site-bar-text">Read</span>)}
      {link("learn", "/learn", <span className="site-bar-text">Learn</span>)}
      {/* The right side keeps one width whichever it shows, so the swap moves nothing. */}
      <span className="site-bar-end" data-signed-in={signedIn ? "" : undefined}>
        {signedIn ? link("mine", "/mine", <><BookmarkIcon /><span className="site-bar-text site-bar-mine-text">My Readings</span></>, " site-bar-mine", "My Readings")
          : <ReturnSignInLink className="site-bar-link" back={back}><span className="site-bar-text">Sign in</span></ReturnSignInLink>}
        {/* The Account control: a round person button in the top right of every signed-in page (the session has no name to take an initial from). */}
        {signedIn && <a className="site-bar-account" data-testid="account-button" href="/account" aria-label="Account" aria-current={pathname === "/account" ? "page" : undefined} onClick={onNavigate ? event => onNavigate(event, "/account") : undefined}><PersonIcon /></a>}
      </span>
    </nav>}
  </header>;
}
