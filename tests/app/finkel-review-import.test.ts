import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHash } from "node:crypto";
import { FINKEL_REVIEW_LIMITS, FinkelReviewImportError, planFinkelReviewImport } from "../../src/server/reference-review/finkel-import";
import { parseReferenceCatalog } from "../../src/server/reference-audio/catalog";
const key = "fj_" + "1".repeat(20), other = "fj_" + "2".repeat(20);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  const media = (name: string, codec: string, sha: string) => ({ path: `prepared/assets/${key}/${name}`, codec, bytes: 100, sha256: sha.repeat(64), durationSeconds: 2 });
  return { schema: "finkel-prepared-catalog/v1", sources: [{ catalogId: "JF-0001", assets: [key], representations: [{ kind: "original", sha256: "e".repeat(64) }] as { kind: string; sha256?: string }[] | undefined, sourceId: "PRIVATE_SOURCE_CANARY", originalTitle: "PRIVATE_TITLE_CANARY" }], assets: [{
    assetKey: key, kind: "torah", mode: "chant", tempo: null as string | null, verses: ["Genesis 1:1", "Genesis 1:3"], serviceParts: null as string[] | null,
    derivedFrom: { catalogId: "JF-0001", sha256: "e".repeat(64) as string | undefined, path: "PRIVATE_PATH_CANARY" },
    master: media("master.flac", "flac", "a"), playback: media("playback.mp3", "mp3", "b"),
    capabilities: { wholeClip: "ready-for-human-review", verse: "candidate-pending-review", phrase: "unavailable", word: "unavailable" }, timing: { validated: null as unknown, candidates: "PRIVATE_TIMING_CANARY" },
    review: { machineVerification: { status: "passed", reasons: "PRIVATE_REVIEW_CANARY" }, humanListening: "pending", musicalAccuracy: "pending", personalData: "PRIVATE_PERSON_CANARY" }, studentReady: false, recommendedDefault: true,
    title: "PRIVATE_TITLE_CANARY", labelHe: "PRIVATE_LABEL_CANARY", appServiceUnit: ["PRIVATE_MAPPING_CANARY"], notes: "PRIVATE_NOTES_CANARY" }] };
}
function rejected(value: unknown, code?: string) {
  try { planFinkelReviewImport(encode(value)); expect.fail("Expected closed rejection"); }
  catch (error) { expect(error).toBeInstanceOf(FinkelReviewImportError); expect((error as Error).message).toBe("Finkel review import rejected"); if (code) expect((error as FinkelReviewImportError).code).toBe(code); expect(JSON.stringify(error)).not.toContain("PRIVATE_"); }
}
test("plans declarations only with exact snapshot identity, no raw metadata or playable contract", () => {
  const input = encode(fixture()), before = input.slice(), plan = planFinkelReviewImport(input), candidate = plan.candidates[0];
  expect(input).toEqual(before); expect(plan.catalogSha256).toBe(createHash("sha256").update(input).digest("hex"));
  expect(plan).toMatchObject({ schema: "finkel-review-plan/v1", sourceCount: 1, candidateCount: 1, heldCount: 0, studentReady: false, mediaIntegrity: "unchecked" });
  expect(candidate).toMatchObject({ advisoryDefault: true, disposition: "human-review-candidate", target: { readingKind: "torah", verses: ["Genesis 1:1", "Genesis 1:3"] },
    review: { humanListening: "pending", privacy: "pending", exactText: "pending", musicalAccuracy: "pending", thirdPartyRights: "pending" }, studentReady: false, timing: { verse: "unavailable", phrase: "unavailable", word: "unavailable" } });
  expect(JSON.stringify(plan)).not.toMatch(/PRIVATE_|JF-0001|sourceId|\.mp3|\.flac|PocketTorah/);
  expect(parseReferenceCatalog(plan)).toBeNull();
  expect(Object.isFrozen(plan) && Object.isFrozen(plan.candidates) && Object.isFrozen(candidate.target) && Object.isFrozen(candidate.review) && Object.isFrozen(candidate.master)).toBe(true);
});
test("preserves all four modes and tempo without conflating inventory-only scripture", () => {
  for (const mode of ["spoken", "chant", "spoken-drill", "chant-drill"]) for (const tempo of [null, "faster", "slower"]) {
    const raw = fixture(); raw.assets[0].mode = mode; raw.assets[0].tempo = tempo;
    expect(planFinkelReviewImport(encode(raw)).candidates[0]).toMatchObject({ mode, tempo });
  }
  const raw = fixture(); raw.assets[0].kind = "megillah"; raw.assets[0].verses = ["Ruth 1:1"];
  expect(planFinkelReviewImport(encode(raw)).candidates[0]).toMatchObject({ target: { readingKind: "inventory-only", inventoryOnly: true }, advisoryDefault: false });
  raw.assets[0].kind = "prophets"; raw.assets[0].verses = ["Isaiah 1:1"];
  expect(planFinkelReviewImport(encode(raw)).candidates[0].target).toMatchObject({ readingKind: "haftarah" });
});
test("held states dominate defaults and cannot smuggle any upstream release or timing promotion", () => {
  for (const [status, wholeClip] of [["failed", "held-machine-check-failed"], ["not-run", "held-not-verified"]]) {
    const raw = fixture(), a = raw.assets[0]; a.review.machineVerification.status = status; a.capabilities.wholeClip = wholeClip; a.capabilities.verse = "unavailable"; a.recommendedDefault = false;
    expect(planFinkelReviewImport(encode(raw)).candidates[0]).toMatchObject({ disposition: "held", advisoryDefault: false, studentReady: false });
    for (const mutate of [(x: typeof a) => x.studentReady = true, (x: typeof a) => x.review.humanListening = "approved", (x: typeof a) => x.review.musicalAccuracy = "approved", (x: typeof a) => x.timing.validated = {}, (x: typeof a) => x.capabilities.word = "ready", (x: typeof a) => x.capabilities.phrase = "ready", (x: typeof a) => x.capabilities.verse = "ready"]) { const copy = structuredClone(raw); mutate(copy.assets[0]); rejected(copy, "release"); }
    a.recommendedDefault = true; rejected(raw, "machine");
  }
  const raw = fixture(); raw.assets[0].capabilities.wholeClip = "held-machine-check-failed"; rejected(raw, "machine");
});
test("even a nondefault held record is inspected", () => {
  const raw = fixture(), a = structuredClone(raw.assets[0]); a.assetKey = other; a.master.path = `prepared/assets/${other}/master.flac`; a.playback.path = `prepared/assets/${other}/playback.mp3`; a.review.machineVerification.status = "failed"; a.capabilities.wholeClip = "held-machine-check-failed"; a.capabilities.verse = "unavailable"; a.recommendedDefault = false; a.studentReady = true;
  raw.assets.push(a); raw.sources[0].assets.push(other); rejected(raw, "release");
});
test("provisional allowlist remains unresolved; unknown symbols and app mapping prose never escape", () => {
  for (const kind of ["service-part", "trope-instruction"]) {
    const raw = fixture(); Object.assign(raw.assets[0], { kind, verses: [], serviceParts: [kind === "service-part" ? "kiddush" : "trope-anthem"] });
    expect(planFinkelReviewImport(encode(raw)).candidates[0]).toMatchObject({ target: { kind: "provisional", mapping: "unresolved", inventoryOnly: true }, advisoryDefault: false });
    raw.assets[0].serviceParts = ["PRIVATE_UNKNOWN_CANARY"];
    const output = planFinkelReviewImport(encode(raw)); expect(output.candidates[0].target).toEqual({ kind: "unresolved", reason: "unknown-provisional-symbol", inventoryOnly: true }); expect(JSON.stringify(output)).not.toContain("PRIVATE_");
  }
});
test("duplicate and malformed IDs, dangling declarations and cross-bound sources are denied", () => {
  const raw = fixture(); raw.sources.push(structuredClone(raw.sources[0])); rejected(raw, "identity");
  const duplicate = fixture(); duplicate.assets.push(structuredClone(duplicate.assets[0])); rejected(duplicate, "identity");
  const cross = fixture(); cross.sources.push({ ...cross.sources[0], catalogId: "JF-0002", assets: [] }); cross.assets[0].derivedFrom.catalogId = "JF-0002"; rejected(cross, "binding");
  const dangling = fixture(); dangling.sources[0].assets.push(other); rejected(dangling, "binding");
  const unknown = fixture(); unknown.assets[0].derivedFrom.catalogId = "JF-9999"; rejected(unknown, "binding");
  const malformed = fixture(); malformed.sources[0].catalogId = "PRIVATE_ID_CANARY"; rejected(malformed, "identity");
});
test("strict media declarations deny paths, URLs, cross-assets, digests, sizes and invalid durations", () => {
  for (const change of [{ path: "https://private.invalid/audio" }, { path: `/prepared/assets/${key}/master.flac` }, { path: `prepared/assets/${key}/../master.flac` }, { path: `prepared/assets/${other}/master.flac` }, { sha256: "A".repeat(64) }, { sha256: "x" }, { bytes: 0 }, { bytes: 1.5 }, { bytes: FINKEL_REVIEW_LIMITS.mediaBytes + 1 }, { durationSeconds: null }, { durationSeconds: -1 }, { durationSeconds: 0 }, { durationSeconds: FINKEL_REVIEW_LIMITS.seconds + 1 }, { codec: "wav" }]) {
    const raw = fixture(); Object.assign(raw.assets[0].master, change); rejected(raw, "media");
  }
});
test("scripture references must be canonical, bounded, ordered within one matching book", () => {
  for (const verses of [["Genesis 01:1"], ["Genesis 1:32"], ["Genesis 51:1"], ["Genesis 1:1", "Genesis 1:1"], ["Genesis 1:2", "Genesis 1:1"], ["Genesis 1:1", "Exodus 1:1"], ["Ruth 1:1"], ["PRIVATE_REF_CANARY"], []]) { const raw = fixture(); raw.assets[0].verses = verses; rejected(raw, "target"); }
});
test("changing either media hash, target, mode, tempo or snapshot invalidates bound identity", () => {
  const initial = planFinkelReviewImport(encode(fixture())).candidates[0];
  for (const mutate of [(x: ReturnType<typeof fixture>) => x.assets[0].master.sha256 = "c".repeat(64), (x: ReturnType<typeof fixture>) => x.assets[0].playback.sha256 = "d".repeat(64), (x: ReturnType<typeof fixture>) => x.assets[0].verses = ["Genesis 1:2"], (x: ReturnType<typeof fixture>) => x.assets[0].mode = "spoken", (x: ReturnType<typeof fixture>) => x.assets[0].tempo = "slower", (x: ReturnType<typeof fixture>) => x.assets[0].title = "DIFFERENT_PRIVATE_CANARY"]) { const raw = fixture(); mutate(raw); expect(planFinkelReviewImport(encode(raw)).candidates[0].identitySha256).not.toBe(initial.identitySha256); }
  expect(planFinkelReviewImport(encode(fixture())).candidates[0].identitySha256).toBe(initial.identitySha256);
});
test("byte, UTF8, JSON, schema and structural bounds fail with fixed errors only", () => {
  for (const bytes of [new Uint8Array(), new Uint8Array(FINKEL_REVIEW_LIMITS.bytes + 1), new Uint8Array([255]), new TextEncoder().encode("{")]) expect(() => planFinkelReviewImport(bytes)).toThrow(FinkelReviewImportError);
  rejected({ ...fixture(), schema: "reference-catalog/v1" }, "schema");
  rejected({ ...fixture(), sources: Array.from({ length: FINKEL_REVIEW_LIMITS.sources + 1 }, () => ({})) }, "identity");
  rejected({ ...fixture(), assets: [] }, "identity");
  const odd = fixture(); Object.assign(odd.assets[0], { mode: { toString: null } }); rejected(odd, "target");
});

test("referenced original and derived source SHA declarations must agree; supporting sources need no original", () => {
  const supported = fixture(); supported.sources.push({ ...supported.sources[0], catalogId: "JF-0002", assets: [], representations: undefined });
  expect(planFinkelReviewImport(encode(supported)).sourceCount).toBe(2);
  for (const representations of [undefined, [], [{ kind: "nativeDoc", sha256: "e".repeat(64) }], [{ kind: "original" }], [{ kind: "original", sha256: "E".repeat(64) }], [{ kind: "original", sha256: "e".repeat(64) }, { kind: "original", sha256: "e".repeat(64) }]]) { const raw = fixture(); raw.sources[0].representations = representations; rejected(raw, "binding"); }
  for (const sha256 of [undefined, "e".repeat(63), "E".repeat(64), "d".repeat(64)]) { const raw = fixture(); raw.assets[0].derivedFrom.sha256 = sha256; rejected(raw, "binding"); }
  const contradictory = fixture(); contradictory.sources[0].representations = [{ kind: "original", sha256: "c".repeat(64) }]; contradictory.assets[0].derivedFrom.sha256 = "d".repeat(64); rejected(contradictory, "binding");
});
