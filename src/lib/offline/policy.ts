/**
 * The installable app's offline policy (1.5 plan, A1, §3). One source for the page and the service worker:
 * the worker route writes `workerPolicy()` into the head of /sw.js, so the two can never drift.
 *
 * What may ever be stored or served offline is the allowlist below and nothing else: the app shell
 * (static pages and their build files), the three public reading routes, the public manifest, and
 * PocketTorah's content-addressed short clips. No private API, no recording, no generated chant.
 */
/** The intended main address (§3.1). */
export const TORAH_ORIGIN = "https://torah.centralreform.org";
/** The live address (Daniel's decision 14, 1.9 N24, 2026-10-24: "Work on both"). */
export const BEIT_MITZVAH_ORIGIN = "https://beitmitzvah.centralreform.org";
/**
 * The only origins that get a manifest link, a worker or a pack: exactly these two, compared as whole strings, never by
 * suffix. Loopback is the test seam. Each origin has its own Cache Storage and its own host-only session cookie, so a pack
 * made on one is never served or seen on the other, and the sign-out and account-switch purges run on the origin they belong to.
 * Previews and other hosts stay inert. Once production selects a canonical origin (BETTER_AUTH_URL), the worker names only that
 * one (`workerOrigins`): the other becomes an alias whose pages redirect but whose /sw.js is still served, as the tombstone, so a
 * worker installed there before the cutover deletes its caches and unregisters at its next update check.
 */
export const OFFLINE_ORIGINS: readonly string[] = Object.freeze([TORAH_ORIGIN, BEIT_MITZVAH_ORIGIN]);
export const isOfflineOrigin = (origin: unknown): boolean => typeof origin === "string" && OFFLINE_ORIGINS.includes(origin);
/** The origins the worker may run on: the selected canonical origin alone when one is selected (and is one of the two), else both. */
export function workerOrigins(selected: string | null): readonly string[] {
  return Object.freeze(selected !== null && isOfflineOrigin(selected) ? [selected] : [...OFFLINE_ORIGINS]);
}
export const SHELL_CACHE_PREFIX = "crc-shell-";
export const OFFLINE_CACHE = "crc-offline-v1";
/** Every cache this app ever makes starts with this; the tombstone deletes them all. */
export const CACHE_FAMILY = "crc-";
/** The pack index, a JSON Response under a synthetic key the worker never serves to a page. */
export const INDEX_KEY = "/__crc_offline__/index";
export const OFFLINE_HEADER = "x-crc-offline";
export const DAY_MS = 86_400_000;
/** Daniel's 14 days, from the last successful online open (§3.4). */
export const WINDOW_MS = 14 * DAY_MS;
/** Clock-skew allowance before renewedAt; a clock set further back makes the pack expired. */
export const SKEW_MS = 5 * 60_000;
/** A complete pack renewed more recently than this is not renewed again on an open (firewall: 120 /api/public requests a minute). */
export const RENEW_AFTER_MS = 12 * 60 * 60_000;
/** Becoming visible after this long hidden counts as an open (§3.3). */
export const REOPEN_MS = 60 * 60_000;
/** Pack only while usage + needed stays under min(0.8 × quota, 300 MB) (§3.5). */
export const BUDGET = Object.freeze({ quotaShare: 0.8, capBytes: 300 * 1024 * 1024 });
export const SHELL_LIMITS = Object.freeze({ files: 200, bytes: 10 * 1024 * 1024 });
export const PACK_CONCURRENCY = 3;
export const MANIFEST_PATH = "/api/public/manifest";
/** Loopback-only test seam (§6.2): "1" acts as the installed app; "browser" as a torah browser tab. */
export const SEAM_KEY = "crc.offline.force-installed";
export const HINT_DISMISSED_KEY = "crc.offline.install-dismissed";

/** Static pages the worker keeps as the app shell; a navigation that fails offline falls back to one of them.
 * The Learn to lein lesson pages join them (shell.ts adds one per lesson). */
