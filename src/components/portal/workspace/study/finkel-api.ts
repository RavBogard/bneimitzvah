import { PortalRequestError } from "../../api";
import { FINKEL_LIMITS, finkelMediaPath, parseFinkelClips, type FinkelClip, type FinkelClips } from "../../../../lib/reference-audio/finkel";

/** Cantor Finkel's clips for any page that plays reference audio: the assigned
 * reading, the proposed portion, or an admin listening review. Source-agnostic
 * callers get the clip list (with its manifest pin and asset IDs) and verified
 * bytes; neither request carries a token, store or provider URL. */
export type FinkelRequestMode = "student" | "parent" | "tutor" | "admin";
/** Linked-child practice is a parent signed in; the bytes are not per-student. */
export const finkelRequestMode = (mode: string): FinkelRequestMode | null =>
  mode === "child-practice" ? "parent" : mode === "student" || mode === "parent" || mode === "tutor" || mode === "admin" ? mode : null;

const fail = (status = 503): never => { throw new PortalRequestError(status); };
async function bounded(path: string, accept: string, cap: number, signal: AbortSignal, ms: number): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  const origin = location.origin; if (new URL(origin).origin !== origin) return fail();
  const controller = new AbortController(), abort = () => controller.abort(), timer = setTimeout(abort, ms);
  if (signal.aborted) abort(); signal.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(path, { headers: { accept }, signal: controller.signal, credentials: "same-origin", mode: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "same-origin" });
    if (!response.ok) { try { void response.body?.cancel().catch(() => {}); } catch {} return fail([401, 403, 404, 409, 429].includes(response.status) ? response.status : 503); }
    if (response.redirected || response.url !== origin + path || !response.body) return fail();
    reader = response.body.getReader();
    const bytes = new Uint8Array(cap); let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || part.value.byteLength > cap - size) return fail();
      bytes.set(part.value, size); size += part.value.byteLength;
    }
    if (signal.aborted || controller.signal.aborted) return fail(409);
    return { bytes: bytes.subarray(0, size), type: response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "" };
  } catch (error) { if (error instanceof PortalRequestError) throw error; return fail(signal.aborted ? 409 : 503); }
  finally { clearTimeout(timer); signal.removeEventListener("abort", abort); if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} } }
}

/** Clips sharing a verse with [from, to] (one book). An admin may omit the range to list every clip. */
export async function fetchFinkelClips(selection: Readonly<{ mode: FinkelRequestMode; from?: string; to?: string }>, signal: AbortSignal): Promise<FinkelClips> {
  const query = new URLSearchParams({ mode: selection.mode });
  if (selection.from !== undefined && selection.to !== undefined) { query.set("from", selection.from); query.set("to", selection.to); }
  const { bytes, type } = await bounded(`/api/reference-audio/finkel/clips?${query}`, "application/json", FINKEL_LIMITS.responseBytes, signal, 15000);
  if (type !== "application/json") return fail();
  let parsed: FinkelClips | null = null;
  try { parsed = parseFinkelClips(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); } catch { parsed = null; }
  return parsed ?? fail();
}

/** Whole clip bytes, checked against the clip's exact length and SHA-256 before use. */
export async function fetchFinkelAudio(clip: FinkelClip, mode: FinkelRequestMode, signal: AbortSignal): Promise<Blob> {
  const { bytes, type } = await bounded(`${finkelMediaPath(clip.sha256)}?${new URLSearchParams({ mode })}`, "audio/mpeg", clip.bytes, signal, 30000);
  if (type !== "audio/mpeg" || bytes.byteLength !== clip.bytes) return fail();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== clip.sha256 || signal.aborted) return fail(signal.aborted ? 409 : 503);
  return new Blob([bytes], { type: "audio/mpeg" });
}
