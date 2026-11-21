"use client";
import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { PRACTICE_STUDENT_HEADER } from "../../../lib/learn/child-practice";
import { createPracticeDateQueue, hasPracticeDates } from "../../../lib/practice-calendar/completion-queue";
import { childPracticePartition, readPracticeLease, savePracticeLease, type PracticeLease } from "../../../lib/offline/practice-lease";
import { offlineState, purgeGeneration, subscribeOfflineState } from "../../../lib/offline/pack-index";
import { servedOffline } from "../../../lib/offline/signal";
import { directLearningFetch, useChildLearning, useOfflineChildLearning, waitingForLearningScope } from "../../learn/child-practice";
import { usePersonalLearning } from "../../learn/scoped-learning";
import { SIGNED_IN_HINT } from "../signed-in-hint";
import { tabPractice } from "../workspace/practice";
import type { Selection } from "../workspace/api";

const storage = () => { try { return window.localStorage; } catch { return null; } };
type Queue = ReturnType<typeof createPracticeDateQueue>;
const queues = new WeakMap<Selection, Queue>();

function directQueue() {
  const generation = purgeGeneration();
  return createPracticeDateQueue({ fetch: directLearningFetch, storage, onBinding: proof => { void savePracticeLease(proof, generation); } });
}
function currentQueue(selection: Selection) {
  const existing = queues.get(selection);
  if (existing) return existing;
  const current = () => tabPractice().selection?.context.id === selection.context.id;
  const linkedFetch: typeof fetch = async (url, init) => {
    if (!current()) return new Response(null, { status: 404 });
    const headers = new Headers(init?.headers);
    headers.set("X-Practice-Context", selection.handle);
    headers.set(PRACTICE_STUDENT_HEADER, selection.context.studentId);
    return fetch(url, { ...init, headers });
  };
  const generation = purgeGeneration();
  const queue = createPracticeDateQueue({ fetch: linkedFetch, storage, onBinding: proof => {
    void childPracticePartition(selection.context.studentId).then(partition => {
      if (current()) void savePracticeLease(proof, generation, partition, undefined, undefined, current);
    }).catch(() => undefined);
  } });
  queues.set(selection, queue);
  return queue;
}

type WorkspaceLearner = { mode: string; studentId: string };
type Activity = { queue: Queue; lease: Promise<PracticeLease | null> };

/** Pin an activity's authority while it is open, before a completion can occur. */
export function usePracticeCompleted(workspace?: WorkspaceLearner, saved?: "ref") {
  const child = useChildLearning(), offlineChild = useOfflineChildLearning(), personal = usePersonalLearning(), path = usePathname();
  const held = useRef<Activity | null>(null), mode = workspace?.mode, studentId = workspace?.studentId;
  const pack = saved || mode ? "ref" : path === "/learn/service" || path.startsWith("/learn/service/") ? "service" : "course";
  useEffect(() => {
    if (personal || mode && mode !== "student" && mode !== "child-practice") return;
    const selection = child?.selection ?? (mode === "child-practice" ? tabPractice().selection : null);
    if (!offlineChild && !selection && (mode === "child-practice" || waitingForLearningScope())) return;
    if (studentId && selection && selection.context.studentId !== studentId) return;
    const queue = offlineChild ? createPracticeDateQueue({ fetch: async () => new Response(null, { status: 503 }), storage }) : selection ? currentQueue(selection) : directQueue();
    const activity = { queue, lease: offlineChild ? Promise.resolve(offlineChild.lease) : readPracticeLease(selection ? "child" : "direct", pack) };
    held.current = activity;
    if (servedOffline()) void activity.lease.then(lease => {
      if (lease && purgeGeneration() === lease.generation) queue.pinOffline(lease);
    });
    const verify = () => { if (!offlineChild) void queue.verifyAndReplay(); };
    const visible = () => { if (document.visibilityState === "visible") verify(); };
    const identityChanged = (event: StorageEvent) => { if (event.key === null || event.key === SIGNED_IN_HINT) verify(); };
    verify();
    window.addEventListener("online", verify);
    window.addEventListener("storage", identityChanged);
    document.addEventListener("visibilitychange", visible);
    return () => {
      if (held.current === activity) held.current = null;
      window.removeEventListener("online", verify);
      window.removeEventListener("storage", identityChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [child, offlineChild, personal, mode, studentId, pack, path]);

  return useCallback(() => {
    const activity = held.current;
    if (!activity) return;
    const instant = Date.now();
    if (!servedOffline()) { void activity.queue.completeOnline(instant); return; }
    if (activity.queue.complete(instant)) return;
    void activity.lease.then(lease => {
      if (lease && purgeGeneration() === lease.generation) {
        activity.queue.pinOffline(lease);
        activity.queue.completeOffline(lease, instant);
      }
    });
  }, []);
}

/** Reopening or reconnecting authenticates again before looking for that owner's dates. */
export function PracticeDateReplay() {
  const path = usePathname();
  useEffect(() => {
    if (path === "/preview" || path.startsWith("/preview/")) return;
    const replay = (renewLease = false) => {
      if (!renewLease && !hasPracticeDates(storage())) return;
      const selection = tabPractice().selection;
      if (!selection && waitingForLearningScope()) return;
      if (selection) void currentQueue(selection).verifyAndReplay();
      else void directQueue().verifyAndReplay();
    };
    const visible = () => { if (document.visibilityState === "visible") replay(); };
    const connected = () => replay();
    let owner: string | null = null;
    const ownerChecked = () => {
      const state = offlineState(), key = state.ownerChecked ? state.ownerKey : null;
      if (key !== owner) { owner = key; if (key) replay(true); }
    };
    replay(); ownerChecked();
    const unsubscribe = subscribeOfflineState(ownerChecked);
    window.addEventListener("online", connected);
    document.addEventListener("visibilitychange", visible);
    return () => { unsubscribe(); window.removeEventListener("online", connected); document.removeEventListener("visibilitychange", visible); };
  }, [path]);
  return null;
}
