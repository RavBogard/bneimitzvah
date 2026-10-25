"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useMemo, useState, type MouseEvent, type ReactElement } from "react";
import type { Role } from "../api";
import { rememberedRole, rememberRole } from "./role-memory";
import { isTextField, keyboardIsOpen, roleOfPath, shellRole, tabsFor, type ShellTab, type TabIcon } from "./tabs";
import styles from "./shell.module.css";

/** The nav's id, so the skip link can land on it. */
export const TAB_BAR_ID = "shell-tabs";

const draw = (children: ReactElement) => <svg className={styles.icon} viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">{children}</svg>;
const icons: Record<TabIcon, ReactElement> = {
  today: draw(<><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>),
  reading: draw(<><path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z" /><path d="M12 6v13.5" /></>),
  learn: draw(<><path d="M2.5 9.5L12 5l9.5 4.5L12 14z" /><path d="M6.5 11.5v4.5c1.5 1.6 3.4 2.4 5.5 2.4s4-.8 5.5-2.4v-4.5" /></>),
  account: draw(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></>),
  practice: draw(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>),
  honors: draw(<><circle cx="12" cy="9" r="5" /><path d="M8.7 13.3L7.5 21l4.5-2.5 4.5 2.5-1.2-7.7" /></>),
  week: draw(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  students: draw(<><path d="M9.5 7H20M9.5 12H20M9.5 17H20" /><circle cx="4.5" cy="7" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="17" r="1" /></>),
  lessons: draw(<><path d="M6 3.5h9l3.5 3.5V20.5H6z" /><path d="M14.5 3.5V7.5h4M9 12h6M9 15.5h6" /></>),
  people: draw(<><circle cx="8.5" cy="8" r="3" /><circle cx="16" cy="9" r="2.5" /><path d="M2.5 19c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5M15 14.8c2.7-.2 4.6 1.2 5.5 4.2" /></>),
  more: draw(<><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>),
};

/** True while the on-screen keyboard is open: the bar steps out of the way of a field being typed in, and only then. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const check = () => setOpen(keyboardIsOpen({ layoutHeight: window.innerHeight, visibleHeight: viewport?.height ?? window.innerHeight, textFieldFocused: isTextField(document.activeElement) }));
    // The viewport settles a moment after focus moves, so a focus change is checked again once it has.
    const soon = () => { check(); window.setTimeout(check, 250); };
    check();
    viewport?.addEventListener("resize", check); window.addEventListener("focusin", soon); window.addEventListener("focusout", soon);
    return () => { viewport?.removeEventListener("resize", check); window.removeEventListener("focusin", soon); window.removeEventListener("focusout", soon); };
  }, []);
  return open;
}

export type TabBarProps = {
  roles: readonly Role[];
  /** The child open in Practice in this tab, so a parent's Practice returns to them. */
  practiceStudentId?: string | null;
  /** Lets the workspace check for unsent work before it leaves. Given none, a tab is a plain link. */
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
};

function Tabs({ roles, practiceStudentId, onNavigate }: TabBarProps) {
  const pathname = usePathname(), search = useSearchParams(), keyboard = useKeyboardOpen();
  const pageRole = roleOfPath(pathname);
  useEffect(() => { if (pageRole) rememberRole(pageRole); }, [pageRole]);
  const role = shellRole(pathname, roles, pageRole ? null : rememberedRole());
  const tabs = useMemo<ShellTab[]>(() => role ? tabsFor({ role, pathname, tab: search.get("tab"), practiceStudentId }) : [], [role, pathname, search, practiceStudentId]);
  const [bar, setBar] = useState<HTMLElement | null>(null);
  // The bar's real height (it grows with larger text) is what the page keeps clear at its foot.
  useLayoutEffect(() => {
    if (!bar || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement, measure = () => root.style.setProperty("--shell-bar-h", `${bar.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(bar);
    return () => { observer.disconnect(); root.style.removeProperty("--shell-bar-h"); };
  }, [bar]);
  if (!role) return null;
  return <nav ref={setBar} id={TAB_BAR_ID} tabIndex={-1} className={styles.bar} aria-label="Workspace" data-hidden={keyboard ? "" : undefined} data-shell-tabs>
    <ul className={styles.list}>{tabs.map(tab => <li key={tab.key} className={styles.item}>
      <Link href={tab.href} className={styles.tab} aria-current={tab.current ? "page" : undefined} prefetch={false} onClick={onNavigate ? event => { if (!event.button && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate(event, tab.href); } : undefined}>
        {icons[tab.icon]}<span className={styles.label}>{tab.label}</span>
      </Link>
    </li>)}</ul>
  </nav>;
}

/** The bottom tab bar on a phone and the left rail from 1000px: the one way between a signed-in role's areas. Renders nothing for an account with no role. */
export function TabBar(props: TabBarProps) {
  return props.roles.length ? <Suspense fallback={null}><Tabs {...props} /></Suspense> : null;
}

/** For a keyboard user: one link from the top of the page to the tabs. Renders with the bar, or not at all. */
export function TabSkipLink({ roles }: { roles: readonly Role[] }) {
  return roles.length ? <a className="skip-link" href={`#${TAB_BAR_ID}`}>Skip to workspace tabs</a> : null;
}
