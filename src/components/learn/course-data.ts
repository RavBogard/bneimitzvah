"use client";
import { useEffect, useState } from "react";
import type { FamilyId } from "../../lib/trope/chart-catalog";
import { COURSE, isDrill, lookAlikeExamples, MELODIES, type Example, type Lesson, type Melody } from "../../lib/learn/course";
import { buildPools, type Pools } from "../../lib/learn/pools";
import { analyseVerse, exampleMatches, type AnalysedVerse } from "../../lib/learn/verse";
import { isRateLimited } from "../portal/public-reading/rate-limited";
import { useLearnServices } from "./services";

/** The families a lesson's drills use, and the melodies they are heard in. */
export function lessonScope(lesson: Lesson): { families: Set<FamilyId>; melodies: Set<Melody> } {
  const families = new Set<FamilyId>(lesson.family ? [lesson.family] : []), melodies = new Set<Melody>([lesson.melody]);
  for (const activity of lesson.activities) {
    if (!isDrill(activity)) continue;
    if (activity.type === "build-the-phrase") families.add(activity.params.family); else if (activity.type !== "look-alikes") for (const family of activity.params.families) families.add(family);
    if (activity.type === "same-or-different" && activity.params.melodies) for (const melody of activity.params.melodies) melodies.add(melody);
  }
  return { families, melodies };
}
/** The lessons whose examples a lesson loads (plan, Decided 3): its own, and those of every family its drills use, in their melodies. */
export function lessonSources(lesson: Lesson): Lesson[] {
  const { families, melodies } = lessonScope(lesson);
  return COURSE.lessons.filter(row => row.id === lesson.id || row.family && families.has(row.family) && melodies.has(row.melody));
}
/** The verses a lesson's look-alikes show, beyond its sources' examples (1.6). */
export function lessonExtraRefs(lesson: Lesson): string[] {
  return [...new Set(lesson.activities.flatMap(activity => activity.type === "look-alikes" ? lookAlikeExamples(activity, lesson.melody).flatMap(({ example }) => [example.a.ref, example.b.ref]) : []))];
}
export type ExampleVerse = Readonly<{ example: Example; verse: AnalysedVerse }>;
export type CourseVerses = Readonly<{ status: "loading" } | { status: "error"; rateLimited?: boolean }
  | { status: "ready"; pools: Pools; examples: ReadonlyMap<string, readonly ExampleVerse[]>; verses: ReadonlyMap<string, AnalysedVerse> }>;
const verseKey = (kind: Melody, ref: string) => `${kind}:${ref}`;

/**
 * Loads, analyses and pools the examples of these lessons. A verse is flagged from what the course
 * knows: sof pasuk examples were chosen away from aliyah ends, end-of-haftarah examples are last
 * verses; anything else is unplaced, which keeps its sof pasuk out of that pool.
 */
export function useCourseVerses(lessons: readonly Lesson[], retry = 0, extra: readonly Readonly<{ kind: Melody; ref: string }>[] = []): CourseVerses {
  const { loader, audio } = useLearnServices();
  const [state, setState] = useState<CourseVerses>({ status: "loading" });
  const key = [...lessons.map(lesson => lesson.id), ...extra.map(row => verseKey(row.kind, row.ref))].join(",");
  useEffect(() => {
    if (!lessons.length && !extra.length) { setState({ status: "ready", pools: buildPools([]), examples: new Map(), verses: new Map() }); return; }
    const controller = new AbortController(), flags = new Map<string, { kind: Melody; ref: string; placed: boolean; final: boolean }>();
    for (const lesson of lessons) for (const example of lesson.examples) {
      const k = verseKey(lesson.melody, example.ref), flag = flags.get(k) ?? { kind: lesson.melody, ref: example.ref, placed: false, final: false };
      if (lesson.family === "sof-pasuk") flag.placed = true;
      if (lesson.family === "sof-haftarah") flag.final = true;
      flags.set(k, flag);
    }
    // Verses shown for their words alone (the look-alikes) join unplaced: their sof pasuk stays out of that pool.
    for (const row of extra) { const k = verseKey(row.kind, row.ref); if (!flags.has(k)) flags.set(k, { kind: row.kind, ref: row.ref, placed: false, final: false }); }
    setState({ status: "loading" });
    for (const melody of MELODIES) loader.preload([...flags.values()].filter(row => row.kind === melody).map(row => row.ref), melody);
    (async () => {
      const analysed = new Map<string, AnalysedVerse>();
      let failures = 0, limited = false;
      await Promise.all([...flags.entries()].map(async ([k, flag]) => {
        try {
          const loaded = await loader.load(flag.ref, flag.kind, controller.signal);
          const wordReady = await audio.wordReady(flag.ref, flag.kind, controller.signal);
          const verse = analyseVerse({ ref: flag.ref, kind: flag.kind, hebrew: loaded.hebrew, final: flag.final, endsRecording: flag.placed && !flag.final ? false : null, wordReady });
          if (verse) analysed.set(k, verse);
        } catch (error) { failures++; if (isRateLimited(error)) limited = true; }
      }));
      if (controller.signal.aborted) return;
      // A rate limit on any verse is told as one (2.0 F1): a lesson missing some of its verses would otherwise blame the recording.
      if (limited || !analysed.size && failures) { setState(limited ? { status: "error", rateLimited: true } : { status: "error" }); return; }
      const examples = new Map<string, ExampleVerse[]>();
      for (const lesson of lessons) examples.set(lesson.id, lesson.examples.flatMap(example => {
        const verse = analysed.get(verseKey(lesson.melody, example.ref));
        return verse && verse.wordReady && exampleMatches(verse, example, lesson.family) ? [{ example, verse }] : [];
      }));
      const byRef = new Map([...analysed.values()].map(verse => [verseKey(verse.kind, verse.ref), verse]));
      setState({ status: "ready", pools: buildPools([...analysed.values()]), examples, verses: byRef });
    })();
    return () => controller.abort();
  }, [key, retry, loader, audio]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
export const findVerse = (data: Extract<CourseVerses, { status: "ready" }>, kind: Melody, ref: string) => data.verses.get(verseKey(kind, ref)) ?? null;
