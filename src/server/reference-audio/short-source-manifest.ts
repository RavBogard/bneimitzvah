import "server-only";
import { createHash } from "node:crypto";
import { parseShortReferenceSource, SHORT_SOURCE_ATTRIBUTION, SHORT_SOURCE_RECIPE, type ShortReferenceSource } from "../../lib/reference-audio/short-source";
import { referenceRecord } from "../../lib/reference-audio/source";
import { parseReferenceCatalog, REFERENCE_CATALOG_LIMITS, ReferenceUnavailable, type ReferenceCatalog } from "./catalog";
import type { ReferenceCatalogGet } from "./storage";
import { parseReferenceResolution, type ReferenceResolution } from "../../lib/reference-audio/source";
import { shortSourceRange } from "../../lib/reference-audio/short-source";

export const SHORT_MANIFEST_SCHEMA = "reference-short-manifest/v1" as const;
export const SHORT_MANIFEST_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, entries: 10000 });
/** This slice does NOT verify media bodies or expose a serving primitive.
 * Future byte adapter MUST fully hash/size-check before response AND verify:
 * native MP3 frame headers/rate/channels/64k profile, bounded ID3 tags,
 * valid Xing/LAME skip+discard metadata and exact presentation frame count.
 * Pinned metadata/recipe alone is never proof that those body checks ran.
 */
export const SHORT_BODY_VERIFICATION_REQUIRED = "mp3-64k-id3-lame-presentation-and-full-sha256/v1" as const;
declare const manifestBrand: unique symbol, entryBrand: unique symbol;
export type ShortSourceManifest = Readonly<{ [manifestBrand]: true }>;
export type ShortSourceEntry = Readonly<{ [entryBrand]: true }>;
type Entry = Readonly<{ source: ShortReferenceSource; blobKey: string; requiredBodyVerification: typeof SHORT_BODY_VERIFICATION_REQUIRED }>;
const manifests = new WeakMap<object, ReadonlyMap<string, ShortSourceEntry>>(), entries = new WeakMap<object, Entry>();
const manifestIdentities = new WeakMap<object, Readonly<{ parentSHA256: string; manifestSHA256: string }>>();
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function copyBytes(value: unknown, max: number): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new ReferenceUnavailable();
  const proto = Object.getPrototypeOf(Uint8Array.prototype);
  const size = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value));
  if (size < 1 || size > max) throw new ReferenceUnavailable();
  const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(value) as ArrayBuffer;
  const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(value));
  return new Uint8Array(new Uint8Array(buffer, offset, size));
}
function array(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > SHORT_MANIFEST_LIMITS.entries
    || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const field = Object.getOwnPropertyDescriptor(value, String(i)); if (!field || !Object.hasOwn(field, "value")) return null; result.push(field.value); }
  return result;
}
function parse(value: unknown, parents: ReferenceCatalog, parentSHA256: string): readonly ShortReferenceSource[] | null {
  const row = referenceRecord(value, ["schema", "source", "parentCatalogSHA256", "recipe", "attribution", "entries"]);
  if (!row || row.schema !== SHORT_MANIFEST_SCHEMA || row.source !== "PockettorahAudioFiles" || row.parentCatalogSHA256 !== parentSHA256 || row.recipe !== SHORT_SOURCE_RECIPE) return null;
  const attribution = referenceRecord(row.attribution, Object.keys(SHORT_SOURCE_ATTRIBUTION));
  if (!attribution || Object.entries(SHORT_SOURCE_ATTRIBUTION).some(([key, expected]) => attribution[key] !== expected)) return null;
  const raw = array(row.entries); if (!raw) return null;
  const result: ShortReferenceSource[] = [], ids = new Set<string>();
  for (const item of raw) {
    const source = parseShortReferenceSource(item); if (!source || ids.has(source.id)) return null;
    const parent = parents.assets.find(asset => asset.id === source.parent.asset);
    if (!parent || parent.sha256 !== source.parent.sha256 || parent.bytes !== source.parent.bytes
      || !parent.verses.some(verse => verse.playback.status === "ready"
        && Math.floor(verse.playback.clip.start * source.sampleRate) === source.origin.firstFrame
        && Math.ceil(verse.playback.clip.end * source.sampleRate) === source.origin.firstFrame + source.presentationFrames)) return null;
    ids.add(source.id); result.push(source);
  }
  return Object.freeze(result);
}

