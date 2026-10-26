"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { APPROVED, PLAN } from "../../../lib/offline/copy";
import { offlineState, subscribeOfflineState, type OfflineState } from "../../../lib/offline/pack-index";
import { servedOffline, subscribeOffline } from "../../../lib/offline/signal";
import { plainProductName } from "../../../lib/offline/manifest";
import { MANIFEST_PATH } from "../../../lib/offline/policy";
import { browserPlatform, type Platform } from "../../../lib/offline/platform";
import styles from "./offline.module.css";

/**
 * The installable app's quiet status (§3.9, Song session): the reader's offline pill, the front door's saved line,
 * and "Needs a connection" in place of a tool's error. All of it is empty outside the installed app on the
 * torah or beitmitzvah origin (1.9 N24), because only that app ever has packs or a worker.
 */
export function useOfflinePacks(): OfflineState {
  return useSyncExternalStore(subscribeOfflineState, offlineState, offlineState);
}
/** True when this page was answered from a saved pack, or the device is offline. False while rendering on the server. */
export function useServedOffline(): boolean {
  return useSyncExternalStore(subscribeOffline, servedOffline, () => false);
}
/** The platform, once mounted (null on the server and in the first render). */
export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => { setPlatform(browserPlatform()); }, []);
  return platform;
}
/** Offline wording shows only where the installable app lives: the torah and beitmitzvah origins (inert on every other host). */
export function useOfflineWording(): boolean {
  const platform = usePlatform(), online = useOnline();
  return platform?.origin === true && !online;
}
export function useOnline(): boolean {
  const offline = useSyncExternalStore(subscribeOffline, () => { try { return navigator.onLine === false; } catch { return false; } }, () => false);
  return !offline;
}

/** The congregation's productName (E1), from the public manifest; null until known, or when it cannot be read. */
let name: Promise<string | null> | null = null;
export function readProductName(): Promise<string | null> {
  name ??= fetch(MANIFEST_PATH, { credentials: "omit", mode: "same-origin", redirect: "error", referrerPolicy: "no-referrer", headers: { accept: "application/manifest+json" } })
    .then(async response => response.ok ? plainProductName(((await response.json()) as { name?: unknown }).name) : null).catch(() => null)
    .then(value => { if (value === null) name = null; return value; });
  return name;
}
export function useProductName(enabled = true): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => { if (!enabled) return; let live = true; void readProductName().then(result => { if (live) setValue(result); }); return () => { live = false; }; }, [enabled]);
  return value;
}

/** "Fri 6 Nov": weekday and day, no year (pwa-offline.md §9). */
export const savedDate = (time: number) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(time));

/** The reader's offline pill, in the hero's meta line: only when an answer came from a saved pack or the device is offline. */
export function OfflinePill() {
  const offline = useServedOffline(), { savedUntil } = useOfflinePacks(), platform = usePlatform();
  if (!offline || !platform?.origin) return null;
  return <span className={styles.pill} data-offline-pill>{savedUntil ? PLAN.pill(savedDate(savedUntil)) : APPROVED.offline}</span>;
}

/** The front door's muted line under This week, in the installed app. */
export function SavedLine() {
  const { week, shell } = useOfflinePacks();
  const text = week === "saved" && shell ? PLAN.saved : week === "partial" ? PLAN.partly : week === "no-space" ? PLAN.noSpace : null;
  return text ? <p className={styles.savedLine} data-offline-saved={week ?? undefined}>{text}</p> : null;
}

/** Under a reading that could not load while offline: how long saved readings last. */
export function OfflineExpiryNote() {
  const wording = useOfflineWording(), productName = useProductName(wording);
  return wording && productName ? <p className="field-help" data-offline-expiry>{PLAN.expiry(productName)}</p> : null;
}
