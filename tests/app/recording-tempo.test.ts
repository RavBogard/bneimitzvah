import { expect, it } from "vitest";
import { applyRecordingTempo, recordingPlaybackRate } from "../../src/lib/reference-audio/recording-tempo";
it("uses a source-specific baseline without changing other audio or relative values", () => {
  for (const relative of [0.5, 0.75, 1, 1.25]) {
    expect(recordingPlaybackRate("shermet", relative)).toBe(relative * 1.25);
    for (const source of [undefined, "pockettorah", "user", "synthetic"]) expect(recordingPlaybackRate(source, relative)).toBe(relative);
  }
  const media = { playbackRate: 1, defaultPlaybackRate: 1, preservesPitch: false };
  applyRecordingTempo(media, "shermet", 0.75);
  expect(media).toEqual({ playbackRate: 0.9375, defaultPlaybackRate: 0.9375, preservesPitch: true });
  expect(() => recordingPlaybackRate("shermet", 9)).toThrow();
});
it("holds original pitch and tempo when pitch preservation is unavailable", () => {
  const media = { playbackRate: 1, preservesPitch: undefined };
  applyRecordingTempo(media as unknown as HTMLMediaElement, "shermet", 1.25);
  expect(media.playbackRate).toBe(1);
});

it.each(["webkitPreservesPitch", "mozPreservesPitch"])("uses the %s pitch capability on legacy engines", key => {
  const media = { playbackRate: 1, [key]: false };
  expect(applyRecordingTempo(media as unknown as HTMLMediaElement, "shermet", 0.75)).toBe(0.9375);
  expect(media[key]).toBe(true);
});
