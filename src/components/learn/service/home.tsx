"use client";
import { CRC_TENANT, homeUnits, lessonById, lessonMinutes, lessonOpen, type Lesson } from "../../../lib/service-course/course";
import { COPY, fill } from "../../../lib/service-course/copy";
import { courseDone, emptyProgress, isDone, nextLesson, type Progress } from "../../../lib/service-course/progress";
import type { Path } from "../../../lib/service-course/path";
import { siddurPageLink } from "../../../lib/siddur/link";
import { DEFAULT_SIDDUR_URL } from "../../../server/settings/validation";
import { SiddurLink } from "../../portal/siddur-link";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { icons, ServiceAppBar } from "./bits";
import { pathLessons, useServicePath, useServiceProgress, type PathView } from "./progress";

/** One lesson row. Every row is a link, in every state: a lesson never locks, so nothing here is a bare span (DP-09). */
function Row({ lesson, progress, next, page }: { lesson: Lesson; progress: Progress; next: Lesson | null; page?: number }) {
  const done = isDone(progress, lesson.id), state = done ? "done" : next?.id === lesson.id ? "next" : "later";
  const href = page === undefined ? null : siddurPageLink(DEFAULT_SIDDUR_URL, CRC_TENANT.siddurBook, page);
  return <li className={learn.step}>
    <a className={learn.stepLink} data-state={state} data-lesson={lesson.id} href={`/learn/service/${lesson.id}`}>
      <span className={learn.dot} data-state={state} data-plain="" aria-hidden="true">{done && icons.check}</span>
      <span>{lesson.title}<span className="sr-only">{done ? COPY.home.dotDone : state === "next" ? COPY.home.dotNext : ""}</span></span>
      <span />
    </a>
    {/* The student's own printed page, from their plan (2.0 SC4), with the approved siddur-link wording. */}
    {href && <p className={styles.partPage} data-siddur-page={page}><SiddurLink href={href}>{fill(COPY.done.siddur, { page: page! })}</SiddurLink></p>}
  </li>;
}
function PathList({ lessons, progress, next }: { lessons: readonly Lesson[]; progress: Progress; next: Lesson | null }) {
  return <ol className={learn.path}>{lessons.map(lesson => <Row key={lesson.id} lesson={lesson} progress={progress} next={next} />)}</ol>;
}

/**
 * "Your parts" (2.0 SC4, A4 6.3 and W2, W3): a signed-in student's own parts in service order with their own pages, or one line
 * for each other state. Signed out, or an account with no student of its own, shows nothing here.
 */
export function YourParts({ view, progress, next }: { view: PathView; progress: Progress; next: Lesson | null }) {
  if (view.status === "idle" || view.status === "none") return null;
  if (view.status === "loading") return <section aria-labelledby="service-mine" data-path="loading">
    <div className={learn.pathHead}><h2 id="service-mine">{COPY.home.mineHeading}</h2></div>
    <p role="status" className={styles.unitSummary}>{COPY.state.pathLoading}</p>
  </section>;
  if (view.status === "error") return <p role="status" className={styles.pathLine} data-path="error">{COPY.state.pathError}</p>;
  const path: Path = view.path;
  if (path.state === "cleared") return <p className={styles.pathLine} data-path="cleared">{COPY.state.pathCleared}</p>;
  if (path.state === "withdrawn") return <p className={styles.pathLine} data-path="withdrawn">{COPY.state.pathWithdrawn}</p>;
  const lessons = path.items.flatMap(item => { const lesson = lessonById(item.lesson); return lesson && lessonOpen(lesson) ? [{ lesson, page: item.page }] : []; });
  const start = path.serviceStart === undefined ? null : siddurPageLink(DEFAULT_SIDDUR_URL, CRC_TENANT.siddurBook, path.serviceStart);
  return <section aria-labelledby="service-mine" data-path={path.state} data-review={path.review || undefined} data-slot={path.slot}>
    <div className={learn.pathHead}><h2 id="service-mine">{COPY.home.mineHeading}</h2></div>
    {path.state === "no-plan" ? <p className={styles.unitSummary}>{COPY.state.pathNoPlan}</p> : lessons.length > 0 && <p className={styles.unitSummary}>{COPY.home.mineLine}</p>}
    {path.review && <p className={styles.unitSummary}>{COPY.state.pathReview}</p>}
    {path.slot === "unknown" && <p className={styles.unitSummary}>{COPY.state.slotUnknown}</p>}
    {lessons.length > 0 && <ol className={learn.path}>{lessons.map(({ lesson, page }) => <Row key={lesson.id} lesson={lesson} progress={progress} next={next} page={page} />)}</ol>}
    {start && path.serviceStart !== undefined && <p className={styles.partPage} data-service-start={path.serviceStart}><SiddurLink href={start}>{fill(COPY.home.serviceStart, { page: path.serviceStart })}</SiddurLink></p>}
  </section>;
}

