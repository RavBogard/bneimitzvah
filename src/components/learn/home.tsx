"use client";
import type { CSSProperties, ReactNode } from "react";
import { COURSE, familyColor, lessonMinutes, pathLessons, type Lesson, type Melody } from "../../lib/learn/course";
import { courseDone, emptyProgress, isDone, isUnlocked, localDay, reviewSummary, type Progress } from "../../lib/learn/progress";
import { recommendedLesson } from "../../lib/learn/recommendation";
import { reviewLine } from "../../lib/learn/review-line";
import { preparationHref } from "../../lib/learn/passage-preparation";
import { openPractice } from "../../lib/learn/practice";
import { DRAFTED } from "./activity-copy";
import { ContourMark, FamilyChip, icons } from "./bits";
import { firstVerseOf, useOwnReading, type OwnReading } from "./own-reading";
import { useProgress } from "./services";
import { useVerseReview } from "./own-verses";
import { LearningStart } from "./learning-start";
import styles from "./learn.module.css";

export function LearnAppBar() {
  return <header className="portal-header app-bar"><a className="portal-brand" href="/" aria-label="CRC Torah home">CRC Torah</a></header>;
}

/** The unit each path's "First phrase of your verse" row follows: the endings (the haftarah path opens with them inside its first unit). */
const ENDINGS_UNIT: Record<Melody, string> = { torah: "u1-the-two-endings", haftarah: "u5-haftarah-same-phrases-new-tune" };
function PathList({ melody, progress, next, after }: { melody: Melody; progress: Progress; next: Lesson | null; after?: ReactNode }) {
  const units = COURSE.units.filter(unit => unit.melody === melody);
  return <>{units.map(unit => <div key={unit.id}>
    {!(unit.lessons.length === 1 && COURSE.lessons.find(row => row.id === unit.lessons[0])?.title === unit.title) && <h3 className={styles.unitTitle}>{unit.title}</h3>}
    <ol className={styles.path}>{unit.lessons.map(id => {
      const lesson = COURSE.lessons.find(row => row.id === id)!, done = isDone(progress, id);
      const state = done ? "done" : next?.id === id ? "next" : "later";
      const dot = <span className={styles.dot} data-state={state} data-plain={lesson.family ? undefined : ""} style={done && lesson.family ? { "--phrase-color": familyColor(lesson.family) } as CSSProperties : undefined} aria-hidden="true">{done && icons.check}</span>;
      const status = <span className="sr-only">{done ? ", done" : state === "next" ? ", next" : ""}</span>;
      const mark = lesson.family ? <span className={styles.stepMark}><ContourMark family={lesson.family} melody={melody} /></span> : <span />;
      const title = lesson.title.replace(/ in the haftarah$/, "");
      // Every lesson is a link: the order is advice (as "Best after The two endings." is), and Next still names one lesson.
      return <li key={id} className={styles.step}><a className={styles.stepLink} data-state={state} href={`/learn/${id}`}>{dot}<span>{title}{status}</span>{mark}</a></li>;
    })}</ol>
    {unit.id === ENDINGS_UNIT[melody] && after}
  </div>)}</>;
}

/**
 * 1.9 N17: a signed-in student's first phrase, a path row like Quick ten after the endings. It opens the existing passage preparation
 * on the first verse of their own assigned reading, so it adds no lesson and no progress key. Signed-out visitors and everyone
 * without an assignment see no row (the signed-out wording is not approved).
 */
export function FirstPhraseRow({ own, melody }: { own: OwnReading; melody: Melody }) {
  const reading = own.status === "ready" ? own[melody] : null;
  if (!reading) return null;
  return <a className={styles.review} href={preparationHref(firstVerseOf(reading), melody)} data-first-phrase={melody}><span>First phrase of your verse</span>{icons.arrow}</a>;
}

/** Quick ten's row, once three families are heard in a melody; with both melodies open, each row names its path. */
export function QuickTenLinks({ progress }: { progress: Progress }) {
  const open = openPractice(progress);
  if (!open.length) return null;
  return <div>{open.map(practice => <a key={practice.id} className={styles.review} href={`/learn/practice/${practice.id}`} data-practice={practice.id}>
    <span>{DRAFTED.quickTen.homeRow}</span>{open.length > 1 && <span className={styles.practiceMelody}>{practice.melody === "torah" ? "Torah" : "Haftarah"}</span>}{icons.arrow}</a>)}</div>;
}