/** Full parent catalog bytes and both SHA pins come ONLY from trusted server
 * configuration/composition. No environment/store/URL/request fallback.
 * Construction snapshots and validates parent provenance, performs no I/O.
 */
export function createShortSourceManifestLoader(input: { sha256: string; parentCatalogSHA256: string; parentCatalogBytes: Uint8Array; get: ReferenceCatalogGet }) {
  let parents: ReferenceCatalog;
  const manifestSHA256 = input.sha256, parentSHA256 = input.parentCatalogSHA256, get = input.get;
  try {
    if (!digest(manifestSHA256) || !digest(parentSHA256) || typeof get !== "function") throw 0;
    const bytes = copyBytes(input.parentCatalogBytes, REFERENCE_CATALOG_LIMITS.bytes);
    if (sha(bytes) !== parentSHA256) throw 0;
    const parsed = parseReferenceCatalog(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!parsed) throw 0; parents = parsed;
  } catch { throw new ReferenceUnavailable(); }
  const path = `reference-audio/short-v1/manifests/${manifestSHA256}.json`;
  return async function load(signal?: AbortSignal): Promise<ShortSourceManifest> {
    const controller = new AbortController(), start = performance.now(); let progress = start, timer: ReturnType<typeof setTimeout> | undefined;
    let incoming: ReadableStream<Uint8Array> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    const live = () => { if (signal?.aborted || controller.signal.aborted || performance.now() - start >= 30000) throw new ReferenceUnavailable(); };
    const bounded = async <T>(work: Promise<T>, ms: number): Promise<T> => {
      let stopped: (() => void) | undefined; const until = Math.min(start + 30000, performance.now() + ms);
      try {
        const result = await Promise.race([work, new Promise<never>((_, reject) => {
          stopped = () => reject(new ReferenceUnavailable()); controller.signal.addEventListener("abort", stopped, { once: true });
          if (controller.signal.aborted) return stopped();
          timer = setTimeout(() => { controller.abort(); reject(new ReferenceUnavailable()); }, Math.max(1, until - performance.now()));
        })]);
        live(); if (performance.now() >= until) throw new ReferenceUnavailable(); return result;
      } finally { clearTimeout(timer); if (stopped) controller.signal.removeEventListener("abort", stopped); }
    };
    try {
      live();
      const pending = Promise.resolve().then(() => { live(); return get(path, { signal: controller.signal }); });
      void pending.then(stream => { incoming = stream; if (controller.signal.aborted) void stream.cancel().catch(() => {}); }).catch(() => {});
      const stream = await bounded(pending, 10000); reader = stream.getReader(); progress = performance.now();
      // Fixed owned storage: upstream one-byte framing cannot amplify retained
      // typed-array/array-slot overhead beyond the manifest byte budget.
      const accumulator = new Uint8Array(SHORT_MANIFEST_LIMITS.bytes); let total = 0, empty = 0; const hash = createHash("sha256");
      while (true) {
        const item = await bounded(reader.read(), Math.max(1, 5000 - (performance.now() - progress))); live();
        if (performance.now() - progress >= 5000) throw new ReferenceUnavailable();
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw new ReferenceUnavailable();
        const proto = Object.getPrototypeOf(Uint8Array.prototype), size = Number(Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(item.value));
        if (!size) { if (++empty > 64) throw new ReferenceUnavailable(); continue; }
        if (total + size > SHORT_MANIFEST_LIMITS.bytes) throw new ReferenceUnavailable();
        const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(item.value) as ArrayBuffer;
        const offset = Number(Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(item.value));
        accumulator.set(new Uint8Array(buffer, offset, size), total);
        // Hash the owned snapshot, not the caller's potentially shared bytes.
        hash.update(accumulator.subarray(total, total + size)); total += size; empty = 0; progress = performance.now();
      }
      if (!total || hash.digest("hex") !== manifestSHA256) throw new ReferenceUnavailable();
      const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(accumulator.subarray(0, total))); live();
      const sources = parse(raw, parents, parentSHA256); if (!sources) throw new ReferenceUnavailable(); live();
      const map = new Map<string, ShortSourceEntry>();
      for (const source of sources) {
        const receipt = Object.freeze({}) as ShortSourceEntry;
        entries.set(receipt, Object.freeze({ source, blobKey: source.path.slice(1), requiredBodyVerification: SHORT_BODY_VERIFICATION_REQUIRED })); map.set(source.id, receipt);
      }
      live(); const handle = Object.freeze({}) as ShortSourceManifest; manifests.set(handle, map);
      manifestIdentities.set(handle, Object.freeze({ parentSHA256, manifestSHA256 })); return handle;
    } catch { controller.abort(); throw new ReferenceUnavailable(); }
    finally {
      signal?.removeEventListener("abort", abort); clearTimeout(timer);
      if (!reader && incoming) { try { void incoming.cancel().catch(() => {}); } catch {} }
      if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    }
  };
}

