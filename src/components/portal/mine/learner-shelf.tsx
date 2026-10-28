"use client";
import { useEffect, useState } from "react";
import { PageHeader } from "../../ui";
import { readAddress } from "../public-reading/urls";
import { sortOwnReadings } from "./model";
import { fetchLearner, fetchLearnerReadings, type Learner, type LearnerReadings } from "./api";
import { longDate } from "./own-readings";
import styles from "../saved/saved.module.css";
import { NAMELESS_LEARNER } from "../../../lib/learner-name";

/** A learner's shelf as the tutor who claims them, or the rabbi, sees it (plan D7): the same "Also working on" list, read-only. */
export const LEARNER_SHELF_STRINGS = Object.freeze({ title: "Also working on", fallback: NAMELESS_LEARNER, missing: "This learner isn’t yours to see.", failed: "The readings didn’t load.", none: "Nothing is saved yet." });
/** "{Name}’s readings": the shelf says whose it is (tutor walk 2026-10-28, finding 10). */
export const learnerReadingsTitle = (name: string) => `${name}’s readings`;
const displayRange = (ranges: string) => ranges.replace(/(\d)-(\d)/g, "$1–$2");
/** Where a learner's reading opens: the reading page in its read-only learner view. */
export const learnerReadingHref = (membershipId: string, id: string) => readAddress({ mode: "saved", id, learner: membershipId });
type State = Readonly<{ status: "loading" } | { status: "ready"; readings: LearnerReadings } | { status: "failed" }>;

export function LearnerShelfView({ membershipId, learner, state, onRetry }: { membershipId: string; learner: Learner | null; state: State; onRetry: () => void }) {
  const name = learner?.name ?? LEARNER_SHELF_STRINGS.fallback;
  const readings = state.status === "ready" && state.readings.state === "ready" ? sortOwnReadings(state.readings.readings) : [];
  // A learner who isn't the viewer's to see has no "Also working on" heading over the refusal (tutor walk 2026-10-28).
  const denied = state.status === "ready" && state.readings.state !== "ready";
  return <section className="role-workspace" data-testid="learner-shelf" data-learner={membershipId} aria-busy={state.status === "loading"}>
    <PageHeader title={name} description={learner?.student ? `${learner.student.firstName} ${learner.student.lastName} · ${longDate(learner.student.ceremonyDate)}` : undefined} />
    <section className={styles.mine} aria-labelledby={denied ? undefined : "learner-readings-title"} data-testid="learner-own">
      {!denied && <h2 id="learner-readings-title" className={styles.mineTitle}>{learner ? learnerReadingsTitle(learner.name) : LEARNER_SHELF_STRINGS.title}</h2>}
      {state.status === "loading" && <p className={styles.mineLine}>Finding the readings.</p>}
      {state.status === "failed" && <><p className={styles.mineLine} role="status">{LEARNER_SHELF_STRINGS.failed}</p><button type="button" className={`button-secondary ${styles.more}`} onClick={onRetry}>Try again</button></>}
      {denied && <p className={styles.mineLine} role="status">{LEARNER_SHELF_STRINGS.missing}</p>}
      {state.status === "ready" && state.readings.state === "ready" && readings.length === 0 && <p className={styles.mineLine}>{LEARNER_SHELF_STRINGS.none}</p>}
      {readings.length > 0 && <ul className={styles.list}>
        {readings.map(reading => <li key={reading.id}><a className={styles.item} href={learnerReadingHref(membershipId, reading.id)}>
          <span className={styles.itemName}><bdi>{reading.name}</bdi></span>
          <span className={styles.itemMeta}>{reading.date ? <time dateTime={reading.date}>{longDate(reading.date)}</time> : "No date"} · {reading.kind === "torah" ? "Torah" : "Haftarah"} <bdi dir="ltr">{displayRange(reading.ranges)}</bdi></span>
        </a></li>)}
      </ul>}
    </section>
  </section>;
}

export function LearnerShelf({ membershipId }: { membershipId: string }) {
  const [state, setState] = useState<State>({ status: "loading" }), [learner, setLearner] = useState<Learner | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchLearnerReadings(membershipId, controller.signal).then(readings => { if (!controller.signal.aborted) setState({ status: "ready", readings }); }, () => { if (!controller.signal.aborted) setState({ status: "failed" }); });
    fetchLearner(membershipId, controller.signal).then(row => { if (!controller.signal.aborted) setLearner(row); }, () => undefined);
    return () => controller.abort();
  }, [membershipId, retry]);
  return <LearnerShelfView membershipId={membershipId} learner={learner} state={state} onRetry={() => setRetry(value => value + 1)} />;
}
