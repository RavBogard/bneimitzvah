import { PortalRequestError } from "../../api";
import type { Assigned } from "../api";
import type { StudyPage } from "./api";
import { explorationBinding, type ExplorationPreparation, type PreparedExploration } from "./exploration-api";

export type ExplorationState = Readonly<{ pending: boolean; result?: ExplorationPreparation; page?: StudyPage; error?: number }>;
/** One authorized reading mount. A proposal never enters an assigned-work store. */
export function createExplorationOwner(input: {
  prepare(baseline: Assigned, signal: AbortSignal): Promise<ExplorationPreparation>;
  page(baseline: Assigned, prepared: PreparedExploration, offset: number, signal: AbortSignal): Promise<StudyPage>;
  denied(status: number): void;
}) {
  let baseline: Assigned | null = null, key = "", turn = 0, abort: AbortController | undefined;
  let state: ExplorationState = Object.freeze({ pending: false });
  const listeners = new Set<() => void>();
  const publish = (value: ExplorationState) => { state = Object.freeze(value); for (const notify of listeners) notify(); };
  function clear() { turn++; abort?.abort(); baseline = null; key = ""; publish({ pending: false }); }
  function configure(value: Assigned | null, scope: string) {
    if (!value || value.mode === "parent" || value.readings.some(reading => reading.kind === "torah")) { clear(); return false; }
    const next = JSON.stringify([scope, explorationBinding(value)]);
    if (next === key) return false;
    turn++; abort?.abort(); baseline = structuredClone(value); key = next; publish({ pending: false }); return true;
  }
  async function load(offset = state.page?.offset ?? 0) {
    if (!baseline || !Number.isSafeInteger(offset) || offset < 0) return;
    abort?.abort(); const controller = new AbortController(), mine = ++turn, expected = key, captured = baseline; abort = controller;
    const live = () => !controller.signal.aborted && mine === turn && expected === key && baseline === captured;
    const previous = state, reusable = previous.result?.status === "prepared" && previous.result.expiresAt > Date.now() ? previous.result : undefined;
    publish({ ...previous, pending: true, error: undefined });
    try {
      const result = reusable ?? await input.prepare(captured, controller.signal);
      if (!live()) return;
      if (result.status === "assigned") throw new PortalRequestError(409);
      if (result.status === "unresolved") { publish({ pending: false, result }); return; }
      const selected = result.pages.some(page => page.offset === offset) ? offset : 0;
      const page = await input.page(captured, result, selected, controller.signal);
      if (!live()) return;
      if (result.expiresAt <= Date.now()) throw new PortalRequestError(409);
      publish({ pending: false, result, page });
    } catch (error) {
      if (!live()) return;
      const status = error instanceof PortalRequestError && [400, 401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 503;
      // Refusals remove all prior text and the private scope, never silently
      // replay or reinterpret an old binding as an assignment.
      publish({ pending: false, error: status });
      if ([401, 403, 404, 409].includes(status)) input.denied(status);
    }
  }
  return Object.freeze({ configure, load, clear,
    pause() { turn++; abort?.abort(); if (state.pending) publish({ ...state, pending: false }); },
    snapshot: () => state,
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
  });
}
