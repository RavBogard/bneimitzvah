"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SiteBarView } from "../../site/site-bar";
import { Button, Chip, List, ListRow, PageHeader } from "../../ui";
import { ThisWeekView, SIGNED_OUT_LINE } from "../front-door/front-door";
import doorStyles from "../front-door/front-door.module.css";
import shelfStyles from "../mine/shelf.module.css";
import { rolePaths } from "../shell/role-home";
import { StudyHebrew, TikkunVerse } from "../workspace/study/annotations";
import { usePreviewAccess } from "./access";
import { SAMPLE_DATE, SAMPLE_DATE_LABEL, SAMPLE_NOTE, SAMPLE_PORTION, SAMPLE_RANGE, SAMPLE_STUDENT, SAMPLE_VERSES, SAMPLE_WEEK } from "./sample";
import styles from "./preview.module.css";

const ROLES = { admin: "Admin", tutor: "Tutor", student: "Student", parent: "Parent", public: "Signed out" } as const;
type Role = keyof typeof ROLES;
type Screen = "home" | "reading" | "practice" | "study" | "learn" | "sign-in" | "find" | "account" | "shelf" | "manage";

export function RolePreview() {
  const { access, opened, retry } = usePreviewAccess();
  const ready = access === "ready";
  return <>
    <a className="skip-link" href="#role-preview-main">Skip to main content</a>
    <main id="role-preview-main" className={styles.main} tabIndex={-1}>
      <header className={styles.banner} aria-label="Preview mode">
        <div>
          <Chip tone="attention">Preview mode</Chip>
          <p>{ready ? "Sample data only. Your account stays signed in as admin." : "Sample data only."}</p>
        </div>
        <a className="button-secondary" href={rolePaths.admin}>Return to admin workspace</a>
      </header>
      {!ready && <section className={styles.screen} role="status">
        <PageHeader title={access === "checking" ? "Checking admin access" : access === "denied" ? "Admin access required" : access === "expired" ? "Your admin session changed" : "Admin access could not be checked"} />
        {access === "unavailable" && <Button onClick={retry}>Try again</Button>}
      </section>}
      {opened && access !== "expired" && access !== "denied" && <div hidden={!ready}><SampleWorkspace /></div>}
    </main>
  </>;
}

