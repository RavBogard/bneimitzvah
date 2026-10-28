"use client";
import { useEffect, useState } from "react";
import { Chip, List, ListRow } from "../../ui";
import { workspaceApi, type Student } from "../workspace/api";
import { fetchLessons } from "../workspace/lessons/api";
import { ceremonyCountdown, nextDate } from "../workspace/reading";
import { TutorCardLine } from "../workspace/staff/practice";
import { fetchLearners, type Learner } from "./api";
import { learnerShelfHref } from "./find-a-learner";
import styles from "./shelf.module.css";

/**
 * Your students (decision 17): the tutor's students nearest their ceremony first, then the claimed learners without one, by name. Each
 * student's row answers "who needs me" (tutor walk 2026-10-28, findings 1 and 2): a rehearsal or Beit Mitzvah two weeks away or less
 * leads as a chip, then the date, then the practice line (days practiced, last lesson, verses still working), then the latest note.
 */
export const YOUR_STUDENTS_STRINGS = Object.freeze({ title: "Your students", open: "Open", failed: "Your students didn’t load.", none: "No students yet." });
export type StudentRow = Readonly<{ key: string; name: string; ceremonyDate: string | null; note: string | null; href: string; studentId?: string; rehearsal1?: string | null; rehearsal2?: string | null }>;
type State = Readonly<{ status: "loading" } | { status: "ready"; rows: readonly StudentRow[] } | { status: "failed" }>;

/** The first line of a lesson note, for the row's second line. */
export const firstLine = (text: string | null | undefined) => { const line = (text ?? "").split(/\r?\n/).map(part => part.trim()).find(Boolean); return line ? Array.from(line).slice(0, 160).join("") : null; };
/** Dated students by ceremony, earliest first; then the claimed learners with no student record, by name. Linked students are not listed twice. */
export function studentRows(students: readonly Student[], learners: readonly Learner[], notes: ReadonlyMap<string, string | null> = new Map()): StudentRow[] {
  const dated = [...students].sort((a, b) => a.ceremonyDate.localeCompare(b.ceremonyDate) || a.id.localeCompare(b.id))
    .map(student => ({ key: `student:${student.id}`, name: `${student.firstName} ${student.lastName}`, ceremonyDate: student.ceremonyDate, note: notes.get(student.id) ?? null, href: `/workspace/tutor/${encodeURIComponent(student.id)}`,
      studentId: student.id, rehearsal1: student.rehearsal1 ?? null, rehearsal2: student.rehearsal2 ?? null }));
  const known = new Set(students.map(student => student.id));
  const claimed = learners.filter(row => row.tutor?.mine && !(row.student && known.has(row.student.id))).sort((a, b) => a.name.localeCompare(b.name))
    .map(row => ({ key: `learner:${row.membershipId}`, name: row.name, ceremonyDate: row.student?.ceremonyDate ?? null, note: null, href: learnerShelfHref(row.membershipId) }));
  return [...dated, ...claimed];
}
/** The row's lines: the next date (a chip within two weeks), the practice line for a student, then the latest note's first line. */
export function StudentRowMeta({ row, now }: { row: StudentRow; now?: Date }) {
  const ceremony = row.ceremonyDate ? ceremonyCountdown(row.ceremonyDate, now) : null;
  const next = row.ceremonyDate ? nextDate({ ceremonyDate: row.ceremonyDate, rehearsal1: row.rehearsal1 ?? null, rehearsal2: row.rehearsal2 ?? null }, now) : null;
  // A Beit Mitzvah chip already says how far away it is; otherwise the date keeps its days-to-go phrase.
  const date = ceremony ? (next?.chip && next.kind === "ceremony" ? ceremony.label : ceremony.phrase ? `${ceremony.label} · ${ceremony.phrase}` : ceremony.label) : null;
  if (!date && !row.studentId && !row.note) return null;
  return <>
    {date && <span className={styles.metaLine} data-testid="student-row-date">{next?.chip && <><Chip tone="attention">{next.chip}</Chip> </>}{date}</span>}
    {row.studentId && <span className={styles.metaLine}><TutorCardLine studentId={row.studentId} /></span>}
    {row.note && <span className={styles.metaLine}>{row.note}</span>}
  </>;
}

export function YourStudentsView({ state, onRetry }: { state: State; onRetry: () => void }) {
  return <section className={styles.section} aria-label={YOUR_STUDENTS_STRINGS.title} aria-busy={state.status === "loading"} data-testid="mine-students">
    <h2 className={styles.sectionTitle}>{YOUR_STUDENTS_STRINGS.title}</h2>
    {state.status === "failed" && <><p className={styles.findStatus} role="status">{YOUR_STUDENTS_STRINGS.failed}</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button></>}
    {state.status === "ready" && state.rows.length === 0 && <p className={styles.findStatus}>{YOUR_STUDENTS_STRINGS.none}</p>}
    {state.status === "ready" && state.rows.length > 0 && <List testId="mine-students-list">
      {state.rows.map(row => <ListRow key={row.key} title={<bdi dir="auto">{row.name}</bdi>} meta={row.ceremonyDate || row.studentId || row.note ? <StudentRowMeta row={row} /> : undefined} trailing={<span>{YOUR_STUDENTS_STRINGS.open}</span>} href={row.href} />)}
    </List>}
  </section>;
}

/** The live section: the tutor's own students (the portal's list), the claimed learners from the directory, and each student's latest lesson note. */
export function YourStudents({ round = 0 }: { round?: number }) {
  const [state, setState] = useState<State>({ status: "loading" }), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // A claim or a removal in Find a learner (round) refreshes the rows in place; only the first load says it is loading.
    setState(current => current.status === "ready" ? current : { status: "loading" });
    (async () => {
      const [students, learners] = await Promise.all([workspaceApi.students("tutor", undefined, controller.signal), fetchLearners("", controller.signal).catch((): readonly Learner[] => [])]);
      const notes = new Map<string, string | null>();
      await Promise.all(students.map(async student => {
        try { const page = await fetchLessons("tutor", student.id, { type: "page" }, controller.signal); notes.set(student.id, "entries" in page ? firstLine(page.entries[0]?.summary) : null); }
        catch { notes.set(student.id, null); }
      }));
      if (!controller.signal.aborted) setState({ status: "ready", rows: studentRows(students, learners, notes) });
    })().catch(() => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    return () => controller.abort();
  }, [retry, round]);
  return <YourStudentsView state={state} onRetry={() => setRetry(value => value + 1)} />;
}
