"use client";
import { useEffect, useRef, useState } from "react";
import { ButtonLink, Chip } from "../../ui";
import { workspaceApi, type Assigned, type Reading, type Student } from "../workspace/api";
import { HonorsSheet } from "../workspace/honors/sheet";
import { ceremonyCountdown } from "../workspace/reading";
import { statusOf, useWorkspace } from "../workspace/provider";
import { sortStudentsByCeremony } from "../workspace/student-label";
import { parashahName, refSegments } from "../workspace/today/model";
import { gotCount, readMarks, type MarkSlice } from "../workspace/today/today";
import type { ProgressVerse } from "../../../lib/progress/types";
import { firstLine } from "./your-students";
import styles from "./shelf.module.css";

/** A parent's shelf (Readings for everyone E3): one card for each child, each with the reading, what the child has got, the latest note and the way in. */
export const CHILDREN_STRINGS = Object.freeze({ title: "Your children", open: "Open", serviceParts: "Service parts", honors: "Honors form", failed: "Your children didn’t load.", none: "No children are linked to this account yet." });

export type ChildCard = Readonly<{
  id: string; first: string; name: string; date: string;
  /** "Sat, May 1, 2027". */ dateLabel: string;
  /** "42 days", "Tomorrow", "Today", or null once it has passed. */ days: string | null;
  /** The parashah, when the Torah reading is one. */ readingName: string | null;
  /** "Torah Genesis 37:1–40:23 · Haftarah Amos 2:6–3:8", or null with no reading. */ ranges: string | null;
  /** How many verses the child has marked got it, and how many the reading has; null until read or when it cannot be. */ got: { got: number; total: number } | null;
  note: string | null;
}>;
type Detail = Readonly<{ readings: readonly Reading[]; marks: MarkSlice; note: string | null }>;
export const NO_DETAIL: Detail = Object.freeze({ readings: [], marks: { status: "loading" } as MarkSlice, note: null });

/** The words under a child's name: {n} days, Tomorrow or Today. */
export function daysWord(date: string, now = new Date()): string | null {
  const { days } = ceremonyCountdown(date, now);
  return days > 1 ? `${days} days` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : null;
}

/** One child's card, from the child's list row and what the parent's own reads returned for the child. Pure. */
export function childCard(student: Student, detail: Detail = NO_DETAIL, now = new Date()): ChildCard {
  const { readings, marks, note } = detail, torah = readings.find(row => row.kind === "torah");
  return Object.freeze({ id: student.id, first: student.firstName, name: `${student.firstName} ${student.lastName}`, date: student.ceremonyDate, dateLabel: ceremonyCountdown(student.ceremonyDate, now).label,
    days: daysWord(student.ceremonyDate, now), readingName: parashahName(torah),
    ranges: readings.length ? readings.flatMap(row => refSegments(row.ranges).map((segment, index) => `${index === 0 ? `${row.kind === "torah" ? "Torah" : "Haftarah"} ` : ""}${segment}`)).join(" · ") : null,
    got: readings.length ? gotCount(readings, marks) : null, note });
}
/** Nearest ceremony first, then by name, as the list orders children everywhere else. */
export const orderChildren = (students: readonly Student[]) => sortStudentsByCeremony([...students]);

export function ChildCardView({ card, onPractice, busy = false }: { card: ChildCard; onPractice(): void; busy?: boolean }) {
  const [honors, setHonors] = useState(false), href = `/mine/child/${encodeURIComponent(card.id)}`;
  return <li className={styles.childCard} data-testid="child-card" data-child-id={card.id}>
    <p className={styles.childHead}><Chip tone="attention">{`Beit Mitzvah · ${card.dateLabel}`}</Chip>{card.days && <span className={styles.childDays}>{card.days}</span>}</p>
    <h3 className={styles.childName}><bdi dir="auto">{card.name}</bdi></h3>
    {card.ranges && <p className={styles.childRanges}>{card.readingName ? `${card.readingName} · ` : ""}{card.ranges}</p>}
    {card.got && <p className={styles.childGot}>Verses <bdi dir="auto">{card.first}</bdi> has got: <span>{card.got.got} of {card.got.total}</span></p>}
    {card.note && <p className={styles.childNote} dir="auto">{card.note}</p>}
    <div className={styles.childActions}>
      <ButtonLink variant="primary" href={href}>{CHILDREN_STRINGS.open}</ButtonLink>
      <button type="button" className="button-secondary" disabled={busy} onClick={onPractice}>{busy ? "Opening practice…" : <>Practice with <bdi dir="auto">{card.first}</bdi></>}</button>
    </div>
    <ul className={styles.childLinks} aria-label={`${card.first}’s reading`}>
      <li><a href={`${href}#service-parts`}>{CHILDREN_STRINGS.serviceParts}</a></li>
      <li><button type="button" className="button-text" onClick={() => setHonors(true)}>{CHILDREN_STRINGS.honors}</button></li>
    </ul>
    {honors && <HonorsSheet studentId={card.id} name={card.name} mode="parent" onClose={() => setHonors(false)} />}
  </li>;
}

