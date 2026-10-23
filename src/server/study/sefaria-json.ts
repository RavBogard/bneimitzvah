import "server-only";

/**
 * One bounded GET to Sefaria's public API: a deadline, a byte cap, JSON only, no redirects, no
 * credentials. It hands back the status with the parsed body, so a caller can tell Sefaria's own 404
 * ("we have no text") from a failure. New readers share it; the reviewed older ones keep their own copies.
 */
export class SefariaJsonUnavailable extends Error { constructor() { super("Sefaria unavailable"); this.name = "SefariaJsonUnavailable"; } }
export const SEFARIA_ORIGIN = "https://www.sefaria.org";

export async function fetchSefariaJson(fetch: typeof globalThis.fetch, url: URL, limits: Readonly<{ deadlineMs: number; maxBytes: number }>, signal?: AbortSignal)
  : Promise<Readonly<{ status: number; json: unknown }>> {
  if (url.origin !== SEFARIA_ORIGIN || !Number.isInteger(limits.deadlineMs) || limits.deadlineMs < 1 || !Number.isInteger(limits.maxBytes) || limits.maxBytes < 1) throw new SefariaJsonUnavailable();
  const local = new AbortController(), stop = () => local.abort(), timer = setTimeout(stop, limits.deadlineMs);
  signal?.addEventListener("abort", stop, { once: true }); if (signal?.aborted) stop();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const ended = new Promise<never>((_, reject) => { local.signal.addEventListener("abort", () => reject(new SefariaJsonUnavailable()), { once: true }); }); ended.catch(() => {});
  try {
    return await Promise.race([ended, (async () => {
      let response: Response;
      try { response = await fetch(url, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", redirect: "error", cache: "no-store", signal: local.signal }); }
      catch { throw new SefariaJsonUnavailable(); }
      const length = response.headers.get("content-length");
      if (response.redirected || response.url && response.url !== url.href || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") ?? "")
        || length !== null && (!/^\d+$/.test(length) || Number(length) > limits.maxBytes) || !response.body) {
        void response.body?.cancel().catch(() => {}); throw new SefariaJsonUnavailable();
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let size = 0, text = "";
      for (;;) {
        const part = await reader.read();
        if (local.signal.aborted) throw new SefariaJsonUnavailable();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limits.maxBytes) throw new SefariaJsonUnavailable();
        text += decoder.decode(part.value, { stream: true });
      }
      let json: unknown;
      try { json = JSON.parse(text + decoder.decode()); } catch { throw new SefariaJsonUnavailable(); }
      return Object.freeze({ status: response.status, json });
    })()]);
  } catch { throw new SefariaJsonUnavailable(); }
  finally {
    clearTimeout(timer); local.abort(); signal?.removeEventListener("abort", stop);
    void reader?.cancel().catch(() => {});
    try { reader?.releaseLock(); } catch { /* No upstream diagnostic. */ }
  }
}
