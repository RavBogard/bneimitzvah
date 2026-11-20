import { canonicalReadingRef } from "../readings/reading-ref";
export type ShermetRecording = Readonly<{ kind: "torah" | "haftarah"; ref: string; sha256: string; bytes: number; mimeType?: "audio/mpeg" | "audio/wav" }>;
export type ShermetAsset = Pick<ShermetRecording, "sha256" | "bytes" | "mimeType">;
export const shermetAudioPath = (ref: string) => `/api/shermet-audio?${new URLSearchParams({ ref })}`;
export const shermetTimingPath = (ref: string) => `/api/shermet-audio/timing?${new URLSearchParams({ ref })}`;
export const SHERMET_CATALOG_PATH = "/api/shermet-audio/catalog";
export const SHERMET_MANIFEST_PATH = "/api/shermet-audio/catalog?format=manifest";
export function parseShermetManifest(value: unknown): readonly ShermetRecording[] | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as { recordings: unknown }).recordings)) return null;
  const rows = (value as { recordings: ShermetRecording[] }).recordings;
  if (rows.length > 30000) return null;
  const refs = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || !["bytes,kind,ref,sha256", "bytes,kind,mimeType,ref,sha256"].includes(Object.keys(row).sort().join())) return null;
    const parsed = canonicalReadingRef(row.ref, row.kind);
    if (!parsed || parsed.verses.length !== 1 || parsed.verses[0] !== row.ref || refs.has(row.ref) || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 20 * 1024 * 1024 || row.mimeType !== undefined && !["audio/mpeg", "audio/wav"].includes(row.mimeType)) return null;
    refs.add(row.ref);
  }
  return rows;
}
export async function verifyShermetRecording(response: Response, recording: ShermetAsset, url: string, signal: AbortSignal, digest: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>, fromMatchedCacheKey = false) {
  if (signal.aborted || response.status !== 200 || response.redirected || !fromMatchedCacheKey && response.url !== url || response.headers.has("content-range") || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== (recording.mimeType ?? "audio/mpeg") || !response.body) throw new Error("Recording unavailable");
  const advertised = response.headers.get("content-length");
  if (advertised !== null && Number(advertised) !== recording.bytes) throw new Error("Recording unavailable");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("Recording unavailable");
      const result = await reader.read(); if (result.done) break;
      length += result.value.length;
      if (length > recording.bytes) { await reader.cancel(); throw new Error("Recording unavailable"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  if (length !== recording.bytes || signal.aborted) throw new Error("Recording unavailable");
  const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  if (await digest(bytes) !== recording.sha256 || signal.aborted) throw new Error("Recording unavailable");
}
