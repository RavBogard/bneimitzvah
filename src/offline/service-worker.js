/*
 * CRC Torah's service worker (1.5 plan, A1, §3). Plain JavaScript with no imports: tests load it into node:vm.
 * Its route (src/app/sw.js/route.ts) writes `"use strict"` and `const POLICY = …` from src/lib/offline/policy.ts
 * above this comment, so the constants here and in the page are one source.
 *
 * The routing below is the complete allowlist (§3.2). Anything not named is not intercepted, so the browser's
 * ordinary network behaviour applies and nothing is cached: every private /api route, sign-in, sessions,
 * recordings, reference review, MCP, and anything generated. There are no push, notificationclick or sync
 * listeners. The worker keeps no copy of the pack index in memory: it reads the index for every packed request,
 * so a purge or a renewal by the page takes effect at once.
 */
const STATIC_PATH = new RegExp(POLICY.staticPath);
const STATIC_UNSAFE = new RegExp(POLICY.staticUnsafe, "i");
const CLIP_PATH = new RegExp(POLICY.clipPath);
const PACK_DATA_PATH = new RegExp(POLICY.packDataPath);
const SHERMET_AUDIO_PATH = new RegExp(POLICY.shermetAudioPath || "^/api/shermet-audio$");
const SHERMET_DATA_PATH = new RegExp(POLICY.shermetDataPath || "^/api/shermet-audio/(?:catalog|timing)$");
const OWNER_KEY = new RegExp(POLICY.ownerKey);
const HUMAN_TRACKS = new Set(POLICY.humanTracks || []);
/** The CRC siddur's evening text (2.0 SC7): served offline only from a pack of the index's own owner, never from a public pack. */
const OWNER_ONLY_PATH = typeof POLICY.ownerOnlyPath === "string" && POLICY.ownerOnlyPath ? new RegExp(POLICY.ownerOnlyPath) : /^\/api\/public\/evening-text$/;
const OWN_ORIGIN = self.location.origin;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;
/** Off (the tombstone) when PORTAL_OFFLINE_ENABLED is "false", or anywhere but the two named origins (torah, beitmitzvah) and loopback. */
const ACTIVE = POLICY.enabled === true && ((Array.isArray(POLICY.origins) && POLICY.origins.includes(OWN_ORIGIN)) || LOOPBACK.test(OWN_ORIGIN));

async function clearAll() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(POLICY.family)).map(key => caches.delete(key)));
}

function live(pack, now) {
  return pack.renewedAt - POLICY.skewMs <= now && now < Math.min(pack.expiresAt, pack.renewedAt + POLICY.windowMs);
}
/** The stored index, strictly; anything unexpected is no index (nothing is served from it). */
async function readIndex(cache) {
  try {
    const response = await cache.match(POLICY.indexKey);
    if (!response) return null;
    const value = await response.json();
    if (!value || value.format !== 1 || !Array.isArray(value.packs)) return null;
    const owner = value.owner === undefined || value.owner === null ? null : typeof value.owner === "string" && OWNER_KEY.test(value.owner) ? value.owner : undefined;
    if (owner === undefined) return null;
    for (const pack of value.packs) {
      // A public pack, or one of the index's own owner (A2: a person's own reading, still public text and clips).
      if (!pack || !(pack.owner === "public" || (owner !== null && pack.owner === owner)) || pack.format !== 1 || !Array.isArray(pack.assets) || !pack.assets.every(asset => typeof asset === "string")
        || !Number.isSafeInteger(pack.renewedAt) || !Number.isSafeInteger(pack.expiresAt)) return null;
    }
    return { format: 1, owner, packs: value.packs };
  } catch { return null; }
}
async function withLock(action) {
  const locks = self.navigator && self.navigator.locks;
  // Only when the page is not packing: activation never waits behind a long pack, and the page sweeps at its next open.
  return locks && typeof locks.request === "function" ? locks.request("crc-offline", { ifAvailable: true }, lock => lock ? action() : undefined) : action();
}

/** Drops expired packs and the assets only they held. Orphans with no pack at all are the page's sweep, under the same lock. */
async function sweep(now) {
  await withLock(async () => {
    if (!await caches.has(POLICY.offlineCache)) return;
    const cache = await caches.open(POLICY.offlineCache), index = await readIndex(cache);
    if (!index) return;
    const kept = index.packs.filter(pack => live(pack, now)), dropped = index.packs.filter(pack => !live(pack, now));
    if (!dropped.length) return;
    const keep = new Set(kept.flatMap(pack => pack.assets));
    for (const asset of new Set(dropped.flatMap(pack => pack.assets))) if (!keep.has(asset)) await cache.delete(asset);
    await cache.put(POLICY.indexKey, new Response(JSON.stringify({ format: 1, owner: index.owner, packs: kept }), { headers: { "content-type": "application/json" } }));
  });
}

