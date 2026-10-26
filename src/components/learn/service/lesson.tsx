"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CRC_TENANT, SERVICE_COURSE, lessonById, lessonOpen, mapSections, pageOf, phaseOf, presentGoal, sectionLessons, serviceNeighbours, teachingOf, unitById, type Lesson, type ServiceSlot } from "../../../lib/service-course/course";
import { COPY, emphasised, fill, typographic } from "../../../lib/service-course/copy";
import { completeLesson, lessonAfter, nextOnPath, type Progress } from "../../../lib/service-course/progress";
import type { CheckItem } from "../../../lib/service-course/check";
import { WordCardScope } from "../word-card";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { icons, LessonSiddurLink } from "./bits";
import { pathLessons, useServicePath, useServiceProgress, type PathView } from "./progress";
import { CheckStep, KeyWordsStep, LessonWords, ReadStep, useCheckItems, useLessonText, type TextState } from "./read";
import { FluencyLesson } from "./fluency";

/**
 * The steps of a lesson (A4 3.2). A prayer with public text is About, Where, Read, Key words, Check and Done; a prayer without it
 * (P'sukei D'zimrah, and the mixed Mi Shebeirach) reads only the siddur link; a moment has no Read. Key words drop out when the
 * lesson has none, and Check when the loaded text gives fewer than three items, so the rail shows a step fewer. The "Hear it" step
 * stays out while the course's `recordings` flag is false.
 */
export type StepKind = "about" | "where" | "read" | "words" | "check" | "done";
export function lessonSteps(lesson: Lesson, checkItems: number | null = null): StepKind[] {
  if (lesson.kind !== "prayer") return ["about", "where", "done"];
  if (!lesson.read) return ["about", "where", "read", "done"];
  return ["about", "where", "read", ...(lesson.keyWords.length ? ["words" as const] : []), ...(checkItems === null || checkItems >= 3 ? ["check" as const] : []), "done"];
}

function Footer({ children }: { children: ReactNode }) {
  return <div className={learn.footer}><div className={learn.footerInner}>{children}</div></div>;
}

/** Lesson frame: close, title and segment rail on the lake bar; the step; one forward action at the thumb. */
export function ServiceLesson({ id }: { id: string }) {
  const lesson = lessonById(id);
  if (!lesson || !lessonOpen(lesson)) return <p role="status">{COPY.state.notFound}</p>;
  if (lesson.kind === "fluency") return <FluencyLesson lesson={lesson} />;
  return <WordCardScope><LessonFlow lesson={lesson} /></WordCardScope>;
}
function LessonFlow({ lesson }: { lesson: Lesson }) {
  const { state, retry } = useLessonText(lesson);
  const text = state.status === "ready" ? state.text : null;
  // One seed per visit: the Check's order is fixed while the lesson is open and different the next time.
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const items = useCheckItems(lesson, text, seed);
  const steps = useMemo(() => lessonSteps(lesson, items ? items.length : null), [lesson, items]);
  const [at, setAt] = useState(0);
  const { progress, account, update } = useServiceProgress();
  // A signed-in student's own slot picks the evening teaching and pages for a prayer the evening repeats (2.0 SC7); signed out, the morning.
  const pathView = useServicePath(account), slot: ServiceSlot = pathView.status === "ready" ? pathView.path.slot : "morning";
  const main = useRef<HTMLElement>(null);
  const go = useCallback((next: number) => { setAt(next); window.scrollTo({ top: 0 }); main.current?.focus({ preventScroll: true }); }, []);
  const index = Math.min(at, steps.length - 1), step = steps[index];
  const next = () => go(Math.min(steps.length - 1, index + 1));
  const forward = (disabled = false) => <Footer><button type="button" className="button-start" disabled={disabled} onClick={next}>{COPY.frame.next}</button></Footer>;
  return <div className={`portal-shell ${learn.shell}`}>
    <a className="skip-link" href="#lesson-main">{COPY.frame.skip}</a>
    <header className={learn.bar}>
      <a className={learn.close} href="/learn/service" aria-label={COPY.frame.close}>{icons.close}</a>
      <p className={learn.barTitle}>{lesson.title}</p>
      <ol className={learn.rail} aria-label={fill(COPY.frame.rail, { n: index + 1, total: steps.length })}>{steps.map((_, i) => <li key={i} data-state={i < index ? "past" : i === index ? "current" : undefined} />)}</ol>
    </header>
    <main id="lesson-main" ref={main} tabIndex={-1} className={learn.lesson} data-step={step} data-lesson={lesson.id} data-text={lesson.read ? state.status : undefined}>
      <LessonWords lesson={lesson} text={text}>
        {step === "about" ? <><About lesson={lesson} slot={slot} />{forward()}</>
          : step === "where" ? <><Where lesson={lesson} slot={slot} />{forward()}</>
          : step === "read" ? lesson.read ? <><ReadStep lesson={lesson} state={state} onRetry={retry} slot={slot} />{forward(!text)}</> : <><SiddurOnly lesson={lesson} slot={slot} />{forward()}</>
          : step === "words" && text ? <><KeyWordsStep lesson={lesson} text={text} />{forward()}</>
          : step === "check" && items ? <CheckStep key={seed} items={items as readonly CheckItem[]} seed={seed} onFinish={next} footer={children => <Footer>{children}</Footer>} />
          : step === "done" ? <Done lesson={lesson} state={state} complete={() => update(value => completeLesson(value, lesson, Date.now()))} progress={progress} pathView={pathView} slot={slot} />
          : <p role="status" className={styles.note}>{COPY.state.lessonLoading}</p>}
      </LessonWords>
    </main>
  </div>;
}

