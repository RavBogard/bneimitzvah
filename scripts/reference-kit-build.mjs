#!/usr/bin/env node
// Builds the openly published reference-audio kit into a local, git-ignored folder
// (default .reference-kit/<tag>/). The lead publishes it as a GitHub Release; this script
// makes no network request and never writes into the tracked tree.
//
//   node scripts/reference-kit-build.mjs --catalog <catalog.json> --manifest <manifest.json>
//     --clips <dir> [--clips <dir> ...] [--tag reference-kit-v1] [--out .reference-kit]
//
// The kit ships the rendered short clips rather than asking a fork to re-encode them:
// the manifest pins every clip's exact bytes, and the encoder that produced them is
// pinned by binary hash on one machine, so a fork's own ffmpeg would not reproduce them.
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import {
  CLIP_SHARDS, KIT_CREDIT, KIT_LIMITS, KIT_REPOSITORY, KIT_SCHEMA, KIT_SOURCE, KitRefused, checkKitCatalog, checkKitDescriptor,
  checkKitManifest, formatSha256Sums, parseJsonBytes, refuse, sha256, shardFor, tarEnd, tarHeader, tarPadding,
} from "./reference-kit-shared.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_KIT_TAG = "reference-kit-v1";

export function parseBuildArgs(args) {
  const out = { clips: [], tag: DEFAULT_KIT_TAG, out: join(ROOT, ".reference-kit") }, seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const [name, value] = [args[i], args[i + 1]];
    if (!value || value.startsWith("--")) refuse("arguments");
    if (name !== "--clips" && seen.has(name)) refuse("arguments");
    seen.add(name);
    if (name === "--clips") out.clips.push(resolve(value));
    else if (["--catalog", "--manifest", "--out"].includes(name)) out[name.slice(2)] = resolve(value);
    else if (name === "--tag" && /^reference-kit-v[0-9]{1,4}$/.test(value)) out.tag = value;
    else refuse("arguments");
  }
  if (!out.catalog || !out.manifest || !out.clips.length) refuse("arguments");
  return Object.freeze({ catalog: out.catalog, manifest: out.manifest, clips: Object.freeze(out.clips), tag: out.tag, out: out.out });
}

async function regularFile(path, cap) {
  const s = await lstat(path).catch(() => refuse("input"));
  if (!s.isFile() || s.isSymbolicLink() || s.size <= 0 || s.size > cap) refuse("input");
  const bytes = await readFile(path); if (bytes.length !== s.size) refuse("input"); return bytes;
}

export function licenseText(tag, catalogFile, manifestFile) {
  return `# Reference-audio kit ${tag}

This kit holds the PocketTorah reference audio prepared for the CRC B'nei Mitzvah portal
(https://github.com/${KIT_REPOSITORY}), so that another congregation running its own copy
can serve the same recordings.

- \`${catalogFile}\`: verse cuts and word timings for each PocketTorah recording.
- \`${manifestFile}\`: the list of short verse clips, each with its SHA-256 and its source recording.
- \`clips-*.tar\`: the short verse clips (64 kbps MP3), one file per clip, named by its SHA-256.
- \`kit.json\` and \`SHA256SUMS\`: the kit's contents and checksums.

## Source

PocketTorah Audio Files, by not-a-box media lab: archive.org item \`${KIT_SOURCE}\`
(https://archive.org/details/${KIT_SOURCE}), licensed under the Creative Commons
Attribution-ShareAlike 3.0 licence (CC BY-SA 3.0, https://creativecommons.org/licenses/by-sa/3.0/).

Attribution: "${KIT_CREDIT}".

## Changes, and the licence of this kit

The clips are excerpts of the original recordings, cut into single verses and re-encoded as
64 kbps MP3, with the encoder's gapless endpoint and checksum metadata normalised. The timings
in the catalog (each verse's start and end and each word's start and end) were computed from the
recordings and PocketTorah's word labels. The clips and the timings are a derived work
(an adaptation) of PocketTorah Audio Files.

This kit, including the clips and the timings, is licensed under CC BY-SA 3.0, with the
attribution above. If you share it or anything made from it, credit PocketTorah as above,
say what you changed, and share it under the same licence. Neither not-a-box media lab nor
Central Reform Congregation endorses any use of this kit.

## What this kit does not contain

No Torah, haftarah or translation text (the catalog keeps only a SHA-256 of each verse's
reading text, to check that its word timings match the text a portal shows), no student,
family or congregation data, and no generated chant.
`;
}

