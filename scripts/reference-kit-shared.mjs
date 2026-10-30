// Shared, dependency-free pieces of the openly published reference-audio kit (Daniel's
// ruling 10, 2026-10-30): its closed content checks, a deterministic ustar writer and
// reader, and SHA256SUMS. Importing this module performs no I/O and no network.
//
// The kit is published as a GitHub Release asset, never in the tracked tree. The
// never-in-repo guard keeps blocking reference-catalog data in Git; nothing here
// weakens it. Only PocketTorah-derived audio and timings may enter a kit: every check
// below is a closed allow-list, so anything else refuses the whole kit.
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

export const KIT_SCHEMA = "reference-audio-kit/v1";
export const KIT_REPOSITORY = "RavBogard/bneimitzvah";
export const KIT_SOURCE = "PockettorahAudioFiles";
export const KIT_CREDIT = "PocketTorah (not-a-box media lab), CC BY-SA 3.0";
export const CATALOG_SCHEMA = "reference-catalog/v1";
export const MANIFEST_SCHEMA = "reference-short-manifest/v1";
export const CATALOG_BLOB_PREFIX = "reference-audio/pockettorah/catalog/";
export const MANIFEST_BLOB_PREFIX = "reference-audio/short-v1/manifests/";
export const CLIP_PATH_PREFIX = "/reference-audio/short-v1/";
export const KIT_LIMITS = Object.freeze({ catalogBytes: 8 * 1024 * 1024, manifestBytes: 16 * 1024 * 1024, clipBytes: 1024 * 1024, assets: 600, entries: 10000, sumsBytes: 64 * 1024 });
// Four shards by the first hex digit of each clip's SHA-256: deterministic, each well under
// GitHub's 2 GiB asset limit, and few enough to download and retry by hand.
export const CLIP_SHARDS = Object.freeze([
  Object.freeze({ file: "clips-0-3.tar", first: "0123" }),
  Object.freeze({ file: "clips-4-7.tar", first: "4567" }),
  Object.freeze({ file: "clips-8-b.tar", first: "89ab" }),
  Object.freeze({ file: "clips-c-f.tar", first: "cdef" }),
]);
// Byte-identical to scripts/reference-index-contract.mjs ATTRIBUTION and the manifest's v2 attribution.
export const CATALOG_ATTRIBUTION = Object.freeze({
  title: "PocketTorah Audio Files", creator: "not-a-box media lab", license: "CC BY-SA 3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "Cut into single verses with computed word timings.",
});
export const MANIFEST_ATTRIBUTION = Object.freeze({
  version: "pockettorah-short-attribution/v2", title: "PocketTorah Audio Files", creator: "not-a-box media lab", license: "CC-BY-SA-3.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", changes: "Excerpted and re-encoded as a 64 kbps MP3; encoder gapless endpoint and checksum metadata normalized.",
});

export class KitRefused extends Error {
  constructor(code) { super(`Reference kit refused: ${code}`); this.code = code; }
}
export const refuse = code => { throw new KitRefused(code); };
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const isDigest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const plain = v => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
const keysExactly = (v, keys) => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const keysWithin = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const finite = v => typeof v === "number" && Number.isFinite(v) && v >= 0;
const count = (v, max) => Number.isSafeInteger(v) && v > 0 && v <= max;

export function parseJsonBytes(bytes, code) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return refuse(code); }
}

/** Closed check of the production timing catalog. It may hold verse refs, cut and word
 * times, recording names and hashes, the PocketTorah credit and a SHA-256 of each verse's
 * reading text. No text, translation or any other source can pass. */
