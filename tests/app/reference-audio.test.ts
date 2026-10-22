// Invented text/times only. No corpus, media or private ingest fixtures.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseReferenceVerse, REFERENCE_ATTRIBUTION, REFERENCE_AUDIO_LIMITS, REFERENCE_WORD_REASONS } from "../../src/lib/reference-audio/contract";
import { createReferenceTimeline, currentReferenceWord, referenceSeekSeconds, referenceVerseLoop, referenceWordLoop, type ReferenceTimeline } from "../../src/lib/reference-audio/timeline";

const text = "אבג דהו זחט";
const digest = (value: string) => createHash("sha256").update(value.normalize("NFC"), "utf8").digest("hex");
const binding = () => ({ ref: "Genesis 1:1", readingTextSha256: digest(text), wordCount: 3 });
function ready() {
  return {
    schema: "reference-verse/v1", ref: "Genesis 1:1", table: "torah",
    playback: { status: "ready", asset: "ra_0123456789abcdef0123456789abcdef", clip: { start: 10, end: 15 } },
    words: { status: "ready", readingTextSha256: digest(text), starts: [10.5, 12, 14] },
    attribution: { ...REFERENCE_ATTRIBUTION },
  };
}
function unavailable() {
  return { schema: "reference-verse/v1", ref: "Genesis 1:1", playback: { status: "unavailable", reason: "asset-not-approved" }, words: { status: "unavailable", reason: "no-playback" } };
}
const timeline = () => createReferenceTimeline(ready(), binding())!;