export const SHELL_BASE_PAGES: readonly string[] = Object.freeze(["/read", "/offline", "/learn", "/learn/about", "/learn/review"]);
/** App code: cache-first into the shell cache. */
export const STATIC_PATH = /^\/(?:_next\/static|fonts)\//;
/** Never app code, whatever its prefix: an encoded slash, backslash or dot segment. */
export const STATIC_UNSAFE = /%2f|%5c|%2e|\/\.\.?(?:\/|$)|\/\//i;
/** PocketTorah short clips only (G3): exactly the content-addressed short-v1 path, no query. */
export const CLIP_PATH = /^\/reference-audio\/short-v1\/[a-f0-9]{64}\.mp3$/;
/**
 * The public reading routes a pack may hold (§3.2): reading, text and short-reference pages, (2.0 SC7) the evening lessons' text, and
 * (1.9 N24) the week's calendar aliyot and its approved portion summary, the public route that never serves a draft.
 */
export const PACK_DATA_PATH = /^\/api\/public\/(?:reading|text|reference\/short|evening-text|aliyot|portion-summary)$/;
/**
 * A route only an owner pack may hold (2.0 SC7): the CRC siddur's evening text. Daniel, 2026-10-25: "Yes, for signed-in CRC people";
 * a signed-out visitor's device keeps none of it. The private /api/offline/packs names the evening pack only for a signed-in CRC person,
 * so it is always an owner pack, which the sign-out purge and an account switch remove; a public pack holding it is no index at all,
 * and the worker serves it only from a pack of the index's own owner.
 */
export const OWNER_ONLY_PATH = /^\/api\/public\/evening-text$/;
const pathOf = (asset: string) => { const query = asset.indexOf("?"); return query < 0 ? asset : asset.slice(0, query); };
export const ownerOnlyAsset = (asset: string): boolean => typeof asset === "string" && OWNER_ONLY_PATH.test(pathOf(asset));

/** May this same-origin path (with its query) ever enter a pack? The G3 and private-data guard. */
export function packAssetAllowed(asset: string): boolean {
  if (typeof asset !== "string" || !asset.startsWith("/") || asset.startsWith("//") || asset.length > 2048 || /[\s#\\]/.test(asset)) return false;
  const query = asset.indexOf("?"), path = query < 0 ? asset : asset.slice(0, query), search = query < 0 ? "" : asset.slice(query);
  if (CLIP_PATH.test(path)) return search === "";
  return PACK_DATA_PATH.test(path) && search.length > 1;
}

/**
 * A2: the private endpoint that names the signed-in person's own readings (descriptors only). The worker never
 * handles it; the page asks it with the session cookie and no-store on every online open of the installed app.
 */
export const OFFLINE_PACKS_PATH = "/api/offline/packs";
/** The opaque, per-person owner key the endpoint returns (an HMAC, base64url). */
export const OWNER_KEY = /^[A-Za-z0-9_-]{43}$/;
/** An owner pack's ref: a canonical reading ref (the packer checks it canonically), plain, and no longer than a canonical
 * ref may be (READING_REF_LIMITS.chars, 1000). One rule for the stored index, the endpoint's answer and the packer. */
const PACK_REF = /^[A-Za-z0-9 :;,.-]{1,1000}$/;
export const packRefAllowed = (ref: unknown): ref is string => typeof ref === "string" && PACK_REF.test(ref);

export type PackDescriptor = Readonly<{ type: "week"; date: string } | { type: "course" } | { type: "ref"; kind: "torah" | "haftarah"; ref: string } | { type: "evening" }>;
/** `owner` is "public" (This week, the course) or the owner key of the person whose own reading (or, CRC, evening text) it is. */
export type Pack = Readonly<{
  key: string; owner: string; label: string; descriptor: PackDescriptor; assets: readonly string[];
  bytes: number; renewedAt: number; expiresAt: number; format: 1;
}>;
/** `owner`: the last owner the private endpoint named on this device, or null (signed out, or never asked). */
export type PackIndex = Readonly<{ format: 1; owner: string | null; packs: readonly Pack[] }>;
export const EMPTY_INDEX: PackIndex = Object.freeze({ format: 1, owner: null, packs: Object.freeze([]) });

/** A pack is served only inside renewedAt − 5 min ≤ now < expiresAt, and never past 14 days from renewedAt. */
export function packLive(pack: Pick<Pack, "renewedAt" | "expiresAt">, now: number): boolean {
  return Number.isSafeInteger(pack.renewedAt) && Number.isSafeInteger(pack.expiresAt)
    && pack.renewedAt - SKEW_MS <= now && now < Math.min(pack.expiresAt, pack.renewedAt + WINDOW_MS);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function descriptorOf(value: unknown): PackDescriptor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.type === "course" && Object.keys(row).length === 1) return Object.freeze({ type: "course" });
  if (row.type === "evening" && Object.keys(row).length === 1) return Object.freeze({ type: "evening" });
  if (row.type === "week" && Object.keys(row).length === 2 && typeof row.date === "string" && DATE.test(row.date)) return Object.freeze({ type: "week", date: row.date });
  if (row.type === "ref" && Object.keys(row).length === 3 && (row.kind === "torah" || row.kind === "haftarah") && packRefAllowed(row.ref))
    return Object.freeze({ type: "ref", kind: row.kind, ref: row.ref });
  return null;
}
/** The stored index, strictly: anything unexpected is an empty index (and the sweep then clears the cache). */
export function parsePackIndex(value: unknown): PackIndex {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_INDEX;
    const row = value as Record<string, unknown>;
    if (row.format !== 1 || !Array.isArray(row.packs) || row.packs.length > 16) return EMPTY_INDEX;
    // An A1 index has no owner; anything else that is not an owner key is no index at all.
    const owner = row.owner === undefined || row.owner === null ? null : typeof row.owner === "string" && OWNER_KEY.test(row.owner) ? row.owner : undefined;
    if (owner === undefined) return EMPTY_INDEX;
    const packs: Pack[] = [];
    for (const raw of row.packs) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_INDEX;
      const p = raw as Record<string, unknown>, descriptor = descriptorOf(p.descriptor);
      // A public pack is This week or the course; an owner pack is a ref (or, CRC, the evening text) of the index's own owner, and only that.
      const owned = descriptor?.type === "ref" || descriptor?.type === "evening";
      const ownerOk = p.owner === "public" ? !!descriptor && !owned : owner !== null && p.owner === owner && owned;
      if (typeof p.key !== "string" || p.key.length > 64 || !ownerOk || typeof p.label !== "string" || p.label.length > 160 || !descriptor
        || !Array.isArray(p.assets) || p.assets.length > 4000 || !p.assets.every(packAssetAllowed)
        // The evening text is only ever an owner pack's: a public pack that holds it, or an evening pack holding anything else, is no index.
        || (p.owner === "public" && (p.assets as string[]).some(ownerOnlyAsset)) || (descriptor.type === "evening" && !(p.assets as string[]).every(ownerOnlyAsset))
        || !Number.isSafeInteger(p.bytes) || (p.bytes as number) < 0
        || !Number.isSafeInteger(p.renewedAt) || !Number.isSafeInteger(p.expiresAt) || p.format !== 1) return EMPTY_INDEX;
      packs.push(Object.freeze({ key: p.key, owner: p.owner as string, label: p.label, descriptor, assets: Object.freeze([...(p.assets as string[])]),
        bytes: p.bytes as number, renewedAt: p.renewedAt as number, expiresAt: p.expiresAt as number, format: 1 }));
    }
    return Object.freeze({ format: 1, owner, packs: Object.freeze(packs) });
  } catch { return EMPTY_INDEX; }
}