/** Writes one shard and returns its descriptor. Entries are sorted by clip SHA-256. */
async function writeShard(path, clips) {
  const hash = createHash("sha256"), stream = createWriteStream(path, { flags: "wx", mode: 0o644 });
  let bytes = 0;
  const write = chunk => new Promise((done, fail) => { hash.update(chunk); bytes += chunk.length; stream.write(chunk, e => (e ? fail(e) : done())); });
  try {
    for (const { name, path, sha } of clips) {
      // Read again and re-hash: the bytes written are the bytes verified.
      const data = await readFile(path); if (sha256(data) !== sha) refuse("clip-changed");
      await write(tarHeader(name, data.length)); await write(data); const pad = tarPadding(data.length); if (pad.length) await write(pad);
    }
    await write(tarEnd());
  } finally { await new Promise(done => stream.end(done)); }
  return { sha256: hash.digest("hex"), bytes };
}

export async function buildReferenceKit(options) {
  const catalogBytes = await regularFile(options.catalog, KIT_LIMITS.catalogBytes), manifestBytes = await regularFile(options.manifest, KIT_LIMITS.manifestBytes);
  const catalogSHA256 = sha256(catalogBytes), manifestSHA256 = sha256(manifestBytes);
  const assets = checkKitCatalog(parseJsonBytes(catalogBytes, "catalog-schema"), catalogBytes.length);
  const entries = checkKitManifest(parseJsonBytes(manifestBytes, "manifest-schema"), catalogSHA256, assets);
  for (const dir of options.clips) { const s = await lstat(dir).catch(() => refuse("input")); if (!s.isDirectory() || s.isSymbolicLink()) refuse("input"); }

  // Every clip the manifest names, found by name, measured and hashed before anything is written.
  const shards = CLIP_SHARDS.map(() => []);
  for (const entry of [...entries.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : 1))) {
    const name = `${entry.sha256}.mp3`; let path = null;
    for (const dir of options.clips) {
      const s = await lstat(join(dir, name)).catch(() => null);
      if (!s?.isFile() || s.isSymbolicLink() || s.size !== entry.bytes) continue;
      if (sha256(await readFile(join(dir, name))) === entry.sha256) { path = join(dir, name); break; }
    }
    if (!path) refuse("clip-missing");
    shards[CLIP_SHARDS.indexOf(shardFor(entry.sha256))].push({ name, path, sha: entry.sha256 });
  }

  const final = join(options.out, options.tag), work = `${final}.partial`;
  if (await lstat(final).catch(() => null)) refuse("output-exists");
  await rm(work, { recursive: true, force: true }); await mkdir(work, { recursive: true });
  try {
    const catalogFile = `catalog-${catalogSHA256}.json`, manifestFile = `manifest-${manifestSHA256}.json`;
    await writeFile(join(work, catalogFile), catalogBytes, { flag: "wx" });
    await writeFile(join(work, manifestFile), manifestBytes, { flag: "wx" });
    const clips = [];
    for (let i = 0; i < CLIP_SHARDS.length; i++) clips.push({ file: CLIP_SHARDS[i].file, ...(await writeShard(join(work, CLIP_SHARDS[i].file), shards[i])), entries: shards[i].length });
    const kit = checkKitDescriptor({ schema: KIT_SCHEMA, tag: options.tag, repository: KIT_REPOSITORY, source: KIT_SOURCE, license: "CC-BY-SA-3.0", credit: KIT_CREDIT,
      catalog: { file: catalogFile, sha256: catalogSHA256, bytes: catalogBytes.length },
      manifest: { file: manifestFile, sha256: manifestSHA256, bytes: manifestBytes.length, entries: entries.size }, clips });
    const kitBytes = Buffer.from(JSON.stringify(kit, null, 2) + "\n"), license = Buffer.from(licenseText(options.tag, catalogFile, manifestFile));
    await writeFile(join(work, "kit.json"), kitBytes, { flag: "wx" });
    await writeFile(join(work, "LICENSE-KIT.md"), license, { flag: "wx" });
    const files = [
      { file: catalogFile, sha256: catalogSHA256, bytes: catalogBytes.length }, { file: manifestFile, sha256: manifestSHA256, bytes: manifestBytes.length },
      ...clips.map(({ file, sha256: s, bytes }) => ({ file, sha256: s, bytes })),
      { file: "kit.json", sha256: sha256(kitBytes), bytes: kitBytes.length }, { file: "LICENSE-KIT.md", sha256: sha256(license), bytes: license.length },
    ];
    const sums = Buffer.from(formatSha256Sums(files));
    await writeFile(join(work, "SHA256SUMS"), sums, { flag: "wx" });
    await rename(work, final);
    return { ok: true, dir: final, tag: options.tag, catalogSHA256, manifestSHA256, entries: entries.size, sumsSHA256: sha256(sums),
      files: [...files, { file: "SHA256SUMS", sha256: sha256(sums), bytes: sums.length }] };
  } catch (error) { await rm(work, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await buildReferenceKit(parseBuildArgs(process.argv.slice(2)));
    console.log(JSON.stringify({ ...result, dir: basename(dirname(result.dir)) + "/" + basename(result.dir) }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: error instanceof KitRefused ? error.code : "reference-kit-build-failed" }));
    process.exitCode = 1;
  }
}
