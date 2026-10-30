#!/usr/bin/env node
// Fork-operator install of the openly published reference-audio kit.
//
//   npm run reference-kit:install                       download the pinned kit, verify, upload
//   npm run reference-kit:install -- --dry-run          download and verify only; upload nothing
//   npm run reference-kit:install -- --from <kit dir>   use a kit already on disk (no download)
//
// It downloads the GitHub Release assets for a pinned tag, checks SHA256SUMS against the
// hash pinned below and every file against SHA256SUMS, checks every clip against the
// manifest, and only then uploads into the operator's OWN private Vercel Blob store with
// BLOB_READ_WRITE_TOKEN from the environment. Uploads are create-only: an object already
// present with the same size is kept, a different size stops the run, nothing is
// overwritten. The token is never printed; the output names the env vars to set and
// their non-secret values.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CATALOG_BLOB_PREFIX, CLIP_SHARDS, KIT_LIMITS, KIT_REPOSITORY, KitRefused, MANIFEST_BLOB_PREFIX, checkKitCatalog, checkKitDescriptor, checkKitManifest,
  parseJsonBytes, parseSha256Sums, readTarShard, refuse, sha256, shardFor,
} from "./reference-kit-shared.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The trust root: the SHA-256 of each published kit's SHA256SUMS. A new kit gets a new
// tag and a new line here, in a reviewed commit.
export const PINNED_KITS = Object.freeze({
  "reference-kit-v1": "99b2e95ceaa002dac785b9ceb22c285760578e57be7ff9cf295d91b7bdce86d6",
});
export const DEFAULT_TAG = "reference-kit-v1";
const MAX_ASSET = 2 * 1024 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 8;

export function parseInstallArgs(args) {
  const out = { tag: DEFAULT_TAG, dryRun: false, from: null, dir: null, sums: null }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const name = args[i]; if (seen.has(name)) refuse("arguments"); seen.add(name);
    if (name === "--dry-run") { out.dryRun = true; continue; }
    const value = args[++i]; if (!value || value.startsWith("--")) refuse("arguments");
    if (name === "--tag" && /^reference-kit-v[0-9]{1,4}$/.test(value)) out.tag = value;
    else if (name === "--from") out.from = resolve(value);
    else if (name === "--download-dir") out.dir = resolve(value);
    else if (name === "--sums-sha256" && /^[a-f0-9]{64}$/.test(value)) out.sums = value;
    else refuse("arguments");
  }
  const pinned = out.sums ?? (Object.hasOwn(PINNED_KITS, out.tag) ? PINNED_KITS[out.tag] : null);
  if (!pinned || /^0{64}$/.test(pinned)) refuse("unpinned-tag");
  return Object.freeze({ tag: out.tag, dryRun: out.dryRun, from: out.from, dir: out.from ?? out.dir ?? join(ROOT, ".reference-kit", "download", out.tag), sumsSHA256: pinned });
}

