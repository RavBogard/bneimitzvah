"use client";

import { useEffect, useState, type ReactNode } from "react";
import { addDays, congregationToday, isSaturday, thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicWeek, type PublicWeek } from "../public-reading/api";
import { readAddress } from "../public-reading/urls";
import { MyReadings } from "../saved/my-readings";
import { InstallHint } from "../offline/install-hint";
import { SavedLine } from "../offline/status";
import { startAccountPreferences } from "../workspace/account-preferences";
import styles from "./front-door.module.css";
import { SiteBar } from "../../site/site-bar";

/** What the front door knows of the visitor: nothing while access is being checked or when a signed-in account is refused (the site bar then uses this browser's hint), signed out, or a signed-in account. `saved`: the account keeps saved readings, so My readings shows. */
export type FrontDoorAccount = null | Readonly<{ kind: "sign-in" }> | Readonly<{ kind: "account"; saved: boolean }>;

const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const FALLBACK_TITLE = "This week’s reading";

/** What This week shows: nothing known yet (loading), the week, or a failure. On a Saturday the home leads with the Shabbat after it (`next`, 1.9 N5): the reading of the day is known to the people at the service, so what they come to the page for is the week ahead. */
export type ThisWeekState = Readonly<{ date: string | null; status: "loading" } | { date: string; status: "ready"; week: PublicWeek } | { date: string | null; status: "failed" }> & Readonly<{ next?: boolean }>;

/** This Shabbat at display scale. Lein and Study always work, whatever the reading call did. */
export function ThisWeekView({ state }: { state: ThisWeekState }) {
  const week = state.status === "ready" ? state.week : null, loading = state.status === "loading";
  return <section className={styles.week} aria-labelledby="this-week-title" aria-busy={loading}>
    <p className={styles.eyebrow}>{state.next ? "Next Shabbat" : "This Shabbat"}</p>
    <h1 id="this-week-title" className={styles.parashah}>
      {loading ? <><span className="sr-only">{FALLBACK_TITLE}</span><span className={styles.skeleton} aria-hidden="true" data-skeleton /></> : week?.parashah ?? FALLBACK_TITLE}
    </h1>
    {state.date && <p className={styles.meta}><time dateTime={state.date}>{longDate(state.date)}</time>
      {week?.torah && <> · Torah <bdi dir="ltr">{displayRange(week.torah.ranges)}</bdi></>}
      {week?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(week.haftarah.ranges)}</bdi></>}</p>}
    <div className={styles.actions}>
      <a className="button-start" href={state.next && state.date ? readAddress({ mode: "week", date: state.date, kind: null }) : "/read"}>Lein</a>
      <a className="button-hero-secondary" href={state.next && state.date ? readAddress({ mode: "week", date: state.date, kind: null }, { study: true }) : "/read?lens=study"}>Study</a>
      {state.next && <a className="button-hero-secondary" href="/read">This Shabbat</a>}
    </div>
  </section>;
}

/** This Shabbat, from the same signed-out endpoint as /read, fetched in the browser. It never blocks the page. */
function ThisWeek() {
  const [state, setState] = useState<ThisWeekState>({ date: null, status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let date: string, next = false;
    try { const today = congregationToday(); next = isSaturday(today); date = next ? addDays(today, 7) : thisShabbat(); } catch { setState({ date: null, status: "failed" }); return; }
    setState({ date, status: "loading", next });
    fetchPublicWeek(date, controller.signal).then(week => { if (!controller.signal.aborted) setState({ date, status: "ready", week, next }); },
      () => { if (!controller.signal.aborted) setState({ date, status: "failed", next }); });
    return () => controller.abort();
  }, []);
  return <ThisWeekView state={state} />;
}

/**
 * The CRC Torah home: This week, My readings for an account that keeps them, then the Beit Mitzvah door (the existing sign-in task, passed in
 * whole so every entry state and behaviour stays in PortalEntry) and the Learn to lein door.
 */
export function FrontDoor({ account, children }: { account: FrontDoorAccount; children: ReactNode }) {
  const keeps = account?.kind === "account" && account.saved;
  // An account that keeps saved readings keeps this browser's preferred commentaries and reading settings too (release 1.7 M3b).
  useEffect(() => { if (keeps) startAccountPreferences(true); }, [keeps]);
  return <div className="portal-shell">
    <a className="skip-link" href="#front-door-main">Skip to main content</a>
    <SiteBar signedIn={account === null ? undefined : account.kind === "account"} />
    <main id="front-door-main" className={styles.main}>
      <ThisWeek />
      <SavedLine />
      {account?.kind === "account" && account.saved && <MyReadings />}
      <div className={styles.doors}>
        <section id="beit-mitzvah" className={styles.door} aria-labelledby="beit-mitzvah-title" data-door="beit-mitzvah">
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
      <InstallHint place="front-door" />
    </main>
  </div>;
}
