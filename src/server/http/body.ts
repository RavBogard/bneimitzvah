import "server-only";
import { HttpBoundaryError } from "./responses";

const limits = { ordinary: 16 * 1024, work: 32 * 1024, binding: 64 * 1024, honors: 66 * 1024, honoree: 1024, csv: 2 * 1024 * 1024, mcp: 512 * 1024, progress: 72 * 1024, view: 1024, guideShare: 4 * 1024 * 1024 + 1024 } as const;
export async function readJsonBody(request: Request, profile: keyof typeof limits = "ordinary", deadlineMs = 5000): Promise<unknown> {
  if (!Object.hasOwn(limits, profile) || !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 5000) throw new HttpBoundaryError();
  const limit = limits[profile];
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) throw new HttpBoundaryError(415);
  const size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)))) throw new HttpBoundaryError();
  if (size !== null && Number(size) > limit) throw new HttpBoundaryError(413);
  if (!request.body) throw new HttpBoundaryError();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = request.body.getReader(); } catch { throw new HttpBoundaryError(); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let bytes = 0, text = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new HttpBoundaryError();
          bytes += value.byteLength;
          if (bytes > limit) throw new HttpBoundaryError(413);
          text += decoder.decode(value, { stream: true });
        }
        if (size !== null && Number(size) !== bytes) throw new HttpBoundaryError();
        return JSON.parse(text + decoder.decode());
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HttpBoundaryError(408)), deadlineMs);
        abort = () => reject(new HttpBoundaryError(408));
        request.signal.addEventListener("abort", abort, { once: true });
        if (request.signal.aborted) abort();
      }),
    ]);
  } catch (error) {
    // Throw new closed diagnostics, never decoder/parser/stream errors.
    let status: unknown;
    try { if (error instanceof HttpBoundaryError) status = error.status; } catch { /* Hostile source diagnostic. */ }
    if (status === 400 || status === 408 || status === 413) throw new HttpBoundaryError(status);
    throw new HttpBoundaryError();
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) request.signal.removeEventListener("abort", abort);
    // An adversarial source can leave cancel() pending; cleanup cannot defeat
    // the body deadline. No source failure or cancellation reason is logged.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read being cancelled. */ }
  }
}

/** An OAuth form body (application/x-www-form-urlencoded), read as a stream and capped at 16 KiB. */
export async function readFormBody(request: Request, deadlineMs = 5000): Promise<URLSearchParams> {
  if (!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")
    || ![null, "identity"].includes(request.headers.get("content-encoding"))) throw new HttpBoundaryError(415);
  const limit = 16 * 1024, size = request.headers.get("content-length");
  if (size !== null && (!/^\d+$/.test(size) || !Number.isSafeInteger(Number(size)))) throw new HttpBoundaryError();
  if (size !== null && Number(size) > limit) throw new HttpBoundaryError(413);
  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      (async () => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let bytes = 0, out = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > limit) throw new HttpBoundaryError(413);
          out += decoder.decode(value, { stream: true });
        }
        return out + decoder.decode();
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new HttpBoundaryError(408)), deadlineMs); }),
    ]);
    if (/[\u0000-\u001f\u007f]/.test(text)) throw new HttpBoundaryError();
    return new URLSearchParams(text);
  } catch (error) {
    let status: unknown;
    try { if (error instanceof HttpBoundaryError) status = error.status; } catch { /* Hostile diagnostic. */ }
    if (status === 408 || status === 413) throw new HttpBoundaryError(status);
    throw new HttpBoundaryError();
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Pending read being cancelled. */ }
  }
}