/** Step 1: Daniel's approved teaching, verbatim, with his credit. A moment says first that it has no prayer text. */
function About({ lesson, slot }: { lesson: Lesson; slot: ServiceSlot }) {
  const teaching = teachingOf(CRC_TENANT, lesson.id, slot);
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.about}</h1>
    {lesson.kind === "moment" && <p className={styles.note}>{COPY.about.moment}</p>}
    {teaching && <div className={styles.teaching} data-approved={teaching.approved}>
      {teaching.text.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{emphasised(typographic(paragraph)).map((part, j) => part.em ? <em key={j}>{part.text}</em> : part.text)}</p>)}
      <p className={styles.credit}>{CRC_TENANT.credit}</p>
    </div>}
  </>;
}

/**
 * Step 2: the service as a map. The learner's section opens and the prayer is marked; one line says what comes before and after. An
 * evening lesson (2.0 SC7) shows the evening's two sections, and its neighbours in the book's order, which include the morning prayers
 * the evening repeats. The page is the learner's own: the evening's for a Havdalah-slot student.
 */
function Where({ lesson, slot }: { lesson: Lesson; slot: ServiceSlot }) {
  const phase = phaseOf(lesson), { before, after } = serviceNeighbours(lesson.id, SERVICE_COURSE, phase), section = unitById(lesson.section);
  const page = pageOf(CRC_TENANT, lesson.id, slot);
  const sectionName = section ? section.title.replace(/^The /, "the ") : "";
  const line = before && after ? fill(COPY.where.line, { prayer: lesson.title, before: before.title, after: after.title })
    : after ? fill(COPY.where.first, { prayer: lesson.title }) : fill(COPY.where.last, { prayer: lesson.title });
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.where}</h1>
    <ol className={styles.map}>{mapSections(SERVICE_COURSE, phase).map(unit => {
      const here = unit.id === lesson.section;
      return <li key={unit.id} className={styles.mapSection} aria-current={here ? "true" : undefined} data-here={here || undefined}>
        <span>{unit.title}</span>
        {here && <ol className={styles.mapLessons}>{sectionLessons(unit.id, SERVICE_COURSE, phase).map(row => <li key={row.id} className={styles.mapLesson} aria-current={row.id === lesson.id ? "step" : undefined}>{row.title}</li>)}</ol>}
      </li>;
    })}</ol>
    <div className={styles.whereText}>
      <p>{line}</p>
      <p>{fill(COPY.where.section, { section: sectionName })}</p>
      {page !== undefined && <p>{fill(COPY.where.page, { page })}</p>}
    </div>
  </>;
}

/** Step 3, for a prayer whose text is not shown here (P'sukei D'zimrah; the mixed Mi Shebeirach): where to read it, and the link. */
function SiddurOnly({ lesson, slot }: { lesson: Lesson; slot: ServiceSlot }) {
  return <>
    <h1 className={styles.stepTitle}>{COPY.step.read}</h1>
    <p>{COPY.read.inSiddur}</p>
    <LessonSiddurLink lessonId={lesson.id} slot={slot} />
  </>;
}

/**
 * End of a lesson: what you can now do, where it is in the siddur, the next step. Done marks the lesson when it opens, and a lesson
 * with a Read only once its text has loaded (A4 3.2: a prayer whose text failed is never marked done).
 */
function Done({ lesson, state, complete, progress, pathView, slot }: { lesson: Lesson; state: TextState; complete(): void; progress: Progress | null; pathView: PathView; slot: ServiceSlot }) {
  const ready = !lesson.read || state.status === "ready";
  useEffect(() => { if (ready) complete(); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // A signed-in student with parts goes on to the next of their own parts (2.0 SC4, done.nextMine); everyone else to the next lesson.
  const path = pathLessons(pathView);
  const after = progress ? completeLesson(progress, lesson, Date.now()) : null;
  const mine = after && path ? nextOnPath(after, path) : null;
  const next = mine ?? (after ? lessonAfter(after, lesson.id, CRC_TENANT) : null);
  return <>
    <div className={learn.doneHead}><h1 className={learn.doneTitle}>{lesson.title}</h1><p className={learn.doneWord}>{COPY.done.word}</p></div>
    {lesson.goal && <p className={learn.doneLine}>{presentGoal(lesson.goal)}</p>}
    <LessonSiddurLink lessonId={lesson.id} slot={slot} />
    {next && <p className={learn.nextName}>{fill(mine ? COPY.done.nextMine : COPY.done.nextName, { lesson: next.title })}</p>}
    <Footer>
      {next && <a className="button-start" href={`/learn/service/${next.id}`}>{COPY.done.startNext}</a>}
      <a className={learn.backLink} href="/learn/service">{COPY.done.back}</a>
    </Footer>
  </>;
}
