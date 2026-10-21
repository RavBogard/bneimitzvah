import "server-only";
import type { ReferenceCatalogGet } from "../reference-audio/storage";
import { REVIEW_LIMITS, ReviewUnavailable, parseReviewManifest, reviewDigest, reviewHash, type ReviewEntry } from "./batch-contract";

export const reviewManifestPath = (sha256: string) => `reference-review/finkel/v1/manifests/${sha256}.json`;
export const reviewAudioPath = (sha256: string) => `reference-review/finkel/v1/audio/${sha256}.mp3`;
/** Entire bytes are bounded and verified before callers may return any body. */
export async function readVerifiedReviewBytes(get: ReferenceCatalogGet, path: string, expectedSha256: string, cap: number, signal?: AbortSignal, expectedBytes?: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!reviewDigest(expectedSha256) || !Number.isSafeInteger(cap) || cap < 1 || cap > REVIEW_LIMITS.audioBytes) throw new ReviewUnavailable();
  const controller = new AbortController(), abort = () => controller.abort(), started = performance.now();
  const deadline = setTimeout(abort, REVIEW_LIMITS.totalMs); signal?.addEventListener("abort", abort, { once: true });
  let incoming: ReadableStream<Uint8Array> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const live = () => { if (signal?.aborted || controller.signal.aborted || performance.now() - started >= REVIEW_LIMITS.totalMs) throw new ReviewUnavailable(); };
  const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined, onAbort: (() => void) | undefined;
    try {
      const result = await Promise.race([work, new Promise<never>((_, reject) => { onAbort = () => reject(new ReviewUnavailable()); controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) return onAbort(); timer = setTimeout(() => { abort(); reject(new ReviewUnavailable()); }, ms); })]); live(); return result;
    } finally { clearTimeout(timer); if (onAbort) controller.signal.removeEventListener("abort", onAbort); }
  };
  try {
    live(); const pending = Promise.resolve().then(() => { live(); return get(path, { signal: controller.signal }); });
    void pending.then(stream => { incoming = stream; if (controller.signal.aborted) void stream.cancel().catch(() => {}); }).catch(() => {});
    const stream = await bounded(pending, 10000); if (!(stream instanceof ReadableStream)) throw new ReviewUnavailable(); reader = stream.getReader();
    const bytes = new Uint8Array(cap); let size = 0, empty = 0, progress = performance.now();
    for (;;) {
      const item = await bounded(reader.read(), Math.max(1, REVIEW_LIMITS.idleMs - (performance.now() - progress))); live();
      if (performance.now() - progress >= REVIEW_LIMITS.idleMs) throw new ReviewUnavailable(); if (item.done) break;
      if (!(item.value instanceof Uint8Array)) throw new ReviewUnavailable();
      const proto = Object.getPrototypeOf(Uint8Array.prototype), length = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(item.value));
      if (!length) { if (++empty > 64) throw new ReviewUnavailable(); continue; }
      if (size + length > cap) throw new ReviewUnavailable();
      const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(item.value) as ArrayBuffer;
      const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(item.value));
      bytes.set(new Uint8Array(buffer, offset, length), size); size += length; empty = 0; progress = performance.now();
    }
    const result = bytes.subarray(0, size); if (!size || expectedBytes !== undefined && size !== expectedBytes || reviewHash(result) !== expectedSha256) throw new ReviewUnavailable();
    live(); return result;
  } catch { abort(); throw new ReviewUnavailable(); }
  finally {
    signal?.removeEventListener("abort", abort); clearTimeout(deadline);
    if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    else if (incoming) { try { void incoming.cancel().catch(() => {}); } catch {} }
  }
}
export async function loadReviewManifest(get: ReferenceCatalogGet, sha256: string, signal?: AbortSignal) {
  return parseReviewManifest(await readVerifiedReviewBytes(get, reviewManifestPath(sha256), sha256, REVIEW_LIMITS.manifestBytes, signal), sha256);
}
export async function loadReviewAudio(get: ReferenceCatalogGet, entry: ReviewEntry, signal?: AbortSignal) {
  return readVerifiedReviewBytes(get, reviewAudioPath(entry.playback.sha256), entry.playback.sha256, entry.playback.bytes, signal, entry.playback.bytes);
}
