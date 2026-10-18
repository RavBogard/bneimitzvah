import { SHORT_SOURCE_ATTRIBUTION } from "./short-source";

/** Fixed public credits only; never accept caller metadata or file paths. */
export const SHORT_SOURCE_FFMPEG_TAGS = Object.freeze({
  title: SHORT_SOURCE_ATTRIBUTION.title,
  artist: SHORT_SOURCE_ATTRIBUTION.creator,
  copyright: `${SHORT_SOURCE_ATTRIBUTION.license} ${SHORT_SOURCE_ATTRIBUTION.licenseUrl}`,
  comment: SHORT_SOURCE_ATTRIBUTION.changes,
  encoded_by: SHORT_SOURCE_ATTRIBUTION.version,
  source: "https://archive.org/details/PockettorahAudioFiles",
});
export function shortSourceFFmpegMetadataArgs(): string[] {
  return Object.entries(SHORT_SOURCE_FFMPEG_TAGS).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);
}
