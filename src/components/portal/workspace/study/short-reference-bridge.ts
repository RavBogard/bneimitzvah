import { PortalRequestError } from "../../api";
import { createShortReferencePageOwner, type ShortReferenceOwnerBinding } from "./short-reference-owner";
import type { ShortReferencePage } from "./short-reference-api";

/** Trusted provider composition only. Private selection/configuration never
 * escapes this bridge; viewLive can restrict, never grant provider authority. */
export function createShortReferenceBridge(input: {
  binding: ShortReferenceOwnerBinding;
  live(): boolean;
  viewLive(): boolean;
  read: Parameters<typeof createShortReferencePageOwner>[0]["load"];
}) {
  let closed = false, armed = false, turn = 0;
  const valid = () => { try { return !closed && input.live() && input.viewLive(); } catch { return false; } };
  const owner = createShortReferencePageOwner({ load: input.read, live: valid });
  function suspend() { turn++; armed = false; owner.suspend(); }
  function arm() {
    if (!valid()) { suspend(); throw new PortalRequestError(409); }
    if (!armed) { owner.configure(input.binding); armed = true; }
    return turn;
  }
  async function run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const mine = arm();
    try { const value = await action(); if (mine !== turn || !valid()) throw new PortalRequestError(409); return value; }
    catch (error) { if (mine === turn && !signal?.aborted) suspend(); throw error; }
  }
  return Object.freeze({
    prepare: async () => { await run<ShortReferencePage>(() => owner.prepare()); },
    load: (index: number, signal: AbortSignal) => run(() => owner.load(index, signal), signal),
    suspend,
    dispose() { suspend(); closed = true; owner.dispose(); },
  });
}
export type ShortReferenceOwner = ReturnType<typeof createShortReferenceBridge>;