describe("closed reference wire contract", () => {
  it("consumes the real producer's distinct ready, held and unavailable shapes", async () => {
    const producer = await import(new URL("../../scripts/reference-index-contract.mjs", import.meta.url).href);
    const input = {
      recording: { table: "torah" },
      verse: { ref: "Genesis 1:1", start: 10, end: 15, words: [{ he: "אבג", start: 10.5 }, { he: "דהו", start: 12 }, { he: "זחט", start: 14 }] },
      asset: { approved: true, assetId: ready().playback.asset },
      portal: { status: "ready", words: ["אבג", "דהו", "זחט"], readingText: text },
    };
    const good = producer.buildVerseDto(input);
    expect(good).toEqual(ready());
    expect(parseReferenceVerse(good)).toEqual(good);
    expect(createReferenceTimeline(good, binding())?.starts).toEqual([10.5, 12, 14]);
    const held = producer.buildVerseDto({ ...input, verse: { ...input.verse, review: "start moved earlier to pitched sound before the aligned first word" } });
    expect(held.playback).toMatchObject({ status: "needs-review", review: "start-moved" });
    expect(parseReferenceVerse(held)).toEqual(held);
    expect(createReferenceTimeline(held, binding())).toBeNull();
    const mismatch = producer.buildVerseDto({ ...input, portal: { ...input.portal, words: ["יכל", "מנס", "עפצ"], readingText: "יכל מנס עפצ" } });
    expect(mismatch.playback).toMatchObject({ status: "needs-review", review: "text-mismatch" });
    expect(parseReferenceVerse(mismatch)).toEqual(mismatch);
    expect(createReferenceTimeline(mismatch, binding())).toBeNull();
    const noAsset = producer.buildVerseDto({ ...input, asset: { approved: false } });
    expect(noAsset).toEqual(unavailable());
    expect(parseReferenceVerse(noAsset)).toEqual(noAsset);
    expect(createReferenceTimeline(noAsset, binding())).toBeNull();
    const noWords = producer.buildVerseDto({ ...input, portal: { status: "unavailable" } });
    expect(parseReferenceVerse(noWords)).toEqual(noWords);
    expect(referenceVerseLoop(createReferenceTimeline(noWords, binding()))).toEqual({ start: 10, end: 15 });
    expect(referenceWordLoop(createReferenceTimeline(noWords, binding()), 0)).toBeNull();
  });

  it("binds actual rendered NFC text rather than an unnormalized digest or response echo", async () => {
    const producer = await import(new URL("../../scripts/reference-index-contract.mjs", import.meta.url).href);
    const markedWord = "א\u05b7\u05b0בג", renderedText = markedWord + " דהו";
    const dto = producer.buildVerseDto({
      recording: { table: "torah" },
      verse: { ref: "Genesis 1:1", start: 10, end: 15, words: [{ he: markedWord, start: 10.5 }, { he: "דהו", start: 12 }] },
      asset: { approved: true, assetId: ready().playback.asset },
      portal: { status: "ready", words: [markedWord, "דהו"], readingText: renderedText },
    });
    const actualHash = digest(renderedText);
    const rawHash = createHash("sha256").update(renderedText).digest("hex");
    expect(rawHash).not.toBe(actualHash);
    expect(dto.words.readingTextSha256).toBe(actualHash);
    const actualBinding = { ref: "Genesis 1:1", readingTextSha256: actualHash, wordCount: 2 };
    expect(currentReferenceWord(createReferenceTimeline(dto, actualBinding), 12)).toBe(1);
    expect(currentReferenceWord(createReferenceTimeline(dto, { ...actualBinding, readingTextSha256: rawHash }), 12)).toBeNull();
    // A changed rendering has its own computed digest, so stale server timings stay verse-only.
    expect(currentReferenceWord(createReferenceTimeline(dto, { ...actualBinding, readingTextSha256: digest(renderedText + " זחט"), wordCount: 3 }), 12)).toBeNull();
  });

  it("accepts each producer word reason with its correct review relationship", () => {
    for (const reason of REFERENCE_WORD_REASONS) {
      const badText = ["word-count-mismatch", "text-mismatch", "maqaf-mismatch"].includes(reason);
      const dto = { ...ready(), words: { status: "unavailable", reason }, playback: { ...ready().playback, ...(badText ? { status: "needs-review", review: "text-mismatch" } : {}) } };
      expect(parseReferenceVerse(dto), reason).toEqual(dto);
      expect(createReferenceTimeline(dto, binding()) !== null, reason).toBe(!badText);
      expect(parseReferenceVerse({ ...dto, playback: badText ? ready().playback : { ...ready().playback, status: "needs-review", review: "text-mismatch" } }), reason).toBeNull();
    }
  });

  it("requires exact keys, canonical verse, fixed attribution and opaque asset identity", () => {
    const bad = [
      { ...ready(), extra: true }, { ...ready(), schema: "other" }, { ...ready(), table: "other" },
      ...["Genesis 01:1", "Genesis 1:32", "Genesis 51:1", "Gen 1:1", "Genesis 1:1-1:2", "Genesis 1:1 ", ["Genesis 1:1"]].map(ref => ({ ...ready(), ref })),
      ...["https://example.invalid/media", "ra_" + "A".repeat(32), "ra_" + "a".repeat(31), [ready().playback.asset]].map(asset => ({ ...ready(), playback: { ...ready().playback, asset } })),
      { ...ready(), playback: { ...ready().playback, url: "https://example.invalid/" } },
      { ...ready(), playback: { ...ready().playback, clip: { ...ready().playback.clip, duration: 5 } } },
      { ...ready(), attribution: { ...REFERENCE_ATTRIBUTION, creator: "other" } },
      { ...ready(), attribution: { ...REFERENCE_ATTRIBUTION, extra: "x" } },
      { ...ready(), words: { ...ready().words, readingTextSha256: "A".repeat(64) } },
      { ...ready(), words: { ...ready().words, readingText: text } },
      { ...unavailable(), table: "torah" }, { ...unavailable(), words: { status: "unavailable", reason: "no-words" } },
    ];
    for (const value of bad) expect(parseReferenceVerse(value)).toBeNull();
    expect(parseReferenceVerse({ ...ready(), ref: "II Kings 4:1", table: "haftarah" })).not.toBeNull();
  });

  it("bounds clip/source seconds without coercion or nonfinite values", () => {
    for (const clip of [{ start: -1, end: 15 }, { start: 10, end: 10 }, { start: 10, end: 10.499 }, { start: 10, end: 191 }, { start: 14400, end: 14401 }, { start: "10", end: 15 }, { start: NaN, end: 15 }, { start: 10, end: Infinity }]) {
      expect(parseReferenceVerse({ ...ready(), playback: { ...ready().playback, clip } })).toBeNull();
    }
    expect(parseReferenceVerse({ ...ready(), playback: { ...ready().playback, clip: { start: 10, end: 10.5 } }, words: { ...ready().words, starts: [10] } })).not.toBeNull();
  });

  it("rejects unordered, empty, outside, sparse and oversized onsets", () => {
    const sparse = [10.5, 12, 14]; delete sparse[1];
    const extra = Object.assign([10.5], { other: true });
    for (const starts of [[], [10.5, 10.5], [12, 10.5], [9.999], [15], [NaN], [Infinity], [-1], ["10.5"], sparse, extra, Array.from({ length: REFERENCE_AUDIO_LIMITS.words + 1 }, (_, i) => 10 + i / 1000)]) {
      expect(parseReferenceVerse({ ...ready(), words: { ...ready().words, starts } })).toBeNull();
    }
    const starts = Array.from({ length: REFERENCE_AUDIO_LIMITS.words }, (_, i) => 10 + i / 1000);
    expect(parseReferenceVerse({ ...ready(), words: { ...ready().words, starts } })).not.toBeNull();
  });

  it("does not invoke accessors or coercion hooks in hostile input", () => {
    let calls = 0;
    const getter = () => { calls++; throw new Error("not called"); };
    const dto = ready(); Object.defineProperty(dto, "playback", { get: getter });
    const starts = [10.5]; Object.defineProperty(starts, "0", { get: getter });
    const word = ready(); Object.defineProperty(word.words, "readingTextSha256", { get: getter });
    const asset = { toString: getter };
    for (const value of [dto, word, { ...ready(), words: { ...ready().words, starts } }, { ...ready(), playback: { ...ready().playback, asset } }, Object.create(ready())]) expect(parseReferenceVerse(value)).toBeNull();
    expect(calls).toBe(0);
  });

  it("copies and deeply freezes accepted data without modifying input", () => {
    const source = ready(), before = JSON.stringify(source), parsed = parseReferenceVerse(source)!;
    const t = createReferenceTimeline(source, binding())!;
    expect(JSON.stringify(source)).toBe(before);
    expect(parsed).not.toBe(source);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.playback)).toBe(true);
    expect(Object.isFrozen(parsed.words)).toBe(true);
    expect(Object.isFrozen(t.starts)).toBe(true);
    expect(Object.isFrozen(t.clip)).toBe(true);
    source.words.starts[0] = 13; source.playback.clip.start = 0;
    expect(currentReferenceWord(t, 10.5)).toBe(0);
    expect(referenceVerseLoop(t)).toEqual({ start: 10, end: 15 });
    const frozen = ready(); Object.freeze(frozen.words.starts); Object.freeze(frozen.words); Object.freeze(frozen.playback.clip); Object.freeze(frozen.playback); Object.freeze(frozen.attribution); Object.freeze(frozen);
    expect(parseReferenceVerse(frozen)).toEqual(ready());
  });
});

