import { describe, expect, it } from "vitest";
import { SHERMET_PILOT_RECORDINGS } from "../../src/server/shermet-audio/pilot-metadata";
import { getShermetTiming } from "../../src/server/shermet-audio/timing-catalog";

describe("published generated timing shards", () => {
  it("lazily resolves a real published source binding and refuses a changed digest", async () => {
    let found = false;
    for (const source of SHERMET_PILOT_RECORDINGS) {
      const timing = await getShermetTiming(source.ref, source.sha256);
      if (!timing) continue;
      found = true;
      expect(timing.ref).toBe(source.ref); expect(timing.kind).toBe(source.kind);
      expect(timing.audioSha256).toBe(source.sha256);
      expect(timing.words).toHaveLength(timing.wordCount);
      expect(await getShermetTiming(source.ref, "0".repeat(64))).toBeNull();
      break;
    }
    expect(found).toBe(true);
    expect(await getShermetTiming("Unpublished 1:1", "0".repeat(64))).toBeNull();
  });
});