const ASSET = /(?:\/_next\/static\/|\/fonts\/|\/brand\/)[^"'()\s\\<>`]+/g;
/** Chunk lists in inline bootstrap data name build files without the /_next prefix. */
const BARE_ASSET = /(?<![\w/.-])static\/(?:chunks|css|media)\/[^"'()\s\\<>`]+/g;
const CSS_URL = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g;
/** Same-origin app-code paths named in a page or a stylesheet. */
function staticPaths(text, base) {
  const out = [];
  for (const match of text.matchAll(ASSET)) out.push(match[0].replace(/&amp;/g, "&"));
  for (const match of text.matchAll(BARE_ASSET)) out.push("/_next/" + match[0].replace(/&amp;/g, "&"));
  for (const match of text.matchAll(CSS_URL)) {
    try { const url = new URL(match[1], base); if (url.origin === OWN_ORIGIN && STATIC_PATH.test(url.pathname)) out.push(url.pathname + url.search); } catch { /* Not a URL. */ }
  }
  return out;
}

/** The shell: the static pages (fetched with no cookie), the public manifest, and the build files they name. */
async function installShell() {
  const cache = await caches.open(POLICY.shellCache);
  let files = 0, bytes = 0;
  const seen = new Set();
  async function take(path, required) {
    if (seen.has(path)) return null;
    seen.add(path);
    try {
      if (files >= POLICY.shellLimits.files) throw new Error("Shell limit");
      const response = await fetch(path, { credentials: "omit", cache: "no-store", redirect: "error" });
      if (response.status !== 200 || response.type !== "basic") throw new Error("Shell refused");
      const body = await response.clone().arrayBuffer();
      if (bytes + body.byteLength > POLICY.shellLimits.bytes) throw new Error("Shell limit");
      files += 1; bytes += body.byteLength;
      await cache.put(path, response);
      // Only pages and stylesheets are read for the files they name.
      return !STATIC_PATH.test(path) || /\.css(?:\?|$)/.test(path) ? new TextDecoder().decode(body) : null;
    } catch (error) { if (required) throw error; return null; }
  }
  const found = [];
  for (const page of POLICY.shellPages) {
    const text = await take(page, page === "/read" || page === "/offline");
    if (text) found.push(...staticPaths(text, self.location.href));
  }
  for (const asset of POLICY.shellAssets) await take(asset, false);
  // Stylesheets first, so the fonts they name are found too.
  const queue = [...new Set(found)].sort((a, b) => Number(!a.includes(".css")) - Number(!b.includes(".css")));
  for (let i = 0; i < queue.length; i++) {
    const text = await take(queue[i], false);
    if (text && /\.css(?:\?|$)/.test(queue[i])) for (const path of staticPaths(text, new URL(queue[i], self.location.href).href)) if (!queue.includes(path)) queue.push(path);
  }
}

async function activate() {
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith(POLICY.shellPrefix) && key !== POLICY.shellCache).map(key => caches.delete(key)));
  await sweep(Date.now());
  await self.clients.claim();
}

/** A packed asset, only while some live pack lists it; marked so the page can say it is offline. */
async function fromPack(url) {
  // Never reopen (and so recreate) a pack cache a purge deleted.
  if (!await caches.has(POLICY.offlineCache)) return null;
  const cache = await caches.open(POLICY.offlineCache), index = await readIndex(cache), key = url.pathname + url.search, now = Date.now();
  const ownerOnly = OWNER_ONLY_PATH.test(url.pathname);
  if (!index || !index.packs.some(pack => live(pack, now) && pack.assets.includes(key) && (!ownerOnly || (index.owner !== null && pack.owner === index.owner)))) return null;
  const hit = await cache.match(url.href, { ignoreVary: true });
  if (!hit || hit.status !== 200) return null;
  const headers = new Headers(hit.headers);
  headers.set(POLICY.header, "1");
  return new Response(hit.body, { status: 200, statusText: hit.statusText, headers });
}
async function clip(request, url) {
  return (await fromPack(url)) ?? fetch(request);
}
/** Safari probes and seeks use the verified full object held by a live pack.
 * Range responses are never stored and never bypass the pack index or purge. */
async function shermetClip(request, url) {
  const hit = await fromPack(url);
  return hit ? rangedAudio(request, hit) : fetch(request);
}
async function rangedAudio(request, hit) {
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: hit.headers });
  const range = request.headers.has("if-range") ? null : request.headers.get("range");
  if (range === null) return hit;
  const body = await hit.blob(), length = body.size;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  let start = 0, end = length - 1, valid = Boolean(match && length && (match[1] || match[2]));
  if (valid && match[1]) {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
    valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < length && start <= end;
    end = Math.min(end, length - 1);
  } else if (valid) {
    const suffix = Number(match[2]); valid = Number.isSafeInteger(suffix) && suffix > 0;
    start = Math.max(0, length - suffix);
  }
  const headers = new Headers(hit.headers);
  headers.set("accept-ranges", "bytes");
  if (!valid) {
    headers.set("content-range", `bytes */${length}`); headers.set("content-length", "0");
    return new Response(null, { status: 416, headers });
  }
  headers.set("content-range", `bytes ${start}-${end}/${length}`); headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
