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
import type { Role } from "../api";
import { homeRole, rolePaths } from "../shell/role-home";
import { rememberedRole } from "../shell/role-memory";
import { signInAddress } from "../../../lib/site/return-address";

/**
 * What the front door knows of the visitor: nothing while access is being checked (the Beit Mitzvah door holds its height), signed out,
 * a signed-in account with its roles, or `task`: the door shows the entry task itself (a refused account, which is signed in and so has
 * no Sign in; or sign-in that is unavailable, which keeps its Try again). `signedIn` is what the site bar shows for it, left undefined
 * when this browser's hint decides. `saved`: the account keeps saved readings, so My readings shows.
 */
export type FrontDoorAccount = null | Readonly<{ kind: "sign-in" }> | Readonly<{ kind: "account"; saved: boolean; roles: readonly Role[] }> | Readonly<{ kind: "task"; signedIn: boolean | undefined }>;

/** What a signed-in person's door says. `reading` and `children` are used when the session summary carries them; it does not yet, so the fallbacks show. */
export type DoorFacts = Readonly<{ reading?: Readonly<{ parashah: string; date: string }> | null; children?: readonly string[] }>;
export type SignedInDoor = Readonly<{ title: string; line: string | null; action: string }>;
/** "Ari", "Ari and Dana", "Ari, Dana and Eli". */
export const joinNames = (names: readonly string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
export function signedInDoor(role: Role, facts: DoorFacts = {}): SignedInDoor {
  switch (role) {
    case "student": return { title: "Your reading", line: facts.reading ? `${facts.reading.parashah} · ${longDate(facts.reading.date)}` : "Your parts and what's next.", action: "Open Today" };
    case "parent": return { title: "Your family", line: facts.children?.length ? joinNames(facts.children) : null, action: "Open Today" };
    case "tutor": return { title: "Your students", line: "Who are you teaching today?", action: "Open This week" };
    case "admin": return { title: "This week", line: "Needs you, ceremonies and rehearsals.", action: "Open This week" };
  }
}

const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const FALLBACK_TITLE = "This week’s reading";

/** What This week shows: nothing known yet (loading), the week, or a failure. On a Saturday the home leads with the Shabbat after it (`next`, 1.9 N5): the reading of the day is known to the people at the service, so what they come to the page for is the week ahead. */
export type ThisWeekState = Readonly<{ date: string | null; status: "loading" } | { date: string; status: "ready"; week: PublicWeek } | { date: string | null; status: "failed" }> & Readonly<{ next?: boolean }>;

/** This Shabbat at display scale. Lein and Study always work, whatever the reading call did. */
export function ThisWeekView({ state }: { state: ThisWeekState }) {
  const week = state.status === "ready" ? state.week : null, loading = state.status === "loading";
  return <section className={styles.week} data-testid="this-week" data-week-state={state.status === "loading" ? "pending" : state.status} data-week-which={state.next ? "next" : "this"} aria-labelledby="this-week-title" aria-busy={loading}>
    <p className={styles.eyebrow}>{state.next ? "Next Shabbat" : "This Shabbat"}</p>
    <h1 id="this-week-title" className={styles.parashah}>
      {loading ? <><span className="sr-only">{FALLBACK_TITLE}</span><span className={styles.skeleton} aria-hidden="true" data-skeleton /></> : week?.parashah ?? FALLBACK_TITLE}
    </h1>
    {state.date && <p className={styles.meta} data-testid="week-ranges"><time dateTime={state.date}>{longDate(state.date)}</time>
      {week?.torah && <> · Torah <bdi dir="ltr">{displayRange(week.torah.ranges)}</bdi></>}
      {week?.haftarah && <> · Haftarah <bdi dir="ltr">{displayRange(week.haftarah.ranges)}</bdi></>}</p>}
    <div className={styles.actions}>
      <a className="button-start" href={state.next && state.date ? readAddress({ mode: "week", date: state.date, kind: null }) : "/read"}>Lein</a>
      <a className="button-hero-secondary" href={state.next && state.date ? readAddress({ mode: "week", date: state.date, kind: null }, { study: true }) : "/read?lens=study"}>Study</a>
      {state.next && <a className="button-hero-secondary" data-testid="this-shabbat-link" href="/read">This Shabbat</a>}
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

const DOOR_LINE = "For students, families and tutors preparing a Beit Mitzvah.";

/**
 * The Beit Mitzvah door. Signed out: Sign in and the way to ask for an account (the form lives on /sign-in alone). Signed in: the door of
 * the role the person was last in, else the highest. While access is checked it holds the height it takes afterwards, so the Learn door
 * and the page below do not move. An account with no role, a refused account or an unavailable sign-in keeps the entry task, passed in
 * whole (request a role, Sign out, Try again).
 */
function BeitMitzvahDoor({ account, children }: { account: FrontDoorAccount; children: ReactNode }) {
  const role = account?.kind === "account" ? homeRole(account.roles, rememberedRole()) : null;
  const door = role ? signedInDoor(role) : null;
  const task = account?.kind === "task" || (account?.kind === "account" && !role);
  const state = account === null ? "loading" : task ? "task" : role ? "role" : "sign-in";
  return <section id="beit-mitzvah" className={styles.door} aria-labelledby="beit-mitzvah-title" data-door="beit-mitzvah" data-door-state={state} data-door-role={role ?? undefined} aria-busy={account === null}>
    <h2 id="beit-mitzvah-title" className={styles.doorTitle}>{door ? door.title : "Beit Mitzvah"}</h2>
    {door ? door.line && <p className={styles.doorLine}>{door.line}</p> : <p className={styles.doorLine}>{DOOR_LINE}</p>}
    {account === null && <p className={styles.doorWait} role="status">One moment while we check your access.</p>}
    {account?.kind === "sign-in" && <>
      <a className={`button-hero-secondary ${styles.doorAction}`} href="/sign-in" aria-describedby="beit-mitzvah-title">Sign in</a>
      <p className={styles.doorMore}><a href={signInAddress("/account")}>Ask for an account</a></p>
    </>}
    {role && door && <a className={`button-hero-secondary ${styles.doorAction}`} data-testid="door-action" href={rolePaths[role]} aria-describedby="beit-mitzvah-title">{door.action}</a>}
    {task && <div className={styles.task}>{children}</div>}
  </section>;
}

/**
 * The CRC Torah home: This week, My readings for an account that keeps them, then the Beit Mitzvah door and the Learn to lein door.
 * `children` is the entry task (PortalEntry keeps every entry state and behaviour), shown in the Beit Mitzvah door only when the
 * account has no role or the door cannot say who is there.
 */
export function FrontDoor({ account, children }: { account: FrontDoorAccount; children: ReactNode }) {
  const keeps = account?.kind === "account" && account.saved;
  // An account that keeps saved readings keeps this browser's preferred commentaries and reading settings too (release 1.7 M3b).
  useEffect(() => { if (keeps) startAccountPreferences(true); }, [keeps]);
  return <div className="portal-shell">
    <a className="skip-link" href="#front-door-main">Skip to main content</a>
    <SiteBar signedIn={account === null ? undefined : account.kind === "task" ? account.signedIn : account.kind === "account"} />
    <main id="front-door-main" className={styles.main}>
      <ThisWeek />
      <SavedLine />
      {account?.kind === "account" && account.saved && <MyReadings />}
      <div className={styles.doors}>
        <BeitMitzvahDoor account={account}>{children}</BeitMitzvahDoor>
        <section className={styles.door} aria-labelledby="learn-title" data-door="learn">
          <h2 id="learn-title" className={styles.doorTitle}>Learn to lein</h2>
          <p className={styles.doorLine} data-testid="learn-door-line">Hear the phrases, then lein a verse of this week's reading.</p>
          <a className={`button-hero-secondary ${styles.doorAction}`} href="/learn" aria-describedby="learn-title">Start</a>
          <p className={styles.doorMore}><a href="/trope-chart">Trope chart</a></p>
        </section>
      </div>
      <InstallHint place="front-door" />
    </main>
  </div>;
}
