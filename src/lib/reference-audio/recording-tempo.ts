/** Displayed rates are relative to the teaching baseline of the actual source.
 * Never scale word boundaries: highlights always read the native media clock. */
export const RELATIVE_RECORDING_SPEEDS = [0.5, 0.75, 1, 1.25] as const;
export const SHERMET_BASE_TEMPO = 1.25;
export const validRecordingSpeed = (value: number) => (RELATIVE_RECORDING_SPEEDS as readonly number[]).includes(value);
export function recordingPlaybackRate(source: string | undefined, relative = 1) {
  if (!validRecordingSpeed(relative)) throw new Error("Unsupported recording speed");
  return relative * (source === "shermet" ? SHERMET_BASE_TEMPO : 1);
}
type LegacyPitch = { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
export function recordingPitchSupported(media: LegacyPitch & { preservesPitch?: boolean }) {
  return [media.preservesPitch, media.webkitPreservesPitch, media.mozPreservesPitch].some(value => typeof value === "boolean");
}
type Media = LegacyPitch & Pick<HTMLMediaElement, "playbackRate" | "preservesPitch"> & Partial<Pick<HTMLMediaElement, "defaultPlaybackRate">>;
/** If pitch preservation is unsupported, keep original pitch at original speed.
 * Callers expose their existing unsupported-speed message in that case. */
export function applyRecordingTempo(media: Media, source: string | undefined, relative = 1) {
  const supported = recordingPitchSupported(media);
  const rate = source === "shermet" && !supported ? 1 : recordingPlaybackRate(source, relative);
  if (typeof media.preservesPitch === "boolean") media.preservesPitch = true;
  if (typeof media.webkitPreservesPitch === "boolean") media.webkitPreservesPitch = true;
  if (typeof media.mozPreservesPitch === "boolean") media.mozPreservesPitch = true;
  if ("defaultPlaybackRate" in media && media.defaultPlaybackRate !== rate) media.defaultPlaybackRate = rate;
  if (media.playbackRate !== rate) media.playbackRate = rate;
  return rate;
}
