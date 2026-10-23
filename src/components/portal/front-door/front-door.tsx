"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicWeek, type PublicWeek } from "../public-reading/api";
import styles from "./front-door.module.css";

/** What the app bar offers on the right: nothing while access is being checked or when a signed-in account is refused, Sign in, or the signed-in account (named by its role when it has exactly one). */
export type FrontDoorAccount = null | Readonly<{ kind: "sign-in" }> | Readonly<{ kind: "account"; role: string | null }>;

const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const FALLBACK_TITLE = "This week’s reading";

/** What This week shows: nothing known yet (loading), the week, or a failure. */
export type ThisWeekState = Readonly<{ date: string | null; status: "loading" } | { date: string; status: "ready"; week: PublicWeek } | { date: string | null; status: "failed" }>;

/** This Shabbat at display scale. Lein always works, whatever the reading call did. */
export function ThisWeekView({ state }: { state: ThisWeekState }) {
  const week = state.status === "ready" ? state.week : null, loading = state.status === "loading";
  return <section className={styles.week} aria-labelledby="this-week-title" aria-busy={loading}>
    <p className={styles.eyebrow}>This Shabbat</p>
    <h1 id="this-week-title" className={styles.parashah}>
      {loading ? <><span className="sr-only">{FALLBACK_TITLE}</span><span className={styles.skeleton} aria-hidden="true" data-skeleton /></> : week?.parashah ?? FALLBACK_TITLE}
    </h1>
    {state.date && <p className={styles.meta}><time dateTime={state.date}>{longDate(state.date)}</time>
      {week?.torah && <> · Torah <bdi dir="ltr">{displayRange(week.torah.ranges)}</bdi></>}
      {week?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(week.haftarah.ranges)}</bdi></>}</p>}
    <div className={styles.actions}>
      <a className="button-start" href="/read">Lein</a>
      {/* Study returns here with the Study lens, so it never opens the same page as Lein. */}
    </div>
  </section>;
}

/** This Shabbat, from the same signed-out endpoint as /read, fetched in the browser. It never blocks the page. */
function ThisWeek() {
  const [state, setState] = useState<ThisWeekState>({ date: null, status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let date: string;
    try { date = thisShabbat(); } catch { setState({ date: null, status: "failed" }); return; }
    setState({ date, status: "loading" });
    fetchPublicWeek(date, controller.signal).then(week => { if (!controller.signal.aborted) setState({ date, status: "ready", week }); },
      () => { if (!controller.signal.aborted) setState({ date, status: "failed" }); });
    return () => controller.abort();
  }, []);
  return <ThisWeekView state={state} />;
}

/**
 * The CRC Torah home: This week, then the Beit Mitzvah door (the existing sign-in task, passed in
 * whole so every entry state and behaviour stays in PortalEntry) and the Learn to lein door.
 */
export function FrontDoor({ account, onSignIn, children }: { account: FrontDoorAccount; onSignIn: () => void; children: ReactNode }) {
  const door = useRef<HTMLElement>(null);
  return <div className="portal-shell">
    <a className="skip-link" href="#front-door-main">Skip to main content</a>
    <header className="portal-header app-bar">
      <a className="portal-brand" href="/" aria-label="CRC Torah home">CRC Torah</a>
      {account?.kind === "sign-in" && <a className="app-bar-account" href="#beit-mitzvah" onClick={event => {
        // Scroll and focus without writing a fragment into the address bar.
        event.preventDefault(); door.current?.scrollIntoView({ block: "start" }); onSignIn();
      }}>Sign in</a>}
      {account?.kind === "account" && <a className="app-bar-account" href="/account"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg><span>{account.role ? <><span className="sr-only">Account: </span>{account.role}</> : "Account"}</span></a>}
    </header>
    <main id="front-door-main" className={styles.main}>
      <ThisWeek />
      <div className={styles.doors}>
        <section id="beit-mitzvah" ref={door} className={styles.door} aria-labelledby="beit-mitzvah-title" data-door="beit-mitzvah">
          <h2 id="beit-mitzvah-title" className={styles.doorTitle}>Beit Mitzvah</h2>
          <p className={styles.doorLine}>For students, families and tutors preparing a Beit Mitzvah.</p>
          <div className={styles.task}>{children}</div>
        </section>
        <section className={styles.door} aria-labelledby="learn-title" data-door="learn">
          <h2 id="learn-title" className={styles.doorTitle}>Learn to lein</h2>
          <p className={styles.doorLine}>Hear the phrases, then lein a verse of this week's reading.</p>
          <a className={`button-start ${styles.doorAction} ${styles.doorStart}`} href="/learn" aria-describedby="learn-title">Start</a>
          <p className={styles.doorMore}><a href="/trope-chart">Trope chart</a></p>
        </section>
      </div>
    </main>
    <footer className="portal-footer"><span>Central Reform Congregation</span><span>Your account and reading stay private.</span></footer>
  </div>;
}