async function humanTrackClip(request, url) {
  if (request.cache !== "reload" && await caches.has(POLICY.humanTrackCache)) {
    const cache = await caches.open(POLICY.humanTrackCache), hit = await cache.match(url.href);
    if (hit && hit.status === 200) {
      const expires = Number(hit.headers.get(POLICY.humanTrackExpiry));
      if (Date.now() < expires && expires <= Date.now() + POLICY.windowMs + POLICY.skewMs) return rangedAudio(request, hit);
      await cache.delete(url.href);
    }
  }
  return fetch(request);
}
async function packData(request, url) {
  try { return await fetch(request); }
  catch (error) { const hit = await fromPack(url); if (hit) return hit; throw error; }
}
async function navigate(request, url) {
  // Never cached at runtime: only the installed shell answers, and only when the network does not.
  try { return await fetch(request); }
  catch (error) {
    const cache = await caches.open(POLICY.shellCache);
    const page = POLICY.shellPages.includes(url.pathname) ? url.pathname : "/offline";
    const hit = (await cache.match(page)) || (await cache.match("/offline"));
    if (hit) return hit;
    throw error;
  }
}
async function appCode(request) {
  const cache = await caches.open(POLICY.shellCache), hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.status === 200 && response.type === "basic") { try { await cache.put(request, response.clone()); } catch { /* Served anyway. */ } }
  return response;
}
async function manifest(request) {
  try { return await fetch(request); }
  catch (error) { const hit = await (await caches.open(POLICY.shellCache)).match(POLICY.manifestPath); if (hit) return hit; throw error; }
}

function onFetch(event) {
  const request = event.request;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin === OWN_ORIGIN && ["GET", "HEAD"].includes(request.method) && HUMAN_TRACKS.has(url.pathname + url.search)) return event.respondWith(humanTrackClip(request, url));
  const libraryMedia = /^\?id=(sr_[a-f0-9]{32})&recording=[a-f0-9]{64}$/.exec(url.search);
  if (url.origin === OWN_ORIGIN && ["GET", "HEAD"].includes(request.method) && url.pathname === "/api/shermet-library/media" && libraryMedia && (POLICY.shermetLibraryIds || []).includes(libraryMedia[1])) return event.respondWith(shermetClip(request, url));
  if (url.origin === OWN_ORIGIN && ["GET", "HEAD"].includes(request.method) && SHERMET_AUDIO_PATH.test(url.pathname) && /^\?ref=[A-Za-z0-9+%.-]{1,100}$/.test(url.search)) return event.respondWith(shermetClip(request, url));
  if (url.origin !== OWN_ORIGIN || request.method !== "GET" || request.headers.has("range")) return;
  if (url.pathname === "/api/shermet-library" && (url.search === "?course=service" || /^\?lesson=[a-z-]{1,40}$/.test(url.search) && (POLICY.shermetLibraryLessons || []).includes(url.search.slice(8)))) return event.respondWith(packData(request, url));
  if (SHERMET_DATA_PATH.test(url.pathname) && (url.pathname.endsWith("/catalog") ? url.search === "" || url.search === "?format=manifest" : /^\?ref=[A-Za-z0-9+%.-]{1,100}$/.test(url.search))) return event.respondWith(packData(request, url));
  if (request.mode === "navigate") return event.respondWith(navigate(request, url));
  if (STATIC_PATH.test(url.pathname) && !STATIC_UNSAFE.test(url.pathname)) return event.respondWith(appCode(request));
  if (CLIP_PATH.test(url.pathname) && url.search === "") return event.respondWith(clip(request, url));
  if (PACK_DATA_PATH.test(url.pathname) && url.search.length > 1) return event.respondWith(packData(request, url));
  if (url.pathname === POLICY.manifestPath && url.search === "") return event.respondWith(manifest(request));
  // Everything else, including every other /api route, is the browser's own business.
}

if (ACTIVE) {
  self.addEventListener("install", event => { event.waitUntil(installShell()); });
  self.addEventListener("activate", event => { event.waitUntil(activate()); });
  self.addEventListener("fetch", onFetch);
} else {
  // The tombstone (§3.1, A's rollback): delete every cache this app made, then unregister. It serves nothing.
  self.addEventListener("install", () => { self.skipWaiting(); });
  self.addEventListener("activate", event => { event.waitUntil(clearAll().then(() => self.registration.unregister())); });
}
