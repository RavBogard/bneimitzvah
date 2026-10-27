"use client";

import { useEffect, useState, type ReactNode } from "react";
import { addDays, congregationToday, isSaturday, thisShabbat } from "../../../lib/readings/public-shabbat";
import { fetchPublicWeek, type PublicWeek } from "../public-reading/api";
import { readAddress } from "../public-reading/urls";
import { InstallHint } from "../offline/install-hint";
import { SavedLine } from "../offline/status";
import { startAccountPreferences } from "../workspace/account-preferences";
import styles from "./front-door.module.css";
import { SiteBar } from "../../site/site-bar";
import type { Role } from "../api";
import { homeRole, rolePaths } from "../shell/role-home";
import { rememberedRole } from "../shell/role-memory";

/**
 * What the front door knows of the visitor: nothing while access is being checked (the Beit Mitzvah door holds its height), signed out,
 * a signed-in account with its roles, or `task`: the door shows the entry task itself (a refused account, which is signed in and so has
 * no Sign in; or sign-in that is unavailable, which keeps its Try again). `signedIn` is what the site bar shows for it, left undefined
 * when this browser's hint decides. `saved`: the account keeps saved readings, so My Readings has a shelf.
 */
export type FrontDoorAccount = null | Readonly<{ kind: "sign-in" }> | Readonly<{ kind: "account"; saved: boolean; roles: readonly Role[]; count: number | null; pinned: DoorFacts["pinned"] }> | Readonly<{ kind: "task"; signedIn: boolean | undefined }>;

/** What a signed-in person's door says. `reading` and `children` are used when the session summary carries them; it does not yet, so the fallbacks show. */
export type DoorFacts = Readonly<{
  /** The pinned reading's student, the ceremony date and how many verses are got it; from the session summary once Task E3 provides it. */
  pinned?: Readonly<{ name: string; ceremony: string; done: number; total: number }> | null;
  /** How many readings the person keeps. */
  count?: number | null;
}>;
export type SignedInDoor = Readonly<{ title: string; line: string | null; action: string }>;
/** "Sat, May 1, 2027". */
const shortDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
/** The door of a signed-in person: My Readings for every role but the admin (decisions 12 and 22), This week for the admin. */
export function signedInDoor(role: Role, facts: DoorFacts = {}): SignedInDoor {
  if (role === "admin") return { title: "This week", line: "Needs you, ceremonies and rehearsals.", action: "Open This week" };
  const line = facts.pinned ? `${facts.pinned.name} · Beit Mitzvah, ${shortDate(facts.pinned.ceremony)} · ${facts.pinned.done} of ${facts.pinned.total} verses`
    : facts.count ? `${facts.count} saved` : null;
  return { title: "Your readings", line, action: "Open My Readings" };
}
/** Whether the door leads the home, under the hero: the person keeps a reading or has one pinned (decision 22). */
export const doorLeads = (account: FrontDoorAccount): boolean => account?.kind === "account" && (account.pinned != null || (account.count ?? 0) > 0);

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
const SIGNED_OUT_LINE = "Save the readings you’re working on, mark verses, keep notes. Beit Mitzvah students and families find their assigned reading and tutor here too.";

/**
 * The "Your readings" door. Signed out: Sign in and How accounts work (the form lives on /sign-in alone). Signed in: the door of
 * the role the person was last in, else the highest. While access is checked it holds the height it takes afterwards, so the Learn door
 * and the page below do not move. An account with no role, a refused account or an unavailable sign-in keeps the entry task, passed in
 * whole (request a role, Sign out, Try again).
 */
function BeitMitzvahDoor({ account, children, place }: { account: FrontDoorAccount; children: ReactNode; place: "hero" | "doors" }) {
  const role = account?.kind === "account" ? homeRole(account.roles, rememberedRole()) : null;
  const door = role ? signedInDoor(role, account?.kind === "account" ? { pinned: account.pinned, count: account.count } : {}) : null;
  const task = account?.kind === "task" || (account?.kind === "account" && !role);
  const state = account === null ? "loading" : task ? "task" : role ? "role" : "sign-in";
  return <section id="beit-mitzvah" className={styles.door} aria-labelledby="beit-mitzvah-title" data-door="beit-mitzvah" data-door-place={place} data-door-state={state} data-door-role={role ?? undefined} aria-busy={account === null}>
    <h2 id="beit-mitzvah-title" className={styles.doorTitle}>{door ? door.title : task ? "Beit Mitzvah" : "Your readings"}</h2>
    {door ? door.line && <p className={styles.doorLine}>{door.line}</p> : <p className={styles.doorLine}>{task ? DOOR_LINE : SIGNED_OUT_LINE}</p>}
    {account === null && <p className={styles.doorWait} role="status">One moment while we check your access.</p>}
    {account?.kind === "sign-in" && <>
      <a className={`button-hero-secondary ${styles.doorAction}`} href="/sign-in" aria-describedby="beit-mitzvah-title">Sign in</a>
      <p className={styles.doorMore}><a href="/about#accounts">How accounts work</a></p>
    </>}
    {role && door && <a className={`button-hero-secondary ${styles.doorAction}`} data-testid="door-action" href={rolePaths[role]} aria-describedby="beit-mitzvah-title">{door.action}</a>}
    {task && <div className={styles.task}>{children}</div>}
  </section>;
}

/**
 * The CRC Torah home: This week, then the Beit Mitzvah door and the Learn to lein door.
 * `children` is the entry task (PortalEntry keeps every entry state and behaviour), shown in the Beit Mitzvah door only when the
 * account has no role or the door cannot say who is there.
 */
export function FrontDoor({ account, children }: { account: FrontDoorAccount; children: ReactNode }) {
  const keeps = account?.kind === "account" && account.saved, leads = doorLeads(account);
  // An account that keeps saved readings keeps this browser's preferred commentaries and reading settings too (release 1.7 M3b).
  useEffect(() => { if (keeps) startAccountPreferences(true); }, [keeps]);
  return <div className="portal-shell">
    <a className="skip-link" href="#front-door-main">Skip to main content</a>
    <SiteBar signedIn={account === null ? undefined : account.kind === "task" ? account.signedIn : account.kind === "account"} />
    <main id="front-door-main" className={styles.main}>
      <ThisWeek />
      <SavedLine />
      {leads && <BeitMitzvahDoor account={account} place="hero">{children}</BeitMitzvahDoor>}
      <div className={styles.doors}>
        {!leads && <BeitMitzvahDoor account={account} place="doors">{children}</BeitMitzvahDoor>}
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
