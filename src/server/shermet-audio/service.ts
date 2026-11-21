import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { SHERMET_PILOT_RECORDINGS } from "./pilot-metadata";
import { isCrcEnvironment } from "../../lib/site/identity";

const MAX_AUDIO = 20 * 1024 * 1024;
const MAX_CACHED_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_RECORDINGS = 9;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export type VerifiedShermetRecording = Readonly<{ sourceId: number; sha256: string; mimeType?: string }>;
type PublicCache = { bytes: Map<string, Buffer>; pending: Map<string, Promise<Buffer | null>>; size: number };
// The runtime creates a handler per request. Share only verified public bytes
// across those handlers, with independent test fetchers in weakly held caches.
const publicCaches = new WeakMap<typeof fetch, PublicCache>();
export async function getVerifiedShermetMedia(entry: VerifiedShermetRecording, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  if (!Number.isSafeInteger(entry.sourceId) || entry.sourceId <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) return null;
  let cache = publicCaches.get(fetcher);
  if (!cache) {
    cache = { bytes: new Map(), pending: new Map(), size: 0 };
    publicCaches.set(fetcher, cache);
  }
  const key = `${entry.sourceId}:${entry.sha256}`;
  const ready = cache.bytes.get(key);
  if (ready) {
    cache.bytes.delete(key); cache.bytes.set(key, ready);
    return ready;
  }
  const pending = cache.pending.get(key);
  if (pending) return pending;
  if (cache.pending.size >= MAX_CACHED_RECORDINGS) return null;
  const selectedCache = cache;
  const work = (async () => {
    try {
      const response = await fetcher(`https://images.shulcloud.com/14396/${entry.sourceId}.mp3`, {
        signal: AbortSignal.timeout(15000), redirect: "error", credentials: "omit", cache: "no-store",
      });
      if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_AUDIO) {
        await response.body?.cancel();
        return null;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.length;
          if (length > MAX_AUDIO) {
            await reader.cancel();
            return null;
          }
          chunks.push(result.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = Buffer.concat(chunks);
      if (!bytes.length || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) return null;
      while (selectedCache.bytes.size >= MAX_CACHED_RECORDINGS || selectedCache.size + bytes.length > MAX_CACHED_BYTES) {
        const oldest = selectedCache.bytes.keys().next().value;
        if (oldest === undefined) break;
        selectedCache.size -= selectedCache.bytes.get(oldest)!.length;
        selectedCache.bytes.delete(oldest);
      }
      selectedCache.bytes.set(key, bytes); selectedCache.size += bytes.length;
      return bytes;
    } catch { return null; }
  })();
  cache.pending.set(key, work);
  try { return await work; }
  finally { cache.pending.delete(key); }
}

/** A single inclusive byte range; null means malformed or unsatisfiable. */
function byteRange(value: string, length: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || !length || !match[1] && !match[2]) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, length - suffix), end: length - 1 } : null;
  }
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : length - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || start > end) return null;
  return { start, end: Math.min(end, length - 1) };
}
export function runtimeShermetAudio(env: Readonly<Record<string, string | undefined>> = process.env) {
  const crc = isCrcEnvironment(env);
  const local = crc && env.NODE_ENV !== "production" && env.PORTAL_ENVIRONMENT !== "production" ? env.SHERMET_AUDIO_DIR : undefined;
  return createShermetAudio(local, crc);
}
export function singleVerse(ref: unknown, kind?: unknown) {
  const parsed = canonicalReadingRef(ref, kind ?? "torah") ?? (kind === undefined ? canonicalReadingRef(ref, "haftarah") : null);
  return parsed?.verses.length === 1 && parsed.verses[0] === ref ? parsed : null;
}
/** The operator supplies this directory outside the checkout. Catalog entries
 * grant playback only to named canonical verses, never to client-supplied paths. */
