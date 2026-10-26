"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "../provider";
import type { FinishedPart } from "./api";
import { COPY, fill } from "../../../../lib/service-course/copy";
import { lessonById } from "../../../../lib/service-course/course";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-12" as "Oct 12" (W13): the day only, never a time. */
function shortDate(day: string): string | null {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(day); if (!match) return null;
  const month = Number(match[1]), date = Number(match[2]);
  return month >= 1 && month <= 12 && date >= 1 && date <= 31 ? `${months[month - 1]} ${date}` : null;
}

/**
 * "Learn the service" on a student's page, for an assigned tutor or an admin (2.0 SC5, A4 9, W13): one row per part on the
 * student's plan, in service order, "Finished {date}" or "Not yet". No percent, no count, no ordering of students. Each part is
 * named by its course lesson title, never by the licensed feed's unit name. A failed load shows one line and nothing partial.
 */
export function FinishedParts({ mode, studentId, firstName }: { mode: "admin" | "tutor"; studentId: string; firstName: string }) {
  const { readServiceFinished } = useWorkspace();
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; parts: FinishedPart[] }>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    readServiceFinished(mode, studentId, controller.signal)
      .then(parts => { if (!controller.signal.aborted) setState({ status: "ready", parts }); })
      .catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [readServiceFinished, mode, studentId]);
  const parts = state.status === "ready" ? state.parts.flatMap(part => { const lesson = lessonById(part.lesson); return lesson ? [{ ...part, title: lesson.title }] : []; }) : [];
  return <section className="service-finished" aria-labelledby={`service-finished-${studentId}`} aria-busy={state.status === "loading"}>
    <h3 id={`service-finished-${studentId}`}>{COPY.tutor.heading}</h3>
    <p className="field-help">{fill(COPY.tutor.line, { firstName })}</p>
    {state.status === "loading" ? <p role="status">{COPY.tutor.loading}</p>
      : state.status === "error" ? <p role="status">{COPY.tutor.error}</p>
      : !parts.length ? <p>{COPY.tutor.empty}</p>
      : <table className="service-finished-table">
        <thead><tr><th scope="col">{COPY.tutor.colPart}</th><th scope="col">{COPY.tutor.colStatus}</th></tr></thead>
        <tbody>{parts.map(part => { const day = part.finished === null ? null : shortDate(part.finished);
          return <tr key={part.lesson} data-finished={part.finished !== null || undefined}>
            <th scope="row">{part.title}</th>
            <td>{part.finished === null ? COPY.tutor.notYet : day ? fill(COPY.tutor.finishedOn, { date: day }) : COPY.tutor.finished}</td>
          </tr>; })}</tbody>
      </table>}
  </section>;
}
