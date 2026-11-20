import { offlineHumanTrackAvailable, offlineHumanTrackPath, type HumanTrack } from "./human-tracks";
import { shortAudioDigest } from "./short-playback";

export const HUMAN_TRACK_CACHE = "crc-human-recordings-v1";
export const HUMAN_TRACK_EXPIRY = "x-crc-recording-expires";
export const HUMAN_TRACK_SAVE_CHANGE = "crc-human-recording-save-change";
const SAVE_WINDOW_MS = 14 * 86_400_000;
const SAVE_BUDGET_BYTES = 300 * 1024 * 1024;

export function supportsHumanTrackSave() {
  return typeof navigator !== "undefined" && typeof caches !== "undefined" && typeof crypto?.subtle?.digest === "function"
    && navigator.serviceWorker?.controller != null;
}

export async function hasSavedHumanTrack(track: HumanTrack) {
  if (!offlineHumanTrackAvailable(track) || !supportsHumanTrackSave() || !await caches.has(HUMAN_TRACK_CACHE)) return false;
  const cache = await caches.open(HUMAN_TRACK_CACHE);
  const response = await cache.match(offlineHumanTrackPath(track));
  return !!response && Number(response.headers.get(HUMAN_TRACK_EXPIRY)) > Date.now();
}

export async function removeSavedHumanTrack(track: HumanTrack) {
  if (offlineHumanTrackAvailable(track) && await caches.has(HUMAN_TRACK_CACHE)) await (await caches.open(HUMAN_TRACK_CACHE)).delete(offlineHumanTrackPath(track));
  window.dispatchEvent(new Event(HUMAN_TRACK_SAVE_CHANGE));
}

/** Some browser fetch paths omit Content-Length even for a verified full recording. */
async function readRecording(response: Response, length: number, signal: AbortSignal) {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) !== length || !response.body) throw new Error("Recording unavailable");
  const reader = response.body.getReader(), bytes = new Uint8Array(length);
  let offset = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.byteLength > length) throw new Error("Recording changed");
      bytes.set(chunk.value, offset);
      offset += chunk.value.byteLength;
    }
    if (offset !== length) throw new Error("Recording changed");
    return bytes;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function saveHumanTrack(track: HumanTrack, signal: AbortSignal) {
  if (!offlineHumanTrackAvailable(track) || !supportsHumanTrackSave()) throw new Error("Offline recordings unavailable");
  const path = offlineHumanTrackPath(track), url = new URL(path, location.origin).href;
  const action = async () => {
    signal.throwIfAborted();
    const storage = await navigator.storage?.estimate?.();
    if (storage?.quota && (storage.usage ?? 0) + track.bytes > Math.min(SAVE_BUDGET_BYTES, storage.quota * 0.8)) throw new Error("Not enough space");
    const cache = await caches.open(HUMAN_TRACK_CACHE);
    let used = 0;
    for (const key of await cache.keys()) {
      const record = await cache.match(key);
      if (!record || Number(record.headers.get(HUMAN_TRACK_EXPIRY)) <= Date.now()) await cache.delete(key);
      else if (key.url !== url) used += Number(record.headers.get("content-length")) || 0;
    }
    if (used + track.bytes > SAVE_BUDGET_BYTES) throw new Error("Not enough space");
    const response = await fetch(url, { credentials: "omit", mode: "same-origin", redirect: "error", cache: "reload", signal });
    if (response.status !== 200 || response.url !== url || response.headers.get("content-type") !== "audio/mpeg") {
      void response.body?.cancel().catch(() => {});
      throw new Error("Recording unavailable");
    }
    const bytes = await readRecording(response, track.bytes, signal);
    if (await shortAudioDigest(bytes) !== track.sha256) throw new Error("Recording changed");
    signal.throwIfAborted();
    const headers = { "Content-Type": "audio/mpeg", "Content-Length": String(track.bytes), "Accept-Ranges": "bytes",
      [HUMAN_TRACK_EXPIRY]: String(Date.now() + SAVE_WINDOW_MS) };
    await cache.put(url, new Response(bytes, { headers }));
  };
  if (navigator.locks) await navigator.locks.request(HUMAN_TRACK_CACHE, { signal }, action);
  else await action();
  window.dispatchEvent(new Event(HUMAN_TRACK_SAVE_CHANGE));
}
