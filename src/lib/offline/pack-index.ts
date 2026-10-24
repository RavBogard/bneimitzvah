import { EMPTY_INDEX, INDEX_KEY, OFFLINE_CACHE, packLive, WINDOW_MS, parsePackIndex, type Pack, type PackIndex } from "./policy";

/**
 * The page's side of the pack index (§3.3–§3.5): read, write, sweep, inspect and purge. Small and import-free of
 * the course, so every page can carry it; the packer that downloads (packer.ts) loads only in the installed app.
 * Cache Storage is the only store: the index lives in the same cache as the assets, so the browser evicts them
 * together.
 */
export type PackState = "saving" | "saved" | "partial" | "no-space" | null;
/** `shell`: the worker is active, so its app shell is installed. `ownerChecked`: this page load has asked the private
 * endpoint whose readings this device keeps (A2), so the owner packs it lists are this account's. */
export type OfflineState = Readonly<{ week: PackState; course: PackState; savedUntil: number | null; shell: boolean; ownerChecked: boolean }>;
const EMPTY_STATE: OfflineState = Object.freeze({ week: null, course: null, savedUntil: null, shell: false, ownerChecked: false });

let state: OfflineState = EMPTY_STATE;
const listeners = new Set<() => void>();
export const offlineState = () => state;
export function setOfflineState(patch: Partial<OfflineState>) {
  state = Object.freeze({ ...state, ...patch });
  for (const listener of listeners) listener();
}
export function subscribeOfflineState(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Bumped by a purge: a pack in progress checks it before every write and stops. */
let generation = 0, running: AbortController | null = null, work: Promise<unknown> | null = null;
export const purgeGeneration = () => generation;
/** A sign-out in one tab stops a pack running in every other tab of this origin. */
const PURGE_CHANNEL = "crc-offline-purge";
let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(PURGE_CHANNEL);
    channel.onmessage = event => { if (event.data === "purge") { generation += 1; running?.abort(); running = null; } };
  }
} catch { channel = null; }
/** Resolves when the pack in progress (if any) has finished, so a caller can start the next one without cutting it short. */
export const packingIdle = (): Promise<void> => (work ?? Promise.resolve()).then(() => {}, () => {});
export function packingStarted(): AbortController { running?.abort(); running = new AbortController(); return running; }
/** The pack in progress, so a purge can wait for it to stop before it deletes. */
export function trackPacking<T>(promise: Promise<T>): Promise<T> { work = promise; void promise.finally(() => { if (work === promise) work = null; }).catch(() => {}); return promise; }

const cacheStorage = (): CacheStorage | null => { try { return typeof caches === "undefined" ? null : caches; } catch { return null; } };
export const assetKey = (url: string) => { const parsed = new URL(url); return parsed.pathname + parsed.search; };

export async function readIndex(cache: Cache): Promise<PackIndex> {
  try { const response = await cache.match(INDEX_KEY); return response ? parsePackIndex(await response.json()) : EMPTY_INDEX; } catch { return EMPTY_INDEX; }
}
export async function writeIndex(cache: Cache, index: PackIndex) {
  await cache.put(INDEX_KEY, new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }));
}

/**
 * Expired packs go, then every cached asset no live pack lists (the worker drops only what expired packs held).
 * `owner` replaces the index's owner (A2); a pack of any other owner goes with it. Left out, the owner stays.
 */
export async function sweep(cache: Cache, now: number, keep: (pack: Pack) => boolean = () => true, owner?: string | null): Promise<PackIndex> {
  const index = await readIndex(cache), nextOwner = owner === undefined ? index.owner : owner;
  const packs = index.packs.filter(pack => packLive(pack, now) && keep(pack) && (pack.owner === "public" || pack.owner === nextOwner));
  const listed = new Set(packs.flatMap(pack => pack.assets));
  for (const request of await cache.keys()) {
    const key = assetKey(request.url);
    if (key !== INDEX_KEY && !listed.has(key)) await cache.delete(request);
  }
  const next: PackIndex = Object.freeze({ format: 1, owner: nextOwner, packs: Object.freeze(packs) });
  await writeIndex(cache, next);
  return next;
}

/** Saved, partly saved (an asset was evicted) or nothing, from what the cache actually holds. */
export async function inspectPack(cache: Cache, pack: Pack | undefined, now: number, origin = location.origin): Promise<PackState> {
  if (!pack || !packLive(pack, now)) return null;
  for (const asset of pack.assets) if (!await cache.match(new URL(asset, origin).href, { ignoreVary: true })) return "partial";
  return "saved";
}
/** The state the page shows, recomputed from the stored index; `savedUntil` is This week's expiry. */
export async function refreshOfflineState(now = Date.now(), weekKey?: string) {
  const storage = cacheStorage(); if (!storage) return;
  try {
    if (!await storage.has(OFFLINE_CACHE)) { setOfflineState({ week: state.week === "no-space" ? "no-space" : null, course: state.course === "no-space" ? "no-space" : null, savedUntil: null }); return; }
    const cache = await storage.open(OFFLINE_CACHE), index = await readIndex(cache);
    const week = index.packs.find(pack => pack.descriptor.type === "week" && (!weekKey || pack.key === weekKey)), course = index.packs.find(pack => pack.descriptor.type === "course");
    const [weekState, courseState] = await Promise.all([inspectPack(cache, week, now), inspectPack(cache, course, now)]);
    setOfflineState({ week: weekState ?? (state.week === "no-space" ? "no-space" : null), course: courseState ?? (state.course === "no-space" ? "no-space" : null),
      savedUntil: weekState && week ? Math.min(week.expiresAt, week.renewedAt + WINDOW_MS) : null });
  } catch { /* The state stays as it was. */ }
}

/** The saved packs, for /offline. */
export async function savedPacks(now = Date.now()): Promise<readonly Pack[]> {
  const storage = cacheStorage(); if (!storage) return [];
  try { return storage && await storage.has(OFFLINE_CACHE) ? (await readIndex(await storage.open(OFFLINE_CACHE))).packs.filter(pack => packLive(pack, now)) : []; } catch { return []; }
}

/**
 * Sign-out, Remove saved readings, and the disabled flag: stop any pack in progress, then delete the pack cache
 * (index and assets together). The worker keeps no copy of the index, so it stops serving at once. Never throws; the caller signs out whatever happens here.
 */
export async function purgeOffline(): Promise<void> {
  generation += 1; running?.abort(); running = null;
  try { channel?.postMessage("purge"); } catch { /* No other tabs to tell. */ }
  setOfflineState({ week: null, course: null, savedUntil: null });
  const storage = cacheStorage(); if (!storage) return;
  try { await storage.delete(OFFLINE_CACHE); } catch { /* Nothing more to do here. */ }
  // A pack that was mid-write stops at its next check; wait briefly for it, then delete again in case it reopened the cache.
  const pending = work;
  if (pending) {
    await Promise.race([pending.catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
    try { await storage.delete(OFFLINE_CACHE); } catch { /* Nothing more to do here. */ }
  }
}
