import { PortalRequestError } from "../../api";
import { own, uuid } from "./draft";

export type LinkIntent = Readonly<{ operation: "issue" | "reissue" | "revoke"; mutationId: string; expectedVersion: number; contextHash: string; startVerse: string; linkId: string | null }>;
export type LinkRecord = Readonly<{ id: string; startVerse: string; issuedAt: string | null; expiresAt: string | null }>;
export type LinkResult = Readonly<{ ok: true; outcome: "unconfirmed" }> | Readonly<{ ok: true; outcome: "committed"; replayed: boolean; operation: LinkIntent["operation"]; linkId: string; startVerse: string; url?: string; expiresAt?: string }>;
export class HonoreeClientError extends PortalRequestError { constructor(status = 503, readonly definite = false) { super(status); } }
const fail = (): never => { throw new HonoreeClientError(); };
const start = (v: unknown) => { if (typeof v !== "string" || v.length > 80 || !/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(v)) return fail(); return v; };
const linkId = (v: unknown) => { if (typeof v !== "string" || !/^[A-Za-z0-9_-]{21}[AQgw]$/.test(v)) return fail(); return v; };
const instant = (v: unknown) => { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) || new Date(v).toISOString() !== v) return fail(); return v; };
export function captureLinkIntent(input: unknown): LinkIntent {
  const v = own(input, ["operation", "mutationId", "expectedVersion", "contextHash", "startVerse", "linkId"]);
  if (!["issue", "reissue", "revoke"].includes(v.operation as string) || !Number.isSafeInteger(v.expectedVersion) || Number(v.expectedVersion) < 1 || Number(v.expectedVersion) > 2147483647 || typeof v.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(v.contextHash)) return fail();
  if (v.operation === "issue" ? v.linkId !== null : v.linkId === null) return fail();
  return Object.freeze({ operation: v.operation as LinkIntent["operation"], mutationId: uuid(v.mutationId), expectedVersion: Number(v.expectedVersion), contextHash: v.contextHash, startVerse: start(v.startVerse), linkId: v.linkId === null ? null : linkId(v.linkId) });
}
export function createHonoreeClient(input: { studentId: string; mode: "parent" | "admin" | "student"; origin: string; verify(signal: AbortSignal): Promise<void>; denied(status: number): void }) {
  const studentId = uuid(input.studentId), endpoint = `/api/students/${studentId}/honoree-links`, mode = input.mode, origin = input.origin;
  if (!["parent", "admin", "student"].includes(mode) || new URL(origin).origin !== origin) throw new HonoreeClientError(403);
  async function request<T>(suffix: string, body: unknown, signal: AbortSignal, parse: (value: unknown) => T): Promise<T> {
    const controller = new AbortController(), abort = () => controller.abort(), timeout = setTimeout(abort, 15000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, idle: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const live = () => { if (controller.signal.aborted) throw new HonoreeClientError(); };
    const wait = <V,>(task: Promise<V>): Promise<V> => new Promise((resolve, reject) => {
      const stopped = () => { controller.signal.removeEventListener("abort", stopped); reject(new HonoreeClientError()); };
      if (controller.signal.aborted) { stopped(); return; } controller.signal.addEventListener("abort", stopped, { once: true });
      task.then(v => { controller.signal.removeEventListener("abort", stopped); resolve(v); }, e => { controller.signal.removeEventListener("abort", stopped); reject(e); });
    });
    try {
      live(); await wait(input.verify(controller.signal)); live();
      const response = await wait(fetch(endpoint + suffix, { method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ mode, ...body as object }) }));
      live(); if ([401, 403, 404].includes(response.status)) throw new HonoreeClientError(response.status);
      if (!/^application\/json$/i.test(response.headers.get("content-type")?.split(";")[0].trim() ?? "") || !response.body) return fail();
      const declared = response.headers.get("content-length"); if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8192)) return fail();
      reader = response.body.getReader(); const storage = new Uint8Array(8192); let length = 0, empty = 0;
      while (true) {
        idle = setTimeout(abort, 5000); const chunk = await wait(reader.read()); clearTimeout(idle); live(); if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > storage.length - length || !chunk.value.byteLength && ++empty > 64) return fail();
        storage.set(chunk.value, length); length += chunk.value.byteLength; if (chunk.value.byteLength) empty = 0;
      }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(storage.subarray(0, length))); live();
      if (response.status === 409) { const v = own(value, ["ok", "code"]); if (v.ok !== false || v.code !== "conflict") return fail(); await wait(input.verify(controller.signal)); live(); throw new HonoreeClientError(409, true); }
      if (response.status !== 200) return fail();
      const result = parse(value); await wait(input.verify(controller.signal)); live(); return result;
    } catch (error) { if (error instanceof PortalRequestError) { if ([401, 403].includes(error.status)) input.denied(error.status); throw error; } return fail(); }
    finally { clearTimeout(timeout); clearTimeout(idle); signal.removeEventListener("abort", abort); controller.abort(); try { void reader?.cancel().catch(() => {}); } catch {} try { reader?.releaseLock(); } catch {} }
  }
  function result(input: unknown, intent: LinkIntent, receipt: boolean): LinkResult {
    if (receipt && (input as { outcome?: unknown })?.outcome === "unconfirmed") { const v = own(input, ["ok", "outcome"]); if (v.ok !== true) return fail(); return Object.freeze({ ok: true, outcome: "unconfirmed" }); }
    const hasSecret = !!input && typeof input === "object" && Object.hasOwn(input, "url");
    const v = own(input, ["ok", "outcome", "replayed", "operation", "linkId", "startVerse", ...(hasSecret ? ["url", "expiresAt"] : [])]);
    if (v.ok !== true || v.outcome !== "committed" || typeof v.replayed !== "boolean" || v.operation !== intent.operation || v.startVerse !== intent.startVerse || intent.operation === "revoke" && v.linkId !== intent.linkId) return fail();
    const id = linkId(v.linkId);
    if (hasSecret) {
      if (receipt || v.replayed || intent.operation === "revoke" || typeof v.url !== "string" || v.url.length > 512) return fail();
      const prefix = origin + "/honoree#token=", value = v.url.slice(prefix.length);
      if (!v.url.startsWith(prefix) || !/^hl1\.k1\.[A-Za-z0-9_-]{21}[AQgw]\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value) || value.split(".")[2] !== id) return fail();
      return Object.freeze({ ok: true, outcome: "committed", replayed: false, operation: intent.operation, linkId: id, startVerse: intent.startVerse, url: v.url, expiresAt: instant(v.expiresAt) });
    }
    if (!v.replayed && intent.operation !== "revoke") return fail();
    return Object.freeze({ ok: true, outcome: "committed", replayed: v.replayed, operation: intent.operation, linkId: id, startVerse: intent.startVerse });
  }
  return Object.freeze({
    status(value: string, signal: AbortSignal) { const startVerse = start(value); return request("/status", { startVerse }, signal, value => { const v = own(value, ["ok", "currentLink"]); if (v.ok !== true) return fail(); if (v.currentLink === null) return null; const r = own(v.currentLink, ["id", "startVerse", "issuedAt", "expiresAt"]); if (r.startVerse !== startVerse) return fail(); return Object.freeze({ id: linkId(r.id), startVerse, issuedAt: instant(r.issuedAt), expiresAt: instant(r.expiresAt) }); }); },
    mutate(value: LinkIntent, signal: AbortSignal) { const intent = captureLinkIntent(value); return request("", intent, signal, v => result(v, intent, false)); },
    receipt(value: LinkIntent, signal: AbortSignal) { const intent = captureLinkIntent(value); return request("/receipt", intent, signal, v => result(v, intent, true)); }
  });
}
export type HonoreeClient = ReturnType<typeof createHonoreeClient>;
