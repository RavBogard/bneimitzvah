import "server-only";
import { HUMAN_TRACK_DIGEST, humanTrackById, humanVoiceAvailable, type HumanTrack } from "../../lib/reference-audio/human-tracks";
import { cantorRecordingsEnabled, isCrcEnvironment } from "../../lib/site/identity";
import { createHumanTrackMedia, publishedKaraiteMedia } from "./media";

async function privateFinkelMedia(track: HumanTrack, { range, signal }: { range: string | null; signal: AbortSignal }) {
  const storeId = process.env.BLOB_STORE_ID;
  if (!track.sha256 || !HUMAN_TRACK_DIGEST.test(track.sha256) || !storeId || !/^store_[A-Za-z0-9]{8,64}$/.test(storeId)
    || process.env.VERCEL_BLOB_API_URL !== undefined || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL !== undefined) return null;
  const { getContext } = await import("@vercel/oidc");
  const { get } = await import("@vercel/blob");
  const token = getContext().headers?.["x-vercel-oidc-token"];
  if (typeof token !== "string" || !token.length || token.length > 16384 || /[\s\x00-\x1f\x7f]/.test(token)) return null;
  const path = "reference-review/finkel/v1/audio/" + track.sha256 + ".mp3";
  const result = await get(path, { access: "private", storeId, oidcToken: token, useCache: false, abortSignal: signal, headers: range ? { Range: range } : undefined });
  if (!result) return null;
  if (result.statusCode !== 200 || result.blob.pathname !== path) {
    if (result.stream) void result.stream.cancel().catch(() => {});
    return null;
  }
  return { body: result.stream, headers: result.headers };
}

/** A track this place may serve, read from the environment on each request: Karaite tracks follow the cantor-recordings switch, Finkel's CRC identity. */
export function runtimeHumanTrack(id: string, env: Readonly<Record<string, string | undefined>> = process.env) {
  const track = humanTrackById(id);
  return track && humanVoiceAvailable(track.voice, { crc: isCrcEnvironment(env), cantorRecordings: cantorRecordingsEnabled(env) }) ? track : undefined;
}

export const humanTrackMedia = createHumanTrackMedia({
  enabled: true,
  track: id => runtimeHumanTrack(id),
  upstream: (track, options) => track.voice === "rotem-cohen" ? publishedKaraiteMedia(track, options) : privateFinkelMedia(track, options),
});
