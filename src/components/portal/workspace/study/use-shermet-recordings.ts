"use client";
import { useEffect, useState } from "react";
let catalog: { expires: number; work: Promise<ReadonlySet<string>> } | null = null;
/** One bounded metadata discovery per page interval, shared by the main text,
 * assigned reading and any lifted verse. Audio is never fetched here. */
export function getShermetRecordingRefs() {
  if (catalog && catalog.expires > Date.now()) return catalog.work;
  const work = fetch("/api/shermet-audio/catalog", { signal: AbortSignal.timeout(10000), cache: "no-store", credentials: "omit", redirect: "error" })
    .then(async response => {
      if (!response.ok) throw new Error("Recording metadata unavailable");
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new Error("Recording metadata unavailable");
      const value = JSON.parse(text);
      if (!Array.isArray(value.refs) || value.refs.length > 30000 || value.refs.some((ref: unknown) => typeof ref !== "string" || ref.length > 100)) throw new Error("Recording metadata unavailable");
      return new Set<string>(value.refs);
    });
  catalog = { expires: Date.now() + 60000, work };
  void work.catch(() => { if (catalog?.work === work) catalog = null; });
  return work;
}
/** Metadata only: no remote audio is downloaded until an explicit play. */
export function useShermetRecordingAvailability(refs: readonly string[]) {
  const [available, setAvailable] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let current = true; setAvailable(new Set()); setPending(true);
    void getShermetRecordingRefs().then(value => { if (current) { setAvailable(new Set(refs.filter(ref => value.has(ref)))); setPending(false); } }).catch(() => { if (current) setPending(false); });
    return () => { current = false; };
  }, [refs]);
  return { refs: available, pending };
}
export function useShermetRecordings(refs: readonly string[]) {
  return useShermetRecordingAvailability(refs).refs;
}
