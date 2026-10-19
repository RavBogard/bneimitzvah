import { createHash } from "node:crypto";
import type { ReferenceCatalog } from "../../src/server/reference-audio/catalog";
import { SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE } from "../../src/lib/reference-audio/short-source";
import { createShortSourceManifestLoader, lookupShortSource } from "../../src/server/reference-audio/short-source-manifest";
import { verifyShortSourceBody } from "../../src/server/reference-audio/short-source-body";
/** Actual generated 4s@24k mono tagged64k fixture, no manufactured body receipt. */
export async function syntheticFourSecondShort(catalog: ReferenceCatalog, bytes: Uint8Array) {
  if (catalog.assets.length !== 1) throw Error("Synthetic short parent refused");
  const parent = catalog.assets[0], sha = createHash("sha256").update(bytes).digest("hex"), path = `/reference-audio/short-v1/${sha}.mp3`;
  const source = { schema: "reference-short-source/v1", id: `rs_${sha}`, parent: { asset: parent.id, sha256: parent.sha256, bytes: parent.bytes }, sha256: sha, bytes: bytes.length, path, codec: "mp3", bitrate: 64000, sampleRate: 24000, channels: 1, presentationFrames: 96000, origin: { firstFrame: 24000, parentRate: 24000 }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version };
  const parentBytes = new TextEncoder().encode(JSON.stringify(catalog)), parentSHA = createHash("sha256").update(parentBytes).digest("hex"), manifestBytes = new TextEncoder().encode(JSON.stringify({ schema: "reference-short-manifest/v1", source: "PockettorahAudioFiles", parentCatalogSHA256: parentSHA, recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: [source] }));
  const manifest = await createShortSourceManifestLoader({ sha256: createHash("sha256").update(manifestBytes).digest("hex"), parentCatalogSHA256: parentSHA, parentCatalogBytes: parentBytes, get: async () => new ReadableStream({ start(controller) { controller.enqueue(manifestBytes); controller.close(); } }) })();
  const entry = lookupShortSource(manifest, source.id); if (!entry) throw Error("Synthetic short entry refused"); verifyShortSourceBody(entry, new Uint8Array(bytes)); return { manifest, path };
}