/** The course home: one next step, the review line when anything is due, the two paths, and what you can hear. */
export function CourseHome() {
  const { progress: loaded, account, until } = useProgress();
  const progress = loaded ?? emptyProgress(), ready = loaded !== null;
  const next = recommendedLesson(progress), review = ready ? reviewSummary(progress, localDay(Date.now()), until) : null;
  const haftarahOpen = isUnlocked(progress, pathLessons("haftarah")[0]);
  // 1.9 N17: a student whose own reading is a haftarah sees that path first; the order of the two paths is otherwise unchanged.
  const own = useOwnReading(), mine = own.status === "ready" ? own : null, haftarahFirst = !!mine?.haftarah && !mine.torah;
  // 1.9 N19: opening Learn brings the student's Got it and Solid verses into their own verse cards.
  useVerseReview(!!mine);
  const paths = (["torah", "haftarah"] as const).map(melody => melody === "torah"
    ? <section key="torah" aria-labelledby="path-torah"><div className={styles.pathHead}><h2 id="path-torah">Torah</h2></div><PathList melody="torah" progress={progress} next={next} after={<FirstPhraseRow own={own} melody="torah" />} /></section>
    : <section key="haftarah" aria-labelledby="path-haftarah"><div className={styles.pathHead}><h2 id="path-haftarah">Haftarah</h2>{!haftarahOpen && <span className={styles.pathNote}>Best after The two endings.</span>}</div>
      <PathList melody="haftarah" progress={progress} next={next} after={<FirstPhraseRow own={own} melody="haftarah" />} /></section>);
  if (haftarahFirst) paths.reverse();
  return <div className={`portal-shell ${styles.shell}`}>
    <a className="skip-link" href="#learn-main">Skip to the course</a>
    <LearnAppBar />
    <main id="learn-main" className={styles.main} aria-busy={!ready}>
      <div className={styles.home}>
        <div className={styles.homeLead}>
          <h1 className={styles.title}>Learn to lein</h1>
          <p className={styles.intro}>Hear a phrase, chant it yourself, then connect it to a reading. Return to words, sounds and joins whenever you need help.</p>
          {courseDone(progress) ? <section className={styles.next} aria-labelledby="learn-next"><h2 id="learn-next" className={styles.nextTitle}>Keep preparing readings</h2><p><a href="/learn/prepare">Prepare a passage</a> or revisit a lesson below.</p></section>
            : next && <section className={styles.next} aria-labelledby="learn-next" data-next={next.id}>
              <div className={styles.nextTop}><span className={styles.nextLabel}>Next</span>{next.family && <FamilyChip family={next.family} melody={next.melody} />}</div>
              <h2 id="learn-next" className={styles.nextTitle}>{next.title}</h2>
              <p className={styles.nextLine}>{next.summary}</p>
              <div className={styles.nextAction}><a className="button-start" href={`/learn/${next.id}`} aria-describedby="learn-next">Start</a><span className={styles.minutes}>about {lessonMinutes(next)} minutes</span></div>
            </section>}
          {review && <a className={styles.review} href="/learn/review"><span>{reviewLine(review)}</span>{icons.arrow}</a>}
          {/* 1.9 N19: a student with their own reading runs through it, no audio and colours off. */}
          {mine && <a className={styles.review} href="/learn/run-through" data-run-through><span>Run-through</span>{icons.arrow}</a>}
          {ready && <QuickTenLinks progress={progress} />}
          <LearningStart />
          <nav className={styles.links} aria-label="Course"><a href="/trope-chart">Trope chart</a><a href="/learn/about">About</a>{mine && <a href="/workspace/student">Back to my reading</a>}</nav>
          {account.state !== "synced" && <p className={styles.saved}>Progress is saved on this device. <a href="/sign-in">Sign in</a> to keep it.</p>}
        </div>
        <div className={styles.paths}>{paths}</div>
      </div>
    </main>
  </div>;
}
