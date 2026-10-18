import type { Assigned } from "./api";

/** Complete closed authority fields; assignment differences are reconciled separately. */
export const quietReadingAuthority = (value: Pick<Assigned, "mode" | "student" | "context">) => JSON.stringify([value.mode, value.student, value.context]);

/** One background authority check per event burst/in-flight request. No UI cache. */
export function createQuietRefresh(input: {
  capture(): string | null;
  verify(signal: AbortSignal, snapshot: string): Promise<boolean>;
  denied(error: unknown): boolean;
  changed(reason: "metadata" | "authority"): void;
}) {
  let generation = 0, queued = false;
  let pending: { abort: AbortController; turn: number; snapshot: string } | null = null;
  const current = (request: NonNullable<typeof pending>) => !request.abort.signal.aborted
    && request.turn === generation && input.capture() === request.snapshot;
  return Object.freeze({
    request() {
      if (queued || pending) return;
      queued = true; const turn = generation;
      queueMicrotask(() => {
        if (turn !== generation) return;
        queued = false;
        const snapshot = input.capture(); if (snapshot === null) return;
        const request = { abort: new AbortController(), turn, snapshot }; pending = request;
        void Promise.resolve().then(() => current(request) ? input.verify(request.abort.signal, snapshot) : null).then(unchanged => {
          if (unchanged === false && current(request)) input.changed("metadata");
        }).catch(error => {
          if (current(request) && input.denied(error)) input.changed("authority");
          // Network/unavailable retains only previously authorized in-memory UI.
        }).finally(() => { if (pending === request) pending = null; });
      });
    },
    cancel() { generation++; queued = false; const previous = pending; pending = null; previous?.abort.abort(); },
  });
}
