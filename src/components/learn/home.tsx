"use client";
import type { CSSProperties } from "react";
import { COURSE, familyColor, lessonMinutes, pathLessons, type Lesson, type Melody } from "../../lib/learn/course";
import { courseDone, emptyProgress, heard, isDone, isUnlocked, localDay, nextLesson, reviewSummary, type Progress } from "../../lib/learn/progress";
import { ContourMark, FamilyChip, icons } from "./bits";
import { useProgress } from "./services";
import styles from "./learn.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function LearnAppBar() {
  return <header className="portal-header app-bar"><a className="portal-brand" href="/" aria-label="CRC Torah home">CRC Torah</a></header>;
}

function PathList({ melody, progress, next }: { melody: Melody; progress: Progress; next: Lesson | null }) {
  const units = COURSE.units.filter(unit => unit.melody === melody);
  return <>{units.map(unit => <div key={unit.id}>
    {!(unit.lessons.length === 1 && COURSE.lessons.find(row => row.id === unit.lessons[0])?.title === unit.title) && <h3 className={styles.unitTitle}>{unit.title}</h3>}
    <ol className={styles.path}>{unit.lessons.map(id => {
      const lesson = COURSE.lessons.find(row => row.id === id)!, done = isDone(progress, id), open = isUnlocked(progress, lesson);
      const state = done ? "done" : next?.id === id ? "next" : "later";
      const dot = <span className={styles.dot} data-state={state} data-plain={lesson.family ? undefined : ""} style={done && lesson.family ? { "--phrase-color": familyColor(lesson.family) } as CSSProperties : undefined} aria-hidden="true">{done && icons.check}</span>;
      const status = <span className="sr-only">{done ? ", done" : state === "next" ? ", next" : ""}</span>;
      const mark = lesson.family ? <span className={styles.stepMark}><ContourMark family={lesson.family} melody={melody} /></span> : <span />;
      const title = lesson.title.replace(/ in the haftarah$/, "");
      return <li key={id} className={styles.step}>{open
        ? <a className={styles.stepLink} data-state={state} href={`/learn/${id}`}>{dot}<span>{title}{status}</span>{mark}</a>
        : <span className={styles.stepLink} data-state="later">{dot}<span>{title}</span>{mark}</span>}</li>;
    })}</ol>
  </div>)}</>;
}

/** The course home: one next step, the review line when anything is due, the two paths, and what you can hear. */
export function CourseHome() {
  const { progress: loaded } = useProgress();
  const progress = loaded ?? emptyProgress(), ready = loaded !== null;
  const next = nextLesson(progress), review = ready ? reviewSummary(progress, localDay(Date.now())) : null;
  const torah = heard(progress, "torah"), haftarah = heard(progress, "haftarah");
  const haftarahOpen = isUnlocked(progress, pathLessons("haftarah")[0]);
  return <div className={`portal-shell ${styles.shell}`}>
    <a className="skip-link" href="#learn-main">Skip to the course</a>
    <LearnAppBar />
    <main id="learn-main" className={styles.main} aria-busy={!ready}>
      <div className={styles.home}>
        <div className={styles.homeLead}>
          <h1 className={styles.title}>Learn to lein</h1>
          <p className={styles.intro}>About ten short phrases make up the whole tune. Hear them one at a time, then lein a verse.</p>
          {courseDone(progress) ? <section className={styles.next} aria-labelledby="learn-next"><h2 id="learn-next" className={styles.nextTitle}>Done. Review when you like.</h2></section>
            : next && <section className={styles.next} aria-labelledby="learn-next" data-next={next.id}>
              <div className={styles.nextTop}><span className={styles.nextLabel}>Next</span>{next.family && <FamilyChip family={next.family} melody={next.melody} />}</div>
              <h2 id="learn-next" className={styles.nextTitle}>{next.title}</h2>
              <p className={styles.nextLine}>{next.summary}</p>
              <div className={styles.nextAction}><a className="button-start" href={`/learn/${next.id}`} aria-describedby="learn-next">Start</a><span className={styles.minutes}>about {lessonMinutes(next)} minutes</span></div>
            </section>}
          {review && <a className={styles.review} href="/learn/review"><span>Review: {plural(review.phrases, "phrase", "phrases")}, about {plural(review.minutes, "minute", "minutes")}</span>{icons.arrow}</a>}
          <p className={styles.heard}>Can hear: {torah.heard} of {torah.of} Torah phrases · {haftarah.heard} of {haftarah.of} haftarah phrases</p>
          <nav className={styles.links} aria-label="Course"><a href="/trope-chart">Trope chart</a><a href="/learn/about">About</a></nav>
          <p className={styles.saved}>Progress is saved on this device. Sign in to keep it.</p>
        </div>
        <div className={styles.paths}>
          <section aria-labelledby="path-torah"><div className={styles.pathHead}><h2 id="path-torah">Torah</h2></div><PathList melody="torah" progress={progress} next={next} /></section>
          <section aria-labelledby="path-haftarah"><div className={styles.pathHead}><h2 id="path-haftarah">Haftarah</h2>{!haftarahOpen && <span className={styles.pathNote}>Best after The two endings.</span>}</div>
            <PathList melody="haftarah" progress={progress} next={next} /></section>
        </div>
      </div>
    </main>
  </div>;
}