function SampleWorkspace() {
  const [role, setRole] = useState<Role>("admin");
  const [screen, setScreen] = useState<Screen>("home");
  const [got, setGot] = useState<ReadonlySet<string>>(() => new Set());
  const title = useRef<HTMLHeadingElement>(null);
  const focus = useRef(false);

  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    title.current?.focus();
  }, [role, screen]);

  function go(next: Screen) {
    if (screen === next) return;
    focus.current = true;
    setScreen(next);
  }

  function switchRole(next: Role) {
    if (role === next) { go("home"); return; }
    // Keep focus in the role selector so it stays easy to compare views.
    setRole(next);
    setScreen("home");
  }

  function toggle(ref: string) {
    setGot(current => {
      const next = new Set(current);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  const practice = <Button variant="primary" onClick={() => go("practice")}>Practice</Button>;
  const staff = role === "admin" || role === "tutor";
  const detail = role === "student" ? "Your reading" : SAMPLE_STUDENT;
  const heading = (titleText: string, description?: ReactNode) => <PageHeader title={titleText} description={description} titleRef={title} />;
  const back = (to: Screen, label: string) => <Button variant="quiet" onClick={() => go(to)}>{label}</Button>;
  let content: ReactNode;

  if (screen === "practice" || screen === "study") {
    const study = screen === "study";
    content = <>
      {back(role === "public" ? "home" : "reading", role === "public" ? "Back to home" : "Back to reading")}
      {heading(study ? "Study Torah" : "Practice", `${SAMPLE_PORTION} · Aliyah 1 · ${SAMPLE_RANGE}`)}
      <SampleText practice={!study && role === "student"} got={got} onToggle={toggle} />
    </>;
  } else if (screen === "reading") {
    content = <>
      {back("home", role === "admin" ? "Back to This week" : "Back to My Readings")}
      <PageHeader title={detail} titleRef={title} description={<><bdi>{SAMPLE_PORTION} · Torah {SAMPLE_RANGE}</bdi> · <time dateTime={SAMPLE_DATE}>{SAMPLE_DATE_LABEL}</time></>}
        actions={staff && <Button onClick={() => go("manage")}>Manage reading</Button>} />
      <section className={shelfStyles.card} aria-labelledby="sample-aliyah">
        <h2 id="sample-aliyah" className={shelfStyles.cardTitle}>Aliyah 1</h2>
        <p className={styles.meta}>{SAMPLE_RANGE}</p>
        <div>{practice}</div>
      </section>
      {role !== "student" && <section className={shelfStyles.section} aria-labelledby="sample-lesson">
        <h2 id="sample-lesson" className={shelfStyles.sectionTitle}>Before next time</h2>
        <p>{SAMPLE_NOTE}</p>
      </section>}
    </>;
  } else if (screen === "manage") {
    content = <>
      {back("reading", "Back to reading")}
      {heading("Manage reading", `${SAMPLE_STUDENT} · ${SAMPLE_PORTION}`)}
      <List label="Current reading setup">
        <ListRow title="Divisions" meta="Aliyah 1" />
        <ListRow title="Verses" meta={SAMPLE_RANGE} />
      </List>
      <p className={styles.meta}>Staff can edit divisions and verses on a live assignment.</p>
    </>;
  } else if (screen === "account") {
    content = <>
      {back("home", "Back to workspace")}
      {heading("Account", "Sample account")}
      <List label="Account details"><ListRow title="Role" meta={ROLES[role]} /></List>
    </>;
  } else if (screen === "shelf") {
    content = <>
      {back("home", role === "admin" ? "Back to This week" : "Back to My Students")}
      {heading("My Readings")}
      <List label="Your readings"><ListRow title={SAMPLE_PORTION} meta={SAMPLE_RANGE} onClick={() => go("reading")} /></List>
    </>;
  } else if (screen === "sign-in" || screen === "learn" || screen === "find") {
    const name = screen === "sign-in" ? "Sign in" : screen === "learn" ? "Learn to lein" : "Find a reading";
    content = <>
      {back("home", "Back to home")}
      {heading(name)}
      {screen === "sign-in" ? <p>On the live sign-in page, visitors can continue with Google or use a sign-in code by email. Preview uses your current admin session.</p> :
        <List label={name}><ListRow title={screen === "learn" ? "Try the first verse" : SAMPLE_PORTION} meta={SAMPLE_RANGE} onClick={() => go("practice")} /></List>}
    </>;
  } else if (role === "public") {
    content = <div className={styles.publicHome}>
      <ThisWeekView state={{ status: "ready", date: SAMPLE_DATE, week: SAMPLE_WEEK }} titleRef={title} label="Sample Shabbat" actions={<>
        <button type="button" className="button-start" onClick={() => go("practice")}>Practice a reading</button>
        <button type="button" className="button-hero-secondary" onClick={() => go("study")}>Study Torah</button>
      </>} />
      <section className={doorStyles.find} aria-label="Find a reading">
        <List><ListRow title="Find a reading" onClick={() => go("find")} /></List>
      </section>
      <div className={doorStyles.doors}>
        <section className={doorStyles.door} aria-labelledby="sample-sign-in">
          <h2 id="sample-sign-in" className={doorStyles.doorTitle}>Your readings</h2>
          <p className={doorStyles.doorLine}>{SIGNED_OUT_LINE}</p>
          <button type="button" className={`button-hero-secondary ${doorStyles.doorAction}`} onClick={() => go("sign-in")}>Sign in</button>
        </section>
        <section className={doorStyles.door} aria-labelledby="sample-learn">
          <h2 id="sample-learn" className={doorStyles.doorTitle}>Learn to lein</h2>
          <p className={doorStyles.doorLine}>Hear the phrases, then lein a verse of this week's reading.</p>
          <button type="button" className={`button-hero-secondary ${doorStyles.doorAction}`} onClick={() => go("learn")}>Learn to lein</button>
        </section>
      </div>
    </div>;
  } else if (role === "admin" || role === "tutor") {
    content = <>
      {heading(role === "admin" ? "This week" : "My Readings", role === "admin" ? "Needs you, ceremonies and rehearsals." : undefined)}
      <section className={shelfStyles.section} aria-labelledby="sample-roster">
        <h2 id="sample-roster" className={shelfStyles.sectionTitle}>{role === "admin" ? "Upcoming ceremonies" : "Your students"}</h2>
        <List><ListRow title={<bdi>{SAMPLE_STUDENT}</bdi>} meta={<>
          <span className={shelfStyles.metaLine}><time dateTime={SAMPLE_DATE}>Beit Mitzvah · {SAMPLE_DATE_LABEL}</time></span>
          <span className={shelfStyles.metaLine}>{role === "admin" ? `${SAMPLE_PORTION} · Tutor assigned` : SAMPLE_NOTE}</span>
        </>} trailing="Open" onClick={() => go("reading")} /></List>
      </section>
    </>;
  } else if (role === "parent") {
    content = <>
      {heading("My Readings")}
      <section className={shelfStyles.section} aria-labelledby="sample-child">
        <h2 id="sample-child" className={shelfStyles.sectionTitle}>Your child</h2>
        <ul className={shelfStyles.childList}><li className={shelfStyles.childCard}>
          <p className={shelfStyles.childHead}><Chip tone="attention">{`Beit Mitzvah · ${SAMPLE_DATE_LABEL}`}</Chip></p>
          <h3 className={shelfStyles.childName}><bdi>{SAMPLE_STUDENT}</bdi></h3>
          <p className={shelfStyles.childRanges}>{SAMPLE_PORTION} · Torah {SAMPLE_RANGE}</p>
          <p className={shelfStyles.childGot}>Verses Noa has got: {got.size} of {SAMPLE_VERSES.length}</p>
          <p className={shelfStyles.childAsk}><span className={shelfStyles.childAskLabel}>Before next time</span>{SAMPLE_NOTE}</p>
          <div className={shelfStyles.childActions}>
            <Button variant="primary" onClick={() => go("reading")}>Open</Button>
            <Button onClick={() => go("practice")}>Practice with Noa</Button>
          </div>
        </li></ul>
      </section>
    </>;
  } else {
    content = <>
      {heading("My Readings")}
      <section className={shelfStyles.card} aria-labelledby="sample-assignment">
        <p className={styles.meta}>Your reading</p>
        <h2 id="sample-assignment" className={shelfStyles.cardTitle}>{SAMPLE_PORTION} · <bdi>{SAMPLE_STUDENT}</bdi></h2>
        <p className={styles.meta}><time dateTime={SAMPLE_DATE}>Beit Mitzvah · {SAMPLE_DATE_LABEL}</time></p>
        <List label="Assigned aliyot"><ListRow title="Aliyah 1" meta={SAMPLE_RANGE} trailing="Practice" onClick={() => go("practice")} /></List>
        <div><Button variant="quiet" onClick={() => go("reading")}>Open reading</Button></div>
      </section>
    </>;
  }

  return <>
    <div className={styles.selector} role="group" aria-label="View as">
      <span aria-hidden="true">View as</span>
      {Object.entries(ROLES).map(([key, name]) => <Button key={key} variant={role === key ? "primary" : "secondary"} aria-pressed={role === key} onClick={() => switchRole(key as Role)}>{name}</Button>)}
    </div>
    <div className={styles.chrome}>
      <SiteBarView signedIn={role !== "public"} pathname={screen === "account" ? "/account" : screen === "learn" ? "/learn" : screen === "study" || screen === "practice" ? "/read" : screen === "shelf" || role !== "admin" && role !== "public" && screen === "home" ? "/mine" : "/"}
        previewLinks={{ href: "/preview", navigate: path => {
          const destinations = { "/": "home", "/read": "practice", "/learn": "learn", "/mine": staff ? "shelf" : "home", "/sign-in": "sign-in", "/account": "account" } as const;
          go(destinations[path]);
        } }} />
      {staff && <nav className={styles.staff} aria-label="Staff">
        {role === "admin" && <Button variant="quiet" onClick={() => go("home")}>This week</Button>}
        <Button variant="quiet" onClick={() => go("home")}>My Students</Button>
      </nav>}
    </div>
    <div className={styles.screen} data-testid="preview-screen" data-preview-role={role}>
      {content}
    </div>
  </>;
}

function SampleText({ practice, got, onToggle }: { practice: boolean; got: ReadonlySet<string>; onToggle(ref: string): void }) {
  const [tikkun, setTikkun] = useState(false);
  return <>
    <div className={styles.toolbar}>
      <Button aria-pressed={tikkun} onClick={() => setTikkun(current => !current)}>Tikkun</Button>
    </div>
    <ol className={styles.verses} aria-label="Aliyah 1">
      {SAMPLE_VERSES.map(verse => <li key={verse.ref}>
        <div className={styles.verseTop}>
          <h2><bdi dir="ltr">{verse.ref}</bdi></h2>
          {practice && <Button aria-label={`Got it, ${verse.ref}`} aria-pressed={got.has(verse.ref)} variant={got.has(verse.ref) ? "primary" : "secondary"} onClick={() => onToggle(verse.ref)}>Got it</Button>}
        </div>
        {tikkun ? <p className={styles.hebrew} dir="rtl"><TikkunVerse verse={verse} /></p>
          : <StudyHebrew verse={verse} className={styles.hebrew} id={`preview-verse-${verse.ref.split(":")[1]}`} colors={null} />}
      </li>)}
    </ol>
    <p className={styles.meta}>Hebrew sample, Genesis 1:1–2. Audio and saving are available in the live reader.</p>
  </>;
}