export function checkKitCatalog(catalog, bytes) {
  if (!keysExactly(catalog, ["schema", "source", "assets"]) || catalog.schema !== CATALOG_SCHEMA || catalog.source !== KIT_SOURCE) refuse("catalog-schema");
  if (bytes !== undefined && (bytes > KIT_LIMITS.catalogBytes || /[֐-׿]/u.test(JSON.stringify(catalog)))) refuse("catalog-content");
  if (!Array.isArray(catalog.assets) || !count(catalog.assets.length, KIT_LIMITS.assets)) refuse("catalog-schema");
  const assets = new Map();
  for (const a of catalog.assets) {
    if (!keysExactly(a, ["id", "archiveFile", "sha256", "bytes", "verses"]) || typeof a.id !== "string" || !/^ra_[a-f0-9]{32}$/.test(a.id)
      || typeof a.archiveFile !== "string" || !/^[A-Za-z0-9._-]{1,128}\.mp3$/.test(a.archiveFile) || !isDigest(a.sha256) || !count(a.bytes, 64 * 1024 * 1024)
      || !Array.isArray(a.verses) || !a.verses.length || assets.has(a.id)) refuse("catalog-schema");
    for (const v of a.verses) {
      if (!keysWithin(v, ["schema", "ref", "table", "playback", "words", "attribution"]) || v.schema !== "reference-verse/v1" || typeof v.ref !== "string" || !/^[A-Za-z0-9 :,-]{3,64}$/.test(v.ref)) refuse("catalog-schema");
      if (v.table !== undefined && !["torah", "haftarah"].includes(v.table)) refuse("catalog-schema");
      if (v.attribution !== undefined && !same(v.attribution, CATALOG_ATTRIBUTION)) refuse("catalog-attribution");
      const p = v.playback, w = v.words;
      if (!keysWithin(p, ["status", "asset", "clip", "review", "reason"]) || typeof p.status !== "string" || p.status.length > 32) refuse("catalog-schema");
      if (p.asset !== undefined && p.asset !== a.id) refuse("catalog-schema");
      if (p.clip !== undefined && (!keysExactly(p.clip, ["start", "end"]) || !finite(p.clip.start) || !finite(p.clip.end))) refuse("catalog-schema");
      for (const s of [p.review, p.reason]) if (s !== undefined && (typeof s !== "string" || !/^[a-z-]{1,48}$/.test(s))) refuse("catalog-schema");
      if (!keysWithin(w, ["status", "readingTextSha256", "starts", "ends", "reason"]) || typeof w.status !== "string" || w.status.length > 32) refuse("catalog-schema");
      if (w.readingTextSha256 !== undefined && !isDigest(w.readingTextSha256)) refuse("catalog-schema");
      if (w.reason !== undefined && (typeof w.reason !== "string" || !/^[a-z-]{1,48}$/.test(w.reason))) refuse("catalog-schema");
      for (const list of [w.starts, w.ends]) if (list !== undefined && (!Array.isArray(list) || !list.every(finite))) refuse("catalog-schema");
    }
    assets.set(a.id, a);
  }
  return assets;
}

const ENTRY_KEYS = ["schema", "id", "parent", "sha256", "bytes", "path", "codec", "bitrate", "sampleRate", "channels", "presentationFrames", "origin", "attributionVersion"];
/** Closed check of the short-clip manifest against its parent catalog. Returns the entries
 * keyed by clip SHA-256, each bound to a PocketTorah recording in that catalog. */
export function checkKitManifest(manifest, catalogSHA256, assets) {
  if (!keysExactly(manifest, ["schema", "source", "parentCatalogSHA256", "recipe", "attribution", "entries"]) || manifest.schema !== MANIFEST_SCHEMA
    || manifest.source !== KIT_SOURCE || manifest.recipe !== "pockettorah-mp3-64k-gapless/v2") refuse("manifest-schema");
  if (manifest.parentCatalogSHA256 !== catalogSHA256) refuse("manifest-parent");
  if (!same(manifest.attribution, MANIFEST_ATTRIBUTION)) refuse("manifest-attribution");
  if (!Array.isArray(manifest.entries) || !count(manifest.entries.length, KIT_LIMITS.entries)) refuse("manifest-schema");
  const entries = new Map();
  for (const e of manifest.entries) {
    if (!keysExactly(e, ENTRY_KEYS) || e.schema !== "reference-short-source/v1" || !isDigest(e.sha256) || e.id !== `rs_${e.sha256}`
      || e.path !== `${CLIP_PATH_PREFIX}${e.sha256}.mp3` || !count(e.bytes, KIT_LIMITS.clipBytes) || e.codec !== "mp3" || e.bitrate !== 64000
      || e.attributionVersion !== MANIFEST_ATTRIBUTION.version || !keysExactly(e.parent, ["asset", "sha256", "bytes"])
      || !keysExactly(e.origin, ["firstFrame", "parentRate"]) || entries.has(e.sha256)) refuse("manifest-schema");
    const parent = assets.get(e.parent.asset);
    if (!parent || parent.sha256 !== e.parent.sha256 || parent.bytes !== e.parent.bytes) refuse("manifest-parent");
    entries.set(e.sha256, e);
  }
  return entries;
}

export const shardFor = clipSHA256 => CLIP_SHARDS.find(s => s.first.includes(clipSHA256[0])) ?? refuse("shard");

