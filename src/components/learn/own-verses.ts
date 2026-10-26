"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { Melody } from "../../lib/learn/course";
import { localDay } from "../../lib/learn/progress";
import { addVerseCards, verseCardId, type VerseCardId, type VerseReview } from "../../lib/learn/verse-review";
import type { Assigned } from "../portal/workspace/api";
import { fetchProgress, type ProgressRows } from "../portal/workspace/progress/api";
import { ownAssigned, usableReading } from "./own-reading";
import { useProgress } from "./services";
import { createVerseReviewSync, type VerseReviewSync, type VerseState } from "./verse-review-sync";

/**
 * 1.9 N19: the signed-in student's own verse cards, one sync per page. Nothing is asked unless Learn's progress sync says this
 * browser is signed in with a live grant ("synced"); the verse endpoint then answers only a student. The student's own Got it
 * marks and the tutor's Solid marks are read through the same workspace progress API the student's Reading screen uses
 * (GET /api/students/{id}/progress?mode=student), and each such verse becomes a card the first time it is seen.
 */
let shared: { state: VerseState; listeners: Set<() => void>; sync: VerseReviewSync; seeded: boolean } | null = null;
const UNKNOWN: VerseState = Object.freeze({ status: "unknown" as const });
function verseHub() {
  if (shared) return shared;
  const hub = { state: UNKNOWN, listeners: new Set<() => void>(), sync: null as unknown as VerseReviewSync, seeded: false };
  hub.sync = createVerseReviewSync({ fetch: (...args) => fetch(...args), onState: state => { hub.state = state; for (const listener of hub.listeners) listener(); } });
  const hide = () => { if (document.visibilityState !== "visible") hub.sync.flush(); };
  document.addEventListener("visibilitychange", hide); window.addEventListener("pagehide", () => hub.sync.flush());
  shared = hub;
  return hub;
}

/** The verses marked Got it by the student or Solid by the tutor, in one assigned reading, from every page of its marks. */
export async function markedVerses(assigned: Assigned, kind: Melody, signal: AbortSignal, read: typeof fetchProgress = fetchProgress): Promise<VerseCardId[]> {
  if (assigned.mode !== "student" || !usableReading(assigned, kind)) return [];
  const out: VerseCardId[] = [];
  for (let offset: number | null = 0, guard = 0; offset !== null && guard < 20; guard++) {
    const page = await read(assigned, kind, { type: "page", offset }, signal) as ProgressRows;
    for (const verse of page.verses) if (verse.selfCheck.state === "got-it" || verse.assessment.state === "solid") out.push(verseCardId(kind, verse.verseRef));
    offset = page.nextOffset;
  }
  return out;
}

export function useVerseReview(enabled = true): { state: VerseState; update(change: (review: VerseReview) => VerseReview): void } {
  const { account } = useProgress(), signedIn = enabled && account.state === "synced";
  const state = useSyncExternalStore(listener => { const hub = verseHub(); hub.listeners.add(listener); return () => { hub.listeners.delete(listener); }; },
    () => shared?.state ?? UNKNOWN, () => UNKNOWN);
  useEffect(() => { if (signedIn) void verseHub().sync.start(); }, [signedIn]);
  // Signed out, or no longer eligible: the cards held in this page are dropped, and a later sign-in reads its own afresh.
  const gone = account.state === "signed-out" || account.state === "not-eligible";
  useEffect(() => { if (gone && shared) { shared.seeded = false; shared.sync.reset(); } }, [gone]);
  // Once per page, when the cards are in: every Got it or Solid verse not yet a card becomes one.
  useEffect(() => {
    const hub = shared; if (!hub || state.status !== "ready" || hub.seeded) return;
    hub.seeded = true;
    const controller = new AbortController();
    void (async () => {
      const assigned = await ownAssigned(); if (!assigned) return;
      const ids = (await Promise.all((["torah", "haftarah"] as const).map(kind => markedVerses(assigned, kind, controller.signal).catch(() => [] as VerseCardId[])))).flat();
      if (ids.length) hub.sync.update(review => addVerseCards(review, ids, localDay(Date.now()), hub.sync.state.status === "ready" ? hub.sync.state.until : null));
    })();
  }, [state.status]);
  return { state, update: change => shared?.sync.update(change) };
}
