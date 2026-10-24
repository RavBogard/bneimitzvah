"use client";
import { useEffect, useState } from "react";
import type { Melody } from "../../lib/learn/course";
import { analyseVerse, type AnalysedVerse } from "../../lib/learn/verse";
import { addDays, thisShabbat } from "../../lib/readings/public-shabbat";
import { fetchPublicWeek } from "../portal/public-reading/api";
import { isRateLimited } from "../portal/public-reading/rate-limited";
import { useLearnServices } from "./services";

/**
 * This Shabbat's reading for the course: the week from /api/public/reading?date=, then the passage
 * through the public ref routes, each verse analysed. A week with no reading of this kind (a festival
 * Shabbat) moves to the coming Shabbat. A verse ends its recording when the next verse comes from
 * another recording, or the passage ends.
 */
export type WeekVerses = Readonly<{ status: "loading" } | { status: "error"; rateLimited?: boolean } | { status: "none" }
  | { status: "ready"; date: string; shifted: boolean; verses: readonly AnalysedVerse[]; recorded: boolean; refs: readonly string[] }>;

export function useWeekVerses(kind: Melody, retry = 0): WeekVerses {
  const { loader, audio } = useLearnServices();
  const [state, setState] = useState<WeekVerses>({ status: "loading" });
  useEffect(() => {
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
  }, [kind, retry, loader, audio]);
  return state;
}
