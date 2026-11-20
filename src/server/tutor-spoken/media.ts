import { HttpBoundaryError } from "../http/responses";

export const MAX_SPOKEN_BYTES = 3 * 1024 * 1024;
export type SpokenMediaType = "audio/webm" | "audio/mp4" | "audio/mpeg" | "audio/ogg" | "audio/wav";
export function mediaType(value: string | null): SpokenMediaType {
  const type = value?.split(";")[0].trim().toLowerCase();
  if (!["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav"].includes(type ?? "")) throw new HttpBoundaryError(415);
  return type as SpokenMediaType;
}
export function validateMedia(bytes: Uint8Array, type: SpokenMediaType) {
  if (bytes.length < 16 || bytes.length > MAX_SPOKEN_BYTES) throw new HttpBoundaryError(bytes.length > MAX_SPOKEN_BYTES ? 413 : 415);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  const valid = type === "audio/webm" ? bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    : type === "audio/mp4" ? ascii(4, 8) === "ftyp"
    : type === "audio/ogg" ? ascii(0, 4) === "OggS"
    : type === "audio/wav" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
    : ascii(0, 3) === "ID3" || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  if (!valid) throw new HttpBoundaryError(415);
}
/** Never buffer more than the upload cap, even when Content-Length is missing or dishonest. */
export async function boundedAudio(stream: ReadableStream<Uint8Array> | null, options: { signal?: AbortSignal; expectedLength?: number; deadlineMs?: number } = {}): Promise<Uint8Array> {
  if (!stream) throw new HttpBoundaryError(415);
  const deadlineMs = options.deadlineMs ?? 5000;
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20_000) throw new HttpBoundaryError();
  const reader = stream.getReader(); let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          if (!(next.value instanceof Uint8Array)) throw new HttpBoundaryError();
          size += next.value.byteLength;
          if (size > MAX_SPOKEN_BYTES) throw new HttpBoundaryError(413);
          chunks.push(next.value);
        }
        if (options.expectedLength !== undefined && size !== options.expectedLength) throw new HttpBoundaryError();
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        return bytes;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpBoundaryError(408)), deadlineMs);
        abort = () => reject(new HttpBoundaryError(408));
        options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
      }),
    ]);
  } catch (error) {
    if (error instanceof HttpBoundaryError) throw new HttpBoundaryError(error.status);
    throw new HttpBoundaryError();
  } finally {
    if (timer) clearTimeout(timer); if (abort) options.signal?.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined); try { reader.releaseLock(); } catch { /* A hostile pending read cannot hold cleanup. */ }
  }
}
