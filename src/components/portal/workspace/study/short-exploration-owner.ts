import { PortalRequestError } from "../../api";
import type { Assigned, Selection } from "../api";
import type { PreparedExploration } from "./exploration-api";
import type { StudyPage } from "./api";
import { checkShortReferenceSelection, type ShortReferencePage } from "./short-reference-api";
import { checkShortExplorationExpectation, parseShortExplorationPageData } from "./short-exploration-api";
export type ShortExplorationBinding = Readonly<{ baseline: Assigned; prepared: PreparedExploration; page: StudyPage; sessionBinding: string; epoch: number; selection?: Selection }>;
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
const stale = (): never => { throw new PortalRequestError(409); };
/** Trusted provider supplies live session/route/child checks. A browser binding
 * is correlation only. Public API cannot configure or expose private selection. */
export function createShortExplorationOwner(input: {
  binding: ShortExplorationBinding; live(): boolean;
  read(baseline: Assigned, prepared: PreparedExploration, page: StudyPage, signal: AbortSignal, selection?: Selection): Promise<ShortReferencePage>;
}) {
  const binding = freeze(structuredClone(input.binding));
  if (!/^[A-Za-z0-9_-]{43}$/.test(binding.sessionBinding) || !Number.isSafeInteger(binding.epoch) || binding.epoch < 0) throw new PortalRequestError(503);
  checkShortExplorationExpectation(binding.baseline, binding.prepared, binding.page, binding.selection);
  const validate = () => { checkShortReferenceSelection(binding.baseline, binding.selection); if (binding.prepared.expiresAt <= Date.now()) return stale(); };
  type Owned = { abort: AbortController; page?: ShortReferencePage; work?: Promise<ShortReferencePage> };
  let current: Owned | undefined, closed = false, expiry: ReturnType<typeof setTimeout> | undefined;
  function suspend() { clearTimeout(expiry); expiry = undefined; const old = current; current = undefined; old?.abort.abort(); }
  function valid() { try { return !closed && input.live() && binding.prepared.expiresAt > Date.now(); } catch { return false; } }
  function ensure(selected: Owned) {
    if (!valid() || current !== selected || selected.abort.signal.aborted) { if (current === selected) suspend(); return stale(); }
    try { validate(); } catch (error) { suspend(); throw error; }
  }
  function arm() {
    if (!valid()) { suspend(); return stale(); }
    try { validate(); } catch (error) { suspend(); throw error; }
    if (!current) { current = { abort: new AbortController() }; expiry = setTimeout(suspend, Math.max(1, binding.prepared.expiresAt - Date.now())); }
    ensure(current); return current;
  }
  function shared(selected: Owned) {
    ensure(selected); if (selected.page) return Promise.resolve(selected.page); if (selected.work) return selected.work;
    const work = Promise.resolve().then(() => { ensure(selected); return input.read(binding.baseline, binding.prepared, binding.page, selected.abort.signal, binding.selection); }).then(page => {
      ensure(selected); const parsed = parseShortExplorationPageData(page, binding.baseline, binding.prepared, binding.page, binding.selection); ensure(selected); selected.page = parsed; return parsed;
    }); selected.work = work;
    void work.catch(() => { if (current === selected && selected.work === work) suspend(); }); return work;
  }
  async function page(signal?: AbortSignal) {
    if (signal?.aborted) return stale(); const selected = arm(); let stop: (() => void) | undefined;
    try {
      const value = await Promise.race([shared(selected), new Promise<never>((_, reject) => {
        stop = () => reject(new PortalRequestError(409)); signal?.addEventListener("abort", stop, { once: true }); selected.abort.signal.addEventListener("abort", stop, { once: true });
        if (signal?.aborted || selected.abort.signal.aborted) stop();
      })]); if (signal?.aborted) return stale(); ensure(selected); return value;
    } finally { if (stop) { signal?.removeEventListener("abort", stop); selected.abort.signal.removeEventListener("abort", stop); } }
  }
  return Object.freeze({ prepare: async () => { const selected = arm(); await page(); ensure(selected); },
    load: async (index: number, signal: AbortSignal) => { if (!Number.isSafeInteger(index) || index < 0 || index >= binding.page.verses.length) return stale(); const selected = arm(), value = await page(signal); ensure(selected); if (signal.aborted) return stale(); return value.references[index]; },
    suspend, dispose() { closed = true; suspend(); },
  });
}
export type ShortExplorationOwner = ReturnType<typeof createShortExplorationOwner>;
