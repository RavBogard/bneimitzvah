"use client";
import { useEffect } from "react";
import { browserPlatform } from "../../../lib/offline/platform";
import { CACHE_FAMILY, MANIFEST_PATH, REOPEN_MS } from "../../../lib/offline/policy";
import { refreshOfflineState, setOfflineState } from "../../../lib/offline/pack-index";

/**
 * The installable app's page side (§3.1), mounted once in the root layout. On any origin but torah (and the
 * loopback test seam) it does nothing at all: no manifest link, no worker, no pack. On torah it links the
 * manifest and the Apple touch icon; in the installed app it also registers /sw.js, keeps storage persistent
 * (persisted() on every open, persist() again when it is false), and renews the packs on every online open.
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
    const { openOffline } = await import("../../../lib/offline/packer");
    const locks = (navigator as Navigator & { locks?: Parameters<typeof openOffline>[0]["locks"] }).locks ?? null;
    await openOffline({ origin: location.origin, fetch: (input, init) => fetch(input, init), caches, now: () => Date.now(), locks,
      estimate: async () => navigator.storage?.estimate ? navigator.storage.estimate() : {} });
  } catch { await refreshOfflineState(); }
}

let started = false;
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
    await open();
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt >= REOPEN_MS) { hiddenAt = 0; void keepPersisted().then(open); }
    });
    window.addEventListener("online", () => { void open(); });
  })();
}

export function OfflineRuntime() {
  useEffect(() => { startOfflineRuntime(); }, []);
  return null;
}