const assetUrl = (tag, name) => `https://github.com/${KIT_REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

async function fileSHA256(path) {
  const s = await lstat(path).catch(() => null); if (!s?.isFile() || s.isSymbolicLink()) return null;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return { sha256: hash.digest("hex"), bytes: s.size };
}

/** Downloads one asset to <dir>/<name> through a .part file, hashing as it streams. A file
 * already present with the expected hash is kept. A mismatch removes the partial file. */
export async function downloadAsset({ fetchImpl, tag, dir, name, expected, cap = MAX_ASSET }) {
  const target = join(dir, name), part = `${target}.part`;
  if ((await fileSHA256(target))?.sha256 === expected) return { name, downloaded: false };
  await rm(part, { force: true });
  const response = await fetchImpl(assetUrl(tag, name), { redirect: "follow" });
  if (!response?.ok || !response.body) refuse("download");
  const hash = createHash("sha256"); let bytes = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), async function* (source) {
      for await (const chunk of source) { bytes += chunk.length; if (bytes > cap) refuse("download-size"); hash.update(chunk); yield chunk; }
    }, createWriteStream(part, { flags: "wx" }));
    if (hash.digest("hex") !== expected) refuse("hash-mismatch");
    await rm(target, { force: true }); await rename(part, target);
  } catch (error) { await rm(part, { force: true }); throw error; }
  return { name, downloaded: true };
}

/** Downloads SHA256SUMS, checks it against the pinned hash, then every file it lists. */
export async function downloadKit({ fetchImpl, tag, dir, sumsSHA256 }) {
  await mkdir(dir, { recursive: true });
  await downloadAsset({ fetchImpl, tag, dir, name: "SHA256SUMS", expected: sumsSHA256, cap: KIT_LIMITS.sumsBytes });
  const sums = parseSha256Sums((await readFile(join(dir, "SHA256SUMS"))).toString("utf8"));
  for (const [name, expected] of sums) await downloadAsset({ fetchImpl, tag, dir, name, expected });
}

/** Verifies a kit on disk end to end. Uploads nothing. Every clip is read and hashed. */
export async function verifyKit({ dir, tag, sumsSHA256 }) {
  const sumsBytes = await readFile(join(dir, "SHA256SUMS")).catch(() => refuse("missing-file"));
  if (sha256(sumsBytes) !== sumsSHA256) refuse("sums-pin");
  const sums = parseSha256Sums(sumsBytes.toString("utf8"));
  for (const [name, expected] of sums) { const actual = await fileSHA256(join(dir, name)); if (!actual) refuse("missing-file"); if (actual.sha256 !== expected) refuse("hash-mismatch"); }
  const kit = checkKitDescriptor(parseJsonBytes(await readFile(join(dir, "kit.json")), "kit-schema"));
  if (kit.tag !== tag || !sums.has("LICENSE-KIT.md")) refuse("kit-schema");
  for (const f of [kit.catalog, kit.manifest, ...kit.clips]) if (sums.get(f.file) !== f.sha256) refuse("kit-schema");
  if (sums.size !== 4 + kit.clips.length) refuse("kit-schema");
  const catalogBytes = await readFile(join(dir, kit.catalog.file)), manifestBytes = await readFile(join(dir, kit.manifest.file));
  const assets = checkKitCatalog(parseJsonBytes(catalogBytes, "catalog-schema"), catalogBytes.length);
  const entries = checkKitManifest(parseJsonBytes(manifestBytes, "manifest-schema"), kit.catalog.sha256, assets);
  if (entries.size !== kit.manifest.entries) refuse("kit-schema");
  const seen = new Set();
  for (let i = 0; i < CLIP_SHARDS.length; i++) {
    let n = 0;
    for await (const clip of readTarShard(join(dir, CLIP_SHARDS[i].file))) {
      const hash = clip.name.slice(0, 64), entry = entries.get(hash);
      if (!entry || seen.has(hash) || shardFor(hash) !== CLIP_SHARDS[i] || clip.bytes.length !== entry.bytes || sha256(clip.bytes) !== hash) refuse("clip-mismatch");
      seen.add(hash); n++;
    }
    if (n !== kit.clips[i].entries) refuse("clip-mismatch");
  }
  if (seen.size !== entries.size) refuse("clip-missing");
  return Object.freeze({ kit, catalogBytes, manifestBytes, entries });
}

/** Create-only upload. io = { head(pathname) -> { size } | null, put(pathname, bytes, contentType) }.
 * Clips first, the catalog next, the manifest last, so a store never names a missing object. */
export async function uploadKit({ dir, verified, io, log = () => {} }) {
  let created = 0, kept = 0;
  const one = async (pathname, bytes, contentType) => {
    const existing = await io.head(pathname);
    if (existing) { if (existing.size !== bytes.length) refuse("remote-differs"); kept++; return; }
    await io.put(pathname, bytes, contentType); created++;
  };
  for (const shard of CLIP_SHARDS) {
    const pending = new Set(); let failure = null;
    for await (const clip of readTarShard(join(dir, shard.file))) {
      if (failure) break;
      const hash = clip.name.slice(0, 64), entry = verified.entries.get(hash);
      if (!entry || sha256(clip.bytes) !== hash) refuse("clip-mismatch");
      // A failure is kept, never an unhandled rejection, and stops the run below.
      const task = one(entry.path.slice(1), clip.bytes, "audio/mpeg").catch(e => { failure ??= e; }).finally(() => pending.delete(task));
      pending.add(task); if (pending.size >= UPLOAD_CONCURRENCY) await Promise.race(pending);
    }
    await Promise.all(pending); if (failure) throw failure;
    log(`${shard.file}: done`);
  }
  await one(`${CATALOG_BLOB_PREFIX}${verified.kit.catalog.sha256}.json`, verified.catalogBytes, "application/json");
  await one(`${MANIFEST_BLOB_PREFIX}${verified.kit.manifest.sha256}.json`, verified.manifestBytes, "application/json");
  return { created, kept };
}

/** The store id is the third underscore field of a read-write token (as @vercel/blob parses it). */
export function storeIdFromToken(token) {
  const id = typeof token === "string" && /^vercel_blob_rw_[A-Za-z0-9]{8,64}_[A-Za-z0-9]+$/.test(token) ? token.split("_")[3] : null;
  return id ? `store_${id}` : refuse("token-shape");
}

export function envLines({ kit, storeId }) {
  return [
    `REFERENCE_AUDIO_CATALOG_SHA256=${kit.catalog.sha256}`,
    `REFERENCE_AUDIO_SHORT_MANIFEST_SHA256=${kit.manifest.sha256}`,
    `BLOB_STORE_ID=${storeId ?? "<the id of the private Blob store you upload to, store_...>"}`,
    "REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE=true",
    "REFERENCE_AUDIO_STUDENT_RELEASE=true",
  ];
}

async function blobIo(token) {
  // The SDK prefers an OIDC identity when one is present; this run uses the token alone.
  delete process.env.VERCEL_OIDC_TOKEN; delete process.env.BLOB_STORE_ID; process.env.VERCEL_BLOB_RETRIES = "2";
  const { head, put, BlobNotFoundError } = await import("@vercel/blob");
  return {
    head: async pathname => { try { const r = await head(pathname, { token }); return { size: r.size }; } catch (e) { if (e instanceof BlobNotFoundError) return null; throw e; } },
    put: async (pathname, bytes, contentType) => {
      const r = await put(pathname, bytes, { access: "private", token, contentType, addRandomSuffix: false, allowOverwrite: false });
      if (r.pathname !== pathname) refuse("remote-path");
    },
  };
}

export async function main(args, env, out = console.log) {
  const options = parseInstallArgs(args);
  if (env.VERCEL_BLOB_API_URL !== undefined || env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) refuse("blob-api-override");
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!options.dryRun && !token) refuse("token-missing");
  const storeId = token ? storeIdFromToken(token) : null;
  if (!options.from) { out(`Downloading ${options.tag} from ${KIT_REPOSITORY} releases`); await downloadKit({ fetchImpl: fetch, tag: options.tag, dir: options.dir, sumsSHA256: options.sumsSHA256 }); }
  const verified = await verifyKit({ dir: options.dir, tag: options.tag, sumsSHA256: options.sumsSHA256 });
  out(`Verified ${options.tag}: catalog, manifest and ${verified.entries.size} clips`);
  if (!options.dryRun) {
    out(`Uploading to ${storeId} (create-only; existing objects are kept)`);
    const result = await uploadKit({ dir: options.dir, verified, io: await blobIo(token), log: out });
    out(`Uploaded: ${result.created} created, ${result.kept} already present`);
  } else out("Dry run: nothing uploaded");
  out("");
  out("Set these Production environment variables on the Vercel project, then redeploy:");
  for (const line of envLines({ kit: verified.kit, storeId })) out(`  ${line}`);
  out("Connect the Blob store to the project so the deployment can read it, and credit PocketTorah as LICENSE-KIT.md says.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2), process.env); }
  catch (error) {
    // A fixed code only: never an exception message, which could carry a URL or a token.
    console.log(JSON.stringify({ ok: false, code: error instanceof KitRefused ? error.code : "reference-kit-install-failed" }));
    process.exitCode = 1;
  }
}
