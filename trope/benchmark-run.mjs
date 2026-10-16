// Execution-result records around the private benchmark target pack (chant-benchmark-run/v1) and
// the opaque blind-listening label map (chant-listening-labels/v1 + chant-listening-key/v1).
// Pure: callers measure and pass values in; nothing here reads clocks, files or GPUs.
//
// A run record binds immutable input/output/config/model hashes to every attempt, failed ones
// included, with wall time, peak memory and a sanitized error code. Seeds are recorded honestly:
// the existing SoulX SVS/SVC wrappers expose no seed control, so they must say "unsupported".
import { canonicalJson, sha256 } from "./benchmark-pack.mjs";

export const RUN_SCHEMA = "chant-benchmark-run/v1";
export const LANES = Object.freeze(["A", "B-human", "B-TTS", "C-audit"]);
export const STAGES = Object.freeze(["retime", "dsp-baseline", "svs", "svc", "tts", "review-copy"]);
export const ROLES = Object.freeze(["target-pack-manifest", "identity-map", "speech-plan", "alignment", "original-speech", "retimed-speech",
  "retimed-speech-slice", "target-f0", "target-f0-slice", "f0-voicing", "retime-map", "prompt-audio", "prompt-metadata", "dsp-pitch-baseline",
  "neural-output", "review-copy", "stage-manifest"]);
const MEMORY_SOURCES = new Set(["node-maxrss", "torch-cuda-max-allocated", "nvidia-smi-sampled", "unavailable"]);
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/, HASH = /^[a-f0-9]{64}$/, CODE = /^[a-z][a-z0-9-]{0,47}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export class RunRecordError extends Error {
  constructor(code) { super(`Benchmark run record rejected (${code}); private details withheld`); this.name = "RunRecordError"; this.code = code; }
}
const fail = code => { throw new RunRecordError(code); };
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) fail("schema");
}
const id = v => { if (typeof v !== "string" || !ID.test(v)) fail("identifier"); };
const hash = v => { if (typeof v !== "string" || !HASH.test(v)) fail("hash"); };
const nonNegative = v => v === null || (Number.isFinite(v) && v >= 0);
function files(list, max) {
  if (!Array.isArray(list) || list.length > max) fail("schema");
  const seen = new Set();
  for (const f of list) {
    object(f, ["role", "sha256", "bytes"]);
    if (!ROLES.includes(f.role) || !Number.isSafeInteger(f.bytes) || f.bytes < 0) fail("schema"); hash(f.sha256);
    const key = `${f.role}:${f.sha256}`; if (seen.has(key)) fail("duplicate-file"); seen.add(key);
  }
}

/**
 * model: null for a stage without a neural model (retime, dsp-baseline); otherwise
 * { sourceRevision, checkpointSha256, vocoderSha256|null, licenseRecordId, weightsRecordId }.
 * seed: { supported: false, value: null } unless the wrapper genuinely exposes one.
 */
