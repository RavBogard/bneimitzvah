import { OFFLINE_HEADER } from "./policy";

/**
 * Whether this page has been answered from a saved pack (the worker marks those answers with x-crc-offline), or
 * the device says it is offline. The reader's offline pill follows it (§3.9). Nothing here is stored.
 */
let fromCache = false;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };
export function noteResponse(response: Pick<Response, "headers">) {
  if (!fromCache && response.headers.get(OFFLINE_HEADER) === "1") { fromCache = true; publish(); }
}
export function servedOffline(): boolean {
  let online = true;
  try { online = navigator.onLine !== false; } catch { /* Assume online. */ }
  return fromCache || !online;
}
export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  const changed = () => { try { if (navigator.onLine) fromCache = false; } catch { /* Keep it. */ } listener(); };
  window.addEventListener("online", changed); window.addEventListener("offline", changed);
  return () => { listeners.delete(listener); window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
}
