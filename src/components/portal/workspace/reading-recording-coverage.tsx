"use client";
import { useEffect, useId, useRef, useState } from "react";
import { expandReadingRanges, readingSegments } from "../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import type { PlaybackCoverage, VerseRecordingCoverage } from "../../../lib/reference-audio/reading-coverage";
import { PortalRequestError } from "../api";
import { call } from "./api";
import type { ReadingKind, StaffMode } from "./reading-proposal";
import styles from "./reading-selection.module.css";

type Coverage = { status: "checked"; verses: VerseRecordingCoverage[] }
  | { status: "listening-disabled" | "loading" | "unavailable" };
const isSource = (value: unknown): value is PlaybackCoverage => value === "shermet" || value === "pockettorah" || value === "missing" || value === "unknown";

export function parseRecordingCoverage(value: unknown, refs: readonly string[]): Coverage {
  const bad = () => new PortalRequestError(503);
  if (!value || typeof value !== "object") throw bad();
  const row = value as Record<string, unknown>;
  if (row.status === "listening-disabled" && Object.keys(row).length === 1) return { status: row.status };
  if (row.status !== "checked" || Object.keys(row).length !== 2 || !Array.isArray(row.verses) || row.verses.length !== refs.length) throw bad();
  const verses = row.verses.map((item: unknown, index): VerseRecordingCoverage => {
    if (!item || typeof item !== "object" || Object.keys(item).length !== 3) throw bad();
    const { ref, verse, word } = item as Record<string, unknown>;
    if (ref !== refs[index] || !isSource(verse) || !isSource(word)) throw bad();
    return { ref, verse, word };
  });
  return { status: "checked", verses };
}

export function useReadingRecordingCoverage(scope: string | null, studentId: string | undefined, mode: StaffMode, kind: ReadingKind, selection: string, denied?: (status: number) => void) {
  const [loaded, setLoaded] = useState<{ key: string; coverage: Coverage }>();
  const requestKey = scope && studentId && selection ? JSON.stringify([scope, studentId, mode, kind, selection]) : null;
  const current = useRef({ requestKey, denied });
  current.current = { requestKey, denied };
  useEffect(() => {
    if (!studentId || !requestKey) { setLoaded(undefined); return; }
    const ranges = readingSegments(selection);
    let refs: string[];
    try { refs = expandReadingRanges(ranges, kind, TANAKH_VERSE_COUNTS); }
    catch { setLoaded({ key: requestKey, coverage: { status: "unavailable" } }); return; }
    const controller = new AbortController();
    const live = () => !controller.signal.aborted && current.current.requestKey === requestKey;
    const timer = setTimeout(() => {
      void call(`/api/students/${encodeURIComponent(studentId)}/reading/recording-coverage`, { mode, kind, ranges }, undefined, controller.signal, undefined, 55_000)
        .then(value => parseRecordingCoverage(value, refs))
        .then(coverage => { if (live()) setLoaded({ key: requestKey, coverage }); })
        .catch(error => {
          if (!live()) return;
          if (error instanceof PortalRequestError && [401, 403, 404].includes(error.status) && current.current.denied) {
            current.current.denied(error.status);
          } else setLoaded({ key: requestKey, coverage: { status: "unavailable" } });
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [requestKey, studentId, mode, kind, selection]);
  return { requestKey, coverage: requestKey ? loaded?.key === requestKey ? loaded.coverage : { status: "loading" as const } : null };
}

const credits = { shermet: "Cantor Wendy Shermet", pockettorah: "PocketTorah", missing: "Unavailable", unknown: "Could not check" } as const;
const list = new Intl.ListFormat("en-US");
const pageSize = 25;

function counts(verses: readonly VerseRecordingCoverage[], type: "verse" | "word") {
  const result = { shermet: 0, pockettorah: 0, missing: 0, unknown: 0 };
  for (const verse of verses) result[verse[type]]++;
  return list.format((["shermet", "pockettorah"] as const).flatMap(source => result[source] ? [`${result[source]} from ${credits[source]}`] : [])) || "None confirmed";
}

function CoverageDetails({ verses }: { verses: readonly VerseRecordingCoverage[] }) {
  const [page, setPage] = useState(0);
  const start = page * pageSize, end = Math.min(start + pageSize, verses.length);
  return <details className={styles.coverageDetails}>
    <summary>Recording details by verse</summary>
    <ul className={styles.coverageVerses}>{verses.slice(start, end).map(row => <li key={row.ref}>
      <strong>{row.ref}</strong>
      <span>Whole verse · {credits[row.verse]}</span>
      <span>Word practice · {credits[row.word]}</span>
    </li>)}</ul>
    {verses.length > pageSize && <div className={styles.coveragePages}>
      <span role="status">Verses {start + 1}–{end} of {verses.length}</span>
      <button type="button" className="button-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous verses</button>
      <button type="button" className="button-secondary" disabled={end === verses.length} onClick={() => setPage(page + 1)}>Next verses</button>
    </div>}
  </details>;
}

export function ReadingRecordingCoverage({ coverage }: { coverage: Coverage }) {
  const title = useId();
  const verses = coverage.status === "checked" ? coverage.verses : null;
  const wholeVerseOnly = verses?.filter(row => row.verse !== "missing" && row.verse !== "unknown" && row.word === "missing").length ?? 0;
  const textOnly = verses?.filter(row => row.verse === "missing" && row.word === "missing").length ?? 0;
  const unchecked = verses?.filter(row => row.verse === "unknown" || row.word === "unknown").length ?? 0;
  return <section className={styles.coverage} aria-labelledby={title}>
    <h3 id={title}>Recording coverage</h3>
    <div role="status">
      {coverage.status === "loading" && <p>Checking recordings…</p>}
      {coverage.status === "unavailable" && <p>Recording coverage could not be checked. You can still assign these verses.</p>}
      {coverage.status === "listening-disabled" && <p>Listening isn’t available for students yet.</p>}
      {verses && <>
        <p><strong>Whole verse</strong> {counts(verses, "verse")}</p>
        <p><strong>Word practice</strong> {counts(verses, "word")}</p>
        {wholeVerseOnly > 0 && <p>{wholeVerseOnly} {wholeVerseOnly === 1 ? "verse has" : "verses have"} whole-verse audio only.</p>}
        {textOnly > 0 && <p>{textOnly} {textOnly === 1 ? "verse has" : "verses have"} text only.</p>}
        {unchecked > 0 && <p>Some recording checks failed for {unchecked} {unchecked === 1 ? "verse" : "verses"}. You can still assign these verses.</p>}
      </>}
    </div>
    {verses && <CoverageDetails verses={verses} />}
  </section>;
}