describe("source-seconds reference timeline", () => {
  it("uses half-open onset intervals and a silent introduction, never clip-relative seconds", () => {
    const t = timeline();
    for (const [time, index] of [[0, null], [10, null], [10.49999, null], [10.5, 0], [11.99999, 0], [12, 1], [13.99999, 1], [14, 2], [14.99999, 2], [15, null], [16, null]] as const) expect(currentReferenceWord(t, time)).toBe(index);
    for (const value of [NaN, Infinity, -Infinity, -1, "12", null]) expect(currentReferenceWord(t, value as number)).toBeNull();
    expect(referenceVerseLoop(t)).toEqual({ start: 10, end: 15 });
    expect(referenceWordLoop(t, 0)).toEqual({ start: 10.5, end: 12 });
    expect(referenceWordLoop(t, 1)).toEqual({ start: 12, end: 14 });
    expect(referenceWordLoop(t, 2)).toEqual({ start: 14, end: 15 });
    expect(referenceSeekSeconds(t)).toBe(10);
    expect(referenceSeekSeconds(t, 2)).toBe(14);
    for (const index of [-1, 3, 1.5, NaN, Infinity, "1"]) expect(referenceWordLoop(t, index as number)).toBeNull();
  });

  it("rejects wrong ref entirely but preserves verse playback on missing/stale text bindings", () => {
    expect(createReferenceTimeline(ready(), { ...binding(), ref: "Genesis 1:2" })).toBeNull();
    for (const b of [{ ref: binding().ref }, { ...binding(), readingTextSha256: digest("other") }, { ...binding(), wordCount: 2 }, { ...binding(), wordCount: 4 }, { ...binding(), wordCount: "3" }, { ...binding(), wordCount: NaN }, { ...binding(), wordCount: 3.5 }, { ...binding(), wordCount: undefined }, { ...binding(), readingTextSha256: undefined }]) {
      const t = createReferenceTimeline(ready(), b as ReturnType<typeof binding>);
      expect(t).not.toBeNull();
      expect(referenceVerseLoop(t)).toEqual({ start: 10, end: 15 });
      expect(referenceSeekSeconds(t)).toBe(10);
      expect(currentReferenceWord(t, 12)).toBeNull();
      expect(referenceWordLoop(t, 0)).toBeNull();
      expect(referenceSeekSeconds(t, 0)).toBeNull();
    }
  });

  it("never invokes binding getters and refuses nonlocal/inherited bindings", () => {
    let calls = 0;
    const b = binding(); Object.defineProperty(b, "readingTextSha256", { get() { calls++; return digest(text); } });
    for (const value of [b, Object.create(binding()), { ...binding(), extra: true }, null, undefined, []]) expect(createReferenceTimeline(ready(), value as ReturnType<typeof binding>)).toBeNull();
    expect(calls).toBe(0);
  });

  it("does not let raw DTOs, prototype copies or a reflected constructor forge a timeline", () => {
    const valid = timeline();
    const reflected = valid.constructor as new (...args: unknown[]) => ReferenceTimeline;
    expect(() => new reflected(Symbol("validated-reference-timeline"), "Genesis 1:1", ready().playback.asset, valid.clip, [10.5])).toThrow("Reference timeline unavailable");
    for (const forged of [ready(), Object.create(Object.getPrototypeOf(valid)), { ...valid }, null, undefined, 0]) {
      expect(currentReferenceWord(forged as ReferenceTimeline, 12)).toBeNull();
      expect(referenceVerseLoop(forged as ReferenceTimeline)).toBeNull();
      expect(referenceWordLoop(forged as ReferenceTimeline, 0)).toBeNull();
      expect(referenceSeekSeconds(forged as ReferenceTimeline)).toBeNull();
    }
  });

  it("keeps the same source coordinate under different playback rates", () => {
    const t = timeline();
    // Different wall durations arrive at the same media clock position.
    for (const rate of [0.5, 0.75, 1, 1.5, 2]) {
      const elapsedWallSeconds = (12 - t.clip.start) / rate;
      const mediaCurrentTime = t.clip.start + elapsedWallSeconds * rate;
      expect(currentReferenceWord(t, mediaCurrentTime)).toBe(1);
      expect(referenceWordLoop(t, 1)).toEqual({ start: 12, end: 14 });
      expect(referenceSeekSeconds(t, 1)).toBe(12);
    }
  });

  it("has no usable timeline for zero input or review-held playback", () => {
    for (const value of [null, undefined, false, 0, "", [], {}, unavailable(), { ...ready(), playback: { ...ready().playback, status: "needs-review", review: "start-moved" } }]) {
      expect(createReferenceTimeline(value, binding())).toBeNull();
    }
    for (const value of [null, undefined, false, 0, "", [], {}]) expect(parseReferenceVerse(value)).toBeNull();
  });
});

