import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseShermetTiming, shermetTextMatches, type ShermetTiming } from "../../src/lib/reference-audio/shermet-timing";
import { createShermetTimedAudio } from "../../src/lib/reference-audio/shermet-timed-audio";
import { projectStudyVerse } from "../../src/lib/hebrew/study-tokens";
import { createPhraseAudio } from "../../src/lib/learn/phrase-audio";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const hebrew = { text: "אָב אָב", readingText: "אָב אָב", segments: [{ kind: "text" as const, text: "אָב אָב" }], paragraphAfter: null };
const projection = projectStudyVerse("Exodus 35:1", hebrew);
if (projection.status !== "ready") throw new Error("Synthetic projection failed");
const row: ShermetTiming = { version: 1, status: "ready", kind: "torah", ref: "Exodus 35:1", audioSha256: sha("abc"), readingTextSha256: sha(projection.projection.readingText.normalize("NFC")), wordCount: 2, duration: 1, words: [{ start: 0.1, end: 0.3 }, { start: 0.5, end: 0.9 }] };
it("requires canonical ref, exact text and audio digests, complete ordered nonoverlapping word boundaries", () => {
  expect(parseShermetTiming(row)).toEqual(row);
  for (const value of [{ ...row, status: "held" }, { ...row, ref: "Exodus 35:1-2" }, { ...row, audioSha256: "bad" }, { ...row, wordCount: 3 }, { ...row, words: [{ start: 0.1, end: 0.7 }, { start: 0.5, end: 0.9 }] }, { ...row, duration: 0.8 }, { ...row, words: [{ start: -1, end: 0.3 }, row.words[1]] }]) expect(parseShermetTiming(value)).toBeNull();
  expect(shermetTextMatches(row, { ref: row.ref, readingTextSha256: row.readingTextSha256, wordCount: 2 })).toBe(true);
  expect(shermetTextMatches(row, { ref: row.ref, readingTextSha256: sha("changed"), wordCount: 2 })).toBe(false);
});
it("cuts the chosen source-specific words and preserves their media-clock highlights", async () => {
  const calls: string[] = [];
  const api = createShermetTimedAudio({
    fetch: async url => { calls.push(String(url)); return String(url).includes("/timing?") ? Response.json({ timing: row }) : new Response("abc"); },
    digest: async bytes => createHash("sha256").update(bytes).digest("hex"),
    decode: async () => ({ sampleRate: 8000, length: 8000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(8000).fill(0.2) }),
  });
  const clip = await api.clip(row.ref, hebrew, 1, 1, new AbortController().signal);
  expect(clip?.source).toBe("shermet"); expect(clip?.frames).toBe(3200); expect(clip?.words).toEqual([{ word: 1, start: 0, end: 0.4 }]);
  expect(clip?.blob.type).toBe("audio/wav");
  const bytes = new DataView(await clip!.blob.arrayBuffer()); expect(bytes.getUint32(24, true)).toBe(8000); expect(bytes.byteLength).toBe(44 + 3200 * 2);
  expect(calls.filter(url => !url.includes("timing"))).toHaveLength(1);
});
it("holds changed text before requesting audio and rejects audio hash or decode duration mismatches", async () => {
  let audioCalls = 0;
  const build = (badAudio: boolean, badDuration: boolean) => createShermetTimedAudio({
    fetch: async url => String(url).includes("/timing?") ? Response.json({ timing: row }) : (audioCalls++, new Response(badAudio ? "wrong" : "abc")),
    digest: async bytes => createHash("sha256").update(bytes).digest("hex"),
    decode: async () => ({ sampleRate: 8000, length: 8000, duration: badDuration ? 2 : 1, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }),
  });
  expect(await build(false, false).clip(row.ref, { ...hebrew, readingText: "אָב" }, 0, 0, new AbortController().signal)).toBeNull(); expect(audioCalls).toBe(0);
  await expect(build(true, false).clip(row.ref, hebrew, 0, 0, new AbortController().signal)).rejects.toThrow();
  await expect(build(false, true).clip(row.ref, hebrew, 0, 0, new AbortController().signal)).rejects.toThrow();
});
it("Learn prefers source-specific Shermet phrase cuts without requiring PocketTorah metadata", async () => {
  const audio = createPhraseAudio({ preferShermet: true,
    load: async () => ({ ref: row.ref, kind: "torah", hebrew, short: null }),
    fetch: async url => String(url).includes("/timing?") ? Response.json({ timing: row }) : new Response("abc"),
    digest: async bytes => createHash("sha256").update(bytes).digest("hex"),
    decodeShermet: async () => ({ sampleRate: 8000, length: 8000, duration: 1, numberOfChannels: 1, getChannelData: () => new Float32Array(8000) }),
  });
  const signal = new AbortController().signal;
  expect(await audio.wordReady(row.ref, "torah", signal)).toBe(true);
  const clip = await audio.phraseClip({ ref: row.ref, kind: "torah", words: [0, 1] }, signal);
  expect(clip.source).toBe("shermet"); expect(clip.words.map(word => word.word)).toEqual([0, 1]);
  audio.clear();
});