export const isLoopbackOrigin = (origin: string) => /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(origin);

/** The constants the worker runs on, written into the head of /sw.js by its route. */
export function workerPolicy(input: { build: string; enabled: boolean; shellPages: readonly string[]; origins?: readonly string[] }) {
  return Object.freeze({
    build: /^[a-z0-9]{1,64}$/i.test(input.build) ? input.build : "dev", enabled: input.enabled === true, origins: Object.freeze((input.origins ?? OFFLINE_ORIGINS).filter(isOfflineOrigin)),
    shellCache: SHELL_CACHE_PREFIX + (/^[a-z0-9]{1,64}$/i.test(input.build) ? input.build : "dev"), shellPrefix: SHELL_CACHE_PREFIX,
    offlineCache: OFFLINE_CACHE, family: CACHE_FAMILY, indexKey: INDEX_KEY, header: OFFLINE_HEADER, windowMs: WINDOW_MS, skewMs: SKEW_MS,
    shellPages: Object.freeze([...input.shellPages]), shellAssets: [MANIFEST_PATH], shellLimits: SHELL_LIMITS, manifestPath: MANIFEST_PATH,
    staticPath: STATIC_PATH.source, staticUnsafe: STATIC_UNSAFE.source, clipPath: CLIP_PATH.source, packDataPath: PACK_DATA_PATH.source, ownerKey: OWNER_KEY.source,
    ownerOnlyPath: OWNER_ONLY_PATH.source,
  });
}
export type WorkerPolicy = ReturnType<typeof workerPolicy>;
