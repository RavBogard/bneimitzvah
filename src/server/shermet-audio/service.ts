import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalReadingRef } from "../../lib/readings/reading-ref";
import { SHERMET_PILOT_RECORDINGS } from "./pilot-metadata";
import { isCrcEnvironment } from "../../lib/site/identity";

const MAX_AUDIO = 20 * 1024 * 1024;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
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
  async function recording(ref: string) {
    if (!singleVerse(ref)) return null;
    try {
      const local = await localCatalog();
      const matches = local?.entries.filter(entry => entry?.ref === ref) ?? [];
      if (matches.length > 0) {
        if (matches.length !== 1) return null;
        const entry = matches[0];
        if (!valid(entry) || !local) return null;
        const bytes = await file(local.root, entry.file, MAX_AUDIO);
        if (createHash("sha256").update(bytes).digest("hex") !== entry.file.slice(0, -4)) return null;
        return bytes;
      }
      const entry = publicEntries.find(entry => entry.ref === ref);
      if (!entry || !singleVerse(entry.ref, entry.kind) || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.sourceId) || entry.sourceId <= 0) return null;
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
      return bytes.length > 0 && createHash("sha256").update(bytes).digest("hex") === entry.sha256 ? bytes : null;
    } catch { return null; }
  }
  return {
    async catalog(request: Request) {
      const asked = new URL(request.url).searchParams.getAll("ref");
      const local = await localCatalog();
      const configured = [...publicEntries.map(entry => entry.ref), ...(local?.entries.filter(entry => entry && valid(entry)).map(entry => entry.ref) ?? [])];
      const refs = asked.length ? asked : configured;
      if (asked.length > 100 || refs.some(ref => !singleVerse(ref))) return new Response(null, { status: 400, headers });
      const available: string[] = [];
      // Availability is metadata only; fetch/verify media only when chosen.
      for (const ref of new Set(refs)) if (configured.includes(ref)) available.push(ref);
      return Response.json({ refs: available }, { headers });
    },
    async audio(request: Request) {
      const refs = new URL(request.url).searchParams.getAll("ref");
      const bytes = refs.length === 1 ? await recording(refs[0]) : null;
      if (!bytes) return new Response(null, { status: 404, headers });
      return new Response(request.method === "HEAD" ? null : new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "audio/mpeg", "Content-Length": String(bytes.length) } });
    },
  };
}
