import "server-only";
import { StudyUnavailable } from "./types";

export type PublicStudyTask<T> = (signal: AbortSignal, bytes: (total: number) => void) => Promise<T>;
export interface PublicStudyCoalescer {
  run<T>(key: string, task: PublicStudyTask<T>, signal: AbortSignal, bytes: (total: number) => void): Promise<T>;
}
/** Explicitly injected public transport work only: no actor or database closure.
 * No queue, no retained completed values, at most 32 five-second tasks. */
export function createPublicStudyCoalescer(options: { taskMs?: number } = {}): PublicStudyCoalescer {
  const taskMs = options.taskMs ?? 5000;
  if (!Number.isInteger(taskMs) || taskMs < 1 || taskMs > 5000) throw new Error("Invalid study deadline");
  type Subscriber = { progress: (total: number) => void; finish: (error: boolean, value?: unknown) => void };
  type Pending = { controller: AbortController; subscribers: Set<Subscriber>; bytes: number; timer?: ReturnType<typeof setTimeout> };
  const pending = new Map<string, Pending>();
  return Object.freeze({ run<T>(key: string, task: PublicStudyTask<T>, signal: AbortSignal, bytes: (total: number) => void): Promise<T> {
    if (signal.aborted || typeof key !== "string" || key.length > 1024) return Promise.reject(new StudyUnavailable("upstream"));
    let entry = pending.get(key);
    if (!entry) {
      if (pending.size >= 32) return Promise.reject(new StudyUnavailable("upstream"));
      entry = { controller: new AbortController(), subscribers: new Set(), bytes: 0 };
      const current = entry;
      pending.set(key, current);
      const finish = (error: boolean, value?: unknown) => {
        if (pending.get(key) === current) pending.delete(key);
        if (current.timer) clearTimeout(current.timer);
        for (const subscriber of [...current.subscribers]) subscriber.finish(error, value);
        current.controller.abort();
      };
      current.timer = setTimeout(() => finish(true), taskMs);
      void Promise.resolve().then(() => task(current.controller.signal, total => {
        if (!Number.isSafeInteger(total) || total < current.bytes) throw new StudyUnavailable("invalid-response");
        current.bytes = total;
        for (const subscriber of [...current.subscribers]) subscriber.progress(total);
      })).then(value => finish(false, value), error => finish(true, error));
    }
    const shared = entry;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const detach = () => {
        signal.removeEventListener("abort", abort);
        shared.subscribers.delete(subscriber);
        if (!shared.subscribers.size) {
          if (pending.get(key) === shared) pending.delete(key);
          if (shared.timer) clearTimeout(shared.timer);
          shared.controller.abort();
        }
      };
      const subscriber: Subscriber = {
        progress(total) { try { bytes(total); } catch { subscriber.finish(true, new StudyUnavailable("invalid-response")); } },
        finish(error, value) {
          if (done) return;
          done = true; detach();
          if (error) reject(new StudyUnavailable(value instanceof StudyUnavailable ? value.code : "upstream"));
          else resolve(value as T);
        },
      };
      const abort = () => subscriber.finish(true);
      shared.subscribers.add(subscriber);
      signal.addEventListener("abort", abort, { once: true });
      subscriber.progress(shared.bytes);
      if (signal.aborted) abort();
    });
  } });
}
