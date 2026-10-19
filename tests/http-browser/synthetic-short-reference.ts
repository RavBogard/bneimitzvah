import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { isolatedEnv } from "../helpers/isolatedEnv.mjs";
import type { ReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { shortSourceFFmpegMetadataArgs } from "../../src/lib/reference-audio/short-source-tags";
import { createShortSourceManifestLoader, lookupShortSource } from "../../src/server/reference-audio/short-source-manifest";
import { verifyShortSourceBody } from "../../src/server/reference-audio/short-source-body";
import { normalizeShortSourceGapless } from "../../src/server/reference-audio/short-source-gapless";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Only called in the explicit HTTP/native lane. Independently measured PCM,
 * not MP3 metadata, supplies physicalFrames. No corpus/provider content. */
export async function generateSyntheticShortAudio(directory: string, name: "torah" | "haftarah", frequency = 440) {
  const iso = await isolatedEnv();
  const parentPath = join(directory, name + "-parent.mp3"), cutPath = join(directory, name + "-cut.pcm"), rawPath = join(directory, name + "-raw.mp3"), normalizedPath = join(directory, name + "-normalized.mp3");
  const invoke = (args: string[]) => promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-n", ...args], { env: iso.env, windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: "buffer" as const });
  try {
    await invoke(["-f", "lavfi", "-i", "sine=frequency=" + frequency + ":sample_rate=24000:duration=8", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "64k", parentPath]);
    const parent = await readFile(parentPath);
    const decoded = (await invoke(["-i", parentPath, "-codec:a", "pcm_s16le", "-f", "s16le", "-"])).stdout;
    if (decoded.length % 2 || decoded.length < 120000 * 2) throw Error("Synthetic parent capacity refused");
    const cut = decoded.subarray(24000 * 2, 120000 * 2), physicalFrames = cut.length / 2;
    if (physicalFrames !== 96000) throw Error("Synthetic cut geometry refused");
    await writeFile(cutPath, cut, { flag: "wx" });
    await invoke(["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", cutPath, "-map_metadata", "-1", "-codec:a", "libmp3lame", "-b:a", "64k", "-id3v2_version", "3", "-write_id3v1", "0", "-write_xing", "1", ...shortSourceFFmpegMetadataArgs(), rawPath]);
    const normalized = normalizeShortSourceGapless(new Uint8Array(await readFile(rawPath)), { sampleRate: 24000, channels: 1, physicalFrames });
    await writeFile(normalizedPath, normalized.bytes, { flag: "wx" });
    const roundtrip = (await invoke(["-i", normalizedPath, "-codec:a", "pcm_s16le", "-f", "s16le", "-"])).stdout;
    if (roundtrip.length !== physicalFrames * 2) throw Error("Synthetic roundtrip geometry refused");
    return { parent, bytes: normalized.bytes, physicalFrames, audit: normalized.audit };
  } catch { throw Error("Synthetic normalized audio generation refused; details withheld"); }
  finally { await iso.cleanup(); }
}

/** Every body/descriptor/path derives from actual copied normalized bytes. */
export async function syntheticShortReferences(catalog: ReferenceCatalog, inputs: readonly { asset: string; bytes: Uint8Array; physicalFrames: number }[]) {
  if (!inputs.length || inputs.length > 2 || inputs.length !== catalog.assets.length) throw Error("Synthetic short parents refused");
  const sources = inputs.map(input => {
    const parent = catalog.assets.find(asset => asset.id === input.asset); if (!parent || input.physicalFrames !== 96000) throw Error("Synthetic short parent refused");
    const normalized = normalizeShortSourceGapless(input.bytes, { sampleRate: 24000, channels: 1, physicalFrames: input.physicalFrames });
    const bytes = normalized.bytes, hash = sha(bytes), path = "/reference-audio/short-v1/" + hash + ".mp3";
    const source = { schema: "reference-short-source/v1", id: "rs_" + hash, parent: { asset: parent.id, sha256: parent.sha256, bytes: parent.bytes }, sha256: hash, bytes: bytes.length, path, codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: input.physicalFrames, origin: { firstFrame: 24000, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version };
    return { source, path, bytes: Buffer.from(bytes), audit: normalized.audit };
  });
  if (new Set(sources.map(row => row.path)).size !== sources.length) throw Error("Synthetic source identity refused");
  const parentBytes = new TextEncoder().encode(JSON.stringify(catalog)), parentSHA = sha(parentBytes), manifestBytes = new TextEncoder().encode(JSON.stringify({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: parentSHA, recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: sources.map(row => row.source) }));
  const manifest = await createShortSourceManifestLoader({ sha256: sha(manifestBytes), parentCatalogSHA256: parentSHA, parentCatalogBytes: parentBytes, get: async () => new ReadableStream({ start(controller) { controller.enqueue(manifestBytes); controller.close(); } }) })();
  for (const row of sources) { const entry = lookupShortSource(manifest, row.source.id); if (!entry) throw Error("Synthetic short entry refused"); verifyShortSourceBody(entry, row.bytes); }
  return { manifest, sources };
}
export async function syntheticFourSecondShort(catalog: ReferenceCatalog, bytes: Uint8Array, physicalFrames: number) {
  if (catalog.assets.length !== 1) throw Error("Synthetic short parent refused");
  const value = await syntheticShortReferences(catalog, [{ asset: catalog.assets[0].id, bytes, physicalFrames }]);
  return { manifest: value.manifest, ...value.sources[0] };
}