/** The course home: one next step, the links, the signed-in student's own parts, and every unit of the Shabbat morning service in order. */
export function ServiceHome() {
  const { progress: loaded, account } = useServiceProgress();
  const view = useServicePath(account);
  const progress = loaded ?? emptyProgress(), ready = loaded !== null;
  if (!CRC_TENANT.enabled) return <div className={`portal-shell ${learn.shell}`}><ServiceAppBar /><main className={learn.main}><p role="status">{COPY.state.tenantOff}</p></main></div>;
  const mine = pathLessons(view);
  const next = nextLesson(progress, CRC_TENANT, mine ?? CRC_TENANT.defaultPath);
  // Below a Your parts answer (a list or a line), the rest of the course sits under its own heading.
  const listed = view.status === "ready" || view.status === "error";
  const [savedBefore, savedAfter] = COPY.home.saved.split("Sign in");
  return <div className={`portal-shell ${learn.shell}`}>
    <a className="skip-link" href="#service-main">Skip to the course</a>
    <ServiceAppBar />
    <main id="service-main" className={learn.main} aria-busy={!ready}>
      <div className={learn.home}>
        <div className={learn.homeLead}>
          <h1 className={learn.title}>{COPY.home.title}</h1>
          <p className={learn.intro}>{COPY.home.intro}</p>
          {!ready ? <p role="status" className={learn.state}>{COPY.state.homeLoading}</p>
            : courseDone(progress) ? <section className={learn.next} aria-labelledby="service-next"><h2 id="service-next" className={learn.nextTitle}>{COPY.home.done}</h2></section>
            : next && <section className={learn.next} aria-labelledby="service-next" data-next={next.id}>
              <div className={learn.nextTop}><span className={learn.nextLabel}>{COPY.home.nextLabel}</span></div>
              <h2 id="service-next" className={learn.nextTitle}>{next.title}</h2>
              <p className={learn.nextLine}>{next.summary}</p>
              <div className={learn.nextAction}><a className="button-start" href={`/learn/service/${next.id}`} aria-describedby="service-next">{COPY.home.start}</a><span className={learn.minutes}>{fill(COPY.home.minutes, { n: lessonMinutes(next) })}</span></div>
            </section>}
          <nav className={learn.links} aria-label={COPY.home.nav}><a href="/learn">{COPY.home.lein}</a><a href="/learn/service/about">{COPY.home.about}</a></nav>
          {/* Signed in and synced, the account keeps the progress, so the device line goes (as Learn to lein's home does). */}
          {account.state !== "synced" && <p className={learn.saved} data-saved="device">{savedBefore}<a href="/sign-in">Sign in</a>{savedAfter}</p>}
        </div>
        <div className={learn.paths}>
          <YourParts view={view} progress={progress} next={next} />
          {listed && <h2 className={styles.allHeading}>{COPY.home.allHeading}</h2>}
          {homeUnits().map(unit => <section key={unit.id} aria-labelledby={`unit-${unit.id}`} data-unit={unit.id}>
            <div className={learn.pathHead}><h2 id={`unit-${unit.id}`}>{unit.title}</h2></div>
            <p className={styles.unitSummary}>{unit.summary}</p>
            <PathList lessons={unit.lessons.map(id => lessonById(id)!).filter(lesson => lessonOpen(lesson))} progress={progress} next={next} />
          </section>)}
          <p className={styles.later}>{COPY.home.eveningLater}</p>
        </div>
      </div>
    </main>
  </div>;
}
