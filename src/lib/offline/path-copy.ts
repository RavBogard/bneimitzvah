import { parsePath, type Path } from "../service-course/path";
import { offlineState, pathCopyOwner, purgeGeneration, readIndex } from "./pack-index";
import { OFFLINE_CACHE, PATH_COPY_KEY } from "./policy";

/**
 * 2.0 SC6 decision point (A4 10, 13): the installed app's last copy of a signed-in student's own parts, so the course home can still
 * show "Your parts" offline. It is private, so it is kept exactly as an owner pack is:
 * - written only in the installed app (the only place with a pack cache), from a parts request that began after this page load's owner
 *   check named an owner (`ownerKey`, captured by the caller with the purge counter before the request): it is saved only while that
 *   check still names the same owner, the device's index names that owner too, and no purge has run since the request began. So parts
 *   fetched for one account are never stamped with another's key (adversarial review of #118: two windows, a sign-out and a sign-in);
 * - never into a cache a purge deleted (it does not recreate one), and never after a purge that ran while it was being written;
 * - read back only while it is that same owner's and inside the 14 days; the sweep at every online open drops it otherwise, and the
 *   sign-out purge, Remove saved readings and an account switch delete it with the whole pack cache.
 * It holds the least the home needs offline: the state, the slot, the review flag and the lesson ids. No pages, no plan or catalog ids.
 * The worker never serves its key; nothing but the course home and lesson pages read it.
 */
export type PathCopy = Readonly<{ path: Path; savedAt: number }>;
const cacheStorage = (): CacheStorage | null => { try { return typeof caches === "undefined" ? null : caches; } catch { return null; } };
const slim = (path: Path) => ({ ok: true, state: path.state, slot: path.slot, review: path.review, items: path.items.map(item => ({ lesson: item.lesson })) });

/** Who a parts request was made for: the owner key this page's check named, and the purge counter, both read before the request began. */
export type PathRequest = Readonly<{ owner: string; generation: number }>;
/** Read this before starting the parts request whose answer may be saved; null when nothing may be saved (no owner check yet, or no owner). */
export function pathRequest(): PathRequest | null {
  const { ownerChecked, ownerKey } = offlineState();
  return ownerChecked && ownerKey !== null ? Object.freeze({ owner: ownerKey, generation: purgeGeneration() }) : null;
}
const current = (request: PathRequest) => offlineState().ownerKey === request.owner && purgeGeneration() === request.generation;

export async function savePathCopy(path: Path, request: PathRequest | null, now = Date.now(), storage: CacheStorage | null = cacheStorage()): Promise<boolean> {
  if (!storage || !request || !current(request)) return false;
  try {
    if (!await storage.has(OFFLINE_CACHE)) return false;
    const cache = await storage.open(OFFLINE_CACHE), index = await readIndex(cache);
    if (index.owner !== request.owner || !current(request)) return false;
    await cache.put(PATH_COPY_KEY, new Response(JSON.stringify({ format: 1, owner: request.owner, savedAt: now, path: slim(path) }), { headers: { "content-type": "application/json" } }));
    if (!current(request) || (await readIndex(cache)).owner !== request.owner) { await cache.delete(PATH_COPY_KEY); return false; }
    return true;
  } catch { return false; }
}

/** The stored copy, when it is the device's own owner's (the index's) and inside the 14 days; otherwise null. */
export async function readPathCopy(now = Date.now(), storage: CacheStorage | null = cacheStorage()): Promise<PathCopy | null> {
  if (!storage) return null;
  try {
    if (!await storage.has(OFFLINE_CACHE)) return null;
    const cache = await storage.open(OFFLINE_CACHE), index = await readIndex(cache);
    if (index.owner === null || await pathCopyOwner(cache, now) !== index.owner) return null;
    const value = await (await cache.match(PATH_COPY_KEY))!.json() as { format?: unknown; savedAt: number; path: unknown };
    const path = value.format === 1 ? parsePath(value.path) : null;
    return path ? Object.freeze({ path, savedAt: value.savedAt }) : null;
  } catch { return null; }
}