export function buildRunRecord(run) {
  object(run, ["runId", "lane", "stage", "condition", "benchmarkId", "packManifestSha256", "passageId", "inputs", "outputs", "config", "model", "seed", "host", "attempts"]);
  id(run.runId); id(run.condition); id(run.benchmarkId); id(run.passageId); hash(run.packManifestSha256);
  if (!LANES.includes(run.lane) || !STAGES.includes(run.stage)) fail("lane");
  if (run.lane === "B-human" && run.stage === "tts" || run.lane === "B-TTS" && run.stage === "retime" || run.lane === "A" && !["svs", "review-copy"].includes(run.stage)) fail("lane");
  files(run.inputs, 64); files(run.outputs, 256);
  if (!run.inputs.length) fail("schema");
  if (!run.config || typeof run.config !== "object" || Array.isArray(run.config) || Buffer.byteLength(canonicalJson(run.config)) > 65536) fail("schema");
  const neural = ["svs", "svc", "tts"].includes(run.stage);
  if (neural) {
    object(run.model, ["sourceRevision", "checkpointSha256", "vocoderSha256", "licenseRecordId", "weightsRecordId"]);
    if (!/^[a-f0-9]{40}$/.test(run.model.sourceRevision)) fail("model"); hash(run.model.checkpointSha256);
    if (run.model.vocoderSha256 !== null) hash(run.model.vocoderSha256); id(run.model.licenseRecordId); id(run.model.weightsRecordId);
  } else if (run.model !== null) fail("model");
  object(run.seed, ["supported", "value"]);
  // No existing SVS/SVC/TTS wrapper exposes a verified seed; claiming one is refused until one does.
  if (run.seed.supported !== false || run.seed.value !== null) fail("seed");
  object(run.host, ["platform", "arch", "runtime", "gpu", "gpuMemoryMiB"]);
  for (const key of ["platform", "arch", "runtime"]) if (typeof run.host[key] !== "string" || !/^[\w .()+-]{1,80}$/.test(run.host[key])) fail("host");
  if (run.host.gpu !== null && (typeof run.host.gpu !== "string" || !/^[\w .()+-]{1,80}$/.test(run.host.gpu))) fail("host");
  if (!nonNegative(run.host.gpuMemoryMiB)) fail("host");
  if (!Array.isArray(run.attempts) || !run.attempts.length || run.attempts.length > 50) fail("attempts");
  run.attempts.forEach((a, i) => {
    object(a, ["attempt", "status", "startedAt", "wallMs", "peakMemory", "errorCode"]);
    if (a.attempt !== i + 1 || !["succeeded", "failed", "aborted"].includes(a.status) || typeof a.startedAt !== "string" || !ISO.test(a.startedAt)
      || !Number.isSafeInteger(a.wallMs) || a.wallMs < 0) fail("attempts");
    if (a.status === "succeeded" ? a.errorCode !== null : typeof a.errorCode !== "string" || !CODE.test(a.errorCode)) fail("attempts");
    if (a.status === "succeeded" && i !== run.attempts.length - 1) fail("attempts");
    object(a.peakMemory, ["hostRssMiB", "gpuAllocatedMiB", "gpuReservedMiB", "source"]);
    if (!["hostRssMiB", "gpuAllocatedMiB", "gpuReservedMiB"].every(k => nonNegative(a.peakMemory[k])) || !MEMORY_SOURCES.has(a.peakMemory.source)) fail("attempts");
  });
  const succeeded = run.attempts.at(-1).status === "succeeded";
  if (!succeeded && run.outputs.length) fail("outputs-without-success");
  const record = { schema: RUN_SCHEMA, releaseStatus: "private-unreleased", ...run, configSha256: sha256(canonicalJson(run.config)),
    outcome: succeeded ? "succeeded" : "failed", retries: run.attempts.length - 1,
    seedNote: "seed control not exposed by this wrapper; repeat renders need not be identical" };
  const bytes = Buffer.from(canonicalJson(record), "utf8");
  return Object.freeze({ record, bytes, sha256: sha256(bytes) });
}

const BASE32 = "abcdefghijkmnpqrstuvwxyz23456789";
/**
 * Opaque labels for blind review. The reviewer receives only `labels` (label -> review-copy hash);
 * `key` (label -> run, lane, passage, condition) stays separate. Labels come from the supplied
 * cryptographic randomBytes(n) and never from hashes, lanes or order.
 */
export function buildListeningKey(clips, randomBytes) {
  if (!Array.isArray(clips) || !clips.length || clips.length > 512 || typeof randomBytes !== "function") fail("schema");
  const seen = new Set();
  for (const c of clips) {
    object(c, ["reviewCopySha256", "runRecordSha256", "lane", "passageId", "condition", "playbackSpeed"]);
    hash(c.reviewCopySha256); hash(c.runRecordSha256); id(c.passageId); id(c.condition);
    if (![...LANES, "human-reference"].includes(c.lane) || ![0.5, 0.75, 1, 1.25].includes(c.playbackSpeed)) fail("schema");
    if (seen.has(c.reviewCopySha256)) fail("duplicate-file"); seen.add(c.reviewCopySha256);
  }
  const labels = new Set(), entries = clips.map(c => {
    let label;
    do {
      const bytes = randomBytes(8);
      if (!(bytes instanceof Uint8Array) || bytes.length !== 8) fail("random");
      label = `clip-${[...bytes].map(b => BASE32[b & 31]).join("")}`;
    } while (labels.has(label));
    labels.add(label);
    return { label, ...c };
  }).sort((a, b) => a.label < b.label ? -1 : 1);
  const labelBytes = Buffer.from(canonicalJson({ schema: "chant-listening-labels/v1", clips: entries.map(e => ({ label: e.label, reviewCopySha256: e.reviewCopySha256 })) }), "utf8");
  const keyBytes = Buffer.from(canonicalJson({ schema: "chant-listening-key/v1", labelsSha256: sha256(labelBytes), entries,
    handling: "keep this key and every run record away from the reviewer until scorecards are recorded; run records list review-copy hashes beside their lane" }), "utf8");
  return Object.freeze({ labels: labelBytes, key: keyBytes });
}
