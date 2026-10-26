"use client";
import { useEffect, useState } from "react";
import type { Assigned } from "../api";
import { useWorkspace } from "../provider";
import type { ProgressRows } from "../progress/api";
import { stillWorkingLine } from "./model";

type Result = { scope: string; working: string[]; marked: boolean } | { scope: string; failed: true };
/**
 * "Needs work" at the top of Lessons (1.9 N14, G7 TP-01): the verses the student marked Still working, across the whole assigned
 * reading. Built only from the marks this tutor or admin already reads verse by verse (the same progress pages, read in turn); it
 * reads nothing new. When nothing is marked, or nothing is marked Still working, it says so in Daniel's words.
 */
export function NeedsWork({ baseline }: { baseline: Assigned }) {
  const { readProgress } = useWorkspace(), firstName = baseline.student.firstName;
  const scope = JSON.stringify([baseline.mode, baseline.student.id, baseline.readings.map(row => [row.id, row.revision])]);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (baseline.mode !== "tutor" && baseline.mode !== "admin") return;
    const request = new AbortController();
    (async () => {
      const working: string[] = []; let marked = false;
      for (const reading of baseline.readings) {
        let offset: number | null = 0, wanted = Infinity, pages = 0;
        while (offset !== null && working.length < 1000 && pages++ < 11) {
          const page = await readProgress(baseline, reading.kind, { type: "page", offset }, request.signal) as ProgressRows;
          if (offset === 0) { wanted = page.counts.selfCheck.working; marked ||= page.counts.selfCheck.working + page.counts.selfCheck["got-it"] > 0; }
          working.push(...page.verses.filter(verse => verse.selfCheck.state === "working").map(verse => verse.verseRef));
          // Stop once every Still working verse of this reading is found.
          offset = working.filter(ref => reading.verses.includes(ref)).length >= wanted ? null : page.nextOffset;
        }
      }
      if (!request.signal.aborted) setResult({ scope, working, marked });
    })().catch(() => { if (!request.signal.aborted) setResult({ scope, failed: true }); });
    return () => request.abort();
  }, [baseline, readProgress, scope]);
  const current = result?.scope === scope ? result : null;
  if (!current || "failed" in current || !baseline.readings.length) return null;
  return <section className="needs-work" aria-labelledby="needs-work-heading" data-testid="needs-work">
    <h2 id="needs-work-heading">Needs work</h2>
    <p>{current.working.length ? stillWorkingLine(firstName, current.working) : current.marked ? "Nothing marked Still working." : `Nothing marked yet. Marks appear here when ${firstName} uses Still working or Got it.`}</p>
  </section>;
}
