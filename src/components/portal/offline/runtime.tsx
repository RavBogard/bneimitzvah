"use client";
import { useEffect } from "react";
import { browserPlatform } from "../../../lib/offline/platform";
import { CACHE_FAMILY, MANIFEST_PATH, REOPEN_MS } from "../../../lib/offline/policy";
import { packingIdle, refreshOfflineState, setOfflineState } from "../../../lib/offline/pack-index";

/**
 * The installable app's page side (§3.1), mounted once in the root layout. On any origin but torah and beitmitzvah (and the
 * loopback test seam) it does nothing at all: no manifest link, no worker, no pack. On those two it links the
 * manifest and the Apple touch icon; in the installed app it also registers /sw.js, keeps storage persistent
 * (persisted() on every open, persist() again when it is false), and renews the packs on every online open,
 * first asking the private /api/offline/packs whose own readings this device keeps (A2).
 */
const ENABLED = process.env.PORTAL_OFFLINE_ENABLED !== "false";

/** Chromium's deferred install prompt (Android, desktop); iOS has none. */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice?: Promise<{ outcome: string }> };
let deferred: InstallPrompt | null = null;
const promptListeners = new Set<() => void>();
const publishPrompt = () => { for (const listener of promptListeners) listener(); };
export const installPrompt = () => deferred;
export function subscribeInstallPrompt(listener: () => void) { promptListeners.add(listener); return () => { promptListeners.delete(listener); }; }
export async function promptInstall(): Promise<boolean> {
  const event = deferred; if (!event) return false;
  deferred = null; publishPrompt();
  try { await event.prompt(); return (await event.userChoice)?.outcome === "accepted"; } catch { return false; }
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", event => {
    if (!browserPlatform().origin) return;
    event.preventDefault(); deferred = event as InstallPrompt; publishPrompt();
  });
  window.addEventListener("appinstalled", () => { deferred = null; publishPrompt(); });
}

function link(rel: string, href: string, extra: Record<string, string> = {}) {
  if (document.head.querySelector(`link[rel="${rel}"][data-crc-offline]`)) return;
  const node = document.createElement("link");
  node.rel = rel; node.href = href; node.dataset.crcOffline = "";
  for (const [key, value] of Object.entries(extra)) node.setAttribute(key, value);
  document.head.append(node);
}
async function keepPersisted() {
  try { const storage = navigator.storage; if (storage?.persisted && !await storage.persisted()) await storage.persist?.(); } catch { /* Best effort, silent on every platform. */ }
}
async function disable() {
  try { for (const registration of await navigator.serviceWorker?.getRegistrations?.() ?? []) await registration.unregister(); } catch { /* Nothing registered. */ }
  try { for (const key of await caches.keys()) if (key.startsWith(CACHE_FAMILY)) await caches.delete(key); } catch { /* No caches. */ }
}
async function open() {
  await refreshOfflineState();
  if (navigator.onLine === false) return;
  try {
    const { askOwner, openOffline } = await import("../../../lib/offline/packer");
    const locks = (navigator as Navigator & { locks?: Parameters<typeof openOffline>[0]["locks"] }).locks ?? null;
    const io = { origin: location.origin, fetch: ((input, init) => fetch(input, init)) as typeof fetch };
    await openOffline({ ...io, caches, now: () => Date.now(), locks, owner: signal => askOwner(io, signal),
      estimate: async () => navigator.storage?.estimate ? navigator.storage.estimate() : {} });
  } catch { await refreshOfflineState(); }
}

let started = false, packing = false;
/**
 * A saved reading's verses were revised (1.7): ask again which readings this device keeps, so the old passage goes and the revised one is
 * packed now rather than at the next open. Only the installed app keeps packs, and only while online; anywhere else this does nothing.
 */
export function refreshOfflinePacks() {
  if (!packing || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  // After the pack in progress, never in its place: a second open would cut it short.
  void packingIdle().then(open);
}
export function startOfflineRuntime() {
  if (started) return; started = true;
  const platform = browserPlatform();
  if (!platform.origin) return;
  link("manifest", MANIFEST_PATH);
  link("apple-touch-icon", "/apple-touch-icon.png", { sizes: "180x180" });
  if (!("serviceWorker" in navigator) || typeof caches === "undefined") return;
  if (!ENABLED) { void disable(); return; }
  if (!platform.installed) return;
  void (async () => {
    try { await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); } catch { return; }
    void navigator.serviceWorker.ready.then(() => setOfflineState({ shell: true }), () => {});
    await keepPersisted();
    packing = true;
    await open();
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= REOPEN_MS) { hiddenAt = 0; void keepPersisted().then(open); }
    });
    let online: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("online", () => { clearTimeout(online); online = setTimeout(() => { void open(); }, 5000); });
  })();
}

export function OfflineRuntime() {
  useEffect(() => { startOfflineRuntime(); }, []);
  return null;
}