/** The kit's own descriptor. Every file named in it must also be in SHA256SUMS with the same hash. */
export function checkKitDescriptor(kit) {
  if (!keysExactly(kit, ["schema", "tag", "repository", "source", "license", "credit", "catalog", "manifest", "clips"]) || kit.schema !== KIT_SCHEMA
    || typeof kit.tag !== "string" || !/^reference-kit-v[0-9]{1,4}$/.test(kit.tag) || kit.repository !== KIT_REPOSITORY || kit.source !== KIT_SOURCE
    || kit.license !== "CC-BY-SA-3.0" || kit.credit !== KIT_CREDIT) refuse("kit-schema");
  const file = (v, keys) => {
    if (!keysExactly(v, keys) || typeof v.file !== "string" || !/^[a-z0-9.-]{1,96}$/.test(v.file) || !isDigest(v.sha256) || !count(v.bytes, 2 * 1024 * 1024 * 1024)) refuse("kit-schema");
    return v;
  };
  const catalog = file(kit.catalog, ["file", "sha256", "bytes"]), manifest = file(kit.manifest, ["file", "sha256", "bytes", "entries"]);
  if (catalog.file !== `catalog-${catalog.sha256}.json` || manifest.file !== `manifest-${manifest.sha256}.json` || !count(manifest.entries, KIT_LIMITS.entries)) refuse("kit-schema");
  if (!Array.isArray(kit.clips) || kit.clips.length !== CLIP_SHARDS.length) refuse("kit-schema");
  kit.clips.forEach((c, i) => { file(c, ["file", "sha256", "bytes", "entries"]); if (c.file !== CLIP_SHARDS[i].file || !Number.isSafeInteger(c.entries) || c.entries < 0) refuse("kit-schema"); });
  if (kit.clips.reduce((n, c) => n + c.entries, 0) !== manifest.entries) refuse("kit-schema");
  return kit;
}

export function formatSha256Sums(files) {
  return [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)).map(f => `${f.sha256}  ${f.file}\n`).join("");
}
export function parseSha256Sums(text) {
  if (typeof text !== "string" || !text.endsWith("\n") || text.length > KIT_LIMITS.sumsBytes) refuse("sums");
  const files = new Map();
  for (const line of text.slice(0, -1).split("\n")) {
    const m = /^([a-f0-9]{64}) {2}([A-Za-z0-9.-]{1,96}(?:\.json|\.tar|\.md))$/.exec(line);
    if (!m || files.has(m[2]) || m[2] === "SHA256SUMS") refuse("sums");
    files.set(m[2], m[1]);
  }
  if (!files.size) refuse("sums");
  return files;
}

// ---- Deterministic ustar: fixed mode, owner and mtime, so a rebuild hashes the same.
const BLOCK = 512;
function octal(value, width) { return value.toString(8).padStart(width - 1, "0") + "\0"; }
export function tarHeader(name, size) {
  if (!/^[a-f0-9]{64}\.mp3$/.test(name) || !Number.isSafeInteger(size) || size < 0 || size > KIT_LIMITS.clipBytes) refuse("tar-entry");
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, "ascii"); h.write(octal(0o644, 8), 100, "ascii"); h.write(octal(0, 8), 108, "ascii"); h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii"); h.write(octal(0, 12), 136, "ascii"); h.write("        ", 148, "ascii"); h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii"); h.write("00", 263, "ascii");
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}
export const tarPadding = size => Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
export const tarEnd = () => Buffer.alloc(BLOCK * 2);

function parseHeader(h) {
  if (h.every(b => b === 0)) return null;
  const field = (start, len) => h.subarray(start, start + len).toString("ascii").replace(/\0.*$/s, "");
  const stored = parseInt(field(148, 8).trim(), 8);
  let sum = 0; for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  const name = field(0, 100), sizeText = field(124, 12).trim();
  if (stored !== sum || field(257, 6) !== "ustar" || field(156, 1) !== "0" || field(345, 155) !== "" || !/^[0-7]{1,11}$/.test(sizeText)) refuse("tar-entry");
  const size = parseInt(sizeText, 8);
  if (!/^[a-f0-9]{64}\.mp3$/.test(name) || size <= 0 || size > KIT_LIMITS.clipBytes) refuse("tar-entry");
  return { name, size };
}
/** Reads one regular-file ustar shard written by tarHeader. Anything else (links,
 * directories, long names, truncation, trailing data) refuses. */
export async function* readTarShard(path) {
  const handle = await open(path, "r");
  try {
    const { size: total } = await handle.stat();
    let position = 0;
    const take = async length => {
      if (position + length > total) refuse("tar-truncated");
      const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead !== length) refuse("tar-truncated"); position += length; return buffer;
    };
    for (;;) {
      const entry = parseHeader(await take(BLOCK));
      if (!entry) { const second = await take(BLOCK); if (!second.every(b => b === 0) || position !== total) refuse("tar-trailing"); return; }
      const bytes = await take(entry.size); await take((BLOCK - (entry.size % BLOCK)) % BLOCK);
      yield { name: entry.name, bytes };
    }
  } finally { await handle.close(); }
}
