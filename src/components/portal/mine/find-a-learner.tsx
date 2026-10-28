"use client";
import { useEffect, useId, useRef, useState } from "react";
import { claimLearner, fetchLearners, unclaimLearner, type Learner } from "./api";
import { longDate } from "./own-readings";
import styles from "./shelf.module.css";

/**
 * Find a learner (decision 15): every signed-in learner with a shelf, by name, with "Add to my students" in one tap. Search first (tutor
 * walk 2026-10-28, finding 8): nothing is listed until something is typed. A learner who already has a tutor says so in place of the button
 * (finding 7); the tutor who claimed a learner may remove the claim, as the rabbi may (finding 6).
 */
export const FIND_STRINGS = Object.freeze({
  title: "Find a learner", claim: "Add to my students", removeClaim: "Remove from my students", noTutor: "No tutor yet", tutor: "Tutor: ", next: "next ", hasTutorShort: "Has a tutor", yours: "Your student",
  claimed: (name: string) => `${name} was added to your students.`, hasTutor: "This learner already has a tutor.", failed: "That didn’t work. Try again.", none: "No learners found.",
});
export const learnerShelfHref = (membershipId: string) => `/mine/learner/${encodeURIComponent(membershipId)}`;
const readings = (n: number) => `${n} ${n === 1 ? "reading" : "readings"}`;
type Status = Readonly<{ status: "idle" | "loading" | "failed" } | { status: "ready"; rows: readonly Learner[] }>;

/** One row: name · n readings · next date (when there is one) · Tutor: name or No tutor yet, then the claim, Has a tutor or Your student (tutor), and the undo (the claiming tutor, or an admin). */
export function LearnerRow({ row, tutor, admin, pending, onClaim, onUnclaim }: { row: Learner; tutor: boolean; admin: boolean; pending: boolean; onClaim: () => void; onUnclaim: () => void }) {
  const mine = row.tutor?.mine === true, opens = mine || admin, removable = row.tutor?.claimed === true && (admin || (tutor && mine));
  return <li className={styles.learnerRow} data-testid="learner-row" data-learner={row.membershipId}>
    <span className={styles.learnerMain}>
      {opens ? <a className={styles.learnerName} href={learnerShelfHref(row.membershipId)}><bdi dir="auto">{row.name}</bdi></a> : <span className={styles.learnerName}><bdi dir="auto">{row.name}</bdi></span>}
      <span className={styles.learnerMeta}> · {readings(row.readings)}{row.nearest && <> · {FIND_STRINGS.next}<time dateTime={row.nearest.date}>{longDate(row.nearest.date)}</time></>} · {row.tutor ? <>{FIND_STRINGS.tutor}<bdi dir="auto">{row.tutor.name}</bdi></> : FIND_STRINGS.noTutor}</span>
    </span>
    {tutor && !row.tutor && <button type="button" className="button-secondary" disabled={pending} aria-label={`${FIND_STRINGS.claim}: ${row.name}`} onClick={onClaim}>{FIND_STRINGS.claim}</button>}
    {tutor && row.tutor && !removable && <span className={styles.learnerState} data-testid="learner-state">{mine ? FIND_STRINGS.yours : FIND_STRINGS.hasTutorShort}</span>}
    {removable && <button type="button" className="button-secondary" disabled={pending} aria-label={`${FIND_STRINGS.removeClaim}: ${row.name}`} onClick={onUnclaim}>{FIND_STRINGS.removeClaim}</button>}
  </li>;
}

export function FindALearnerView({ query, state, tutor, admin, pending, status, problem, inputId, onQuery, onClaim, onUnclaim }: {
  query: string; state: Status; tutor: boolean; admin: boolean; pending: string | null; status: string | null; problem: string | null; inputId: string;
  onQuery: (value: string) => void; onClaim: (row: Learner) => void; onUnclaim: (row: Learner) => void;
}) {
  return <section className={styles.section} aria-labelledby={`${inputId}-title`} data-testid="mine-find">
    <h2 id={`${inputId}-title`} className={styles.sectionTitle}>{FIND_STRINGS.title}</h2>
    <label htmlFor={inputId} className="sr-only">{FIND_STRINGS.title}</label>
    <input id={inputId} type="search" className={styles.findInput} value={query} maxLength={80} autoComplete="off" onChange={event => onQuery(event.target.value)} />
    {status && <p className={styles.findStatus} role="status">{status}</p>}
    {problem && <p className="request-error" role="alert">{problem}</p>}
    {state.status === "failed" && <p className={styles.findStatus} role="status">{FIND_STRINGS.failed}</p>}
    {state.status === "ready" && state.rows.length === 0 && <p className={styles.findStatus}>{FIND_STRINGS.none}</p>}
    {state.status === "ready" && state.rows.length > 0 && <ul className={styles.learnerList} aria-busy={pending !== null}>
      {state.rows.map(row => <LearnerRow key={row.membershipId} row={row} tutor={tutor} admin={admin} pending={pending === row.membershipId} onClaim={() => onClaim(row)} onUnclaim={() => onUnclaim(row)} />)}
    </ul>}
  </section>;
}

/** The live section: the list follows the search field (a short pause after typing), and a claim refreshes the rows. */
export function FindALearner({ roles, onChange }: { roles: readonly string[]; onChange?: () => void }) {
  const tutor = roles.includes("tutor"), admin = roles.includes("admin");
  const [query, setQuery] = useState(""), [state, setState] = useState<Status>({ status: "idle" }), [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null), [problem, setProblem] = useState<string | null>(null), [round, setRound] = useState(0);
  const inputId = useId(), gate = useRef(false);
  const searched = query.trim() !== "";
  useEffect(() => {
    if (!searched) { setState({ status: "idle" }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState(current => current.status === "ready" ? current : { status: "loading" });
      fetchLearners(query, controller.signal).then(rows => { if (!controller.signal.aborted) setState({ status: "ready", rows }); }, () => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, searched, round]);
  const act = async (row: Learner, run: () => Promise<string | null>) => {
    if (gate.current) return;
    gate.current = true; setPending(row.membershipId); setStatus(null); setProblem(null);
    try { const next = await run(); if (next !== null) setStatus(next); setRound(value => value + 1); onChange?.(); }
    catch { setProblem(FIND_STRINGS.failed); }
    finally { gate.current = false; setPending(null); }
  };
  const claim = (row: Learner) => act(row, async () => { const result = await claimLearner(row.membershipId); if (!result.ok) { setProblem(FIND_STRINGS.hasTutor); return null; } return FIND_STRINGS.claimed(row.name); });
  const unclaim = (row: Learner) => act(row, async () => { await unclaimLearner(row.membershipId); return null; });
  return <FindALearnerView query={query} state={state} tutor={tutor} admin={admin} pending={pending} status={status} problem={problem} inputId={inputId} onQuery={setQuery} onClaim={claim} onUnclaim={unclaim} />;
}
