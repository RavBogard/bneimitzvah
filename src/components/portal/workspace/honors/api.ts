import { PortalRequestError } from "../../api";
import type { HonorsCommit, HonorsContext, HonorsContextView, HonorsIntent, HonorsRead, HonorsVersion } from "../../../../lib/honors/types";
import { aliyahStarts } from "../../../../lib/readings/aliyah-starts";
import { expandReadingRanges, parseCeremonyDate } from "../../../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../../../lib/readings/catalog";
import { HONORS_LIMITS, bytes, captureHonorsForm, dense, formFingerprint, own, uuid } from "./draft";

export class HonorsClientError extends PortalRequestError {
  constructor(status = 503, readonly code = "unavailable", readonly definite = false) { super(status); }
}
const fail = (): never => { throw new HonorsClientError(); };
const integer = (v: unknown, min = 0) => { if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > 2147483647) return fail(); return Number(v); };
const bool = (v: unknown) => { if (typeof v !== "boolean") return fail(); return v; };
const hash = (v: unknown) => { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) return fail(); return v; };
const date = (v: unknown) => { if (typeof v !== "string" || parseCeremonyDate(v) !== v) return fail(); return v; };
const slot = (v: unknown) => { if (!["morning", "havdalah", "unknown"].includes(v as string)) return fail(); return v as HonorsContext["serviceSlot"]; };
function captureIntent(value: unknown): HonorsIntent {
  const v = own(value, ["expectedVersion", "mutationId", "contextHash", "form"]), expectedVersion = integer(v.expectedVersion);
  if (expectedVersion > 2147483646) return fail();
  return Object.freeze({ expectedVersion, mutationId: uuid(v.mutationId), contextHash: hash(v.contextHash), form: captureHonorsForm(v.form, false) });
}
export async function parseHonorsContext(value: unknown, studentId: string): Promise<HonorsContextView> {
  const v = own(value, ["hash", "snapshot", "spans", "status", "unknownSlot", "readingNeedsReview"]), s = own(v.snapshot, ["schemaVersion", "tenantId", "studentId", "ceremonyDate", "serviceSlot", "torah"]);
  if (s.schemaVersion !== 1 || s.studentId !== studentId || typeof s.tenantId !== "string" || !s.tenantId || s.tenantId.length > 128) return fail();
  let torah: HonorsContext["torah"] = null;
  if (s.torah !== null) {
    const t = own(s.torah, ["id", "revision", "ref", "basis", "confirmation", "verses", "cuts"]), c = own(t.confirmation, ["confirmationDate", "serviceSlot", "slotProvenance", "needsReview"]);
    if (typeof t.ref !== "string" || t.ref.length > HONORS_LIMITS.contextBytes || !["custom", "full", "selection", "triennial"].includes(t.basis as string)) return fail();
    const verses = expandReadingRanges(t.ref.split(/;\s*/), "torah", TANAKH_VERSE_COUNTS);
    if (!verses.length || verses.length > 1000 || JSON.stringify(dense(t.verses, 1000)) !== JSON.stringify(verses)) return fail();
    const cuts = aliyahStarts("torah", t.cuts, verses);
    if (c.slotProvenance !== null && (typeof c.slotProvenance !== "number" || !Number.isFinite(c.slotProvenance))) return fail();
    torah = Object.freeze({ id: uuid(t.id), revision: integer(t.revision, 1), ref: t.ref, basis: t.basis as NonNullable<HonorsContext["torah"]>["basis"],
      confirmation: Object.freeze({ confirmationDate: c.confirmationDate === null ? null : date(c.confirmationDate), serviceSlot: c.serviceSlot === null ? null : slot(c.serviceSlot), slotProvenance: c.slotProvenance as number | null, needsReview: bool(c.needsReview) }),
      verses: Object.freeze(verses), cuts: cuts === null ? null : Object.freeze(cuts) });
  }
  const snapshot: HonorsContext = Object.freeze({ schemaVersion: 1, tenantId: s.tenantId, studentId, ceremonyDate: date(s.ceremonyDate), serviceSlot: slot(s.serviceSlot), torah });
  if (bytes(snapshot) > HONORS_LIMITS.contextBytes) return fail();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)))), b => b.toString(16).padStart(2, "0")).join("");
  if (hash(v.hash) !== digest) return fail();
  const starts = !torah || torah.cuts === null ? [] : [torah.verses[0], ...torah.cuts];
  const spans = Object.freeze(starts.map((startVerse, i) => Object.freeze({ startVerse, endVerse: i + 1 === starts.length ? torah!.verses.at(-1)! : torah!.verses[torah!.verses.indexOf(starts[i + 1]) - 1] })));
  const status = !torah ? "unassigned" : torah.cuts === null ? "unresolved-cuts" : "assigned", unknownSlot = snapshot.serviceSlot === "unknown", readingNeedsReview = !!torah && (torah.confirmation.needsReview || torah.confirmation.serviceSlot !== snapshot.serviceSlot);
  if (v.status !== status || v.unknownSlot !== unknownSlot || v.readingNeedsReview !== readingNeedsReview || JSON.stringify(dense(v.spans, 1000).map(s => own(s, ["startVerse", "endVerse"]))) !== JSON.stringify(spans)) return fail();
  return Object.freeze({ hash: digest, snapshot, spans, status, unknownSlot, readingNeedsReview });
}
async function version(value: unknown, studentId: string): Promise<HonorsVersion> {
  const v = own(value, ["version", "form", "reviewedContext", "createdAt"]), form = captureHonorsForm(v.form, false), reviewedContext = await parseHonorsContext(v.reviewedContext, studentId);
  // Stored response names must already be canonical; display never silently repairs server bytes.
  if (JSON.stringify(v.form) !== JSON.stringify(form) || typeof v.createdAt !== "string" || !Number.isFinite(Date.parse(v.createdAt))) return fail();
  let previous = -1; for (const a of form.aliyot) { const n = reviewedContext.spans.findIndex(s => s.startVerse === a.startVerse); if (n <= previous) return fail(); previous = n; }
  return Object.freeze({ version: integer(v.version, 1), form, reviewedContext, createdAt: v.createdAt });
}
export async function parseHonorsRead(value: unknown, studentId: string): Promise<HonorsRead> {
  const v = own(value, ["ok", "studentId", "currentVersion", "currentContext", "saved", "needsReview"]);
  const currentContext = await parseHonorsContext(v.currentContext, studentId), saved = v.saved === null ? null : await version(v.saved, studentId), currentVersion = integer(v.currentVersion);
  if (v.ok !== true || v.studentId !== studentId || (saved?.version ?? 0) !== currentVersion || v.needsReview !== (!!saved && saved.reviewedContext.hash !== currentContext.hash)) return fail();
  if (saved && saved.reviewedContext.snapshot.tenantId !== currentContext.snapshot.tenantId) return fail();
  return Object.freeze({ ok: true, studentId, currentVersion, currentContext, saved, needsReview: bool(v.needsReview) });
}
async function commit(value: unknown, studentId: string, intent: HonorsIntent, receipt: boolean): Promise<HonorsCommit | { outcome: "unconfirmed"; ok: true }> {
  if (receipt && value && typeof value === "object" && (value as { outcome?: unknown }).outcome === "unconfirmed") { const v = own(value, ["ok", "outcome"]); if (v.ok !== true) return fail(); return Object.freeze({ ok: true, outcome: "unconfirmed" }); }
  const v = own(value, ["ok", "outcome", "replayed", "committedVersion", "currentLatestVersion", "committed", "currentContext", "needsReview"]), saved = await version(v.committed, studentId), currentContext = await parseHonorsContext(v.currentContext, studentId), committedVersion = integer(v.committedVersion, 1), currentLatestVersion = integer(v.currentLatestVersion, 1);
  if (v.ok !== true || v.outcome !== "committed" || committedVersion !== intent.expectedVersion + 1 || saved.version !== committedVersion || currentLatestVersion < committedVersion || saved.reviewedContext.hash !== intent.contextHash || formFingerprint(saved.form) !== formFingerprint(intent.form)
    || saved.reviewedContext.snapshot.tenantId !== currentContext.snapshot.tenantId || v.needsReview !== (saved.reviewedContext.hash !== currentContext.hash)) return fail();
  return Object.freeze({ ok: true, outcome: "committed", replayed: bool(v.replayed), committedVersion, currentLatestVersion, committed: saved, currentContext, needsReview: bool(v.needsReview) });
}
export function createHonorsClient(input: { studentId: string; mode: "parent" | "admin"; verify(signal: AbortSignal): Promise<void>; denied(status: number): void }) {
  const studentId = uuid(input.studentId), mode = input.mode;
  if (mode !== "parent" && mode !== "admin") throw new HonorsClientError(403);
  const endpoint = `/api/students/${studentId}/honors`;
  async function request<T>(path: string, signal: AbortSignal, parse: (v: unknown) => Promise<T>, body?: unknown): Promise<T> {
    const controller = new AbortController(), abort = () => controller.abort(), total = setTimeout(abort, 15000); let idle: ReturnType<typeof setTimeout> | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const live = () => { if (controller.signal.aborted) throw new HonorsClientError(); };
    const wait = <V,>(task: Promise<V>): Promise<V> => new Promise((resolve, reject) => {
      const stopped = () => { controller.signal.removeEventListener("abort", stopped); reject(new HonorsClientError()); };
      if (controller.signal.aborted) { stopped(); return; } controller.signal.addEventListener("abort", stopped, { once: true });
      task.then(value => { controller.signal.removeEventListener("abort", stopped); resolve(value); }, error => { controller.signal.removeEventListener("abort", stopped); reject(error); });
    });
    try {
      live(); await wait(input.verify(controller.signal)); live();
      const response = await wait(fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      live(); if ([401, 403, 404].includes(response.status)) throw new HonorsClientError(response.status);
      if (!response.headers.get("content-type")?.split(";")[0].trim().match(/^application\/json$/i) || !response.body) return fail();
      const declared = response.headers.get("content-length"); if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > HONORS_LIMITS.responseBytes)) return fail();
      reader = response.body.getReader(); const storage = new Uint8Array(HONORS_LIMITS.responseBytes); let length = 0, empty = 0;
      while (true) {
        idle = setTimeout(abort, 5000);
        const part = await wait(reader.read());
        clearTimeout(idle); live(); if (part.done) break;
        if (!(part.value instanceof Uint8Array) || part.value.byteLength > storage.length - length || !part.value.byteLength && ++empty > 64) return fail();
        storage.set(part.value, length); length += part.value.byteLength; if (part.value.byteLength) empty = 0;
      }
      const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(storage.subarray(0, length))); live();
      let fixed: HonorsClientError | undefined;
      if (response.status !== 200) { const v = own(value, ["ok", "code"]), valid = v.ok === false && (response.status === 409 && ["conflict", "stale-context"].includes(v.code as string) || response.status === 400 && v.code === "invalid-request"); if (!valid) return fail(); fixed = new HonorsClientError(response.status, v.code as string, true); }
      const result = fixed ? undefined : await wait(parse(value)); live(); await wait(input.verify(controller.signal)); live(); if (fixed) throw fixed; return result as T;
    } catch (error) { if (error instanceof PortalRequestError && [401, 403, 404].includes(error.status)) input.denied(error.status); if (error instanceof PortalRequestError) throw error; return fail(); }
    finally { clearTimeout(total); clearTimeout(idle); signal.removeEventListener("abort", abort); controller.abort(); try { void reader?.cancel().catch(() => {}); } catch {} try { reader?.releaseLock(); } catch {} }
  }
  return Object.freeze({
    read(signal: AbortSignal) { return request(`${endpoint}?mode=${mode}`, signal, v => parseHonorsRead(v, studentId)); },
    write(input: HonorsIntent, signal: AbortSignal) { const intent = captureIntent(input); return request(endpoint, signal, v => commit(v, studentId, intent, false) as Promise<HonorsCommit>, { mode, ...intent }); },
    receipt(input: HonorsIntent, signal: AbortSignal) { const intent = captureIntent(input); return request(`${endpoint}/receipt`, signal, v => commit(v, studentId, intent, true), { mode, ...intent }); }
  });
}
export type HonorsClient = ReturnType<typeof createHonorsClient>;
