"use client";
import { useMemo, useState } from "react";
import type { FirstVerse as FirstVerseActivity, Lesson } from "../../lib/learn/course";
import { firstVerseCandidates, ownVerseCandidates } from "../../lib/learn/first-verse";
import { leinHref } from "./lein-link";
import { LoadFailure } from "./bits";
import { useCourseVerses } from "./course-data";
import { GuidedPreparation } from "./guided-preparation";
import { useReadingVerses } from "./week-data";
import styles from "./learn.module.css";

/** Keep the established lesson IDs/progress contract while teaching a complete preparation loop. */
export function FirstVerse({ lesson, onDone }: { lesson: Lesson; onDone(): void }) {
  const activity = lesson.activities.find((row): row is FirstVerseActivity => row.type === "first-verse")!;
  const kind = activity.params.kind, week = useReadingVerses(kind), fallbackData = useCourseVerses(useMemo(() => [lesson], [lesson]));
  const weekCandidates = useMemo(() => week.status !== "ready" ? [] : week.source === "own" ? ownVerseCandidates(week.verses) : firstVerseCandidates(week.verses, activity.params.maxWords), [week, activity.params.maxWords]);
  const fallback = useMemo(() => fallbackData.status === "ready" ? (fallbackData.examples.get(lesson.id) ?? []).map(row => row.verse) : [], [fallbackData, lesson.id]);
  const candidates = [...weekCandidates.map(verse => ({ verse, fromWeek: true })), ...fallback.filter(verse => !weekCandidates.some(other => other.ref === verse.ref)).map(verse => ({ verse, fromWeek: false }))];
  const [choice, setChoice] = useState(0);
  const settled = week.status !== "loading" && (weekCandidates.length > 0 || fallbackData.status !== "loading");
  if (!settled) return <p role="status" className={styles.state}>Loading the reading…</p>;
  if (week.status === "none" && kind === "haftarah" && !fallback.length) return <p>No recording for this haftarah yet.</p>;
  const selected = candidates[choice % Math.max(1, candidates.length)];
  if (!selected) return <LoadFailure rateLimited={week.status === "error" && week.rateLimited || fallbackData.status === "error" && fallbackData.rateLimited} onRetry={() => window.location.reload()} />;
  const { verse, fromWeek } = selected, own = fromWeek && week.status === "ready" && week.source === "own", position = week.status === "ready" ? week.refs.indexOf(verse.ref) + 1 : 0;
  const lein = fromWeek && !own && week.status === "ready" && position > 0 ? leinHref({ date: week.date, kind, verse: position }) : leinHref({ ref: verse.ref, kind, verse: 1 });
  return <>
    <p className={styles.listen}>{own ? "In your reading" : fromWeek ? "One verse from this week's reading." : "A teaching example from the course."}</p>
    {own && <p className={styles.muted}><a href="/workspace/student?tab=reading">Back to my reading</a></p>}
    {!fromWeek && !weekCandidates.length && <p className={styles.muted}>From the course's own verses while this week's recording is not ready.</p>}
    {fromWeek && !own && week.status === "ready" && week.shifted && <p className={styles.muted}>Showing the coming Shabbat.</p>}
    <GuidedPreparation key={`${verse.kind}:${verse.ref}`} verse={verse} lein={activity.params.openInLein ? lein : null} onDone={onDone}
      onAnother={candidates.length > 1 ? () => setChoice(value => value + 1) : undefined} />
  </>;
}
