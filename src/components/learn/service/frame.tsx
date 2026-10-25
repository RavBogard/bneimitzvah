"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { COPY, fill } from "../../../lib/service-course/copy";
import type { ServiceText } from "../../../lib/service-course/text";
import type { ChoiceItem } from "../../../lib/service-course/reading";
import { PortalRequestError } from "../../portal/api";
import { RATE_LIMITED_MESSAGE } from "../../portal/public-reading/rate-limited";
import learn from "../learn.module.css";
import styles from "./service.module.css";
import { icons } from "./bits";
import { fetchServiceText } from "./text-api";

/** The frame the strand, Review and Quick ten share with the lessons: the lake bar and the thumb button (2.0 SC3). */
export function Footer({ children }: { children: ReactNode }) {
  return <div className={learn.footer}><div className={learn.footerInner}>{children}</div></div>;
}
/** The bar: close, the title and, in a lesson, a position rail. The rail shows where the learner is, never how it went. */
export function RunBar({ title, rail, heading = false }: { title: string; rail?: Readonly<{ at: number; total: number }>; heading?: boolean }) {
  const Title = heading ? "h1" : "p";
  return <header className={learn.bar}>
    <a className={learn.close} href="/learn/service" aria-label={COPY.frame.close}>{icons.close}</a>
    <Title className={learn.barTitle}>{title}</Title>
    {rail ? <ol className={learn.rail} aria-label={fill(COPY.frame.rail, { n: rail.at + 1, total: rail.total })}>{Array.from({ length: rail.total }, (_, i) => <li key={i} data-state={i < rail.at ? "past" : i === rail.at ? "current" : undefined} />)}</ol> : <span />}
  </header>;
}

/**
 * One question: the prompt, what to look at, the choices, and what is said after the learner chooses. Nothing about how many were
 * right. `again` adds the line that a miss comes back.
 */
export function ChoiceBlock({ item, answer, again, onChoose }: { item: ChoiceItem; answer: number | null; again: boolean; onChoose(index: number): void }) {
  const stimulus = item.stimulus;
  return <>
    <p className={learn.prompt} data-check-kind="choice">{item.prompt}</p>
    {stimulus && (stimulus.he
      ? <p className={`${learn.hebrew} ${styles.checkWord}`} lang="he" dir="rtl" data-stimulus="">{stimulus.text}</p>
      : <p className={styles.checkWord} data-stimulus="">{stimulus.text}</p>)}
    <ul className={`${learn.choices} ${styles.checkChoices}`}>{item.choices.map((choice, i) => {
      const state = answer === null ? undefined : i === item.right ? "right" : i === answer ? "chosen" : "other";
      return <li key={i}><button type="button" className={learn.choice} disabled={answer !== null} data-state={state} onClick={() => onChoose(i)}>
        {choice.he ? <span className={`${learn.hebrew} ${styles.choiceHe}`} lang="he" dir="rtl">{choice.text}</span> : <span>{choice.text}</span>}
        {state === "right" && <span className={learn.choiceMark}>{icons.check}</span>}
      </button></li>;
    })}</ul>
    <div className={learn.feedback} aria-live="polite">{answer !== null && <><p>{item.feedback[answer]}</p>{again && <p>{COPY.check.again}</p>}</>}</div>
  </>;
}

/** The public texts of some units, fetched together, once per page and retry. Holds them for the page only. */
export type UnitTexts = Readonly<{ status: "loading" } | { status: "ready"; texts: ReadonlyMap<string, ServiceText> } | { status: "error"; rateLimited: boolean }>;
export function useUnitTexts(units: readonly string[]): { state: UnitTexts; retry(): void } {
  const [state, setState] = useState<UnitTexts>({ status: "loading" }), [attempt, setAttempt] = useState(0);
  const key = units.join("|");
  useEffect(() => {
    const controller = new AbortController(), wanted = key ? key.split("|") : [];
    setState({ status: "loading" });
    Promise.all(wanted.map(unit => fetchServiceText(unit, controller.signal))).then(
      list => { if (!controller.signal.aborted) setState({ status: "ready", texts: new Map(list.map(text => [text.unit, text])) }); },
      error => { if (!controller.signal.aborted) setState({ status: "error", rateLimited: error instanceof PortalRequestError && error.status === 429 }); });
    return () => controller.abort();
  }, [key, attempt]);
  return { state, retry: useCallback(() => setAttempt(n => n + 1), []) };
}
/** "The prayer text did not load. Try again." (or the rate-limit line), with the retry button. */
export function TextFailure({ rateLimited, onRetry }: { rateLimited: boolean; onRetry(): void }) {
  return <div role="alert" className={learn.state}><p>{rateLimited ? RATE_LIMITED_MESSAGE : COPY.state.textError}</p><button type="button" className="button-secondary" onClick={onRetry}>{COPY.state.retry}</button></div>;
}