/** Unknown IDs do not read media or enumerate the manifest. Forged/cloned
 * handles fail; lookup proves only configured manifest membership, not bytes.
 */
export function lookupShortSource(manifest: ShortSourceManifest, id: unknown): ShortSourceEntry | null {
  const map = manifests.get(manifest); if (!map) throw new ReferenceUnavailable();
  return typeof id === "string" && /^rs_[a-f0-9]{64}$/.test(id) ? map.get(id) ?? null : null;
}
export function readShortSourceEntry(entry: ShortSourceEntry): Entry {
  const value = entries.get(entry); if (!value) throw new ReferenceUnavailable(); return value;
}

/** Only a genuine loader can establish this identity. A sealed manifest from a
 * different valid build is not authority for either configured pin here. */
export function shortSourceManifestMatches(manifest: unknown, parentSHA256: unknown, manifestSHA256: unknown): manifest is ShortSourceManifest {
  if (!manifest || typeof manifest !== "object" || !digest(parentSHA256) || !digest(manifestSHA256)) return false;
  const identity = manifestIdentities.get(manifest);
  return !!identity && identity.parentSHA256 === parentSHA256 && identity.manifestSHA256 === manifestSHA256;
}

/** Only a unique derivative of this exact resolved parent and enclosing native
 * verse grid may be selected. Membership is metadata authority, not body proof. */
export function findShortSource(manifest: ShortSourceManifest, resolution: ReferenceResolution): ShortSourceEntry | null {
  const map = manifests.get(manifest), resolved = parseReferenceResolution(resolution);
  if (!map || !resolved) throw new ReferenceUnavailable();
  if (!resolved.source || resolved.verse.playback.status !== "ready") return null;
  const parent = resolved.source, clip = resolved.verse.playback.clip;
  let match: ShortSourceEntry | null = null;
  for (const entry of map.values()) {
    const { source } = readShortSourceEntry(entry);
    if (source.parent.asset !== parent.asset || source.parent.sha256 !== parent.sha256 || source.parent.bytes !== parent.bytes
      || source.origin.firstFrame !== Math.floor(clip.start * source.sampleRate)
      || source.origin.firstFrame + source.presentationFrames !== Math.ceil(clip.end * source.sampleRate)) continue;
    const range = shortSourceRange(source, clip);
    if (!range || range.firstFrame !== 0 || range.endFrame !== source.presentationFrames) continue;
    if (match) return null;
    match = entry;
  }
  return match;
}
