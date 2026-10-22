"use client";
import { useEffect, useState } from "react";
import { DEFAULT_CONGREGATION, settingsApi, type Congregation, type Links } from "./api";

// One read serves every part of the page (header, service parts, honors, parent summary). The
// settings are congregation-wide and not private, so a short shared reuse is safe; a failed read is
// never reused, and the next caller asks again.
const REUSE_MS = 60_000;
let shared: { at: number; promise: Promise<Congregation> } | null = null;
function readCongregation(now = Date.now()): Promise<Congregation> {
  if (shared && now - shared.at < REUSE_MS) return shared.promise;
  const entry = { at: now, promise: settingsApi.congregation() };
  entry.promise.catch(() => { if (shared === entry) shared = null; });
  shared = entry; return entry.promise;
}
/** Tests only: forget the shared read. */
export function resetCongregationRead() { shared = null; }

/**
 * The congregation's links, service names and times, and consent notice. Until the read settles (or
 * if it fails) the page keeps what it has always shown, so nothing disappears while it loads.
 */
export function useCongregation(enabled: boolean): Congregation & { ready: boolean } {
  // ready: the read has settled (either way), so a name that would otherwise change in place can be shown.
  const [value, setValue] = useState<Congregation & { ready: boolean }>({ ...DEFAULT_CONGREGATION, ready: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    readCongregation().then(next => { if (live) setValue({ ...next, ready: true }); }, () => { if (live) setValue(current => current.ready ? current : { ...current, ready: true }); });
    return () => { live = false; };
  }, [enabled]);
  return value;
}
export function useCongregationLinks(enabled: boolean): Links { return useCongregation(enabled).links; }