describe("measured word ends (index v2)", () => {
  const withEnds = (ends: unknown) => { const v = ready(); return { ...v, words: { ...v.words, ends } }; };
  it("parses ends beside starts and loops each word to its measured end; v1 falls back to the next onset", () => {
    const value = withEnds([11.6, 13.5, 14.8]);
    expect(parseReferenceVerse(value)).toEqual(value);
    const t = createReferenceTimeline(value, binding())!;
    expect(t.ends).toEqual([11.6, 13.5, 14.8]);
    expect(referenceWordLoop(t, 0)).toEqual({ start: 10.5, end: 11.6 });
    expect(referenceWordLoop(t, 2)).toEqual({ start: 14, end: 14.8 });
    expect(referenceSeekSeconds(t, 1)).toBe(12);
    // Highlighting still follows onsets: the silence after a measured end stays with the word before.
    expect(currentReferenceWord(t, 11.8)).toBe(0);
    const v1 = timeline();
    expect(v1.ends).toBeNull();
    expect(referenceWordLoop(v1, 0)).toEqual({ start: 10.5, end: 12 });
    expect(referenceWordLoop(v1, 2)).toEqual({ start: 14, end: 15 });
    // An end may touch the next start and the clip end exactly.
    expect(parseReferenceVerse(withEnds([12, 14, 15]))).not.toBeNull();
  });
  it("rejects ends that are not one per word, not after their start, past the next start or the clip end", () => {
    for (const ends of [[11.6, 13.5], [11.6, 13.5, 14.8, 14.9], [10.5, 13.5, 14.8], [10.4, 13.5, 14.8], [12.01, 13.5, 14.8], [11.6, 13.5, 15.01],
      [11.6, Number.NaN, 14.8], [11.6, "13.5", 14.8], [], "11.6", null, { 0: 11.6 }]) {
      expect(parseReferenceVerse(withEnds(ends)), JSON.stringify(ends)).toBeNull();
    }
    const getter = ready(); Object.defineProperty(getter.words, "ends", { enumerable: true, get: () => [11.6, 13.5, 14.8] });
    expect(parseReferenceVerse(getter)).toBeNull();
    const extra = withEnds([11.6, 13.5, 14.8]); (extra.words as Record<string, unknown>).labels = [1];
    expect(parseReferenceVerse(extra)).toBeNull();
  });
  it("timeline ends never outlive a stale binding", () => {
    const value = withEnds([11.6, 13.5, 14.8]);
    const stale = createReferenceTimeline(value, { ...binding(), readingTextSha256: digest("other") })!;
    expect(stale.starts).toBeNull(); expect(stale.ends).toBeNull(); expect(referenceWordLoop(stale, 0)).toBeNull();
  });
  it("consumes the real producer's v2 DTO", async () => {
    const producer = await import(new URL("../../scripts/reference-index-contract.mjs", import.meta.url).href);
    const dto = producer.buildVerseDto({ recording: { table: "torah" }, asset: { approved: true, assetId: ready().playback.asset },
      verse: { ref: "Genesis 1:1", start: 10, end: 15, words: [{ he: "אבג", start: 10.48, end: 11.6, ctcStart: 10.5 }, { he: "דהו", start: 11.98, end: 13.5, ctcStart: 12 }, { he: "זחט", start: 13.98, end: 15, ctcStart: 14 }] },
      portal: { status: "ready", words: ["אבג", "דהו", "זחט"], readingText: text } });
    const parsed = parseReferenceVerse(dto);
    expect(parsed?.words).toEqual({ status: "ready", readingTextSha256: digest(text), starts: [10.48, 11.98, 13.98], ends: [11.6, 13.5, 15] });
  });
});