export function createShermetAudio(directory: string | undefined, publicEnabled = false, fetcher: typeof fetch = fetch) {
  const publicEntries = publicEnabled ? SHERMET_PILOT_RECORDINGS : [];
  const valid = (entry: { ref?: unknown; kind?: unknown; file?: unknown }) => Boolean(singleVerse(entry.ref, entry.kind) && ["torah", "haftarah"].includes(String(entry.kind)) && typeof entry.file === "string" && /^[a-f0-9]{64}\.mp3$/.test(entry.file));
  async function file(root: string, name: string, limit: number) {
    const resolved = await realpath(path.join(root, name));
    if (path.dirname(resolved) !== root) throw new Error("Unavailable recording");
    const info = await stat(resolved);
    if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error("Unavailable recording");
    const bytes = await readFile(resolved);
    if (bytes.length > limit) throw new Error("Unavailable recording");
    return bytes;
  }
  async function localCatalog() {
    if (!directory || !path.isAbsolute(directory)) return null;
    try {
      const root = await realpath(directory);
      const catalog = JSON.parse((await file(root, "catalog.json", 8 * 1024 * 1024)).toString("utf8"));
      if (catalog.version !== 1 || !Array.isArray(catalog.recordings) || catalog.recordings.length > 30000) return null;
      return { root, entries: catalog.recordings as { kind: string; ref: string; file: string }[] };
    } catch { return null; }
  }
  const published = new Map(publicEntries.map(entry => [entry.ref, entry]));
  function selectRecording(ref: string, local: Awaited<ReturnType<typeof localCatalog>>) {
    const matches = local?.entries.filter(entry => entry?.ref === ref) ?? [];
    if (matches.length > 0) {
      const entry = matches[0];
      return matches.length === 1 && local && valid(entry)
        ? { type: "local" as const, root: local.root, file: entry.file, sha256: entry.file.slice(0, -4) } : null;
    }
    const entry = published.get(ref);
    if (!entry || !singleVerse(entry.ref, entry.kind) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.sourceId) || entry.sourceId <= 0) return null;
    return { type: "published" as const, entry, sha256: entry.sha256 };
  }
  async function recording(ref: string) {
    if (!singleVerse(ref)) return null;
    try {
      const selected = selectRecording(ref, await localCatalog());
      if (!selected) return null;
      if (selected.type === "published") return await getVerifiedShermetMedia(selected.entry, fetcher);
      const bytes = await file(selected.root, selected.file, MAX_AUDIO);
      return createHash("sha256").update(bytes).digest("hex") === selected.sha256 ? bytes : null;
    } catch { return null; }
  }
  return {
    async recordingIdentities(refs: readonly string[]) {
      const local = await localCatalog();
      return new Map(refs.flatMap(ref => {
        const selected = selectRecording(ref, local);
        return selected ? [[ref, selected.sha256] as const] : [];
      }));
    },
    async catalog(request: Request) {
      if (new URL(request.url).searchParams.get("format") === "manifest") {
        // Offline permission is for published CRC assets only. Local operator
        // extras are deliberately excluded from pack discovery.
        const recordings = publicEntries.flatMap(entry => {
          const bytes = "bytes" in entry ? entry.bytes : null;
          return typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0 && bytes <= MAX_AUDIO ? [{ kind: entry.kind, ref: entry.ref, sha256: entry.sha256, bytes, mimeType: "mimeType" in entry && entry.mimeType === "audio/wav" ? "audio/wav" : "audio/mpeg" }] : [];
        });
        return Response.json({ recordings }, { headers });
      }
      const asked = new URL(request.url).searchParams.getAll("ref");
      const local = await localCatalog();
      const configured = [...publicEntries.map(entry => entry.ref), ...(local?.entries.filter(entry => entry && valid(entry)).map(entry => entry.ref) ?? [])];
      const configuredRefs = new Set(configured);
      const refs = asked.length ? asked : configured;
      if (asked.length > 100 || refs.some(ref => !singleVerse(ref))) return new Response(null, { status: 400, headers });
      const available: string[] = [];
      // Availability is metadata only; fetch/verify media only when chosen.
      for (const ref of new Set(refs)) if (configuredRefs.has(ref)) available.push(ref);
      return Response.json({ refs: available }, { headers });
    },
    async audio(request: Request) {
      const refs = new URL(request.url).searchParams.getAll("ref");
      const bytes = refs.length === 1 ? await recording(refs[0]) : null;
      if (!bytes) return new Response(null, { status: 404, headers });
      const entry = publicEntries.find(entry => entry.ref === refs[0]);
      return shermetMediaResponse(request, bytes, entry && "mimeType" in entry && entry.mimeType === "audio/wav" ? "audio/wav" : "audio/mpeg");
    },
  };
}

export function shermetMediaResponse(request: Request, bytes: Buffer, mimeType = "audio/mpeg") {
  const mediaHeaders = { ...headers, "Content-Type": mimeType, "Accept-Ranges": "bytes" };
  // HEAD describes the complete GET representation. If-Range without a
  // matching validator also requires the complete representation.
  const rangeHeader = request.method === "GET" && !request.headers.has("if-range") ? request.headers.get("range") : null;
  if (rangeHeader !== null) {
    const range = byteRange(rangeHeader, bytes.length);
    if (!range) return new Response(null, { status: 416, headers: { ...mediaHeaders, "Content-Range": `bytes */${bytes.length}`, "Content-Length": "0" } });
    const body = bytes.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(body), { status: 206, headers: { ...mediaHeaders, "Content-Length": String(body.length), "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}` } });
  }
  return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), { headers: { ...mediaHeaders, "Content-Length": String(bytes.length) } });
}
