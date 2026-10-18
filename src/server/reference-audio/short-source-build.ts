import "server-only";
import { createHash } from "node:crypto";
import { referenceRecord } from "../../lib/reference-audio/source";
import { parseShortReferenceSource, SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_PREFIX, SHORT_SOURCE_RECIPE, SHORT_SOURCE_SCHEMA, type ShortReferenceSource } from "../../lib/reference-audio/short-source";
import { parseReferenceCatalog, REFERENCE_CATALOG_LIMITS } from "./catalog";
import { createShortSourceManifestLoader, SHORT_MANIFEST_LIMITS, SHORT_MANIFEST_SCHEMA } from "./short-source-manifest";

export type ShortSourcePlanningHold = "parent-pin" | "facts-shape" | "parent-binding" | "unapproved-clip" | "profile" | "capacity" | "encoded-geometry" | "duplicate-body" | "conflicting-body" | "manifest-budget" | "manifest-validation";
export type ShortSourceBuildPlan = Readonly<{ status: "hold"; code: ShortSourcePlanningHold }>
  | Readonly<{ status: "planned"; manifestJSON: string; manifestSHA256: string; sourceCount: number; bodyVerification: "unverified-caller-facts" }>;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
class Hold extends Error { constructor(readonly code: ShortSourcePlanningHold) { super("Short source planning held"); } }
function hold(code: ShortSourcePlanningHold): never { throw new Hold(code); }
function facts(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > SHORT_MANIFEST_LIMITS.entries
    || Reflect.ownKeys(value).length !== value.length + 1) return hold("facts-shape");
  return Array.from({ length: value.length }, (_, i) => {
    const field = Object.getOwnPropertyDescriptor(value, String(i)); if (!field || !Object.hasOwn(field, "value")) return hold("facts-shape"); return field.value;
  });
}

/** Pure deterministic planning. Encoded hashes, native format/capacity and all
 * other supplied facts are UNVERIFIED claims, not measured media evidence.
 * No codec, filesystem, network, publication or byte-serving operation occurs.
 */
export async function planShortSourceBuild(input: { parentCatalogSHA256: string; parentCatalogBytes: Uint8Array; facts: unknown }): Promise<ShortSourceBuildPlan> {
  try {
    let parentBytes: Uint8Array, parents: ReturnType<typeof parseReferenceCatalog>;
    try {
      if (!hash(input.parentCatalogSHA256) || !(input.parentCatalogBytes instanceof Uint8Array)) return hold("parent-pin");
      const proto = Object.getPrototypeOf(Uint8Array.prototype), size = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(input.parentCatalogBytes));
      if (size < 1 || size > REFERENCE_CATALOG_LIMITS.bytes) return hold("parent-pin");
      const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(input.parentCatalogBytes) as ArrayBuffer;
      const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(input.parentCatalogBytes));
      parentBytes = new Uint8Array(new Uint8Array(buffer, offset, size));
      if (sha(parentBytes) !== input.parentCatalogSHA256) return hold("parent-pin");
      parents = parseReferenceCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(parentBytes)));
      if (!parents) return hold("parent-pin");
    } catch { return hold("parent-pin"); }
    const sources = new Map<string, ShortReferenceSource>();
    for (const value of facts(input.facts)) {
      const row = referenceRecord(value, ["parentAsset", "parentSHA256", "parentBytes", "sampleRate", "channels", "parentFrames", "clip", "encoded"]);
      if (!row) return hold("facts-shape");
      const clip = referenceRecord(row.clip, ["start", "end"]), encoded = referenceRecord(row.encoded, ["sha256", "bytes", "codec", "bitrate", "sampleRate", "channels", "presentationFrames", "recipe"]);
      if (!clip || !encoded) return hold("facts-shape");
      const parent = parents.assets.find(asset => asset.id === row.parentAsset);
      if (!parent || parent.sha256 !== row.parentSHA256 || parent.bytes !== row.parentBytes) return hold("parent-binding");
      if (typeof clip.start !== "number" || typeof clip.end !== "number" || !Number.isFinite(clip.start) || !Number.isFinite(clip.end)
        || !parent.verses.some(verse => verse.playback.status === "ready" && verse.playback.clip.start === clip.start && verse.playback.clip.end === clip.end)) return hold("unapproved-clip");
      if (!hash(encoded.sha256) || !integer(row.sampleRate) || row.sampleRate < 1 || row.sampleRate > 48000 || (row.channels !== 1 && row.channels !== 2)
        || encoded.codec !== "mp3" || encoded.bitrate !== 64000 || encoded.sampleRate !== row.sampleRate || encoded.channels !== row.channels || encoded.recipe !== SHORT_SOURCE_RECIPE) return hold("profile");
      const firstFrame = Math.floor(clip.start * row.sampleRate), lastExclusive = Math.ceil(clip.end * row.sampleRate), presentationFrames = lastExclusive - firstFrame;
      if (!integer(row.parentFrames) || row.parentFrames < 1 || firstFrame < 0 || !Number.isSafeInteger(lastExclusive) || lastExclusive > row.parentFrames) return hold("capacity");
      if (encoded.presentationFrames !== presentationFrames) return hold("encoded-geometry");
      const source = parseShortReferenceSource({ schema: SHORT_SOURCE_SCHEMA, id: `rs_${encoded.sha256}`,
        parent: { asset: parent.id, sha256: parent.sha256, bytes: parent.bytes }, sha256: encoded.sha256, bytes: encoded.bytes,
        path: `${SHORT_SOURCE_PREFIX}${encoded.sha256}.mp3`, codec: encoded.codec, bitrate: encoded.bitrate, sampleRate: row.sampleRate, channels: row.channels,
        presentationFrames, origin: { firstFrame, parentRate: row.sampleRate }, attributionVersion: SHORT_SOURCE_ATTRIBUTION.version });
      if (!source) return hold("profile");
      const previous = sources.get(source.id);
      if (previous) return hold(JSON.stringify(previous) === JSON.stringify(source) ? "duplicate-body" : "conflicting-body");
      sources.set(source.id, source);
    }
    const ordered = [...sources.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const manifestJSON = JSON.stringify({ schema: SHORT_MANIFEST_SCHEMA, source: "PockettorahAudioFiles", parentCatalogSHA256: input.parentCatalogSHA256,
      recipe: SHORT_SOURCE_RECIPE, attribution: SHORT_SOURCE_ATTRIBUTION, entries: ordered }) + "\n";
    const manifestBytes = new TextEncoder().encode(manifestJSON);
    if (manifestBytes.byteLength > SHORT_MANIFEST_LIMITS.bytes) return hold("manifest-budget");
    const manifestSHA256 = sha(manifestBytes);
    try {
      // Actual pinned parser/loader is the acceptance authority for metadata;
      // this in-memory stream performs no I/O and does not verify media bodies.
      await createShortSourceManifestLoader({ sha256: manifestSHA256, parentCatalogSHA256: input.parentCatalogSHA256, parentCatalogBytes: parentBytes,
        get: async () => new ReadableStream({ start(controller) { controller.enqueue(manifestBytes); controller.close(); } }) })();
    } catch { return hold("manifest-validation"); }
    return Object.freeze({ status: "planned", manifestJSON, manifestSHA256, sourceCount: ordered.length, bodyVerification: "unverified-caller-facts" });
  } catch (error) { return Object.freeze({ status: "hold", code: error instanceof Hold ? error.code : "facts-shape" }); }
}
