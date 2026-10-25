"use client";
import { useMemo, useState } from "react";
import { familyName, type Lesson, type ThisWeek } from "../../lib/learn/course";
import { buildPools, poolOf, type Phrase } from "../../lib/learn/pools";
import type { AnalysedVerse } from "../../lib/learn/verse";
import { AudioError, FamilyChip, phraseRequest, PlayTile, UnitsText } from "./bits";
import { RATE_LIMITED_MESSAGE } from "../portal/public-reading/rate-limited";
import type { ExampleVerse } from "./course-data";
import { useReadingVerses } from "./week-data";
import styles from "./learn.module.css";

const READER_VERSES = 60, COUNT: Record<number, string> = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" };
/** Rows of the family in this Shabbat's reading, then "Find three more." in a small reader (ACTIVITIES.md 6). */
export function ThisWeekSection({ activity, lesson, fallback = [] }: { activity: ThisWeek; lesson: Lesson; fallback?: readonly ExampleVerse[] }) {
  const kind = activity.params.kind ?? lesson.melody, family = activity.params.family;
  const [retry, setRetry] = useState(0), week = useReadingVerses(kind, retry);
  const pools = useMemo(() => week.status === "ready" ? buildPools(week.verses) : null, [week]);
  const rows = useMemo(() => {
    if (!pools) return [];
    const seen = new Set<string>(), out: Phrase[] = [];
    for (const phrase of poolOf(pools, family, kind)) if (!seen.has(phrase.ref) && out.length < activity.params.show) { seen.add(phrase.ref); out.push(phrase); }
    return out;
  }, [pools, family, kind, activity.params.show]);
  // A signed-in student's own assigned reading (1.9 N17): its heading is "In your reading", and it shows nothing when the reading has no such phrase.
  const own = week.status === "ready" && week.source === "own", title = own ? "In your reading" : "In this week's reading";
  const heading = <h2 className={styles.sectionTitle}>{title}</h2>;
  if (own && !rows.length) return null;
  if (week.status === "loading") return <section className={styles.week}>{heading}<p role="status" className={styles.muted}>Loading the reading…</p></section>;
  if (week.status === "error") return <section className={styles.week}>{heading}<p role="status">{week.rateLimited ? RATE_LIMITED_MESSAGE : "The reading didn't load. Check your connection and try again."}</p>
    <button type="button" className="button-secondary" onClick={() => setRetry(n => n + 1)}>Try again</button></section>;
  if (week.status === "none" || !week.recorded) {
    if (kind === "haftarah") return <section className={styles.week}>{heading}<p>No recording for this haftarah yet.</p></section>;
    return <section className={styles.week}>{heading}{fallback.length > 0 && <><p className={styles.muted}>From the course's own verses while this week's recording is not ready.</p>
      <ul className={styles.weekRows}>{fallback.slice(0, activity.params.show).map(row => <Row key={row.example.ref} verse={row.verse} words={row.example.words} family={family} />)}</ul></>}</section>;
  }
  return <section className={styles.week} aria-labelledby="this-week-heading">
    <h2 id="this-week-heading" className={styles.sectionTitle}>{title}</h2>
    {week.shifted && <p className={styles.muted}>Showing the coming Shabbat.</p>}
    {rows.length > 0 && <ul className={styles.weekRows}>{rows.map(phrase => <Row key={phrase.ref} verse={week.verses.find(verse => verse.ref === phrase.ref)!} words={phrase.words} family={family} />)}</ul>}
    {activity.params.find > 0 && <Finder verses={week.verses.filter(verse => verse.wordReady).slice(0, READER_VERSES)} family={family} need={activity.params.find} skip={new Set(rows.map(row => `${row.ref}#${row.words[0]}`))} />}
  </section>;
}
function Row({ verse, words, family }: { verse: AnalysedVerse; words: readonly [number, number]; family: Lesson["family"] }) {
  const id = `week:${verse.ref}:${words[0]}`;
  return <li className={styles.verseRow}>
    <PlayTile id={id} iconOnly label={`Hear ${verse.ref}`} requests={[phraseRequest(verse, words)]} />
    <div><UnitsText playback={[id]} verse={verse} units={words} className={styles.phraseStandard} look={() => "inked"} />
      <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi>{family && <span className="sr-only">, {familyName(family)}</span>}</p><AudioError id={id} /></div>
  </li>;
}
/** The small reader: tap phrases of the family; each find colours; a miss names its own family. A find plays
 * nothing (the rows above have the play tiles); once all are found, a tapped word opens its card. */
function Finder({ verses, family, need, skip }: { verses: readonly AnalysedVerse[]; family: NonNullable<Lesson["family"]>; need: number; skip: ReadonlySet<string> }) {
  const [open, setOpen] = useState(false), [found, setFound] = useState<string[]>([]), [miss, setMiss] = useState<{ key: string; line: string } | null>(null);
  const available = verses.reduce((sum, verse) => sum + verse.phrases.filter(phrase => phrase.family === family && !skip.has(`${verse.ref}#${phrase.units[0]}`)).length, 0);
  const target = Math.min(need, available), done = found.length >= target;
  if (!target) return null;
  const prompt = `Find ${COUNT[target] ?? target} more.`;
  if (!open) return <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>{prompt}</button>;
  const tap = (verse: AnalysedVerse, index: number) => {
    const phrase = verse.phrases[index], key = `${verse.ref}#${phrase.units[0]}`;
    if (phrase.family === family) { if (!skip.has(key) && !found.includes(key) && !done) setFound([...found, key]); setMiss(null); }
    else setMiss({ key, line: `That one is ${familyName(phrase.family)}.` });
  };
  return <div className={styles.reader}>
    <p className={styles.prompt}>{prompt}</p>
    <p role="status" className={done ? styles.found : styles.feedback}>{done ? `${target} of ${target} found.` : miss?.line ?? ""}</p>
    <div className={styles.reader} style={{ maxHeight: "60vh", overflowY: "auto" }} tabIndex={0} aria-label="This week's reading">
      {verses.map(verse => <div key={verse.ref} className={styles.readerVerse}>
        <p className={`${styles.hebrew} ${styles.phraseStandard}`} lang="he" dir="rtl">{verse.phrases.map((phrase, index) => {
          const key = `${verse.ref}#${phrase.units[0]}`, shown = found.includes(key) || skip.has(key) && phrase.family === family;
          return <span key={index}>{index > 0 && " "}{done ? <span className={miss?.key === key ? styles.missed : undefined}><UnitsText as="span" verse={verse} units={phrase.units} look={() => shown ? "inked" : "plain"} /></span>
            : <span role="button" tabIndex={0} className={`${styles.target}${miss?.key === key ? ` ${styles.missed}` : ""}`} aria-label={`${verse.ref}, phrase ${index + 1}`}
            onClick={() => tap(verse, index)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); tap(verse, index); } }}>
            <UnitsText as="span" verse={verse} units={phrase.units} look={() => shown ? "inked" : "plain"} card={false} /></span>}</span>;
        })}</p>
        <p className={styles.ref}><bdi dir="ltr">{verse.ref}</bdi></p>
      </div>)}
    </div>
    {done && <FamilyChip family={family} melody={verses[0]?.kind ?? "torah"} />}
  </div>;
}
