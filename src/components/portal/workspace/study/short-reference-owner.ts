import { PortalRequestError } from "../../api";
import type { Assigned, Selection } from "../api";
import { studyPlan, type StudyKind } from "./api";
import { checkShortReferenceSelection, parseShortReferencePageData, type ShortReferencePage } from "./short-reference-api";

export type ShortReferenceOwnerBinding = Readonly<{ baseline: Assigned; kind: StudyKind; offset: number; sessionBinding: string; epoch: number; selection?: Selection }>;
function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
const stale = (): never => { throw new PortalRequestError(409); };

/** One authorized page only. Session expiry is not exposed by SessionSummary:
 * trusted provider composition must retain its real serviceRead verification,
 * scope lifecycle and synchronous live check. No mount behavior or media I/O. */
export function createShortReferencePageOwner(input: {
  load(baseline: Assigned, kind: StudyKind, offset: number, signal: AbortSignal, selection?: Selection): Promise<ShortReferencePage>;
  live(): boolean;
}) {
  type Owner = { binding: ShortReferenceOwnerBinding; key: string; abort: AbortController; page?: ShortReferencePage; work?: Promise<ShortReferencePage> };
  let owner: Owner | undefined, disposed = false;
  function clear() { owner?.abort.abort(); owner = undefined; }
  function ensure(selected: Owner) {
    let active = false; try { active = input.live(); } catch {}
    if (disposed || selected !== owner || selected.abort.signal.aborted || !active) { if (selected === owner) clear(); return stale(); }
    try { checkShortReferenceSelection(selected.binding.baseline, selected.binding.selection); }
    catch (error) { clear(); throw error; }
  }
  function configure(value: ShortReferenceOwnerBinding): boolean {
    if (disposed) return stale();
    try {
      const binding = structuredClone(value);
      if (typeof binding.sessionBinding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(binding.sessionBinding) || !Number.isSafeInteger(binding.epoch) || binding.epoch < 0) throw new PortalRequestError(503);
      studyPlan(binding.baseline, binding.kind, binding.offset); checkShortReferenceSelection(binding.baseline, binding.selection);
      const key = JSON.stringify(binding); if (owner?.key === key) { ensure(owner); return false; }
      clear(); owner = { binding: freeze(binding), key, abort: new AbortController() }; ensure(owner); return true;
    } catch (error) { clear(); throw error; }
  }
  function shared(selected: Owner): Promise<ShortReferencePage> {
    ensure(selected); if (selected.page) return Promise.resolve(selected.page); if (selected.work) return selected.work;
    const b = selected.binding;
    const work = Promise.resolve().then(() => { ensure(selected); return input.load(b.baseline, b.kind, b.offset, selected.abort.signal, b.selection); }).then(page => {
      ensure(selected); const result = parseShortReferencePageData(page, b.baseline, b.kind, b.offset); ensure(selected); selected.page = result; return result;
    });
    selected.work = work;
    void work.catch(() => { if (owner === selected && selected.work === work) selected.work = undefined; }); return work;
  }
  async function prepare(signal?: AbortSignal): Promise<ShortReferencePage> {
    if (signal?.aborted || !owner) return stale(); const selected = owner; ensure(selected);
    let stop: (() => void) | undefined;
    try {
      const page = await Promise.race([shared(selected), new Promise<never>((_, reject) => {
        stop = () => reject(new PortalRequestError(409)); signal?.addEventListener("abort", stop, { once: true }); selected.abort.signal.addEventListener("abort", stop, { once: true });
        if (signal?.aborted || selected.abort.signal.aborted) stop();
      })]);
      if (signal?.aborted) return stale(); ensure(selected); return page;
    } finally { if (stop) { signal?.removeEventListener("abort", stop); selected.abort.signal.removeEventListener("abort", stop); } }
  }
  async function load(index: number, signal: AbortSignal) {
    if (!owner || !Number.isSafeInteger(index) || index < 0 || index >= studyPlan(owner.binding.baseline, owner.binding.kind, owner.binding.offset).refs.length) return stale();
    const selected = owner, page = await prepare(signal); ensure(selected); if (signal.aborted) return stale(); return page.references[index];
  }
  return Object.freeze({ configure, prepare, load, clear, suspend: clear, dispose() { clear(); disposed = true; } });
}
