"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { Melody } from "../../lib/learn/course";
import { localDay } from "../../lib/learn/progress";
import { addVerseCards, verseCardId, type VerseCardId, type VerseReview } from "../../lib/learn/verse-review";
import type { Assigned, Selection } from "../portal/workspace/api";
import { fetchProgress, type ProgressRows } from "../portal/workspace/progress/api";
import { ownAssigned, usableReading } from "./own-reading";
import { useProgress } from "./services";
import { useLearningTransport, usePersonalLearning } from "./scoped-learning";
import { useChildLearning, directLearningFetch, waitingForLearningScope, type LearningTransport } from "./child-practice";
import { createVerseReviewSync, type PendingVerseReview, type VerseReviewSync, type VerseState } from "./verse-review-sync";

/**
 * 1.9 N19: the signed-in student's own verse cards, one sync per page. Nothing is asked unless Learn's progress sync says this
 * browser is signed in with a live grant ("synced"); the verse endpoint then answers only a student. The student's own Got it
 * marks and the tutor's Solid marks are read through the same workspace progress API the student's Reading screen uses
 * (GET /api/students/{id}/progress?mode=student), and each such verse becomes a card the first time it is seen.
 */
type Hub = { state: VerseState; listeners: Set<() => void>; sync: VerseReviewSync; seeded: boolean };
let shared: Hub | null = null;
const childHubs = new WeakMap<LearningTransport, Hub>();
const pending = new Map<string, PendingVerseReview>();
const UNKNOWN: VerseState = Object.freeze({ status: "unknown" as const });
function verseHub(child: LearningTransport | null) {
  const existing = child ? childHubs.get(child) : shared;
  if (existing) return existing;
  const hub = { state: UNKNOWN, listeners: new Set<() => void>(), sync: null as unknown as VerseReviewSync, seeded: false };
  hub.sync = createVerseReviewSync({
    fetch: child?.fetch ?? directLearningFetch,
    pending: child ? {
      load: owner => pending.get(owner),
      save: (owner, review) => { if (review) pending.set(owner, review); else pending.delete(owner); },
    } : undefined,
    onState: state => { hub.state = state; for (const listener of hub.listeners) listener(); },
  });
  const flush = () => hub.sync.flush();
  const hide = () => { if (document.visibilityState !== "visible") flush(); };
  const reconnect = () => { void hub.sync.start().then(flush); };
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", flush);
  if (child) {
    childHubs.set(child, hub);
    window.addEventListener("online", reconnect);
    child.onClose(() => {
      flush();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", reconnect);
    });
  } else shared = hub;
  return hub;
}

/** The verses marked Got it by the student or Solid by the tutor, in one assigned reading, from every page of its marks. */
export async function markedVerses(assigned: Assigned, kind: Melody, signal: AbortSignal, read: typeof fetchProgress = fetchProgress, selection?: Selection): Promise<VerseCardId[]> {
  if ((assigned.mode !== "student" && (assigned.mode !== "child-practice" || !selection)) || !usableReading(assigned, kind)) return [];
  const out: VerseCardId[] = [];
  for (let offset: number | null = 0, guard = 0; offset !== null && guard < 20; guard++) {
    const page = await read(assigned, kind, { type: "page", offset }, signal, selection) as ProgressRows;
    for (const verse of page.verses) if (verse.selfCheck.state === "got-it" || verse.assessment.state === "solid") out.push(verseCardId(kind, verse.verseRef));
    offset = page.nextOffset;
  }
  return out;
}

export function useVerseReview(enabled = true): { state: VerseState; update(change: (review: VerseReview) => VerseReview): void } {
  const child = useChildLearning(), transport = useLearningTransport(), personal = usePersonalLearning(), { account } = useProgress(), signedIn = enabled && account.state === "synced";
  const state = useSyncExternalStore(listener => { if (!transport && waitingForLearningScope()) return () => {}; const hub = verseHub(transport); hub.listeners.add(listener); return () => { hub.listeners.delete(listener); }; },
    () => !transport && waitingForLearningScope() ? UNKNOWN : (transport ? childHubs.get(transport) : shared)?.state ?? UNKNOWN, () => UNKNOWN);
  useEffect(() => { if (signedIn) void verseHub(transport).sync.start(); }, [signedIn, transport]);
  // Signed out or ineligible: the page drops the account's cards and waits for a new sign-in.
  const gone = account.state === "signed-out" || account.state === "not-eligible";
  useEffect(() => {
    const hub = transport ? childHubs.get(transport) : shared;
    if (gone && hub) { hub.seeded = false; hub.sync.reset(); }
  }, [gone, transport]);
  useEffect(() => {
    const hub = transport ? childHubs.get(transport) : shared;
    if (!hub || personal || state.status !== "ready" || hub.seeded) return;
    hub.seeded = true;
    const controller = new AbortController();
    void (async () => {
      const assigned = await ownAssigned(child); if (!assigned) return;
      const ids = (await Promise.all((["torah", "haftarah"] as const).map(kind =>
        markedVerses(assigned, kind, controller.signal, fetchProgress, child?.selection).catch(() => [] as VerseCardId[])))).flat();
      if (!controller.signal.aborted && ids.length) hub.sync.update(review => addVerseCards(review, ids, localDay(Date.now()),
        hub.sync.state.status === "ready" ? hub.sync.state.until : null));
    })();
    return () => controller.abort();
  }, [state.status, child, transport, personal]);
  return { state, update: change => (transport ? childHubs.get(transport) : shared)?.sync.update(change) };
}
