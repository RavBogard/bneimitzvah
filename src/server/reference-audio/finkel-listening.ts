import "server-only";
import { finkelMediaPath, type FinkelClip } from "../../lib/reference-audio/finkel";
import { FinkelUnavailable, type FinkelManifest } from "./finkel-manifest";

/** What Daniel's listening review plays for one Finkel item: the same clip a
 * student would get for that verse (the preferred take, chant before words,
 * then the shortest passage), its manifest pin and its authorized media path.
 * Shaped for the listening review's source hook ({ id, pin, resolve }); it is
 * not PocketTorah's short-v1 wire format, which only describes PocketTorah's
 * public per-verse cuts. The review service does the admin authorization. */
export const FINKEL_LISTENING_SCHEMA = "finkel-listening/v1" as const;
/** `id` binds a verdict to the exact bytes (fj_ plus the clip SHA-256), so a re-cut never inherits one. */
export type FinkelListeningResolution = Readonly<{ schema: typeof FINKEL_LISTENING_SCHEMA; source: "finkel"; pin: string; id: string; clip: FinkelClip; media: string }>;

export function pickFinkelClip(manifest: FinkelManifest, ref: string, kind: "torah" | "haftarah"): FinkelClip | null {
  const found = manifest.clips.filter(clip => clip.kind === kind && clip.verses.includes(ref));
  found.sort((a, b) => Number(b.preferred) - Number(a.preferred) || (a.mode === b.mode ? 0 : a.mode === "chant" ? -1 : 1)
    || a.verses.length - b.verses.length || (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));
  return found[0] ?? null;
}

export function createFinkelListeningSource(input: { manifestSha256?: string; loadManifest(signal?: AbortSignal): Promise<FinkelManifest> }) {
  const pin = input.manifestSha256 && /^[a-f0-9]{64}$/.test(input.manifestSha256) ? input.manifestSha256 : null;
  return Object.freeze({
    id: "finkel" as const,
    /** The manifest SHA-256 identifies exactly which audio is served; null while unconfigured. */
    pin: () => pin,
    async resolve(verse: Readonly<{ ref: string }>, kind: "torah" | "haftarah", signal: AbortSignal): Promise<FinkelListeningResolution | null> {
      if (!pin || signal.aborted) throw new FinkelUnavailable();
      const manifest = await input.loadManifest(signal);
      if (signal.aborted || manifest.sha256 !== pin) throw new FinkelUnavailable();
      const clip = pickFinkelClip(manifest, verse.ref, kind);
      return clip ? Object.freeze({ schema: FINKEL_LISTENING_SCHEMA, source: "finkel" as const, pin, id: `fj_${clip.sha256}`, clip, media: finkelMediaPath(clip.sha256) }) : null;
    },
  });
}
export type FinkelListeningSource = ReturnType<typeof createFinkelListeningSource>;
