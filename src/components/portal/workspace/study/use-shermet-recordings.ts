"use client";
import { useEffect, useState } from "react";
/** Metadata only: no remote audio is downloaded until an explicit play. */
export function useShermetRecordings(refs: readonly string[]) {
  const [available, setAvailable] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const abort = new AbortController(); setAvailable(new Set());
    void fetch("/api/shermet-audio/catalog", { signal: abort.signal, cache: "no-store", credentials: "omit", redirect: "error" })
      .then(response => response.ok ? response.json() : null).then(value => {
        if (!abort.signal.aborted && Array.isArray(value?.refs)) setAvailable(new Set(value.refs.filter((ref: unknown): ref is string => typeof ref === "string" && refs.includes(ref))));
      }).catch(() => {});
    return () => abort.abort();
  }, [refs]);
  return available;
}
