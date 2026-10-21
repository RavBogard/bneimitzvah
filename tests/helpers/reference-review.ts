import { randomUUID } from "node:crypto";
import { planFinkelReviewImport } from "../../src/server/reference-review/finkel-import";
import { buildReviewManifest, reviewHash } from "../../src/server/reference-review/batch-contract";
import { reviewAudioPath, reviewManifestPath } from "../../src/server/reference-review/batch-storage";

/** Invented metadata, Hebrew letters and opaque bytes; never real media/text. */
export function syntheticReferenceReview(mediaOverride?: Uint8Array) {
  const media = mediaOverride?.slice() ?? new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0, 0, 0, 255, 251, 144, 0]), playbackSha256 = reviewHash(media);
  const assetKey = "fj_" + "1".repeat(20), original = "e".repeat(64);
  const input = { schema: "finkel-prepared-catalog/v1", sources: [{ catalogId: "JF-0001", assets: [assetKey], representations: [{ kind: "original", sha256: original }] }], assets: [{
    assetKey, kind: "torah", mode: "chant", tempo: null, verses: ["Genesis 1:1"], serviceParts: null,
    derivedFrom: { catalogId: "JF-0001", sha256: original },
    master: { path: `prepared/assets/${assetKey}/master.flac`, codec: "flac", bytes: 100, sha256: "a".repeat(64), durationSeconds: 2 },
    playback: { path: `prepared/assets/${assetKey}/playback.mp3`, codec: "mp3", bytes: media.length, sha256: playbackSha256, durationSeconds: 2 },
    capabilities: { wholeClip: "ready-for-human-review", verse: "candidate-pending-review", phrase: "unavailable", word: "unavailable" }, timing: { validated: null },
    review: { machineVerification: { status: "passed" }, humanListening: "pending", musicalAccuracy: "pending" }, studentReady: false, recommendedDefault: false,
  }] };
  const plan = planFinkelReviewImport(new TextEncoder().encode(JSON.stringify(input)));
  const prepared = buildReviewManifest(plan, [{ assetKey, text: [{ ref: "Genesis 1:1", readingText: "א" }] }]);
  const objects = new Map<string, Uint8Array>([[reviewManifestPath(prepared.sha256), prepared.bytes], [reviewAudioPath(playbackSha256), media]]);
  const get = async (path: string) => { const bytes = objects.get(path); if (!bytes) throw new Error("Synthetic object unavailable"); return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }); };
  const batchId = randomUUID();
  const checks = { privacy: "pass", listening: "pass", exactText: "pass", musicalAccuracy: "pass", rights: "pass" } as const;
  const decision = () => ({ requestId: randomUUID(), generation: 1, manifestSha256: prepared.sha256, expectedRevision: 0, checks: { ...checks } });
  return { input, plan, prepared, media, assetKey, batchId, objects, get, decision, checks };
}
