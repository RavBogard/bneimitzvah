import "server-only";
import { createHash } from "node:crypto";
import { FINKEL_LIMITS, finkelDigest, finkelOrdinal, finkelVerse, parseFinkelClip, type FinkelClip } from "../../lib/reference-audio/finkel";

/** Private, content-addressed manifest of the Finkel clips that may play.
 * Built off-repo by scripts/finkel-reference-build.mjs from the prepared
 * package: machine-verified, plain chant/spoken scripture clips only. It holds
 * canonical verse refs, hashes, sizes and durations, never titles, labels,
 * source IDs, provenance, text or timings. */
export const FINKEL_MANIFEST_SCHEMA = "finkel-reference-manifest/v1" as const;
export const FINKEL_MANIFEST_BYTES = 1024 * 1024;
export type FinkelManifest = Readonly<{ schema: typeof FINKEL_MANIFEST_SCHEMA; sha256: string; clips: readonly FinkelClip[] }>;
export class FinkelUnavailable extends Error { constructor() { super("Finkel reference unavailable"); this.name = "FinkelUnavailable"; } }

/** Media and manifest live beside the private review objects, content-addressed
 * by their own SHA-256. The existing reviewed private getter allows only these. */
export const finkelManifestKey = (sha256: string) => `reference-review/finkel/v1/manifests/${sha256}.json`;
export const finkelAudioKey = (sha256: string) => `reference-review/finkel/v1/audio/${sha256}.mp3`;

export function parseFinkelManifest(bytes: Uint8Array, expectedSha256: string): FinkelManifest {
  try {
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > FINKEL_MANIFEST_BYTES || !finkelDigest(expectedSha256)
      || createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw 0;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw 0;
    const keys = Object.keys(value);
    if (keys.length !== 2 || !keys.includes("schema") || !keys.includes("clips")) throw 0;
    const row = value as { schema: unknown; clips: unknown };
    if (row.schema !== FINKEL_MANIFEST_SCHEMA || !Array.isArray(row.clips) || !row.clips.length || row.clips.length > FINKEL_LIMITS.clips) throw 0;
    const clips: FinkelClip[] = [], assets = new Set<string>(), hashes = new Set<string>();
    for (const raw of row.clips) {
      const clip = parseFinkelClip(raw); if (!clip || assets.has(clip.asset) || hashes.has(clip.sha256)) throw 0;
      assets.add(clip.asset); hashes.add(clip.sha256); clips.push(clip);
    }
    return Object.freeze({ schema: FINKEL_MANIFEST_SCHEMA, sha256: expectedSha256, clips: Object.freeze(clips) });
  } catch { throw new FinkelUnavailable(); }
}

/** Clips that share at least one verse with the inclusive [from, to] range of
 * one book, in manifest order. Never guesses a clip for a missing verse. */
export function findFinkelClips(manifest: FinkelManifest, from: string, to: string): readonly FinkelClip[] {
  const a = finkelVerse(from), b = finkelVerse(to);
  if (!a || !b || a.book !== b.book) throw new FinkelUnavailable();
  const low = finkelOrdinal(a), high = finkelOrdinal(b); if (high < low) throw new FinkelUnavailable();
  return Object.freeze(manifest.clips.filter(clip => clip.verses.some(ref => {
    const parsed = finkelVerse(ref)!; if (parsed.book !== a.book) return false;
    const ordinal = finkelOrdinal(parsed); return ordinal >= low && ordinal <= high;
  })));
}
export const findFinkelMedia = (manifest: FinkelManifest, sha256: string) => manifest.clips.find(clip => clip.sha256 === sha256) ?? null;
