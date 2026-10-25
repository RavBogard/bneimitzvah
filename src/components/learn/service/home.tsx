"use client";
import { CRC_TENANT, homeUnits, lessonById, lessonMinutes, lessonOpen, type Lesson } from "../../../lib/service-course/course";
import { COPY, fill } from "../../../lib/service-course/copy";
import { courseDone, emptyProgress, isDone, nextLesson, type Progress } from "../../../lib/service-course/progress";
import { quickTenOpen, reviewSummary } from "../../../lib/service-course/cards";
import { localDay } from "../../../lib/learn/progress";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { icons, ServiceAppBar } from "./bits";
import { useServiceProgress } from "./progress";

/** One unit's lessons. Every row is a link, in every state: a lesson never locks, so nothing here is a bare span (DP-09). */
function PathList({ lessons, progress, next }: { lessons: readonly Lesson[]; progress: Progress; next: Lesson | null }) {
  return <ol className={learn.path}>{lessons.map(lesson => {
    const done = isDone(progress, lesson.id), state = done ? "done" : next?.id === lesson.id ? "next" : "later";
    return <li key={lesson.id} className={learn.step}>
      <a className={learn.stepLink} data-state={state} data-lesson={lesson.id} href={`/learn/service/${lesson.id}`}>
        <span className={learn.dot} data-state={state} data-plain="" aria-hidden="true">{done && icons.check}</span>
        <span>{lesson.title}<span className="sr-only">{done ? COPY.home.dotDone : state === "next" ? COPY.home.dotNext : ""}</span></span>
        <span />
      </a>
    </li>;
  })}</ol>;
}

/** The course home, signed out: one next step, the links, and every unit of the Shabbat morning service in order. */
export function ServiceHome() {
  const { progress: loaded } = useServiceProgress();
  const progress = loaded ?? emptyProgress(), ready = loaded !== null;
  if (!CRC_TENANT.enabled) return <div className={`portal-shell ${learn.shell}`}><ServiceAppBar /><main className={learn.main}><p role="status">{COPY.state.tenantOff}</p></main></div>;
  const next = nextLesson(progress, CRC_TENANT), review = ready ? reviewSummary(progress, localDay(Date.now())) : null;
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
          {ready && !isDone(progress, "f1") && <a className={learn.review} href="/learn/service/f1" data-row="fluency"><span>{COPY.home.fluencyRow}</span>{icons.arrow}</a>}
          {review && <a className={learn.review} href="/learn/service/review" data-row="review"><span>{fill(COPY.home.reviewRow, { n: review.cards, m: review.minutes })}</span>{icons.arrow}</a>}
          {ready && quickTenOpen(progress) && <a className={learn.review} href="/learn/service/practice/quick-ten" data-row="quick-ten"><span>{COPY.home.quickTenRow}</span>{icons.arrow}</a>}
          <nav className={learn.links} aria-label={COPY.home.nav}><a href="/learn">{COPY.home.lein}</a><a href="/learn/service/about">{COPY.home.about}</a></nav>
          <p className={learn.saved}>{COPY.home.saved}</p>
        </div>
        <div className={learn.paths}>
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
