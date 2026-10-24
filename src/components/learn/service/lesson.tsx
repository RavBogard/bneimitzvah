"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CRC_TENANT, lessonById, lessonOpen, mapSections, presentGoal, sectionLessons, serviceNeighbours, teachingOf, unitById, type Lesson } from "../../../lib/service-course/course";
import { COPY, emphasised, fill, typographic } from "../../../lib/service-course/copy";
import { completeLesson, lessonAfter } from "../../../lib/service-course/progress";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { icons, LessonSiddurLink } from "./bits";
import { useServiceProgress } from "./progress";

/**
 * The steps of a lesson (A4 3.2). A prayer is About, Where, Read and Done; a moment has no prayer text, so no Read.
 * This slice's Read step is the siddur link alone: a prayer's own text, key words and check arrive with the public
 * text (SC2), and the "Hear it" step stays out while the course's `recordings` flag is false.
 */
export type StepKind = "about" | "where" | "read" | "done";
export function lessonSteps(lesson: Lesson): StepKind[] {
  return lesson.kind === "prayer" ? ["about", "where", "read", "done"] : ["about", "where", "done"];
}

function Footer({ children }: { children: ReactNode }) {
  return <div className={learn.footer}><div className={learn.footerInner}>{children}</div></div>;
}

/** Lesson frame: close, title and segment rail on the lake bar; the step; one forward action at the thumb. */
export function ServiceLesson({ id }: { id: string }) {
  const lesson = lessonById(id);
  if (!lesson || !lessonOpen(lesson)) return <p role="status">{COPY.state.notFound}</p>;
  return <LessonFlow lesson={lesson} />;
}
function LessonFlow({ lesson }: { lesson: Lesson }) {
  const steps = useMemo(() => lessonSteps(lesson), [lesson]);
  const [at, setAt] = useState(0);
  const { progress, update } = useServiceProgress();
  const main = useRef<HTMLElement>(null);
  const go = useCallback((next: number) => { setAt(next); window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true }); }, []);
  const step = steps[at];
  const next = () => go(Math.min(steps.length - 1, at + 1));
  return <div className={`portal-shell ${learn.shell}`}>
    <a className="skip-link" href="#lesson-main">{COPY.frame.skip}</a>
    <header className={learn.bar}>
      <a className={learn.close} href="/learn/service" aria-label={COPY.frame.close}>{icons.close}</a>
      <p className={learn.barTitle}>{lesson.title}</p>
      <ol className={learn.rail} aria-label={fill(COPY.frame.rail, { n: at + 1, total: steps.length })}>{steps.map((_, i) => <li key={i} data-state={i < at ? "past" : i === at ? "current" : undefined} />)}</ol>
    </header>
    <main id="lesson-main" ref={main} tabIndex={-1} className={learn.lesson} data-step={step} data-lesson={lesson.id}>
      {step === "about" ? <><About lesson={lesson} /><Footer><button type="button" className="button-start" onClick={next}>{COPY.frame.next}</button></Footer></>
        : step === "where" ? <><Where lesson={lesson} /><Footer><button type="button" className="button-start" onClick={next}>{COPY.frame.next}</button></Footer></>
        : step === "read" ? <><Read lesson={lesson} /><Footer><button type="button" className="button-start" onClick={next}>{COPY.frame.next}</button></Footer></>
        : <Done lesson={lesson} complete={() => update(value => completeLesson(value, lesson, Date.now()))}
          nextId={progress ? lessonAfter(completeLesson(progress, lesson, Date.now()), lesson.id, CRC_TENANT)?.id ?? null : null} />}
    </main>
  </div>;
}

/** Step 1: Daniel's approved teaching, verbatim, with his credit. A moment says first that it has no prayer text. */
function About({ lesson }: { lesson: Lesson }) {
  const teaching = teachingOf(CRC_TENANT, lesson.id);
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.about}</h1>
    {lesson.kind === "moment" && <p className={styles.note}>{COPY.about.moment}</p>}
    {teaching && <div className={styles.teaching} data-approved={teaching.approved}>
      {teaching.text.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{emphasised(typographic(paragraph)).map((part, j) => part.em ? <em key={j}>{part.text}</em> : part.text)}</p>)}
      <p className={styles.credit}>{CRC_TENANT.credit}</p>
    </div>}
  </>;
}

/** Step 2: the morning service as a map. The learner's section opens and the prayer is marked; one line says what comes before and after. */
function Where({ lesson }: { lesson: Lesson }) {
  const { before, after } = serviceNeighbours(lesson.id), section = unitById(lesson.section);
  const page = CRC_TENANT.lessons[lesson.id]?.pages.morning;
  const sectionName = section ? section.title.replace(/^The /, "the ") : "";
  const line = before && after ? fill(COPY.where.line, { prayer: lesson.title, before: before.title, after: after.title })
    : after ? fill(COPY.where.first, { prayer: lesson.title }) : fill(COPY.where.last, { prayer: lesson.title });
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.where}</h1>
    <ol className={styles.map}>{mapSections().map(unit => {
      const here = unit.id === lesson.section;
      return <li key={unit.id} className={styles.mapSection} aria-current={here ? "true" : undefined} data-here={here || undefined}>
        <span>{unit.title}</span>
        {here && <ol className={styles.mapLessons}>{sectionLessons(unit.id).map(row => <li key={row.id} className={styles.mapLesson} aria-current={row.id === lesson.id ? "step" : undefined}>{row.title}</li>)}</ol>}
      </li>;
    })}</ol>
    <div className={styles.whereText}>
      <p>{line}</p>
      <p>{fill(COPY.where.section, { section: sectionName })}</p>
      {page !== undefined && <p>{fill(COPY.where.page, { page })}</p>}
    </div>
  </>;
}

/** Step 3, for a prayer whose text is not shown here: where to read it, and the link. */
function Read({ lesson }: { lesson: Lesson }) {
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.read}</h1>
    <p>{COPY.read.inSiddur}</p>
    <LessonSiddurLink lessonId={lesson.id} />
  </>;
}

/** End of a lesson: what you can now do, where it is in the siddur, the next step. Done marks the lesson when it opens. */
function Done({ lesson, complete, nextId }: { lesson: Lesson; complete(): void; nextId: string | null }) {
  useEffect(() => { complete(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const next = nextId ? lessonById(nextId) : null;
  return <>
    <div className={learn.doneHead}><h1 className={learn.doneTitle}>{lesson.title}</h1><p className={learn.doneWord}>{COPY.done.word}</p></div>
    <p className={learn.doneLine}>{presentGoal(lesson.goal)}</p>
    <LessonSiddurLink lessonId={lesson.id} />
    {next && <p className={learn.nextName}>{fill(COPY.done.nextName, { lesson: next.title })}</p>}
    <Footer>
      {next && <a className="button-start" href={`/learn/service/${next.id}`}>{COPY.done.startNext}</a>}
      <a className={learn.backLink} href="/learn/service">{COPY.done.back}</a>
    </Footer>
  </>;
}
