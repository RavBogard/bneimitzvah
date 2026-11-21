"use client";
import { useEffect, useState } from "react";
import type { Melody } from "../../lib/learn/course";
import { workspaceApi, type Assigned, type Reading } from "../portal/workspace/api";
import { signedInHint } from "../portal/signed-in-hint";
import { useProgress } from "./services";
import { usePersonalLearning } from "./scoped-learning";
import { useChildLearning, type ChildLearning } from "./child-practice";

/**
 * A directly signed-in student uses the workspace's own-student lookup. A guardian's
 * selection supplies the same reading view after child-practice authority is confirmed.
 * Learn uses assignments that have cleared the office's review.
 */
export type OwnReadings = Readonly<{ torah: Reading | null; haftarah: Reading | null }>;
export type OwnReading = Readonly<{ status: "pending" } | { status: "none" } | ({ status: "ready" } & OwnReadings)>;

/** How long a page waits for the progress check to say whether this browser is signed in: longer when it was last seen signed in. */
const GRACE_MS = 2000, GRACE_SIGNED_IN_MS = 4000;
let cached: Promise<OwnReadings | null> | null = null, assignedCache: Promise<Assigned | null> | null = null;

/**
 * The student's own assignment, once per page, as the student's own Reading screen reads it. 1.9 N19's verse cards take the
 * student's own Got it and Solid marks from it (through the same workspace progress API), so nothing new is asked.
 */
export function ownAssigned(child?: ChildLearning | null): Promise<Assigned | null> {
  if (child) return Promise.resolve(child.assigned);
  assignedCache ??= (async () => {
    try {
      const students = await workspaceApi.students("student");
      return students.length === 1 ? await workspaceApi.reading("student", students[0].id) : null;
    } catch { return null; }
  })();
  return assignedCache;
}
/** The reading Learn uses in a melody: one the office has not flagged for review. */
export const usableReading = (assigned: Assigned, kind: Melody): Reading | null => assigned.readings.find(reading => reading.kind === kind && !reading.needsReview) ?? null;

async function fetchOwn(): Promise<OwnReadings | null> {
  try {
    const assigned = await ownAssigned();
    if (!assigned) return null;
    const pick = (kind: Melody) => usableReading(assigned, kind);
    const torah = pick("torah"), haftarah = pick("haftarah");
    return torah || haftarah ? { torah, haftarah } : null;
  } catch { return null; }
}

export function useOwnReading(): OwnReading {
  const child = useChildLearning(), personal = usePersonalLearning(), { account } = useProgress(), state = account.state;
  const [hint, setHint] = useState<boolean | null>(null), [grace, setGrace] = useState(false), [offline, setOffline] = useState(false);
  const [answer, setAnswer] = useState<{ value: OwnReadings | null } | null>(null);
  useEffect(() => { setHint(signedInHint()); setOffline(typeof navigator !== "undefined" && navigator.onLine === false); }, []);
  useEffect(() => {
    if (child || personal) return;
    if (state !== "synced") { cached = null; assignedCache = null; setAnswer(null); return; }
    let live = true;
    cached ??= fetchOwn();
    void cached.then(value => { if (live) setAnswer({ value }); });
    return () => { live = false; };
  }, [state, child, personal]);
  // Until the progress check answers, the account is unknown: the page waits briefly (a signed-in student must not first see this week's verse),
  // and stops waiting when offline or when the check never answers. A signed-out visitor is answered "signed out" and asks for nothing.
  useEffect(() => {
    if (state !== "unknown" || hint === null) return;
    const timer = setTimeout(() => setGrace(true), hint ? GRACE_SIGNED_IN_MS : GRACE_MS);
    return () => clearTimeout(timer);
  }, [state, hint]);
  if (personal) return { status: "none" };
  if (child) {
    const torah = usableReading(child.assigned, "torah"), haftarah = usableReading(child.assigned, "haftarah");
    return torah || haftarah ? { status: "ready", torah, haftarah } : { status: "none" };
  }
  if (state === "synced") return answer ? answer.value ? { status: "ready", ...answer.value } : { status: "none" } : { status: "pending" };
  if (state === "unknown") return hint === null || !offline && !grace ? { status: "pending" } : { status: "none" };
  return { status: "none" };
}

/** The first verse of an assigned reading: where "First phrase of your verse" begins. */
export const firstVerseOf = (reading: Reading): string => reading.verses[0];