type State = Readonly<{ status: "loading" } | { status: "ready"; cards: readonly ChildCard[] } | { status: "failed" }>;
export function ChildrenView({ state, onRetry, onPractice, busy }: { state: State; onRetry(): void; onPractice(id: string): void; busy: boolean }) {
  return <section className={styles.section} aria-label={CHILDREN_STRINGS.title} aria-busy={state.status === "loading"} data-testid="mine-children">
    <h2 className={styles.sectionTitle}>{CHILDREN_STRINGS.title}</h2>
    {state.status === "failed" && <><p className={styles.findStatus} role="status">{CHILDREN_STRINGS.failed}</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button></>}
    {state.status === "ready" && state.cards.length === 0 && <p className={styles.findStatus}>{CHILDREN_STRINGS.none}</p>}
    {state.status === "ready" && state.cards.length > 0 && <ul className={styles.childList}>{state.cards.map(card => <ChildCardView key={card.id} card={card} busy={busy} onPractice={() => onPractice(card.id)} />)}</ul>}
  </section>;
}

/**
 * The live section: the parent's children, each read through the parent's own reads (the child's reading, the marks the parent may see and the lesson notes),
 * so a card shows nothing the child's page would not. A read that fails leaves its line out; the card is still a way in.
 */
export function ChildrenSection() {
  const { epoch, readVerified, readProgress, readLessons, selectChild, busy, serviceAuthorityFailed } = useWorkspace();
  const [state, setState] = useState<State>({ status: "loading" }), [retry, setRetry] = useState(0);
  // The reads are the provider's; a change in their identity must not start the load again, only the epoch (a new access check) or Try again does.
  const reads = useRef({ readVerified, readProgress, readLessons, serviceAuthorityFailed }); reads.current = { readVerified, readProgress, readLessons, serviceAuthorityFailed };
  useEffect(() => {
    const { readVerified, readProgress, readLessons, serviceAuthorityFailed } = reads.current;
    const controller = new AbortController();
    setState({ status: "loading" });
    (async () => {
      const students = orderChildren(await workspaceApi.students("parent", undefined, controller.signal));
      const details = await Promise.all(students.map(async (student): Promise<Detail> => {
        let value: Assigned;
        try { value = await readVerified("parent", student.id, controller.signal); } catch (error) { if (!controller.signal.aborted && [401, 403, 404].includes(statusOf(error))) serviceAuthorityFailed(statusOf(error)); return NO_DETAIL; }
        const [marks, note] = await Promise.all([
          (async (): Promise<MarkSlice> => {
            try { const next = new Map<Reading["kind"], readonly ProgressVerse[]>(); for (const reading of value.readings) next.set(reading.kind, await readMarks(readProgress, value, reading.kind, controller.signal)); return { status: "ready", value: next }; }
            catch { return { status: "unavailable" }; }
          })(),
          (async () => { try { const page = await readLessons("parent", student.id, { type: "page" }, controller.signal) as { entries?: { summary: string }[] }; return firstLine(page.entries?.[0]?.summary); } catch { return null; } })(),
        ]);
        return { readings: value.readings, marks, note };
      }));
      if (!controller.signal.aborted) setState({ status: "ready", cards: students.map((student, index) => childCard(student, details[index])) });
    })().catch(() => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    return () => controller.abort();
  }, [epoch, retry]);
  return <ChildrenView state={state} busy={busy} onRetry={() => setRetry(value => value + 1)} onPractice={id => void selectChild(id)} />;
}
