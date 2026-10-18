import { PortalRequestError } from "../../../api";
/** One monotonic action/endpoint clock. Timers are backed by absolute checks. */
export function createSourceContentBudget(caller: AbortSignal, totalMs = 45000) {
  const end = performance.now() + totalMs, active = new Set<AbortController>();
  let disposed = false;
  const check = () => { if (caller.aborted || disposed) throw new PortalRequestError(409); if (performance.now() >= end) throw new PortalRequestError(503); };
  return Object.freeze({ check,
    async run<T>(milliseconds: number, work: (signal: AbortSignal) => Promise<T>, late?: (value: T) => void): Promise<T> {
      check(); const until = Math.min(end, performance.now() + milliseconds), controller = new AbortController(); active.add(controller);
      let expired = false, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
      const abort = () => controller.abort(); caller.addEventListener("abort", abort, { once: true });
      try {
        const pending = Promise.resolve().then(() => { check(); if (performance.now() >= until) throw new PortalRequestError(503); return work(controller.signal); }).then(value => { if (expired || controller.signal.aborted) { late?.(value); throw new PortalRequestError(503); } return value; });
        const value = await Promise.race([pending, new Promise<never>((_, reject) => {
          stop = () => { expired = true; reject(new PortalRequestError(caller.aborted || disposed ? 409 : 503)); }; controller.signal.addEventListener("abort", stop, { once: true });
          timer = setTimeout(abort, Math.max(1, until - performance.now())); if (caller.aborted || disposed) abort();
        })]);
        try { check(); if (performance.now() >= until) throw new PortalRequestError(503); return value; } catch (error) { late?.(value); throw error; }
      } finally { if (timer) clearTimeout(timer); if (stop) controller.signal.removeEventListener("abort", stop); caller.removeEventListener("abort", abort); controller.abort(); active.delete(controller); }
    },
    dispose() { disposed = true; active.forEach(controller => controller.abort()); active.clear(); }
  });
}
