"use client";
import { useEffect, useState } from "react";
import type { Melody } from "../../lib/learn/course";
import { analyseVerse, type AnalysedVerse } from "../../lib/learn/verse";
import { addDays, thisShabbat } from "../../lib/readings/public-shabbat";
import { fetchPublicWeek } from "../portal/public-reading/api";
import { isRateLimited } from "../portal/public-reading/rate-limited";
import { referencePassageFlags } from "../../lib/learn/passage-preparation";
import { useOwnReading } from "./own-reading";
import { useLearnServices } from "./services";

/**
 * This Shabbat's reading for the course: the week from /api/public/reading?date=, then the passage
 * through the public ref routes, each verse analysed. A week with no reading of this kind (a festival
 * Shabbat) moves to the coming Shabbat. A verse ends its recording when the next verse comes from
 * another recording, or the passage ends.
 */
export type WeekVerses = Readonly<{ status: "loading" } | { status: "error"; rateLimited?: boolean } | { status: "none" }
  | { status: "ready"; date: string; shifted: boolean; verses: readonly AnalysedVerse[]; recorded: boolean; refs: readonly string[] }>;

export function useWeekVerses(kind: Melody, retry = 0, enabled = true): WeekVerses {
  const { loader, audio } = useLearnServices();
  const [state, setState] = useState<WeekVerses>({ status: "loading" });
  useEffect(() => {
    // Off while a signed-in student's own reading answers: no request for this week's reading is made.
    if (!enabled) { setState({ status: "loading" }); return; }
    const controller = new AbortController(), signal = controller.signal;
    setState({ status: "loading" });
    (async () => {
      let date = thisShabbat(), week = await fetchPublicWeek(date, signal), shifted = false;
      if (!week[kind]) { date = addDays(date, 7); week = await fetchPublicWeek(date, signal); shifted = true; }
      const passage = week[kind];
      if (!passage) { setState({ status: "none" }); return; }
      const ref = passage.ranges.join("; "), loaded = await loader.passage(ref, kind);
      const assets = loaded.map(verse => verse.short?.verse.playback.status === "ready" ? verse.short.verse.playback.asset : null);
      const verses = (await Promise.all(loaded.map(async (verse, i) => {
        const wordReady = verse.short?.source ? await audio.wordReady(verse.ref, kind, signal) : false;
        const last = i === loaded.length - 1, endsRecording = last ? true : assets[i] && assets[i + 1] ? assets[i] !== assets[i + 1] : null;
        return analyseVerse({ ref: verse.ref, kind, hebrew: verse.hebrew, final: kind === "haftarah" && last, endsRecording, wordReady, passage: { ref, index: i, count: loaded.length } });
      }))).filter((verse): verse is AnalysedVerse => verse !== null);
      if (!signal.aborted) setState({ status: "ready", date, shifted, verses, recorded: verses.some(verse => verse.wordReady), refs: loaded.map(verse => verse.ref) });
    })().catch(error => { if (!signal.aborted) setState(isRateLimited(error) ? { status: "error", rateLimited: true } : { status: "error" }); });
    return () => controller.abort();
  }, [kind, retry, enabled, loader, audio]);
  return state;
}

/**
 * The reading Learn draws on (1.9 N17): a signed-in student's own assigned reading of this kind, otherwise this Shabbat's.
 * The own reading loads through the same public ref routes as any passage; a reading that cannot be loaded, or has no word-ready
 * recording, falls back to this week's. A signed-out visitor never asks for an assignment and gets this week's, as before.
 */
export type ReadingVerses = Readonly<WeekVerses & { source?: "week" } | Extract<WeekVerses, { status: "ready" }> & { source: "own"; ref: string }>;
type OwnVerses = Readonly<{ status: "off" | "loading" | "failed" } | { status: "ready"; ref: string; verses: readonly AnalysedVerse[]; refs: readonly string[] }>;

function useOwnVerses(kind: Melody, ranges: readonly string[] | null, retry: number): OwnVerses {
  const { loader, audio } = useLearnServices();
  const [state, setState] = useState<OwnVerses>({ status: "off" });
  const ref = ranges ? ranges.join("; ") : null;
  useEffect(() => {
    if (!ref) { setState({ status: "off" }); return; }
    const controller = new AbortController(), signal = controller.signal;
    setState({ status: "loading" });
    (async () => {
      const loaded = await loader.passage(ref, kind);
      const assets = loaded.map(verse => verse.short?.verse.playback.status === "ready" ? verse.short.verse.playback.asset : null);
      const verses = (await Promise.all(loaded.map(async (verse, index) => analyseVerse({ ref: verse.ref, kind, hebrew: verse.hebrew, ...referencePassageFlags(assets, index),
        wordReady: !!verse.short?.source && await audio.wordReady(verse.ref, kind, signal), passage: { ref, index, count: loaded.length } }))))
        .filter((verse): verse is AnalysedVerse => verse !== null);
      if (signal.aborted) return;
      setState(verses.some(verse => verse.wordReady) ? { status: "ready", ref, verses, refs: loaded.map(verse => verse.ref) } : { status: "failed" });
    })().catch(() => { if (!signal.aborted) setState({ status: "failed" }); });
    return () => controller.abort();
  }, [kind, ref, retry, loader, audio]);
  return state;
}

/**
 * `weekFallback: false` (N19a: a lesson that starts on a course verse) never asks for this week's reading: without a usable own
 * reading the answer is "none", and the page goes straight to the course's own verses.
 */
export function useReadingVerses(kind: Melody, retry = 0, weekFallback = true): ReadingVerses {
  const own = useOwnReading(), reading = own.status === "ready" ? own[kind] : null;
  const mine = useOwnVerses(kind, reading ? reading.ranges : null, retry);
  const useWeek = weekFallback && (own.status === "none" || own.status === "ready" && (!reading || mine.status === "failed"));
  const week = useWeekVerses(kind, retry, useWeek);
  if (own.status === "pending") return { status: "loading" };
  if (reading && mine.status === "ready") return { status: "ready", source: "own", ref: mine.ref, date: "", shifted: false, verses: mine.verses, recorded: true, refs: mine.refs };
  if (reading && mine.status !== "failed") return { status: "loading" };
  if (!weekFallback) return { status: "none" };
  return week;
}
