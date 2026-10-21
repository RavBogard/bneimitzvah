import { PortalRequestError } from "../../api";

export const REVIEW_CHECKS = ["privacy", "listening", "exactText", "musicalAccuracy", "rights"] as const;
export type Check = typeof REVIEW_CHECKS[number];
export type Checks = Record<Check, "pass" | "hold">;
export type Batch = { id: string; manifestSha256: string; catalogSha256: string; generation: number; entryCount: number; expiresAt: string; studentReady: false; timing: "unavailable" };
export type Decision = { revision: number; requestId: string; checks: Checks; createdAt: string; wholeClipAccepted: boolean; studentReady: false; timing: "unavailable" };
export type Entry = { assetKey: string; identitySha256: string; targetSha256: string; masterSha256: string; textSha256: string; readingKind: "torah" | "haftarah";
  verses: string[]; mode: "spoken" | "chant"; tempo: null; playback: { sha256: string; bytes: number; durationSeconds: number }; text: { ref: string; readingText: string; sha256: string }[]; decision: Decision | null };
export type Detail = { batch: Batch; entries: Entry[] };
const bad = (): never => { throw new PortalRequestError(503); };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const asset = (v: unknown): v is string => typeof v === "string" && /^fj_[a-f0-9]{20}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function need(value: unknown): asserts value { if (!value) bad(); }
function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  need(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
  const d = Object.getOwnPropertyDescriptors(value); need(Reflect.ownKeys(value).length === keys.length && keys.every(k => Object.hasOwn(d, k) && Object.hasOwn(d[k], "value")));
  return value as Record<string, unknown>;
}
const integer = (v: unknown, min = 1) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= 2147483647;
const instant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function parseBatch(value: unknown): Batch {
  const b = row(value, ["id", "manifestSha256", "catalogSha256", "generation", "entryCount", "expiresAt", "studentReady", "timing"]);
  need(uuid(b.id) && hash(b.manifestSha256) && hash(b.catalogSha256) && integer(b.generation) && integer(b.entryCount) && Number(b.entryCount) <= 8
    && instant(b.expiresAt) && Date.parse(b.expiresAt) > Date.now() && b.studentReady === false && b.timing === "unavailable");
  return b as Batch;
}
export function parseDecision(value: unknown): Decision {
  const d = row(value, ["revision", "requestId", "checks", "createdAt", "wholeClipAccepted", "studentReady", "timing"]), checks = row(d.checks, REVIEW_CHECKS);
  need(integer(d.revision) && uuid(d.requestId) && instant(d.createdAt) && REVIEW_CHECKS.every(k => checks[k] === "pass" || checks[k] === "hold")
    && d.wholeClipAccepted === REVIEW_CHECKS.every(k => checks[k] === "pass") && d.studentReady === false && d.timing === "unavailable");
  return d as Decision;
}
export function parseDetail(value: unknown, id: string): Detail {
  const result = row(value, ["ok", "batch", "entries"]), batch = parseBatch(result.batch); need(result.ok === true && batch.id === id);
  need(Array.isArray(result.entries) && result.entries.length === batch.entryCount);
  const seen = new Set<string>();
  const entries = result.entries.map(value => {
    const e = row(value, ["assetKey", "identitySha256", "targetSha256", "masterSha256", "textSha256", "readingKind", "verses", "mode", "tempo", "playback", "text", "decision"]);
    need(asset(e.assetKey) && !seen.has(e.assetKey)); seen.add(e.assetKey);
    need([e.identitySha256, e.targetSha256, e.masterSha256, e.textSha256].every(hash) && ["torah", "haftarah"].includes(String(e.readingKind)) && ["spoken", "chant"].includes(String(e.mode)) && e.tempo === null);
    need(Array.isArray(e.verses) && e.verses.length > 0 && e.verses.length <= 512 && e.verses.every(v => typeof v === "string" && /^[A-Za-z ]{1,40} [1-9]\d{0,2}:[1-9]\d{0,2}$/.test(v)) && new Set(e.verses).size === e.verses.length);
    const p = row(e.playback, ["sha256", "bytes", "durationSeconds"]);
    need(hash(p.sha256) && integer(p.bytes) && Number(p.bytes) <= 4 * 1024 * 1024 && typeof p.durationSeconds === "number" && Number.isFinite(p.durationSeconds) && p.durationSeconds > 0 && p.durationSeconds <= 3600);
    const refs = e.verses; need(Array.isArray(e.text) && e.text.length === refs.length);
    for (const [i, value] of e.text.entries()) {
      const t = row(value, ["ref", "readingText", "sha256"]);
      need(t.ref === refs[i] && hash(t.sha256) && typeof t.readingText === "string" && t.readingText.length > 0 && t.readingText.length <= 8192 && !/[\x00-\x1f\x7f<>]/.test(t.readingText));
    }
    if (e.decision !== null) parseDecision(e.decision);
    return e as Entry;
  });
  return { batch, entries };
}
const base = "/api/reference-review/batches";
export function reviewPath(id?: string, operation?: "media" | "decisions" | "revoke", key?: string) {
  if (id === undefined) { need(operation === undefined && key === undefined); return base; }
  need(uuid(id)); if (!operation) { need(key === undefined); return `${base}/${id}`; }
  need(["media", "decisions", "revoke"].includes(operation));
  if (operation === "revoke") { need(key === undefined); return `${base}/${id}/revoke`; }
  need(asset(key)); return `${base}/${id}/${operation}/${key}`;
}
async function request(path: string, signal: AbortSignal, body?: unknown, audio?: { bytes: number; sha256: string; expiresAt: string }): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  const timer = setTimeout(abort, 30000); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, completed = false;
  const live = () => { if (signal.aborted || controller.signal.aborted || audio && Date.parse(audio.expiresAt) <= Date.now()) bad(); };
  try {
    live(); const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body === undefined ? { accept: audio ? "audio/mpeg" : "application/json" } : { accept: "application/json", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    live(); if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 503);
    need(!response.redirected && response.url === location.origin + path && response.headers.get("content-type")?.split(";", 1)[0] === (audio ? "audio/mpeg" : "application/json") && response.body);
    reader = response.body.getReader(); const cap = audio ? audio.bytes : 256 * 1024; need(integer(cap) && cap <= 4 * 1024 * 1024);
    const bytes = new Uint8Array(cap); let size = 0, empty = 0;
    for (;;) {
      const idle = setTimeout(abort, 5000); let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); } finally { clearTimeout(idle); }
      live(); if (next.done) break; need(next.value instanceof Uint8Array && size + next.value.byteLength <= cap);
      if (!next.value.byteLength) { need(++empty <= 64); continue; } empty = 0; bytes.set(next.value, size); size += next.value.byteLength;
    }
    let result: unknown;
    if (audio) {
      need(size === audio.bytes && hash(audio.sha256));
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.subarray(0, size)))).map(v => v.toString(16).padStart(2, "0")).join("");
      need(digest === audio.sha256); result = new Blob([bytes.subarray(0, size)], { type: "audio/mpeg" });
    } else result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    live(); completed = true; return result;
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { if (!completed) { abort(); try { void reader?.cancel().catch(() => {}); } catch {} } try { reader?.releaseLock(); } catch {} clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
export const reviewApi = {
  async list(signal: AbortSignal): Promise<Batch[]> { const r = row(await request(reviewPath(), signal), ["ok", "batches"]); need(r.ok === true && Array.isArray(r.batches) && r.batches.length <= 25); const list = r.batches.map(parseBatch); need(new Set(list.map(b => b.id)).size === list.length); return list; },
  async detail(id: string, signal: AbortSignal) { return parseDetail(await request(reviewPath(id), signal), id); },
  async audio(batch: Batch, entry: Entry, signal: AbortSignal) { return await request(reviewPath(batch.id, "media", entry.assetKey), signal, undefined, { ...entry.playback, expiresAt: batch.expiresAt }) as Blob; },
  async decide(batch: Batch, entry: Entry, checks: Checks, signal: AbortSignal) {
    const r = row(await request(reviewPath(batch.id, "decisions", entry.assetKey), signal, { requestId: crypto.randomUUID(), generation: batch.generation, manifestSha256: batch.manifestSha256, expectedRevision: entry.decision?.revision ?? 0, checks }), ["ok", "decision"]);
    need(r.ok === true); return parseDecision(r.decision);
  },
  async revoke(batch: Batch, signal: AbortSignal) {
    const r = row(await request(reviewPath(batch.id, "revoke"), signal, { generation: batch.generation, manifestSha256: batch.manifestSha256 }), ["ok", "id", "generation", "revoked", "studentReady"]);
    need(r.ok === true && r.id === batch.id && integer(r.generation) && r.revoked === true && r.studentReady === false);
  },
};
